# NAVX

A modern, RTL-native, accessible navigation library. Headless core, thin
adapters for React, Vue, Svelte and Angular, a framework-free custom element,
and a stylesheet built on CSS custom properties.

MIT. In active development — see the roadmap below for what exists today.

## Packages

| package | stage | state |
|---|---|---|
| [`@navx/tokens`](packages/tokens) | 1 | **shipping** — 201 tokens, dark theme, RTL, ten skins, 2.3 kB gzipped |
| [`@navx/styles`](packages/styles) | 2 | **shipping** — 4.1 kB gzipped, zero `!important`, zero physical-direction properties |
| [`@navx/core`](packages/core) | 3 | **shipping** — 4.5 kB gzipped, provable `detach()`, full keyboard + ARIA, plus `./scrollspy` at 1.05 kB |
| [`@navx/react`](packages/react) | 4 | **shipping** — 620 B, `useSyncExternalStore` |
| [`@navx/vue`](packages/vue) | 4 | **shipping** — 702 B, `shallowRef` + `onScopeDispose` |
| [`@navx/svelte`](packages/svelte) | 4 | **shipping** — 429 B, a store and an action |
| [`@navx/element`](packages/element) | 4 | **shipping** — 861 B, `<navx-nav>`, no build step |
| [`@navx/angular`](packages/angular) | 4 | **shipping** — 2.1 kB, standalone directive, signals, APF |
| [`@navx/presets`](packages/presets) | 5 | **shipping** — 28 presets, 179 B each, one markup contract for all five adapters |
| [`@navx/codemod`](packages/codemod) | 7 | **shipping** — the migration as a command, using the table the visual gate validates |

All nine packages ship. Each adapter also has a `./preset` subpath carrying its
render walker, so an app that only wants the headless hook still gets the byte
count in the table above.

## Getting started

```bash
npm install @navx/core @navx/styles @navx/tokens
```

```ts
import { attach, createNav } from '@navx/core';
import '@navx/tokens/tokens.css';
import '@navx/styles/navx.css';

const detach = attach(document.querySelector('.navx'), createNav());
```

Using a framework? `@navx/react`, `@navx/vue`, `@navx/svelte`, `@navx/angular`
and `@navx/element` each wrap that in their own idiom, and none is over 2.1 kB.
Want the markup written for you too? `@navx/presets` renders it from a
179-byte preset.

Coming from the legacy plugin:

```bash
npx @navx/codemod ./src        # dry run
npx @navx/codemod ./src --write
```

| | |
|---|---|
| [Migration guide](docs/migration.md) | every mapping and every deliberate divergence |
| [Changelog](CHANGELOG.md) | what 1.0.0 is |
| [Stage records](docs) | how each part was built and what the gates found |

## Development


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
pnpm --filter @navx/baseline-harness run baseline:check   # legacy still renders as approved
pnpm --filter @navx/baseline-harness run stage2           # the new stylesheet against those approvals
pnpm --filter @navx/baseline-harness run stage2:rtl       # the four RTL checks, legacy vs new
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
| 2 | The stylesheet — logical properties, container queries, ten skins as tokens | ✅ done |
| 3 | Headless core — state machine, ARIA, keyboard, `destroy()` | ✅ done |
| 4 | Adapters — React, Vue, Svelte, Angular, custom element | ✅ done |
| 5 | Presets — the catalogue as data, and one markup contract | ✅ done |
| 6 | Scroll-spy and overlay theming — the deferred legacy options | ✅ done |
| 7 | Docs, migration, v1.0.0 | ✅ done |

### Stage 6 result

The two options Stage 5 deferred, and they went opposite ways.

**`overlayColor` was already implemented.** Legacy took the drawer's backdrop as
a JavaScript option and wrote it to an inline style, so it could not be themed,
could not answer `prefers-color-scheme`, and could not differ between two navs
on one page. Stage 1 had already made it a token, so the migration is one
declaration — and a gate proves it, including that a token scopes where the
option never could:

```css
.navx { --navx-overlay-background: linear-gradient(135deg, #FAD7A1 10%, #E96D71 100%); }
```

**`scrollSpy` became 1.05 kB of pure observation.** `@navx/core/scrollspy` is a
subpath export, so navs that don't want it are unaffected. It writes no nav
markup: it reads the page, sends `SPY_SET`, and `attach()` renders
`state.activeId` — so NAVX still has exactly one module that touches the nav's
DOM, which is the rule most at risk when a feature arrives last.

Most of legacy's implementation turned out to be browser features:

| | legacy | Stage 6 |
|---|---|---|
| scroll animation | ~90 lines of rAF + `easeInOutCubic` | `scroll-behavior: smooth` |
| offset | arithmetic on `offsetTop` | `scroll-margin-block-start` |
| activation | a `scroll` handler on every event | `IntersectionObserver` |
| measurement | cached, re-measured on resize | live rects, on a boundary crossing |
| focus and history after a jump | — | native fragment navigation |
| listeners | 3 | 0 in the common path |

There is no click handler: a link to `#pricing` is a fragment link, and the
browser already scrolls to it smoothly, stops short of a sticky header, moves
focus and adds a history entry. Legacy re-implemented the first two and omitted
the last two. `scrollSpySpeed` has no equivalent, deliberately — a duration is
the one thing native smooth scrolling won't give you, and buying it back costs
an animation loop that fights the user's own scrolling.

The gates caught two real defects: `MODE_SET` was the one reducer case building
a fresh state object, so it would have dropped `activeId` on every viewport
change past 992px; and the first render made *two* items read as current at
once, because a page's static "current page" marker and scroll-spy's live one
both survived. Both are in [`docs/stage6.md`](docs/stage6.md).

### Stage 5 result

The 56 extracted catalogue variants collapse to **28 presets** — the rest
differed only in content — and a preset is **179 bytes** because it holds no
labels, no hrefs and no URLs. The catalogue's own content ships separately at
797 bytes a variant, so `<Navx preset={…} content={…}/>` is one import and your
bundle carries only the strings you wrote.

The schema is derived rather than designed: an extractor walks the fixtures,
reports a grammar of **64 node kinds joined by 88 nesting edges**, and fails the
run on any element it cannot account for. It reports none.

**One markup contract, and it is asserted.** `plan()` is the only place in NAVX
that decides what nav markup looks like; the five adapters walk the tree it
returns, and React and Vue share a single parameterised traversal because
`toTree` takes the element factory as an argument rather than importing one.
The gate renders all 56 variants through seven independent paths — `html()`,
`render()`, React SSR, Vue SSR, `<navx-preset>`, the Svelte action, and
`attach()` — and requires byte-identical canonical DOM:

```
comparisons  392       divergences  0
```

**And it reproduces the baselines.** Rendering every preset with its demo
content and comparing against the same 292 approved Stage 0 screenshots:

```
[stage5] identical 181 · ≤0.2% 111 · >0.2% 0 · errored 0
[stage2] identical 184 · ≤0.2% 108 · >0.2% 0 · errored 0
```

Both gates run through one tool behind `--harness`, so they cannot drift apart
in tolerance or method. Stage 2's numbers are unchanged from before Stage 5
touched the stylesheet, which is what makes the three-render gap meaningful: it
is the intentional divergence, where NAVX drops legacy's `id` and ships the
toggler and close control as real buttons.

The gates found six dropped layout modifiers and one regression the planner
itself caused — including a shared button reset whose *placement*, not
specificity, silently shrank the drawer's close glyph from 25px to 16px in both
harnesses. All seven, and the tooling that found them, are in
[`docs/stage5.md`](docs/stage5.md).

### Stage 2 result

The stylesheet replaces 1,477 lines of legacy CSS with 4.1 kB gzipped, and was
validated against all 292 approved screenshots across three viewports, on both
platforms with an approved set: **246 pixel-identical on macOS, 184 on Linux,
none above 0.2% on either, none errored.** Every remaining difference is an
explained improvement — the residuals, the six regressions the baselines caught,
and the RTL numbers are all recorded in [`docs/stage2.md`](docs/stage2.md).

Two decisions in there are worth flagging from here.

**Cascade layers did not survive contact with a real page.** Stage 2 was
specified with `@layer`, and layers did retire all 18 `!important`s. But
unlayered CSS beats layered CSS at *every* specificity, and measuring that cost
against the harness's Bootstrap 4 page found **58 NAVX declarations silently
defeated** — including `.navx { display: flex }`, beaten by Reboot's one-type
`nav { display: block }`. So the shipped file is unlayered with a build-enforced
specificity ceiling, and the layer is the consumer's to assign
(`@import url('@navx/styles/navx.css') layer(navx)`). The detector is kept as a
regression test.

**The RTL fix was not where it looked.** Logical properties put the chevron at
the inline end correctly; Bootstrap 4's `body { text-align: left }` then kept
the *label* pinned left, and the two collided. Legacy failed 35 chevron-side,
18 chevron-overlap and 56 drawer-side checks in Arabic; the new stylesheet
fails none.

### Stage 4 result

Five adapters, and the numbers are the argument. Every one of them is a
lifecycle wrapper over the same machine — no adapter contains a transition, an
ARIA rule, a key handler or a breakpoint:

| | gzipped | integration |
|---|---|---|
| `@navx/svelte` | 429 B | a plain store + an action |
| `@navx/react` | 620 B | `useSyncExternalStore` + a ref callback |
| `@navx/vue` | 702 B | `shallowRef` + `watch(flush: 'post')` + `onScopeDispose` |
| `@navx/element` | 861 B | `<navx-nav>`, light DOM, explicit registration |
| `@navx/angular` | 2.1 kB | standalone directive + signals, via ng-packagr |

A React app ships **4.96 kB** of JavaScript in total, core included. All five
are budgeted in [`.size-limit.json`](.size-limit.json), so thinness is enforced
rather than claimed.

Two things worth flagging from [`docs/stage4.md`](docs/stage4.md).

**Vue's `readonly()` would have silently undone the whole design.** Snapshot
identity is load-bearing — `reduce()` returns the same object when nothing
changed, which is what makes a `ResizeObserver` firing on every pixel of a drag
cost one comparison instead of a render. `readonly()` is deep, so reading
`.value` through it hands back a *proxy* of the snapshot, and
`state.value === machine.getState()` becomes false. Vue skips frozen objects,
so this survives a casual test. `shallowReadonly` is the fix; the identity
assertion is now a test.

**Angular's contract is a compile-time one, so the test is a compiler.**
`tsc --noEmit` checks our sources and ng-packagr emits *partial* declarations
that no template type-checker has seen. `pnpm --filter @navx/angular test`
compiles a real consumer component against the built `dist/` in full mode with
`strictTemplates` — and compiles a second fixture that **must fail**, because a
green type-check only means something if a red one is reachable.
