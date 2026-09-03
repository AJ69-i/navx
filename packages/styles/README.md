# @navx/styles

The NAVX stylesheet. **4.1 kB gzipped**, zero `!important`, zero
physical-direction properties, one container query instead of 52 media queries.

```sh
npm install @navx/styles
```

```css
@import '@navx/tokens';
@import '@navx/styles/navx.css';
```

```html
<link rel="stylesheet" href="…/@navx/tokens/dist/tokens.css" />
<link rel="stylesheet" href="…/@navx/styles/dist/navx.min.css" />
```

Tokens first — the stylesheet reads them and ships no values of its own.

## What replaced what

| | legacy | @navx/styles |
| --- | --- | --- |
| lines | 1,477 | 1,572 (of which ~40% comments) |
| gzipped | 8.6 kB | **4.1 kB** |
| `!important` | 18 | **0** |
| `@media (min-width: 992px)` | 52 | **0** (one container query) |
| physical-direction properties | 60 | **0** |
| stylesheets for 10 skins | 10 | 0 — token overlays |
| stylesheets for RTL | (none; it was broken) | 0 — same file |

Validated against 292 approved screenshots of the legacy library across three
viewports, on both platforms that have an approved set: **246 pixel-identical
on macOS, 184 on Linux, none above 0.2% on either, none errored.** Every
remaining difference is an explained improvement, not drift — see
[`docs/stage2.md`](../../docs/stage2.md).

## Cascade layers, and why this file has none

Layers were the first draft, and they did kill all 18 `!important`s. Then
`tools/baseline/tools/layer-loss.mjs` measured what layering costs in a real
page: unlayered CSS beats layered CSS at *every* specificity, so dropping NAVX
into a Bootstrap 4 page silently defeated **58 declarations** — including
`.navx { display: flex }`, beaten by Reboot's `nav { display: block }`. The nav
stopped being a flex container.

So the layer is yours to assign, which is also where the CSS WG landed:

```css
/* your CSS now wins everything, with no !important */
@import url('@navx/styles/navx.css') layer(navx);
```

`dist/navx.layer.css` is the same stylesheet pre-wrapped in `@layer navx` for
`<link>`-only setups.

Unlayered means specificity is the contract instead, so the build enforces it:
**no ids, at most four class-level components per selector**, checked on every
build. A rule of yours like `.my-nav .navx-link:hover` always wins.

## Overriding

Everything visual is a token. Redefine at any scope:

```css
.navx {
  --navx-accent: #0ea5e9;
  --navx-nav-min-block-size: 72px;
}
```

Tier 2 (semantic) is the theming API — see
[`@navx/tokens`](../tokens/README.md). Reach for tier 3 (component) only when
one part needs to differ from the theme, and leave tier 1 (primitive) alone.

## Skins

Ten skins ship as token overlays, not stylesheets:

```html
<link rel="stylesheet" href="…/@navx/tokens/dist/skins/boxed.css" />
<nav class="navx" data-navx-skin="boxed">…</nav>
```

Four **shape** skins (`boxed`, `rounded-boxed`, `mini-circle`, `bottom-arrow`)
drive one always-present pseudo-element, `.navx-link::after`, through six
tokens — position, size, radius and `clip-path`. Three **border** skins
(`border-top`, `border-bottom`, `border-top-bottom`) drive a zero-width
transparent accent border on the same link, rebalancing the link's block
padding so applying a skin never changes the height of the bar. The remaining
three (`colored`, `gradient`, `dark`) are pure colour.

`bottom-arrow` is worth a look as the payoff: legacy drew its triangle with
four transparent borders and could not mirror it. Here it is one
`clip-path: polygon()` in a token, and it flips with the direction for free.

## RTL

There is no second stylesheet and no `[dir]` selector — logical properties
throughout, plus one direction-dependent token for the arrow that points
*along* the inline axis. Arrows that point *down* stay pointing down in Arabic,
which is the bug most RTL ports ship.

`tools/baseline/tools/rtl-audit.mjs` runs four mechanical checks against the
legacy stylesheet and this one, on every variant:

| check | legacy | @navx/styles |
| --- | --- | --- |
| chevron on the wrong side | 35 | **0** |
| chevron drawn over its label | 18 | **0** |
| leading icon trailing | 0 | 0 |
| drawer opens from the wrong edge | 56 | **0** |

The chevron-overlap fix turned out not to be a logical-property problem at all:
Bootstrap 4 ships `body { text-align: left }`, so the arrow moved to the inline
end while the label stayed pinned left. `.navx { text-align: start }` is the
fix, and it changes nothing in LTR.

## Bar mode and panel mode

The switch is a container query on the nav itself:

```css
@container navx (min-width: 992px) { … }
```

So a NAVX in a 320px sidebar is in panel mode on a 4K display, and there is no
JavaScript-applied `.navigation-landscape` class to get out of sync — legacy
needed one, and that desync was a whole category of bug.

Two `@media` queries remain, for the things that genuinely are about the
viewport: the drawer's width below 500px, and `forced-colors`.

## Progressive enhancement

`interpolate-size: allow-keywords` animates submenus to their real height.
Where it is unsupported the `max-block-size` fallback still works — no polyfill,
per the Baseline 2024 decision. `prefers-reduced-motion` is handled in
`@navx/tokens` by setting the duration tokens to 1ms, so it needs no
`!important` here.

## Exports

| entry | what |
| --- | --- |
| `@navx/styles/navx.css` | the stylesheet, commented |
| `@navx/styles/navx.min.css` | minified — what you ship |
| `@navx/styles/navx.layer.css` | pre-wrapped in `@layer navx` |
| `@navx/styles/navx.layer.min.css` | minified, layered |
| `@navx/styles` | `{ metrics }`, for tooling |

MIT.
