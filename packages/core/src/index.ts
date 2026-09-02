/**
 * @navx/core — scaffold.
 *
 * Stage 3 — the headless state machine: behaviour, ARIA and the keyboard model.
 *
 * This package exists from Stage 1 so the workspace graph, the build, the
 * exports contract and the CI package checks are exercised on it before it
 * holds any code. An empty package that publishes cleanly is cheap; retrofitting
 * a broken exports map across eight packages is not.
 */
export const name = '@navx/core' as const;
export const stage =
  'Stage 3 — the headless state machine: behaviour, ARIA and the keyboard model.' as const;
