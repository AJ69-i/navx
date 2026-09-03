# @navx/tokens

The theming layer. Three tiers of CSS custom properties, a dark theme, RTL, and
all ten legacy skins — 2.3 kB gzipped.

```bash
npm i @navx/tokens
```

```css
@import '@navx/tokens/tokens.css';
```

## Why this package exists

The legacy library had **zero** CSS custom properties in 1,477 lines. Every
value was a Sass variable resolved at build time. Three things followed: ten skin
stylesheets totalling 213 declarations, an entire colour-generator mini-app built
to work around the lack of runtime theming, and a dark mode that was impossible
without recompiling Sass.

All of that collapses into 201 tokens and 112 lines of skin overlay.

## The three tiers

| tier | example | redefined by a theme? | public? |
|---|---|---|---|
| 1 · primitive | `--navx-color-gray-650` | never | no |
| 2 · semantic | `--navx-text`, `--navx-surface` | **yes — this is the theming API** | yes |
| 3 · component | `--navx-link-color`, `--navx-panel-inline-size` | inherits from tier 2 | yes |

One rule makes the whole thing work: **a component token may only reference a
semantic token, and a semantic token may only reference a primitive.** No
component token holds a literal colour. That is why the dark theme is twelve
declarations rather than fifty-two, and it is enforced by a test rather than by
discipline.

Retheming is therefore tier 2 only:

```css
:root {
  --navx-accent: #0f766e;
  --navx-text: #1f2937;
  --navx-surface: #ffffff;
}
```

## Dark mode

Ships working. Tier 2 is redefined under `prefers-color-scheme: dark` guarded by
`:root:not([data-navx-theme="light"])`, and again under
`:root[data-navx-theme="dark"]`, so an explicit choice beats the OS in both
directions and the un-stamped default still resolves.

## RTL and Arabic

Direction is a token, not a second stylesheet:

```css
:root:dir(rtl) { --navx-chevron-rotation: -135deg; }
:root:lang(ar) {
  --navx-nav-font-family: var(--navx-font-family-arabic);
  --navx-font-line-height-tight: var(--navx-font-line-height-arabic);
}
```

The Arabic line-height token is not cosmetic. Arabic needs more leading than
Latin at the same size, and a Latin fallback stack renders it with the wrong
metrics — which is the difference between RTL that works and RTL that merely
doesn't break.

## Skins

```css
@import '@navx/tokens/skins/dark.css';
```
```html
<nav data-navx-skin="dark"> … </nav>
```

Ten skins, 107 lines of token overlay replacing 213 CSS declarations. Nine are
under fifteen lines; `colored` is seventeen because it also restyles dropdown
links.

**Six of the ten are pure colour. Four are not** — `boxed`, `rounded-boxed`,
`mini-circle` and `bottom-arrow` are *shape* variants that legacy built with a
`::after` pseudo-element. They are expressible as tokens only because tier 3
includes a `link.decoration.*` group describing one decoration element the base
stylesheet always renders: size, inset, radius, background and `clip-path`,
transparent and zero-sized by default. **Stage 2's stylesheet must provide that
affordance** or those four skins cannot be tokens. `bottom-arrow` also swaps
legacy's transparent-border triangle for a `clip-path` polygon, which is one
declaration instead of five and mirrors correctly in RTL.

## Fidelity to the legacy build

Colour values were read from the *compiled* `navigation.css`, not re-derived from
the Sass `lighten()`/`darken()` calls, because Stage 2 has to reproduce 292 visual
baselines exactly. Six of them are asserted in `test/tokens.test.ts`:

| token | value | legacy |
|---|---|---|
| `--navx-color-gray-650` | `#555d65` | `lighten($gray-05, 5%)` — the main text colour |
| `--navx-color-gray-25` | `#fcfdfd` | `lighten($gray-01, 1.5%)` — submenu surface |
| `--navx-color-gray-100` | `#f5f6f8` | `lighten($gray-02, 4%)` — dropdown active |
| `--navx-color-gray-400` | `#a2a9b1` | `lighten($font-color, 30%)` — search icon |
| `--navx-color-brand-500` | `#7367f0` | `$main-color` |
| `--navx-color-brand-600` | `#6254ee` | `darken($main-color, 4%)` — button hover |

**Known redundancy:** `gray-25` (`#fcfdfd`), `gray-50` (`#fbfcfc`) and `gray-75`
(`#f8f9fa`) are within two units of each other — three near-identical whites
inherited from legacy's chained `lighten()` calls. Collapsing them would be
correct design and would require re-approving the baselines, so it is a
deliberate v1.0 decision rather than a silent cleanup.

## JavaScript API

The CSS is the primary artifact; the JS exists for adapters and build tools.

```ts
import { token, cssVar, cssRef } from '@navx/tokens';

token('text.default');   // '#555d65'  — resolved literal
cssVar('surface.default'); // '--navx-surface'  — note the dropped `.default`
cssRef('accent.default');  // 'var(--navx-accent, #7367f0)'
```

## Source format

Tokens are authored as [DTCG](https://tr.designtokens.org/) JSON in `src/`, so
they stay portable to Figma and Tokens Studio. The generator (`build.mjs`) is
hand-written rather than Style Dictionary: every output here is a custom format
anyway — tier-2-only theme blocks, a `:dir(rtl)` block, ten scoped overlays — so
a pipeline would be configuration overhead without carrying any load. The source
stays strict DTCG, so Style Dictionary remains a drop-in if design-tool sync is
ever wanted.

The generator emits `var()` for a reference rather than the resolved literal.
That keeps the tier 3 → tier 2 → tier 1 chain live at runtime, and it is the
entire reason redefining twelve tokens repaints the component.
