# Why this directory has lint exemptions

`biome.json` turns three rules off for `tools/baseline/**` only. The product
packages under `packages/**` stay on the full recommended set — these exemptions
exist because this harness talks to a legacy plugin and to Playwright's fixture
API, and in both cases the rule is wrong for the code rather than the code being
wrong for the rule.

### `correctness/noEmptyPattern`

```ts
test.beforeEach(async ({ }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'skins are colour-only');
});
```

The empty destructure is **required**. Playwright passes fixtures first and
`TestInfo` second, so there is no way to reach `testInfo` without an empty
pattern in the first position. Removing it changes which argument binds and the
skip silently stops working — which is exactly the bug this suite hit once
already, when a conditional-skip callback turned out not to receive `TestInfo`
at all.

### `suspicious/noExplicitAny`

```ts
const nav = document.querySelector('.navigation') as any;
nav.showSubmenu(link);
```

`showSubmenu` and `toggleOffcanvas` are methods the legacy plugin monkey-patches
onto the DOM element at init. There is no interface to import — the absence of
one is [audit defect: the DOM node *is* the instance], and modelling it with a
hand-written interface would assert a contract the legacy code does not actually
guarantee. `any` is the honest type here, and it disappears at Stage 3 when the
core has a real one.

### `complexity/noForEach`

The `.forEach` calls in `extract-legacy.mjs` run **inside the browser** via
`page.evaluate`, over live `NodeList`s. `for...of` works there too, but the
serialised function is easier to read in DOM-idiomatic form, and this code is
read far more often than it is changed.
