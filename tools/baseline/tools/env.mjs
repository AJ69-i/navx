/**
 * Configuration resolution for the baseline harness.
 *
 * Every entry point (extractor, server, Playwright config) goes through here so
 * they can never disagree about where the legacy tree is, and so paths do not
 * depend on the directory the command was run from.
 *
 * Resolution order for the legacy root, first one that actually *looks* like
 * the legacy tree wins:
 *
 *   1. NAVX_LEGACY_ROOT in the real environment
 *   2. NAVX_LEGACY_ROOT in .env at the repo root
 *   3. the repo's parent directory  ← the default layout: NAVX/navx/
 *
 * Each candidate is validated rather than trusted, so a stale .env from another
 * machine falls through to a working default instead of failing the run.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Minimal .env reader. Real environment variables always win over the file. */
function loadDotEnv() {
  const file = path.join(REPO_ROOT, '.env');
  if (!existsSync(file)) return;

  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

/** A directory is the legacy tree only if the two files we actually read are in it. */
function isLegacyTree(dir) {
  const required = [
    ['Catalogue', 'catalogue.html'],
    ['Files', 'css', 'navigation.css'],
    ['Files', 'js', 'navigation.js'],
  ];
  return required.every((parts) => {
    try {
      return statSync(path.join(dir, ...parts)).isFile();
    } catch {
      return false;
    }
  });
}

let cached = null;

export function resolveLegacyRoot() {
  if (cached) return cached;
  loadDotEnv();

  const candidates = [];
  if (process.env.NAVX_LEGACY_ROOT) {
    candidates.push({
      dir: path.resolve(REPO_ROOT, process.env.NAVX_LEGACY_ROOT),
      from: 'NAVX_LEGACY_ROOT',
    });
  }
  // The harness sits at <repo>/tools/baseline, and the repo sits inside the
  // legacy tree, so the default is three levels up. The older two-level layout
  // is still tried, so a standalone checkout of just this tool keeps working.
  candidates.push({
    dir: path.resolve(REPO_ROOT, '../../..'),
    from: 'legacy tree above the monorepo',
  });
  candidates.push({ dir: path.resolve(REPO_ROOT, '..'), from: 'parent directory' });

  const found = candidates.find((c) => isLegacyTree(c.dir));

  if (found) {
    const configured = candidates[0];
    if (configured !== found) {
      console.warn(
        `warning: NAVX_LEGACY_ROOT points at ${configured.dir}, which is not a legacy tree.\n         Falling back to the ${found.from}: ${found.dir}\n         Fix or delete .env to silence this.\n`,
      );
    }
    cached = found.dir;
    return cached;
  }

  throw new Error(
    `Could not locate the legacy NAVX tree.\n\nLooked in:\n${candidates.map((c) => `  - ${c.dir}   (${c.from})`).join('\n')}\n\nA legacy tree is the folder containing Catalogue/, Files/ and Examples/.\nPoint at it with either:\n  echo 'NAVX_LEGACY_ROOT=/path/to/NAVX' > ${path.join(REPO_ROOT, '.env')}\n  NAVX_LEGACY_ROOT=/path/to/NAVX npm run extract\n`,
  );
}

export function harnessPort() {
  loadDotEnv();
  return Number(process.env.NAVX_HARNESS_PORT || 4317);
}

/** Repo-anchored paths, so no command depends on the caller's cwd. */
export const paths = {
  fixtures: path.join(REPO_ROOT, 'tests', '_fixtures'),
  harness: path.join(REPO_ROOT, 'tests', 'harness'),
  reference: path.join(REPO_ROOT, 'reference'),
};
