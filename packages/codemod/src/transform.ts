/**
 * Rewrite legacy markup, in whatever file it happens to live in.
 *
 * The hard constraint is that this runs on *source*, not on a document: HTML,
 * JSX, `.vue` templates, `.svelte` files, PHP, ERB, a template literal inside
 * a `.js`. So it cannot parse to a DOM and serialise back — that would reflow
 * every file it touched, discard the author's formatting and mangle any
 * interpolation it did not understand.
 *
 * Instead it finds *opening tags* and rewrites only the class attribute inside
 * them, plus any attributes a legacy modifier turns into. Everything outside an
 * opening tag is left byte-for-byte alone, and inside one, only the class value
 * and the inserted attributes change. A file with no legacy classes comes back
 * identical.
 *
 * What it deliberately will not do:
 *
 *   - touch a class attribute whose value it cannot read statically, such as
 *     `class={clsx(styles.nav, isOpen && 'navigation-body')}`. It reports those
 *     as needing a human instead of guessing at an expression's meaning.
 *   - rename anything that is not a known legacy token. `col-md-6` beside a
 *     `navigation-item` belongs to the consumer's design system and survives
 *     exactly as written.
 */

import { translateToken } from './map.js';

export interface FileReport {
  /** Class tokens rewritten, by `legacy → new`. */
  readonly renamed: Readonly<Record<string, number>>;
  /** Legacy modifiers promoted to attributes, by `legacy → attr="value"`. */
  readonly attributed: Readonly<Record<string, number>>;
  /** Tokens removed, mapped to the reason. */
  readonly dropped: Readonly<Record<string, number>>;
  /** `navigation-*` tokens with no known mapping. */
  readonly unknown: Readonly<Record<string, number>>;
  /**
   * Class values that could not be read statically, with a line number. These
   * are the only places a human has to look.
   */
  readonly dynamic: readonly { readonly line: number; readonly source: string }[];
  readonly changed: boolean;
}

export interface TransformResult {
  readonly code: string;
  readonly report: FileReport;
}

/** `class`, and the spellings frameworks use for it. */
const CLASS_ATTR = /\b(class|className|classname)\s*=\s*(?:"([^"]*)"|'([^']*)')/;
/**
 * A class binding whose value is an expression rather than a literal.
 * `class={…}`, `:class="…"`, `v-bind:class`, `[class]`, `class:name`.
 */
const DYNAMIC_CLASS = /(?::|v-bind:|\[)class\]?\s*=|(?:class|className)\s*=\s*\{/;

/** An opening tag, tolerant of attribute values containing `>`. */
const OPEN_TAG = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|\{[^{}]*\}|[^>"'{])*?)(\/?)>/g;

const bump = (into: Record<string, number>, key: string) => {
  into[key] = (into[key] ?? 0) + 1;
};

export function transform(source: string): TransformResult {
  const renamed: Record<string, number> = {};
  const attributed: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  const unknown: Record<string, number> = {};
  const dynamic: { line: number; source: string }[] = [];

  const lineOf = (index: number) => source.slice(0, index).split('\n').length;

  const code = source.replace(
    OPEN_TAG,
    (tag, name: string, attrs: string, selfClose: string, offset: number) => {
      if (DYNAMIC_CLASS.test(attrs)) {
        // A computed class list. Report it and change nothing — rewriting the
        // strings inside an arbitrary expression is how a codemod corrupts a
        // file it did not understand.
        dynamic.push({ line: lineOf(offset), source: tag.trim().slice(0, 90) });
        return tag;
      }

      const match = CLASS_ATTR.exec(attrs);
      if (!match) return tag;

      const quote = match[2] !== undefined ? '"' : "'";
      const value = match[2] ?? match[3] ?? '';
      const tokens = value.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return tag;

      const nextClasses: string[] = [];
      const addAttrs: [string, string][] = [];
      let touched = false;

      for (const token of tokens) {
        const result = translateToken(token);

        if (result.dropped !== undefined) {
          bump(dropped, `${token} — ${result.dropped}`);
          touched = true;
          continue;
        }
        if (result.attrs.length > 0) {
          for (const [attr, attrValue] of result.attrs) {
            addAttrs.push([attr, attrValue]);
            bump(attributed, `${token} → ${attr}${attrValue ? `="${attrValue}"` : ''}`);
          }
          touched = true;
          continue;
        }
        if (result.unknown) {
          bump(unknown, token);
          nextClasses.push(token);
          continue;
        }
        if (!result.foreign && result.classes[0] !== token) {
          bump(renamed, `${token} → ${result.classes[0]}`);
          touched = true;
        }
        nextClasses.push(...result.classes);
      }

      if (!touched) return tag;

      // Rebuild the class attribute in place, so surrounding attributes and
      // their order and spacing survive exactly.
      let nextAttrs: string;
      if (nextClasses.length > 0) {
        nextAttrs = attrs.replace(
          CLASS_ATTR,
          `${match[1]}=${quote}${nextClasses.join(' ')}${quote}`,
        );
      } else {
        /**
         * An element left with no classes loses the attribute rather than
         * carrying `class=""` — which is what `navigation-justified` alone does,
         * since it becomes an attribute.
         *
         * The whitespace *before* the attribute goes with it. Collapsing all
         * runs afterwards would have been simpler and wrong: it reflows a
         * multi-line opening tag, and reformatting source the author did not ask
         * to have reformatted is exactly the liberty this tool refuses to take.
         */
        nextAttrs = attrs.replace(new RegExp(`\\s*${CLASS_ATTR.source}`), '');
      }

      for (const [attr, attrValue] of addAttrs) {
        // A boolean attribute is written bare; the DOM and every framework read
        // `data-navx-transparent` the same whether or not it has `=""`.
        const written = attrValue === '' ? ` ${attr}` : ` ${attr}="${attrValue}"`;
        if (!new RegExp(`\\s${attr}(\\s|=|$)`).test(nextAttrs)) nextAttrs += written;
      }

      return `<${name}${nextAttrs.replace(/\s+$/, '')}${selfClose ? ' /' : ''}>`;
    },
  );

  return {
    code,
    report: {
      renamed,
      attributed,
      dropped,
      unknown,
      dynamic,
      changed: code !== source,
    },
  };
}

/** Merge per-file reports into one. */
export function mergeReports(reports: readonly FileReport[]): FileReport {
  const merge = (pick: (r: FileReport) => Readonly<Record<string, number>>) => {
    const out: Record<string, number> = {};
    for (const report of reports) {
      for (const [key, n] of Object.entries(pick(report))) out[key] = (out[key] ?? 0) + n;
    }
    return out;
  };
  return {
    renamed: merge((r) => r.renamed),
    attributed: merge((r) => r.attributed),
    dropped: merge((r) => r.dropped),
    unknown: merge((r) => r.unknown),
    dynamic: reports.flatMap((r) => r.dynamic),
    changed: reports.some((r) => r.changed),
  };
}
