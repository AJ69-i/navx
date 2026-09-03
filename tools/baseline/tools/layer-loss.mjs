/**
 * Layer-loss detector — which NAVX declarations does the host page beat?
 *
 * `@layer` buys internal cascade discipline and lets consumers override without
 * `!important`. The price is absolute: *any* unlayered author CSS beats *every*
 * layer, regardless of specificity. So Bootstrap 4's Reboot
 * (`nav { display: block }`, one type selector) silently defeats
 * `@layer navx.base { .navx { display: flex } }`, and the nav stops being a
 * flex container in every Bootstrap 4 page on the internet.
 *
 * This measures that, rather than guessing at it. It snapshots the computed
 * style of every element in the nav, then re-injects the same stylesheet with
 * its `@layer` wrappers removed — unlayered and last, so NAVX wins every tie it
 * would win on specificity — and reports each property that changed. Every line
 * of output is a declaration NAVX loses only because it is layered.
 *
 *   node tools/layer-loss.mjs [variant] [state] [--project desktop]
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { harnessPort, paths } from './env.mjs';
import { PROJECTS, contextFor } from './projects.mjs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const PORT = harnessPort();
const projectName = argOf('project', 'desktop');
const project = PROJECTS.find((p) => p.name === projectName);
if (!project) {
  console.error(`unknown project ${projectName}`);
  process.exit(1);
}

/** Everything NAVX actually declares somewhere. Cheap to over-list. */
const PROPS = [
  'display',
  'position',
  'float',
  'box-sizing',
  'visibility',
  'opacity',
  'z-index',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'align-self',
  'justify-content',
  'gap',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration-line',
  'text-transform',
  'white-space',
  'color',
  'background-color',
  'background-image',
  'list-style-type',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-bottom-color',
  'border-top-left-radius',
  'border-radius',
  'box-shadow',
  'overflow-x',
  'overflow-y',
  'cursor',
  'rotate',
  'translate',
  'scale',
  'clip-path',
  'transition-duration',
  'container-type',
];

const variants = positional.length
  ? [{ id: positional[0], state: positional[1] ?? 'rest' }]
  : JSON.parse(await readFile(path.join(paths.fixtures, 'manifest.json'), 'utf8'))
      .variants.slice(0, 12)
      .map((v) => ({ id: v.id, state: 'rest' }));

const browser = await chromium.launch();
const context = await browser.newContext(contextFor(project));
const page = await context.newPage();

/** The same rules, unlayered. Rebuilt from the CSSOM, not by regex. */
const UNLAYER = () => {
  const flatten = (rules) => {
    let out = '';
    for (const rule of rules) {
      if (rule.constructor.name === 'CSSLayerBlockRule') out += flatten(rule.cssRules);
      else if (rule.constructor.name === 'CSSLayerStatementRule') continue;
      else out += `${rule.cssText}\n`;
    }
    return out;
  };
  const sheet = [...document.styleSheets].find((s) => s.href?.includes('/navx/navx.css'));
  if (!sheet) return 'no navx sheet found';
  const style = document.createElement('style');
  style.textContent = flatten(sheet.cssRules);
  document.head.appendChild(style);
  return null;
};

const SNAPSHOT = (props) => {
  const nav = document.querySelector('.navx');
  const out = [];
  const walk = (el, p) => {
    const cs = getComputedStyle(el);
    const vals = {};
    for (const k of props) vals[k] = cs.getPropertyValue(k);
    out.push({ p, tag: el.tagName.toLowerCase(), cls: el.className, vals });
    [...el.children].forEach((c, i) => walk(c, `${p}.${i}`));
  };
  walk(nav, '0');
  return out;
};

const findings = new Map();

for (const { id, state } of variants) {
  await page.goto(`http://localhost:${PORT}/stage2.html?id=${id}&state=${state}`, {
    waitUntil: 'load',
  });
  await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });

  const before = await page.evaluate(SNAPSHOT, PROPS);
  const err = await page.evaluate(UNLAYER);
  if (err) {
    console.error(err);
    break;
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  const after = await page.evaluate(SNAPSHOT, PROPS);

  for (const [i, b] of before.entries()) {
    const a = after[i];
    if (!a) continue;
    for (const k of PROPS) {
      if (b.vals[k] === a.vals[k]) continue;
      const sel = `${b.tag}${b.cls ? `.${b.cls.split(' ').join('.')}` : ''}`;
      const key = `${sel}|${k}`;
      if (!findings.has(key)) {
        findings.set(key, { sel, prop: k, lost: b.vals[k], want: a.vals[k], seen: new Set() });
      }
      findings.get(key).seen.add(id);
    }
  }
}

await browser.close();

console.log(`\nchecked ${variants.length} variant(s) on ${projectName}\n`);
if (!findings.size) {
  console.log('no NAVX declaration is beaten by the host page.');
} else {
  console.log(`${findings.size} declaration(s) lost to unlayered host CSS:\n`);
  process.exitCode = 1;
  const rows = [...findings.values()].sort((a, b) => a.sel.localeCompare(b.sel));
  for (const f of rows) {
    console.log(
      `  ${f.sel}\n    ${f.prop}: got "${f.lost}", NAVX declares "${f.want}"` +
        `  (${f.seen.size} variant${f.seen.size > 1 ? 's' : ''})`,
    );
  }
}
