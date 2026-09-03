# @navx/element

`<navx-nav>` — the framework-free binding for [`@navx/core`](../core).
**861 B gzipped**, no build step required.

```sh
npm install @navx/element
```

```html
<link rel="stylesheet" href="/node_modules/@navx/tokens/dist/tokens.css">
<link rel="stylesheet" href="/node_modules/@navx/styles/dist/navx.min.css">

<navx-nav trigger="click">
  <nav class="navx">
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
</navx-nav>

<script type="module">
  import { defineNavxNav } from '@navx/element';
  defineNavxNav();
</script>
```

## No Shadow DOM

The whole value of NAVX is that it drops into someone else's design system. A
shadow root would seal this markup off from `@navx/styles`, from your own CSS,
and from every global stylesheet on the page — you would be styling a black box
through part maps for a component whose entire job is to be styled.

So this element is a lifecycle wrapper around light DOM, and nothing more. Your
markup stays yours, inspectable and selectable.

## Registration is explicit

```ts
import { defineNavxNav } from '@navx/element';

defineNavxNav();              // <navx-nav>
defineNavxNav('site-nav');    // or your own name
```

Importing the module registers nothing. A side effect on import cannot be opted
out of, breaks any SSR bundle that evaluates the module where `customElements`
does not exist, and makes two copies of the package on a page a hard error
rather than a warning. `defineNavxNav()` is idempotent and a no-op without
`customElements`, so calling it in shared code is safe.

## Attributes

| attribute | | |
|---|---|---|
| `trigger` | `click` \| `hover` | How submenus open. Default `click`. |
| `hover-close-delay` | ms | Grace period before a hovered menu closes. |
| `dismiss-on-outside` | `false` to disable | Clicking away closes. |
| `modal` | `false` to disable | In panel mode: `inert` siblings, scroll lock, focus restore. |
| `label-toggler` | text | Accessible name for a toggler with no text of its own. |
| `label-close` | text | Accessible name for the close control. |

Changing an attribute rebinds, so a script can flip `trigger` at runtime.

## Imperative use

The element exposes the machine, so a page with no build step can read or drive
the nav without importing anything:

```js
const el = document.querySelector('navx-nav');

el.state;                              // { mode, panelOpen, openPath }
el.send({ type: 'PANEL_TOGGLE' });

el.addEventListener('navx:change', (event) => {
  const { state, previous } = event.detail;
});
```

`navx:change` does not bubble past the element. A nav is not a good place to put
traffic on the document, and a page with a header and a sidebar should not have
the two shouting over each other.

## Moving the element is safe

`connectedCallback` and `disconnectedCallback` are exactly symmetric, so an
element moved in the DOM — disconnected, then reconnected — does not accumulate
a listener set per move. This is the same discipline `@navx/core` enforces with
its single `AbortController`, and the reason a `<navx-nav>` inside a
drag-reorderable region behaves.

## The class, without the element

`NavxNavElement` is exported for subclassing or for registering under your own
conditions. It resolves its root as the `.navx` inside it, or itself if you put
the class on the element:

```html
<navx-nav class="navx"> … </navx-nav>
```

MIT. Part of [NAVX](../../README.md).
