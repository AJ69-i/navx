/**
 * Bump every package to one version.
 *
 *   node scripts/set-version.mjs 1.0.1
 *
 * Lockstep means ten manifests have to agree, and the release workflow refuses
 * a tag whose number disagrees with any of them. Editing ten files by hand is
 * how nine of them agree.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('usage: node scripts/set-version.mjs <semver>   e.g. 1.0.1, 1.1.0-rc.1');
  process.exit(2);
}

const write = (file, json) => writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);

const root = join(REPO, 'package.json');
const rootJson = JSON.parse(readFileSync(root, 'utf8'));
rootJson.version = version;
write(root, rootJson);

for (const name of readdirSync(join(REPO, 'packages')).sort()) {
  const file = join(REPO, 'packages', name, 'package.json');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = version;
  write(file, json);
  console.log(`  ${json.name.padEnd(16)} ${version}`);
}

/**
 * Format what we just wrote.
 *
 * `JSON.stringify(…, null, 2)` expands every array one element per line and
 * the repo's formatter collapses short ones, so a script that writes JSON and
 * stops leaves `pnpm verify` red. This project has hit that four times — the
 * tokens build, the preset extractor, the attribution sweep, and the first
 * draft of this file, which printed a *reminder* to run the formatter instead
 * of running it. A step you have to remember is a step that gets skipped.
 */
try {
  execFileSync('pnpm', ['exec', 'biome', 'check', '--write', 'package.json', 'packages'], {
    cwd: REPO,
    stdio: 'pipe',
  });
  console.log('\nformatted');
} catch {
  console.error('\nbiome could not run — format before committing:');
  console.error('  pnpm exec biome check --write .');
  process.exit(1);
}

console.log(`root and ${readdirSync(join(REPO, 'packages')).length} packages at ${version}`);
