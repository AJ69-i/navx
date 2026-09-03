# Migrating from legacy NAVX

Every departure from the legacy plugin, in one place, compiled from the
divergence logs each stage kept as it went.

There are two halves: **markup**, which a codemod does for you, and **API**,
which is a short table because most legacy options turned out to be CSS.

---

## TL;DR

```bash
# 1. see what would change — dry by default
npx @navx/codemod ./src

# 2. do it
npx @navx/codemod ./src --write

# 3. swap the runtime
npm remove navx-legacy
npm install @navx/core @navx/styles @navx/tokens
```

```diff
- <script>NAVX.init({ submenuTrigger: 'hover', overlayColor: 'rgba(0,0,0,.7)' });</script>
+ import { attach, createNav } from '@navx/core';
+ attach(document.querySelector('.navx'), createNav(), { trigger: 'hover' });
```

On the real legacy catalogue — all 46 variants — the codemod reports:

```
1115 class rename(s), 97 attribute(s), 92 dropped, 0 unmapped
```

## The codemod

```
npx @navx/codemod <path...> [--write] [--ext .html,.vue]
```

Dry by default. A codemod that rewrites a hundred files the first time you type
its name is one people run once, on a copy, nervously.

Its mapping table is not a transcription of this document — it is the table the
Stage 2 visual gate runs against all 292 approved screenshots. The harness
imports the published package and uses it to rewrite legacy markup in the
browser before comparing pixel-for-pixel with the original. Every entry has been
checked by rendering a real page with it and finding that nothing moved.

**What it will not touch.** A class list it cannot read statically —
`className={clsx(styles.nav, isOpen && 'navigation-body')}`, `:class="…"`,
`class:name={…}` — is reported with a file and line, never rewritten. Guessing
at an expression's meaning is how a codemod corrupts a file. Anything that is
not a legacy NAVX token is passed through exactly as written, because NAVX's
premise is that it drops into someone else's design system: your `col-md-6` and
your `fa-home` survive.

It is idempotent, and a file with no legacy classes comes back byte-identical.

## Markup: the full mapping

### Classes

| legacy | NAVX |
|---|---|
| `navigation` | `navx` |
| `navigation-header` | `navx-header` |
| `navigation-button-toggler` | `navx-toggler` |
| `hamburger-icon` | `navx-toggler-icon` |
| `navigation-body` | `navx-panel` |
| `navigation-body-header` | `navx-panel-header` |
| `navigation-body-close-button` | `navx-panel-close` |
| `navigation-body-section` | `navx-panel-section` |
| `navigation-menu` | `navx-menu` |
| `navigation-social-menu` | `navx-social` |
| `navigation-item` | `navx-item` |
| `navigation-link` | `navx-link` |
| `navigation-brand-text` | `navx-brand` |
| `navigation-logo` | `navx-logo` |
| `navigation-btn` | `navx-btn` |
| `navigation-badge` | `navx-badge` |
| `navigation-text` | `navx-text` |
| `navigation-inline-form` | `navx-form` |
| `navigation-input` | `navx-input` |
| `navigation-search-icon` | `navx-search-icon` |
| `navigation-dropdown` | `navx-submenu` |
| `navigation-dropdown-item` | `navx-submenu-item` |
| `navigation-dropdown-link` | `navx-submenu-link` |
| `navigation-megamenu` | `navx-megamenu` |
| `navigation-megamenu-container` | `navx-megamenu-container` |
| `navigation-row` | `navx-row` |
| `navigation-col`, `navigation-col-N` | `navx-col`, `navx-col-N` |
| `navigation-list` | `navx-list` |
| `navigation-list-heading` | `navx-list-heading` |
| `navigation-tabs*` | `navx-tabs*` |
| `align-to-right` | `navx-push-end` |
| `align-to-left` | `navx-push-start` |
| `overlay-panel` | `navx-overlay` |
| `submenu-indicator` | `navx-chevron` |
| `hide-on-landscape` | `navx-hide-in-bar` |
| `hide-on-portrait` | `navx-hide-in-panel` |
| `margin-top` | `navx-spaced` |

`align-to-right` became `navx-push-end` rather than `navx-push-right` because it
is `margin-inline-start: auto`, and "right" means the wrong thing in Arabic.
Same for `hide-on-landscape`: the new name says which *layout mode* it acts in,
which is what the container query decides, rather than which way the device is
held.

### Modifiers that became attributes

A class is a thing an element *is*; alignment, position and item variant are
things it is *set to*. As attributes, CSS can target them without inventing a
class per combination, and the core can write them without touching `classList`.

| legacy class | NAVX attribute |
|---|---|
| `navigation-justified` | `data-navx-align="between"` |
| `navigation-centered` | `data-navx-align="center"` |
| `navigation-logo-top` | `data-navx-logo="top"` |
| `navigation-transparent` | `data-navx-transparent` |
| `navigation-fullscreen` | `data-navx-fullscreen` |
| `fixed-top` | `data-navx-position="fixed"` |
| `sticky-top` | `data-navx-position="sticky"` |
| `navigation-icon-item` | `data-navx-item="icon"` |
| `navigation-avatar-item` | `data-navx-item="avatar"` |
| `navigation-dropdown-horizontal` | `data-navx-submenu="horizontal"` |
| `navigation-dropdown-left` | `data-navx-submenu-side="start"` |
| `navigation-megamenu-half` | `data-navx-width="half"` |
| `navigation-megamenu-quarter` | `data-navx-width="quarter"` |
| `is-active` | `data-navx-current` |

### Classes with no replacement

| legacy | why |
|---|---|
| `navigation-landscape` | the container query knows the mode; no class needed |
| `has-submenu`, `navigation-submenu` | structural — the CSS reads the DOM, not a marker |
| `scroll-momentum` | a plain declaration on the panel now |
| `is-visible`, `is-invisible` | `data-navx-state`, written by `@navx/core` |
| `submenu-indicator-left` | `:has()` reads `data-navx-submenu-side` off the menu itself, so the arrow and the menu cannot disagree |

### `is-active` split in two

Legacy's `is-active` meant both "this is the current page" *and* "a menu is open
beneath me". NAVX keeps them apart:

- `data-navx-current` — the current page or section. Yours, or scroll-spy's.
- `data-navx-state="open"` — a menu is open. The core's, never yours.

If you styled `.is-active` for both meanings, you now have two selectors and can
finally style them differently.

## API

```js
// legacy
NAVX.init({ submenuTrigger: 'click', overlay: true, scrollSpy: true });
```

```ts
// NAVX
import { attach, createNav } from '@navx/core';
import { spy } from '@navx/core/scrollspy';

const machine = createNav();
const detach = attach(root, machine, { trigger: 'click' });
const stop = spy(root, machine, { offset: 64 });
```

| legacy option | now |
|---|---|
| `breakpoint: 992` | `--navx-breakpoint` in CSS. The number lives once, in the stylesheet; the core reads the resulting `--navx-mode` back. |
| `submenuTrigger: 'hover'` | `trigger: 'click'` — **the default changed**, see below |
| `overlay: true` | a `.navx-overlay` element in your markup, or `overlay: true` when rendering from a preset |
| `overlayColor` | `--navx-overlay-background`, a token |
| `autoSubmenuIndicator` | gone — the chevron is a `<button>` in the markup |
| `submenuIndicatorTrigger` | gone — the link navigates, the button opens. Always. |
| `hideSubWhenClickOut` | `dismissOnOutside` (default `true`) |
| `scrollMomentum` | gone — a plain CSS declaration |
| `scrollSpy: true` | `import { spy } from '@navx/core/scrollspy'` |
| `scrollSpySpeed` | **removed**, see below |
| `scrollSpyOffset: -60` | `offset: 60` — sign and meaning changed, see below |
| `landscapeClass` | gone — the container query knows |
| `onInit` | the function returned; it has already run when `attach()` returns |
| `onLandscape` | `machine.subscribe((s) => s.mode)` |
| `onShowOffCanvas` / `onHideOffCanvas` | `machine.subscribe((s) => s.panelOpen)` |

The four callbacks collapse into one subscription because there is now a single
state object to observe:

```ts
machine.subscribe((state, previous) => {
  if (state.panelOpen !== previous.panelOpen) { /* … */ }
  if (state.mode !== previous.mode) { /* … */ }
});
```

## Deliberate behaviour changes

These are the places NAVX does something different on purpose. Each was recorded
by the stage that made the decision.

### Hover is no longer the default

Legacy opened submenus on hover unless you opted out. NAVX opens on click unless
you opt in. Hover-only disclosure is unreachable by keyboard and hostile on
touch, where the first tap becomes a hover and the second a click. Pass
`{ trigger: 'hover' }` to keep the old behaviour — it still tracks
`aria-expanded` and still works with a keyboard, because the chevron is a real
button either way.

### The chevron is a button, and the link still navigates

Legacy injected a `<span class="submenu-indicator">` and, depending on
`submenuIndicatorTrigger`, either the whole link or only the arrow opened the
menu. NAVX puts a real `<button>` in the markup: the link navigates, the button
discloses. That is the APG **Disclosure Navigation** pattern, and it is the only
arrangement where `aria-expanded` sits on something focusable.

For items that own a submenu this changes the shape slightly:

```html
<li class="navx-item">
  <div class="navx-link">
    <a href="/services">Services</a>
    <button class="navx-chevron" type="button" aria-expanded="false"
            aria-label="Services submenu"></button>
  </div>
  <ul class="navx-submenu">…</ul>
</li>
```

A `<button>` inside an `<a>` is invalid HTML, so `.navx-link` becomes the flex
row that holds both. Items *without* a submenu keep the plain
`<a class="navx-link">`. If you render from `@navx/presets`, you never write
either shape by hand.

### `role="menubar"` was never right

Legacy used no ARIA roles. NAVX uses Disclosure Navigation rather than
`menubar`/`menuitem`, because a site nav is a set of links, not an application
menu — `menubar` promises arrow-key-only navigation and takes links out of the
tab order, which is wrong for something whose items are destinations.

### Cascade layers are yours to assign

The shipped stylesheet is unlayered, with a build-enforced specificity ceiling
of four classes and no ids. Wrapping it in `@layer` was measured against a real
Bootstrap 4 page and cost **58 defeated declarations**, because unlayered author
CSS beats layered CSS at every specificity. If you want it in a layer, say so at
the import:

```css
@import url('@navx/styles/navx.css') layer(navx);
```

A pre-wrapped `navx.layer.css` ships too, if your bundler cannot express that.

### The nav responds to its container, not the viewport

Media queries became container queries. A nav in a 400px sidebar is in panel
mode even on a 4K display, which is what you wanted the whole time. The
consequence: `--navx-mode` is published *by the stylesheet* and read back by the
core, so the number 992 exists in exactly one place.

### `scrollSpySpeed` is gone

NAVX does not animate scrolling. A fragment link is a fragment link, and the
browser already scrolls to it smoothly (`scroll-behavior`), stops short of a
sticky header (`scroll-margin-block-start`), moves focus to the target and adds
a history entry. Legacy re-implemented the first two in about ninety lines of
`requestAnimationFrame` and omitted the last two.

A duration is the one thing the native path will not give you. Buying it back
costs an animation loop that fights the user's own scrolling for control of the
scroll position and has to re-implement `prefers-reduced-motion` by hand.

### `scrollSpyOffset` changed sign

Legacy's offset was used two ways: added to `offsetTop` for the scroll
destination, and `Math.abs()`-ed for the activation test. NAVX's `offset` is one
number with one meaning — **how much room to leave above a section**, normally
your sticky header's height.

```diff
- NAVX.init({ scrollSpy: true, scrollSpyOffset: -60 })
+ spy(root, machine, { offset: 60 })
```

### Skins are token overlays

Ten separate stylesheets became ten token files. `@navx/tokens/skins/dark.css`
sets custom properties; it does not restate layout. Applying two skins is now a
question about which custom properties win, rather than which stylesheet loaded
last.

### Small visual corrections

Recorded in [`docs/stage2.md`](stage2.md) with before/after numbers:

- Link icons are 28px at 24px font, not 32px at 25.6px — legacy's icon sizing
  came from a rounding chain, not a decision.
- Border skins split the link's block padding so a skin can no longer change the
  height of the bar.
- The drawer's indent ladder starts one level in, matching legacy's *rendered*
  result, and retires its `padding-left: 19px !important`.
- `.navx` sets `text-align: start`, which is what actually fixed RTL: logical
  properties put the chevron in the right place, and Bootstrap's
  `body { text-align: left }` then pinned the label. Legacy failed 35
  chevron-side, 18 chevron-overlap and 56 drawer-side checks in Arabic. NAVX
  fails none.

## Not carried over

- **`NAVX.init()` as a global.** There is no global. Import what you use.
- **jQuery-style chaining.** `attach()` returns a teardown function.
- **Monkey-patched DOM nodes.** Legacy wrote nine properties and four classes
  onto your `<nav>`. NAVX writes attributes it recorded first, and `detach()`
  restores every one — which is why the leak gate can prove the element is
  garbage collected after unmount, and legacy's is not.

## Checking your work

If you have the legacy tree, the same gates that validated this rewrite are in
the repo:

```bash
pnpm --filter @navx/baseline-harness run stage2   # 292 screenshots
pnpm --filter @navx/baseline-harness run stage5   # generated markup
pnpm --filter @navx/baseline-harness run stage2:rtl
```

Otherwise the codemod's report is the checklist: anything under **unmapped** is
a `navigation-*` class NAVX does not know, and is either yours or a typo.
