/**
 * Derive @navx/presets from the legacy catalogue.
 *
 * Stage 5's data has to come from somewhere, and hand-transcribing 56 nav
 * trees is both slow and unfalsifiable — a typo in variant 31 would look
 * exactly like a design decision. So this walks the fixtures Stage 0 extracted
 * and emits, per variant, two things:
 *
 *   packages/presets/src/catalogue.ts     the chrome: layout, skin, slots.
 *                                         No labels, no hrefs, no URLs.
 *   packages/presets/src/demo/<id>.ts     the catalogue's own content, which
 *                                         is what the pixel gate renders.
 *
 * It reads `tools/baseline/tests/_fixtures` (gitignored, separately licensed)
 * and writes committed TypeScript. Contributors cannot rerun it without the
 * legacy tree, which is exactly why its output is committed rather than
 * generated at build time.
 *
 * The important property is that it is **total**. Every element it meets must
 * match a recognizer; anything unaccounted for is collected and printed, and
 * the run fails. A schema that silently drops a node produces a preset that
 * renders a nav subtly unlike the one it claims to reproduce, and the pixel
 * gate would then be arguing with a lie.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const HARNESS = resolve(HERE, '..');
const REPO = resolve(HARNESS, '../..');
const FIXTURES = join(HARNESS, 'tests/_fixtures');
const MANIFEST = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8'));
/** Legacy init options, by fixture id. */
const OPTIONS = new Map(MANIFEST.variants.map((v) => [v.id, v.options ?? {}]));
/** Options Stage 5 does not model. Reported, never dropped in silence. */
const deferred = new Map();
const OUT_CATALOGUE = join(REPO, 'packages/presets/src/catalogue.ts');
const OUT_DEMO = join(REPO, 'packages/presets/src/demo');

/** Font Awesome class → the semantic name a preset carries instead. */
const ICONS = {
  'fa-home': 'home',
  'fa-search': 'search',
  'fa-user': 'user',
  'fa-shopping-cart': 'cart',
  'fa-cog': 'settings',
  'fa-envelope': 'mail',
  'fa-bars': 'menu',
  'fa-sign-in-alt': 'sign-in',
  'fa-facebook-f': 'facebook',
  'fa-twitter': 'twitter',
  'fa-instagram': 'instagram',
};

/** Anything unrecognised lands here and fails the run. */
const unknown = new Map();
const note = (what, where) => {
  const key = `${what}  (in ${where})`;
  unknown.set(key, (unknown.get(key) ?? 0) + 1);
};

const has = (el, c) => el.classList.contains(c);
const kids = (el) => [...el.children];
const text = (el) =>
  [...el.childNodes]
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');

/**
 * Image sources become bare filenames.
 *
 * The fixtures carry 112 image nodes and every one points at a
 * `/legacy/<page>_files/...` path that exists only on the harness's server.
 * Shipping those would give every consumer of the demo content a broken
 * image, so the filename travels in the data and the folder travels once, as
 * `NavxContent.assetBase`. Each fixture happens to use exactly one folder,
 * which the caller asserts.
 */
const bases = new Map();
/** Set once per fixture in `extract()`, so leaf helpers need no extra argument. */
let currentId = '';
function srcOf(img) {
  const id = currentId;
  const raw = img.getAttribute('src') ?? '';
  const cut = raw.lastIndexOf('/');
  if (cut === -1) return raw;
  const base = raw.slice(0, cut + 1);
  const seen = bases.get(id);
  if (seen && seen !== base) note(`two asset folders: ${seen} and ${base}`, id);
  bases.set(id, base);
  return raw.slice(cut + 1);
}

/** Bootstrap utilities on demo images/paragraphs travel as consumer content. */
const passthroughClass = (el) => {
  const kept = [...el.classList].filter((c) => !c.startsWith('navigation'));
  return kept.length ? kept.join(' ') : undefined;
};

function imageOf(img, where) {
  if (img.tagName !== 'IMG') {
    note(`expected <img>, got <${img.tagName}>`, where);
    return undefined;
  }
  const out = { src: srcOf(img), alt: img.getAttribute('alt') ?? '' };
  const cls = passthroughClass(img);
  if (cls) out.className = cls;
  return out;
}

/** `<div class="navigation-logo"><a><img></a></div>` */
function logoOf(el, where) {
  const a = kids(el).find((k) => k.tagName === 'A');
  if (!a) {
    note('navigation-logo without <a>', where);
    return undefined;
  }
  const img = kids(a).find((k) => k.tagName === 'IMG');
  const out = {};
  if (img) out.image = imageOf(img, `${where} > logo`);
  if (has(el, 'hide-on-landscape')) out.hiddenInBar = true;
  const href = a.getAttribute('href');
  if (href) out.href = href;
  for (const other of kids(a)) if (other !== img) note(`logo > <${other.tagName}>`, where);
  return out;
}

/** `<div class="navigation-brand-text"><a>Text</a></div>` */
function brandOf(el, where) {
  const a = kids(el).find((k) => k.tagName === 'A');
  if (!a) {
    note('navigation-brand-text without <a>', where);
    return undefined;
  }
  const out = { label: text(a) };
  const href = a.getAttribute('href');
  if (href) out.href = href;
  return out;
}

/**
 * The inside of an `<a>`: icons, an image, the label, a badge.
 *
 * Legacy wrapped labels in a bare `<span>` sometimes and not others, and used
 * `hide-on-landscape` on the span to drop the label in bar mode. Both collapse
 * into fields here, which is the point of the exercise.
 */
function linkParts(a, where) {
  const out = {};
  const own = text(a);
  if (own) out.label = own;

  for (const child of kids(a)) {
    if (child.tagName === 'I') {
      const fa = [...child.classList].find((c) => c.startsWith('fa-'));
      if (fa && ICONS[fa]) out.icon = ICONS[fa];
      else note(`unmapped icon: ${[...child.classList].join('.')}`, where);
      continue;
    }
    if (child.tagName === 'IMG') {
      out.image = imageOf(child, `${where} > link`);
      continue;
    }
    if (child.tagName === 'SPAN') {
      if (has(child, 'navigation-badge')) {
        out.badge = text(child);
        continue;
      }
      const label = text(child);
      if (label) {
        out.label = label;
        /**
         * The catalogue is inconsistent here: 71 of its 315 links wrap the
         * label in a `<span>` and the rest leave it as a bare text node, and
         * the difference is visible — `.navx-link i + span` is what puts a gap
         * between an icon and its label, so an icon followed by bare text sits
         * flush. Recording it keeps the pixel gate exact instead of making me
         * choose which 34 links to be wrong about. Consumers writing their own
         * content never set this.
         */
        out.wrapLabel = true;
      }
      if (has(child, 'hide-on-landscape')) out.labelHiddenInBar = true;
      const extra = [...child.classList].filter(
        (c) => c !== 'hide-on-landscape' && !c.startsWith('navigation'),
      );
      if (extra.length) note(`span with classes ${extra.join('.')}`, where);
      continue;
    }
    note(`link > <${child.tagName}>`, where);
  }

  if (has(a, 'hide-on-portrait')) out.hiddenInPanel = true;

  const href = a.getAttribute('href');
  if (href) out.href = href;
  return out;
}

/** `<ul class="navigation-list">` — heading plus links. */
function listOf(ul, where) {
  const items = [];
  let heading;
  for (const li of kids(ul)) {
    const a = kids(li).find((k) => k.tagName === 'A');
    if (!a) {
      note(`navigation-list > <${li.tagName}> without <a>`, where);
      continue;
    }
    const link = linkParts(a, `${where} > list`);
    if (has(li, 'navigation-list-heading')) heading = link;
    else items.push(link);
  }
  const out = { type: 'list', items };
  if (heading) out.heading = heading;
  return out;
}

function rowOf(row, where) {
  const cols = [];
  const rowClass = passthroughClass(row);
  for (const col of kids(row)) {
    if (
      !has(col, 'navigation-col') &&
      ![...col.classList].some((c) => /^navigation-col-\d+$/.test(c))
    ) {
      note(`navigation-row > .${[...col.classList].join('.')}`, where);
      continue;
    }
    const spanClass = [...col.classList].find((c) => /^navigation-col-\d+$/.test(c));
    const blocks = [];

    for (const block of kids(col)) {
      if (has(block, 'navigation-list')) {
        blocks.push(listOf(block, where));
      } else if (has(block, 'navigation-row')) {
        blocks.push({ type: 'row', row: rowOf(block, where) });
      } else if (block.tagName === 'IMG') {
        blocks.push({ type: 'image', image: imageOf(block, `${where} > col`) });
      } else if (/^H[2-6]$/.test(block.tagName)) {
        const entry = { type: 'heading', text: text(block), level: Number(block.tagName[1]) };
        const cls = passthroughClass(block);
        if (cls) entry.className = cls;
        blocks.push(entry);
      } else if (block.tagName === 'P') {
        const entry = { type: 'text', text: text(block) };
        const cls = passthroughClass(block);
        if (cls) entry.className = cls;
        blocks.push(entry);
      } else {
        note(`col > <${block.tagName}>.${[...block.classList].join('.')}`, where);
      }
    }

    const entry = { blocks };
    if (spanClass) entry.span = Number(spanClass.replace('navigation-col-', ''));
    const colClass = passthroughClass(col);
    if (colClass) entry.className = colClass;
    cols.push(entry);
  }
  return rowClass ? { cols, className: rowClass } : { cols };
}

function submenuOf(el, where) {
  if (has(el, 'navigation-megamenu')) {
    const container = kids(el).find((k) => has(k, 'navigation-megamenu-container'));
    if (!container) {
      note('megamenu without container', where);
      return undefined;
    }
    const rows = kids(container)
      .filter((k) => has(k, 'navigation-row'))
      .map((r) => rowOf(r, where));
    for (const other of kids(container)) {
      if (!has(other, 'navigation-row')) note(`megamenu-container > <${other.tagName}>`, where);
    }
    return { type: 'megamenu', rows };
  }

  if (has(el, 'navigation-dropdown')) {
    const items = [];
    for (const li of kids(el)) {
      if (!has(li, 'navigation-dropdown-item')) {
        note(`dropdown > .${[...li.classList].join('.')}`, where);
        continue;
      }
      const a = kids(li).find((k) => has(k, 'navigation-dropdown-link'));
      const nested = kids(li).find(
        (k) => has(k, 'navigation-dropdown') || has(k, 'navigation-megamenu'),
      );
      const item = a ? linkParts(a, `${where} > dropdown`) : {};
      if (!a) note('dropdown-item without a link', where);
      if (nested) item.submenu = submenuOf(nested, where);
      for (const other of kids(li)) {
        if (other !== a && other !== nested) note(`dropdown-item > <${other.tagName}>`, where);
      }
      items.push(item);
    }
    const out = { type: 'dropdown', items };
    if (has(el, 'navigation-dropdown-horizontal')) out.horizontal = true;
    if (has(el, 'navigation-dropdown-left')) out.side = 'start';
    return out;
  }
  note(`unrecognised submenu .${[...el.classList].join('.')}`, where);
  return undefined;
}

const ITEM_VARIANTS = {
  'navigation-icon-item': 'icon',
  'navigation-avatar-item': 'avatar',
  'navigation-brand-text': 'brand',
  'navigation-logo': 'logo',
};

function itemOf(li, where) {
  const a = kids(li).find((k) => has(k, 'navigation-link'));
  const submenu = kids(li).find(
    (k) => has(k, 'navigation-dropdown') || has(k, 'navigation-megamenu'),
  );
  const item = a ? linkParts(a, `${where} > item`) : {};
  if (!a) note('navigation-item without a link', where);

  for (const [cls, variant] of Object.entries(ITEM_VARIANTS)) {
    if (has(li, cls)) item.variant = variant;
  }
  if (has(li, 'is-active')) item.current = true;
  if (has(li, 'hide-on-portrait')) item.hideItemInPanel = true;
  if (submenu) item.submenu = submenuOf(submenu, where);

  for (const other of kids(li)) {
    if (other !== a && other !== submenu) note(`item > <${other.tagName}>`, where);
  }
  return item;
}

function menuOf(ul, where) {
  const items = [];
  for (const li of kids(ul)) {
    if (!has(li, 'navigation-item')) {
      note(`menu > .${[...li.classList].join('.')}`, where);
      continue;
    }
    items.push(itemOf(li, where));
  }
  const out = { items };
  if (has(ul, 'navigation-social-menu')) out.social = true;
  // Layout modifiers legacy put on the menu itself. Named for the inline edge
  // rather than a physical side — see NavxMenu.push.
  if (has(ul, 'align-to-right')) out.push = 'end';
  if (has(ul, 'align-to-left')) out.push = 'start';
  if (has(ul, 'margin-top')) out.spaced = true;
  return out;
}

function sectionOf(el, where) {
  const out = [];
  // The modifier lives on the `.navigation-body-section` div, not on its
  // child, so reading only the children dropped it on three variants and
  // stopped their search form being pushed to the inline end.
  const push = has(el, 'align-to-right') ? 'end' : has(el, 'align-to-left') ? 'start' : undefined;
  const withPush = (entry) => (push ? { ...entry, push } : entry);
  for (const child of kids(el)) {
    if (has(child, 'navigation-inline-form')) {
      const input = kids(child).find((k) => has(k, 'navigation-input'));
      const button = kids(child).find((k) => has(k, 'navigation-btn'));
      const entry = { type: 'form', input: {} };
      if (input) {
        for (const [k, a] of [
          ['type', 'type'],
          ['name', 'name'],
          ['placeholder', 'placeholder'],
        ]) {
          const v = input.getAttribute(a);
          if (v) entry.input[k] = v;
        }
      } else note('inline-form without an input', where);
      if (button) {
        const glyph = kids(button).find((k) => has(k, 'navigation-search-icon'));
        const label = text(button);
        entry.submit = {};
        // `.navx-search-icon` is drawn by the stylesheet. Recording it as the
        // semantic icon `search` made the planner emit `fas fa-search` too.
        if (glyph) entry.submit.glyph = 'search';
        if (label) entry.submit.label = label;
      }
      out.push(withPush(entry));
      continue;
    }
    if (has(child, 'navigation-btn')) {
      const entry = { type: 'button' };
      const label = text(child);
      if (label) entry.label = label;
      const href = child.getAttribute('href');
      if (href) entry.href = href;
      const icon = kids(child).find((k) => k.tagName === 'I');
      if (icon) {
        const fa = [...icon.classList].find((c) => c.startsWith('fa-'));
        if (has(icon, 'navigation-search-icon')) entry.glyph = 'search';
        else if (fa && ICONS[fa]) entry.icon = ICONS[fa];
        else note(`unmapped button icon .${[...icon.classList].join('.')}`, where);
      }
      out.push(withPush(entry));
      continue;
    }
    if (has(child, 'navigation-text')) {
      out.push(withPush({ type: 'text', text: text(child) }));
      continue;
    }
    note(`body-section > .${[...child.classList].join('.')}`, where);
  }
  return out;
}

/** One fixture → `{ preset, content }`. */
function extract(id, html) {
  currentId = id;
  const dom = new JSDOM(`<body>${html}</body>`);
  const root = dom.window.document.body.firstElementChild;
  const where = id;

  const content = { menus: [], sections: [] };
  const slots = { menus: [], sections: [] };
  const preset = { id, name: id, slots };

  if (has(root, 'navigation-justified')) preset.align = 'between';
  if (has(root, 'navigation-centered')) preset.align = 'center';
  if (has(root, 'navigation-logo-top')) preset.logo = 'top';
  if (has(root, 'sticky-top')) preset.position = 'sticky';

  const header = kids(root).find((k) => has(k, 'navigation-header'));
  const body = kids(root).find((k) => has(k, 'navigation-body'));
  if (!header || !body) throw new Error(`${id}: missing header or body`);
  for (const other of kids(root)) {
    if (other !== header && other !== body)
      note(`root > .${[...other.classList].join('.')}`, where);
  }

  for (const child of kids(header)) {
    if (has(child, 'navigation-logo')) {
      content.logo = logoOf(child, where);
      slots.logo = true;
    } else if (has(child, 'navigation-brand-text')) {
      content.brand = brandOf(child, where);
      slots.brand = true;
    } else if (has(child, 'navigation-button-toggler')) {
      // Always present, so it is not a slot — it is the nav.
      const icon = kids(child).find((k) => k.tagName === 'I');
      if (!icon || !has(icon, 'hamburger-icon')) note('toggler without hamburger-icon', where);
    } else {
      note(`header > .${[...child.classList].join('.')}`, where);
    }
  }

  for (const child of kids(body)) {
    if (has(child, 'navigation-body-header')) {
      // Modifiers on the drawer header itself — dropped until the pixel gate
      // showed the header sitting in the wrong place on three variants.
      const header = {};
      if (has(child, 'hide-on-landscape')) header.hiddenInBar = true;
      if (has(child, 'align-to-right')) header.push = 'end';
      if (has(child, 'align-to-left')) header.push = 'start';
      if (Object.keys(header).length) slots.panelHeader = header;

      for (const inner of kids(child)) {
        if (has(inner, 'navigation-logo')) {
          content.panelLogo = logoOf(inner, where);
          slots.panelLogo = true;
        } else if (has(inner, 'navigation-brand-text')) {
          content.panelBrand = brandOf(inner, where);
          slots.panelBrand = true;
        } else if (has(inner, 'navigation-body-close-button')) {
          // The glyph, not the accessible name — see NavxContent.closeGlyph.
          content.closeGlyph = text(inner) || undefined;
        } else {
          note(`body-header > .${[...inner.classList].join('.')}`, where);
        }
      }
    } else if (has(child, 'navigation-menu')) {
      const menu = menuOf(child, where);
      content.menus.push(menu);
      slots.menus.push({
        ...(menu.social ? { social: true } : {}),
        ...(menu.push ? { push: menu.push } : {}),
        ...(menu.spaced ? { spaced: true } : {}),
      });
    } else if (has(child, 'navigation-body-section')) {
      // A section met before any menu sits before them all — two variants.
      const place = content.menus.length === 0 ? { place: 'before-menus' } : {};
      const sections = sectionOf(child, where).map((s) => ({ ...s, ...place }));
      content.sections.push(...sections);
      slots.sections.push(...sections.map((s) => s.type));
      for (const s of sections) if (s.push) slots.sectionPush = true;
    } else {
      note(`body > .${[...child.classList].join('.')}`, where);
    }
  }

  /**
   * Legacy init options.
   *
   * `submenuTrigger` is the only one Stage 5 models. Legacy's *default* was
   * hover, and this deliberately does not reproduce that: Stage 3 chose click
   * as the core default because hover-only disclosure is unreachable by
   * keyboard and hostile on touch. So a preset states `trigger` only when the
   * variant is specifically about it, and otherwise inherits the core's
   * default — a divergence recorded in docs/stage5.md rather than smuggled in.
   */
  const options = OPTIONS.get(id) ?? {};
  for (const [key, value] of Object.entries(options)) {
    if (key === 'submenuTrigger') {
      preset.trigger = value === 'click' ? 'click' : 'hover';
      continue;
    }
    const entry = `${key} = ${JSON.stringify(value)}`;
    if (!deferred.has(entry)) deferred.set(entry, []);
    deferred.get(entry).push(id);
  }

  const base = bases.get(id);
  if (base) content.assetBase = base;

  return { preset, content };
}

// ─── run ────────────────────────────────────────────────────────

const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.html'))
  .sort((a, b) => {
    const n = (s) => Number(s.match(/(\d+)/)?.[1] ?? 0);
    return a.startsWith('navigation') && b.startsWith('navigation')
      ? n(a) - n(b)
      : a.localeCompare(b);
  });

const variants = [];
for (const file of files) {
  const id = file.replace(/\.html$/, '');
  variants.push({ id, ...extract(id, readFileSync(join(FIXTURES, file), 'utf8')) });
}

if (deferred.size) {
  console.log('\ndeferred to Stage 6 (recorded, not modelled):');
  for (const [entry, ids] of deferred) console.log(`  ${entry}  — ${ids.join(', ')}`);
}

if (unknown.size) {
  console.error(`\n${unknown.size} unrecognised construct(s) — the schema is incomplete:\n`);
  for (const [what, n] of [...unknown.entries()].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${String(n).padStart(4)}  ${what}`);
  }
  console.error('\nAdd a field or a recognizer. Extraction refuses to guess.\n');
  process.exit(1);
}

// ─── dedupe ────────────────────────────────────────────────────

/**
 * Collapse variants whose chrome is identical.
 *
 * The catalogue has 46 pages, and grouping them by chrome yields far fewer
 * distinct shells: most of the "variants" differ only in which icons and
 * labels the demo used, which is content. Shipping one preset per page would
 * hand consumers a list of near-duplicates to choose between and 25 names
 * that mean nothing, so identical chrome becomes one preset and the pages
 * live on as demo content pointing at it.
 *
 * Nothing is lost: every fixture still resolves to exactly one preset plus its
 * own content, which is what the Stage 5 gates render and compare.
 */
const chromeKey = ({ preset }) =>
  JSON.stringify({
    align: preset.align,
    logo: preset.logo,
    position: preset.position,
    transparent: preset.transparent,
    fullscreen: preset.fullscreen,
    skin: preset.skin,
    trigger: preset.trigger,
    slots: preset.slots,
  });

const groups = new Map();
for (const v of variants) {
  const key = chromeKey(v);
  if (!groups.has(key)) groups.set(key, { preset: v.preset, fixtures: [] });
  groups.get(key).fixtures.push(v.id);
}

/**
 * Name a preset after its chrome, and only its chrome.
 *
 * Content-derived names were the first attempt and they produced
 * `justified2` .. `justified13` — a lottery number with extra steps — because
 * the features doing the distinguishing lived in the content that a preset
 * deliberately does not carry.
 */
const COUNT_WORD = { 2: 'Dual', 3: 'Triple', 4: 'Quad' };

function nameOf(preset) {
  const p = [];
  const words = [];

  if (preset.align === 'between') {
    p.push('justified');
    words.push('Justified');
  } else if (preset.align === 'center') {
    p.push('centered');
    words.push('Centered');
  } else {
    p.push('plain');
    words.push('Plain');
  }

  if (preset.logo === 'top') {
    p.push('LogoTop');
    words.push('logo above the bar');
  }
  if (preset.position === 'sticky') {
    p.push('Sticky');
    words.push('sticky');
  }
  if (preset.position === 'fixed') {
    p.push('Fixed');
    words.push('fixed');
  }

  if (preset.slots.brand) {
    p.push('Brand');
    words.push('brand text');
  } else if (preset.slots.logo && preset.logo !== 'top') {
    p.push('Logo');
    words.push('a logo');
  }

  const menus = preset.slots.menus;
  if (menus.some((m) => m.social)) {
    p.push('Social');
    words.push('social icons');
  }
  if (menus.length > 1) {
    p.push(COUNT_WORD[menus.length] ?? `Menus${menus.length}`);
    words.push(`${menus.length} menus`);
  }

  // The layout modifiers, which is what four of the collisions were: variants
  // that differ only in where a menu or a section sits deserve different
  // names, not a numeric suffix.
  const pushedEnd = menus.findIndex((m) => m.push === 'end');
  if (pushedEnd !== -1) {
    // *Which* menu is pushed is a real difference — one variant pushes the
    // leading menu and three push the trailing one — so it earns a word rather
    // than the numeric suffix it would otherwise collide into.
    const lead = pushedEnd === 0 && menus.length > 1;
    p.push(lead ? 'LeadMenuEnd' : 'MenuEnd');
    words.push(lead ? 'the first menu at the trailing edge' : 'a menu at the trailing edge');
  }
  if (menus.some((m) => m.push === 'start')) {
    p.push('MenuStart');
    words.push('a menu at the leading edge');
  }
  if (menus.some((m) => m.spaced)) {
    p.push('Spaced');
    words.push('a spaced menu');
  }
  if (preset.slots.sectionPush) {
    p.push('SectionEnd');
    words.push('a section at the trailing edge');
  }

  for (const [type, part, word] of [
    ['form', 'Search', 'a search field'],
    ['button', 'Button', 'a button'],
    ['text', 'Text', 'a text block'],
  ]) {
    if (preset.slots.sections.includes(type)) {
      p.push(part);
      words.push(word);
    }
  }

  if (preset.trigger === 'click') {
    p.push('Click');
    words.push('click to open');
  }
  if (preset.trigger === 'hover') {
    p.push('Hover');
    words.push('hover to open');
  }

  return { export: p.join(''), human: words.join(', ') };
}

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const taken = new Map();
const presets = [];

for (const group of groups.values()) {
  const { export: base, human } = nameOf(group.preset);
  const n = (taken.get(base) ?? 0) + 1;
  taken.set(base, n);
  const exportName = n === 1 ? base : `${base}${n}`;
  group.exportName = exportName;
  group.preset.id = kebab(exportName);
  group.preset.name = human;
  presets.push(group);
}

const collisions = [...taken.values()].filter((n) => n > 1).length;

// ─── report ────────────────────────────────────────────────────

const count = (fn) => variants.filter(fn).length;
const size = (o) => JSON.stringify(o).length;

console.log(`\nextracted ${variants.length} variants → ${presets.length} distinct presets\n`);
console.log(
  '  align=between        ',
  count((r) => r.preset.align === 'between'),
);
console.log(
  '  align=center         ',
  count((r) => r.preset.align === 'center'),
);
console.log(
  '  logo=top             ',
  count((r) => r.preset.logo === 'top'),
);
console.log(
  '  position=sticky      ',
  count((r) => r.preset.position === 'sticky'),
);
console.log(
  '  header logo          ',
  count((r) => r.preset.slots.logo),
);
console.log(
  '  header brand         ',
  count((r) => r.preset.slots.brand),
);
console.log(
  '  social menu          ',
  count((r) => r.preset.slots.menus.some((m) => m.social)),
);
console.log(
  '  panel sections       ',
  count((r) => r.preset.slots.sections.length > 0),
);
console.log(
  '  megamenu             ',
  count((r) => size(r.content) && JSON.stringify(r.content).includes('"megamenu"')),
);
console.log(
  '  dropdown             ',
  count((r) => JSON.stringify(r.content).includes('"dropdown"')),
);
console.log(`  name collisions       ${collisions}`);

const presetBytes = presets.reduce((n, g) => n + size(g.preset), 0);
const contentBytes = variants.reduce((n, r) => n + size(r.content), 0);
console.log(
  `\n  chrome   ${presetBytes} B across ${presets.length} presets, ${Math.round(presetBytes / presets.length)} B mean
  content  ${contentBytes} B across ${variants.length} demos, ${Math.round(contentBytes / variants.length)} B mean  ← the half that stays out of your bundle\n`,
);

console.log('presets:');
for (const g of presets) {
  console.log(
    `  ${g.exportName.padEnd(34)} ${String(g.fixtures.length).padStart(2)} variant(s)  ${g.fixtures.slice(0, 3).join(', ')}${g.fixtures.length > 3 ? ', …' : ''}`,
  );
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ presets: presets.map((g) => ({ ...g })), variants }, null, 2));
  process.exit(0);
}

// ─── emit ──────────────────────────────────────────────────────

const lit = (v, indent = 2) => {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[\n${v.map((x) => `${pad}  ${lit(x, indent + 2)}`).join(',\n')}\n${pad}]`;
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(
        ([k, x]) =>
          `${pad}  ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${lit(x, indent + 2)}`,
      )
      .join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(v);
};

mkdirSync(OUT_DEMO, { recursive: true });

const banner = (what) => `/**
 * ${what}
 *
 * GENERATED by tools/baseline/tools/extract-presets.mjs from the legacy
 * catalogue. Committed rather than built, because regenerating it needs the
 * separately-licensed legacy tree that this repo deliberately does not carry.
 * Edit the extractor, not this file.
 */
`;

const fixtureToPreset = variants.map((v) => {
  const g = groups.get(chromeKey(v));
  return [v.id, g.exportName];
});

writeFileSync(
  OUT_CATALOGUE,
  `${banner('The catalogue presets — chrome only: layout, skin and which slots exist.')}
import type { NavxPreset } from './types.js';

${presets
  .map(
    ({ exportName, preset, fixtures }) =>
      `/** ${preset.name}. Reproduces ${fixtures.length} catalogue variant(s): ${fixtures.join(', ')}. */\nexport const ${exportName}: NavxPreset = ${lit(preset, 0)};`,
  )
  .join('\n\n')}

/** Every preset, for galleries and the Stage 5 gates. */
export const catalogue: readonly NavxPreset[] = [
${presets.map(({ exportName }) => `  ${exportName},`).join('\n')}
];

/**
 * Which preset reproduces which legacy fixture.
 *
 * ${variants.length} fixtures, ${presets.length} presets — the difference is variants whose chrome was
 * identical and whose content was not. The Stage 5 gates walk this map.
 */
export const byFixture: Readonly<Record<string, NavxPreset>> = {
${fixtureToPreset.map(([id, name]) => `  ${JSON.stringify(id)}: ${name},`).join('\n')}
};
`,
);

for (const v of variants) {
  const exportName = groups.get(chromeKey(v)).exportName;
  writeFileSync(
    join(OUT_DEMO, `${v.id}.ts`),
    `${banner(`Demo content for legacy variant "${v.id}" — the catalogue's own words.`)}
import { ${exportName} } from '../catalogue.js';
import type { NavxContent, NavxPreset } from '../types.js';

/** The chrome this content was written for. */
export const preset: NavxPreset = ${exportName};

export const content: NavxContent = ${lit(v.content, 0)};

export default content;
`,
  );
}

/**
 * Format what we just wrote with the repo's own formatter.
 *
 * The emitter produces valid TypeScript, not *canonical* TypeScript — double
 * quotes, no trailing commas — so every run left 57 files that `pnpm verify`
 * then rejected, and re-running the extractor silently undid a previous
 * `biome check --write`. Formatting here means the committed output is
 * canonical by construction and stays that way if the formatter's config ever
 * changes. Stage 2 hit the same papercut with generated JSON and solved it by
 * remembering to run Biome afterwards; a generator that needs remembering is a
 * generator that will be forgotten.
 */
try {
  execFileSync('npx', ['biome', 'check', '--write', OUT_CATALOGUE, OUT_DEMO], {
    cwd: REPO,
    stdio: 'pipe',
  });
  console.log('formatted with biome');
} catch (error) {
  console.error(`\nbiome could not format the generated files: ${error.message}`);
  process.exit(1);
}

console.log(`wrote ${OUT_CATALOGUE.replace(REPO, '.')}`);
console.log(`wrote ${variants.length} files to ${OUT_DEMO.replace(REPO, '.')}/\n`);
