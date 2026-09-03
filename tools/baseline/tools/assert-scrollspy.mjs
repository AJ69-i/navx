/**
 * Stage 6 gate — scroll-spy, in a browser that actually scrolls.
 *
 * The unit tests decide whether the module's *rule* is right, with stubbed
 * rects in jsdom. This decides whether that rule survives a real scroll
 * container, a real sticky header and a real `IntersectionObserver` — and
 * whether the two things Stage 6 handed to the browser instead of
 * re-implementing (smooth scrolling and the offset) actually happen.
 *
 * It also checks what legacy got wrong by omission: that a nav with no
 * scroll-spy never has its own `data-navx-current` disturbed, and that
 * teardown leaves the page exactly as it was found.
 */

import { chromium } from '@playwright/test';
import { harnessPort } from './env.mjs';

const PORT = harnessPort();
const OFFSET = 60;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const open = async (query = '') => {
  await page.goto(`http://localhost:${PORT}/stage6.html${query}`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-navx-ready="1"]', { timeout: 15_000 });
};

/** Scroll and let the observer settle. */
const scrollTo = async (y) => {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  await page.waitForTimeout(120);
};

const active = () => page.evaluate(() => window.__spy.state().activeId);
const marked = () => page.evaluate(() => window.__spy.currentIds());

console.log('\nStage 6 · scroll-spy\n');

// ── activation ──────────────────────────────────────────────────────────────
await open(`?offset=${OFFSET}`);

const top = await page.evaluate(() => document.getElementById('features').offsetTop);
await scrollTo(top);
check('the section at the probe line is active', (await active()) === 'features', await active());

const pricingTop = await page.evaluate(() => document.getElementById('pricing').offsetTop);
await scrollTo(pricingTop);
check('scrolling to the next section moves it', (await active()) === 'pricing', await active());

await scrollTo(pricingTop - 200);
check('and back again', (await active()) === 'features', await active());

// The item carrying the matching link is marked, and only that one — the
// `href="#"` Home item is marked in the markup and must be released once
// scroll-spy engages, then restored on teardown.
check(
  'exactly one item is marked, and it is the right one',
  JSON.stringify(await marked()) === JSON.stringify(['#features']),
  JSON.stringify(await marked()),
);

// ── the offset does its job ─────────────────────────────────────────────────
const overlap = await page.evaluate((offset) => {
  const link = document.querySelector('a[href="#pricing"]');
  link.click();
  return new Promise((resolve) => {
    // Native smooth scrolling, so wait for it to settle rather than assuming.
    let last = -1;
    const tick = () => {
      const y = window.scrollY;
      if (y === last) {
        const rect = document.getElementById('pricing').getBoundingClientRect();
        resolve({ top: Math.round(rect.top), offset });
        return;
      }
      last = y;
      setTimeout(tick, 60);
    };
    tick();
  });
}, OFFSET);

check(
  'clicking a nav link lands the section below the sticky header',
  Math.abs(overlap.top - OFFSET) <= 2,
  `section top at ${overlap.top}px, offset ${OFFSET}px`,
);

check(
  'and the fragment reached the URL',
  (await page.url()).endsWith('#pricing'),
  await page.url(),
);

// ── the browser owns the animation ──────────────────────────────────────────
const behaviour = await page.evaluate(
  () => getComputedStyle(document.documentElement).scrollBehavior,
);
check('scroll-behavior is smooth, set by the module', behaviour === 'smooth', behaviour);

const margin = await page.evaluate(
  () => getComputedStyle(document.getElementById('pricing')).scrollMarginBlockStart,
);
check('scroll-margin carries the offset', margin === `${OFFSET}px`, margin);

// ── a nav with no scroll-spy is untouched ───────────────────────────────────
await open('?spy=0');
await scrollTo(1200);
check(
  "without scroll-spy, the page's own current marker is left alone",
  JSON.stringify(await marked()) === JSON.stringify(['#']),
  JSON.stringify(await marked()),
);

// ── teardown restores the page ──────────────────────────────────────────────
await open(`?offset=${OFFSET}`);
await scrollTo(top);
const before = await page.evaluate(() => ({
  behaviour: document.documentElement.style.getPropertyValue('scroll-behavior'),
  margin: document.getElementById('pricing').style.getPropertyValue('scroll-margin-block-start'),
}));
await page.evaluate(() => window.__spy.stop());
const after = await page.evaluate(() => ({
  behaviour: document.documentElement.style.getPropertyValue('scroll-behavior'),
  margin: document.getElementById('pricing').style.getPropertyValue('scroll-margin-block-start'),
  active: window.__spy.state().activeId,
  marked: window.__spy.currentIds(),
}));

check('teardown removes scroll-behavior', before.behaviour === 'smooth' && after.behaviour === '');
check('teardown removes scroll-margin', before.margin === `${OFFSET}px` && after.margin === '');
check('teardown clears the machine', after.active === null, String(after.active));
check(
  "teardown restores the markup's own current marker",
  JSON.stringify(after.marked) === JSON.stringify(['#']),
  JSON.stringify(after.marked),
);

// After teardown, scrolling must move nothing.
await scrollTo(pricingTop);
check('after teardown, scrolling is inert', (await active()) === null, String(await active()));

await browser.close();

if (failures) {
  console.error(`\n  ${failures} failure(s).\n`);
  process.exit(1);
}
console.log('\n  scroll-spy observes; the browser scrolls. Nothing left behind.\n');
