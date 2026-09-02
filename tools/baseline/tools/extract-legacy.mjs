/**
 * Stage 0 — legacy extractor.
 *
 * Reads the legacy NAVX demo pages, lifts every <nav class="navigation"> out of
 * them, strips the artifacts that navigation.js injected before the page was
 * saved, and writes each one as a standalone fixture fragment plus a manifest.
 *
 * Parsing is done by a real browser rather than a regex or a DOM-alike: the
 * legacy pages are 3.2–3.8 MB saved-from-browser dumps containing extension
 * chrome and unbalanced markup, and only a real parser handles them predictably.
 * Scripts are blocked at the network layer so the DOM stays pre-JS.
 *
 * Nothing from the legacy tree is copied into the repo — fixtures are gitignored
 * derivatives, and the harness loads legacy CSS/JS/images from NAVX_LEGACY_ROOT
 * at runtime.
 *
 * Usage:  NAVX_LEGACY_ROOT=/path/to/NAVX node tools/extract-legacy.mjs
 */

import { readFileSync } from 'node:fs';
import { access, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { paths, resolveLegacyRoot } from './env.mjs';

let LEGACY_ROOT;
try {
  LEGACY_ROOT = resolveLegacyRoot();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const OUT_DIR = paths.fixtures;

/**
 * The two corpora.
 *
 * `layout` — the 46 catalogue variants. These carry the chrome permutations
 *   (logo, brand, alignment, icon items, avatars, badges) and contain no
 *   submenus at all.
 * `behaviour` — the Examples pages. These are where dropdowns, multi-level
 *   dropdowns, horizontal dropdowns, mega-menus and lists actually live, and
 *   they are the only regression cover for the Stage 3 state-machine rewrite.
 */
const SOURCES = [
  { file: 'Catalogue/catalogue.html', corpus: 'layout', select: 'nav[id^="navigation"]' },
  { file: 'Examples/hover.html', corpus: 'behaviour', select: 'nav.navigation', name: 'ex-hover' },
  { file: 'Examples/click.html', corpus: 'behaviour', select: 'nav.navigation', name: 'ex-click' },
  {
    file: 'Examples/horizontal.html',
    corpus: 'behaviour',
    select: 'nav.navigation',
    name: 'ex-horizontal',
  },
  {
    file: 'Examples/multidropdown.html',
    corpus: 'behaviour',
    select: 'nav.navigation',
    name: 'ex-multidropdown',
  },
  {
    file: 'Examples/megamenu.html',
    corpus: 'behaviour',
    select: 'nav.navigation',
    name: 'ex-megamenu',
  },
  { file: 'Examples/lists.html', corpus: 'behaviour', select: 'nav.navigation', name: 'ex-lists' },
  {
    file: 'Examples/overlay.html',
    corpus: 'behaviour',
    select: 'nav.navigation',
    name: 'ex-overlay',
  },
  {
    file: 'Examples/sticky.html',
    corpus: 'behaviour',
    select: 'nav.navigation',
    name: 'ex-sticky',
  },
  {
    file: 'Examples/scrollspy.html',
    corpus: 'behaviour',
    select: 'nav.navigation',
    name: 'ex-scrollspy',
  },
  { file: 'Skins/skins.html', corpus: 'behaviour', select: 'nav.navigation', name: 'ex-skins' },
];

/** Classes navigation.js adds at runtime; they were serialised into the saved pages. */
const RUNTIME_CLASSES = [
  'navigation-landscape',
  'has-submenu',
  'navigation-submenu',
  'is-visible',
  'is-invisible',
  'scroll-momentum',
];

/** Component slots, used to fingerprint each variant for the Stage 5 port. */
const SLOTS = {
  logo: '.navigation-logo',
  brand: '.navigation-brand-text',
  button: '.navigation-btn',
  inlineForm: '.navigation-inline-form',
  iconItem: '.navigation-icon-item',
  avatarItem: '.navigation-avatar-item',
  badge: '.navigation-badge',
  socialMenu: '.navigation-social-menu',
  textItem: '.navigation-text',
  bodySection: '.navigation-body-section',
  dropdown: '.navigation-dropdown',
  dropdownHorizontal: '.navigation-dropdown-horizontal',
  megamenu: '.navigation-megamenu',
  megamenuGrid: '.navigation-row',
  list: '.navigation-list',
  tabs: '.navigation-tabs',
};

/** Root modifiers that change layout rather than adding a part. */
const MODIFIERS = [
  'navigation-justified',
  'navigation-centered',
  'navigation-logo-top',
  'navigation-transparent',
  'navigation-fullscreen',
  'fixed-top',
  'sticky-top',
];

/** Pull the options object out of `new Navigation(el, {...})` in the source page. */
function readInitOptions(html) {
  const m = html.match(
    /new\s+Navigation\s*\(\s*document\.getElementById\(\s*["'][^"']+["']\s*\)\s*,\s*(\{[\s\S]*?\})\s*\)/,
  );
  if (!m) return {};
  try {
    // Options in the demos are plain literals (unquoted keys, double-quoted strings).
    return JSON.parse(
      m[1].replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/,(\s*})/g, '$1'),
    );
  } catch {
    return {};
  }
}

const clean = (nav, ctx) => {
  const { assetBase, runtimeClasses } = ctx;

  // 1. Drop nodes navigation.js created.
  nav.querySelectorAll('.overlay-panel, .submenu-indicator').forEach((n) => n.remove());

  // 2. Drop classes navigation.js toggled.
  nav.querySelectorAll('*').forEach((el) => el.classList.remove(...runtimeClasses));
  nav.classList.remove(...runtimeClasses);

  // 3. Drop inline styles navigation.js wrote (submenu right-edge correction).
  nav
    .querySelectorAll('.navigation-dropdown, .navigation-megamenu')
    .forEach((n) => n.removeAttribute('style'));

  // 4. Neutralise absolute demo URLs; keep in-page anchors (scrollspy needs them).
  nav.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const hash = href.indexOf('#');
    a.setAttribute('href', hash !== -1 && hash !== href.length - 1 ? href.slice(hash) : '#');
  });

  // 5. Repoint images at the legacy tree the harness server exposes.
  nav.querySelectorAll('img[src]').forEach((img) => {
    const src = (img.getAttribute('src') || '').replace(/^\.\//, '');
    if (!/^(https?:|data:|\/)/.test(src)) img.setAttribute('src', `${assetBase}/${src}`);
    img.setAttribute('loading', 'eager');
    img.setAttribute('decoding', 'sync');
  });

  return nav.outerHTML;
};

const fingerprint = (nav, ctx) => {
  const { slots, modifiers } = ctx;
  const present = Object.entries(slots)
    .filter(([, sel]) => nav.querySelector(sel))
    .map(([k]) => k);
  return {
    slots: present,
    modifiers: modifiers.filter((m) => nav.classList.contains(m)),
    // Defect #3 in the audit: init throws when either of these is absent.
    hasToggler: !!nav.querySelector('.navigation-button-toggler'),
    hasCloseButton: !!nav.querySelector('.navigation-body-close-button'),
    submenuCount: nav.querySelectorAll('.navigation-dropdown, .navigation-megamenu').length,
    maxSubmenuDepth: (() => {
      let depth = 0;
      nav.querySelectorAll('.navigation-dropdown, .navigation-megamenu').forEach((s) => {
        let d = 0;
        let p = s.parentElement;
        while (p && p !== nav) {
          if (p.matches('.navigation-dropdown, .navigation-megamenu')) d++;
          p = p.parentElement;
        }
        depth = Math.max(depth, d + 1);
      });
      return depth;
    })(),
    elementCount: nav.querySelectorAll('*').length,
  };
};

/**
 * Clear previously generated fixtures without requiring the directory itself to
 * be removable. A plain `rm -rf` fails on synced folders (iCloud, Dropbox),
 * Windows file locks and sandboxed mounts; overwriting in place always works,
 * so only genuinely stale files need deleting and a failure there is a warning
 * rather than a dead run.
 */
async function clearFixtures(keep) {
  await mkdir(OUT_DIR, { recursive: true });
  let stale = 0;
  for (const name of await readdir(OUT_DIR).catch(() => [])) {
    if (keep.has(name)) continue;
    if (!/\.(html|json)$/.test(name)) continue;
    try {
      await rm(path.join(OUT_DIR, name));
      stale++;
    } catch {
      console.warn(`  note: could not remove stale fixture ${name}`);
    }
  }
  if (stale) console.log(`removed ${stale} stale fixture(s)`);
}

async function main() {
  console.log(`legacy root: ${LEGACY_ROOT}`);
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Keep the DOM pre-JS: block every script, and the network entirely.
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'script' || type === 'xhr' || type === 'fetch') return route.abort();
    if (!route.request().url().startsWith('file://')) return route.abort();
    return route.continue();
  });

  const variants = [];
  const skipped = [];

  for (const source of SOURCES) {
    const abs = path.join(LEGACY_ROOT, source.file);
    try {
      await access(abs);
    } catch {
      skipped.push({ file: source.file, reason: 'not found' });
      continue;
    }

    const assetBase = `/legacy/${path.dirname(source.file)}`;
    const options = readInitOptions(readFileSync(abs, 'utf8'));

    await page.goto(pathToFileURL(abs).href, { waitUntil: 'domcontentloaded' });

    const found = await page.$$(source.select);
    if (!found.length) {
      skipped.push({ file: source.file, reason: 'no nav matched' });
      continue;
    }

    for (const [i, handle] of found.entries()) {
      const id =
        source.corpus === 'layout'
          ? (await handle.getAttribute('id')) || `${source.name}-${i + 1}`
          : found.length > 1
            ? `${source.name}-${i + 1}`
            : source.name;

      const html = await handle.evaluate(clean, { assetBase, runtimeClasses: RUNTIME_CLASSES });
      const fp = await handle.evaluate(fingerprint, { slots: SLOTS, modifiers: MODIFIERS });

      await writeFile(path.join(OUT_DIR, `${id}.html`), `${html}\n`, 'utf8');

      variants.push({
        id,
        corpus: source.corpus,
        source: source.file,
        options,
        ...fp,
        // Which capture states apply to this variant.
        states: [
          'bar',
          ...(fp.submenuCount > 0 ? ['bar-submenu'] : []),
          'panel',
          ...(fp.hasToggler ? ['panel-open'] : []),
          ...(fp.submenuCount > 0 && fp.hasToggler ? ['panel-submenu'] : []),
        ],
      });
    }
  }

  await browser.close();

  const manifest = {
    generatedAt: new Date().toISOString(),
    legacyRoot: LEGACY_ROOT,
    note: 'Derived from the legacy NAVX tree. Not redistributable — gitignored.',
    counts: {
      total: variants.length,
      layout: variants.filter((v) => v.corpus === 'layout').length,
      behaviour: variants.filter((v) => v.corpus === 'behaviour').length,
      willFailInit: variants.filter((v) => !v.hasToggler || !v.hasCloseButton).length,
      distinctSlotCombos: new Set(
        variants.map(
          (v) => `${v.slots.slice().sort().join('+')}|${v.modifiers.slice().sort().join('+')}`,
        ),
      ).size,
    },
    skipped,
    variants,
  };

  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  await clearFixtures(new Set([...variants.map((v) => `${v.id}.html`), 'manifest.json']));

  const { counts } = manifest;
  console.log(
    `extracted ${counts.total} variants  (${counts.layout} layout, ${counts.behaviour} behaviour)`,
  );
  console.log(`  distinct slot+modifier combinations : ${counts.distinctSlotCombos}`);
  console.log(`  variants that throw on legacy init  : ${counts.willFailInit}`);
  console.log(
    `  total capture states                : ${variants.reduce((n, v) => n + v.states.length, 0)}`,
  );
  if (skipped.length)
    console.log('  skipped:', skipped.map((s) => `${s.file} (${s.reason})`).join(', '));
  console.log(`\nfixtures → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
