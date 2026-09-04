# Releasing

How a version gets cut, and what counts as breaking.

---

## Cutting a release

```bash
# 1. bump all ten packages together
node scripts/set-version.mjs 1.0.1

# 2. verify locally — the same command CI runs
pnpm verify

# 3. tag; the tag is what publishes
git commit -am "release: v1.0.1"
git tag v1.0.1
git push && git push --tags

# 4. once npm has it
node tools/verify-published.mjs 1.0.1
```

The workflow refuses a tag whose number disagrees with the manifests, runs the
whole suite before publishing, and prints the contents of every tarball. It can
be dry-run from the Actions tab (`workflow_dispatch`, `dry_run: true`) — worth
doing whenever the packaging changes rather than the code.

## Lockstep, and what it costs

All ten packages carry the same version and ship together. A one-line fix to
`@navx/svelte` bumps `@navx/tokens` too.

That is a deliberate trade, and the reason is that this repo cannot honestly
verify a package in isolation. The gates test the system: 292 screenshots
render the stylesheet *and* the presets *and* the core together, and the
cross-adapter gate compares all five adapters against each other. "A patch to
just the core" is not a thing that has been proven here, because nothing tests
just the core.

The cost is version churn — ten packages moving for one fix. The alternative
costs more: nine drifting version numbers and a compatibility matrix in the
docs that someone has to maintain and everyone has to read.

Workspace dependencies publish as `^1.0.0`, so a consumer who takes a patch of
one package is not forced to move the other nine in the same install.

## The core's size budget

It has been raised twice, and both times deliberately:

| version | limit | what bought the bytes |
|---|---|---|
| Stage 3 | 4.5 kB | the machine and the DOM binding |
| Stage 6 | 4.6 kB | `activeId` rendering, so scroll-spy never writes DOM itself |
| Stage 7 | 5.1 kB | `multiBranch` — sibling branches, and a closed parent that remembers |

`multiBranch` costs about 450 B gzipped and cannot be tree-shaken: it is a
branch inside the reducer, reachable from every `send()`. An accordion-only
consumer therefore pays for an option they will not set, which is the honest
argument against merging it at all.

It went in anyway because the alternative was worse. The same 450 B also buys
the fix that made `SUBMENU_TOGGLE` act on the node it names rather than the
deepest one open, and a second published package for one boolean would be a
compatibility matrix nobody wants to read.

The composite `@navx/core + @navx/react` budget moved by the same 0.5 kB, for
the same reason — a shared line has to move when the thing it contains does, or
it stops measuring the composition and starts re-measuring the part.

Raise either line again only with a row in the table. A budget that moves
without a reason is not a budget.

## What counts as breaking

The usual TypeScript rules apply, and then three more that are specific to a
library like this. Each of these can break a consumer without changing a single
type signature, which is exactly why they need writing down.

### The markup contract is public API

`plan()` returns a node tree, and consumers style it. Changing what it emits —
an element, a class, an attribute, the nesting — is a **major** change even
though the TypeScript is unchanged. Someone's stylesheet is written against
that tree.

The one place this bit already: Stage 5 changed `.navx-link` from an `<a>` to a
`<div>` wrapping an `<a>` for items that own a submenu. No type moved. Every
`.navx-link > i` selector in the world would have.

### CSS class names and data attributes are public API

`.navx-item`, `data-navx-state="open"`, `--navx-overlay-background`: all of it.
Renaming a token is major. *Adding* one is minor. Changing a token's default
value is minor if it is a colour and major if it changes layout, because the
second one moves pixels in a consumer's design.

Run the visual gates before believing any CSS change is safe:

```bash
pnpm --filter @navx/baseline-harness run stage2   # the stylesheet
pnpm --filter @navx/baseline-harness run stage5   # generated markup
```

### Default behaviour is public API

`trigger` defaulting to `click`, scroll-spy owning `data-navx-current` once
engaged, `dismissOnOutside` defaulting to `true`. Flipping one of these is
major regardless of what the types say.

## The baselines after 1.0

This needs a decision the first time a *deliberate* visual change lands, and it
is better made now than under pressure.

Today the 292 baselines are screenshots of the **legacy plugin**. That was the
right reference while the goal was "reproduce the original" — every stage was
measured against a fixed, external artifact that could not be quietly adjusted
to match a regression.

The moment NAVX intends to look different from legacy, that reference stops
being the standard and becomes a historical record. At that point:

- Keep the legacy baselines as-is, under `__baselines__/legacy/`, and stop
  gating on them. They remain the evidence for what 1.0 reproduced.
- Capture NAVX's own output as the new baseline set, and gate on that.
- Never regenerate a baseline in the same commit as the change that moved it.
  Two commits: one that shows the diff and explains it, one that accepts it.

Approving a diff and regenerating the reference in a single step is how a
visual gate becomes decorative. The whole value of the Stage 0 corpus was that
it was captured before anyone had an opinion about the outcome.

## Yanking

`npm deprecate` rather than `npm unpublish`. Unpublishing breaks lockfiles for
anyone who already installed, and npm's 72-hour window makes it available for
exactly long enough to be tempting.

```bash
npm deprecate "@navx/core@1.0.1" "Broken export map; use 1.0.2"
```

Because of lockstep, deprecate all ten or none — a consumer who sees the
warning on one package and not the others has no way to tell which combination
is intended.

## Security

`packages/core` writes to the DOM and `@navx/codemod` writes to a user's source
files. Those are the two places a report would matter most. `SECURITY.md`
should name a contact and a response window before the first one arrives rather
than after.
