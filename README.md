# NAVX

A modern, RTL-native, accessible navigation library. Headless core, thin
adapters for React, Vue, Svelte and Angular, a framework-free custom element,
and a stylesheet built on CSS custom properties.

MIT. In active development — see the roadmap below for what exists today.

## Packages

| package | stage | state |
|---|---|---|
| [`@navx/tokens`](packages/tokens) | 1 | **shipping** — 190 tokens, dark theme, RTL, ten skins, 2.24 kB gzipped |
| [`@navx/styles`](packages/styles) | 2 | scaffold |
| [`@navx/core`](packages/core) | 3 | scaffold |
| [`@navx/react`](packages/react) · [`vue`](packages/vue) · [`svelte`](packages/svelte) · [`angular`](packages/angular) · [`element`](packages/element) | 4 | scaffold |
| [`@navx/presets`](packages/presets) | 5 | scaffold |

The scaffolds are empty but real: they build, typecheck, and pass `publint` and
`attw`. An empty package that publishes cleanly is cheap; retrofitting a broken
exports map across nine packages is not.

## Getting started

```bash
pnpm install
pnpm build
pnpm verify     # lint, typecheck, test, package contract, bundle budgets
```

Requires Node ≥ 22.22.3 and pnpm ≥ 9. The Node floor comes from Angular 22,
which needs `^22.22.3 || ^24.15.0 || >=26.0.0`.

## Two toolchain constraints worth knowing before you touch the build

Both were found by scaffolding early rather than at the stage that needed them.

**TypeScript 7 breaks `tsup --dts`.** `rollup-plugin-dts`, which tsup delegates
to, reaches into the JS compiler-API internals that TypeScript 7's native
compiler no longer exposes, and throws `Cannot read properties of undefined
(reading 'useCaseSensitiveFileNames')`. So esbuild emits the JavaScript and
`tsc` emits the types, via [`scripts/emit-types.mjs`](scripts/emit-types.mjs).
No package sets `dts: true`. This also takes a fragile dependency out of the
critical path of *"does this package ship working types"*, which is the most
common way a published package is broken for the people installing it.

**Angular cannot share the workspace TypeScript.** `@angular/compiler-cli@22`
and `ng-packagr@22` both pin `typescript >=6.0 <6.1`; everything else is on
current stable 7.0.2. No single version satisfies both, so `packages/angular` is
exempt from the pnpm catalog and carries its own TypeScript 6.0.x. See
[`packages/angular/README.md`](packages/angular/README.md).

## The regression net

[`tools/baseline`](tools/baseline) captures what the *legacy* library looks like,
so every stage after it is falsifiable rather than reviewed from memory: 56
variants extracted, 292 asserted screenshots per platform across three viewports,
and 112 RTL reference renders.

```bash
pnpm --filter @navx/baseline-harness run baseline:check
```

It reads the legacy tree at runtime from `NAVX_LEGACY_ROOT`, auto-detected as the
folder containing this repo. **No legacy source, fixture or baseline is committed
here** — they are derivatives of a separately-licensed codebase and this repo is
MIT. They live in private companion repos; `.github/workflows/baselines.yml`
checks those out via a token and no-ops rather than failing when the secrets are
absent, so outside contributors still get a green CI.

## Roadmap

| stage | | |
|---|---|---|
| 0 | Baselines and safety net | ✅ done |
| 1 | Monorepo, build, CI, tokens | ✅ done |
| 2 | The stylesheet — logical properties, cascade layers, container queries | next |
| 3 | Headless core — state machine, ARIA, keyboard, `destroy()` | |
| 4 | Adapters | |
| 5 | Presets — the 46 catalogue variants as data | |
| 6 | Scroll behaviours, grid mega-menu, runtime theming | |
| 7 | Docs, migration, v1.0.0 | |

### What Stage 2 inherits from Stage 1

Four of the ten legacy skins — `boxed`, `rounded-boxed`, `mini-circle`,
`bottom-arrow` — are *shape* variants, not colour. They are expressible as
tokens only because tier 3 defines a `link.decoration.*` group describing one
pseudo-element the base stylesheet must always render. **Stage 2's CSS has to
provide that affordance**, or those four skins need stylesheets of their own and
the token story breaks.
