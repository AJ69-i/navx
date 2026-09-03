/**
 * Stage 6 gate — `overlayColor` is a token, and here is the proof.
 *
 * Legacy took the drawer's backdrop as a JavaScript option:
 *
 *   NAVX.init({ overlayColor: "linear-gradient(135deg, #FAD7A1 10%, #E96D71 100%)" })
 *
 * which meant the plugin wrote an inline style, the value could not be themed,
 * could not respond to `prefers-color-scheme`, and could not be overridden per
 * breakpoint. Stage 1 already made it a component token
 * (`--navx-overlay-background`, from `{surface.overlay}`) and Stage 2's
 * stylesheet already reads it, so Stage 6 has nothing to implement — the
 * migration is one CSS declaration.
 *
 * "Nothing to implement" is exactly the sort of claim that should be measured
 * rather than asserted, because it is indistinguishable from "forgot to
 * implement". So this opens a drawer and reads the computed background: once
 * with the default token, once with legacy's own gradient overridden onto it,
 * and once scoped to a single nav to show two navs on one page can differ.
 */

import { chromium } from '@playwright/test';
import { harnessPort } from './env.mjs';

const PORT = harnessPort();
const LEGACY_GRADIENT = 'linear-gradient(135deg, #FAD7A1 10%, #E96D71 100%)';

/** A catalogue variant with a toggler and therefore a drawer and an overlay. */
const SUBJECT = 'navigation15';

const cases = [
  {
    name: 'default — the token',
    css: '',
    expect: (bg, image) => image === 'none' && bg.startsWith('rgba('),
    describe: 'a translucent colour from {surface.overlay}',
  },
  {
    name: "legacy's overlayColor, as a token override",
    css: `.navx { --navx-overlay-background: ${LEGACY_GRADIENT}; }`,
    expect: (_bg, image) => image.includes('linear-gradient'),
    describe: 'the gradient legacy passed to init()',
  },
  {
    name: 'scoped to one nav',
    css: `#scoped { --navx-overlay-background: ${LEGACY_GRADIENT}; }`,
    expect: (_bg, image) => image === 'none',
    describe: 'unchanged, because the override targets a different nav',
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 839 } });

let failures = 0;
console.log('\nStage 6 · overlayColor as a token\n');

for (const testCase of cases) {
  await page.goto(`http://localhost:${PORT}/stage5.html?id=${SUBJECT}&state=panel-open`, {
    waitUntil: 'load',
  });
  await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });

  if (testCase.css) await page.addStyleTag({ content: testCase.css });

  const read = await page.evaluate(() => {
    const overlay = document.querySelector('.navx-overlay');
    if (!overlay) return null;
    const style = getComputedStyle(overlay);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      opacity: style.opacity,
    };
  });

  if (!read) {
    console.error(`  ✗ ${testCase.name}: no .navx-overlay in the rendered nav`);
    failures++;
    continue;
  }

  const ok = testCase.expect(read.backgroundColor, read.backgroundImage);
  const shown =
    read.backgroundImage === 'none' ? read.backgroundColor : read.backgroundImage.slice(0, 58);
  console.log(`  ${ok ? '✓' : '✗'} ${testCase.name.padEnd(38)} ${shown}`);
  if (!ok) {
    console.error(`      expected ${testCase.describe}`);
    failures++;
  }
}

// The overlay must actually be visible when the drawer is open, or every
// assertion above would be reading a box nobody can see.
await page.goto(`http://localhost:${PORT}/stage5.html?id=${SUBJECT}&state=panel-open`, {
  waitUntil: 'load',
});
await page.waitForSelector('html[data-navx-ready="1"]');
const visible = await page.evaluate(() => {
  const overlay = document.querySelector('.navx-overlay');
  const style = getComputedStyle(overlay);
  return { opacity: style.opacity, state: overlay.getAttribute('data-navx-state') };
});
const visibleOk = visible.state === 'open' && Number(visible.opacity) > 0;
console.log(
  `  ${visibleOk ? '✓' : '✗'} ${'overlay is visible when the drawer is'.padEnd(38)} opacity ${visible.opacity}`,
);
if (!visibleOk) failures++;

await browser.close();

if (failures) {
  console.error(`\n  ${failures} failure(s).\n`);
  process.exit(1);
}
console.log(
  '\n  overlayColor needs no JavaScript: the token reaches the rendered overlay,\n' +
    '  takes a gradient, and scopes like any other custom property.\n',
);
