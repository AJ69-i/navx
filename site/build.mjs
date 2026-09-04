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
 * The documentation section is generated the same way, from the same dist
 * directories, by `site/docs.mjs`. Between them there is no hand-written
 * example on this page.
 *
 * Which is exactly why the page is generated rather than hand-maintained. Its
 * inlined artifacts change whenever those packages are rebuilt, and a
 * hand-edited `index.html` would go stale silently. `.github/workflows/pages.yml`
 * rebuilds the packages and re-runs this before every deploy.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocs } from './docs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const read = (relative) => {
  try {
    return readFileSync(join(REPO, relative), 'utf8');
  } catch {
    console.error(
      `\nsite/build.mjs: ${relative} is missing.
  The page inlines the built packages, so build them first:
    pnpm --filter @navx/tokens --filter @navx/styles --filter @navx/core --filter @navx/presets build\n`,
    );
    process.exit(1);
  }
};

/**
 * Refuse to inline a stale build.
 *
 * This gate exists because its absence wasted a review cycle. `read()` only
 * fails when a dist is *missing*; a dist that merely predates its source
 * inlined happily, so `pnpm preview` served yesterday's stylesheet wrapped in
 * today's page. The reviewer saw the old 800ms drawer and the dead submenu
 * transition, reported that the fix had not worked, and was completely right
 * about what they were looking at.
 *
 * A generated file that can silently be older than its input is the same
 * failure as a generated page that can silently be older than its generator.
 * Both now stop the build.
 */
/* `@navx/tokens` writes `src/generated.ts` as part of its own build, so that
   one file is always newer than the dist it was produced alongside. It is an
   output that happens to live in a source folder; counting it would make the
   package permanently, falsely stale. */
const GENERATED = new Set(['generated.ts']);

const newestIn = (dir) => {
  let newest = 0;
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (GENERATED.has(entry.name)) continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else newest = Math.max(newest, statSync(path).mtimeMs);
    }
  };
  walk(join(REPO, dir));
  return newest;
};

const fresh = (dist, sourceDir, pkg) => {
  const built = statSync(join(REPO, dist)).mtimeMs;
  const source = newestIn(sourceDir);
  if (built >= source) return;
  const age = Math.round((source - built) / 1000);
  console.error(`
site/build.mjs: ${dist} is ${age}s older than ${sourceDir}.
  The page inlines the built packages, so this would ship a stale one.

    pnpm --filter ${pkg} build

  Or rebuild everything the page needs:

    pnpm --filter @navx/tokens --filter @navx/styles --filter @navx/core --filter @navx/presets build
`);
  process.exit(1);
};

const tokens = read('packages/tokens/dist/tokens.css');
const sheet = read('packages/styles/dist/navx.min.css');
const core = read('packages/core/dist/index.js');

fresh('packages/tokens/dist/tokens.css', 'packages/tokens/src', '@navx/tokens');
fresh('packages/styles/dist/navx.min.css', 'packages/styles/src', '@navx/styles');
fresh('packages/core/dist/index.js', 'packages/core/src', '@navx/core');

const template = readFileSync(join(HERE, 'template.html'), 'utf8');

/**
 * NAVX's tokens are declared on `:root`. Rescoping them to a class keeps the
 * library's custom properties off the page's own design system — they share no
 * names, but a landing page that leaks the thing it is advertising into its own
 * chrome is a bad advertisement for encapsulation.
 *
 * A regex, and a single class rather than a list, for two reasons that were
 * both bugs before this comment existed:
 *
 *   1. `String.replace` with a string argument replaces the FIRST match only.
 *      tokens.css opens three `:root` blocks — primitives, semantic, component
 *      — so two whole tiers were escaping onto the page. `/g`.
 *
 *   2. Some of those selectors are compound: `:root[data-navx-theme="dark"]`,
 *      `:root:dir(rtl)`, `:root:lang(ar)`. Substituting a selector *list* would
 *      have produced `.a, .b[data-navx-theme="dark"]` and silently detached the
 *      dark theme from `.a`. One class composes; a list does not.
 *
 * A plain class also keeps the specificity at (0,1,0), exactly what `:root`
 * had, so the skin overlays still win by source order and nothing reshuffles.
 */
const SCOPE = '.navx-scope';
const scoped = tokens.replace(/:root/g, SCOPE);

if (scoped.includes(':root')) {
  console.error('site/build.mjs: a :root survived the token rescope');
  process.exit(1);
}

/**
 * The ten skins, inlined so the docs section can show all of them at once.
 * They are already attribute-scoped (`[data-navx-skin="…"]`), so unlike the
 * token file they need no rewriting — they only resolve against tokens that
 * are in scope, which inside a demo they are.
 */
const skinDir = join(REPO, 'packages/tokens/dist/skins');
const skins = readdirSync(skinDir)
  .filter((f) => f.endsWith('.css'))
  .sort()
  .map((f) => readFileSync(join(skinDir, f), 'utf8'))
  .join('\n');

const { html: docs, stats } = await buildDocs();

const page = template
  .replace('__TOKENS__', () => scoped)
  .replace('__SKINS__', () => skins)
  .replace('__SHEET__', () => sheet)
  .replace('__CORE__', () => core)
  .replace('__DOCS__', () => docs);

for (const marker of ['__TOKENS__', '__SKINS__', '__SHEET__', '__CORE__', '__DOCS__']) {
  if (page.includes(marker)) {
    console.error(`site/build.mjs: ${marker} was not substituted`);
    process.exit(1);
  }
}

mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, 'index.html'), page);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(
  `site: ${kb(page.length)}  (tokens ${kb(scoped.length)} · skins ${kb(skins.length)} · stylesheet ${kb(
    sheet.length,
  )} · core ${kb(core.length)} · docs ${kb(docs.length)})`,
);
console.log(
  `docs: ${stats.presets} presets from ${stats.fixtures} variants · ${stats.skins} skins · ${stats.tokens} tokens · ${stats.demos} live demos · ${stats.blocks} code blocks`,
);
