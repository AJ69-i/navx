# @navx/angular

Stage 4 — the Angular adapter. Scaffolded during Stage 1 on purpose.

## Why this package exists before it has any code

Angular cannot be built with the toolchain the rest of this workspace uses, and
that is not a preference — it is a hard version constraint discovered by
scaffolding this package on day one:

| | requires |
|---|---|
| `@angular/compiler-cli@22.1.4` | `typescript >=6.0 <6.1` |
| `ng-packagr@22.1.1` | `typescript >=6.0 <6.1` |
| everything else in this workspace | `typescript 7.0.2` (current stable) |

There is no single TypeScript version that satisfies both. Angular's toolchain
is one major behind stable and pins an exact minor.

## The resolution

`packages/angular` is **deliberately exempt from the workspace catalog** and
carries its own TypeScript 6.0.x. Every other package stays on current stable.
This is a contained, documented divergence rather than drift — the catalog
comment in `pnpm-workspace.yaml` points here.

Two consequences to keep in mind at Stage 4:

- Angular libraries must ship Angular Package Format via **ng-packagr**. `tsup`
  produces a package that installs and then fails at the consumer's compile
  step, which is the worst possible failure mode: green locally, broken for
  everyone downstream.
- `@angular/core@22` requires Node `^22.22.3 || ^24.15.0 || >=26.0.0`, which is
  narrower than this repo's `>=20.11`. CI must run a Node version satisfying
  both, or the Angular job needs its own.

## Not yet installed

The `@angular/*` and `ng-packagr` dependencies are declared in the Stage 4 plan,
not here, so `pnpm install` stays fast for everyone working on the other seven
packages. What *is* pinned here today is the TypeScript exemption, so the
mechanism is exercised and proven rather than assumed.
