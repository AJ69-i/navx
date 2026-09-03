# @navx/core

The headless navigation core. **4.2 kB gzipped**, no dependencies, no framework,
and a `detach()` that provably returns the page to exactly what it was.

```sh
npm install @navx/core
```

```ts
import { createNav, attach } from '@navx/core';

const nav = createNav();
const detach = attach(document.querySelector('.navx'), nav);

// later — a route unmounts, a component is destroyed
detach();
```

## Two layers, and the boundary is the point

```
createNav(config)          a pure state machine. No DOM, no globals.
attach(element, machine)   the only module that touches a document.
```

The machine knows *what is open*. It does not know a document exists, so it is
SSR-safe, and its entire behavioural surface is testable in Node in
milliseconds with no jsdom and no browser.

That split is what makes framework adapters thin. React does not want a library
writing to its DOM — it wants the state and will render it itself, so `useNav()`
is a `useSyncExternalStore` over the machine and nothing else. Vanilla and
custom-element consumers take `attach()`. Neither path reimplements the logic.

```ts
import { createNav, isOpen } from '@navx/core';

const nav = createNav({ mode: 'bar' });
nav.subscribe((state) => render(state));
nav.send({ type: 'SUBMENU_TOGGLE', path: ['1.2'] });

nav.getState(); // { mode: 'bar', panelOpen: false, openPath: ['1.2'] }
isOpen(nav.getState(), ['1.2']); // true
```

`openPath` is a chain rather than a set, so "one menu open per level" is an
invariant of the data structure instead of a rule six call sites have to
remember.

## The leak, and how it is proven gone

Legacy's navbar could not be unmounted. It had no `destroy()`, and six
listeners on `window` and `document` outlived every teardown — each holding a
closure holding the `<nav>` element holding its whole subtree.

`tools/baseline/tools/leak-test.mjs` measures it rather than asserting it,
reading the browser's own listener registry through CDP and checking a `WeakRef`
after a forced GC:

```
          baseline  attached  after teardown  after 4 mounts  element freed
legacy    0         3         3               12              NO — still referenced
@navx     0         2         0               0               yes
```

Three mechanisms keep it that way:

**One `AbortController`.** Every listener, observer and timer hangs off one
signal, and `detach()` calls `abort()`. There is no per-listener bookkeeping to
get wrong, which is exactly how legacy lost six of them.

**Nothing is written onto the element.** No expando properties, no
`Element.prototype` patches, no injected nodes, no generated ids. Only
`data-navx-*` and ARIA attributes, each recorded with its prior value so
teardown is a replay rather than a guess.

**Event delegation.** One listener per event type on the root, resolved with
`closest()`. Menus added or removed after attach work with no re-init.

All three are enforced at build time by `test/lifecycle-discipline.test.ts`,
which fails on any `addEventListener` without a signal, any write onto the host
element or a prototype, and any mention of the DOM inside the machine.

## Accessibility

The APG's **disclosure navigation** pattern, not `role="menubar"` — menubar
roles remove every item from a screen reader's links list and make Tab exit the
whole bar, which is a net loss for site navigation. Links stay links; a
disclosure `<button>` beside each one carries `aria-expanded`.

| behaviour | legacy | @navx/core |
| --- | --- | --- |
| disclosure reachable by Tab | no | **yes** |
| Enter opens its menu | no | **yes** |
| `aria-expanded` tracks state | no | **yes** |
| disclosure has an accessible name | no | **yes** |
| ArrowDown moves into the menu | no | **yes** |
| Escape closes and restores focus | no | **yes** |

Legacy has no `keydown` handler anywhere in its 699 lines, so that column is
not a comparison so much as a list of things a keyboard user could not do.

Arrow keys are layered *on top of* the disclosure pattern rather than replacing
it: no role changes, so nothing is taken from a screen-reader user to give
something to a keyboard user. `←`/`→` follow `dir`, so they flip in Arabic.

The core writes ARIA the markup should have carried, and only what the element
can legally hold — a `<div>` toggler gets `role="button"` and `tabindex` before
it gets `aria-expanded`, because the attribute is otherwise ignored and the
state is announced to nobody.

## Options

```ts
attach(el, nav, {
  trigger: 'click',              // 'hover' also opens on focus and closes on Escape
  hoverCloseDelay: 220,
  dismissOnOutside: true,
  modal: true,                   // drawer traps focus, inerts the page, locks scroll
  labelDisclosure: (t) => `${t} submenu`,
  labelToggler: 'Menu',
  labelClose: 'Close menu',
});
```

`trigger` defaults to `'click'`, changed from legacy's `'hover'`. Hover is
available and implemented properly — open on hover *and* focus-within,
dismissible with Escape, with a close delay so a diagonal path to the submenu
does not lose it — but a hover-only menu fails WCAG 1.4.13, and click is
predictable on touch, keyboard and mouse alike.

The three label options exist because "submenu" is a word in one language.

## The breakpoint is not in here

`@navx/styles` makes bar/panel a container query and publishes its own answer:

```css
.navx-panel { --navx-mode: panel; }
@container navx (min-width: 992px) { .navx-panel { --navx-mode: bar; } }
```

The core reads that property through a `ResizeObserver`. The number `992`
appears once in the codebase, in the CSS, so the two cannot drift — legacy kept
a copy in JavaScript and its mode detection was broken as a result.

## Links are left alone

No `preventDefault()` on a link, ever. ⌘-click, middle-click, `target`,
`download`, `<base>` resolution and every SPA router keep working. Legacy called
`preventDefault()` and then assigned `window.location.href`, which broke all of
them.

MIT.
