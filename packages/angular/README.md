# @navx/angular

The Angular binding for [`@navx/core`](../core). **2.1 kB gzipped** — a
standalone directive and an injectable, with no navigation logic in either.

```sh
npm install @navx/angular @navx/styles @navx/tokens
```

```ts
import { Component, computed } from '@angular/core';
import { NavxDirective, NavxService } from '@navx/angular';

@Component({
  selector: 'app-header',
  standalone: true, // the default from Angular 19; explicit for 18
  imports: [NavxDirective],
  providers: [NavxService],
  template: `
    <nav class="navx" navx [navxTrigger]="'click'">
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

    @if (drawerOpen()) { <p>The drawer is open</p> }
  `,
})
export class AppHeaderComponent {
  constructor(readonly nav: NavxService) {}
  readonly drawerOpen = computed(() => this.nav.state().panelOpen);
}
```

Keyboard navigation, ARIA, focus management, the breakpoint, the scroll lock and
teardown all live in the core.

## Signals, and where state lives

`NavxService` wraps the machine's subscription in a `signal`, so a template
reads `nav.state()` and change detection follows without a single
`markForCheck()` — `OnPush` and zoneless both work as they are.

```ts
readonly #state = signal<NavState>(this.machine.getState());
readonly state: Signal<NavState> = this.#state.asReadonly();
```

Teardown hangs off `DestroyRef.onDestroy` rather than `ngOnDestroy`, because an
injectable provided on a component has no lifecycle hook of its own — that is
the hook that actually fires when the component providing it is destroyed.

## It is not `providedIn: 'root'`

Deliberately. A root-provided service means one nav per application, which is
wrong the moment a page has a header *and* a sidebar. Provide it where the nav
lives:

```ts
@Component({ providers: [NavxService], … })
```

The directive works with no providers at all — it injects `NavxService`
optionally and owns a machine for its own lifetime when none is provided. So the
simple case needs no setup, and the shared case is one line.

## Inputs

Signal inputs, all optional:

| input | type |
|---|---|
| `navxTrigger` | `'click' \| 'hover'` |
| `navxHoverCloseDelay` | `number` (ms) |
| `navxDismissOnOutside` | `boolean` |
| `navxModal` | `boolean` |
| `navxMode` | `'bar' \| 'panel'` |

A changed input rebinds. That is cheap because `detach()` restores the DOM
first, so there is no accumulated state to reconcile — and it is why the
directive attaches in its constructor rather than in `ngOnInit`: the host
element already exists by the time a directive is constructed, and `attach()`
needs nothing else.

## Angular Package Format, and how it is checked

This package is built with **ng-packagr**, not the `tsup` the rest of this
workspace uses. `tsup` would produce something that installs and then fails at
the consumer's compile step — green locally, broken for everyone downstream,
which is the worst failure mode a library has.

`tsc --noEmit` does not catch that either: it checks *our* sources, and
ng-packagr emits *partial* declarations that no template type-checker has looked
at. So `pnpm --filter @navx/angular test` compiles two fixtures against the
built `dist/` in **full** compilation mode with `strictTemplates`:

```
ok   test/consumer compiles against dist/ (full mode, strictTemplates)
ok   test/should-fail is rejected — 3 template diagnostics, so strictTemplates
     is genuinely checking our inputs
```

The second one is the control. A green type-check only means something if a red
one is reachable, and template checking is quietly easy to lose — one `any` in
an emitted declaration and every wrong binding would compile.

`attw` reports `CJSResolvesToESM` for this package and that is inherent, not a
defect: Angular libraries have been ESM-only since Angular 13, so the rule is
ignored explicitly rather than worked around.

## The TypeScript divergence

Angular's toolchain is one major behind stable and pins an exact minor, so this
package **cannot** use the workspace's TypeScript:

| | requires |
|---|---|
| `@angular/compiler-cli@22.x`, `ng-packagr@22.x` | `typescript >=6.0 <6.1` |
| every other package here | `typescript 7.x` |

`packages/angular` is therefore exempt from the workspace catalog and carries
its own TypeScript 6.0.x. It is a contained, documented divergence rather than
drift — the catalog comment in `pnpm-workspace.yaml` points here.

One more consequence worth knowing: `@angular/core@22` requires Node
`^22.22.3 || ^24.15.0 || >=26.0.0`, narrower than this repo's `>=20.11`, so CI
runs a Node version satisfying both.

## Requirements

Angular 18 or later (standalone directives and signal inputs).
`@angular/common` is an optional peer — nothing here imports it.

MIT. Part of [NAVX](../../README.md).
