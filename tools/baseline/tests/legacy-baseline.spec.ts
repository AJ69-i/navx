import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { paths } from '../tools/env.mjs';

/**
 * Stage 0 — legacy visual baselines.
 *
 * These snapshots are the contract every later stage is measured against:
 * Stage 2 rewrites the CSS and must reproduce them, Stage 3 rewrites the
 * behaviour and must reproduce them, Stage 5 replaces the markup with presets
 * and must reproduce them. They are captured once, from the legacy source, and
 * then treated as read-only.
 *
 * One deliberate choice: submenu-open states are produced by driving the
 * plugin's own API rather than by clicking. Legacy defect #1 (e.target vs
 * e.currentTarget) means a click on a link containing an icon never opens its
 * dropdown, so clicking would baseline the bug instead of the intended
 * appearance. Input-path correctness is a Stage 3 behavioural test; this file
 * captures what the component is supposed to look like.
 */

const MANIFEST = path.join(paths.fixtures, 'manifest.json');
const REFERENCE_DIR = paths.reference;

type Variant = {
  id: string;
  corpus: 'layout' | 'behaviour';
  source: string;
  options: Record<string, unknown>;
  slots: string[];
  modifiers: string[];
  hasToggler: boolean;
  hasCloseButton: boolean;
  submenuCount: number;
  maxSubmenuDepth: number;
  elementCount: number;
  states: string[];
};

const manifest: { variants: Variant[] } | null = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
  : null;

if (!manifest) {
  test('fixtures are missing', () => {
    throw new Error(
      'tests/_fixtures/manifest.json not found.\n' +
        'Run `npm run extract` first (needs NAVX_LEGACY_ROOT).',
    );
  });
}

const variants = manifest?.variants ?? [];
const layout = variants.filter((v) => v.corpus === 'layout');
const behaviour = variants.filter((v) => v.corpus === 'behaviour');

/** Skins are global token overrides, so a representative sample proves the layer. */
const SKINS = [
  'border-top',
  'border-bottom',
  'border-top-bottom',
  'boxed',
  'rounded-boxed',
  'colored',
  'gradient',
  'mini-circle',
  'bottom-arrow',
  'dark',
];
const SKIN_SUBJECTS = ['navigation13', 'navigation43', 'ex-hover'];

// ── harness helpers ───────────────────────────────────────────────────────────

async function mount(page: Page, id: string, opts: { skin?: string; dir?: 'ltr' | 'rtl' } = {}) {
  const qs = new URLSearchParams({ id });
  if (opts.skin) qs.set('skin', opts.skin);
  if (opts.dir) qs.set('dir', opts.dir);

  await page.goto(`/?${qs}`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });

  const error = await page.getAttribute('html', 'data-navx-error');
  if (error) throw new Error(`harness failed to mount ${id}: ${error}`);
}

/**
 * Open a submenu via the plugin API.
 *
 * `nested: false` opens the first top-level submenu.
 * `nested: true`  finds the deepest submenu anywhere in the nav and opens its
 *                 whole ancestor chain outermost-first — the deepest menu is
 *                 not necessarily under the first top-level item, so walking
 *                 down from item one misses it.
 *
 * Returns the depth actually opened, or 0 if there was nothing to open.
 */
async function openSubmenu(page: Page, nested = false): Promise<number> {
  return page.evaluate((deep) => {
    const nav = document.querySelector('.navigation') as any;
    if (!nav || typeof nav.showSubmenu !== 'function') return 0;

    const SUBMENU = '.navigation-dropdown, .navigation-megamenu';
    const all = [...nav.querySelectorAll(SUBMENU)] as HTMLElement[];
    if (!all.length) return 0;

    /** The chain of submenus from the outermost down to `leaf`, inclusive. */
    const chainTo = (leaf: HTMLElement) => {
      const chain: HTMLElement[] = [];
      for (let el: HTMLElement | null = leaf; el && el !== nav; el = el.parentElement) {
        if (el.matches(SUBMENU)) chain.unshift(el);
      }
      return chain;
    };

    const first = all[0];
    if (!first) return 0;

    const target = deep
      ? all.reduce((best, s) => (chainTo(s).length > chainTo(best).length ? s : best), first)
      : (all.find((s) => chainTo(s).length === 1) ?? first);

    const chain = chainTo(target);
    for (const submenu of chain) {
      // The plugin opens `link.nextElementSibling`, so hand it the link that
      // precedes this submenu rather than searching for one by class.
      const link = submenu.previousElementSibling as HTMLElement | null;
      const item = submenu.parentElement as HTMLElement | null;
      if (!link || !item) return 0;
      item.classList.add('is-active');
      nav.showSubmenu(link);
    }
    return chain.length;
  }, nested);
}

async function openPanel(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.navigation') as any;
    if (!nav || typeof nav.toggleOffcanvas !== 'function') return false;
    nav.toggleOffcanvas();
    return !!nav.querySelector('.navigation-body.is-visible');
  });
}

/** Let the plugin's DOM writes land and styles resolve. Deterministic, not a sleep. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

const shot = async (page: Page, name: string) => {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`);
};

// ── layout corpus: the 46 catalogue variants ──────────────────────────────────

test.describe('layout corpus', () => {
  for (const v of layout) {
    test(`${v.id} @rest`, async ({ page }, testInfo) => {
      await mount(page, v.id);
      await shot(page, `${v.id}--rest`);

      // On mobile the off-canvas panel is the other half of the component.
      if (testInfo.project.name === 'mobile' && v.hasToggler) {
        expect(await openPanel(page), 'off-canvas should open').toBe(true);
        await shot(page, `${v.id}--panel-open`);
      }
    });
  }
});

// ── behaviour corpus: the Examples pages, where the submenus live ─────────────

test.describe('behaviour corpus', () => {
  for (const v of behaviour) {
    test(`${v.id} @rest`, async ({ page }) => {
      await mount(page, v.id);
      await shot(page, `${v.id}--rest`);
    });

    if (v.submenuCount > 0) {
      test(`${v.id} @submenu-open`, async ({ page }, testInfo) => {
        await mount(page, v.id);
        if (testInfo.project.name === 'mobile') {
          expect(await openPanel(page), 'off-canvas should open').toBe(true);
        }
        expect(await openSubmenu(page), 'first submenu should open').toBeGreaterThan(0);
        await shot(page, `${v.id}--submenu-open`);
      });
    }

    if (v.maxSubmenuDepth > 1) {
      test(`${v.id} @submenu-nested`, async ({ page }, testInfo) => {
        await mount(page, v.id);
        if (testInfo.project.name === 'mobile') {
          expect(await openPanel(page), 'off-canvas should open').toBe(true);
        }
        const depth = await openSubmenu(page, true);
        expect(depth, `should open ${v.maxSubmenuDepth} nested levels`).toBe(v.maxSubmenuDepth);
        await shot(page, `${v.id}--submenu-nested`);
      });
    }
  }
});

// ── skins: proves the Stage 2 token layer reproduces all ten ──────────────────

test.describe('skins', () => {
  // Note: a conditional `test.skip(fn)` callback receives fixtures only — no
  // TestInfo — so project-scoped skips have to go through beforeEach.
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'skins are colour-only; desktop is sufficient');
  });

  for (const id of SKIN_SUBJECTS) {
    if (!variants.some((v) => v.id === id)) continue;
    for (const skin of SKINS) {
      test(`${id} @skin-${skin}`, async ({ page }) => {
        await mount(page, id, { skin });
        await shot(page, `${id}--skin-${skin}`);
      });
    }
  }
});

// ── RTL reference gallery: captured, never asserted ───────────────────────────
//
// Legacy has 60 physical-direction declarations and no logical properties, so
// these renders are expected to be wrong. They are captured as the "before" half
// of the Stage 2 RTL review, not as a target to reproduce.

test.describe('rtl reference (not asserted)', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      !['desktop', 'mobile'].includes(testInfo.project.name),
      'two viewports is enough for review',
    );
  });

  for (const v of variants) {
    test(`${v.id} @rtl`, async ({ page }, testInfo) => {
      await mount(page, v.id, { dir: 'rtl' });
      if (testInfo.project.name === 'mobile' && v.hasToggler) await openPanel(page);
      else if (v.submenuCount > 0) await openSubmenu(page);
      await settle(page);

      const dir = path.join(REFERENCE_DIR, 'rtl', testInfo.project.name);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `${v.id}.png`), animations: 'disabled' });
    });
  }
});

// ── diagnostics: turn the audit's claims into a machine-checked report ────────

test.describe('legacy diagnostics', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'runs once');
  });

  test('record which variants the legacy plugin fails to initialise', async ({ page }) => {
    const failures: { id: string; reason: string; missing: string[] }[] = [];

    for (const v of variants) {
      await mount(page, v.id);
      const initError = await page.getAttribute('html', 'data-navx-init-error');
      if (initError) {
        failures.push({
          id: v.id,
          reason: initError,
          missing: [
            ...(v.hasToggler ? [] : ['.navigation-button-toggler']),
            ...(v.hasCloseButton ? [] : ['.navigation-body-close-button']),
          ],
        });
      }
    }

    mkdirSync(REFERENCE_DIR, { recursive: true });
    writeFileSync(
      path.join(REFERENCE_DIR, 'legacy-init-failures.json'),
      JSON.stringify({ checked: variants.length, failed: failures.length, failures }, null, 2),
    );

    // Not an assertion that failures === 0. This records the legacy baseline so
    // Stage 3 can assert the rewritten core initialises all of them.
    test.info().annotations.push({
      type: 'legacy-init',
      description: `${failures.length}/${variants.length} variants throw during legacy init`,
    });
  });
});
