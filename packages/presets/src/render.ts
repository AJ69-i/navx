/**
 * Two ways to turn a plan into something real, and no framework imports.
 *
 *   render(tree)          → DOM nodes. Used by the custom element, the Svelte
 *                           action and the Angular directive.
 *   toTree(tree, opts)    → whatever `opts.create` returns. Used by React and
 *                           Vue, which need virtual nodes their reconcilers
 *                           can diff.
 *
 * `toTree` takes the element factory as an argument rather than importing one,
 * which is why this package has no peer dependencies at all: React passes
 * `createElement`, Vue passes `h`, and neither framework is named here. It
 * also means React and Vue share a single traversal — there is one walker in
 * NAVX, parameterised, not one per framework. The cross-adapter gate asserts
 * the consequence: all five produce byte-identical DOM.
 */

import type { NavxChild, NavxNode } from './plan.js';

const isNode = (child: NavxChild): child is NavxNode =>
  typeof child === 'object' && child !== null && 'tag' in child;

const isOpaque = (child: NavxChild): child is { opaque: unknown; key: string } =>
  typeof child === 'object' && child !== null && 'opaque' in child;

/* ── real DOM ─────────────────────────────────────────────────────────── */

/**
 * Build DOM nodes.
 *
 * Attributes are set with `setAttribute` throughout — no property assignment,
 * no `innerHTML`. The plan's attribute names are already the HTML ones, so
 * there is nothing to translate and nothing to escape: text becomes a text
 * node, which cannot be parsed as markup.
 *
 * An opaque icon has no meaning without a framework, so it is skipped rather
 * than stringified into `[object Object]`.
 */
export function render(tree: NavxNode, doc: Document = globalThis.document): HTMLElement {
  const el = doc.createElement(tree.tag);
  for (const [name, value] of Object.entries(tree.attrs)) el.setAttribute(name, value);

  for (const child of tree.children) {
    if (typeof child === 'string') el.append(doc.createTextNode(child));
    else if (isNode(child)) el.append(render(child, doc));
    // opaque: a framework value. Nothing sensible to do with it here.
  }
  return el;
}

/* ── virtual nodes ────────────────────────────────────────────────────── */

export interface ToTreeOptions<T> {
  /**
   * The framework's element factory.
   *
   * React: `(tag, props, children) => createElement(tag, props, ...children)`.
   * Vue:   `(tag, props, children) => h(tag, props, children)`.
   */
  readonly create: (tag: string, props: Record<string, unknown>, children: T[]) => T;
  /**
   * What the framework calls the class attribute. React insists on
   * `className`; Vue, Svelte and the DOM all take `class`.
   */
  readonly classProp?: 'class' | 'className' | undefined;
  /**
   * Where the key goes. React and Vue both read `key` off props, so this is
   * `'key'` for both — but naming it keeps the walker honest about the fact
   * that it is a framework convention rather than an HTML attribute.
   */
  readonly keyProp?: string | undefined;
  /**
   * Wrap an opaque icon before handing it to `create`. Defaults to identity,
   * which is right for React elements and Vue VNodes alike.
   */
  readonly opaque?: ((value: unknown, key: string) => T) | undefined;
  /**
   * Extra props for the root node only — where a `ref` goes.
   *
   * Every adapter needs to attach behaviour to the `.navx` element that
   * `plan()` returns, and the alternatives are worse: wrapping it in another
   * element changes the DOM the stylesheet was validated against, and cloning
   * the result afterwards means reaching into framework-specific element
   * internals. Merged after the plan's own attributes, so it cannot silently
   * drop a class.
   */
  readonly rootProps?: Record<string, unknown> | undefined;
}

export function toTree<T>(tree: NavxNode, options: ToTreeOptions<T>): T {
  const { create, classProp = 'class', keyProp = 'key' } = options;

  const convert = (n: NavxNode, isRoot = false): T => {
    const props: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(n.attrs)) {
      props[name === 'class' ? classProp : name] = value;
    }
    props[keyProp] = n.key;
    if (isRoot && options.rootProps) Object.assign(props, options.rootProps);

    const children: T[] = [];
    for (const child of n.children) {
      if (typeof child === 'string') children.push(child as unknown as T);
      else if (isOpaque(child)) {
        children.push(
          options.opaque ? options.opaque(child.opaque, child.key) : (child.opaque as T),
        );
      } else if (isNode(child)) children.push(convert(child));
    }

    return create(n.tag, props, children);
  };

  return convert(tree, true);
}

/**
 * Void elements, exported because every walker needs the same list and a
 * disagreement between two of them would be a real bug the identity gate
 * would have to explain.
 */
export const VOID_TAGS: readonly string[] = ['img', 'input', 'br', 'hr', 'meta', 'link'];
