# @navx/react

The React binding for [`@navx/core`](../core). **620 B gzipped** — one hook, and
no navigation logic in it.

```sh
npm install @navx/react @navx/styles @navx/tokens
```

```tsx
import { useNav } from '@navx/react';

export function Header() {
  const { ref, state, send } = useNav();

  return (
    <nav className="navx" ref={ref}>
      <button className="navx-toggler" type="button">Menu</button>

      <div className="navx-panel">
        <ul className="navx-menu">
          <li className="navx-item">
            <div className="navx-link">
              <a href="/products">Products</a>
              <button className="navx-chevron" type="button" aria-label="Products submenu" />
            </div>
            <ul className="navx-submenu">
              <li className="navx-submenu-item"><a href="/laptops">Laptops</a></li>
            </ul>
          </li>
        </ul>
      </div>
    </nav>
  );
}
```

That is the whole integration. Keyboard navigation, ARIA, focus management, the
breakpoint, the scroll lock and teardown all live in the core;
`state` and `send` are there for the times your own UI needs to read or drive
the nav.

## `useSyncExternalStore`, and why it matters here

The machine is an external store — it is mutated by pointer events, a
`ResizeObserver` and the keyboard, none of which are React state updates. Read
that store with `useState` + `useEffect` and a concurrent render can observe one
snapshot in one component and a newer one in the next: [tearing][tearing].

```ts
useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
```

Three properties make this exact rather than approximate:

**`reduce()` returns the same object when nothing changed.** A `MODE_SET` from a
`ResizeObserver` firing on every pixel of a window drag costs one identity
comparison, not a re-render. `useSyncExternalStore` compares snapshots with
`Object.is`, so this is the whole optimisation — there is no memo to maintain
and no equality function to get wrong.

**`getSnapshot` doubles as `getServerSnapshot`.** The machine has no DOM
dependency, so the server snapshot is the real initial state rather than a
placeholder, and hydration has nothing to reconcile. Submenu identity is
structural — depth plus child index, not a generated id — so the ids the server
computes are the ids the client computes.

**The element arrives through a ref callback, not an effect.** An effect keyed
on `[]` never sees a host element replaced by a re-key or a conditional branch,
and would leave the old node bound and the new one dead. The callback fires on
every swap, so `attach`/`detach` follow the actual node.

Strict Mode's double mount is therefore uneventful: the second mount detaches
what the first attached, and `detach()` restores every attribute to the value it
recorded.

## Options

`useNav()` takes everything [`attach()`](../core#options) takes, plus:

| option | type | |
|---|---|---|
| `machine` | `NavMachine` | Share one nav across components. Yours to own — the hook will not dispose it. |
| `mode` | `'bar' \| 'panel'` | Starting mode, corrected from the stylesheet on the first read. |

A machine the hook creates is disposed on unmount. A machine you pass in is not,
because disposing it would silently drop subscribers you added elsewhere:

```tsx
const machine = useMemo(() => createNav(), []);

<Header machine={machine} />
<Breadcrumbs machine={machine} />  // reads the same state
```

## Returns

| | |
|---|---|
| `ref` | Put it on the element carrying `class="navx"`. |
| `state` | `{ mode, panelOpen, openPath }` — an immutable snapshot. |
| `send` | Dispatch a `NavEvent`. |
| `machine` | The machine itself, for `subscribe` or to pass down. |

## Requirements

React 18 or later, because `useSyncExternalStore` is. The `use-sync-external-store`
shim is deliberately *not* a dependency: it would put a second store
implementation into every consumer's bundle to support a version of React that
this adapter's correctness argument does not apply to anyway.

MIT. Part of [NAVX](../../README.md).

[tearing]: https://react.dev/reference/react/useSyncExternalStore
