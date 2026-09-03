/**
 * Build the landing page.
 *
 *   node site/build.mjs
 *
 * The demo on the page is the *real* library: this inlines the built token
 * layer, the published stylesheet and the published core, so what a visitor
 * drags the width slider on is `@navx/core` driving `@navx/styles` through a
 * real container query — not a re-implementation that can quietly disagree
 * with the packages it advertises.
 *
 * Which is exactly why the page is generated rather than hand-maintained. Its
 * three inlined artifacts change whenever those packages are rebuilt, and a
 * hand-edited `index.html` would go stale silently. `.github/workflows/pages.yml`
 * rebuilds the packages and re-runs this before every deploy.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const read = (relative) => {
  try {
    return readFileSync(join(REPO, relative), 'utf8');
  } catch {
    console.error(
      `\nsite/build.mjs: ${relative} is missing.
  The page inlines the built packages, so build them first:
    pnpm --filter @navx/tokens --filter @navx/styles --filter @navx/core build\n`,
    );
    process.exit(1);
  }
};

const tokens = read('packages/tokens/dist/tokens.css');
const sheet = read('packages/styles/dist/navx.min.css');
const core = read('packages/core/dist/index.js');
const template = readFileSync(join(HERE, 'template.html'), 'utf8');

/**
 * NAVX's tokens are declared on `:root`. Scoping the first block to the demo
 * keeps the library's custom properties off the page's own design system —
 * they share no names, but a landing page that leaks the thing it is
 * advertising into its own chrome is a bad advertisement for encapsulation.
 */
const scoped = tokens.replace(':root', '.demo-surface');

const page = template
  .replace('__TOKENS__', () => scoped)
  .replace('__SHEET__', () => sheet)
  .replace('__CORE__', () => core);

for (const marker of ['__TOKENS__', '__SHEET__', '__CORE__']) {
  if (page.includes(marker)) {
    console.error(`site/build.mjs: ${marker} was not substituted`);
    process.exit(1);
  }
}

mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'index.html'), page);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(
  `site: ${kb(page.length)}  (tokens ${kb(scoped.length)} · stylesheet ${kb(sheet.length)} · core ${kb(core.length)})`,
);
