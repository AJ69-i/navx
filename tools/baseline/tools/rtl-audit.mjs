/**
 * RTL audit — the same four checks against legacy and against Stage 2.
 *
 * Stage 0 captured 112 RTL renders as a reference gallery and deliberately did
 * not assert them, because legacy has 60 physical-direction declarations and no
 * logical ones, so its Arabic layout is known-broken. A gallery proves nothing
 * on its own, though: "looks better" is not a result. These four checks are
 * mechanical, so the same script run against both stylesheets turns the claim
 * into a number.
 *
 *   1. chevron side      — the arrow must sit at the link's inline END, which
 *                          is the left in RTL. Legacy pins it with `right: 0`.
 *   2. chevron overlap   — the arrow must not sit on top of the label. This is
 *                          the specific defect: `right: 0` plus `margin-left`
 *                          puts it through the text once the direction flips.
 *   3. icon side         — a leading icon must lead, so in RTL it is the
 *                          rightmost thing in the link. Legacy's `float: left`
 *                          leaves it trailing.
 *   4. panel side        — a closed drawer must be off-canvas on the inline
 *                          start side, which in RTL is off the right edge.
 *
 *   node tools/rtl-audit.mjs [--project desktop] [--dir rtl] [--filter ex-]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { REPO_ROOT, harnessPort, paths } from './env.mjs';
import { PROJECTS, contextFor } from './projects.mjs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const PORT = harnessPort();
const DIR = argOf('dir', 'rtl');
const only = argOf('filter', null);
const projectName = argOf('project', 'desktop');
const project = PROJECTS.find((p) => p.name === projectName);
const OUT = path.join(REPO_ROOT, 'reference', 'stage2');

const manifest = JSON.parse(await readFile(path.join(paths.fixtures, 'manifest.json'), 'utf8'));

/**
 * Runs in the page. Pure geometry — no class names beyond the two roots, so the
 * identical function judges legacy and Stage 2 by the same standard.
 */
const AUDIT = ({ root, chevron, link, panel, rtl }) => {
  const nav = document.querySelector(root);
  if (!nav) return { error: `no ${root}` };

  const findings = [];
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 0.5 &&
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 0.5;

  /** Rects of the actual glyphs in an element, ignoring its children's boxes. */
  const textRects = (el) => {
    const out = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0) out.push(r);
    }
    for (const child of el.children) {
      if (child.matches(chevron)) continue;
      const r = child.getBoundingClientRect();
      if (r.width > 0 && child.tagName !== 'UL') out.push(r);
    }
    return out;
  };

  let chevrons = 0;
  let icons = 0;

  for (const arrow of nav.querySelectorAll(chevron)) {
    const parent = arrow.closest(link);
    if (!parent) continue;
    const a = arrow.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    if (!a.width || !p.width) continue;
    chevrons++;

    // 1. side: the arrow belongs at the inline end of its link.
    const arrowCentre = a.left + a.width / 2;
    const linkCentre = p.left + p.width / 2;
    const atEnd = rtl ? arrowCentre < linkCentre : arrowCentre > linkCentre;
    if (!atEnd)
      findings.push({ check: 'chevron-side', text: parent.textContent.trim().slice(0, 24) });

    // 2. overlap: the arrow must not be drawn over the label.
    if (textRects(parent).some((t) => overlap(a, t))) {
      findings.push({ check: 'chevron-overlap', text: parent.textContent.trim().slice(0, 24) });
    }
  }

  // `link` is a selector LIST, so the child combinator has to be distributed
  // across it: `a, b > i` means "every a, plus b's icons", which silently
  // matched every link as an icon and reported 299 false findings on both
  // stylesheets — a number that agreed with itself and so looked credible.
  const iconSelector = link
    .split(',')
    .map((part) => `${part.trim()} > i`)
    .join(', ');

  for (const icon of nav.querySelectorAll(iconSelector)) {
    const parent = icon.closest(link);
    const i = icon.getBoundingClientRect();
    const labels = textRects(parent);
    if (!i.width || !labels.length) continue;
    icons++;
    // 3. side: a leading icon leads — in RTL that means it is further along the
    // right than every piece of label text.
    const leads = rtl
      ? labels.every((t) => i.left >= t.left - 0.5)
      : labels.every((t) => i.right <= t.right + 0.5);
    if (!leads) findings.push({ check: 'icon-side', text: parent.textContent.trim().slice(0, 24) });
  }

  // 4. a closed drawer hides on the inline start side.
  const drawer = nav.querySelector(panel);
  if (drawer && getComputedStyle(drawer).position === 'fixed') {
    const d = drawer.getBoundingClientRect();
    const hidden = rtl ? d.left >= window.innerWidth - 1 : d.right <= 1;
    if (!hidden) findings.push({ check: 'panel-side', text: `x=${Math.round(d.left)}` });
  }

  return { findings, chevrons, icons };
};

const SELECTORS = {
  legacy: {
    root: '.navigation',
    chevron: '.submenu-indicator',
    link: '.navigation-link, .navigation-dropdown-link',
    panel: '.navigation-body',
  },
  stage2: {
    root: '.navx',
    chevron: '.navx-chevron',
    link: '.navx-link, .navx-submenu-link',
    panel: '.navx-panel',
  },
};

const browser = await chromium.launch();
const context = await browser.newContext({ ...contextFor(project) });
const rtl = DIR === 'rtl';
const totals = { legacy: {}, stage2: {} };
const perVariant = [];

const page = await context.newPage();

for (const variant of manifest.variants) {
  if (only && !variant.id.includes(only)) continue;

  const row = { id: variant.id };

  for (const side of ['legacy', 'stage2']) {
    const url =
      side === 'legacy'
        ? `http://localhost:${PORT}/harness.html?id=${variant.id}&dir=${DIR}`
        : `http://localhost:${PORT}/stage2.html?id=${variant.id}&state=${
            variant.submenuCount > 0 ? 'submenu-open' : 'rest'
          }&dir=${DIR}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });

    if (side === 'legacy' && variant.submenuCount > 0) {
      await page.evaluate(() => {
        const nav = document.querySelector('.navigation');
        if (!nav?.showSubmenu) return;
        const first = nav.querySelector('.navigation-dropdown, .navigation-megamenu');
        const trigger = first?.previousElementSibling;
        if (trigger) {
          first.parentElement?.classList.add('is-active');
          nav.showSubmenu(trigger);
        }
      });
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
    }

    const res = await page.evaluate(AUDIT, { ...SELECTORS[side], rtl });
    if (res.error) {
      row[side] = { error: res.error };
      continue;
    }
    row[side] = res;
    for (const f of res.findings) {
      totals[side][f.check] = (totals[side][f.check] ?? 0) + 1;
    }
  }

  perVariant.push(row);
}

await browser.close();

const CHECKS = ['chevron-side', 'chevron-overlap', 'icon-side', 'panel-side'];
const n = perVariant.length;

console.log(`\n${DIR.toUpperCase()} audit · ${projectName} · ${n} variants\n`);
console.log('check                legacy    stage 2');
for (const check of CHECKS) {
  const a = totals.legacy[check] ?? 0;
  const b = totals.stage2[check] ?? 0;
  const mark = b === 0 ? (a > 0 ? '  ← fixed' : '') : '  ← STILL FAILING';
  console.log(`  ${check.padEnd(18)} ${String(a).padStart(5)} ${String(b).padStart(10)}${mark}`);
}

const worst = perVariant
  .filter((r) => r.stage2?.findings?.length)
  .sort((a, b) => b.stage2.findings.length - a.stage2.findings.length);

if (worst.length) {
  console.log(`\nstage 2 findings remain in ${worst.length} variant(s):`);
  for (const r of worst.slice(0, 12)) {
    const by = r.stage2.findings.map((f) => `${f.check}:"${f.text}"`).join(', ');
    console.log(`  ${r.id}  ${by}`);
  }
}

await mkdir(OUT, { recursive: true });
await writeFile(
  path.join(OUT, `rtl-audit-${projectName}.json`),
  JSON.stringify({ dir: DIR, project: projectName, totals, perVariant }, null, 2),
);
console.log(`\nreport → ${path.join(OUT, `rtl-audit-${projectName}.json`)}`);

// Same trap as tools/assert-utilities.mjs: with no fixtures every count is
// zero and the table reads as a clean pass. Legacy is the control here — it is
// known to have arrows and a drawer, so finding none of either means the audit
// measured nothing.
const inspected = perVariant.reduce(
  (sum, r) => sum + (r.legacy?.chevrons ?? 0) + (r.legacy?.icons ?? 0),
  0,
);
if (!inspected) {
  console.error(
    '\nFAILED: no chevrons or icons found in either stylesheet — the audit ' +
      'checked nothing. Run `npm run extract` first.',
  );
  process.exit(1);
}

// A gate. Legacy's numbers are context; the new stylesheet's must be zero.
const remaining = CHECKS.reduce((sum, check) => sum + (totals.stage2[check] ?? 0), 0);
if (remaining) {
  console.error(`\nFAILED: ${remaining} ${DIR.toUpperCase()} finding(s) in the new stylesheet.`);
  process.exitCode = 1;
}
