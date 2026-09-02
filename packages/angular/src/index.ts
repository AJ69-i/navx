/**
 * @navx/angular — scaffold. See README.md.
 *
 * Angular's compiler pins `typescript >=6.0 <6.1` while the rest of the
 * workspace is on current stable 7.x, so this package is exempt from the
 * pnpm catalog and carries its own TypeScript. Discovered at Stage 1 by
 * scaffolding early; it would have cost a week to find during Stage 4.
 */
export const name = '@navx/angular' as const;
export const stage = 'Stage 4 — Angular adapter, built with ng-packagr.' as const;
