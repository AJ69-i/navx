/**
 * Geometry probe — legacy layout vs Stage 2 layout, in numbers.
 *
 * A diff image tells you a region moved. It does not tell you which element,
 * by how much, or in which axis, and guessing from pixels is how you end up
 * "fixing" the wrong rule. This mounts the same variant and state in both
 * harnesses, walks both nav subtrees in lockstep, and reports every element
 * whose box moved or resized by more than a pixel.
 *
 * Elements are matched by tree path (child index chain from the nav root)
 * rather than by selector, because the transform renames classes but never
 * moves a node — so identical paths are the same element by construction, and
 * a path present in one tree but not the other is itself a finding.
 *
 *   node tools/probe-geometry.mjs <variant> [state] [--project desktop] [--top 40]
 */

import { chromium } from '@playwright/test';
import { harnessPort } from './env.mjs';
import { PROJECTS, contextFor } from './projects.mjs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const [variant, state = 'rest'] = positional;
if (!variant) {
  console.error('usage: node tools/probe-geometry.mjs <variant> [state] [--project desktop]');
  process.exit(1);
}

const PORT = harnessPort();
const TOP = Number(argOf('top', 40));
const projectName = argOf('project', 'desktop');
const project = PROJECTS.find((p) => p.name === projectName);
if (!project) {
  console.error(
    `unknown project ${projectName}; expected one of ${PROJECTS.map((p) => p.name).join(', ')}`,
  );
  process.exit(1);
}

const WITH_PANEL = projectName === 'mobile';
const skin = argOf('skin', null);
const SKIN_QS = skin ? `&skin=${skin}` : '';

/**
 * Transitions off, both sides.
 *
 * The screenshot path never needs this because `animations: 'disabled'`
 * fast-forwards transitions to their end state, but `getBoundingClientRect()`
 * happily reports a box mid-flight — legacy's drawer animates `left` over 0.3s
 * with no reduced-motion query, so an unfrozen probe measures the panel
 * somewhere in the middle and invents a difference that no snapshot has. This
 * cannot mask a real one: a transition changes when a box arrives, never where.
 */
const FREEZE = '*, *::before, *::after { transition: none !important; animation: none !important }';

/** Runs in the page. Same code both sides — only the root selector differs. */
const COLLECT = (rootSelector) => {
  const nav = document.querySelector(rootSelector);
  if (!nav) return { error: `no root for ${rootSelector}` };
  const out = [];
  const walk = (el, path) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out.push({
      path,
      tag: el.tagName.toLowerCase(),
      cls: el.className || '',
      x: Math.round(r.x * 100) / 100,
      y: Math.round(r.y * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100,
      pos: cs.position,
      disp: cs.display,
      vis: cs.visibility,
      op: cs.opacity,
      z: cs.zIndex,
    });
    [...el.children].forEach((c, i) => walk(c, `${path}.${i}`));
  };
  walk(nav, '0');
  return { out };
};

const browser = await chromium.launch();
const context = await browser.newContext(contextFor(project));

/** Legacy side — the plugin drives the state, exactly as Stage 0 captured it. */
async function legacy() {
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/harness.html?id=${variant}${SKIN_QS}`, {
    waitUntil: 'load',
  });
  await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });

  // Same rule the Stage 0 spec and compare-stage2 use: on mobile the drawer is
  // opened before a submenu, or the submenu is inside a closed panel.
  if (state === 'panel-open' || (WITH_PANEL && state !== 'rest')) {
    await page.addStyleTag({ content: FREEZE });
    await page.evaluate(() => document.querySelector('.navigation')?.toggleOffcanvas?.());
  }
  if (state === 'submenu-open' || state === 'submenu-nested') {
    await page.evaluate((deep) => {
      const nav = document.querySelector('.navigation');
      if (!nav?.showSubmenu) return;
      const SUBMENU = '.navigation-dropdown, .navigation-megamenu';
      const all = [...nav.querySelectorAll(SUBMENU)];
      const chainTo = (leaf) => {
        const chain = [];
        for (let el = leaf; el && el !== nav; el = el.parentElement) {
          if (el.matches(SUBMENU)) chain.unshift(el);
        }
        return chain;
      };
      const first = all[0];
      if (!first) return;
      const target = deep
        ? all.reduce((best, s) => (chainTo(s).length > chainTo(best).length ? s : best), first)
        : (all.find((s) => chainTo(s).length === 1) ?? first);
      for (const submenu of chainTo(target)) {
        const link = submenu.previousElementSibling;
        submenu.parentElement?.classList.add('is-active');
        if (link) nav.showSubmenu(link);
      }
    }, state === 'submenu-nested');
  }
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const res = await page.evaluate(COLLECT, '.navigation');
  await page.close();
  return res;
}

/** Stage 2 side — the harness itself drives the state from the query string. */
async function stage2() {
  const page = await context.newPage();
  const url = `http://localhost:${PORT}/stage2.html?id=${variant}&state=${state}${
    WITH_PANEL && state !== 'rest' ? '&panel=1' : ''
  }${SKIN_QS}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });
  await page.addStyleTag({ content: FREEZE });
  const err = await page.getAttribute('html', 'data-navx-error');
  if (err) {
    await page.close();
    return { error: err };
  }
  const res = await page.evaluate(COLLECT, '.navx');
  await page.close();
  return res;
}

const [a, b] = await Promise.all([legacy(), stage2()]);
await browser.close();

if (a.error || b.error) {
  console.error(`probe failed — legacy: ${a.error ?? 'ok'} · stage2: ${b.error ?? 'ok'}`);
  process.exit(1);
}

const byPath = new Map(b.out.map((e) => [e.path, e]));
const rows = [];
let matched = 0;
const onlyLegacy = [];

for (const l of a.out) {
  const s = byPath.get(l.path);
  if (!s) {
    onlyLegacy.push(l);
    continue;
  }
  matched++;
  byPath.delete(l.path);
  const d = { dx: s.x - l.x, dy: s.y - l.y, dw: s.w - l.w, dh: s.h - l.h };
  const worst = Math.max(...Object.values(d).map(Math.abs));
  if (worst > 1) rows.push({ l, s, ...d, worst });
}

const label = (e) => `${e.tag}.${(e.cls || '—').split(' ').slice(0, 3).join('.')}`;
const fmt = (n) => (n === 0 ? '     ·' : (n > 0 ? '+' : '') + n.toFixed(1)).padStart(7);

console.log(
  `\n${variant} @${state}${skin ? ` +${skin}` : ''} — ${matched} elements matched by path${onlyLegacy.length ? `, ${onlyLegacy.length} only in legacy` : ''}${byPath.size ? `, ${byPath.size} only in stage 2` : ''}`,
);
console.log(`${rows.length} element(s) moved or resized by >1px\n`);

if (rows.length) {
  console.log('     dx      dy      dw      dh   path            legacy → stage 2');
  for (const r of rows.sort((x, y) => y.worst - x.worst).slice(0, TOP)) {
    console.log(
      `${fmt(r.dx)} ${fmt(r.dy)} ${fmt(r.dw)} ${fmt(r.dh)}   ${r.l.path.padEnd(14)} ${label(r.l)}  [${r.l.pos}] ${r.l.x},${r.l.y} ${r.l.w}x${r.l.h} → ${r.s.x},${r.s.y} ${r.s.w}x${r.s.h}${r.l.pos === r.s.pos ? '' : ` ⚠ position ${r.l.pos}→${r.s.pos}`}`,
    );
  }
  if (rows.length > TOP) console.log(`  … ${rows.length - TOP} more`);
}

for (const l of onlyLegacy.slice(0, 10)) console.log(`  only in legacy:  ${l.path} ${label(l)}`);
for (const s of [...byPath.values()].slice(0, 10))
  console.log(`  only in stage 2: ${s.path} ${label(s)}`);
