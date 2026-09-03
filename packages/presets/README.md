# @navx/presets

The NAVX catalogue as data, plus the one function that turns it into markup.

```bash
npm install @navx/presets
```

Zero dependencies, zero peer dependencies. It names no framework and no icon
library.

## The idea

A **preset** is the chrome of a nav — alignment, logo placement, sticky or not,
which slots exist, which skin. It carries no labels, no hrefs and no image URLs,
which is why one costs about 179 bytes and why swapping presets does not touch
your menu.

```ts
import { justifiedLogoDual } from '@navx/presets';

// {
//   id: 'justified-logo-dual',
//   name: 'Justified, a logo, 2 menus',
//   slots: { menus: [{}, {}], sections: [], logo: true, panelLogo: true },
//   align: 'between',
// }
```

**Content** is the other half, and it is yours:

```ts
import type { NavxContent } from '@navx/presets';

const content: NavxContent = {
  logo: { image: { src: '/logo.svg', alt: 'Acme' }, href: '/' },
  menus: [
    {
      items: [
        { label: 'Home', href: '/', current: true },
        {
          label: 'Products',
          href: '/products',
          submenu: {
            type: 'dropdown',
            items: [
              { label: 'Laptops', href: '/products/laptops' },
              { label: 'Phones', href: '/products/phones' },
            ],
          },
        },
      ],
    },
  ],
  sections: [],
};
```

Every legacy variant's own content ships as an opt-in import, so a complete
working page is one extra line and nobody's production bundle carries the word
"Lorem":

```ts
import { content } from '@navx/presets/demo/navigation15';
```

## Rendering it

Use your framework's adapter — each is a thin walker over the plan:

```tsx
import { Navx } from '@navx/react/preset';   // or @navx/vue/preset
<Navx preset={justifiedLogoDual} content={content} />
```

```svelte
<script>import { navxPreset } from '@navx/svelte/preset';</script>
<div use:navxPreset={{ preset, content }}></div>
```

```html
<script type="module">
  import { defineNavxPreset } from '@navx/element/preset';
  defineNavxPreset();
  const el = document.querySelector('navx-preset');
  el.preset = preset;
  el.content = content;
</script>
<navx-preset></navx-preset>
```

```html
<!-- Angular -->
<div navxPreset [navxPreset]="preset" [navxContent]="content"></div>
```

Or drive it yourself:

```ts
import { plan, render, html } from '@navx/presets';

const tree = plan(preset, content, { icons });
document.querySelector('#nav').append(render(tree)); // DOM
const markup = html(tree);                            // SSR string
```

## Icons

An icon is a **semantic name**, and you supply the mapping. NAVX ships no icon
library and hardcodes no third-party class names.

```tsx
// an icon font
<Navx preset={p} content={c} icons={{ home: 'fas fa-home', cart: 'fas fa-shopping-cart' }} />

// your own components — passed through untouched
<Navx preset={p} content={c} icons={{ home: <HomeIcon />, cart: <CartIcon /> }} />
```

A string becomes `<i class="…">`. Anything else travels to the adapter
untouched, which is how a React consumer passes an element without this package
importing React. An unmapped name emits `<i data-navx-icon="home">` rather than
nothing, so a missing mapping is visible in the DOM instead of silently absent.

`.navx-search-icon` is the exception: NAVX's own magnifier, drawn in CSS, so a
search form's submit is a `glyph` rather than an `icon` and needs no mapping at
all.

## Images

`NavxImage.src` is resolved against `NavxContent.assetBase` when it is
relative, so demo content stays portable. Absolute URLs and `data:` URIs are
used as given.

## API

| | |
|---|---|
| `catalogue` | all 28 presets, in catalogue order |
| `byFixture` | fixture id → the preset that reproduces it |
| `plan(preset, content, options?)` | → `NavxNode`, the normalized tree |
| `render(tree, doc?)` | → `HTMLElement` |
| `toTree(tree, { create, … })` | → whatever `create` returns |
| `html(tree)` | → string, for SSR |
| `attachOptions(preset)` | options to pass `attach()` |

`PlanOptions`: `icons`, `assetBase`, `labelDisclosure`, `labelToggler`,
`labelClose`, `overlay`.

## What the planner emits

Stage 2's class names, Stage 2's data attributes, and Stage 3's chevron
buttons — the boilerplate you should never hand-write:

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

`.navx-link` is a plain `<a>` for items without a submenu, and the flex row
holding the anchor and the button for items with one — the APG disclosure
shape, because a `<button>` inside an `<a>` is invalid HTML.

Submenu identity is structural (depth plus child index), matching
`@navx/core`'s `pathOf()` exactly, so server-rendered and client-hydrated trees
agree with no generated id.

## Guarantees

- **One markup contract.** `plan()` is the only place in NAVX that decides what
  nav markup is. A gate renders all 56 catalogue variants through seven
  independent paths — `html()`, `render()`, React SSR, Vue SSR, the custom
  element, the Svelte action, and `attach()` — and asserts byte-identical
  canonical DOM: 392 comparisons, zero divergences.
- **Pixel-faithful.** Rendering every preset with its demo content reproduces
  all 292 approved Stage 0 screenshots, with nothing above 0.2% and no errors.

See [`docs/stage5.md`](../../docs/stage5.md) for how both are measured, and for
the six defects the gates found.

## Licence

MIT.
