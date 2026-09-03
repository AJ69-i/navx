# Stage 2 — the stylesheet, and what changed against the baselines

The gate for Stage 2 was never "no pixels moved". Stage 2 deliberately *removes*
things — 18 `!important`s, 60 physical-direction properties, 52 duplicated media
queries, ten skin stylesheets — and some of what it removes was load-bearing for
bugs. The honest gate is **every difference explained, then fixed or explicitly
approved**, which is what this document is.

## Result

292 approved Stage 0 screenshots, three viewports, replayed against the new
stylesheet with legacy markup put through the mechanical class transform:

```
compared 292 renders against darwin baselines     compared 292 renders against linux baselines
  identical (0 px)      246                         identical (0 px)      184
  ≤0.2% of pixels        46                         ≤0.2% of pixels       108
  >0.2% of pixels         0                         >0.2% of pixels         0
  errored                 0                         errored                 0
```

Both platforms pass; the largest single difference on either is **0.14%** of
one render.

The gap between the two columns is itself informative rather than noise. 61 of
the Linux residuals are one cause — the broken-image alt text of cause 1 below
— and macOS Chromium does not paint that text at all, so those 61 come out
pixel-identical there. 184 + 61 ≈ 246. That the two platforms differ by exactly
the size of a diagnosed cluster is a second, independent confirmation that
nothing else was hiding inside it.

Reproduce with:

```sh
cd tools/baseline
npm run stage2                 # all three viewports
npm run stage2 -- --project desktop --filter ex-megamenu
```

`reference/stage2/report.json` carries the per-render numbers;
`reference/stage2/*/*.diff.png` the images.

## The remaining differences

Enumerated against the Linux set, because it is the larger of the two and
contains everything the macOS set does. Every one of the 108 is one of five
causes; all are ≤0.14%, and all are below the `maxDiffPixelRatio: 0.002`
tolerance the Stage 0 config uses for its own reruns.

### 1. Broken-logo alt text — 61 renders, 92px each · **approved**

The `ex-*` fixtures reference `Examples/hover_files/logo.png`, which does not
exist in the legacy tree, so both harnesses render the broken-image alt text
"logo". Legacy leaves that anchor at Bootstrap's `a { color: #007bff }`; NAVX
resets anchors inside the nav to `color: inherit`, so the alt text is dark
instead of blue.

With a logo that loads, zero difference. The reset is deliberate: a component
library that leaves stray anchors at the host's link colour is not consistent.

### 2. Badge on an icon item — 12 renders (`navigation43`, `navigation45`) · **approved, a bug fix**

Legacy hides the label of an icon item at desktop with:

```css
.navigation-icon-item .navigation-link span:not(.submenu-indicator) { display: none }
```

`.navigation-badge` is a `<span>`, so the badge is hidden too — and two rules
later legacy positions that hidden badge with `right: 10px`, which is the
author telling us it was meant to be visible. NAVX excludes `.navx-badge` from
the label rule, so the notification count on an icon item now shows.

### 3. Skin accents on icon items — 8 renders · **approved, a consolidation**

Legacy's ten skin stylesheets carried **three different** exclusion lists for
which items may take an accent: `boxed` excluded icon items, avatar items,
logos and the brand; the border skins excluded icon items and the brand but not
avatars or logos; `mini-circle` and `colored` excluded avatars and logos but not
icon items. Hand-maintained, ten times over.

One base stylesheet and ten token overlays needs one answer per mechanism:

- **shape and fill skins** never decorate the brand, a logo or an avatar;
  whether they decorate a bare **icon** item is a token,
  `--navx-link-decoration-background-icon`, which `colored`, `mini-circle` and
  `bottom-arrow` set and `boxed` / `rounded-boxed` leave transparent — matching
  legacy exactly, without a hand-maintained selector.
- **border skins** never accent the brand, an icon item or the social row, and
  the accent border's *width* is declared on the same scoped selector, so a
  skin can never make one link taller than its neighbours.

### 4. Sub-pixel arrow rendering — 20 renders, 1–3px each · **noise**

A 6px box rotated 45° lands on a fractional pixel; a one- or two-pixel
difference in its anti-aliasing survives. Element geometry is identical
(`npm run stage2:probe -- ex-multidropdown submenu-nested` reports 0 elements
moved).

### 5. Hairline positions in panel mode — 7 renders, ≤484px · **noise**

`#e9ecef` hairlines landing on the other side of a fractional boundary.
Geometry identical; below pixelmatch's 0.15 colour threshold, which is why the
counted number is a fraction of the pixels that technically differ.

## Six regressions the baselines caught

Worth recording, because none would have been found by reading the CSS.

**1. `container-type` makes an ancestor a flex container's abspos origin.**
Legacy declared `position: absolute` on every submenu and then set *no block
offset*, relying on the static position. That is stable until an ancestor
becomes `display: flex` — the static position of an abspos child of a flex
container is the container's content-box corner, not the flow position. Every
menu in the library jumped to the top of the bar. Fixed by naming the offset
(`inset-block-start: 100%`) and making the submenu item the containing block so
a nested menu can say `inset-block-start: 0` and mean "level with my own row".

**2. `@layer` handed the whole stylesheet to the host page.** See
[the layer note](#the-layer-decision) below.

**3. `.navx a` outranked `.navx-link`.** A reset written as `.navx a` is
(0,1,1) and beats every single-class component rule — including the link's own
colour. `.navx :where(a)` is (0,1,0): still above a host reset's bare `a`, level
with the components, and declared before them. This one cost 55 renders' worth
of wrong link colour and hid inside the ≤0.2% bucket until the reset was fixed.

**4. Utilities could not win without `!important`.** Legacy spent
`display: none !important` on `.hide-on-landscape` / `.hide-on-portrait` and it
genuinely needed it: `.navx-logo > a`, `.navx-social .navx-item` and
`.navx-form .navx-btn` all outrank a one-class utility. Lowered with `:where()`
and now asserted — `npm run stage2:utilities` applies each utility to thirteen
element kinds in both modes and fails if any survives.

**5. The indent ladder was off by one level.** Legacy's ladder is
`.navigation-dropdown-link + ul .navigation-dropdown-link`, which starts at the
*second* level; `.navx-submenu .navx-submenu-link` starts at the first. Shifting
it also let the ladder move inside the panel-mode container query, which
retired legacy's `padding-left: 19px !important` undo rule in the bar.

**6. An unscoped open-state rule reversed every nested arrow.**
`.navx-chevron[data-navx-state='open']` outranked the submenu's own rotation by
source order, so opening a nested menu pointed its arrow down instead of along
the inline axis. Scoped to `.navx-link >`.

## The layer decision

Stage 2 was specified with `@layer`, and layers were the first draft: five
layers, `base → layout → components → variants → state`, and all 18
`!important`s gone.

Then `tools/baseline/tools/layer-loss.mjs` measured the cost. It snapshots the
computed style of every element in the nav, re-injects the same stylesheet with
its layer wrappers removed, and reports every property that changed — each one a
declaration NAVX loses *only* because it is layered. Against the harness's
Bootstrap 4 page:

```
58 declaration(s) lost to unlayered host CSS:
  nav.navx        display: got "block", NAVX declares "flex"
  ul.navx-menu    margin-bottom: got "16px", NAVX declares "0px"
  a.navx-link     color: got "rgb(0, 123, 255)", NAVX declares "rgb(115, 103, 240)"
  …
```

Unlayered CSS beats layered CSS at every specificity, so Reboot's one-type
selector `nav { display: block }` defeats `@layer navx.base { .navx { display: flex } }`
and the navbar stops being a flex container. In the most widely deployed CSS
framework on the internet.

So the shipped file is unlayered and the layer is the consumer's to assign,
which is where the CSS WG landed too:

```css
@import url('@navx/styles/navx.css') layer(navx);
```

`dist/navx.layer.css` is the same file pre-wrapped for `<link>`-only setups.
The guarantee layers were bought for — override without `!important` — is now a
build gate instead: **no ids, at most four class-level components per
selector**, checked on every build, plus the utility assertion above. The
detector is kept as a regression test; it currently reports *no NAVX declaration
is beaten by the host page*.

## RTL

Legacy's Arabic renders were captured in Stage 0 as a reference gallery and
never asserted, because with 60 physical-direction declarations they are
known-broken. A gallery proves nothing by itself, so
`tools/baseline/tools/rtl-audit.mjs` runs four mechanical checks against both
stylesheets, on all 56 variants:

| check | legacy | @navx/styles |
| --- | --- | --- |
| chevron on the wrong side | 35 | **0** |
| chevron drawn over its label | 18 | **0** |
| leading icon trailing its label | 0 | 0 |
| drawer opens from the wrong edge | 56 | **0** |

```sh
npm run stage2:rtl -- --project mobile
npm run stage2:rtl-sheet -- ex-hover mobile 0,60,412,240   # before/after image
```

Two findings are worth keeping:

**The overlap was not a logical-property problem.** Logical properties put the
arrow at the inline end correctly, but Bootstrap 4 ships
`body { text-align: left }` — physical, inherited — so the label stayed pinned
left while the arrow moved, and they collided. `.navx { text-align: start }` is
the whole fix, and in LTR it computes to `left`, which is why no baseline moved.

**Not every arrow should flip.** The original token flipped *all* chevron
rotations in RTL, which pointed every panel-mode arrow upward: a submenu that
expands downward expands downward in Arabic too. The token is now split by axis
— `--navx-chevron-rotation-block` (never flips) and
`--navx-chevron-rotation-inline` (flips) — so the RTL block is one declaration.

## Tools

All under `tools/baseline`, all read-only with respect to the Stage 0
baselines.

| script | question it answers |
| --- | --- |
| `npm run stage2` | how far did each render move? |
| `stage2:probe <id> [state]` | *which element* moved, by how much, in which axis |
| `stage2:boxes <name>` | where in the frame are the changed pixels |
| `stage2:colours <name>` | which colour became which — one pair means a wrong token |
| `stage2:sheet <name> [proj] [crop]` | baseline / actual / diff, stacked |
| `stage2:layers` | which declarations does the host page beat |
| `stage2:utilities` | can a one-class utility still win, with no `!important` |
| `stage2:rtl` | the four RTL checks, legacy vs new |
| `stage2:rtl-sheet <id>` | legacy RTL above new RTL |

`tools/projects.mjs` defines the three capture profiles once and is imported by
both `playwright.config.ts` and the comparison script. That file exists because
duplicating them cost twice: a missing `{platform}` in the snapshot path, and a
mobile viewport typed as 412×915 — the Pixel 7's *screen* height — against
baselines captured at 412×839.

## Not covered

- **Windows.** macOS and Linux both pass. Text rasterises differently per
  platform, so each keeps its own approved set and a third would need its own
  Stage 0 capture before it could be compared.
- **Ten `ex-*--panel-open` renders on mobile.** Stage 0 captured `panel-open`
  in the layout corpus only, so there is nothing approved to compare against in
  the behaviour corpus. The comparison names them rather than counting them
  silently.
- **Behaviour.** Nothing here tests interaction; the harness drives state with
  data attributes. That is Stage 3.
