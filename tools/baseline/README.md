# Stage 0 — legacy baseline harness

The safety net for the NAVX rewrite. It captures what the legacy library looks
like today, so every later stage has something to be measured against instead of
a reviewer's memory.

Nothing here ships to npm. It exists to make Stages 2–5 falsifiable.

---

## What it produced

| | count |
|---|---|
| Variants extracted | **56** — 46 layout + 10 behaviour |
| Asserted baselines | **292** across desktop / tablet / mobile |
| RTL reference renders | **112** (captured, never asserted) |
| Distinct slot+modifier combinations | **31** |

### Two corpora, and why

The catalogue's 46 variants contain **zero** dropdowns, mega-menus, tabs or
lists — they are pure chrome permutations. Every submenu in the product lives in
`Examples/`, in ten separate demo pages. Baselining only the catalogue would
leave the Stage 3 state-machine rewrite with no regression cover at all, so the
extractor pulls both:

- **`layout`** — 46 catalogue variants. Slots: logo, brand, alignment, icon
  items, avatars, badges. Captured at rest, plus off-canvas open on mobile.
- **`behaviour`** — 10 Examples pages. Up to 8 submenus and 4 levels of nesting
  each. Captured at rest, first submenu open, and deepest chain open.

---

## Running it

```bash
npm ci
npx playwright install chromium
npm run stage0                # extract fixtures, then capture baselines
```

**No configuration needed in the default layout.** The repo sits inside the
legacy tree as `NAVX/navx/`, so the legacy root is auto-detected as the parent
directory. Copy `.env.example` to `.env` only if the legacy tree lives
somewhere else. A `.env` carrying a path that is not a legacy tree — a stale one
copied between machines, say — is ignored with a warning rather than failing the
run, and every entry point resolves it through `tools/env.mjs` so none of them
can disagree.

Afterwards:

```bash
npm run baseline:check        # re-run against the captured baselines
npm run baseline:report       # open the HTML report
```

`npm run stage0` is destructive — it rewrites every snapshot. Once the baselines
are approved, only ever run `baseline:check`.

---

## How it works

```
tools/extract-legacy.mjs   legacy pages ──▶ tests/_fixtures/*.html + manifest.json
tools/serve.mjs            three mounts: /  /fixtures/  /legacy/
tests/harness/harness.html mounts one fixture, inits the legacy plugin
tests/legacy-baseline.spec.ts  drives states, captures PNGs
```

**Extraction runs in a real browser.** The legacy demo pages are 3.2–3.8 MB
saved-from-browser dumps containing extension chrome and unbalanced markup;
regex and DOM-alikes both mis-parse them. The extractor loads each page in
Chromium with scripts blocked at the network layer, so the DOM stays pre-JS,
then lifts each `<nav>` with real DOM APIs.

**Fixtures are cleaned, not copied.** The saved pages were serialised *after*
`navigation.js` ran, so its output is baked in. The extractor removes the
injected `.overlay-panel` and `.submenu-indicator` nodes, strips the classes the
plugin toggles (`navigation-landscape`, `has-submenu`, `is-visible`, …), drops
the inline styles it wrote, neutralises the demo's absolute URLs, and repoints
images at the legacy tree. What remains is the markup an author actually wrote.

**Submenu states are opened through the plugin API, not by clicking.** Audit
defect #1 (`e.target` where `e.currentTarget` was meant) means a click on a link
containing an icon never opens its dropdown. Clicking would baseline the bug
instead of the intended appearance. Input-path correctness is a Stage 3
behavioural test; this suite captures what the component is supposed to *look*
like. The nested-state helper finds the deepest submenu in the whole nav and
opens its entire ancestor chain, because the deepest menu is often not under the
first top-level item.

---

## Determinism

A flaky baseline is worse than no baseline, so `retries: 0` and every source of
variance is pinned rather than absorbed by a loose threshold:

- **Playwright is pinned exactly** (`1.56.0`, not `^1.56.0`). Chromium build
  changes alter text rasterisation and silently invalidate all 292 snapshots.
  Upgrading is a deliberate act that requires re-approving them.
- `deviceScaleFactor: 1`, fixed viewports, `timezoneId: UTC`, `locale: en-US`.
- `reducedMotion: 'reduce'` and `animations: 'disabled'`, which matters here:
  the legacy dropdown animates `max-height` over a nominal 2–5s.
- `html { overflow: hidden }` in the harness, so a scrollbar never shifts layout.
- The harness waits for every image to decode and for `document.fonts.ready`,
  then two `requestAnimationFrame` ticks, before signalling `data-navx-ready`.
- Fixed-height filler below the nav, so page height never depends on the variant.

Verified: a second run against captured baselines reports 0 diffs.

**Platform-scoped baselines are not optional.** Measured on this corpus: all 102
desktop captures differ between macOS and Linux, by 0.27–0.97% of pixels each —
confined to glyph rasterisation (identical dimensions, identical layout bounds),
but an order of magnitude above the 0.2% `maxDiffPixelRatio` threshold. Sharing
one baseline set across platforms would fail every test in CI. Hence the
`{platform}` segment in `snapshotPathTemplate`, and one approved set per OS.

---

## Where the files live

The legacy tree is **read at runtime from `NAVX_LEGACY_ROOT` and never copied
into this repo.** `legacy/`, `tests/_fixtures/`, `tests/**/__baselines__/` and
`reference/` are all gitignored — the fixtures and snapshots are derivatives of
the legacy markup, and this repo is heading for a public MIT release.

The intended arrangement is three repos:

| repo | visibility | holds |
|---|---|---|
| `navx` | public, MIT | the rewrite; this harness; no legacy bytes |
| `navx-legacy` | private | the original NAVX tree, untouched |
| `navx-baselines` | private | the 292 PNGs + RTL reference gallery |

`.github/workflows/baselines.yml` checks out the two private repos via
`NAVX_PRIVATE_TOKEN` and is a no-op — not a failure — when those secrets are
absent, so forks and outside PRs still get a green typecheck.

---

## Outputs worth reading

- `tests/_fixtures/manifest.json` — per-variant slot fingerprint, modifiers,
  submenu count and depth, element count, init options. **This is the input to
  the Stage 5 preset port**, not just test metadata.
- `reference/rtl/` — every variant rendered under `dir="rtl"`. These are
  expected to be wrong: legacy has 60 physical-direction declarations and no
  logical properties. They are the "before" half of the Stage 2 RTL review.
- `reference/legacy-init-failures.json` — variants where the legacy plugin
  throws during init. Currently `0/56`: every catalogue variant happens to carry
  both a toggler and a close button, so audit defect #3 is latent rather than
  live. Stage 3 must keep it that way for markup that omits them.
