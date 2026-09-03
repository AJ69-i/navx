# Stage 3 — the headless core

Scope of record for `@navx/core`. Written before the code, so the decisions in
it can be argued with rather than discovered in a diff.

## What legacy's JavaScript actually does

699 lines, read in full. Fifteen defects, grouped by what they cost.

### It leaks, and that is the headline

**The instance *is* the DOM node.** `nav = element`, then nine properties are
written onto it: `init`, `options`, `navigationBody`, `menuItems`, `menuLinks`,
`overlayPanel`, `toggleOffcanvas`, `showSubmenu`, `hideSubmenus`. Every one
closes over the plugin scope, so the `<nav>` element and the entire closure
reference each other.

**There is no `destroy()`.** `turnOffEvents()` exists but only detaches the
per-item handlers. These survive it, forever:

| listener | attached to | removed | when |
| --- | --- | --- | --- |
| `resize` → `navigationMode` | `window` | never | always |
| `touchstart.body` | `document` | never | `hideSubWhenClickOut` (default on) |
| `click.body` | `document` | never | `hideSubWhenClickOut` (default on) |
| `resize.scrollSpy` | `window` | never | `scrollSpy: true` |
| `scroll.scrollSpy` | `window` | never | `scrollSpy: true` |
| `click` → `toggleOffcanvas` | overlay panel | never | `overlay` (default on) |

Measured rather than counted from the source: `tools/leak-test.mjs` reads the
browser's own listener registry through CDP and finds **three** global
listeners left behind per mount with default options — the first three above —
rising to five with `scrollSpy` enabled. The overlay handler leaks with its
element rather than on a global, so it does not appear in that count.

Each holds the closure, the closure holds the node, the node holds the subtree.
Unmount a route in any SPA and the whole navbar stays resident; mount it again
and you have two of everything. Four mount/unmount cycles leave twelve. This is
the defect the rebuild exists to fix.

**`window.onload = function(){ scrollSpy(); }`** — assignment, not
`addEventListener`, outside `init()`. It silently clobbers any other
`window.onload` on the page and cannot be undone.

### It pollutes globals

```js
window.on = document.on = Element.prototype.on = events.on;
window.off = document.off = Element.prototype.off = events.off;
window.check = document.check = Element.prototype.check = events.check;
```

Three properties on `Element.prototype`, executed at *module evaluation* —
before any nav exists. Importing the library changes every element on the page
and collides with anything else that defines `.on()`.

Worse, the shim stores handlers as `element.namespaces[eventName] = callback`,
one slot per event name. A second `click.link` on the same element overwrites
the first, which stays attached and becomes unremovable.

### It is unusable without a mouse

No `keydown` handler exists anywhere in the file. Submenus open on `click` or
`mouseenter` only. Escape does nothing, arrows do nothing, and there is no ARIA
at all — no `aria-expanded`, `aria-controls`, `aria-current`, no roles. A screen
reader is handed an undifferentiated list of links with no indication that a
submenu exists, let alone whether it is open.

The only reason a keyboard reaches a submenu at all is an accident: Enter on an
`<a href>` fires `click`, which the handler intercepts.

### Smaller, but real

- **`e.target` where `e.currentTarget` is meant.** `e.target.parentNode.classList.contains("has-submenu")` — when the link wraps an `<i>` or `<span>`, as every icon item does, `e.target` is that child and the check fails. Those submenus never open.
- **Manual navigation.** After `preventDefault()`, `window.location.href = e.target.getAttribute("href")`. Breaks middle-click, ⌘/ctrl-click, `target`, `download`, `<base>` resolution, and every SPA router.
- **Forced synchronous layout per resize.** `fixSubmenuRightPositionAll()` interleaves `offsetWidth`/`offsetLeft` reads with `style.right` writes, once per submenu, unthrottled.
- **Mode detection that cannot work.** `bigScreenFlag` and `smallScreenFlag` are both reassigned to the current width at the end of every call, so each branch compares width against width rather than against a remembered mode.
- **UA sniffing, inverted.** `navigator.userAgent.match(/Mobi/i)`, plus `maxTouchPoints > 1 && hoverEnabled` — which selects *click* for a touch device that *does* support hover, the opposite of the intent for a hybrid laptop.
- **Uncancellable timers.** `hideSubmenus` staggers closes with `setTimeout(…, 100 * i)` and keeps no handles, so a teardown mid-animation leaves callbacks writing to detached nodes.
- **`init()` throws** on any variant lacking a toggler or close button: `getElementsByClassName(…)[0].on(…)` with no guard.

## Architecture

### Two layers, and the boundary between them is the point

```
@navx/core
├── createNav(config)          pure state machine · no DOM · SSR-safe · Node-testable
└── attach(element, machine)   the only file that touches the DOM
```

The machine knows *what is open*; it does not know that a DOM exists. It is a
plain object with `send(event)`, `getState()`, `subscribe(fn)` and a transition
table, constructible and fully testable in Node with no jsdom.

`attach()` is the single DOM-aware module: it reads the markup once, wires one
delegated listener set, subscribes to the machine, and writes attributes.

This split is what makes Stage 4's adapters *thin*. React does not want a
library writing to its DOM — it wants the state and will render it itself, so
`useNav()` is a `useSyncExternalStore` over the machine and nothing more.
`@navx/element` and vanilla users take `attach()`. Neither path reimplements the
logic.

### The instance is not the element

```ts
const nav = createNav({ trigger: 'click' })
const detach = attach(document.querySelector('.navx'), nav)
// …
detach()          // idempotent; restores the DOM to exactly its pre-attach state
```

Nothing is written onto the element except `data-navx-*` attributes, all of
which `detach()` removes. No prototypes are touched. The element does not
reference the instance.

### One `AbortController`, no exceptions

Every listener, every observer, every timer is registered through one scope:

```ts
const ac = new AbortController()
const { signal } = ac

root.addEventListener('click', onClick, { signal })
document.addEventListener('keydown', onKey, { signal })
new ResizeObserver(onResize).observe(root)          // disconnected on abort
```

`detach()` calls `ac.abort()` and disconnects the observers. There is no
per-listener bookkeeping to get wrong, which is precisely how legacy lost six of
them. A build gate will fail on any `addEventListener` in `packages/core`
without a `signal`.

### Event delegation, not per-node listeners

Legacy attaches to every item and every link, then must find them all again to
detach — and re-attaches the whole set on every breakpoint crossing. The core
attaches **one** listener per event type on the root and resolves the target
with `closest()`. Menus added or removed after attach work with no re-init, and
teardown is one `abort()`.

### The mode comes from the stylesheet, not from a second copy of the breakpoint

Stage 2 made bar/panel a container query. If the core also stored `992`, the two
would drift — which is legacy defect eleven. Instead the stylesheet publishes
its own answer and the core reads it:

```css
.navx-panel { --navx-mode: panel; }
@container navx (min-width: 992px) { .navx-panel { --navx-mode: bar; } }
```

```ts
const mode = getComputedStyle(panel).getPropertyValue('--navx-mode').trim()
```

Verified in Chromium: reads `bar` at 1440px and `panel` at 412px. It is read
from `.navx-panel` rather than `.navx` because an element cannot query its own
container — the same rule that bit Stage 2. A `ResizeObserver` on the root
re-reads it, so the read always happens in a layout-settled callback and the
number `992` appears exactly once in the codebase, in the CSS.

## Behaviour

### ARIA: disclosure navigation, not a menubar

The APG has two patterns and they are not interchangeable. `role="menubar"` /
`role="menuitem"` is for *application* menus — it removes every link from the
screen reader's links list, breaks in-page search, and makes Tab exit the whole
bar. The APG says so explicitly. Site navigation wants **Disclosure Navigation**:
real `<a>` elements that stay links, plus a disclosure button per submenu.

The markup contract for a submenu trigger:

```html
<li class="navx-item">
  <a class="navx-link" href="/products">Products</a>
  <button class="navx-chevron" aria-expanded="false" aria-controls="m-products">
    <span class="navx-sr">Products submenu</span>
  </button>
  <ul class="navx-submenu" id="m-products">…</ul>
</li>
```

The link navigates. The button expands. They are different affordances because
they do different things — which also gives legacy's `submenuIndicatorTrigger`
option a real implementation instead of a class on a `<span>`.

The core writes: `aria-expanded`, `aria-controls`, `aria-current="page"`,
`aria-label` on the toggler, `aria-hidden` + `inert` on the background while the
drawer is open. It creates no elements and no ids it did not find.

### Keyboard

| key | where | does |
| --- | --- | --- |
| `Tab` | anywhere | moves through links and buttons in DOM order — never trapped, except inside the open drawer |
| `Enter` / `Space` | chevron button | toggles that submenu |
| `Escape` | anywhere in an open menu | closes the innermost open menu, returns focus to its trigger |
| `↓` / `↑` | bar item | opens the submenu and moves to its first/last item |
| `↓` / `↑` | inside a submenu | previous/next item, wrapping |
| `→` / `←` | inside a submenu | opens/closes a nested submenu — flipped in RTL, read from `dir` |
| `Home` / `End` | inside a submenu | first/last item |
| `Escape` | open drawer | closes it, restores focus to the toggler |

Arrow keys are an *enhancement layered on the disclosure pattern*: they add
movement without changing a single role, so nothing is taken away from a screen
reader user to give something to a keyboard user.

### The drawer is modal, so it behaves like one

Focus moves into it on open and is trapped until close; the background gets
`inert`; the scroll position is locked without layout shift; Escape and an
outside click both close it; focus returns to the toggler. Legacy did none of
this — the drawer opened and focus stayed behind it, in content the user could
not see.

### Hover

Available, not default. A hover-only menu fails WCAG 1.4.13, so `trigger:
'hover'` means hover **plus** focus-within to open, Escape to dismiss, and a
short close delay so a diagonal mouse path to the submenu does not dismiss it.
Legacy's `mouseleave` geometry check is replaced by that delay: simpler, and it
does not read layout on every pointer exit.

## Results

### The leak

`npm run stage3:leak` runs both implementations through the same fixture and
the same harness, reading the browser's own listener registry through CDP:

```
          baseline  attached  after teardown  after 4 mounts  element freed
legacy    0         3         3               12              NO — still referenced
navx      0         2         0               0               yes
```

Legacy leaks `window.resize`, `document.touchstart` and `document.click` on
every mount and they accumulate linearly. `@navx/core` attaches two, removes
both, and the element is collected.

Getting that last column trustworthy took three tries, and the failures are
worth recording because each was the instrument rather than the code:

1. **`getEventListeners` retains the handlers.** Measuring the listeners handed
   the inspector a live reference to every handler closure — which closes over
   the nav element — so the measurement kept the subject alive. Fixed by
   releasing each handler's remote object.
2. **`WeakRef.deref()` resurrects.** It is specified to keep its referent alive
   for the remainder of the current job, so a loop polling "collected yet?"
   every 25ms prevented the very collection it was testing for. The check now
   happens exactly once, never in a loop.
3. **`globalThis.gc()` asks the wrong heap.** A detached DOM subtree lives in
   Blink's heap, not V8's, and the two are reclaimed on separate schedules.
   `HeapProfiler.collectGarbage` over CDP — the lever DevTools' own button
   pulls — collects both, twice: once to break the cross-heap cycle, once to
   reclaim it.

The result is deterministic: ten consecutive runs, ten passes, with legacy
still correctly reporting a leak. A gate that fails one run in six teaches
people to re-run it until it goes green, which is worse than not having one.

### Keyboard and ARIA

`npm run stage3:a11y`, axe-core plus scripted keyboard walks:

| behaviour | legacy | @navx/core |
| --- | --- | --- |
| disclosure reachable by Tab | no | **yes** |
| Enter opens its own menu | no | **yes** |
| `aria-expanded` tracks the state | no | **yes** |
| disclosure has an accessible name | no | **yes** |
| ArrowDown moves into the open menu | no | **yes** |
| Escape closes it and restores focus | no | **yes** |

axe reports no violation under `@navx/core` that legacy did not already have.
Two remain in both — `color-contrast` and `button-name` on the fixtures'
icon-only buttons — and they are inherited from markup Stage 3 cannot fix
without inventing content. They belong to Stage 5, where the markup becomes
ours.

The gate is "no new violations", not "no violations". A gate that can never
pass is a gate nobody runs.

### The pixels did not move

`<span>` chevron → `<button>`, `--navx-mode` published, and open-menu emphasis
split from current-page emphasis — all three are markup and CSS changes, and
all three had to be free. Stage 2's gate, re-run against all 292 approved
baselines: **184 identical, 108 within 0.2%, none above, none errored** —
byte-for-byte the numbers from before Stage 3 touched anything.

### Source-level gates

`packages/core/test/lifecycle-discipline.test.ts` fails the build on any
`addEventListener` without a signal, any write onto the host element or a
prototype, and any mention of the DOM inside the machine. Legacy's
`turnOffEvents()` was correct the day it was written; five more listeners were
added around it afterwards. These are the check that the same drift cannot
happen here.

## Out of scope

- Scroll behaviours, scrollspy, hide-on-scroll — Stage 6.
- Adapters — Stage 4. The core ships framework-free with no peer dependencies.
- Presets — Stage 5.
