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

/* ── 11. the hero demo: layout, breakpoint, drawer, accordion, motion ────── */

console.log('\nhero demo');

const heroShape = await page.evaluate(() => {
  const intro = document.querySelector('.hero-intro');
  const band = document.querySelector('.hero-demo');
  const demo = document.querySelector('.hero-demo .demo');
  const wrap = document.querySelector('.hero-demo');
  return {
    introCentred: intro ? getComputedStyle(intro).textAlign === 'center' : false,
    demoBelowIntro:
      intro && band
        ? band.getBoundingClientRect().top >= intro.getBoundingClientRect().bottom - 1
        : false,
    demoWidth: demo ? Math.round(demo.getBoundingClientRect().width) : 0,
    containerWidth: wrap
      ? Math.round(
          wrap.clientWidth - 2 * Number.parseFloat(getComputedStyle(wrap).paddingInlineStart),
        )
      : 0,
  };
});
check('the intro is centred', heroShape.introCentred);
check('the demo sits below it, not beside it', heroShape.demoBelowIntro);
check(
  'the demo spans the page container',
  Math.abs(heroShape.demoWidth - heroShape.containerWidth) <= 2,
  `${heroShape.demoWidth}px of ${heroShape.containerWidth}px`,
);

const sweep = async (viewport) => {
  await page.setViewportSize({ width: viewport, height: 950 });
  await page.waitForTimeout(320);
  const max = Number(await page.evaluate(() => document.getElementById('width').max));
  const seen = [];
  for (const value of [max, 1000, 992, 988, 700, 400]) {
    await page.evaluate((v) => {
      const range = document.getElementById('width');
      range.value = String(v);
      range.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await page.waitForTimeout(200);
    seen.push(
      await page.evaluate(() => {
        const nav = document.getElementById('demo-nav');
        const tog = nav.querySelector('.navx-toggler');
        const box = tog.getBoundingClientRect();
        const style = getComputedStyle(document.getElementById('viewport'));
        const matched = style.transform.match(/matrix\(([\d.]+)/);
        const scale = matched ? Number(matched[1]) : 1;
        return {
          css: nav.offsetWidth,
          scale: Number(scale.toFixed(3)),
          mode: getComputedStyle(nav.querySelector('.navx-panel'))
            .getPropertyValue('--navx-mode')
            .trim(),
          label: document.getElementById('mode').textContent.trim(),
          togglerSize: Math.round(box.width),
        };
      }),
    );
  }
  return { max, seen };
};

for (const viewport of [1440, 1280, 1024]) {
  const { max, seen } = await sweep(viewport);
  const modes = seen.map((row) => row.mode);
  check(
    `${viewport}px: the slider spans the breakpoint`,
    modes.includes('bar') && modes.includes('panel'),
    modes.join(' → '),
  );
  check(
    `${viewport}px: it flips at 992, not somewhere else`,
    seen[2].mode === 'bar' && seen[3].mode === 'panel',
    `992=${seen[2].mode} 988=${seen[3].mode}`,
  );
  check(
    `${viewport}px: the readout agrees with the stylesheet`,
    seen.every((r) => r.mode === r.label),
  );

  /* The awkward gap: at 988 the links are gone, so the toggler has to be there
     already and at full size. It used to be scaled to a sub-pixel smudge for
     370px of the slider's travel. */
  const panelRows = seen.filter((r) => r.mode === 'panel');
  check(
    `${viewport}px: the toggler is full size the instant the links hide`,
    panelRows.every((r) => r.togglerSize >= 40),
    panelRows.map((r) => `${r.css}:${r.togglerSize}px`).join(' '),
  );

  /* On a real desktop the container is wide enough that nothing is scaled —
     which is what keeps hairlines crisp and the drawer un-trapped. */
  if (viewport >= 1280) {
    check(
      `${viewport}px: nothing is scaled`,
      seen.every((r) => r.scale === 1),
      `max ${max}px, scales ${[...new Set(seen.map((r) => r.scale))].join(',')}`,
    );
  }
}

/* Nothing may spill past the card's edge — a clipped last menu item is what
   measuring the padded surface instead of its content box produced. */
await page.setViewportSize({ width: 1280, height: 950 });
await page.waitForTimeout(320);
const spill = await page.evaluate(async () => {
  const range = document.getElementById('width');
  range.value = range.max;
  range.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 220));
  const stage = document.getElementById('stage').getBoundingClientRect();
  const nav = document.getElementById('demo-nav').getBoundingClientRect();
  const items = [...document.querySelectorAll('#demo-nav .navx-menu > .navx-item')];
  return {
    navOver: Math.round(nav.right - stage.right),
    clipped: items.filter((i) => i.getBoundingClientRect().right > stage.right + 1).length,
    total: items.length,
  };
});
check('the nav fits its card', spill.navOver <= 1, `${spill.navOver}px over`);
check('no menu item is clipped', spill.clipped === 0, `${spill.clipped} of ${spill.total} clipped`);

/* The drawer must be fixed to the window, not to the card, at every width. */
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(300);
for (const value of [988, 900, 700, 520]) {
  const drawer = await page.evaluate(async (v) => {
    const range = document.getElementById('width');
    range.value = String(v);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 160));
    document.querySelector('#demo-nav .navx-toggler').click();
    await new Promise((r) => setTimeout(r, 460));
    const box = document.querySelector('#demo-nav .navx-panel').getBoundingClientRect();
    const out = {
      atTop: Math.abs(box.top) < 2,
      atEdge: Math.abs(box.left) < 2,
      fullHeight: Math.abs(box.height - window.innerHeight) < 2,
    };
    document.querySelector('#demo-nav .navx-panel-close').click();
    await new Promise((r) => setTimeout(r, 420));
    return out;
  }, value);
  check(
    `drawer at ${value}px escapes the card and covers the viewport`,
    drawer.atTop && drawer.atEdge && drawer.fullHeight,
    `top ${drawer.atTop} edge ${drawer.atEdge} height ${drawer.fullHeight}`,
  );
}

/*
 * Top-level dropdowns in a bar. Two bugs met here and looked like one.
 *
 * `pathOf` indexed a submenu by its position inside its own item, and every
 * item is shaped the same — so Services and Portfolio both identified as
 * `4.1`, and opening either marked both. On top of that, `multiBranch` is an
 * accordion idea that a bar cannot honour: flyouts anchored under different
 * items just land on each other.
 *
 * Asserted through the DOM and the geometry, because both faults produced the
 * same symptom and neither is visible in the state.
 */
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(320);

const bars = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const demo = [...document.querySelectorAll('.navx-demo')].find(
    (d) => d.querySelectorAll('.navx-chevron').length > 1,
  );
  if (!demo) return { skipped: true };
  const nav = demo.querySelector('.navx');
  demo.scrollIntoView({ block: 'center' });
  await wait(260);

  const roots = () =>
    [
      ...nav.querySelectorAll(
        '.navx-submenu[data-navx-state="open"], .navx-megamenu[data-navx-state="open"]',
      ),
    ].filter((s) => !s.parentElement.closest('.navx-submenu, .navx-megamenu'));

  const tops = [...nav.querySelectorAll('.navx-chevron')].filter(
    (c) => !c.closest('.navx-submenu, .navx-megamenu'),
  );
  if (tops.length < 2) return { skipped: true };

  tops[0].click();
  await wait(320);
  const afterFirst = roots().length;

  tops[1].click();
  await wait(320);
  const open = roots();
  const boxes = open.map((s) => s.getBoundingClientRect());
  let overlap = false;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const [a, c] = [boxes[i], boxes[j]];
      if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) {
        overlap = true;
      }
    }
  }

  tops[1].click();
  await wait(320);
  return {
    skipped: false,
    mode: getComputedStyle(nav.querySelector('.navx-panel')).getPropertyValue('--navx-mode').trim(),
    afterFirst,
    afterSecond: open.length,
    overlap,
    afterClose: roots().length,
  };
});

check('the demo is in bar mode for this check', bars.skipped || bars.mode === 'bar', bars.mode);
check(
  'one click opens exactly one top-level dropdown',
  bars.skipped || bars.afterFirst === 1,
  `${bars.afterFirst} open — 2 means two items share an id`,
);
check(
  'opening a second closes the first',
  bars.skipped || bars.afterSecond === 1,
  `${bars.afterSecond} open`,
);
check('so no two top-level dropdowns can overlap', bars.skipped || bars.overlap === false);
check(
  'and toggling it shut closes it',
  bars.skipped || bars.afterClose === 0,
  `${bars.afterClose} open`,
);

/* The id function is not re-implemented here, on purpose.
   An earlier version of this file recomputed a submenu's structural id with the
   same algorithm it was meant to be checking — so when two ids genuinely
   collided, it certified them as distinct and sent me looking in the reducer.
   A check that reimplements its subject can only agree with it. Identity is
   asserted by behaviour instead: one click, one open dropdown, above; and by
   unit tests in packages/core, where the paths are given rather than inferred. */

/*
 * Stacking. The drawer is `position: fixed` at `z-index: 400`; this page's
 * sticky docs bar is 40. That ordering was correct and the drawer still painted
 * underneath, because the demo surface carried `z-index: 5` and resolved the
 * 400 inside its own stacking context — so the comparison that actually
 * happened was 5 against 40.
 *
 * Geometry is not paint order, so this asks the browser which element is on
 * top rather than comparing numbers.
 */
/* Narrow, so the docs demos are drawers rather than bars — at desktop width
   the toggler is `display: none` and there is no drawer to stack. */
await page.setViewportSize({ width: 620, height: 800 });
await page.waitForTimeout(340);

const stacking = await page.evaluate(async () => {
  document.getElementById('docs').scrollIntoView();
  await new Promise((r) => setTimeout(r, 360));

  const demo = document.querySelector('.navx-demo');
  const nav = demo.querySelector('.navx');
  const bar = document.querySelector('.docs-bar');

  nav.querySelector('.navx-toggler').click();
  await new Promise((r) => setTimeout(r, 520));

  const box = bar.getBoundingClientRect();
  const panel = nav.querySelector('.navx-panel');
  const overBar = document.elementFromPoint(
    Math.round(box.left + 40),
    Math.round(box.top + box.height / 2),
  );
  const covered = panel.getBoundingClientRect();
  const result = {
    demoZ: getComputedStyle(demo).zIndex,
    drawerOverBar: overBar ? panel.contains(overBar) || overBar === panel : false,
    onTop: overBar ? String(overBar.className || overBar.tagName).slice(0, 40) : 'null',
    fullHeight: Math.abs(covered.height - window.innerHeight) < 2,
  };

  nav.querySelector('.navx-panel-close').click();
  await new Promise((r) => setTimeout(r, 480));
  return result;
});
check(
  'the demo surface creates no stacking context',
  stacking.demoZ === 'auto',
  `z-index: ${stacking.demoZ}`,
);
check(
  'the open drawer paints over the sticky bar',
  stacking.drawerOverBar,
  `topmost: ${stacking.onTop}`,
);
check('and still covers the viewport', stacking.fullHeight);

/* …and the reason that z-index was there in the first place must still hold.
   Back to desktop width, where a dropdown is a dropdown. */
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(340);

const dropdownLayer = await page.evaluate(async () => {
  const demo = [...document.querySelectorAll('.navx-demo')].find((d) =>
    d.querySelector('.navx-chevron'),
  );
  if (!demo) return { skipped: true };
  demo.scrollIntoView({ block: 'start' });
  await new Promise((r) => setTimeout(r, 300));
  demo.querySelector('.navx-chevron').click();
  await new Promise((r) => setTimeout(r, 380));

  const sub = demo.querySelector('.navx-submenu[data-navx-state="open"]');
  const code = demo.closest('.dcard')?.querySelector('.dcode');
  if (!sub || !code) return { skipped: true };
  const sb = sub.getBoundingClientRect();
  const cb = code.getBoundingClientRect();
  const hit = document.elementFromPoint(
    Math.round(sb.left + Math.min(30, sb.width / 2)),
    Math.round(Math.min(sb.top + sb.height * 0.7, window.innerHeight - 8)),
  );
  return {
    skipped: false,
    overlaps: sb.bottom > cb.top,
    onTop: hit ? sub.contains(hit) || hit === sub : false,
  };
});
check(
  'an open dropdown still overlaps the code block below it',
  dropdownLayer.skipped || dropdownLayer.overlaps,
);
check(
  'and still paints on top of it without a z-index',
  dropdownLayer.skipped || dropdownLayer.onTop,
);

/* Clicking an open parent must close the parent, not its child. */
const accordion = await page.evaluate(async () => {
  const range = document.getElementById('width');
  range.value = '700';
  range.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 160));
  document.querySelector('#demo-nav .navx-toggler').click();
  await new Promise((r) => setTimeout(r, 420));
  const nav = document.getElementById('demo-nav');
  /* Submenus only. The panel and the overlay also carry
     `data-navx-state="open"` while the drawer is open, so counting every
     marker gives a floor of 2 and buries the thing under test. */
  const count = () =>
    nav.querySelectorAll(
      '.navx-submenu[data-navx-state="open"], .navx-megamenu[data-navx-state="open"]',
    ).length;
  const parent = () => nav.querySelectorAll('.navx-chevron')[0];

  parent().click();
  await new Promise((r) => setTimeout(r, 280));
  const afterParent = count();

  const child = nav.querySelector('.navx-submenu .navx-chevron');
  if (!child) return { skipped: true };
  child.click();
  await new Promise((r) => setTimeout(r, 280));
  const afterChild = count();

  parent().click();
  await new Promise((r) => setTimeout(r, 280));
  return { skipped: false, afterParent, afterChild, afterReclick: count() };
});
check('opening a parent opens it', accordion.skipped || accordion.afterParent > 0);
check(
  'opening a child adds to it',
  accordion.skipped || accordion.afterChild > accordion.afterParent,
  `${accordion.afterParent} → ${accordion.afterChild}`,
);
check(
  'clicking the open parent closes the parent, not the child',
  accordion.skipped || accordion.afterReclick === 0,
  `${accordion.afterReclick} still open`,
);

/*
 * Motion, sampled over frames rather than read off the declaration.
 *
 * The previous version of this gate asserted that a `transition` was declared
 * with a non-zero duration, and passed — while the reviewer saw nothing move.
 * Two separate reasons, neither visible in a computed style: the whole
 * declaration had been dropped for an undefined custom property, and the open
 * state also flipped `overflow` to `visible` on the first frame, so an
 * animating height revealed nothing because nothing was ever clipped.
 *
 * A declaration is not a behaviour. Watch the box.
 */
const motion = await page.evaluate(async () => {
  const range = document.getElementById('width');
  range.value = '700';
  range.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));

  const nav = document.getElementById('demo-nav');
  const panel = nav.querySelector('.navx-panel');

  /* Earlier checks leave the drawer in whatever state they finished in, and a
     toggler click samples whichever direction that implies — which once had
     this measuring the *closing* animation and calling it a failure to open.
     Start from a known state. */
  if (panel.getAttribute('data-navx-state') === 'open') {
    nav.querySelector('.navx-panel-close').click();
    await new Promise((r) => setTimeout(r, 460));
  }

  const sample = (read, ms) =>
    new Promise((done) => {
      const first = performance.now();
      const seen = [];
      const tick = () => {
        seen.push(read());
        if (performance.now() - first < ms) requestAnimationFrame(tick);
        else done(seen);
      };
      requestAnimationFrame(tick);
    });

  nav.querySelector('.navx-toggler').click();
  const drawer = await sample(() => Math.round(panel.getBoundingClientRect().left), 420);

  const chevron = nav.querySelector('.navx-chevron');
  const submenu = chevron.closest('.navx-item').querySelector('.navx-submenu');
  chevron.click();
  const heights = await sample(
    () => ({
      h: Math.round(submenu.getBoundingClientRect().height),
      clipped: getComputedStyle(submenu).overflow !== 'visible',
    }),
    320,
  );

  return {
    drawerSteps: [...new Set(drawer)].length,
    drawerFrom: drawer[0],
    drawerTo: drawer.at(-1),
    heightSteps: [...new Set(heights.map((r) => r.h))].length,
    heightFrom: heights[0].h,
    heightTo: heights.at(-1).h,
    clippedWhileGrowing: heights.slice(0, -1).every((r) => r.clipped),
  };
});

/* More than a couple of distinct positions means it interpolated rather than
   jumped. A snap produces exactly two. */
check(
  'the drawer actually slides',
  motion.drawerSteps > 4,
  `${motion.drawerSteps} distinct positions, ${motion.drawerFrom}px → ${motion.drawerTo}px`,
);
check('and lands flush', Math.abs(motion.drawerTo) < 2, `${motion.drawerTo}px`);
check(
  'the submenu height actually animates',
  motion.heightSteps > 4,
  `${motion.heightSteps} distinct heights, ${motion.heightFrom}px → ${motion.heightTo}px`,
);
check(
  'and clips while it grows, so the growth is the reveal',
  motion.clippedWhileGrowing,
  motion.clippedWhileGrowing ? 'overflow hidden throughout' : 'overflow went visible on frame 1',
);

/*
 * `multiBranch` in the browser, asserted geometrically.
 *
 * The requirement is that open dropdowns never land on top of each other, and
 * that is exactly what this measures: every pair of open panels, tested for
 * overlap.
 *
 * Two earlier versions tried to classify which open submenus were "top level"
 * by walking parent chains, and both misread a megamenu's nesting. They
 * reported counts I then spent a long time trying to explain inside the
 * reducer, where nothing was wrong. Overlap needs no classification — it is a
 * property of two rectangles.
 */
const overlapAt = async (width) => {
  await page.reload({ waitUntil: 'load' });
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(460);
  return page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const SUB = '.navx-submenu, .navx-megamenu';

    for (const demo of document.querySelectorAll('.navx-demo')) {
      const nav = demo.querySelector('.navx');
      if (!nav) continue;
      const tops = [...nav.querySelectorAll('.navx-chevron')].filter((c) => !c.closest(SUB));
      if (tops.length < 2) continue;

      demo.scrollIntoView({ block: 'center' });
      await wait(280);

      const panel = nav.querySelector('.navx-panel');
      const toggler = nav.querySelector('.navx-toggler');
      if (getComputedStyle(toggler).display !== 'none') {
        toggler.click();
        await wait(460);
      }

      /* Open every top-level trigger in turn, then look at what is on screen. */
      for (const chevron of tops) {
        chevron.click();
        await wait(300);
      }

      const open = [...nav.querySelectorAll(`${SUB}[data-navx-state="open"]`)]
        .map((sub) => sub.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0);

      let overlaps = 0;
      for (let i = 0; i < open.length; i += 1) {
        for (let j = i + 1; j < open.length; j += 1) {
          const [a, c] = [open[i], open[j]];
          /* Nesting is fine — a flyout sits over its own parent by design. Only
             count pairs where neither contains the other. */
          const nested =
            (a.left >= c.left && a.right <= c.right && a.top >= c.top && a.bottom <= c.bottom) ||
            (c.left >= a.left && c.right <= a.right && c.top >= a.top && c.bottom <= a.bottom);
          const hits = a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
          if (hits && !nested) overlaps += 1;
        }
      }

      return {
        skipped: false,
        mode: getComputedStyle(panel).getPropertyValue('--navx-mode').trim(),
        triggers: tops.length,
        openPanels: open.length,
        overlaps,
      };
    }
    return { skipped: true };
  });
};

const inBar = await overlapAt(1280);
check('bar mode for the overlap check', inBar.skipped || inBar.mode === 'bar', inBar.mode);
check(
  'no two dropdowns overlap after opening every trigger',
  inBar.skipped || inBar.overlaps === 0,
  `${inBar.triggers} triggers, ${inBar.openPanels} panel(s) open, ${inBar.overlaps} overlapping pair(s)`,
);

const inDrawer = await overlapAt(620);
check(
  'a drawer stacks instead of overlapping',
  inDrawer.skipped || inDrawer.overlaps === 0,
  `${inDrawer.mode}, ${inDrawer.openPanels} panel(s) open, ${inDrawer.overlaps} overlapping pair(s)`,
);

await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(320);

/* The headline. Deliberately two lines at display size — the single-line
   version was tried and rejected, so this pins the choice rather than leaving
   it to drift back on the next type tweak. */
const headline = await page.evaluate(() => {
  const h1 = document.querySelector('.hero-intro h1');
  const style = getComputedStyle(h1);
  return {
    lines: Math.round(h1.getBoundingClientRect().height / Number.parseFloat(style.lineHeight)),
    fontSize: Number.parseFloat(style.fontSize),
    hasBreak: h1.querySelectorAll('br').length === 1,
    fits: h1.scrollWidth <= h1.clientWidth + 1,
  };
});
check('the headline is two lines', headline.lines === 2, `${headline.lines} line(s)`);
check('broken where the markup says', headline.hasBreak);
check('it does not overflow its box', headline.fits);
check('and is at display size', headline.fontSize >= 70, `${headline.fontSize}px`);

await page.setViewportSize({ width: 1280, height: 900 });

/* ── 12. no horizontal overflow at either end ───────────────────────────── */

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
