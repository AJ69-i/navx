# Changelog

All ten `@navx` packages version in lockstep and ship together.

## 1.0.0

The first release. A commercial navbar plugin rebuilt as an MIT-licensed
ecosystem, validated at every step against 292 approved screenshots of the
original.

### Packages

| | gzipped | |
|---|---|---|
| `@navx/tokens` | 2.3 kB | 201 DTCG tokens, a dark theme, RTL, ten skins |
| `@navx/styles` | 4.2 kB | the stylesheet — zero `!important`, zero physical-direction properties |
| `@navx/core` | 4.5 kB | headless state machine, WCAG keyboard and ARIA, provable `detach()` |
| `@navx/core/scrollspy` | 1.05 kB | scroll-spy as pure observation |
| `@navx/react` | 620 B | `useSyncExternalStore` |
| `@navx/vue` | 702 B | `shallowRef` + `onScopeDispose` |
| `@navx/svelte` | 429 B | a store and an action |
| `@navx/element` | 861 B | `<navx-nav>`, no build step |
| `@navx/angular` | 2.1 kB | standalone directive and signals, via ng-packagr |
| `@navx/presets` | 5.4 kB | 28 presets and one render plan |
| `@navx/codemod` | — | the migration, as a command |

Each adapter also ships a `./preset` subpath carrying its render walker, so an
app that only wants the headless hook still gets the byte count above.

### What it does that the original did not

- **Accessible.** Full keyboard support and correct ARIA on the APG Disclosure
  Navigation pattern. Six keyboard behaviours the original had none of.
- **No memory leaks.** `detach()` restores every attribute it wrote and removes
  every listener, proven with CDP heap snapshots: the original leaked three
  listeners per mount and never released the element.
- **RTL.** Logical properties throughout. The original failed 35 chevron-side,
  18 chevron-overlap and 56 drawer-side checks in Arabic; this fails none.
- **Container queries.** A nav in a 400px sidebar is in panel mode on a 4K
  display, and the breakpoint exists in exactly one place.
- **Five frameworks**, from one markup contract — asserted, not assumed: 392
  cross-adapter comparisons, zero divergences.
- **Themeable.** Ten skins are token overlays rather than ten stylesheets.
- **Typed, and packaged properly.** `publint` and `arethetypeswrong` clean on
  all ten packages, ESM and CJS, with size budgets in CI.

### Breaking changes from legacy NAVX

Everything, deliberately — this is a clean break, and
[`docs/migration.md`](docs/migration.md) is the complete list with a codemod
that does the markup half:

```bash
npx @navx/codemod ./src --write
```

The headlines: no `navigation-*` classes survive; modifiers became data
attributes; `is-active` split into `data-navx-current` and
`data-navx-state="open"`; submenus open on **click** by default; the chevron is
a real `<button>` in the markup; `overlayColor` is a token; `scrollSpySpeed` is
gone because the browser animates scrolling better than we can.

### Verified by

Every release runs these, and none of them are self-reported:

```
292 approved screenshots  ×2 gates   0 above 0.2%, 0 errored
cross-adapter DOM identity           392 comparisons, 0 divergences
memory leak (CDP heap snapshots)     0 listeners left, element collected
accessibility (axe-core + keyboard)  6/6 behaviours, no new violations
RTL audit                            0 failures across 3 checks
size budgets                         17 entries, all under
publint + attw                       10 packages clean
```
