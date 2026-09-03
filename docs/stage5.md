# Stage 5 — the presets

The catalogue as data, and one description of nav markup that five frameworks
walk.

Stage 2 gave NAVX a stylesheet, Stage 3 a headless core, Stage 4 five thin
adapters. All three assume the consumer writes the markup. Stage 5 is the first
part of NAVX that *generates* it — which is what `<Navx preset={…}/>` promises,
and what makes a nav one import instead of ninety lines of nested `<ul>`.

---

## What a preset is

A preset is the **chrome**: how the nav aligns, where the logo sits, whether it
sticks, which slots exist, which skin it wears. It carries no labels, no hrefs
and no image URLs.

```ts
export const justifiedLogoDual: NavxPreset = {
  id: 'justified-logo-dual',
  name: 'Justified, a logo, 2 menus',
  slots: { menus: [{}, {}], sections: [], logo: true, panelLogo: true },
  align: 'between',
};
```

**179 bytes, mean, across 28 presets.** Content is the other half and it is
yours; each legacy variant's own content ships separately as
`@navx/presets/demo/<fixture>`, at 797 bytes mean across 56 modules, so a
working page is one extra import and nobody's production bundle carries the
word "Lorem".

```ts
import { justifiedLogoDual } from '@navx/presets';
import { content } from '@navx/presets/demo/navigation15';

<Navx preset={justifiedLogoDual} content={myContent} icons={{ home: <HomeIcon/> }} />
```

## Derived, not invented

`tools/baseline/tools/extract-presets.mjs` walks the 56 fixtures Stage 0
extracted and reports a grammar: **64 distinct node kinds joined by 88 nesting
edges**. Every field in `types.ts` exists because something in that grammar
needs it, and nothing exists that the grammar does not use.

The extractor is **total**. Every element it meets must match a recognizer;
anything unaccounted for is collected, printed, and fails the run. It reports
zero unrecognised constructs — which is the evidence the schema can express
every variant, rather than an assurance that it can. That property is what
found five of the six defects below: each began as an element the recognizers
walked past.

It is committed output rather than a build step, because regenerating it needs
the separately-licensed legacy tree this repo deliberately does not carry. It
formats its own output with Biome, because a generator that needs remembering
is a generator that will be forgotten.

## 56 variants, 28 presets

Grouping the fixtures by chrome collapses them by half: the rest differed only
in which icons and labels the demo used, which is content.

```
justifiedLogoSocialDual         9 variants   ex-hover, ex-horizontal, ex-lists, …
justifiedLogo                   6 variants   navigation3, navigation19, navigation22, …
justifiedLogoTriple             6 variants   navigation38, navigation39, navigation40, …
plainLogoDual                   3 variants   navigation13, navigation16, navigation30
…                                            (28 total, 0 name collisions)
```

Nothing is lost: `byFixture` maps all 56 fixtures to the preset that reproduces
them, and that map is what the gates walk. But shipping 56 near-duplicate
presets would have handed consumers a list to choose between where half the
choices were the same choice.

Names come from chrome alone. The first namer derived them from content and
produced `justified2` … `justified13` — a lottery number with extra steps,
because the distinguishing features lived in the half a preset deliberately does
not carry. Where two variants differ only in *which* menu is pushed to the
trailing edge, that earns a word (`LeadMenuEnd`) rather than a numeric suffix.

## Icons are names

The catalogue used Font Awesome for every icon — 66 occurrences of `fas` alone —
and Bootstrap utilities for layout inside mega-menus. Shipping those strings
would make `@navx/presets` depend on two libraries it does not install, in the
dark.

So an icon is a semantic name and the consumer supplies the mapping: a class
string for an icon font, or their own component, which travels through the
planner untouched as an opaque value. `.navx-search-icon` is the exception that
proves the rule — it is NAVX's own magnifier, drawn in CSS with a rotated
bordered circle and a `::before` handle, so it is a `glyph`, not an `icon`.

Bootstrap utilities on mega-menu content (`p-2`, `mt-3`, `img-fluid`,
`text-justify`) travel as consumer content on the elements that carry them.
Mega-menu grids are the one place NAVX renders a consumer's *content layout*
rather than its own chrome.

## The planner

`plan(preset, content, options)` returns a normalized node tree, and it is the
only place in NAVX that decides what nav markup looks like.

That is the whole design. Five adapters each rendering their own
JSX/VNodes/template would be five implementations of one contract and five
chances to drift — the exact failure mode Stage 4 refused components to avoid.
So the adapters do not render markup; they walk this tree, generically.

`render.ts` offers two walkers and imports no framework at all:

| | used by |
|---|---|
| `render(tree)` → DOM | `<navx-preset>`, the Svelte action, the Angular directive |
| `toTree(tree, opts)` → virtual nodes | React, Vue |

`toTree` takes the element factory as an *argument* — React passes
`createElement`, Vue passes `h` — so `@navx/presets` has no peer dependencies,
and React and Vue share a single traversal. There is one walker in NAVX,
parameterised, not one per framework.

The planner owns three things nothing else knows: Stage 2's class names and
data attributes, Stage 3's chevron buttons, and the structural submenu ids
(depth plus child index) that match `attach()`'s `pathOf()` exactly, so a
server-rendered tree and a client-hydrated one agree with no generated id in
sight.

## The disclosure shape

Stage 3 promoted the chevron to a real `<button>`, and the planner is the first
thing that had to commit to where it goes. Stage 2's CSS wants it inside
`.navx-link`, which in legacy markup is the `<a>` — and a `<button>` inside an
`<a>` is invalid HTML and nested interactive content.

The resolution is the APG disclosure shape, applied only where it is needed:

```html
<!-- no submenu -->
<li class="navx-item"><a class="navx-link" href="/">Home</a></li>

<!-- submenu -->
<li class="navx-item">
  <div class="navx-link">
    <a href="/services">Services</a>
    <button class="navx-chevron" type="button" aria-expanded="false"
            aria-label="Services submenu"></button>
  </div>
  <div class="navx-megamenu">…</div>
</li>
```

`.navx-link` becomes the flex *row* only for items that own a submenu, so the
chevron stays a direct child and panel-mode positioning is pixel-identical by
construction. Four stylesheet selectors relaxed from child to descendant
(`.navx-link > i` → `.navx-link i`) so one stylesheet serves both shapes at the
same specificity, plus one new rule for the anchor inside a row-shaped link.
Stage 2's gate re-ran with identical numbers, which is what "cost nothing"
means here.

## What the gates found

Six defects, every one caught by a gate rather than by review.

| Defect | Cost | Found by |
|---|---|---|
| Mega-menu heading dropped its `mt-3` | 16px vertical shift, 25% of `ex-megamenu` | pixels |
| Mega-menu column dropped its `p-2` | 10% of `ex-megamenu` | markup diff |
| `align-to-right` on menus and sections dropped | search form and menus unpushed | markup diff |
| `margin-top` on 12 of 13 social menus dropped | every social menu shifted | audit |
| `hide-on-portrait` on links, items, logos and the panel header dropped | 11 elements visible when they should not be | audit |
| Sections rendered after menus unconditionally | drawer reordered on 2 variants | markup diff |

Plus one the planner *caused*: promoting the toggler and close control to real
`<button>`s gave them UA borders, backgrounds and a 13px font. The chevron had
carried its own reset since Stage 2; the fix is one shared rule, and its
placement took two attempts —

> Held at one class, this rule *ties* with every component rule that styles the
> same controls, so the later declaration wins. Placed anywhere below them,
> `font: inherit` beat `font-size: 25px` and the drawer's close glyph silently
> shrank from 25px to 16px in *both* harnesses: 44 renders out of
> pixel-identical, with nothing visibly broken.

Dropping to zero specificity with `:where(.navx .navx-toggler, …)` would also
have fixed the tie, and would have been wrong: Stage 2 holds resets at exactly
one class so they still beat a host page's `button { }` type selector. It is a
positioning problem, and only position fixes it.

`tools/diff-markup.mjs` came out of this. It loads `stage2.html` and
`stage5.html` for the same variant and prints the first structural differences
between legacy markup and generated markup. It found three of the six defects in
one command each, where a diff image took a screenshot and a guess.

## Gate A — cross-adapter identity

`pnpm --filter @navx/baseline-harness stage5:identity`

```
  variants          56
  pure paths        4  html(), render(), React SSR, Vue SSR
  attached paths    3  render()+attach(), <navx-preset>, use:navxPreset
  comparisons       392
  reference bytes   97,160

  every path produces byte-identical canonical DOM for all 56 variants.
```

Two groups, because `attach()` writes to the DOM — the core normalises ARIA on
whatever it is given, so an adapter that renders *and binds* cannot be compared
against one that only renders. Splitting them keeps both comparisons exact
instead of introducing an allowance list, and buys a second assertion for free:
`attach()` produces the same DOM whichever adapter called it.

Comparison is on a canonical serialisation with attributes sorted, because
attribute *order* is a framework artifact rather than a difference in the DOM.
React 19 also hoists `<link rel="preload" as="image">` ahead of its output;
selecting the nav rather than the first element is the precise fix, and it
turned 47 reported divergences back into the non-difference they were.

The Angular directive uses `render()` on the same code path as the custom
element and the Svelte action, and is covered by `packages/angular`'s own
compile gate.

## Gate B — pixels

`pnpm --filter @navx/baseline-harness stage5`

```
[stage5] compared 292 renders against linux baselines
  identical (0 px)      181
  ≤0.2% of pixels       111
  >0.2% of pixels         0
  errored                 0
```

Every render is `render(plan(preset, content))` from the *published* packages,
compared against the same Stage 0 screenshots Stage 2 uses. Stage 2 proved the
stylesheet reproduces those screenshots given legacy's markup; this proves the
markup NAVX generates from a 179-byte preset reproduces them too.

`compare-renders.mjs` serves both gates behind `--harness`, so they cannot drift
apart in tolerance or method. Stage 2, re-run after the stylesheet change:

```
[stage2] compared 292 renders against linux baselines
  identical (0 px)      184
  ≤0.2% of pixels       108
  >0.2% of pixels         0
  errored                 0
```

Identical to its pre-Stage-5 numbers. The three-render gap between 184 and 181
is the intentional divergence: NAVX drops legacy's `id="navigationN"` and ships
the toggler and close control as real buttons.

## Sizes

The walkers are subpath exports, so the headless adapters keep their Stage 4
budgets exactly.

| | gzipped |
|---|---|
| `@navx/react` | 620 B |
| `@navx/vue` | 702 B |
| `@navx/svelte` | 429 B |
| `@navx/element` | 861 B |
| `@navx/angular` | 2.1 kB |
| `@navx/presets` (planner + 28 presets) | 5.41 kB |
| `@navx/presets/demo/<one variant>` | 450 B |
| `@navx/react/preset` | 1.28 kB |
| `@navx/vue/preset` | 1.1 kB |
| `@navx/svelte/preset` | 521 B |
| `@navx/element/preset` | 780 B |

Code splitting is off in every adapter. With it on, a subpath entry that
re-exports a shared chunk made `dist/index.js` **73 bytes**, and the budget
measuring that file would have passed trivially while the real payload sat next
door — the same class of false pass as Stage 2's stale `dist`.

## Deliberate divergences from legacy

- **Trigger.** Legacy defaulted to hover; `ex-click` had to opt *in* to
  clicking. Presets set `trigger` only when the variant is specifically about
  it, and otherwise inherit the core's click default, because hover-only
  disclosure is unreachable by keyboard and hostile on touch.
- **`id`.** Legacy put `id="navigationN"` on the root. Submenu identity is
  structural now, so nothing needs it.
- **Toggler and close control.** Real `<button>`s, with accessible names.
- **`aria-label` on the close control** is a word, not the `✕` glyph. Reusing
  the glyph as the name makes a screen reader announce "multiplication x",
  which is what the first version of the planner did.

## Deferred to Stage 6

Recorded by the extractor, never dropped in silence:

```
overlayColor = "linear-gradient( 135deg, #FAD7A1 10%, #E96D71 100%)"  — ex-overlay
scrollSpy = true                                                      — ex-scrollspy
scrollSpySpeed = 600                                                  — ex-scrollspy
scrollSpyOffset = -60                                                 — ex-scrollspy
```

## Packaging notes

- **`typesVersions`** on the four tsup adapters. node10 resolution
  (`moduleResolution: "node"`) predates `exports` and cannot follow `./preset`
  into `dist`; the map means the subpath is typed for older consumers rather
  than silently untyped.
- **`attw --profile esm-only`** for `@navx/angular`, replacing Stage 4's
  `--ignore-rules cjs-resolves-to-esm`. Angular libraries have been ESM-only
  since Angular 13, so declaring what the package *is* beats silencing rules one
  at a time — and it covers the secondary entry point's node10 failure, which
  ng-packagr cannot avoid.
- **Angular secondary entry point.** `packages/angular/preset/ng-package.json`
  is APF's own mechanism; ng-packagr builds it separately and writes its own
  `exports` entry.
- **React's `tsconfig` include** was `src/**/*.ts`, which silently skipped
  `preset.tsx` — so both `typecheck` and the declaration build ignored it, and a
  real type error survived until publint noticed the missing `.d.ts`. A
  typecheck that does not read a file is not a typecheck.
