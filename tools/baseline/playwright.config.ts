import { defineConfig } from '@playwright/test';
// Shared with the extractor, the server and the spec, so a bare
// `npx playwright test` resolves .env and the legacy root identically to
// `npm run extract` — no exported variables, no drift between entry points.
import { harnessPort } from './tools/env.mjs';
import { PROJECTS } from './tools/projects.mjs';

const PORT = harnessPort();

/**
 * Stage 0 capture config.
 *
 * Everything here is in service of one property: two runs of the same commit
 * must produce byte-identical PNGs. Anything that can vary between runs —
 * animation timing, device pixel ratio, scrollbars, font loading, parallel
 * worker scheduling — is pinned rather than tolerated with a fuzzy threshold.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // {platform} is load-bearing, not decoration. macOS and Linux rasterise text
  // differently, so a macOS-captured baseline can never match a Linux CI run.
  // Each platform keeps its own approved set.
  snapshotPathTemplate: '{testDir}/__baselines__/{platform}/{projectName}/{arg}{ext}',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // a flaky baseline is a broken baseline; never paper over it
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      // Antialiasing differs slightly across CPU/GPU; nothing else should.
      maxDiffPixelRatio: 0.002,
      threshold: 0.15,
    },
  },

  use: {
    baseURL: `http://localhost:${PORT}`,
    // reducedMotion is a BrowserContext option, not a top-level test option —
    // setting it on `use` directly type-errors and would be silently ignored.
    contextOptions: { reducedMotion: 'reduce' },
    colorScheme: 'light',
    deviceScaleFactor: 1,
    timezoneId: 'UTC',
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
  },

  // Shared with tools/compare-stage2.mjs, so Stage 2 renders under exactly the
  // conditions that produced the baseline it is diffed against.
  projects: PROJECTS.map(({ name, device }) => ({
    name,
    use: { ...device, deviceScaleFactor: 1 },
  })),

  webServer: {
    command: 'node tools/serve.mjs',
    url: `http://localhost:${PORT}/fixtures/manifest.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
