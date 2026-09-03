/**
 * @navx/styles build.
 *
 * The stylesheet is hand-authored CSS, not compiled from anything — that is the
 * point of the token layer. This step copies it to dist and reports the metrics
 * the README quotes, so those numbers can never quietly drift from reality.
 */

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { transform } from 'lightningcss';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src', 'navx.css');
const DIST = path.join(ROOT, 'dist');

await mkdir(DIST, { recursive: true });
await copyFile(SRC, path.join(DIST, 'navx.css'));

const css = await readFile(SRC, 'utf8');

/**
 * Minified build. The source is heavily commented on purpose — it is a public
 * MIT stylesheet people will read to understand the architecture — but shipping
 * 3.4 kB of prose to every consumer is not a cost they agreed to. lightningcss
 * is used rather than a regex because the file contains `content: '\25E5'`
 * strings and `clip-path: polygon(...)`, both of which naive whitespace
 * stripping corrupts.
 *
 * `targets` is deliberately absent: Stage 1 chose Baseline 2024 with graceful
 * fallbacks, so nothing here should be lowered or prefixed.
 */
const { code: minified } = transform({
  filename: 'navx.css',
  code: Buffer.from(css),
  minify: true,
});
await writeFile(path.join(DIST, 'navx.min.css'), minified);

/**
 * The same stylesheet inside one layer, for consumers who can only use `<link>`
 * and so cannot write `@import url(...) layer(navx)` themselves. Generated
 * rather than maintained, because two hand-edited copies of 1,300 lines diverge.
 */
const wrapped = `@layer navx {\n${css.replace(/^/gm, '  ').trimEnd()}\n}\n`;
await writeFile(path.join(DIST, 'navx.layer.css'), wrapped);
await writeFile(
  path.join(DIST, 'navx.layer.min.css'),
  transform({ filename: 'navx.layer.css', code: Buffer.from(wrapped), minify: true }).code,
);

/** Strip comments so metrics describe the CSS, not the prose about it. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Specificity ceiling.
 *
 * With no `@layer` around this file, low selectors are the only thing that
 * keeps it overridable, so the ceiling is a build gate rather than a promise in
 * a README. Four class-level components is the budget — enough for
 * `.navx-item[data-navx-item='icon'] > .navx-link` and its hover twin, and
 * still beatable by a consumer's `.my-nav .navx-link:hover`. Ids are banned.
 */
const CLASS_BUDGET = 4;

/** Split a selector list on top-level commas only — `:not(a, b)` is one item. */
const splitSelectors = (list) => {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
};

const countLevels = (s) => ({
  ids: (s.match(/#[\w-]+/g) || []).length,
  classes: (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[a-z-]+/g) || []).length,
});

const specificityOf = (selector) => {
  // Per spec: `:where()` contributes nothing, and `:not()`/`:is()` contribute
  // their *most specific* argument — not the sum of all of them.
  const reduced = selector
    .replace(/::[a-z-]+(\([^)]*\))?/g, '') // pseudo-elements are type-level
    .replace(/:where\([^)]*\)/g, '')
    .replace(/:(?:not|is)\(([^)]*)\)/g, (_, inner) => {
      const worst = splitSelectors(inner)
        .map((a) => ({ a, n: countLevels(a).classes }))
        .sort((x, y) => y.n - x.n)[0];
      return ` ${worst?.a ?? ''} `;
    });
  return countLevels(reduced);
};

const offenders = [];
for (const match of bare.matchAll(/(^|[}{;])\s*([^{}@]+?)\s*\{/gm)) {
  for (const selector of splitSelectors(match[2])) {
    const s = selector.trim().replace(/\s+/g, ' ');
    if (!s || s.startsWith('@') || /^(from|to|\d+%)$/.test(s)) continue;
    // The five-rung nested-indent ladder is the documented legacy-fidelity
    // quirk below; it is exempt by name so the exemption cannot spread.
    if (s.includes('.navx-submenu .navx-submenu .navx-submenu')) continue;
    const { ids, classes } = specificityOf(s);
    if (ids > 0 || classes > CLASS_BUDGET) offenders.push(`${s}  → ${ids} id / ${classes} class`);
  }
}
if (offenders.length) {
  console.error(`\nspecificity budget exceeded (max ${CLASS_BUDGET} class-level, 0 id):`);
  for (const o of offenders.slice(0, 20)) console.error(`  ${o}`);
  process.exitCode = 1;
}

const metrics = {
  lines: css.split('\n').length,
  declarations: (bare.match(/[a-z-]+\s*:[^;{}]+;/g) || []).length,
  important: (bare.match(/!important/g) || []).length,
  mediaQueries: (bare.match(/@media/g) || []).length,
  containerQueries: (bare.match(/@container/g) || []).length,
  physicalProps: (
    bare.match(
      /(?:^|[\s;{])(?:margin|padding|border)-(?:top|right|bottom|left)\b|(?:^|[\s;{])(?:top|right|bottom|left)\s*:|text-align\s*:\s*(?:left|right)/g,
    ) || []
  ).length,
  tokenRefs: (bare.match(/var\(--navx-/g) || []).length,
  /**
   * Dimension literals outside `var()` — the honest counterpart to tokenRefs.
   * A hairline border or a tap-target size is structural and belongs here; a
   * colour or a spacing step is a design decision and belongs in a token. The
   * number is reported rather than capped, because the point is that it stays
   * visible.
   */
  dimensionLiterals: [...bare.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)]
    .flatMap(([, , value]) => {
      const outside = value.includes('var(')
        ? value.replace(/var\([^()]*(\([^()]*\))?[^()]*\)/g, '')
        : value;
      return [...outside.matchAll(/(?<![\w-])(\d+(?:\.\d+)?)(px|rem|em)/g)];
    })
    .filter(([, n]) => n !== '0').length,
  rawKb: (css.length / 1024).toFixed(1),
  gzipKb: (gzipSync(css).length / 1024).toFixed(2),
  minRawKb: (minified.length / 1024).toFixed(1),
  minGzipKb: (gzipSync(minified).length / 1024).toFixed(2),
};

await writeFile(path.join(DIST, 'metrics.json'), JSON.stringify(metrics, null, 2));

console.log(
  `styles: ${metrics.lines} lines · ${metrics.declarations} declarations · ` +
    `${metrics.tokenRefs} token refs
` +
    `        ${metrics.important} !important · ${metrics.mediaQueries} @media · ` +
    `${metrics.containerQueries} @container · ${metrics.physicalProps} physical-direction props · ` +
    `${metrics.dimensionLiterals} dimension literals
` +
    `        source   ${metrics.rawKb} kB raw · ${metrics.gzipKb} kB gzip
` +
    `        minified ${metrics.minRawKb} kB raw · ${metrics.minGzipKb} kB gzip  ← what ships`,
);
