/**
 * Do the visibility utilities actually win?
 *
 * Legacy spent `display: none !important` on `.hide-on-landscape` and
 * `.hide-on-portrait` because they had to beat rules like
 * `.navigation-logo a { display: flex }` from a single class. Dropping the
 * `!important` only works if nothing in the stylesheet outranks a one-class
 * utility on `display` — which is a property of the whole file, not of the
 * utility rule, and therefore worth asserting rather than assuming. It has
 * already been wrong once: `.navx-logo > a` at (0,1,1) silently kept a hidden
 * logo visible in panel mode.
 *
 *   node tools/assert-utilities.mjs
 */

import { chromium } from '@playwright/test';
import { harnessPort } from './env.mjs';
import { PROJECTS, contextFor } from './projects.mjs';

const PORT = harnessPort();

/** Every element kind a consumer could reasonably hide. */
const TARGETS = [
  '.navx-item',
  '.navx-link',
  '.navx-menu',
  '.navx-logo',
  '.navx-logo > a',
  '.navx-social',
  '.navx-social .navx-item',
  '.navx-submenu-item',
  '.navx-submenu-link',
  '.navx-brand',
  '.navx-btn',
  '.navx-form',
  '.navx-badge',
];

/**
 * Fixtures chosen to cover every target between them: ex-hover carries the
 * logo, social row, icon items and three submenu levels; navigation10 the
 * button and the inline form; navigation1 the text brand; navigation43 a badge.
 */
const FIXTURES = [
  { id: 'ex-hover', state: 'submenu-nested' },
  { id: 'navigation10', state: 'rest' },
  { id: 'navigation1', state: 'rest' },
  { id: 'navigation43', state: 'rest' },
];

const CASES = [
  { project: 'desktop', utility: 'navx-hide-in-bar', mode: 'bar' },
  { project: 'mobile', utility: 'navx-hide-in-panel', mode: 'panel' },
];

const browser = await chromium.launch();
let failures = 0;
let checked = 0;

for (const { project, utility, mode } of CASES) {
  const profile = PROJECTS.find((p) => p.name === project);
  const context = await browser.newContext(contextFor(profile));
  const page = await context.newPage();

  /** selector → 'none' when hidden somewhere, else the display that beat it. */
  const seen = new Map();

  for (const fixture of FIXTURES) {
    await page.goto(
      `http://localhost:${PORT}/stage2.html?id=${fixture.id}&state=${fixture.state}${
        project === 'mobile' && fixture.state !== 'rest' ? '&panel=1' : ''
      }`,
      { waitUntil: 'load' },
    );
    await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });

    const results = await page.evaluate(
      ({ targets, utility }) =>
        targets.map((selector) => {
          const el = document.querySelector(`.navx ${selector}`);
          if (!el) return { selector, skipped: true };
          el.classList.add(utility);
          const display = getComputedStyle(el).display;
          el.classList.remove(utility);
          return { selector, display };
        }),
      { targets: TARGETS, utility },
    );

    for (const r of results) {
      if (r.skipped) continue;
      const prior = seen.get(r.selector);
      // A single failure anywhere is a failure; only record 'none' if nothing
      // has already outranked the utility for this selector.
      if (prior === undefined || prior === 'none') seen.set(r.selector, r.display);
      if (r.display !== 'none') seen.set(r.selector, `${r.display} (${fixture.id})`);
    }
  }

  console.log(`\n${mode} mode — .${utility} on:`);
  for (const selector of TARGETS) {
    const display = seen.get(selector);
    if (display === undefined) {
      console.log(`  ·    ${selector}  (not present in any fixture)`);
      continue;
    }
    checked++;
    const ok = display === 'none';
    if (!ok) failures++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${selector}${ok ? '' : `  → display: ${display}`}`);
  }

  await context.close();
}

await browser.close();

if (failures) {
  console.error(
    `\n${failures} element(s) outrank a one-class visibility utility — the utility would need \`!important\` to work there. Lower the offending rule with \`:where()\`.`,
  );
  process.exit(1);
}

/**
 * An assertion that asserted nothing is a failure, not a pass.
 *
 * Without this the script found every target "not present in any fixture" —
 * because the fixtures had not been extracted — and still printed a success
 * line and exited 0. A green tick for zero checks is the most expensive kind
 * of bug in a test suite, because it is the one nobody investigates.
 */
if (!checked) {
  console.error(
    '\nFAILED: nothing was checked. The fixtures are missing or the harness ' +
      'served no markup — run `npm run extract` first.',
  );
  process.exit(1);
}

console.log(`\n${checked} target(s) hide from a single class, with no !important.`);
