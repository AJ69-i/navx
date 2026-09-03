/**
 * The planner: `preset + content → node tree`.
 *
 * One pure function, and it is the *only* place in NAVX that decides what nav
 * markup looks like. That is the whole design. Five adapters each rendering
 * their own JSX/VNodes/template would be five implementations of one contract
 * and five chances to drift — the exact failure mode Stage 4 refused
 * components to avoid. So the adapters do not render markup; they walk this
 * tree, generically, and a gate asserts all five produce byte-identical DOM.
 *
 * Three things this file owns:
 *
 *   1. Stage 2's class names and data attributes (`.navx-*`, `data-navx-*`).
 *      Nothing else in the package knows them.
 *   2. Stage 3's chevrons — a real `<button>` per disclosure, with
 *      `aria-expanded`, which is precisely the boilerplate a consumer should
 *      never hand-write.
 *   3. Structural submenu ids: depth plus child index, matching `attach()`'s
 *      `pathOf()` exactly, so a server-rendered tree and a client-hydrated one
 *      agree without a generated id in sight.
 *
 * No DOM, no framework, no globals. It runs in Node, in a worker, at build
 * time, or during SSR.
 */

import type {
  NavxBlock,
  NavxContent,
  NavxIconMap,
  NavxImage,
  NavxItem,
  NavxLink,
  NavxPreset,
  NavxRow,
  NavxSection,
  NavxSubmenu,
  NavxSubmenuItem,
} from './types.js';

/**
 * A node in the plan.
 *
 * Deliberately the smallest thing that can describe HTML: a tag, string
 * attributes, and children. `unknown` children exist so an icon map can return
 * a React element or a Vue component and the adapter can hand it straight to
 * its renderer — the planner never inspects it.
 */
export interface NavxNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly NavxChild[];
  /**
   * Stable within a tree, and stable across a re-plan of the same input.
   * Adapters that need keys (React lists, Vue `v-for`) use it rather than an
   * array index, so reordering a menu does not remount its subtree.
   */
  readonly key: string;
}

export type NavxChild = NavxNode | string | { readonly opaque: unknown; readonly key: string };

/**
 * Every field carries `| undefined` explicitly.
 *
 * This repo builds with `exactOptionalPropertyTypes`, under which
 * `{ assetBase: undefined }` is *not* assignable to `{ assetBase?: string }` —
 * and this function's whole job is to merge a caller's partial options with
 * defaults, so without it the merge cannot be written. `@navx/core`'s option
 * types carry the same widening for the same reason, discovered the same way:
 * by being consumed.
 */
export interface PlanOptions {
  /** Maps `icon: 'home'` to a class string or to your own component. */
  readonly icons?: NavxIconMap | undefined;
  /** Overrides `content.assetBase`. Prefix for relative image sources. */
  readonly assetBase?: string | undefined;
  /** Accessible name for each chevron: `(label) => string`. */
  readonly labelDisclosure?: ((label: string) => string) | undefined;
  /** Accessible name for the toggler and the drawer's close control. */
  readonly labelToggler?: string | undefined;
  readonly labelClose?: string | undefined;
  /**
   * Emit `.navx-overlay`. `attach()` needs it for the modal drawer, and
   * creating it in markup rather than in JavaScript keeps teardown a pure
   * attribute replay — the core never inserts a node it would have to remove.
   */
  readonly overlay?: boolean | undefined;
}

const isNode = (child: NavxChild): child is NavxNode =>
  typeof child === 'object' && child !== null && 'tag' in child;

/** Drops empty strings so `class=""` never reaches the DOM. */
const attrs = (record: Record<string, string | false | undefined>) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === false || v === undefined) continue;
    out[k] = v;
  }
  return out;
};

const classes = (...tokens: (string | false | undefined)[]) =>
  tokens.filter(Boolean).join(' ') || undefined;

const node = (
  tag: string,
  key: string,
  attr: Record<string, string | false | undefined>,
  children: readonly NavxChild[] = [],
): NavxNode => ({ tag, key, attrs: attrs(attr), children: children.filter((c) => c !== '') });

function resolveSrc(image: NavxImage, base: string | undefined): string {
  const { src } = image;
  if (!base) return src;
  if (/^([a-z]+:|\/\/|\/)/i.test(src)) return src;
  return `${base}${src}`;
}

function imageNode(image: NavxImage, key: string, base: string | undefined): NavxNode {
  return node('img', key, {
    src: resolveSrc(image, base),
    alt: image.alt,
    class: image.className,
    // Matching legacy's own attributes, which the baselines were captured with.
    loading: 'eager',
    decoding: 'sync',
  });
}

/**
 * An icon, or nothing.
 *
 * A `string` from the map is a class name — the icon-font case, and what the
 * legacy catalogue needs to reproduce (`fas fa-home`). Anything else is opaque
 * and travels to the adapter untouched, which is how a React consumer passes
 * `<HomeIcon/>` without this package importing React.
 */
function iconChild(
  name: string | undefined,
  key: string,
  icons: NavxIconMap | undefined,
): NavxChild | '' {
  if (!name) return '';
  const mapped = icons?.[name];
  if (mapped === undefined) {
    // An unmapped icon emits nothing rather than a broken glyph. The name is
    // kept as a data attribute so a missing mapping is visible in the DOM
    // instead of silently absent.
    return node('i', key, { 'data-navx-icon': name });
  }
  if (typeof mapped === 'string') return node('i', key, { class: mapped });
  return { opaque: mapped, key };
}

/** The inside of a link: icon, label, badge — in legacy's order. */
function linkChildren(link: NavxLink, key: string, o: PlanOptions): NavxChild[] {
  const out: NavxChild[] = [];
  const icon = iconChild(link.icon, `${key}-i`, o.icons);
  if (icon !== '') out.push(icon);
  if (link.image) out.push(imageNode(link.image, `${key}-img`, o.assetBase));

  if (link.label !== undefined) {
    const needsSpan = link.wrapLabel || link.labelHiddenInBar || link.badge !== undefined;
    out.push(
      needsSpan
        ? node(
            'span',
            `${key}-l`,
            { class: classes(link.labelHiddenInBar && 'navx-hide-in-bar') },
            [link.label],
          )
        : link.label,
    );
  }

  if (link.badge !== undefined) {
    out.push(node('span', `${key}-b`, { class: 'navx-badge' }, [link.badge]));
  }
  return out;
}

/**
 * The chevron.
 *
 * Stage 3 chose a real `<button>` in the markup over a JS-injected span, and
 * this is where that decision is paid for exactly once instead of by every
 * consumer. `aria-expanded="false"` is the initial state; `attach()` owns it
 * from then on.
 */
function chevron(label: string | undefined, key: string, o: PlanOptions): NavxNode {
  const name = label && o.labelDisclosure ? o.labelDisclosure(label) : label && `${label} submenu`;
  return node('button', key, {
    type: 'button',
    class: 'navx-chevron',
    'aria-expanded': 'false',
    'aria-label': name,
  });
}

/**
 * A link, in one of two shapes.
 *
 * Without a submenu it is a plain `<a class="navx-link">`. With one, the class
 * moves to a `<div>` that holds the `<a>` and the chevron as siblings — the
 * APG disclosure shape — because a `<button>` inside an `<a>` is invalid HTML
 * and nested interactive content. Stage 2's selectors were relaxed from child
 * to descendant so one stylesheet serves both, and the Stage 2 gate re-ran
 * clean to prove it.
 */
function linkShape(
  link: NavxLink,
  className: string,
  key: string,
  hasSubmenu: boolean,
  o: PlanOptions,
): NavxNode {
  const inner = linkChildren(link, key, o);
  const href = link.href ?? '#';
  const cls = classes(className, link.hiddenInPanel && 'navx-hide-in-panel');

  if (!hasSubmenu) return node('a', key, { class: cls, href }, inner);

  return node('div', key, { class: cls }, [
    node('a', `${key}-a`, { href }, inner),
    chevron(link.label, `${key}-c`, o),
  ]);
}

function blockNodes(block: NavxBlock, key: string, o: PlanOptions): NavxNode {
  switch (block.type) {
    case 'list':
      return node('ul', key, { class: 'navx-list' }, [
        ...(block.heading
          ? [
              node('li', `${key}-h`, { class: 'navx-list-heading' }, [
                node('a', `${key}-ha`, { href: block.heading.href ?? '#' }, [
                  block.heading.label ?? '',
                ]),
              ]),
            ]
          : []),
        ...block.items.map((item, i) =>
          node('li', `${key}-${i}`, {}, [
            node(
              'a',
              `${key}-${i}a`,
              { href: item.href ?? '#' },
              linkChildren(item, `${key}-${i}`, o),
            ),
          ]),
        ),
      ]);
    case 'image':
      return imageNode(block.image, key, o.assetBase);
    case 'heading':
      return node(`h${block.level ?? 6}`, key, { class: block.className }, [block.text]);
    case 'text':
      return node('p', key, { class: block.className }, [block.text]);
    case 'row':
      return rowNode(block.row, key, o);
  }
}

function rowNode(row: NavxRow, key: string, o: PlanOptions): NavxNode {
  return node(
    'div',
    key,
    { class: classes('navx-row', row.className) },
    row.cols.map((col, i) =>
      node(
        'div',
        `${key}-c${i}`,
        {
          class: classes(col.span ? `navx-col-${col.span}` : 'navx-col', col.className),
        },
        col.blocks.map((block, j) => blockNodes(block, `${key}-c${i}-${j}`, o)),
      ),
    ),
  );
}

/**
 * A submenu, and its structural id.
 *
 * `path` is the chain `attach()` computes with `pathOf()` — depth and child
 * index, nothing generated. Emitting the same scheme here is what lets a
 * server-rendered nav hydrate without the client disagreeing about which menu
 * is which.
 */
function submenuNode(submenu: NavxSubmenu, path: readonly string[], o: PlanOptions): NavxNode {
  const key = `s${path.join('.')}`;

  if (submenu.type === 'megamenu') {
    return node(
      'div',
      key,
      {
        class: 'navx-megamenu',
        'data-navx-width': submenu.width,
      },
      [
        node(
          'div',
          `${key}-k`,
          { class: 'navx-megamenu-container' },
          submenu.rows.map((row, i) => rowNode(row, `${key}-r${i}`, o)),
        ),
      ],
    );
  }

  return node(
    'ul',
    key,
    {
      class: 'navx-submenu',
      'data-navx-submenu': submenu.horizontal && 'horizontal',
      'data-navx-submenu-side': submenu.side,
    },
    submenu.items.map((item, i) => submenuItemNode(item, [...path, String(i)], o)),
  );
}

function submenuItemNode(item: NavxSubmenuItem, path: readonly string[], o: PlanOptions): NavxNode {
  const key = `i${path.join('.')}`;
  return node(
    'li',
    key,
    {
      class: 'navx-submenu-item',
      'data-navx-current': item.current && '',
    },
    [
      linkShape(item, 'navx-submenu-link', `${key}-l`, item.submenu !== undefined, o),
      ...(item.submenu ? [submenuNode(item.submenu, path, o)] : []),
    ],
  );
}

const ITEM_ATTR = { icon: 'icon', avatar: 'avatar' } as const;
const ITEM_CLASS = { brand: 'navx-brand', logo: 'navx-logo' } as const;

function itemNode(item: NavxItem, path: readonly string[], o: PlanOptions): NavxNode {
  const key = `i${path.join('.')}`;
  const variant = item.variant;
  return node(
    'li',
    key,
    {
      class: classes(
        'navx-item',
        variant && ITEM_CLASS[variant as 'brand' | 'logo'],
        item.hideItemInPanel && 'navx-hide-in-panel',
      ),
      'data-navx-item': variant ? ITEM_ATTR[variant as 'icon' | 'avatar'] : undefined,
      'data-navx-current': item.current && '',
    },
    [
      linkShape(item, 'navx-link', `${key}-l`, item.submenu !== undefined, o),
      ...(item.submenu ? [submenuNode(item.submenu, path, o)] : []),
    ],
  );
}

function logoNode(logo: NonNullable<NavxContent['logo']>, key: string, o: PlanOptions): NavxNode {
  return node('div', key, { class: classes('navx-logo', logo.hiddenInBar && 'navx-hide-in-bar') }, [
    node('a', `${key}-a`, { href: logo.href ?? '#' }, [
      ...(logo.image ? [imageNode(logo.image, `${key}-img`, o.assetBase)] : []),
    ]),
  ]);
}

function brandNode(brand: NavxLink, key: string): NavxNode {
  return node('div', key, { class: 'navx-brand' }, [
    node('a', `${key}-a`, { href: brand.href ?? '#' }, [brand.label ?? '']),
  ]);
}

function sectionNode(section: NavxSection, key: string, o: PlanOptions): NavxNode {
  switch (section.type) {
    case 'form': {
      const submitIcon = iconChild(section.submit?.icon, `${key}-si`, o.icons);
      return node('form', key, { class: 'navx-form' }, [
        node('input', `${key}-in`, {
          class: 'navx-input',
          type: section.input.type ?? 'text',
          name: section.input.name,
          placeholder: section.input.placeholder,
        }),
        node('button', `${key}-btn`, { class: 'navx-btn', type: 'submit' }, [
          // NAVX's own glyph first — drawn by the stylesheet, no icon map
          // involved — then any mapped icon, then the label.
          ...(section.submit?.glyph === 'search'
            ? [node('i', `${key}-g`, { class: 'navx-search-icon' })]
            : []),
          ...(submitIcon === '' ? [] : [submitIcon]),
          ...(section.submit?.label ? [section.submit.label] : []),
        ]),
      ]);
    }
    case 'button': {
      const icon = iconChild(section.icon, `${key}-i`, o.icons);
      const children: NavxChild[] = [];
      if (section.glyph === 'search') {
        children.push(node('i', `${key}-g`, { class: 'navx-search-icon' }));
      }
      if (icon !== '') children.push(icon);
      if (section.label) children.push(section.label);
      return section.href
        ? node('a', key, { class: 'navx-btn', href: section.href }, children)
        : node('button', key, { class: 'navx-btn', type: 'button' }, children);
    }
    case 'text':
      return node('div', key, { class: 'navx-text' }, [section.text]);
  }
}

/**
 * Build the tree.
 *
 * `preset.slots` is not consulted to *filter* content — content is the source
 * of truth for what exists, and slots exist so a preset renders a plausible
 * shell before you supply any. Passing content whose shape disagrees with the
 * preset's slots is allowed and renders the content; the Stage 5 gate asserts
 * they agree for the extracted pairs.
 */
export function plan(
  preset: NavxPreset,
  content: NavxContent,
  options: PlanOptions = {},
): NavxNode {
  const o: PlanOptions = {
    ...options,
    assetBase: options.assetBase ?? content.assetBase,
    labelToggler: options.labelToggler ?? content.labelToggler ?? 'Menu',
    labelClose: options.labelClose ?? content.labelClose ?? 'Close',
  };

  const header = node('div', 'header', { class: 'navx-header' }, [
    ...(content.logo ? [logoNode(content.logo, 'header-logo', o)] : []),
    ...(content.brand ? [brandNode(content.brand, 'header-brand')] : []),
    node(
      'button',
      'toggler',
      {
        type: 'button',
        class: 'navx-toggler',
        'aria-expanded': 'false',
        'aria-label': o.labelToggler,
      },
      [node('i', 'toggler-i', { class: 'navx-toggler-icon' })],
    ),
  ]);

  const ph = preset.slots.panelHeader;
  const panelHeader = node(
    'div',
    'panel-header',
    {
      class: classes(
        'navx-panel-header',
        ph?.hiddenInBar && 'navx-hide-in-bar',
        ph?.push === 'end' && 'navx-push-end',
        ph?.push === 'start' && 'navx-push-start',
      ),
    },
    [
      ...(content.panelLogo ? [logoNode(content.panelLogo, 'panel-logo', o)] : []),
      ...(content.panelBrand ? [brandNode(content.panelBrand, 'panel-brand')] : []),
      node(
        'button',
        'panel-close',
        { type: 'button', class: 'navx-panel-close', 'aria-label': o.labelClose },
        // The glyph is the element's text, as in the baselines; the accessible
        // name is a real word. Announcing "multiplication x" is what happens
        // when one field is asked to be both.
        content.closeGlyph ? [content.closeGlyph] : [],
      ),
    ],
  );

  const sectionNodes = content.sections.map((section, s) =>
    node(
      'div',
      `section${s}`,
      {
        class: classes(
          'navx-panel-section',
          section.push === 'end' && 'navx-push-end',
          section.push === 'start' && 'navx-push-start',
        ),
      },
      [sectionNode(section, `section${s}-c`, o)],
    ),
  );
  const before = content.sections
    .map((s, i) => [s, i] as const)
    .filter(([s]) => s.place === 'before-menus')
    .map(([, i]) => sectionNodes[i] as NavxNode);
  const after = content.sections
    .map((s, i) => [s, i] as const)
    .filter(([s]) => s.place !== 'before-menus')
    .map(([, i]) => sectionNodes[i] as NavxNode);

  const panel = node('div', 'panel', { class: 'navx-panel' }, [
    panelHeader,
    ...before,
    ...content.menus.map((menu, m) =>
      node(
        'ul',
        `menu${m}`,
        {
          class: classes(
            'navx-menu',
            menu.social && 'navx-social',
            menu.push === 'end' && 'navx-push-end',
            menu.push === 'start' && 'navx-push-start',
            menu.spaced && 'navx-spaced',
          ),
        },
        // The path root is the menu index, which is what `pathOf()` derives
        // from the DOM: a submenu's identity is where it sits, not what it is
        // called.
        menu.items.map((item, i) => itemNode(item, [String(m), String(i)], o)),
      ),
    ),
    ...after,
  ]);

  return node(
    'nav',
    'navx',
    {
      class: 'navx',
      'data-navx-align': preset.align,
      'data-navx-logo': preset.logo,
      'data-navx-position': preset.position,
      'data-navx-transparent': preset.transparent && '',
      'data-navx-fullscreen': preset.fullscreen && '',
    },
    [header, panel, ...(o.overlay ? [node('div', 'overlay', { class: 'navx-overlay' })] : [])],
  );
}

/**
 * Serialise a plan to HTML.
 *
 * Used by the cross-adapter gate as the reference string, by SSR, and by
 * anyone with no framework at all. Opaque children cannot be serialised —
 * they are framework values — so this throws rather than emitting something
 * that looks like markup and is not.
 */
export function html(tree: NavxNode): string {
  const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link']);
  const escapeText = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

  const render = (n: NavxChild): string => {
    if (typeof n === 'string') return escapeText(n);
    if (!isNode(n)) {
      throw new TypeError(
        'html() cannot serialise an opaque icon. Pass class-string icons, or render through an adapter.',
      );
    }
    const a = Object.entries(n.attrs)
      .map(([k, v]) => (v === '' ? ` ${k}=""` : ` ${k}="${escapeAttr(v)}"`))
      .join('');
    if (VOID.has(n.tag)) return `<${n.tag}${a}>`;
    return `<${n.tag}${a}>${n.children.map(render).join('')}</${n.tag}>`;
  };

  return render(tree);
}

/** Options `attach()` should be given for this preset. */
export function attachOptions(preset: NavxPreset): { trigger?: 'click' | 'hover' } {
  return preset.trigger ? { trigger: preset.trigger } : {};
}
