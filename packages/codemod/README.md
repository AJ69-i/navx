# @navx/codemod

Rewrite legacy NAVX markup to the `@navx` API.

```bash
npx @navx/codemod ./src          # dry run — prints what would change
npx @navx/codemod ./src --write  # do it
```

Dry by default. A codemod that rewrites a hundred files the first time you type
its name is one people run once, on a copy, nervously.

## What it reports

Run against the original NAVX catalogue — all 46 variants:

```
would rewrite 1 of 1 file(s): 1115 class rename(s), 97 attribute(s)

  renamed (1115)
      234  navigation-item → navx-item
      234  navigation-link → navx-link
       78  navigation-logo → navx-logo
       …
  promoted to attributes (97)
       40  is-active → data-navx-current
       24  navigation-justified → data-navx-align="between"
       22  navigation-icon-item → data-navx-item="icon"
       …
  dropped (92)
       46  navigation-landscape — the container query replaces it
       46  scroll-momentum — now a plain declaration on the panel
```

Zero unmapped tokens, which is the number worth watching: anything listed under
**unmapped** is a `navigation-*` class this tool does not know, and is either
yours or a typo.

## Why you can trust the table

The mapping is not a transcription of the migration guide — it *is* the table
the NAVX visual gate runs against all 292 approved screenshots of the original.
The baseline harness imports this published package and uses it to rewrite
legacy markup in the browser before comparing pixel-for-pixel with the original
rendering.

So every entry has been checked by rendering a real page with it and finding
that nothing moved. A second copy for the tool would have meant the proof
applied to only one of them.

## What it will not touch

**Class lists it cannot read statically.** `className={clsx(styles.nav, isOpen
&& 'navigation-body')}`, `:class="{ … }"`, `class:name={…}` — each is reported
with a file and line, and left exactly as written. Guessing at an expression's
meaning is how a codemod corrupts a file.

**Anything that is not a legacy NAVX token.** NAVX's premise is that it drops
into someone else's design system, so your `col-md-6`, your `fa-home` and your
`tw-flex` survive the migration exactly as written.

It is idempotent, and a file with no legacy classes comes back byte-identical.
Formatting is preserved — it rewrites the class attribute inside an opening tag
rather than parsing to a DOM and serialising back, so multi-line tags stay
multi-line and quote style is kept.

## Options

```
npx @navx/codemod <path...> [--write] [--ext .html,.vue]
```

| | |
|---|---|
| `--write`, `-w` | apply the changes (default: dry run) |
| `--ext` | comma-separated extensions. Default covers `.html .htm .vue .svelte .jsx .tsx .astro .php .erb .twig .hbs .ejs .liquid` |

`node_modules`, `.git`, `dist`, `build`, `.next`, `.nuxt` and `coverage` are
skipped. Exit code is `1` when unmapped `navigation-*` tokens were found, so it
composes with a script.

## As a library

```ts
import { transform, translateToken, CLASS_MAP, ATTR_MAP, DROPPED } from '@navx/codemod';

const { code, report } = transform(source);
translateToken('navigation-justified');
// { classes: [], attrs: [['data-navx-align', 'between']] }
```

The main entry touches no filesystem, so it runs in a browser or a worker.

## Migration guide

[`docs/migration.md`](https://github.com/AJ69-i/navx/blob/main/docs/migration.md)
covers the half a codemod cannot do: the API, and every deliberate behaviour
change.

## Licence

MIT.
