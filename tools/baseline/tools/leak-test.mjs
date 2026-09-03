/**
 * The leak test — the one Stage 3 exists to pass.
 *
 * Legacy's navbar cannot be unmounted. Six listeners on `window` and
 * `document` outlive every teardown, each holding a closure that holds the
 * `<nav>` element that holds its whole subtree, so an SPA that changes route
 * keeps the old navbar resident and gains another on the way back.
 *
 * "Probably fixed" is not a claim worth making, so this measures two things
 * that cannot be argued with:
 *
 *   1. Listener counts on `window` and `document`, read through CDP's
 *      DOMDebugger.getEventListeners — the browser's own registry, not a
 *      wrapper's bookkeeping. After teardown they must return to exactly the
 *      pre-init baseline.
 *   2. A WeakRef to the nav element, checked after a forced garbage
 *      collection. If anything still references it, `deref()` is not undefined.
 *
 * Both implementations run the same fixture through the same harness, so the
 * numbers are comparable rather than merely favourable.
 *
 *   node tools/leak-test.mjs [--id ex-hover] [--cycles 3]
 */

import { chromium } from '@playwright/test';
import { harnessPort } from './env.mjs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const PORT = harnessPort();
const FIXTURE = argOf('id', 'ex-hover');
const CYCLES = Number(argOf('cycles', 3));

/** Listener counts straight from the browser's registry, per global target. */
async function listenerCounts(cdp) {
  const counts = {};
  for (const [label, expression] of [
    ['window', 'window'],
    ['document', 'document'],
  ]) {
    const { result } = await cdp.send('Runtime.evaluate', { expression });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
      objectId: result.objectId,
      depth: 0,
    });
    const byType = {};
    for (const l of listeners) byType[l.type] = (byType[l.type] ?? 0) + 1;
    counts[label] = { total: listeners.length, byType };

    /**
     * Release the handler objects, not just the target.
     *
     * `getEventListeners` hands back a remote reference to every handler
     * function, and the inspector holds those alive until they are released.
     * Those closures close over the nav element — so measuring the listeners
     * was itself keeping the element reachable, and the WeakRef check failed
     * roughly one run in four. A gate that fails intermittently teaches people
     * to re-run it until it passes, which is worse than not having one.
     */
    for (const listener of listeners) {
      for (const handle of [listener.handler, listener.originalHandler]) {
        if (handle?.objectId) {
          await cdp.send('Runtime.releaseObject', { objectId: handle.objectId }).catch(() => {});
        }
      }
    }
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
  }
  return counts;
}

const delta = (before, after) => {
  const out = {};
  for (const target of ['window', 'document']) {
    const types = new Set([
      ...Object.keys(before[target].byType),
      ...Object.keys(after[target].byType),
    ]);
    for (const type of types) {
      const d = (after[target].byType[type] ?? 0) - (before[target].byType[type] ?? 0);
      if (d !== 0) out[`${target}.${type}`] = d > 0 ? `+${d}` : String(d);
    }
  }
  return out;
};

const totals = (counts) => counts.window.total + counts.document.total;

async function run(browser, impl) {
  // A fresh context per implementation: a leak from one must not be charged
  // to the other.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Runtime.enable');

  await page.goto(`http://localhost:${PORT}/lifecycle.html?impl=${impl}&id=${FIXTURE}`, {
    waitUntil: 'load',
  });

  const baseline = await listenerCounts(cdp);

  await page.evaluate(() => window.__lifecycle.init());
  const afterInit = await listenerCounts(cdp);

  await page.evaluate(() => window.__lifecycle.teardown());
  const afterTeardown = await listenerCounts(cdp);

  /**
   * Wait for collection rather than demanding it on a fixed schedule.
   *
   * `gc()` is a request, not a promise: a detached subtree can survive several
   * full collections, and a fixed six-pass loop failed about one run in six —
   * always on the *pass* case, never turning a leak green. Polling to a
   * deadline keeps the failure meaning "nothing collected this in two seconds",
   * which is a leak, while a slow collection is merely slow. Allocation
   * pressure between passes nudges V8 toward a major GC rather than a scavenge.
   */
  /**
   * Force collection through CDP, not `globalThis.gc()`.
   *
   * A detached DOM subtree lives in Blink's heap (Oilpan), not V8's, and the
   * two are reclaimed on separate schedules with a cross-heap tracing step
   * between them. `gc()` asks V8 only, which is why polling it reclaimed the
   * element eight times in ten and left the gate flaky in both directions.
   * `HeapProfiler.collectGarbage` is the lever DevTools' own "collect garbage"
   * button pulls: a blocking full collection across both heaps. Twice, because
   * the first pass breaks the cross-heap cycle and the second reclaims it.
   */
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  // One confirming deref, never in a loop: `deref()` keeps its referent alive
  // for the remainder of the current job, so polling it prevents the very
  // collection it is testing for.
  const collected = await page.evaluate(() => window.__lifecycle.confirmCollected());

  // Repeat the cycle: a leak that only shows on the second mount is the SPA
  // case, and it is the one legacy actually exhibits.
  for (let i = 0; i < CYCLES; i++) {
    await page.evaluate(() => window.__lifecycle.init());
    await page.evaluate(() => window.__lifecycle.teardown());
  }
  const afterCycles = await listenerCounts(cdp);

  await context.close();

  return {
    impl,
    baseline: totals(baseline),
    afterInit: totals(afterInit),
    afterTeardown: totals(afterTeardown),
    afterCycles: totals(afterCycles),
    added: delta(baseline, afterInit),
    leaked: delta(baseline, afterTeardown),
    leakedAfterCycles: delta(baseline, afterCycles),
    collected,
  };
}

const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] });
const results = [];
for (const impl of ['legacy', 'navx']) {
  results.push(await run(browser, impl));
}
await browser.close();

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nlifecycle · fixture ${FIXTURE} · ${CYCLES} extra mount/unmount cycles\n`);
console.log(
  `${pad('', 10)}${pad('baseline', 10)}${pad('attached', 10)}${pad('after', 10)}${pad(`after ${CYCLES}x`, 11)}element freed`,
);
for (const r of results) {
  console.log(
    `${pad(r.impl, 10)}${pad(r.baseline, 10)}${pad(r.afterInit, 10)}${pad(r.afterTeardown, 10)}` +
      `${pad(r.afterCycles, 11)}${r.collected ? 'yes' : 'NO — still referenced'}`,
  );
}

for (const r of results) {
  const leaked = Object.entries(r.leaked);
  console.log(`\n${r.impl}:`);
  console.log(`  attached: ${JSON.stringify(r.added)}`);
  if (leaked.length === 0) console.log('  after teardown: nothing left behind');
  else console.log(`  after teardown: ${JSON.stringify(r.leaked)}  ← leaked`);
  if (Object.keys(r.leakedAfterCycles).length) {
    console.log(`  after ${CYCLES} more cycles: ${JSON.stringify(r.leakedAfterCycles)}`);
  }
}

const navx = results.find((r) => r.impl === 'navx');
const clean =
  navx &&
  Object.keys(navx.leaked).length === 0 &&
  Object.keys(navx.leakedAfterCycles).length === 0 &&
  navx.collected;

if (!clean) {
  console.error(
    `\nFAILED: @navx/core did not return the page to its pre-attach state.${navx?.collected === false ? ' The nav element is still reachable after GC.' : ''}`,
  );
  process.exit(1);
}
console.log('\n@navx/core: every listener removed, element collected. No leak.');
