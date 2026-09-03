/**
 * Stage 2 gate — the new stylesheet against the Stage 0 baselines.
 *
 * Renders every variant and state through the Stage 2 harness (new tokens, new
 * stylesheet, legacy markup put through the mechanical transform) and diffs the
 * result against the approved Stage 0 PNG for the same variant, state and
 * viewport.
 *
 * This deliberately does NOT use `toHaveScreenshot`. A pass/fail per test tells
 * you nothing useful when the whole stylesheet was rewritten — what is needed is
 * a ranked list of how much each render moved, so every difference can be
 * triaged as either a regression to fix or an improvement to approve. The
 * baselines are read, never written: Stage 0's snapshots stay authoritative.
 *
 *   node tools/compare-renders.mjs --harness stage2 [--project desktop] [--filter navigation1]
 *   node tools/compare-renders.mjs --harness stage5
 *
 * `--harness` chooses which page renders the nav, and that is the only
 * difference between the two gates:
 *
 *   stage2  a legacy fixture with its classes mechanically rewritten. Proves
 *           the stylesheet reproduces the approved screenshots given legacy's
 *           own markup.
 *   stage5  render(plan(preset, content)) from the published packages. Proves
 *           the markup NAVX *generates* from a 155-byte preset reproduces them
 *           too — which is the promise `<Navx preset={…}/>` actually makes.
 *
 * One tool rather than two near-identical ones, because the value here is that
 * both gates compare against the same authoritative baselines with the same
 * tolerances. Two copies would drift and the comparison between them would
 * quietly stop meaning anything.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { REPO_ROOT, harnessPort, paths } from './env.mjs';
import { PROJECTS, contextFor } from './projects.mjs';

const PORT = harnessPort();
const PLATFORM = process.platform === 'darwin' ? 'darwin' : 'linux';
const BASELINES = path.join(REPO_ROOT, 'tests', '__baselines__', PLATFORM);
const HARNESS = (() => {
  const i = process.argv.indexOf('--harness');
  const value = i === -1 ? 'stage2' : process.argv[i + 1];
  if (value !== 'stage2' && value !== 'stage5') {
    console.error(`--harness must be stage2 or stage5, got ${JSON.stringify(value)}`);
    process.exit(2);
  }
  return value;
})();
const OUT = path.join(REPO_ROOT, 'reference', HARNESS);

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const only = argOf('filter');
const onlyProject = argOf('project');
const MAX_RATIO = Number(argOf('max') ?? 0.002);

// Imported, never restated: the comparison is meaningless unless the render
// conditions are identical to the ones that produced the baseline.

const manifest = JSON.parse(await readFile(path.join(paths.fixtures, 'manifest.json'), 'utf8'));

/** Mirrors the Stage 0 spec's skin matrix exactly. */
const SKINS = [
  'border-top',
  'border-bottom',
  'border-top-bottom',
  'boxed',
  'rounded-boxed',
  'colored',
  'gradient',
  'mini-circle',
  'bottom-arrow',
  'dark',
];
const SKIN_SUBJECTS = ['navigation13', 'navigation43', 'ex-hover'];

/**
 * The exact (state → baseline filename) pairs Stage 0 captured.
 *
 * `panel` carries the one project-dependent step from that spec: on mobile it
 * opens the off-canvas drawer before opening a submenu, because a submenu
 * inside a closed drawer is not a state worth a snapshot. Omitting it here
 * compared an open drawer against a closed one and read as a 51% regression.
 */
function statesFor(variant, project) {
  const out = [{ state: 'rest', name: `${variant.id}--rest` }];

  // The skins matrix is where Stage 1's token layer is actually proved: ten
  // legacy stylesheets replaced by ten token overlays, on the same three
  // subjects the Stage 0 spec used. Desktop only, because skins are colour.
  if (project === 'desktop' && SKIN_SUBJECTS.includes(variant.id)) {
    for (const skin of SKINS) {
      out.push({ state: 'rest', skin, name: `${variant.id}--skin-${skin}` });
    }
  }

  // Stage 0 captured `panel-open` in the layout corpus only, so asking for it
  // in the behaviour corpus just finds ten missing files.
  if (project === 'mobile' && variant.corpus === 'layout' && variant.hasToggler) {
    out.push({ state: 'panel-open', name: `${variant.id}--panel-open` });
  }
  const panel = project === 'mobile';
  if (variant.corpus === 'behaviour' && variant.submenuCount > 0) {
    out.push({ state: 'submenu-open', name: `${variant.id}--submenu-open`, panel });
  }
  if (variant.corpus === 'behaviour' && variant.maxSubmenuDepth > 1) {
    out.push({ state: 'submenu-nested', name: `${variant.id}--submenu-nested`, panel });
  }
  return out;
}

const diffPng = (a, b) => {
  if (a.width !== b.width || a.height !== b.height) return null;
  const diff = new PNG({ width: a.width, height: a.height });
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.15,
    includeAA: false,
  });
  return { changed, ratio: changed / (a.width * a.height), png: diff };
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  const missingNames = [];

  for (const project of PROJECTS) {
    if (onlyProject && project.name !== onlyProject) continue;

    const context = await browser.newContext(contextFor(project));
    const page = await context.newPage();

    for (const variant of manifest.variants) {
      if (only && !variant.id.includes(only)) continue;

      for (const { state, name, panel, skin } of statesFor(variant, project.name)) {
        const baselinePath = path.join(BASELINES, project.name, `${name}.png`);
        if (!existsSync(baselinePath)) {
          // Stage 0 captured no baseline here, which is information rather than
          // an error: the ten gaps are all mobile `panel-open` on variants
          // where the legacy plugin failed to initialise (audit defect #3), so
          // there is nothing approved to compare against.
          missingNames.push(`${project.name}/${name}`);
          continue;
        }

        const url = `http://localhost:${PORT}/${HARNESS}.html?id=${variant.id}&state=${state}${
          panel ? '&panel=1' : ''
        }${skin ? `&skin=${skin}` : ''}`;
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });

        const err = await page.getAttribute('html', 'data-navx-error');
        if (err) {
          results.push({ project: project.name, name, error: err });
          continue;
        }

        const shot = PNG.sync.read(await page.screenshot({ animations: 'disabled' }));
        const base = PNG.sync.read(await readFile(baselinePath));
        const d = diffPng(base, shot);

        if (!d) {
          results.push({
            project: project.name,
            name,
            error: `size mismatch ${base.width}x${base.height} vs ${shot.width}x${shot.height}`,
          });
          continue;
        }

        results.push({ project: project.name, name, changed: d.changed, ratio: d.ratio });

        // Written for every render that moved at all, and deleted for every one
        // that did not. A stale diff image from an earlier run is worse than no
        // image: triage reads it as current and chases a fixed bug.
        const dir = path.join(OUT, project.name);
        await mkdir(dir, { recursive: true });
        const diffPath = path.join(dir, `${name}.diff.png`);
        const actualPath = path.join(dir, `${name}.actual.png`);
        if (d.changed > 0) {
          await writeFile(diffPath, PNG.sync.write(d.png));
          await writeFile(actualPath, PNG.sync.write(shot));
        } else {
          await rm(diffPath, { force: true });
          await rm(actualPath, { force: true });
        }
      }
    }
    await context.close();
  }

  await browser.close();

  // ── report ────────────────────────────────────────────────────────────────
  const errors = results.filter((r) => r.error);
  const compared = results.filter((r) => !r.error);
  const identical = compared.filter((r) => r.ratio === 0);
  const trivial = compared.filter((r) => r.ratio > 0 && r.ratio <= MAX_RATIO);
  const notable = compared.filter((r) => r.ratio > MAX_RATIO);

  console.log(
    `\n[${HARNESS}] compared ${compared.length} renders against ${PLATFORM} baselines${missingNames.length ? ` (${missingNames.length} with no Stage 0 baseline)` : ''}`,
  );
  console.log(`  identical (0 px)      ${identical.length}`);
  const pct = `${(MAX_RATIO * 100).toFixed(1)}%`;
  console.log(`  ≤${pct} of pixels       ${trivial.length}`);
  console.log(`  >${pct} of pixels       ${notable.length}`);
  console.log(`  errored               ${errors.length}`);

  if (missingNames.length) {
    console.log(`\nno Stage 0 baseline (skipped): ${missingNames.join(', ')}`);
  }

  if (errors.length) {
    console.log('\nerrors:');
    for (const e of errors.slice(0, 15)) console.log(`  ${e.project}/${e.name}: ${e.error}`);
  }

  if (notable.length) {
    console.log('\nlargest differences:');
    for (const r of notable.sort((a, b) => b.ratio - a.ratio).slice(0, 25)) {
      console.log(`  ${(r.ratio * 100).toFixed(2).padStart(6)}%  ${r.project}/${r.name}`);
    }
  }

  await writeFile(
    path.join(OUT, 'report.json'),
    JSON.stringify({ platform: PLATFORM, generatedAt: new Date().toISOString(), results }, null, 2),
  );
  console.log(`\ndiff images and report → ${OUT}`);

  // A gate, not just a report. The threshold matches the Stage 0 config's own
  // `maxDiffPixelRatio`, so CI holds Stage 2 to the same tolerance Stage 0
  // holds itself to between reruns.
  if (errors.length || notable.length) {
    console.error(
      `\nFAILED: ${errors.length} error(s) and ${notable.length} render(s) over ${(MAX_RATIO * 100).toFixed(1)}%. Triage each one, then either fix it or record it in docs/stage2.md as approved.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
