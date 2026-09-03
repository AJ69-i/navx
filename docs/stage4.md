# Stage 4 — the framework adapters

Five packages, 4.7 kB of JavaScript between them, and not one line of
navigation logic in any of them.

That last part is the only claim in this document that matters. An adapter that
re-implements a keyboard handler "because React needs it that way" is not an
adapter; it is a fork that will drift. So the measure of Stage 3's boundary is
whether Stage 4 could be written without crossing it — and it could, five times,
including once for a framework whose reactivity model is hostile to the core's
central guarantee.

## What an adapter is allowed to do

Exactly three things:

1. Hold a machine for as long as the component lives, and dispose it if it
   created it.
2. Get the host element to `attach()` when it exists, and call `detach()` when
   it stops existing.
3. Turn `machine.subscribe` into whatever the framework calls reactive state.

Everything else — transitions, ARIA, focus, the breakpoint, the scroll lock,
hover intent, the modal `inert` treatment — is `@navx/core`. There is a
source-level gate for the first half of that in
[`packages/core/test/lifecycle-discipline.test.ts`](../packages/core/test/lifecycle-discipline.test.ts);
the rest is enforced by the size budgets, because logic that leaked into an
adapter would show up as bytes.

| | gzipped | files | what it is |
|---|---|---|---|
| `@navx/svelte` | 429 B | 1 | a store and an action |
| `@navx/react` | 620 B | 1 | one hook |
| `@navx/vue` | 702 B | 1 | one composable |
| `@navx/element` | 861 B | 1 | `<navx-nav>` |
| `@navx/angular` | 2.1 kB | 1 | a directive and an injectable |

Angular is three times the size of the others for a reason that is not ours:
ng-packagr emits `ɵɵngDeclareDirective` / `ɵɵngDeclareInjectable` metadata
blocks alongside the code, which is how Angular Package Format works. The
*hand-written* Angular source is comparable to the rest.

## The shared shape

Every adapter answers the same four questions the same way, which is what makes
them reviewable side by side.

**Who owns the machine.** If the caller passed one in, the caller owns it and
the adapter never disposes it — disposing it would drop subscribers the caller
added elsewhere, silently. If the adapter created it, the adapter disposes it on
teardown. Every adapter has a test for both halves.

**When `attach()` runs.** After the element is in the document, and again if the
element is *replaced*. That second case is the one that gets skipped: a `v-if`,
a `:key` change, a conditional branch or a route transition can swap the host
node while the component instance survives. An adapter that binds once leaves
the old node holding listeners and the new node dead.

**When `detach()` runs.** Before every rebind, and on teardown. `detach()`
restores each attribute to the value it recorded, so a rebind is a replay rather
than a merge — which is why re-attaching on an option change is cheap enough to
be the rebinding strategy everywhere.

**What "state" means.** The immutable snapshot, unwrapped, with its identity
intact. This is where the frameworks differ most, and where the one real bug of
this stage lived.

## React

```ts
const { ref, state, send, machine } = useNav(options);
```

`useSyncExternalStore`, because the machine *is* an external store: it is
advanced by pointer events, a `ResizeObserver` and the keyboard, none of which
are React state updates. Read that with `useState` + `useEffect` and a
concurrent render can observe one snapshot in one component and a newer one in
the next.

Three details make it exact rather than approximate.

**Identity does the memoising.** `reduce()` returns the same object when a
transition changes nothing, and `useSyncExternalStore` compares with
`Object.is`. So a `MODE_SET` from a `ResizeObserver` firing on every pixel of a
window drag costs one comparison — no `useMemo`, no equality function, nothing
to keep in sync. There is a test that asserts the *absence* of a re-render:

```ts
act(() => void machine.send({ type: 'SUBMENU_OPEN', path: ['1.0'] }));
const after = renders.mock.calls.length;
act(() => void machine.send({ type: 'SUBMENU_OPEN', path: ['1.0'] }));
expect(renders.mock.calls.length).toBe(after);
```

**`getSnapshot` is also `getServerSnapshot`.** The machine has no DOM
dependency, so the server snapshot is the genuine initial state rather than a
placeholder, and hydration has nothing to reconcile. This only works because
Stage 3 made submenu identity structural — depth plus child index, not a
generated id — so the ids the server computes are the ids the client computes.

**The element arrives through a ref callback.** Not an effect. An effect keyed
on `[]` never sees a swapped host; the callback fires on every swap, and the
cleanup is stored so React 18 (which ignores a ref callback's return value) and
React 19 behave identically. There is a test that re-keys the host element and
asserts the new node is bound.

Strict Mode's double mount is consequently uneventful — the second mount
detaches what the first attached — and is tested rather than assumed.

## Vue

```ts
const { navRef, state, send, machine } = useNav(options);
```

Vue is the interesting one, because its default reactivity is *deep* and the
core's central guarantee is *identity*. Those two are in direct conflict, and
the conflict is silent.

**`shallowRef`, not `ref`.** `ref()` walks each snapshot, makes every field
reactive, and hands the consumer a proxy. That costs a traversal per transition
for an object that never mutates, and — worse — makes
`state.value === machine.getState()` false, so every identity comparison the
machine guarantees stops holding.

**`shallowReadonly`, not `readonly`.** This is the bug the tests caught, and it
is worth recording in full because it looks like the correct code.

Publishing a read-only view of a ref is what `readonly()` is for. But
`readonly()` is deep: reading `.value` through it returns `readonly(snapshot)` —
a proxy — reintroducing at the very last step exactly what `shallowRef` was
chosen to avoid. The first version of this adapter did this, and the identity
test failed:

```
AssertionError: expected { mode: 'panel', …(2) } to be { mode: 'panel', …(2) }
Compared values have no visual difference.
```

What makes it dangerous is that it is *conditionally* invisible. Vue's
`getTargetType` treats a non-extensible object as `INVALID` and returns it
unwrapped, so `readonly()` is a no-op on frozen snapshots. A probe written
against `Object.freeze({...})` reports `readonly(.value) === snap: true` and the
bug looks like it does not exist. Our snapshots are not frozen, so it did:

```
readonly(.value) === snap        : true    ← frozen probe, misleading
shallowReadonly(.value) === snap : true
```

`shallowReadonly` blocks assignment to `.value` and returns the snapshot itself,
and `isRef` still holds through the proxy so template auto-unwrapping works. The
assertion is now permanent:

```ts
expect(state.value).toBe(machine.getState());
```

**`watch(navRef, …, { flush: 'post' })`.** Post-flush because `attach()` reads
layout to resolve the mode, and pre-flush would run before Vue has patched the
DOM. Watching the ref rather than binding in `onMounted` is also what handles a
host element swapped by `v-if` or `:key`, which is tested.

**`onScopeDispose`, not `onUnmounted`.** Teardown belongs to the effect scope,
so the composable works with no component instance — which is how it is tested
(`effectScope()` is what `setup()` runs inside, and `scope.stop()` is what
unmounting does) and how you would share one nav across a route group.

## Svelte

```ts
const nav = navStore(options);   // $nav is the state
use:navx={{ nav, trigger }}      // attach/detach
```

The smallest adapter, because Svelte's primitives already have the right
shapes and there was nothing to invent.

An action is called with the element once it is in the document, `update`d when
its parameter changes, and `destroy`ed when the element leaves. That is
`attach`/`detach`'s lifetime exactly, so this package has no `onMount`, no
`onDestroy` and no element tracking of its own.

The store is the *plain* contract — `subscribe(run)` calls `run` immediately
with the current value and returns an unsubscribe — which Svelte 3, 4 and 5 all
consume natively, runes included. One build serves every version, and nothing is
imported from `svelte` at runtime at all.

`$state` was considered and rejected. It would pin the package to Svelte 5 and
buy nothing: the machine is already the source of truth, so a rune could only
mirror it, and mirroring an immutable snapshot into a deep proxy is the Vue bug
above with different spelling.

## Angular

```html
<nav class="navx" navx [navxTrigger]="'hover'"> … </nav>
```

A standalone `NavxDirective` and an injectable `NavxService`.

**Signals as the bridge.** The service wraps the subscription in a `signal`, so
a template reads `nav.state()` and change detection follows with no
`markForCheck()` — `OnPush` and zoneless work as they are.

**`DestroyRef.onDestroy`, not `ngOnDestroy`.** An injectable provided on a
component has no lifecycle hook of its own; `DestroyRef` is what actually fires
when the providing component is destroyed.

**Not `providedIn: 'root'`.** A root-provided service means one nav per
application, which is wrong the moment a page has a header *and* a sidebar. The
directive injects the service `{ optional: true }` and owns a machine when there
isn't one, so the simple case needs no providers and the shared case is one line.

**Attach in the constructor.** The host element already exists when a directive
is constructed, and `attach()` needs nothing else. `ngOnChanges` rebinds.

### The test is a compiler

An Angular adapter's contract is a *compile-time* one, and nothing we already
ran was checking it:

- `tsc --noEmit` checks our sources.
- ng-packagr emits **partial** declarations, which no template type-checker has
  looked at.
- `publint` and `attw` check the package's shape, not its Angular metadata.

A consumer would be the first to find out that an input is not bindable. So
`pnpm --filter @navx/angular test` is two `ngc` runs against the built `dist/`,
resolved through its published `exports` map, in `full` compilation mode with
`strictTemplates`:

```
ok   test/consumer compiles against dist/ (full mode, strictTemplates)
ok   test/should-fail is rejected — 3 template diagnostics, so strictTemplates
     is genuinely checking our inputs
```

`test/consumer` is a realistic standalone component: every input bound, the
service provided, `OnPush`, `computed()` over `nav.state()`.

`test/should-fail` is the control, and it is the half that makes the other half
mean something. It binds `[navxTrigger]="'sometimes'"`,
`[navxHoverCloseDelay]="'250ms'"` and `[navxMode]="'desktop'"`, and the runner
fails the build if the compiler *accepts* it — or if it rejects it with fewer
than three diagnostics, so one surviving error cannot stand in for three
different mistakes. Template type-checking is quietly easy to lose: one `any` in
an emitted declaration, or `strictTemplates` off, and every binding above
compiles clean.

The runner had a bug of its own on the first run, and it is instructive: it
reported `0 diagnostics` while printing three. `ngc` colourises its output even
when stdout is a pipe, and the escape sequences land *between* `error` and the
code, so `/error TS\d+/` matches nothing. The codes are counted on
ANSI-stripped text now. An instrument that reports a false failure is one
edit away from reporting a false pass.

`attw` reports `CJSResolvesToESM` for this package and it is ignored explicitly:
Angular libraries have been ESM-only since Angular 13, so it is inherent to
Angular Package Format rather than a defect in ours.

## The custom element

```html
<navx-nav trigger="click"><nav class="navx"> … </nav></navx-nav>
```

**No Shadow DOM**, per the Stage 1 decision. The whole value of NAVX is that it
drops into someone else's design system; a shadow root would seal the markup off
from `@navx/styles`, from the consumer's CSS, and from every global stylesheet on
the page — styling a black box through part maps, for a component whose entire
job is to be styled.

**Registration is explicit.** `defineNavxNav()` registers; importing the module
does not. An import-time side effect cannot be opted out of, breaks SSR bundles
evaluated where `customElements` does not exist, and turns two copies of the
package on a page into a hard error.

**`connectedCallback` and `disconnectedCallback` are exactly symmetric**, so an
element *moved* in the DOM — disconnected then reconnected — does not accumulate
a listener set per move. That is the same discipline the core enforces with its
single `AbortController`, and there is a test that moves the element.

State is re-emitted as a `navx:change` `CustomEvent` carrying the snapshot, so a
page with no build step can observe the nav without importing anything. It does
not bubble past the element: a page with a header and a sidebar should not have
the two shouting over each other on `document`.

## Two bugs this stage found in shipped code

Both were found by writing the adapters, not by review, which is the argument
for building all five rather than one and extrapolating.

**`exactOptionalPropertyTypes` made the core's option types unusable by every
adapter.** Each adapter destructures a caller's options and forwards the rest,
so all four compiled options objects contain fields the caller simply did not
set — and under `exactOptionalPropertyTypes`, `{ mode: undefined }` is *not*
assignable to `{ mode?: NavMode }`. Four adapters, the same error. The fix is in
the core, where the constraint belongs: every public optional accepts explicit
`undefined`, and `attach()` strips undefined before merging defaults, so a
forwarded `undefined` means "not set" rather than "set to nothing".

```ts
const given = Object.fromEntries(
  Object.entries(options).filter(([, value]) => value !== undefined),
) as AttachOptions;
```

**`ResizeObserver` is not a constructor in jsdom, and `attach()` assumed it
was.** All six React tests failed on it. Baseline 2024 says fall back, not
polyfill, so `attach()` registers a `resize` listener on the window through the
same `AbortController` signal when `ResizeObserver` is absent. That is a real
robustness improvement for old browsers and for any SSR test environment — found
only because the adapters put the core into jsdom for the first time.

Neither bug was reachable from the core's own tests. Both were reachable from
the first consumer.

## Packaging

Two packaging defects were fixed in passing, both of the kind that only bite
after publication:

**The adapters imported their frameworks without declaring them.**
`@navx/react` imports `react` and `@navx/vue` imports `vue`, and neither had a
`peerDependencies` entry — the frameworks were in `devDependencies` only, which
is how a library ends up installing a second copy of React into a consumer's
tree. Both now declare a peer range with a stated floor: React `>=18` because
`useSyncExternalStore` is the floor, Vue `>=3.2` because `effectScope` is.
Svelte declares `>=3` although nothing is imported from it, because that range
*is* the compatibility claim.

**The adapter `dist/` was stale.** Every one of the four tsup adapters was still
publishing its Stage 1 placeholder — `export { name, stage }`, 112 bytes — and
`publint`, `attw` and `tsc` were all green against it, because a placeholder is
a perfectly well-formed package. Nothing in the pipeline compares what is in
`dist` to what is in `src`. The size budgets added this stage are what would
catch it next time: a 620 B adapter that measures 112 B is a failure now.

## Out of scope

Deliberately not in Stage 4:

- **Components.** No `<NavxNav>`, no `<NavxMenu>`. The markup is the consumer's,
  and a component wrapper would have to reproduce ten skins' worth of class
  combinations as props — which is Stage 5's job, as *data*.
- **The 46 catalogue variants.** Stage 5.
- **SSR rendering helpers.** The machine is already SSR-safe and
  `getServerSnapshot` is the real state; nothing more is needed until presets
  exist to render.
- **Runes / signals-first APIs.** The machine is the source of truth. A second
  reactive copy of it is a bug surface, as the Vue `readonly()` finding shows.
