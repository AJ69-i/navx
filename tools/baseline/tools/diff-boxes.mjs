/**
 * Where, exactly, did a render change?
 *
 * `compare-stage2.mjs` gives a percentage and `contact-sheet.mjs` gives a
 * picture; this gives coordinates. It clusters the changed pixels of a diff PNG
 * into bounding boxes so a 92-pixel difference can be located in a 1440x900
 * screenshot without squinting — and, more usefully, so the same 92 pixels
 * appearing in eighteen variants can be recognised as one shared cause.
 *
 *   node tools/diff-boxes.mjs <name> [project]
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { REPO_ROOT } from './env.mjs';

const [name, project = 'desktop'] = process.argv.slice(2);
if (!name) {
  console.error('usage: node tools/diff-boxes.mjs <name> [project]');
  process.exit(1);
}

const png = PNG.sync.read(
  await readFile(path.join(REPO_ROOT, 'reference', 'stage2', project, `${name}.diff.png`)),
);

/**
 * pixelmatch paints real differences red and anti-aliasing differences yellow.
 * The gate runs with `includeAA: false`, so only the red pixels are the ones it
 * counted — matching that here keeps this tool and the gate talking about the
 * same pixels.
 */
const changed = (i) => png.data[i] > 200 && png.data[i + 1] < 100 && png.data[i + 2] < 100;

const CELL = 12;
const cols = Math.ceil(png.width / CELL);
const rows = Math.ceil(png.height / CELL);
const grid = new Uint8Array(cols * rows);
let total = 0;

for (let y = 0; y < png.height; y++) {
  for (let x = 0; x < png.width; x++) {
    if (!changed((y * png.width + x) << 2)) continue;
    total++;
    grid[Math.floor(y / CELL) * cols + Math.floor(x / CELL)] = 1;
  }
}

/** Flood-fill adjacent occupied cells into clusters. */
const seen = new Uint8Array(cols * rows);
const boxes = [];
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const start = r * cols + c;
    if (!grid[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let x0 = c;
    let x1 = c;
    let y0 = r;
    let y1 = r;
    let cells = 0;
    while (stack.length) {
      const cur = stack.pop();
      cells++;
      const cr = Math.floor(cur / cols);
      const cc = cur % cols;
      x0 = Math.min(x0, cc);
      x1 = Math.max(x1, cc);
      y0 = Math.min(y0, cr);
      y1 = Math.max(y1, cr);
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const n = nr * cols + nc;
        if (grid[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    boxes.push({
      x: x0 * CELL,
      y: y0 * CELL,
      w: (x1 - x0 + 1) * CELL,
      h: (y1 - y0 + 1) * CELL,
      cells,
    });
  }
}

boxes.sort((a, b) => b.cells - a.cells);
console.log(`${project}/${name}: ${total} changed px in ${boxes.length} region(s)`);
for (const b of boxes.slice(0, 12)) {
  console.log(
    `  x=${b.x} y=${b.y} ${b.w}x${b.h}   crop: ${Math.max(0, b.x - 20)},${Math.max(0, b.y - 20)},${b.w + 40},${b.h + 40}`,
  );
}
