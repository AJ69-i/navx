/**
 * @navx/styles — scaffold.
 *
 * Stage 2 — the stylesheet, rebuilt on tokens with logical properties and cascade layers.
 *
 * This package exists from Stage 1 so the workspace graph, the build, the
 * exports contract and the CI package checks are exercised on it before it
 * holds any code. An empty package that publishes cleanly is cheap; retrofitting
 * a broken exports map across eight packages is not.
 */
export const name = '@navx/styles' as const;
export const stage =
  'Stage 2 — the stylesheet, rebuilt on tokens with logical properties and cascade layers.' as const;
