# @navx/svelte

The Svelte binding for [`@navx/core`](../core). **429 B gzipped** — the smallest
adapter in the set, because Svelte's own primitives fit the core exactly.

```sh
npm install @navx/svelte @navx/styles @navx/tokens
```

```svelte
<script lang="ts">
  import { navStore, navx } from '@navx/svelte';

  const nav = navStore();
</script>

<nav class="navx" use:navx={{ nav }}>
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

{#if $nav.panelOpen}<p>The drawer is open</p>{/if}
```

Two exports, both of them Svelte's own contracts rather than an abstraction
invented for this library:

| | |
|---|---|
| `navStore(options)` | A readable store, so `$nav` works and Svelte owns the subscription lifetime. |
| `navx` | An action, so `use:navx` ties `attach`/`detach` to the element's lifetime. |

Keyboard navigation, ARIA, focus management, the breakpoint, the scroll lock and
teardown all live in the core.

## Why an action is the right shape

Svelte calls an action with the element once it is in the document, calls
`update` when its parameter changes, and calls `destroy` when the element
leaves. That is precisely the lifetime `attach()` and `detach()` want, which is
why this adapter has no `onMount`, no `onDestroy`, and no element-tracking code
of its own — Svelte already tracks the element better than a wrapper component
could.

`update` re-attaches, so flipping an option at runtime works without a remount:

```svelte
<nav class="navx" use:navx={{ nav, trigger: wide ? 'hover' : 'click' }}>
```

`detach()` restores every attribute it recorded before the new binding writes
its own, so a rebind is not a merge of two states.

## No runes, on purpose

The store is the plain contract — `subscribe(run)` calls `run` immediately with
the current value and returns an unsubscribe function — which Svelte 3, 4 and 5
all consume natively, runes mode included. One build serves every version.

`$state` would pin this package to Svelte 5 and buy nothing: the machine is
already the source of truth, so a rune would only mirror it, and mirroring an
immutable snapshot into a deep proxy is how you lose the identity guarantees the
core provides. Nothing is imported from `svelte` at runtime at all — the peer
dependency is a compatibility declaration, not a bundle cost.

## Using the store without a component

`navStore()` outside a component has no Svelte lifecycle to hang off, so it
exposes `destroy()` for that case:

```ts
// nav.ts — one nav for the whole app
export const nav = navStore();
```

Inside a component you never need it; Svelte unsubscribes `$nav` for you when
the component is destroyed. The action's `destroy` disposes a machine *it*
created, and never one you handed it.

## Options

The action takes everything [`attach()`](../core#options) takes, plus `nav` — a
store or a machine. Omit `nav` and the action creates and owns one, which is
enough when nothing outside the markup reads the state:

```svelte
<nav class="navx" use:navx>…</nav>
```

## Requirements

Svelte 3 or later.

MIT. Part of [NAVX](../../README.md).
