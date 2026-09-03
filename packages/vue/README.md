# @navx/vue

The Vue binding for [`@navx/core`](../core). **702 B gzipped** — one composable,
and no navigation logic in it.

```sh
npm install @navx/vue @navx/styles @navx/tokens
```

```vue
<script setup lang="ts">
import { useNav } from '@navx/vue';

const { navRef, state, send } = useNav();
</script>

<template>
  <nav class="navx" ref="navRef">
    <button class="navx-toggler" type="button">Menu</button>

    <div class="navx-panel">
      <ul class="navx-menu">
        <li class="navx-item">
          <div class="navx-link">
            <a href="/products">Products</a>
            <button class="navx-chevron" type="button" aria-label="Products submenu"></button>
          </div>
          <ul class="navx-submenu">
            <li class="navx-submenu-item"><a href="/laptops">Laptops</a></li>
          </ul>
        </li>
      </ul>
    </div>
  </nav>

  <p v-if="state.panelOpen">The drawer is open</p>
</template>
```

Keyboard navigation, ARIA, focus management, the breakpoint, the scroll lock and
teardown all live in the core. `state` and `send` are there for the times your
own UI needs to read or drive the nav.

## `shallowRef`, and then `shallowReadonly`

Snapshots from the machine are already immutable, and their *identity* carries
meaning: `reduce()` returns the same object when a transition changes nothing,
which is what lets a `ResizeObserver` firing on every pixel of a window drag
cost one comparison instead of a render.

Vue's deep reactivity would destroy that, twice over, so this composable avoids
it twice:

```ts
const state = shallowRef<NavState>(machine.getState()); // not ref()
return { state: shallowReadonly(state) };               // not readonly()
```

`ref()` would walk each snapshot and hand you a **proxy** of it, so
`state.value === machine.getState()` would be false and every identity guarantee
above would quietly stop holding — while also paying a traversal per transition
for an object that never mutates.

`readonly()` is the subtler of the two, because it looks like the right way to
publish a read-only view: it is *deep*, so reading `.value` through it returns
`readonly(snapshot)` — a proxy again, reintroducing at the last step exactly what
`shallowRef` was chosen to avoid. Vue skips frozen objects, which is why this
kind of bug survives a casual test. `shallowReadonly` blocks assignment to
`.value` and returns the snapshot itself. There is a test for precisely this:

```ts
expect(state.value).toBe(machine.getState());
```

## `flush: 'post'`, and the scope

The element is watched rather than bound in `onMounted`, so a host element
replaced by a `v-if` or a `:key` change is followed — the old one is detached
before the new one is attached.

```ts
watch(navRef, (element) => { … }, { flush: 'post' });
```

Post-flush because `attach()` reads layout to resolve bar mode from panel mode,
and the default pre-flush timing would run it before Vue has patched the DOM.

Teardown hangs off `onScopeDispose`, not `onUnmounted`, so the composable also
works inside an `effectScope()` with no component instance — which is how it is
tested, and how you would share one nav across a route group.

## Options

`useNav()` takes everything [`attach()`](../core#options) takes, plus:

| option | type | |
|---|---|---|
| `machine` | `NavMachine` | Share one nav across components. Yours to own — the composable will not dispose it. |
| `mode` | `'bar' \| 'panel'` | Starting mode, corrected from the stylesheet on the first read. |

A machine the composable creates is disposed when the scope stops. A machine you
pass in is not, because disposing it would silently drop subscribers you added
elsewhere.

```ts
// nav.ts — one nav, injected wherever it is needed
export const machine = createNav();

// any component
const { navRef, state } = useNav({ machine });
```

## Returns

| | |
|---|---|
| `navRef` | `ref="navRef"` on the element carrying `class="navx"`. |
| `state` | A shallow-readonly ref holding `{ mode, panelOpen, openPath }`. |
| `send` | Dispatch a `NavEvent`. |
| `machine` | The machine itself, for `subscribe` or to provide. |

## Requirements

Vue 3.2 or later — `effectScope` and `onScopeDispose` are the floor. Works in
the Options API too; `useNav()` is callable from `setup()`.

MIT. Part of [NAVX](../../README.md).
