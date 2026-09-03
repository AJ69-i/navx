/**
 * What colour changed?
 *
 * When two renders have identical geometry but differ on the glyphs, the answer
 * is a colour, a weight or a sub-pixel offset — and the fastest way to tell
 * which is to read the actual pixel pairs. This lists the most common
 * baseline → actual pixel substitutions for one render, so a wrong token shows
 * up as a single dominant pair and a text shift shows up as a long tail.
 *
 *   node tools/diff-colours.mjs <name> [project]
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { REPO_ROOT } from './env.mjs';

const [name, project = 'desktop'] = process.argv.slice(2);
if (!name) {
  console.error('usage: node tools/diff-colours.mjs <name> [project]');
  process.exit(1);
}

const PLATFORM = process.platform === 'darwin' ? 'darwin' : 'linux';
const read = async (p) => PNG.sync.read(await readFile(p));
const base = await read(
  path.join(REPO_ROOT, 'tests', '__baselines__', PLATFORM, project, `${name}.png`),
);
const actual = await read(
  path.join(REPO_ROOT, 'reference', 'stage2', project, `${name}.actual.png`),
);

if (base.width !== actual.width || base.height !== actual.height) {
  console.error('size mismatch');
  process.exit(1);
}

const px = (img, i) => `${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`;
const pairs = new Map();
let differing = 0;

for (let i = 0; i < base.data.length; i += 4) {
  const a = px(base, i);
  const b = px(actual, i);
  if (a === b) continue;
  differing++;
  const key = `${a} → ${b}`;
  pairs.set(key, (pairs.get(key) ?? 0) + 1);
}

const rows = [...pairs.entries()].sort((x, y) => y[1] - x[1]);
console.log(
  `${project}/${name}: ${differing} pixels differ, ${rows.length} distinct substitutions`,
);
console.log('(a single dominant pair means a wrong colour token; a long tail means a shift)\n');
for (const [pair, n] of rows.slice(0, 15)) {
  console.log(`  ${String(n).padStart(6)}×  ${pair}`);
}
