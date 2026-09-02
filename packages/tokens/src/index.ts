/**
 * @navx/tokens
 *
 * Typed access to the token set for JS consumers. The CSS is the primary
 * artifact — import `@navx/tokens/tokens.css` — but adapters and build tools
 * sometimes need the values or the custom-property names in JS.
 */

export { tokens, cssVars, skins } from './generated.js';
import { cssVars, type skins, tokens } from './generated.js';

export type TokenName = keyof typeof tokens;
export type SkinName = (typeof skins)[number];

/** The resolved literal for a token, e.g. `token('text.default')` → `'#555d65'`. */
export function token<T extends TokenName>(name: T): (typeof tokens)[T] {
  return tokens[name];
}

/**
 * The CSS custom-property name for a token, e.g. `cssVar('surface.default')`
 * → `'--navx-surface'`. Prefer this over hand-writing the name: the mapping
 * drops a trailing `.default`, so it is not a plain string transform.
 */
export function cssVar<T extends TokenName>(name: T): (typeof cssVars)[T] {
  return cssVars[name];
}

/**
 * A `var()` reference with the resolved literal as its fallback, so a value
 * still renders if the stylesheet has not loaded.
 */
export function cssRef(name: TokenName): string {
  return `var(${cssVars[name]}, ${tokens[name]})`;
}

/** Every token whose name starts with `prefix`, e.g. all `link.*`. */
export function tokensMatching(prefix: string): Partial<typeof tokens> {
  return Object.fromEntries(
    Object.entries(tokens).filter(([name]) => name === prefix || name.startsWith(`${prefix}.`)),
  ) as Partial<typeof tokens>;
}
