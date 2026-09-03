/**
 * Diff the markup the two harnesses produce for the same variant.
 *
 * When a Stage 5 render differs from its baseline, the question is almost
 * always "what is in the legacy DOM that the planner does not emit, or the
 * other way round" — and answering that from a diff image is slow and
 * error-prone. This loads `stage2.html` (legacy markup, mechanically renamed)
 * and `stage5.html` (render(plan(preset, content))) for the same id and prints
 * the first structural differences between them.
 *
 *   node tools/diff-markup.mjs ex-megamenu [--selector .navx-megamenu]
 *
 * A difference here is not automatically a defect: Stage 5 deliberately
 * departs from legacy in places (a real `<button>` toggler, the disclosure
 * shape for links that own a submenu). The tool reports; the reader judges.
 */

import { chromium } from '@playwright/test';
import { harnessPort } from './env.mjs';

const PORT = harnessPort();
const id = process.argv[2];
const selArg = process.argv.indexOf('--selector');
const SELECTOR = selArg === -1 ? '.navx' : process.argv[selArg + 1];
const stateArg = process.argv.indexOf('--state');
const STATE = stateArg === -1 ? 'rest' : process.argv[stateArg + 1];

if (!id) {
  console.error(
    'usage: node tools/diff-markup.mjs <fixture-id> [--selector .navx-megamenu] [--state submenu-open]',
  );
  process.exit(2);
}

/** Attributes sorted, whitespace collapsed — differences that survive are real. */
const CANONICAL = `(root) => {
  const VOID = new Set(['img','input','br','hr','meta','link']);
  const walk = (el, depth) => {
    const attrs = [...el.attributes]
      .map((a) => [a.name, a.value])
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
      .map(([n, v]) => ' ' + n + '="' + v + '"')
      .join('');
    const tag = el.tagName.toLowerCase();
    const pad = '  '.repeat(depth);
    if (VOID.has(tag)) return [pad + '<' + tag + attrs + '>'];
    const lines = [pad + '<' + tag + attrs + '>'];
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        const t = child.textContent.replace(/\\s+/g, ' ').trim();
        if (t) lines.push('  '.repeat(depth + 1) + JSON.stringify(t));
      } else if (child.nodeType === 1) {
        lines.push(...walk(child, depth + 1));
      }
    }
    return lines;
  };
  return walk(root, 0);
}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const dump = async (harness) => {
  await page.goto(`http://localhost:${PORT}/${harness}.html?id=${id}&state=${STATE}`, {
    waitUntil: 'load',
  });
  await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });
  const error = await page.getAttribute('html', 'data-navx-error');
  if (error) throw new Error(`${harness}: ${error}`);
  return page.$eval(SELECTOR, new Function(`return ${CANONICAL}`)());
};

const a = await dump('stage2');
const b = await dump('stage5');
await browser.close();

console.log(`\n${id} · ${SELECTOR} · ${STATE}\n`);
console.log(`  stage2 (legacy, renamed)  ${a.length} lines`);
console.log(`  stage5 (planner)          ${b.length} lines\n`);

let shown = 0;
const max = Math.max(a.length, b.length);
for (let i = 0; i < max && shown < 40; i++) {
  if (a[i] === b[i]) continue;
  console.log(`  line ${i}`);
  console.log(`    legacy : ${a[i] ?? '(none)'}`);
  console.log(`    planner: ${b[i] ?? '(none)'}`);
  shown++;
}

if (shown === 0) console.log('  identical.\n');
else console.log(`\n  ${shown} differing line(s) shown.\n`);
