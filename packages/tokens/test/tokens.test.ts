import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const css = readFileSync(path.join(DIST, 'tokens.css'), 'utf8');

const declared = (source: string) =>
  new Set([...source.matchAll(/^\s*(--navx-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]!));
const referenced = (source: string) =>
  [...source.matchAll(/var\(\s*(--navx-[a-z0-9-]+)/g)].map((m) => m[1]!);

const defined = declared(css);

describe('token graph', () => {
  // The gate: a var() pointing at nothing renders as an invalid value and the
  // component silently loses that property. It is the failure mode that theming
  // bugs actually take, and it is invisible without this check.
  it('every var() reference in tokens.css resolves to a declared property', () => {
    const dangling = [...new Set(referenced(css))].filter((name) => !defined.has(name));
    expect(dangling, `dangling references: ${dangling.join(', ')}`).toEqual([]);
  });

  it('every skin overlay references only declared properties', () => {
    const problems: string[] = [];
    for (const file of readdirSync(path.join(DIST, 'skins'))) {
      const skin = readFileSync(path.join(DIST, 'skins', file), 'utf8');
      // A skin may set a property the base declares, and may reference base
      // properties — but it must never invent one.
      for (const ref of new Set(referenced(skin))) {
        if (!defined.has(ref)) problems.push(`${file}: var(${ref})`);
      }
      for (const set of declared(skin)) {
        if (!defined.has(set)) problems.push(`${file}: sets undeclared ${set}`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('resolves in both themes and both directions', () => {
    for (const marker of [
      '@media (prefers-color-scheme: dark)',
      ':root[data-navx-theme="dark"]',
      ':root:dir(rtl)',
      ':root:lang(ar)',
      '@media (prefers-reduced-motion: reduce)',
    ]) {
      expect(css, `missing block: ${marker}`).toContain(marker);
    }
  });
});

describe('tier discipline', () => {
  // The rule that keeps dark mode a ten-line diff: component tokens resolve
  // through semantic ones, never straight to a primitive. Without this test the
  // discipline erodes one convenient shortcut at a time.
  it('component tokens never reference a primitive directly', () => {
    // Bound the slice to the tier-3 block itself. Everything after it — the dark
    // theme, the RTL block — legitimately reaches tier 1, because redefining
    // primitives is precisely what a theme does.
    const start = css.indexOf('/* tier 3');
    const end = css.indexOf('/*', start + 2);
    expect(start, 'tier 3 section not found').toBeGreaterThan(-1);
    expect(end, 'tier 3 section is unbounded').toBeGreaterThan(start);
    const componentSection = css.slice(start, end);
    const leaks = [...new Set(referenced(componentSection))].filter((name) =>
      /^--navx-(color-|size-|radius-|duration-|easing-|layer-|breakpoint-|font-)/.test(name),
    );
    // Structural tokens (sizes, radii, durations) legitimately come from tier 1;
    // colour is the tier that themes redefine, so only colour leaks matter.
    const colourLeaks = leaks.filter((n) => n.startsWith('--navx-color-'));
    expect(
      colourLeaks,
      `component tokens reaching past tier 2 for colour: ${colourLeaks.join(', ')}`,
    ).toEqual(['--navx-color-transparent']); // the one legitimate case: an explicit "no colour"
  });

  it('the dark theme touches tier 2 only', () => {
    const darkBlock = css.slice(css.indexOf(':root[data-navx-theme="dark"]'));
    const end = darkBlock.indexOf('}');
    const set = declared(darkBlock.slice(0, end));
    const nonSemantic = [...set].filter((n) =>
      /^--navx-(link|panel|dropdown|nav|button|input|badge|brand|logo|toggler|social|tabs|megamenu|chevron|overlay)-/.test(
        n,
      ),
    );
    expect(nonSemantic, `dark theme reaching into tier 3: ${nonSemantic.join(', ')}`).toEqual([]);
  });
});

describe('legacy fidelity', () => {
  // Stage 2 must reproduce 292 baselines, so these values are not free to drift.
  // They are the exact compiled output of the legacy Sass, read from
  // Files/css/navigation.css rather than re-derived from lighten()/darken().
  it.each([
    ['--navx-color-gray-650', '#555d65', '$font-color — lighten($gray-05, 5%)'],
    ['--navx-color-gray-25', '#fcfdfd', 'submenu surface — lighten($gray-01, 1.5%)'],
    ['--navx-color-gray-100', '#f5f6f8', 'dropdown active — lighten($gray-02, 4%)'],
    ['--navx-color-gray-400', '#a2a9b1', 'search icon — lighten($font-color, 30%)'],
    ['--navx-color-brand-500', '#7367f0', '$main-color'],
    ['--navx-color-brand-600', '#6254ee', 'button hover — darken($main-color, 4%)'],
  ])('%s is %s (%s)', (name, value) => {
    expect(css).toContain(`${name}: ${value};`);
  });
});
