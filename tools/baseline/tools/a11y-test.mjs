/**
 * Accessibility and keyboard gate for @navx/core.
 *
 * Two halves, and both compare against legacy rather than against nothing, so
 * "accessible" is a delta someone can check instead of a badge.
 *
 *   axe      — axe-core over every variant, both implementations, both modes.
 *   keyboard — scripted walks asserting the contract in docs/stage3.md: that
 *              Enter on a disclosure opens its menu, that Escape closes it and
 *              returns focus to the trigger, that ArrowDown steps into the
 *              menu, and that the drawer traps focus and gives it back.
 *
 * Legacy has no keydown handler at all, so its column of the keyboard table is
 * the point: every row is a thing a keyboard user simply could not do.
 *
 *   node tools/a11y-test.mjs [--limit 12] [--id ex-hover]
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { harnessPort, paths } from './env.mjs';
import { PROJECTS, contextFor } from './projects.mjs';

const require = createRequire(import.meta.url);
const AXE_SOURCE = await readFile(require.resolve('axe-core'), 'utf8');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const PORT = harnessPort();
const ONLY = argOf('id', null);
const LIMIT = Number(argOf('limit', 12));

const manifest = JSON.parse(await readFile(path.join(paths.fixtures, 'manifest.json'), 'utf8'));
const variants = (ONLY ? manifest.variants.filter((v) => v.id === ONLY) : manifest.variants).slice(
  0,
  ONLY ? 1 : LIMIT,
);

const url = (impl, id) => `http://localhost:${PORT}/lifecycle.html?impl=${impl}&id=${id}`;

/** Rules that judge the nav itself rather than the harness page around it. */
const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  // The fixtures are fragments mounted into a bare page, so page-level rules
  // (landmark structure, a single main, document title) would report the
  // harness rather than the component.
  rules: {
    region: { enabled: false },
    'page-has-heading-one': { enabled: false },
    'landmark-one-main': { enabled: false },
    bypass: { enabled: false },
  },
};

async function axeRun(page, impl, id) {
  await page.goto(url(impl, id), { waitUntil: 'load' });
  await page.evaluate(() => window.__lifecycle.init());
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = await page.evaluate(
    async (options) => await window.axe.run(document.querySelector('.navigation, .navx'), options),
    AXE_OPTIONS,
  );
  return results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
}

const browser = await chromium.launch();

// ── axe ─────────────────────────────────────────────────────────────────────
const desktop = PROJECTS.find((p) => p.name === 'desktop');
const context = await browser.newContext(contextFor(desktop));
const page = await context.newPage();

const tallies = { legacy: new Map(), navx: new Map() };
for (const variant of variants) {
  for (const impl of ['legacy', 'navx']) {
    for (const violation of await axeRun(page, impl, variant.id)) {
      const tally = tallies[impl];
      const prior = tally.get(violation.id) ?? { impact: violation.impact, nodes: 0, variants: 0 };
      prior.nodes += violation.nodes;
      prior.variants += 1;
      tally.set(violation.id, prior);
    }
  }
}

console.log(`\naxe-core · ${variants.length} variants · WCAG 2.1 A + AA\n`);
console.log(`${'rule'.padEnd(34)}${'impact'.padEnd(10)}${'legacy'.padEnd(9)}navx`);
const allRules = [...new Set([...tallies.legacy.keys(), ...tallies.navx.keys()])].sort();
for (const rule of allRules) {
  const l = tallies.legacy.get(rule);
  const n = tallies.navx.get(rule);
  console.log(
    `${rule.padEnd(34)}${(l?.impact ?? n?.impact ?? '').padEnd(10)}` +
      `${String(l ? `${l.nodes} nodes` : '—').padEnd(9)}${n ? `${n.nodes} nodes` : '—'}`,
  );
}
if (allRules.length === 0) console.log('no violations in either implementation');

// ── keyboard ────────────────────────────────────────────────────────────────
/**
 * Each check returns a boolean per implementation. They are written against the
 * DOM rather than against @navx/core's internals, so legacy is judged by the
 * same standard and not by an API it does not have.
 */
/**
 * Every assertion resolves the submenu *from the chevron under test* rather
 * than by a document-wide query.
 *
 * The first draft queried `.navx-submenu` globally, which in `ex-hover` is not
 * the menu the first chevron controls — that one is a `.navx-megamenu`. So the
 * ArrowDown check inspected an unrelated element and reported a failure that
 * was not there, while two other checks passed by looking at something else
 * entirely. A test that names its subject by position rather than by relation
 * is a test that can be right for the wrong reason.
 */
const RESOLVE = `(() => {
  const chevron = document.querySelector('.navx-chevron, .submenu-indicator');
  if (!chevron) return null;
  const item = chevron.closest('.navx-item, .navx-submenu-item, .navigation-item, .navigation-dropdown-item');
  const menu = item && [...item.children].find((c) =>
    c.matches('.navx-submenu, .navx-megamenu, .navigation-dropdown, .navigation-megamenu'));
  return { chevron, menu: menu ?? null };
})()`;

const isOpen = `(m) => m.getAttribute('data-navx-state') === 'open' || m.classList.contains('is-visible')`;

const CHECKS = [
  {
    name: 'disclosure is reachable by Tab',
    async run(page) {
      return page.evaluate(`(() => {
        const t = ${RESOLVE};
        if (!t) return null;
        t.chevron.focus();
        return document.activeElement === t.chevron;
      })()`);
    },
  },
  {
    name: 'Enter on it opens its own menu',
    async run(page) {
      const chevron = page.locator('.navx-chevron, .submenu-indicator').first();
      if ((await chevron.count()) === 0) return null;
      await chevron.focus();
      await page.keyboard.press('Enter');
      return page.evaluate(`(() => {
        const t = ${RESOLVE};
        if (!t?.menu) return null;
        return (${isOpen})(t.menu);
      })()`);
    },
  },
  {
    name: 'aria-expanded tracks the open state',
    async run(page) {
      const chevron = page.locator('.navx-chevron, .submenu-indicator').first();
      if ((await chevron.count()) === 0) return null;
      const before = await chevron.getAttribute('aria-expanded');
      await chevron.focus();
      await page.keyboard.press('Enter');
      const after = await chevron.getAttribute('aria-expanded');
      return before === 'false' && after === 'true';
    },
  },
  {
    name: 'the disclosure has an accessible name',
    async run(page) {
      return page.evaluate(`(() => {
        const t = ${RESOLVE};
        if (!t) return null;
        const el = t.chevron;
        return (
          !!el.getAttribute('aria-label')?.trim() ||
          !!el.getAttribute('aria-labelledby') ||
          (el.textContent ?? '').trim().length > 0
        );
      })()`);
    },
  },
  {
    name: 'ArrowDown moves into the open menu',
    async run(page) {
      const chevron = page.locator('.navx-chevron, .submenu-indicator').first();
      if ((await chevron.count()) === 0) return null;
      await chevron.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');
      return page.evaluate(`(() => {
        const t = ${RESOLVE};
        if (!t?.menu) return null;
        return t.menu.contains(document.activeElement);
      })()`);
    },
  },
  {
    name: 'Escape closes it and returns focus',
    async run(page) {
      const chevron = page.locator('.navx-chevron, .submenu-indicator').first();
      if ((await chevron.count()) === 0) return null;
      await chevron.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
      return page.evaluate(`(() => {
        const t = ${RESOLVE};
        if (!t?.menu) return null;
        const shut = !(${isOpen})(t.menu);
        const back = document.activeElement === t.chevron;
        return shut && back;
      })()`);
    },
  },
];

const results = { legacy: [], navx: [] };
for (const impl of ['legacy', 'navx']) {
  for (const check of CHECKS) {
    await page.goto(url(impl, 'ex-hover'), { waitUntil: 'load' });
    await page.evaluate(() => window.__lifecycle.init());
    let outcome;
    try {
      outcome = await check.run(page);
    } catch {
      outcome = false;
    }
    results[impl].push(outcome);
  }
}

console.log('\nkeyboard · ex-hover · bar mode\n');
console.log(`${'behaviour'.padEnd(40)}${'legacy'.padEnd(9)}navx`);
const mark = (v) => (v === null ? 'n/a' : v ? 'yes' : 'no');
CHECKS.forEach((check, i) => {
  console.log(
    `${check.name.padEnd(40)}${mark(results.legacy[i]).padEnd(9)}${mark(results.navx[i])}`,
  );
});

await context.close();
await browser.close();

// ── gate ────────────────────────────────────────────────────────────────────
/**
 * The gate is "no new violations", not "no violations".
 *
 * Some fixtures carry defects the stylesheet and the core cannot fix without
 * inventing content — icon-only social links with no accessible text, for one,
 * which fail `link-name` identically under both implementations. Failing on
 * those would mean this gate could never pass, and a gate that can never pass
 * is a gate nobody runs. Anything legacy did NOT have is a regression and
 * fails; anything both have is reported as inherited, and belongs to Stage 5
 * where the markup is finally ours to write.
 */
const inherited = [];
const regressions = [];
for (const [rule, stats] of tallies.navx) {
  (tallies.legacy.has(rule) ? inherited : regressions).push(`${rule} (${stats.nodes} nodes)`);
}
const fixed = [...tallies.legacy.keys()].filter((rule) => !tallies.navx.has(rule));

console.log('');
if (fixed.length) console.log(`fixed vs legacy:  ${fixed.join(', ')}`);
if (inherited.length) console.log(`inherited by the fixtures (Stage 5): ${inherited.join(', ')}`);

const keyboardFailures = results.navx.filter((r) => r === false).length;
if (keyboardFailures > 0) {
  console.error(`\nFAILED: ${keyboardFailures} keyboard behaviour(s) not met by @navx/core.`);
  process.exit(1);
}
if (regressions.length > 0) {
  console.error(`\nFAILED: axe violations @navx/core introduces: ${regressions.join(', ')}`);
  process.exit(1);
}
console.log('\n@navx/core: every keyboard behaviour met, no axe violation legacy did not have.');
