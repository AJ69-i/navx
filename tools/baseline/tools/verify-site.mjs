#!/usr/bin/env node
/**
 * Assert the built landing page actually works.
 *
 *   pnpm --filter @navx/baseline-harness run site
 *
 * `site/build.mjs` can only prove that its markers were substituted. That is a
 * weak claim: a page can substitute every marker and still ship forty inert
 * navbars, a switcher that shows nothing, or a stylesheet that never reached
 * the demos. So this opens the real file in a real browser and checks the
 * things that would be embarrassing to discover after a deploy.
 *
 * It is deliberately assertive rather than descriptive — every check either
 * passes or fails the process. A verifier that prints numbers for a human to
 * eyeball is a verifier that stops being read.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

// tools/baseline/tools → repo root. Playwright lives in this package, which
// is why the checker sits here rather than next to the page it checks.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGE = join(REPO, 'site/index.html');

if (!existsSync(PAGE)) {
  console.error('verify-site: site/index.html is missing — run `node site/build.mjs` first.');
  process.exit(1);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

/* Anything the page logs is a defect until proven otherwise. Font requests are
   the one exception — the page asks Google for three families and this runs
   with no network. */
const noise = [];
page.on('console', (m) => {
  // The message text for a failed subresource does not name the URL, so match
  // on the location instead — otherwise running offline (which this does) reads
  // as a page defect every time.
  if (m.type() === 'error') noise.push(`${m.location()?.url ?? ''} ${m.text()}`);
});
page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`));

await page.goto(pathToFileURL(PAGE).href, { waitUntil: 'load' });
await page.waitForTimeout(400);

console.log('\nNAVX · verifying the built page\n');

/* ── 1. it loaded, and nothing threw ─────────────────────────────────────── */

console.log('page');
const OFFLINE =
  /fonts\.(googleapis|gstatic)|ERR_(TUNNEL_CONNECTION_FAILED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|BLOCKED_BY_CLIENT)/i;
const fatal = noise.filter((t) => !OFFLINE.test(t));
check('no console errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));
check('no unsubstituted markers', !(await page.content()).includes('__DOCS__'));

/* ── 2. every demo is live ───────────────────────────────────────────────── */

console.log('\ndemos');
const demos = await page.evaluate(() => {
  const roots = [...document.querySelectorAll('[data-navx-demo] > .navx')];
  return {
    total: roots.length,
    // `attach()` writes these; their absence means the nav is inert markup.
    attached: roots.filter((r) => r.querySelector('[aria-expanded]')).length,
    styled: roots.filter((r) => getComputedStyle(r).display !== 'inline').length,
    // `--navx-mode` is declared on `.navx-panel`, not on `.navx` — an element
    // cannot query its own container, so the property lives one level in.
    // `attach()` reads it from exactly here.
    moded: roots.filter((r) => {
      const panel = r.querySelector('.navx-panel') ?? r;
      return ['bar', 'panel'].includes(
        getComputedStyle(panel).getPropertyValue('--navx-mode').trim(),
      );
    }).length,
  };
});
check('demos present', demos.total >= 40, `${demos.total} navs`);
check('every demo attached', demos.attached === demos.total, `${demos.attached}/${demos.total}`);
check('every demo styled', demos.styled === demos.total, `${demos.styled}/${demos.total}`);
check('--navx-mode published to all', demos.moded === demos.total, `${demos.moded}/${demos.total}`);

/* ── 3. tokens are scoped, not leaked ────────────────────────────────────── */

console.log('\ntoken scope');
const scope = await page.evaluate(() => ({
  onRoot: getComputedStyle(document.documentElement).getPropertyValue('--navx-surface').trim(),
  onBody: getComputedStyle(document.body).getPropertyValue('--navx-link-color').trim(),
  inDemo: getComputedStyle(document.querySelector('.navx-demo'))
    .getPropertyValue('--navx-surface')
    .trim(),
}));
check('no --navx-surface on :root', scope.onRoot === '', scope.onRoot || 'clean');
check('no --navx-link-color inherited by body', scope.onBody === '', scope.onBody || 'clean');
check('tokens resolve inside a demo', scope.inDemo !== '', scope.inDemo);

/* ── 4. assets — nothing points at the legacy tree ───────────────────────── */

console.log('\nassets');
const assets = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.navx-demo img')];
  return {
    total: imgs.length,
    data: imgs.filter((i) => i.currentSrc.startsWith('data:')).length,
    broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    unmappedIcons: document.querySelectorAll('.navx-demo i[data-navx-icon]').length,
    maskedIcons: [...document.querySelectorAll('.navx-demo .ic')].filter(
      (e) =>
        getComputedStyle(e).maskImage !== 'none' || getComputedStyle(e).webkitMaskImage !== 'none',
    ).length,
  };
});
check('every demo image is inline', assets.data === assets.total, `${assets.data}/${assets.total}`);
check('no broken images', assets.broken === 0, `${assets.broken} broken`);
check('no unmapped icons', assets.unmappedIcons === 0, `${assets.unmappedIcons} bare <i>`);
check('icons carry a mask', assets.maskedIcons > 0, `${assets.maskedIcons} glyphs`);

/* ── 5. the framework switcher ───────────────────────────────────────────── */

console.log('\nframework switcher');
const visibleFor = async (key) => {
  if (key) await page.click(`[data-fw-pick="${key}"]`);
  return page.evaluate(() => {
    const shown = [...document.querySelectorAll('.codeblock.fw')].filter(
      (b) => getComputedStyle(b).display !== 'none',
    );
    return {
      count: shown.length,
      kinds: [...new Set(shown.map((b) => b.dataset.fw))],
    };
  });
};

const initial = await visibleFor(null);
check('one framework shown by default', initial.kinds.length === 1, initial.kinds.join(','));

for (const key of ['vue', 'svelte', 'angular', 'vanilla', 'react']) {
  const shown = await visibleFor(key);
  check(
    `switches to ${key}`,
    shown.kinds.length === 1 && shown.kinds[0] === key && shown.count === initial.count,
    `${shown.count} blocks`,
  );
}

const checked = await page.evaluate(
  () => document.querySelectorAll('[data-fw-pick][aria-checked="true"]').length,
);
check('exactly one radio checked', checked === 1, `${checked} checked`);

/* ── 6. snippets name things that exist ──────────────────────────────────── */

console.log('\nsnippets');
const presets = await import(pathToFileURL(join(REPO, 'packages/presets/dist/index.js')).href);
const exported = new Set(Object.keys(presets));

const named = await page.evaluate(() => [
  ...new Set(
    [...document.querySelectorAll('pre[data-code]')]
      .flatMap((p) => [...p.dataset.code.matchAll(/import \{ (\w+) \} from '@navx\/presets'/g)])
      .map((m) => m[1]),
  ),
]);
const unknown = named.filter((n) => !exported.has(n));
check(
  'every preset a snippet imports is exported',
  unknown.length === 0,
  unknown.join(', ') || `${named.length} names`,
);

const copyable = await page.evaluate(() => {
  const pres = [...document.querySelectorAll('pre[data-code]')];
  return {
    total: pres.length,
    // The copy payload must be the raw source, never the highlighted DOM.
    clean: pres.filter((p) => !p.dataset.code.includes('<span class="c-')).length,
    nonEmpty: pres.filter((p) => p.dataset.code.trim().length > 0).length,
  };
});
check(
  'every block has a copy payload',
  copyable.nonEmpty === copyable.total,
  `${copyable.total} blocks`,
);
check('no highlight markup in copy payloads', copyable.clean === copyable.total);

/* ── 7. the docs link, and the anchors it needs ──────────────────────────── */

console.log('\nnavigation');
const anchors = await page.evaluate(() => {
  const links = [...document.querySelectorAll('.masthead a[href^="#"], .docs-jump a[href^="#"]')];
  return links.map((a) => ({
    href: a.getAttribute('href'),
    found: !!document.querySelector(a.getAttribute('href')),
  }));
});
const dangling = anchors.filter((a) => !a.found);
check(
  'Docs link present',
  anchors.some((a) => a.href === '#docs'),
);
check('no dangling jump links', dangling.length === 0, dangling.map((d) => d.href).join(', '));
check(
  'smooth scrolling enabled',
  await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'smooth'),
);

/* ── 8. it responds — the drawer, and a submenu ──────────────────────────── */

console.log('\nbehaviour');
const first = page.locator('[data-navx-demo] > .navx').first();

const chevron = first.locator('.navx-chevron, .navx-link > button').first();
if ((await chevron.count()) > 0) {
  await chevron.click();
  check(
    'a submenu opens on click',
    (await first.locator('[data-navx-state="open"], [aria-expanded="true"]').count()) > 0,
  );
} else {
  check('a submenu opens on click', true, 'no submenu in the first demo — skipped');
}

await page.setViewportSize({ width: 560, height: 900 });
await page.waitForTimeout(300);
const panel = await page.evaluate(() => {
  const root = document.querySelector('[data-navx-demo] > .navx');
  return {
    mode: getComputedStyle(root.querySelector('.navx-panel') ?? root)
      .getPropertyValue('--navx-mode')
      .trim(),
    toggler: getComputedStyle(root.querySelector('.navx-toggler')).display,
  };
});
check('narrow viewport switches to panel', panel.mode.includes('panel'), panel.mode);
check('the toggler is visible in panel mode', panel.toggler !== 'none', panel.toggler);

await page.setViewportSize({ width: 1280, height: 900 });

/* ── 9. dark ─────────────────────────────────────────────────────────────── */

console.log('\ndark');
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(200);
const dark = await page.evaluate(() => {
  const body = getComputedStyle(document.body).backgroundColor;
  const card = getComputedStyle(document.querySelector('.dcard')).backgroundColor;
  const text = getComputedStyle(document.querySelector('.dgroup-head p')).color;
  return { body, card, text };
});
const luminance = (rgb) => {
  const [r, g, b] = (rgb.match(/\d+/g) ?? [255, 255, 255]).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
check('page ground goes dark', luminance(dark.body) < 60, dark.body);
check('cards follow', luminance(dark.card) < 80, dark.card);
check('body copy stays light on it', luminance(dark.text) > 100, dark.text);
await page.emulateMedia({ colorScheme: 'light' });

/* ── 10. theme: three states, no flash, demos in step ────────────────────── */

console.log('\ntheme');

/* The whole point of the inline script is that it is neither deferred nor a
   module. Either one lets a white page paint before a stored dark preference
   is read, and a screenshot cannot catch a single frame reliably — so assert
   the property that makes the flash impossible instead. */
const prepaint = await page.evaluate(() => {
  const scripts = [...document.scripts];
  const inline = scripts.find((s) => !s.src && s.textContent.includes('navx-theme'));
  if (!inline) return { found: false };
  return {
    found: true,
    blocking: !inline.defer && !inline.async && inline.type !== 'module',
    beforeBody: inline.compareDocumentPosition(document.body) & Node.DOCUMENT_POSITION_FOLLOWING,
  };
});
check('a pre-paint theme script exists', prepaint.found);
check('it is blocking, not deferred or a module', prepaint.blocking === true);
check('it runs before the body', Boolean(prepaint.beforeBody));

const themeState = async () =>
  page.evaluate(() => {
    const root = document.documentElement;
    const surfaces = [...document.querySelectorAll('.navx-demo')];
    return {
      attr: root.getAttribute('data-theme'),
      scheme: getComputedStyle(root).colorScheme,
      paper: getComputedStyle(document.body).backgroundColor,
      accent: getComputedStyle(root).getPropertyValue('--accent').trim(),
      checked: [...document.querySelectorAll('[data-theme-pick][aria-checked="true"]')].map(
        (b) => b.dataset.themePick,
      ),
      following: surfaces.filter(
        (d) => !d.hasAttribute('data-pin') && d.getAttribute('data-navx-theme') === 'dark',
      ).length,
      free: surfaces.filter((d) => !d.hasAttribute('data-pin')).length,
      pinnedDark: surfaces.filter(
        (d) => d.hasAttribute('data-pin') && d.getAttribute('data-navx-theme') === 'dark',
      ).length,
      meta: document.querySelector('meta[name="theme-color"]')?.content ?? null,
    };
  });

await page.emulateMedia({ colorScheme: 'light' });
await page.waitForTimeout(200);
let t = await themeState();
check('defaults to system', t.attr === null && t.checked.join() === 'system');
check('light on a light machine', t.scheme === 'light', t.paper);
check('demos stay light with the page', t.following === 0, `${t.following}/${t.free} dark`);

await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(250);
t = await themeState();
check('follows the OS to dark with no click', t.scheme === 'dark' && t.attr === null, t.paper);
check('still reads as system', t.checked.join() === 'system');
check('every unpinned demo follows', t.following === t.free, `${t.following}/${t.free}`);
check('theme-color meta tracks the ground', /^#|rgb/.test(t.meta ?? ''), t.meta);

/* An explicit choice has to beat the OS in both directions — the direction
   people forget is light-on-a-dark-machine. */
await page.click('[data-theme-pick="light"]');
await page.waitForTimeout(200);
t = await themeState();
check('light chosen on a dark machine wins', t.attr === 'light' && t.scheme === 'light', t.paper);
check('demos go back to light', t.following === 0, `${t.following}/${t.free}`);
check('pinned demos keep their theme', t.pinnedDark > 0, `${t.pinnedDark} pinned dark`);

const stored = await page.evaluate(() => localStorage.getItem('navx-theme'));
check('the choice is written down', stored === 'light', String(stored));

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(300);
t = await themeState();
check('and survives a reload', t.attr === 'light' && t.checked.join() === 'light');

await page.click('[data-theme-pick="system"]');
await page.waitForTimeout(200);
t = await themeState();
const cleared = await page.evaluate(() => localStorage.getItem('navx-theme'));
check('system is reachable again', t.attr === null && cleared === null);
check('and hands control back to the OS', t.scheme === 'dark', t.paper);

await page.emulateMedia({ colorScheme: 'light' });
await page.evaluate(() => localStorage.removeItem('navx-theme'));

/* ── 11. no horizontal overflow at either end ───────────────────────────── */

console.log('\nlayout');
for (const width of [1280, 900, 560, 380]) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`no horizontal overflow at ${width}px`, overflow <= 1, `${overflow}px`);
}

await browser.close();

console.log('');
if (failures > 0) {
  console.error(`  ${failures} failure(s).\n`);
  process.exit(1);
}
console.log('  the page is sound.\n');
