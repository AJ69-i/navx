# Stage 6 — the deferred features

Two options the Stage 5 extractor recorded rather than dropped:

```
overlayColor = "linear-gradient( 135deg, #FAD7A1 10%, #E96D71 100%)"  — ex-overlay
scrollSpy = true                                                      — ex-scrollspy
scrollSpySpeed = 600                                                  — ex-scrollspy
scrollSpyOffset = -60                                                 — ex-scrollspy
```

One of them turned out to be already implemented. The other became 1.05 kB of
pure observation, because most of what legacy wrote is now a browser feature.

---

## `overlayColor` — nothing to build

Legacy took the drawer's backdrop as a JavaScript option:

```js
NAVX.init({ overlayColor: 'linear-gradient(135deg, #FAD7A1 10%, #E96D71 100%)' });
```

The plugin wrote that to an inline style. Which meant it could not be themed,
could not respond to `prefers-color-scheme`, could not change at a breakpoint,
and could not differ between two navs unless you initialised them separately.

Stage 1 already made it a component token and Stage 2's stylesheet already reads
it, so the migration is one declaration:

```css
.navx { --navx-overlay-background: linear-gradient(135deg, #FAD7A1 10%, #E96D71 100%); }
```

"Already done" is indistinguishable from "forgot to do it" unless you measure,
so `stage6:overlay` opens a real drawer and reads the computed background:

```
Stage 6 · overlayColor as a token

  ✓ default — the token                      rgba(0, 0, 0, 0.7)
  ✓ legacy's overlayColor, as a token override   linear-gradient(135deg, rgb(250, 215, 161) 10%, …
  ✓ scoped to one nav                        rgba(0, 0, 0, 0.7)
  ✓ overlay is visible when the drawer is    opacity 1
```

The third case is the point: a token scopes like any other custom property, so
two navs on one page can have different backdrops — which the JavaScript option
never allowed.

## `scrollSpy` — 1.05 kB, and no animation

```ts
import { attach, createNav } from '@navx/core';
import { spy } from '@navx/core/scrollspy';

const machine = createNav();
const detach = attach(nav, machine);
const stop = spy(nav, machine, { offset: 64 }); // your sticky header's height
```

A subpath export, so the base core is unaffected for the navs that don't want
it. There is no flag on `attach()`; importing the module is the opt-in.

### Observe, hold, render

The module writes no nav markup at all. It reads the page, decides which section
is active, and sends `SPY_SET`. `attach()` renders `state.activeId` exactly the
way it renders `openPath` — so NAVX still has **one** module that touches the
nav's DOM, which was the Stage 3 rule and is the thing most at risk when a
feature arrives late.

```
spy() ── SPY_SET ──▶ machine ── subscribe ──▶ attach() ──▶ data-navx-current
```

`activeId` lives on `NavState`, so every adapter observes it with no new code:
React's `useSyncExternalStore`, Vue's `shallowRef`, Svelte's store contract and
Angular's signal all already subscribe to the machine. Using scroll-spy from any
framework is one effect that calls `spy()` and returns `stop`.

### What legacy did, and what the browser does now

| | legacy | Stage 6 |
|---|---|---|
| scroll animation | ~90 lines of `requestAnimationFrame` + `easeInOutCubic` | `scroll-behavior: smooth` |
| offset | arithmetic on `offsetTop` | `scroll-margin-block-start` |
| activation | `scroll` handler on every event | `IntersectionObserver` |
| measurement | `offsetTop`/`offsetHeight` cached, re-measured on resize | live rects, read on a boundary crossing |
| focus after jump | — | native fragment navigation |
| history entry | — | native fragment navigation |
| `prefers-reduced-motion` | — | native |
| listeners | 3 (`click` per link, `scroll`, `resize`) | 0 in the common path |

There is no click handler. A nav link to `#pricing` is a fragment link, and the
browser already knows how to navigate to one — smoothly, stopping short of a
sticky header, moving focus to the target, and adding a history entry so Back
works. Legacy re-implemented the first two and omitted the last two.

The cache is worth calling out separately. Legacy measured every section once at
startup and re-measured on `resize`, so any layout change that was *not* a
resize — an image loading, an accordion opening, a font swapping — left it
highlighting the wrong section until the window changed size. Reading rects live
on an observer callback costs one `getBoundingClientRect()` per section, and only
when a boundary actually moves.

### `scrollSpySpeed` is deliberately gone

A duration is the one thing native smooth scrolling will not give you. Buying it
back means an animation loop that has to fight the user's own scrolling for
control of the scroll position, and re-implement `prefers-reduced-motion` by
hand — in a library whose entire argument is that it contains no animation. So
`scrollSpySpeed: 600` has no equivalent, and this paragraph is the migration
note.

### `scrollSpyOffset` changed sign, on purpose

Legacy's offset was used two ways: added to `offsetTop` for the scroll
destination, and `Math.abs()`-ed for the activation test. `scrollSpyOffset: -60`
therefore meant "scroll 60px higher" *and* "probe 60px down".

Here `offset` is one number with one meaning: **how much room to leave above a
section**, which is your sticky header's height. Legacy's `-60` is `offset: 60`.

### `IntersectionObserver` is the trigger, not the rule

Using it to *decide* means encoding the probe line into `rootMargin`, which
needs the viewport height and therefore needs re-creating on every resize. Using
it to say "a boundary moved, look again" needs none of that. The rule stays a
one-line rect comparison — and it is exactly legacy's rule
(`top >= section.top && top < section.bottom`), in viewport coordinates.

Where `IntersectionObserver` is absent the module falls back to passive `scroll`
and `resize` listeners registered through the same `AbortController` — the same
call `attach()` makes for `ResizeObserver`, and the Baseline 2024 position: fall
back, don't polyfill.

## What the gates found

**Two items read as current at once.** The first version of the `attach()`
render skipped links whose `href` is the bare `#` placeholder, to protect a
page's own "current page" marker. The browser gate caught the consequence
immediately:

```
✗ exactly one item is marked, and it is the right one  ["#","#features"]
```

Home stayed lit while Features lit up too. On a page that scroll-spies, "where
you are" is a scroll position; a second, static answer to the same question is
just wrong. So once scroll-spy engages it owns `data-navx-current` for the whole
nav. A nav that never spies is still untouched — that is what the latch is for —
and the `written` map still restores the original marker on `detach()`.

**`MODE_SET` was the one reducer case that built a fresh state object** rather
than spreading, so adding a field to `NavState` would have silently dropped
`activeId` every time the viewport crossed 992px. Which section you are reading
is not something a resize should forget. There is now a test for it.

**The core exceeded its size budget by 27 B.** That is the cost of rendering
`activeId`, and every nav pays it including those that never spy. The budget is
raised to 4.6 kB rather than worked around, because the alternative — letting
the spy write the DOM itself — buys 27 bytes by giving up the one-DOM-writer
rule.

## Gates

```
core unit tests            37 passed  (was 23; +10 scroll-spy, +4 machine)
stage6:scrollspy           15 checks, in a real browser
stage6:overlay              4 checks
stage5 pixels              292 renders, 0 above 0.2%, 0 errored
stage2 pixels              292 renders, 0 above 0.2%, 0 errored
cross-adapter identity     392 comparisons, 0 divergences
```

The unit tests decide whether the rule is right, with stubbed rects in jsdom —
where the missing `IntersectionObserver` conveniently exercises the fallback path
for free. The browser gate decides whether that rule survives a real scroll
container, a real sticky header and a real observer, and whether the two things
handed to the browser actually happen:

```
✓ clicking a nav link lands the section below the sticky header  section top at 60px, offset 60px
✓ and the fragment reached the URL   http://localhost:4317/stage6.html?offset=60#pricing
✓ scroll-behavior is smooth, set by the module   smooth
✓ scroll-margin carries the offset   60px
```

And that it leaves nothing behind — `scroll-behavior` and `scroll-margin` are
written to the *page's* elements, not the nav's, so they would outlive the nav
that set them:

```
✓ teardown removes scroll-behavior
✓ teardown removes scroll-margin
✓ teardown clears the machine
✓ teardown restores the markup's own current marker
✓ after teardown, scrolling is inert
```

## Sizes

| | gzipped |
|---|---|
| `@navx/core` | 4.53 kB |
| `@navx/core/scrollspy` | 1.05 kB |

A nav with scroll-spy costs 5.58 kB of JavaScript. One without still costs
4.53 kB.
