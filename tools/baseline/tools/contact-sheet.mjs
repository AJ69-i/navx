/**
 * Triage aid — stacks baseline / actual / diff into one PNG.
 *
 * `compare-renders.mjs` tells you *how much* a render moved; this tells you
 * *what* moved. Three panes, same crop, top to bottom: the approved Stage 0
 * baseline, the Stage 2 render, and the pixelmatch diff. Cropping matters
 * because the interesting region is usually 200px tall inside a 1440x900
 * screenshot, and a full-page sheet is unreadable.
 *
 *   node tools/contact-sheet.mjs <name> [project] [x,y,w,h]
 *   node tools/contact-sheet.mjs ex-megamenu--submenu-open desktop 0,0,1440,560
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { REPO_ROOT } from './env.mjs';

const [name, project = 'desktop', cropSpec = ''] = process.argv.slice(2);
if (!name) {
  console.error('usage: node tools/contact-sheet.mjs <name> [project] [x,y,w,h]');
  process.exit(1);
}

const PLATFORM = process.platform === 'darwin' ? 'darwin' : 'linux';
const OUT = path.join(REPO_ROOT, 'reference', 'stage2', 'sheets');

const read = async (p) => PNG.sync.read(await readFile(p));
const base = await read(
  path.join(REPO_ROOT, 'tests', '__baselines__', PLATFORM, project, `${name}.png`),
);
const actual = await read(
  path.join(REPO_ROOT, 'reference', 'stage2', project, `${name}.actual.png`),
);
const diff = await read(path.join(REPO_ROOT, 'reference', 'stage2', project, `${name}.diff.png`));

let [x, y, w, h] = cropSpec ? cropSpec.split(',').map(Number) : [0, 0, base.width, base.height];
w = Math.min(w, base.width - x);
h = Math.min(h, base.height - y);

/** Opaque crop — the diff PNG has transparent regions that would read as black. */
const crop = (src) => {
  const out = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = ((y + j) * src.width + (x + i)) << 2;
      const d = (j * w + i) << 2;
      const a = src.data[s + 3] / 255;
      out.data[d] = Math.round(src.data[s] * a + 255 * (1 - a));
      out.data[d + 1] = Math.round(src.data[s + 1] * a + 255 * (1 - a));
      out.data[d + 2] = Math.round(src.data[s + 2] * a + 255 * (1 - a));
      out.data[d + 3] = 255;
    }
  }
  return out;
};

const GAP = 10;
const panes = [crop(base), crop(actual), crop(diff)];
const sheet = new PNG({ width: w, height: h * 3 + GAP * 2 });
sheet.data.fill(0x99); // grey gutters, so pane edges are visible against white UI

for (const [k, pane] of panes.entries()) {
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
const out = path.join(OUT, `${project}-${name}.sheet.png`);
await writeFile(out, PNG.sync.write(sheet));
console.log(
  `${out}\n  ${w}x${h} panes — top: ${PLATFORM} baseline · middle: stage 2 · bottom: diff`,
);
