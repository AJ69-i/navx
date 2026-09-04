/**
 * Generate the documentation section of the landing page.
 *
 *   import { buildDocs } from './docs.mjs'
 *
 * Everything below is derived from the *built packages* — the preset
 * catalogue, the demo content, the token file, the skin files. Nothing about
 * the library is retyped here.
 *
 * That constraint is the whole design. A docs page that hand-writes its
 * examples is a second source of truth for the markup contract, and it goes
 * stale in the direction that matters most: it keeps claiming the old API
 * works. Here, a preset that changes shape changes the page; a preset that is
 * deleted disappears from it; a snippet that names a preset names one that is
 * actually exported, because the name is read from the export.
 *
 * The one thing this file does own is prose. Which is as it should be — the
 * facts come from the packages, the explanation comes from a person.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const load = (relative) => import(pathToFileURL(join(REPO, relative)).href);

/* ── text helpers ─────────────────────────────────────────────────────────── */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const attr = (s) => esc(s).replace(/'/g, '&#39;');

/**
 * One pass, one alternation, so a match is claimed exactly once and nothing
 * nests. Applied *after* escaping, which is why strings are matched on
 * `&quot;` rather than `"`.
 *
 * This is deliberately shallow — it colours comments, strings, tag names and a
 * dozen keywords. A real parser would be more accurate and would also be a
 * second thing to maintain; the snippets here are short enough that shallow is
 * indistinguishable from correct.
 */
const KEYWORDS =
  'import|from|export|const|let|var|function|return|class|new|await|async|default|readonly|type|interface|extends';

const TOKENS = new RegExp(
  [
    '(\\/\\/[^\\n]*)', // 1 line comment
    '(\\/\\*[\\s\\S]*?\\*\\/)', // 2 block comment
    '(&quot;(?:[^&]|&(?!quot;))*&quot;)', // 3 double-quoted
    "('[^'\\n]*')", // 4 single-quoted
    '(`[^`]*`)', // 5 template
    '(&lt;\\/?)([a-zA-Z][\\w.-]*)', // 6,7 tag open + name
    `\\b(${KEYWORDS})\\b`, // 8 keyword
  ].join('|'),
  'g',
);

const highlight = (escaped) =>
  escaped.replace(TOKENS, (match, line, block, dq, sq, tick, lt, tag, kw) => {
    if (line || block) return `<span class="c-com">${line || block}</span>`;
    if (dq || sq || tick) return `<span class="c-str">${dq || sq || tick}</span>`;
    if (tag) return `${lt}<span class="c-tag">${tag}</span>`;
    if (kw) return `<span class="c-kw">${kw}</span>`;
    return match;
  });

/**
 * Re-indent generated markup for the disclosure panels.
 *
 * Display only — the copy button reads the raw string from `data-code`, so a
 * bug here can make the panel ugly but can never hand someone broken markup.
 */
const formatHtml = (markup, voidTags) => {
  const out = [];
  let depth = 0;
  for (const part of markup.split(/(<[^>]+>)/)) {
    if (part === '') continue;
    if (part.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      out.push('  '.repeat(depth) + part);
    } else if (part.startsWith('<')) {
      out.push('  '.repeat(depth) + part);
      const name = /^<([a-z0-9-]+)/i.exec(part)?.[1]?.toLowerCase();
      if (name && !voidTags.has(name) && !part.endsWith('/>')) depth += 1;
    } else {
      const text = part.trim();
      if (text) out.push('  '.repeat(depth) + text);
    }
  }
  return out.join('\n');
};

/* ── assets the demos need, and the legacy tree cannot supply ─────────────── */

/**
 * The demo content ships semantic icon names (`icon: 'facebook'`) and relative
 * image paths (`logo.png`) that resolve against the legacy asset folder. That
 * folder is separately licensed and never enters this repo, so neither one can
 * be shipped as-is: unmapped icons render as an empty `<i>` and the images
 * would be forty broken thumbnails on a public page.
 *
 * So the page brings its own. Icons become CSS classes backed by inline SVG
 * masks — the icon-font path `NavxIconMap` was designed for, and the only one
 * `html()` can serialise, since an opaque component has no string form.
 * Masks rather than `background-image` so a glyph inherits `currentColor` and
 * themes with everything around it.
 */
const svgUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;

const line = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const fill = (d) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000">${d}</svg>`;

const ICONS = {
  facebook: fill(
    '<path d="M15 3h-2.6A3.4 3.4 0 0 0 9 6.4V9.4H6.6v3.2H9V21h3.2v-8.4h2.6l.5-3.2h-3.1V6.9c0-.4.3-.7.7-.7H15V3z"/>',
  ),
  twitter: fill(
    '<path d="M3.5 3h5.2l4 5.6L17.6 3H21l-6.6 7.6L21.4 21h-5.2l-4.3-6-5.2 6H3.3l7-8.1L3.5 3z"/>',
  ),
  instagram: line(
    '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.1" cy="6.9" r="1.1" fill="#000" stroke="none"/>',
  ),
  search: line('<circle cx="10.5" cy="10.5" r="6.4"/><path d="M15.4 15.4 21 21"/>'),
  cart: line(
    '<circle cx="9.6" cy="19.8" r="1.4" fill="#000" stroke="none"/><circle cx="17.8" cy="19.8" r="1.4" fill="#000" stroke="none"/><path d="M2.6 3.2h2.9l2.6 11.4h11L21.4 6.2H7.1"/>',
  ),
  home: line(
    '<path d="M3.4 11 12 3.4 20.6 11"/><path d="M5.6 9.7V20.6h12.8V9.7"/><path d="M9.8 20.6v-5.5h4.4v5.5"/>',
  ),
  settings: line(
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v2.6M12 18.8v2.6M21.4 12h-2.6M5.2 12H2.6M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8M18.6 18.6l-1.8-1.8M7.2 7.2 5.4 5.4"/>',
  ),
  mail: line(
    '<rect x="2.8" y="5" width="18.4" height="14" rx="2.4"/><path d="m3.6 7 8.4 5.9L20.4 7"/>',
  ),
  'sign-in': line(
    '<path d="M14.4 3.5h4.1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-4.1"/><path d="M10 16.4 14.4 12 10 7.6"/><path d="M14.4 12H3.5"/>',
  ),
  menu: line('<path d="M3.5 6.6h17M3.5 12h17M3.5 17.4h17"/>'),
  user: line('<circle cx="12" cy="8" r="3.8"/><path d="M4.6 20.6a7.4 7.4 0 0 1 14.8 0"/>'),
};

/** `icon: 'facebook'` → `class="ic ic-facebook"`. */
const ICON_MAP = Object.fromEntries(Object.keys(ICONS).map((n) => [n, `ic ic-${n}`]));

const iconCss = () => `
.navx-demo .ic {
  display: inline-block; inline-size: 1.05em; block-size: 1.05em;
  vertical-align: -0.14em; background: currentColor;
  -webkit-mask: var(--ic) center / contain no-repeat;
          mask: var(--ic) center / contain no-repeat;
}
${Object.entries(ICONS)
  .map(([name, svg]) => `.navx-demo .ic-${name} { --ic: url("${svgUrl(svg)}"); }`)
  .join('\n')}`;

/**
 * Stand-in artwork, generated rather than fetched. A logo slot with nothing in
 * it demonstrates the wrong thing — the point of these cards is that the slot
 * exists and is placed correctly.
 *
 * The wordmark is a mid-tone rather than near-black on purpose. These render
 * on ten skins and two themes, and an `<img>` cannot inherit `currentColor`,
 * so ink that looks right on the light cards disappears entirely on the dark
 * skin. One neutral that reads on both beats a logo that is missing on one
 * card in forty-six.
 */
const swatch = (a, b, label) =>
  svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
    </linearGradient></defs>
    <rect width="160" height="100" rx="8" fill="url(#g)"/>
    <text x="80" y="56" font-family="system-ui, sans-serif" font-size="13" font-weight="600"
      fill="#ffffff" fill-opacity="0.82" text-anchor="middle">${label}</text>
  </svg>`);

const IMAGES = {
  'logo.png': svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 28">
    <rect x="0.5" y="6" width="15" height="15" rx="3.4" fill="#0b5fa5"/>
    <text x="23" y="20" font-family="system-ui, sans-serif" font-size="15.5" font-weight="800"
      letter-spacing="1.4" fill="#6b7a85">NAVX</text>
  </svg>`),
  'avatar.png': svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="20" fill="#dfe7ee"/>
    <circle cx="20" cy="15.5" r="6.2" fill="#8aa0b2"/>
    <path d="M6.5 37a13.5 13.5 0 0 1 27 0z" fill="#8aa0b2"/>
  </svg>`),
  'blue.jpeg': swatch('#1f6fb2', '#0b3f6b', 'Blue'),
  'red.jpeg': swatch('#c6412c', '#7d2418', 'Red'),
  'green.jpeg': swatch('#1f8f5f', '#0d4f33', 'Green'),
};

/**
 * Rewrite every `src` in a content object to one of the inline replacements.
 * Content is plain data — that is the whole premise of `@navx/presets` — so a
 * `JSON.stringify` replacer is a complete deep walk rather than a shortcut.
 */
const withDemoAssets = (content) =>
  JSON.parse(
    JSON.stringify(content, (key, value) => {
      if (key !== 'src' || typeof value !== 'string') return value;
      const file = value.split('/').pop() ?? '';
      return IMAGES[file] ?? IMAGES['logo.png'];
    }),
  );

/** Shared by every `plan()` call on this page. */
const PLAN = { icons: ICON_MAP, assetBase: '' };

/* ── code blocks ──────────────────────────────────────────────────────────── */

let blockId = 0;

/**
 * `data-code` carries the raw text and the `<pre>` carries the highlighted
 * copy. Two representations of one string, which is a smell, except that the
 * alternative is a copy button that hands people `<span class="c-kw">`.
 */
const block = (code, { lang = 'ts', framework = null } = {}) => {
  const id = `code-${++blockId}`;
  const cls = framework ? `codeblock fw fw-${framework}` : 'codeblock';
  return `<div class="${cls}"${framework ? ` data-fw="${framework}"` : ''}>
<div class="codebar"><span class="lang">${esc(lang)}</span><button type="button" class="copy" data-copy="${id}">Copy</button></div>
<pre id="${id}" data-code="${attr(code)}"><code>${highlight(esc(code))}</code></pre>
</div>`;
};

/* ── the five snippets ────────────────────────────────────────────────────── */

const FRAMEWORKS = [
  { key: 'react', label: 'React', lang: 'tsx' },
  { key: 'vue', label: 'Vue', lang: 'vue' },
  { key: 'svelte', label: 'Svelte', lang: 'svelte' },
  { key: 'angular', label: 'Angular', lang: 'ts' },
  { key: 'vanilla', label: 'Vanilla', lang: 'js' },
];

/**
 * Per-card snippets stay minimal on purpose: the preset import, the adapter
 * import, and the one line that renders it. Stylesheet and token imports are
 * shown once, in Getting started, because repeating five boilerplate lines on
 * twenty-eight cards teaches nobody anything and buries the line that differs.
 */
const snippets = (name, { contentFrom, extra = '' } = {}) => {
  const contentImport = contentFrom
    ? `import { content } from '@navx/presets/demo/${contentFrom}';\n`
    : '';
  const props = extra ? ` ${extra}` : '';

  return {
    react: `import { ${name} } from '@navx/presets';
import { Navx } from '@navx/react/preset';
${contentImport}
export function Header() {
  return <Navx preset={${name}} content={content}${props} />;
}`,

    vue: `<script setup>
import { ${name} } from '@navx/presets';
import { Navx } from '@navx/vue/preset';
${contentImport}</script>

<template>
  <Navx :preset="${name}" :content="content"${extra ? ` ${extra.replace(/=\{([^}]*)\}/g, '="$1"')}` : ''} />
</template>`,

    svelte: `<script>
  import { ${name} } from '@navx/presets';
  import { navxPreset } from '@navx/svelte/preset';
${contentImport ? `  ${contentImport.trim()}\n` : ''}</script>

<div use:navxPreset={{ preset: ${name}, content${extra ? `, ${extra.replace(/=\{?([^}]*)\}?/g, ': $1')}` : ''} }}></div>`,

    angular: `import { Component } from '@angular/core';
import { ${name} } from '@navx/presets';
import { NavxPresetDirective } from '@navx/angular/preset';
${contentImport}
@Component({
  selector: 'app-header',
  imports: [NavxPresetDirective],
  template: \`<div [navxPreset]="preset" [navxContent]="content"></div>\`,
})
export class HeaderComponent {
  readonly preset = ${name};
  readonly content = content;
}`,

    vanilla: `import { ${name} } from '@navx/presets';
import { defineNavxPreset } from '@navx/element/preset';
${contentImport}
defineNavxPreset();

const nav = document.createElement('navx-preset');
nav.preset = ${name};
nav.content = content;
document.body.prepend(nav);`,
  };
};

const snippetSet = (name, options) => {
  const set = snippets(name, options);
  return FRAMEWORKS.map((f) => block(set[f.key], { lang: f.lang, framework: f.key })).join('\n');
};

/* ── the demo surface ─────────────────────────────────────────────────────── */

let demoId = 0;

/**
 * Every live nav on this page is the generated markup, mounted inside a
 * token scope, and handed to the real `attach()` by the page script.
 *
 * `data-navx-demo` is what that script looks for. `inert`-free, focusable,
 * fully interactive: these are not screenshots.
 */
const demo = (markup, { skin = null, dir = null, theme = null, height = null } = {}) => {
  // A demo that exists to show a particular skin or theme keeps it when the
  // page's theme changes; everything else follows the page.
  const pinned = skin !== null || theme !== null;
  const id = `demo-${++demoId}`;
  const attrs = [
    // `navx-scope` is where the token file lands once build.mjs rescopes it off
    // `:root` — the library's custom properties stay inside the demos rather
    // than leaking onto the page that advertises them.
    `class="navx-demo navx-scope"`,
    `id="${id}"`,
    'data-navx-demo',
    skin ? `data-navx-skin="${esc(skin)}"` : '',
    dir ? `dir="${esc(dir)}"` : '',
    theme ? `data-navx-theme="${esc(theme)}"` : '',
    pinned ? 'data-pin' : '',
    height ? `style="min-block-size:${esc(height)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<div ${attrs}>${markup}</div>`;
};

/* ── card ─────────────────────────────────────────────────────────────────── */

const card = ({ title, note, live, code, markup, meta = [] }) => `
<article class="dcard">
  <header class="dcard-head">
    <h4>${esc(title)}</h4>
    ${meta.length ? `<div class="dmeta">${meta.map((m) => `<code>${esc(m)}</code>`).join('')}</div>` : ''}
  </header>
  ${note ? `<p class="dnote">${note}</p>` : ''}
  ${live}
  <div class="dcode">${code}</div>
  ${
    markup
      ? `<details class="dhtml"><summary>Generated HTML</summary>${block(markup, { lang: 'html' })}</details>`
      : ''
  }
</article>`;

/* ── main ─────────────────────────────────────────────────────────────────── */

export async function buildDocs() {
  const P = await load('packages/presets/dist/index.js');
  const { catalogue, byFixture, plan, html, VOID_TAGS } = P;

  const voidTags = new Set(VOID_TAGS ?? []);

  // preset id -> its named export, read from the module rather than derived
  // from the id, so a snippet can never name an export that does not exist.
  const exportOf = {};
  for (const [key, value] of Object.entries(P)) {
    if (value && typeof value === 'object' && typeof value.id === 'string' && value.slots) {
      exportOf[value.id] = key;
    }
  }

  // preset id -> the fixtures that use it; the first is the demo content.
  const fixturesOf = {};
  for (const [fixture, preset] of Object.entries(byFixture)) {
    if (!fixturesOf[preset.id]) fixturesOf[preset.id] = [];
    fixturesOf[preset.id].push(fixture);
  }

  /**
   * Which fixture supplies a preset's demo content.
   *
   * Taking the first was wrong in a way that only showed up on screen: of the
   * 56 fixtures only nine carry a submenu, and they sort late, so nearly every
   * card rendered a flat bar with no dropdown to open. A preset describes
   * chrome and says nothing about content, so any of its fixtures is a valid
   * illustration — pick the one that demonstrates the most.
   */
  const richest = async (fixtures) => {
    for (const fixture of fixtures) {
      const content = await contentFor(fixture);
      if (JSON.stringify(content).includes('"submenu"')) return fixture;
    }
    return fixtures[0];
  };

  const contentCache = new Map();
  const contentFor = async (fixture) => {
    if (!contentCache.has(fixture)) {
      const mod = await load(`packages/presets/dist/demo/${fixture}.js`);
      contentCache.set(fixture, withDemoAssets(mod.content));
    }
    return contentCache.get(fixture);
  };

  const skins = readdirSync(join(REPO, 'packages/tokens/dist/skins'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => f.replace(/\.css$/, ''))
    .sort();

  const tokensCss = readFileSync(join(REPO, 'packages/tokens/dist/tokens.css'), 'utf8');
  const tokenCount = (tokensCss.match(/^\s*--navx-[a-z0-9-]+:/gm) ?? []).length;

  /* ── grouping ───────────────────────────────────────────────────────────
   * Computed from preset shape, in order, first match wins. A new preset
   * lands in the right group without anyone editing a list.
   */
  const GROUPS = [
    {
      id: 'start',
      title: 'Starting points',
      blurb:
        'One menu, no extras. The three alignments and the two ways to carry a brand — everything else in the catalogue is one of these with something added.',
      match: (p) =>
        p.slots.menus.length === 1 && p.slots.sections.length === 0 && !p.logo && !p.position,
    },
    {
      id: 'sections',
      title: 'A section in the bar',
      blurb:
        'A search field, a call-to-action, a line of text. Sections sit alongside the menus and can be pushed to either edge.',
      match: (p) => p.slots.sections.length > 0,
    },
    {
      id: 'menus',
      title: 'More than one menu',
      blurb:
        'Two or three independent menus, each individually placeable. This is how a nav gets primary links on one side and utility links on the other without a wrapper element doing the work.',
      match: (p) => p.slots.menus.length > 1,
    },
    {
      id: 'logo-top',
      title: 'Logo above the bar',
      blurb: 'The logo takes its own row, and the menu row sits under it.',
      match: (p) => p.logo === 'top',
    },
    {
      id: 'sticky',
      title: 'Sticky',
      blurb: 'Stays with the viewport as the page scrolls.',
      match: (p) => Boolean(p.position),
    },
  ];

  const grouped = new Map(GROUPS.map((g) => [g.id, []]));
  const ungrouped = [];
  for (const preset of catalogue) {
    const group = GROUPS.find((g) => g.match(preset));
    if (group) grouped.get(group.id).push(preset);
    else ungrouped.push(preset);
  }
  if (ungrouped.length > 0) {
    // Better a visible bucket than a silently dropped preset.
    GROUPS.push({ id: 'other', title: 'Other', blurb: '', match: () => false });
    grouped.set('other', ungrouped);
  }

  /* ── preset cards ───────────────────────────────────────────────────── */

  const describe = (p) => {
    const bits = [];
    if (p.align) bits.push(`align="${p.align}"`);
    if (p.trigger) bits.push(`trigger="${p.trigger}"`);
    if (p.logo === 'top') bits.push('logo="top"');
    if (p.position) bits.push(`position="${p.position}"`);
    const menus = p.slots.menus.length;
    bits.push(menus === 1 ? '1 menu' : `${menus} menus`);
    if (p.slots.sections.length > 0) bits.push(p.slots.sections.join(' + '));
    return bits;
  };

  const catalogueHtml = [];
  for (const group of GROUPS) {
    const members = grouped.get(group.id) ?? [];
    if (members.length === 0) continue;

    const cards = [];
    for (const preset of members) {
      const fixture = await richest(fixturesOf[preset.id]);
      const content = await contentFor(fixture);
      const markup = html(plan(preset, content, PLAN));
      const name = exportOf[preset.id];
      const uses = fixturesOf[preset.id].length;

      cards.push(
        card({
          title: preset.name,
          note:
            uses > 1
              ? `Covers <strong>${uses}</strong> of the legacy variants — they differed only in content.`
              : null,
          meta: describe(preset),
          live: demo(markup),
          code: snippetSet(name, { contentFrom: fixture }),
          markup: formatHtml(markup, voidTags),
        }),
      );
    }

    catalogueHtml.push(`
<div class="dgroup" id="preset-${group.id}">
  <div class="dgroup-head">
    <h3>${esc(group.title)} <span class="count">${members.length}</span></h3>
    ${group.blurb ? `<p>${esc(group.blurb)}</p>` : ''}
  </div>
  ${cards.join('\n')}
</div>`);
  }

  /* ── behaviour ──────────────────────────────────────────────────────── */

  const behaviourPreset = P.justifiedLogoDual ?? catalogue[0];
  const behaviourFixture = await richest(fixturesOf[behaviourPreset.id]);
  const behaviourContent = await contentFor(behaviourFixture);
  const behaviourMarkup = html(plan(behaviourPreset, behaviourContent, PLAN));
  const overlayMarkup = html(plan(behaviourPreset, behaviourContent, { ...PLAN, overlay: true }));

  /**
   * The legacy library shipped these as three separate example pages —
   * "megamenu", "multidropdown", "lists". All three resolve to the *same*
   * preset, because a preset describes chrome and a submenu is content. That
   * collapse is most of the 56 → 28, and it is easier to believe when the
   * three are side by side under one preset name.
   */
  const subPreset = P.justifiedLogoSocialDualSpaced ?? behaviourPreset;
  const subName = exportOf[subPreset.id];
  const SUBMENU_SHAPES = [
    [
      'ex-multidropdown',
      'Dropdown lists',
      'A plain list under each link, nested as deep as the content goes. Every level is a disclosure button with its own <code>aria-expanded</code>.',
    ],
    [
      'ex-megamenu',
      'Megamenu',
      'A full-width panel of rows and columns. Same element, same open/close machinery — the difference is <code>submenu.type</code>, which is a property of your content.',
    ],
    [
      'ex-lists',
      'Megamenu of lists',
      'Columns of links inside the panel, with headings. The legacy library shipped this as its own example file; here it is the same preset with different words in it.',
    ],
  ];

  const submenuCards = [];
  for (const [fixture, title, note] of SUBMENU_SHAPES) {
    const markup = html(plan(subPreset, await contentFor(fixture), PLAN));
    submenuCards.push(
      card({
        title,
        note,
        meta: [subName, fixture],
        live: demo(markup),
        code: snippetSet(subName, { contentFrom: fixture }),
        markup: formatHtml(markup, voidTags),
      }),
    );
  }

  const spyPreset = P.justifiedStickyLogoSocialDualSpaced ?? behaviourPreset;
  const spyFixture = await richest(fixturesOf[spyPreset.id]);
  const spyMarkup = html(plan(spyPreset, await contentFor(spyFixture), PLAN));

  const behaviour = `
<div class="dgroup" id="behaviour-trigger">
  <div class="dgroup-head">
    <h3>How a submenu opens</h3>
    <p>Click is the default, and that is a deliberate break from the legacy plugin. A hover-only
       disclosure fails <a href="https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html">WCAG&nbsp;1.4.13</a>
       and is unusable on touch. <code>hover</code> is still available, and when you ask for it you also
       get focus-within opening and Escape-to-close, because those are what make it pass.</p>
  </div>
  ${card({
    title: 'Click to open',
    meta: ['trigger="click"', 'default'],
    live: demo(behaviourMarkup, { height: '19rem' }),
    code: block(
      `import { attach, createNav } from '@navx/core';

// trigger: 'click' is the default — shown here for contrast.
const detach = attach(root, createNav(), { trigger: 'click' });`,
      { lang: 'ts' },
    ),
  })}
  ${card({
    title: 'Hover to open',
    note: 'Also opens on focus-within and closes on Escape. Panel mode ignores this entirely — there is no hover on a drawer.',
    meta: ['trigger="hover"', 'hoverCloseDelay'],
    live: demo(behaviourMarkup, { height: '19rem' }),
    code: block(
      `const detach = attach(root, createNav(), {
  trigger: 'hover',
  // Grace period before a hovered-away menu closes, in ms.
  hoverCloseDelay: 150,
});`,
      { lang: 'ts' },
    ),
  })}
</div>

<div class="dgroup" id="behaviour-submenus">
  <div class="dgroup-head">
    <h3>Submenus, and why there is only one preset here</h3>
    <p>All three below are <code>${subName}</code>. Identical chrome, identical machinery —
       what differs is the content you hand it. That is the collapse that turned 56 legacy
       variants into 28 presets, and it is the reason a dropdown and a megamenu are not two
       features to learn.</p>
    <p>Click a link with a chevron. Every level is a real disclosure button following the APG
       <a href="https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/">Disclosure Navigation</a>
       pattern — not <code>role="menubar"</code>, which promises arrow-key semantics a website
       navigation does not have.</p>
  </div>
  ${submenuCards.join('\n')}
</div>

<div class="dgroup" id="behaviour-panel">
  <div class="dgroup-head">
    <h3>The panel, and the 992 that only exists once</h3>
    <p>Narrow the demo below past the breakpoint and the bar becomes a drawer. Nothing in JavaScript
       knows the number: the stylesheet publishes <code>--navx-mode</code> from a container query and the
       core reads it back with <code>getComputedStyle</code>. Change the breakpoint in CSS and the
       behaviour follows, because there is no second copy to forget.</p>
  </div>
  ${card({
    title: 'Modal drawer',
    note: 'Traps focus, marks the rest of the page <code>inert</code>, locks body scroll — and reverts every one of those exactly, on close and on detach.',
    meta: ['modal', 'dismissOnOutside'],
    live: demo(behaviourMarkup, { height: '19rem' }),
    code: block(
      `const detach = attach(root, createNav(), {
  modal: true,             // focus trap + inert + scroll lock
  dismissOnOutside: true,  // default
});

// Everything above is reverted here. Exactly — attributes that were
// absent are removed, attributes that had values are restored to them.
detach();`,
      { lang: 'ts' },
    ),
  })}
  ${card({
    title: 'With an overlay',
    note: 'A scrim behind the open drawer. Its colour is a token, so it themes with everything else.',
    meta: ['overlay', '--navx-overlay-background'],
    live: demo(overlayMarkup, { height: '19rem' }),
    code: block(
      `import { ${exportOf[behaviourPreset.id]} } from '@navx/presets';

<Navx preset={${exportOf[behaviourPreset.id]}} content={content} overlay />`,
      { lang: 'tsx' },
    ),
    markup: null,
  })}
</div>

<div class="dgroup" id="behaviour-spy">
  <div class="dgroup-head">
    <h3>Scroll-spy</h3>
    <p>Marks the link whose section you are reading. The legacy implementation cached
       <code>offsetTop</code> and re-measured on resize, which quietly went wrong whenever anything above a
       section changed height. This one uses <code>IntersectionObserver</code> as the trigger and a live
       <code>getBoundingClientRect()</code> as the rule, and it costs 1.05&nbsp;kB.</p>
    <p>Smooth scrolling is <code>scroll-behavior</code> and <code>scroll-margin-block-start</code> — native CSS,
       replacing about ninety lines of <code>requestAnimationFrame</code> easing, and suppressed automatically
       under <code>prefers-reduced-motion</code>.</p>
  </div>
  ${card({
    title: 'Sticky bar with an active section',
    meta: ['@navx/core/scrollspy', '1.05 kB'],
    live: demo(spyMarkup, { height: '19rem' }),
    code: block(
      `import { attach, createNav } from '@navx/core';
import { spy } from '@navx/core/scrollspy';

const machine = createNav();
const detach = attach(root, machine);

const stop = spy(root, machine, {
  offset: 64,     // room for the sticky bar
  smooth: true,   // default
});

// The active id lives in the machine, not in the DOM:
machine.getState().activeId; // 'features' | null`,
      { lang: 'ts' },
    ),
  })}
</div>

<div class="dgroup" id="behaviour-rtl">
  <div class="dgroup-head">
    <h3>RTL and dark, without a second stylesheet</h3>
    <p>The stylesheet contains zero physical-direction properties — no <code>left</code>, no <code>right</code>,
       no <code>margin-left</code>. Direction is a <code>dir</code> attribute and nothing else. Dark is a token
       overlay on <code>data-navx-theme</code>. Neither one ships extra CSS.</p>
    <p>The fix that mattered most was not a layout rule: it was <code>text-align: start</code>. Bootstrap's
       Reboot sets <code>body { text-align: left }</code>, and inheriting that is how an otherwise correct RTL
       navbar ends up with its labels quietly aligned the wrong way.</p>
  </div>
  ${card({
    title: 'Right-to-left',
    meta: ['dir="rtl"'],
    live: demo(behaviourMarkup, { dir: 'rtl', height: '19rem' }),
    code: block(`<html dir="rtl">\n  <!-- that is the entire change -->\n</html>`, {
      lang: 'html',
    }),
  })}
  ${card({
    title: 'Dark',
    meta: ['data-navx-theme="dark"'],
    live: demo(behaviourMarkup, { theme: 'dark', height: '19rem' }),
    code: block(
      `<!-- on the root, or on any ancestor of the nav -->
<html data-navx-theme="dark">`,
      { lang: 'html' },
    ),
  })}
</div>`;

  /* ── skins ──────────────────────────────────────────────────────────── */

  const skinPreset = P.justifiedLogo ?? catalogue[0];
  const skinMarkup = html(
    plan(skinPreset, await contentFor(await richest(fixturesOf[skinPreset.id])), PLAN),
  );

  const skinCards = skins
    .map((skin) =>
      card({
        title: skin.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
        meta: [`data-navx-skin="${skin}"`],
        live: demo(skinMarkup, { skin, height: '5.5rem' }),
        code: block(
          `import '@navx/tokens/skins/${skin}.css';

<nav class="navx" data-navx-skin="${skin}">`,
          { lang: 'ts' },
        ),
      }),
    )
    .join('\n');

  /* ── options tables ─────────────────────────────────────────────────── */

  const table = (rows) => `
<div class="dtable-wrap">
<table class="dtable">
  <thead><tr><th>Option</th><th>Type</th><th>Default</th><th>What it does</th></tr></thead>
  <tbody>
    ${rows
      .map(
        ([name, type, dflt, description]) =>
          `<tr><td><code>${esc(name)}</code></td><td><code>${esc(type)}</code></td><td>${
            dflt ? `<code>${esc(dflt)}</code>` : '—'
          }</td><td>${description}</td></tr>`,
      )
      .join('\n    ')}
  </tbody>
</table>
</div>`;

  const options = `
<div class="dgroup" id="options-attach">
  <div class="dgroup-head">
    <h3><code>attach(root, machine, options)</code></h3>
    <p>Binds a machine to real DOM and returns a <code>detach</code>. Every listener, observer and timer is
       registered against one <code>AbortController</code>, so <code>detach()</code> is a single
       <code>abort()</code> — there is no list of teardowns to keep in sync with a list of setups.</p>
  </div>
  ${table([
    [
      'trigger',
      "'click' | 'hover'",
      "'click'",
      'How a submenu opens in bar mode. Panel mode is always click.',
    ],
    ['hoverCloseDelay', 'number', '150', 'Grace period before a hovered-away menu closes, in ms.'],
    [
      'dismissOnOutside',
      'boolean',
      'true',
      'Close everything when a pointer goes down, or focus lands, outside the nav.',
    ],
    [
      'modal',
      'boolean',
      'false',
      'Trap focus in the open drawer, <code>inert</code> the rest of the page, lock body scroll.',
    ],
    [
      'labelDisclosure',
      '(linkText: string) => string',
      '',
      'Accessible name for a submenu button. Defaults are English — pass your own rather than shipping an English word inside an Arabic navbar.',
    ],
    ['labelToggler', 'string', "'Menu'", 'Accessible name for the panel toggler.'],
    ['labelClose', 'string', "'Close'", 'Accessible name for the panel close button.'],
  ])}
</div>

<div class="dgroup" id="options-spy">
  <div class="dgroup-head">
    <h3><code>spy(root, machine, options)</code></h3>
    <p>A separate subpath, <code>@navx/core/scrollspy</code>, so a nav that does not need it does not pay for
       it. It observes and writes <code>SPY_SET</code> to the machine; it never touches the DOM itself, which
       keeps the single-DOM-writer rule intact.</p>
  </div>
  ${table([
    [
      'offset',
      'number',
      '0',
      'Pixels of room above a section — usually your sticky header’s height. Sets <code>scroll-margin-block-start</code> and positions the activation probe.',
    ],
    [
      'smooth',
      'boolean',
      'true',
      'Set <code>scroll-behavior: smooth</code> on the scrolling element. The browser suppresses it under <code>prefers-reduced-motion</code>.',
    ],
    [
      'scroller',
      'HTMLElement',
      'documentElement',
      'Override when your page scrolls inside a container.',
    ],
  ])}
</div>

<div class="dgroup" id="options-plan">
  <div class="dgroup-head">
    <h3><code>plan(preset, content, options)</code></h3>
    <p>The pure function every adapter goes through. Preset and content in, a node tree out — no DOM, no
       framework, no side effects. All five adapters walk the same tree with <code>toTree()</code>, which is
       why they can be proven to render byte-identical markup.</p>
  </div>
  ${table([
    [
      'icons',
      'Record<string, string>',
      '',
      'Map semantic icon names to your own icon markup or class names.',
    ],
    ['assetBase', 'string', "''", 'Prefix for logo and image paths.'],
    ['overlay', 'boolean', 'false', 'Render the scrim element behind an open drawer.'],
    ['labelToggler', 'string', "'Menu'", 'Passed through to the rendered toggler.'],
    ['labelClose', 'string', "'Close'", 'Passed through to the rendered close button.'],
    [
      'labelDisclosure',
      '(linkText: string) => string',
      '',
      'Passed through to each rendered disclosure button.',
    ],
  ])}
</div>`;

  /* ── tokens ─────────────────────────────────────────────────────────── */

  const tokenGroups = [
    ['Surfaces', ['--navx-surface', '--navx-surface-raised', '--navx-surface-sunken']],
    ['Text', ['--navx-text', '--navx-text-muted', '--navx-text-on-accent']],
    [
      'Links',
      ['--navx-link-color', '--navx-link-color-hover', '--navx-link-decoration-background'],
    ],
    ['Structure', ['--navx-border', '--navx-radius-md', '--navx-nav-block-size']],
    ['Motion', ['--navx-motion-duration', '--navx-motion-easing']],
  ];

  const tokens = `
<div class="dgroup" id="tokens-tiers">
  <div class="dgroup-head">
    <h3>Three tiers, and only one of them is yours</h3>
    <p>${tokenCount} custom properties in three layers. Primitives are raw values and are <em>not</em> public
       API — they exist so the layer above has something to point at. Semantic tokens name a role rather
       than a colour. Component tokens are what a navbar actually reads.</p>
    <p>Override at the semantic tier and every component that uses that role follows. Override at the
       component tier to change one thing without disturbing the rest. That is the whole customization
       story; there is no configuration file and no build step.</p>
  </div>
  ${block(
    `/* tier 1 — primitives. Not public API. */
--navx-color-gray-950: #0b0d0e;

/* tier 2 — semantic. A role, not a value. */
--navx-surface: var(--navx-color-gray-0);
--navx-text:    var(--navx-color-gray-900);

/* tier 3 — component. What the navbar reads. */
--navx-link-color: var(--navx-text);
--navx-nav-block-size: 4rem;`,
    { lang: 'css' },
  )}
</div>

<div class="dgroup" id="tokens-override">
  <div class="dgroup-head">
    <h3>Make it yours</h3>
    <p>Three lines of CSS is a rebrand. No preprocessor, no theme object, no rebuild — these are custom
       properties, so they cascade, they respond to media queries, and you can change them at runtime.</p>
  </div>
  ${block(
    `/* Scope to the nav, or to :root for the whole page. */
.navx {
  --navx-accent: #0b5fa5;
  --navx-nav-block-size: 4.5rem;
  --navx-link-color-hover: var(--navx-accent);
}

/* They are real custom properties, so this works too. */
@media (prefers-color-scheme: dark) {
  .navx { --navx-surface: #0b0d0e; }
}`,
    { lang: 'css' },
  )}
  ${block(
    `// ...and so does this.
nav.style.setProperty('--navx-accent', userChosenColour);`,
    { lang: 'js' },
  )}
</div>

<div class="dgroup" id="tokens-map">
  <div class="dgroup-head">
    <h3>The ones you will reach for first</h3>
    <p>A selection, not the full list — all ${tokenCount} are in
       <code>@navx/tokens/tokens.css</code>, which is generated and readable.</p>
  </div>
  <div class="dtoken-grid">
    ${tokenGroups
      .map(
        ([label, names]) => `<div class="dtoken">
      <h5>${esc(label)}</h5>
      <ul>${names.map((n) => `<li><code>${esc(n)}</code></li>`).join('')}</ul>
    </div>`,
      )
      .join('\n    ')}
  </div>
</div>

<div class="dgroup" id="tokens-skin">
  <div class="dgroup-head">
    <h3>Write your own skin</h3>
    <p>The ten skins above are not special. Each is a plain block of token overrides on a
       <code>data-navx-skin</code> attribute — the same mechanism available to you, with no privileged
       access to anything.</p>
  </div>
  ${block(
    `[data-navx-skin="mine"] {
  --navx-link-color-hover: var(--navx-text-on-accent);
  --navx-link-decoration-background: var(--navx-accent);
  --navx-link-decoration-inline-size: 100%;
  --navx-link-decoration-radius: var(--navx-radius-full);
}`,
    { lang: 'css' },
  )}
</div>`;

  /* ── getting started ────────────────────────────────────────────────── */

  const startPreset = P.justifiedLogo ?? catalogue[0];
  const startName = exportOf[startPreset.id];
  const startFixture = await richest(fixturesOf[startPreset.id]);
  const startMarkup = html(plan(startPreset, await contentFor(startFixture), PLAN));

  const start = `
<div class="dgroup" id="start-install">
  <div class="dgroup-head">
    <h3>Install</h3>
    <p>Three packages for a styled navbar: the tokens, the stylesheet, and whichever adapter matches your
       framework. <code>@navx/presets</code> is optional — skip it and write your own markup against the
       same classes.</p>
  </div>
  ${block(
    `npm install @navx/tokens @navx/styles @navx/presets @navx/react
#                                                       @navx/vue
#                                                       @navx/svelte
#                                                       @navx/angular
#                                                       @navx/element   ← no framework`,
    { lang: 'bash' },
  )}
  <p class="dnote">Import the CSS once, anywhere in your app — the two files below are the only stylesheets
     NAVX ships, and neither contains a single <code>!important</code>.</p>
  ${block(
    `import '@navx/tokens/tokens.css';
import '@navx/styles/navx.css';

// Optional: a skin, and a dark theme.
import '@navx/tokens/skins/dark.css';`,
    { lang: 'ts' },
  )}
</div>

<div class="dgroup" id="start-first">
  <div class="dgroup-head">
    <h3>Your first navbar</h3>
    <p>A preset is data — a plain object describing the chrome. Content is a second plain object with your
       links in it. The adapter renders them. There is no markup for you to write and none for you to keep
       in sync when the library changes.</p>
  </div>
  ${card({
    title: 'The whole thing',
    meta: [startName],
    live: demo(startMarkup),
    code: snippetSet(startName, { contentFrom: startFixture }),
    markup: formatHtml(startMarkup, voidTags),
  })}
</div>

<div class="dgroup" id="start-content">
  <div class="dgroup-head">
    <h3>Bring your own content</h3>
    <p>The demo content above comes from <code>@navx/presets/demo/*</code> and exists so these examples
       render. Yours is the same shape and nothing more: menus, items, and optional children.</p>
  </div>
  ${block(
    `import type { NavxContent } from '@navx/presets';

export const content: NavxContent = {
  logo: { src: '/logo.svg', alt: 'Acme', href: '/' },
  menus: [
    {
      items: [
        { label: 'Home', href: '/', current: true },
        { label: 'Products', href: '/products', children: [
          { label: 'Overview', href: '/products' },
          { label: 'Pricing',  href: '/pricing'  },
        ]},
        { label: 'Contact', href: '/contact' },
      ],
    },
  ],
};`,
    { lang: 'ts' },
  )}
</div>

<div class="dgroup" id="start-headless">
  <div class="dgroup-head">
    <h3>Or skip presets entirely</h3>
    <p>Presets are a convenience, not a requirement. Write the markup yourself and hand it to
       <code>attach()</code> — the core has no idea whether a preset produced the DOM it is driving.</p>
  </div>
  ${block(
    `import { attach, createNav } from '@navx/core';

const root = document.querySelector('.navx');
const detach = attach(root, createNav(), { trigger: 'click' });

// Later — one abort(), every listener, observer and timer gone.
detach();`,
    { lang: 'ts' },
  )}
</div>`;

  /* ── assembly ───────────────────────────────────────────────────────── */

  const nav = [
    ['start', 'Getting started'],
    ['presets', `Presets · ${catalogue.length}`],
    ['behaviour', 'Behaviour'],
    ['skins', `Skins · ${skins.length}`],
    ['options', 'Options'],
    ['tokens', 'Tokens'],
  ];

  const docs = `
<style>${iconCss()}</style>
<section class="band docs" id="docs">
  <div class="wrap">
    <div class="band-head">
      <p class="eyebrow">Documentation</p>
      <h2>Everything the library does, on one page</h2>
      <p class="lede">Every navbar below is live — the real <code>@navx/core</code> driving the real
        <code>@navx/styles</code>, rendered from the real preset catalogue at build time. Open a menu.
        Narrow the window past the breakpoint. Tab through it. Nothing here is a screenshot, and nothing
        here is hand-written markup that could disagree with the packages it documents.</p>
    </div>

    <div class="docs-bar" id="docsbar">
      <nav class="docs-jump" aria-label="Documentation sections">
        ${nav.map(([id, label]) => `<a href="#docs-${id}">${esc(label)}</a>`).join('\n        ')}
      </nav>
      <div class="fwpick">
        <span class="fwpick-label" id="fwlabel">Show code for</span>
        <div class="fwpick-set" role="radiogroup" aria-labelledby="fwlabel">
          ${FRAMEWORKS.map(
            (f, i) =>
              `<button type="button" role="radio" aria-checked="${i === 0}" data-fw-pick="${f.key}">${esc(f.label)}</button>`,
          ).join('\n          ')}
        </div>
      </div>
    </div>

    <div class="docs-sec" id="docs-start"><h3 class="docs-h">Getting started</h3>${start}</div>

    <div class="docs-sec" id="docs-presets">
      <h3 class="docs-h">The preset catalogue</h3>
      <p class="docs-intro">${catalogue.length} presets, covering all ${Object.keys(byFixture).length}
        variants the legacy library shipped. The collapse is not lossy — many legacy files were the same
        chrome with different words in it, and a preset describes chrome only. Every one below renders
        live from the published <code>@navx/presets</code>.</p>
      ${catalogueHtml.join('\n')}
    </div>

    <div class="docs-sec" id="docs-behaviour"><h3 class="docs-h">Behaviour</h3>${behaviour}</div>

    <div class="docs-sec" id="docs-skins">
      <h3 class="docs-h">Skins</h3>
      <p class="docs-intro">Ten of them, each a small block of token overrides on a
        <code>data-navx-skin</code> attribute. They add no rules to the stylesheet and they compose with
        the theme and the direction.</p>
      <div class="dgroup">${skinCards}</div>
    </div>

    <div class="docs-sec" id="docs-options"><h3 class="docs-h">Options</h3>${options}</div>

    <div class="docs-sec" id="docs-tokens"><h3 class="docs-h">Tokens &amp; customization</h3>${tokens}</div>
  </div>
</section>`;

  return {
    html: docs,
    stats: {
      presets: catalogue.length,
      fixtures: Object.keys(byFixture).length,
      skins: skins.length,
      tokens: tokenCount,
      demos: demoId,
      blocks: blockId,
    },
  };
}
