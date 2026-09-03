import { defineConfig } from 'vitest/config';

// jsdom for the action tests: `attach()` needs a document. The store tests
// need nothing, but one environment for the package is simpler than two.
export default defineConfig({
  test: { environment: 'jsdom' },
});
