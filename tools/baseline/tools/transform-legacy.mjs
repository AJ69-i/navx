/**
 * Legacy markup → NAVX markup.
 *
 * Stage 1 committed to a clean break: no `navigation-*` classes survive. But the
 * 292 approved baselines were captured from legacy markup, so validating the new
 * stylesheet against them needs a bridge. This is it — a mechanical, auditable
 * rename so that any pixel difference is a CSS difference rather than a naming
 * one.
 *
 * The tables are **not** defined here. They live in `@navx/codemod`, which is a
 * published package, and this file imports them. That direction matters: the
 * mapping a user runs against their own codebase and the mapping this gate
 * checks against 292 screenshots are then the same object, and cannot drift.
 * A copy in each place would have meant the proof applied to only one of them.
 *
 * The logic below is deliberately dumb — no layout rules, no conditionals
 * beyond the table lookup. If a diff appears, it is the stylesheet's fault.
 */

/**
 * Imported by URL, not by package name.
 *
 * Both importers of this file are harness *pages* — `stage2.html` and
 * `lifecycle.html` — so it is evaluated by the browser, where a bare specifier
 * like `@navx/codemod` does not resolve. `serve.mjs` mounts the built package
 * at this path, which is the same file `npx @navx/codemod` runs.
 */
export { CLASS_MAP, ATTR_MAP, DROPPED } from '/navx/codemod.js';

/**
 * Runs inside the page. Returns counts so the caller can assert the transform
 * actually did something rather than silently no-op.
 */
export function transformInPage(root, maps) {
  const { classMap, attrMap, dropped } = maps;
  let renamed = 0;
  let attributed = 0;
  const unmapped = new Set();

  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    if (!el.classList.length) continue;
    const tokens = [...el.classList];
    const next = [];

    for (const token of tokens) {
      // `dropped` is an object mapping token → reason, not an array. It was an
      // array while this file owned the tables; importing them from
      // @navx/codemod changed the shape, because the codemod's report needs to
      // tell a user *why* a class went away. Membership is the only thing
      // needed here.
      if (Object.hasOwn(dropped, token)) continue;
      if (attrMap[token]) {
        const [name, value] = attrMap[token];
        el.setAttribute(name, value);
        attributed++;
        continue;
      }
      if (classMap[token]) {
        next.push(classMap[token]);
        renamed++;
        continue;
      }
      // navigation-col-7 → navx-col-7
      const col = token.match(/^navigation-col-(\d+)$/);
      if (col) {
        next.push(`navx-col-${col[1]}`);
        renamed++;
        continue;
      }
      // Anything else is a consumer class (fa-*, container, col-md-*) and is
      // carried through untouched — NAVX drops into other design systems.
      if (token.startsWith('navigation-')) unmapped.add(token);
      next.push(token);
    }

    el.className = next.join(' ');
  }

  return { renamed, attributed, unmapped: [...unmapped] };
}
