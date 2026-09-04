#!/usr/bin/env node
/**
 * Every `var(--navx-…)` the stylesheet reads must actually be defined.
 *
 *   pnpm --filter @navx/baseline-harness run tokens
 *
 * This gate exists because of a one-word bug that cost the library a feature
 * without failing anything.
 *
 * `packages/tokens/build.mjs` strips a trailing `.default` when it generates
 * CSS names — `surface.default` becomes `--navx-surface`, which is the right
 * call — but the SCSS export did not, so `motion.easing.default` was
 * `--navx-motion-easing` in one file and `$navx-motion-easing-default` in the
 * other. The stylesheet, written against the SCSS spelling, transitioned
 * submenu height with `var(--navx-motion-easing-default)`.
 *
 * An undefined custom property inside a shorthand is invalid at computed-value
 * time, so the browser dropped the entire `transition` declaration. No parse
 * error, no console warning, no failing test: `transition-duration` quietly
 * reverted to `0s` and the submenu animation that the source code carefully
 * describes had never run once. It took a human noticing that dropdowns felt
 * abrupt to surface it.
 *
 * A missing token is silent by construction, which is exactly the kind of
 * failure that needs a gate rather than a reviewer.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const sheet = readFileSync(join(REPO, 'packages/styles/src/navx.css'), 'utf8');
const tokens = readFileSync(join(REPO, 'packages/tokens/dist/tokens.css'), 'utf8');

/** Every `--navx-x: …` declaration, wherever it is declared. */
const declared = new Set([
  ...[...tokens.matchAll(/^\s*(--navx-[\w-]+)\s*:/gm)].map((m) => m[1]),
  // The stylesheet declares component-level properties of its own, and those
  // are just as valid a target as anything the token package ships.
  ...[...sheet.matchAll(/^\s*(--navx-[\w-]+)\s*:/gm)].map((m) => m[1]),
]);

/** Every `var(--navx-x…)` the stylesheet reads. */
const used = new Map();
for (const match of sheet.matchAll(/var\(\s*(--navx-[\w-]+)/g)) {
  const name = match[1];
  if (!used.has(name)) {
    used.set(name, sheet.slice(0, match.index).split('\n').length);
  }
}

/** …and the reverse: tokens declared in the skins, read by nothing. */
const missing = [...used].filter(([name]) => !declared.has(name));

console.log('\nNAVX · token references\n');
console.log(`  declared  ${declared.size}`);
console.log(`  read      ${used.size}`);

if (missing.length > 0) {
  console.error(`\n  ${missing.length} reference(s) resolve to nothing:\n`);
  for (const [name, line] of missing) {
    console.error(`    navx.css:${line}  var(${name})`);
    // The likeliest cause is the one that already happened once.
    const stem = name.replace(/-default$/, '');
    if (stem !== name && declared.has(stem)) {
      console.error(`      ↳ did you mean ${stem}?  (build.mjs strips a trailing \`.default\`)`);
    }
  }
  console.error(
    '\n  A `var()` with no definition makes its whole declaration invalid at\n' +
      '  computed-value time. The browser drops it silently — no error, no warning.\n',
  );
  process.exit(1);
}

console.log('\n  every var() in the stylesheet resolves.\n');
