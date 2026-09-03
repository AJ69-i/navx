/**
 * The three capture profiles, defined once.
 *
 * `playwright.config.ts` builds its projects from this and `compare-stage2.mjs`
 * builds its browser contexts from it, because the Stage 2 comparison is only
 * meaningful if the render conditions are byte-for-byte the ones that produced
 * the baseline. Keeping two copies has already cost twice: a missing
 * `{platform}` in the snapshot path, and a mobile viewport typed as 412x915 —
 * the Pixel 7's *screen* height — against baselines captured at 412x839.
 *
 * `contextOptions` are the ones Playwright accepts only on a BrowserContext
 * (`reducedMotion` among them); `use` spreads them for the test runner, and the
 * comparison script passes them to `browser.newContext()` directly.
 */

import { devices } from '@playwright/test';

/** Applies to every profile: anything that could vary between two runs. */
export const DETERMINISM = {
  colorScheme: 'light',
  deviceScaleFactor: 1,
  timezoneId: 'UTC',
  locale: 'en-US',
  reducedMotion: 'reduce',
};

export const PROJECTS = [
  {
    name: 'desktop',
    device: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  },
  {
    name: 'tablet',
    device: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
  },
  {
    name: 'mobile',
    // A real phone UA plus touch, because legacy's navigationMode() branches on
    // both navigator.userAgent and maxTouchPoints (audit defect #6). The
    // viewport is the device's, not a round number: 412x839.
    device: devices['Pixel 7'],
  },
];

/** Context options for `browser.newContext()`. */
export const contextFor = (project) => {
  const { defaultBrowserType, screen, ...rest } = project.device;
  return { ...rest, ...DETERMINISM };
};
