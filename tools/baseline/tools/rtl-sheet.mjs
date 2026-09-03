/**
 * RTL before/after — legacy's Arabic render above Stage 2's, same variant.
 *
 * The numbers live in `rtl-audit.mjs`; this is the picture that goes with them.
 * The top pane is the Stage 0 RTL reference (captured, never asserted, because
 * legacy's Arabic layout is known-broken); the bottom is the same variant
 * through the new stylesheet.
 *
 *   node tools/rtl-sheet.mjs <variant> [project] [x,y,w,h]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { REPO_ROOT, harnessPort } from './env.mjs';
import { PROJECTS, contextFor } from './projects.mjs';

const [variant, projectName = 'mobile', cropSpec = ''] = process.argv.slice(2);
if (!variant) {
  console.error('usage: node tools/rtl-sheet.mjs <variant> [project] [x,y,w,h]');
  process.exit(1);
}

const PORT = harnessPort();
const project = PROJECTS.find((p) => p.name === projectName);
const OUT = path.join(REPO_ROOT, 'reference', 'stage2', 'sheets');

const before = PNG.sync.read(
  await readFile(path.join(REPO_ROOT, 'reference', 'rtl', projectName, `${variant}.png`)),
);

/** Mirrors what the Stage 0 RTL spec did: open the panel on mobile, else a submenu. */
const browser = await chromium.launch();
const context = await browser.newContext(contextFor(project));
const page = await context.newPage();
const state = projectName === 'mobile' ? 'panel-open' : 'submenu-open';
await page.goto(`http://localhost:${PORT}/stage2.html?id=${variant}&state=${state}&dir=rtl`, {
  waitUntil: 'load',
});
await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });
const after = PNG.sync.read(await page.screenshot({ animations: 'disabled' }));
await browser.close();

let [x, y, w, h] = cropSpec ? cropSpec.split(',').map(Number) : [0, 0, before.width, before.height];
w = Math.min(w, before.width - x, after.width - x);
h = Math.min(h, before.height - y, after.height - y);

const crop = (src) => {
  const out = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = ((y + j) * src.width + (x + i)) << 2;
      const d = (j * w + i) << 2;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = 255;
    }
  }
  return out;
};

const GAP = 10;
const sheet = new PNG({ width: w, height: h * 2 + GAP });
sheet.data.fill(0x99);
for (const [k, pane] of [crop(before), crop(after)].entries()) {
  const oy = k * (h + GAP);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = (j * w + i) << 2;
      const d = ((oy + j) * w + i) << 2;
      sheet.data[d] = pane.data[s];
      sheet.data[d + 1] = pane.data[s + 1];
      sheet.data[d + 2] = pane.data[s + 2];
      sheet.data[d + 3] = 255;
    }
  }
}

await mkdir(OUT, { recursive: true });
const out = path.join(OUT, `rtl-${projectName}-${variant}.sheet.png`);
await writeFile(out, PNG.sync.write(sheet));
console.log(`${out}\n  top: legacy RTL · bottom: stage 2 RTL (${w}x${h})`);
