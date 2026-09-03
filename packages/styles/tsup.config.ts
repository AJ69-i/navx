import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false, // see scripts/emit-types.mjs — rollup-plugin-dts breaks on TypeScript 7
  // build.mjs has already written dist/*.css by the time tsup runs, and
  // cleaning would delete every stylesheet the exports map points at — which
  // publint catches and nothing else would. Same reason as @navx/tokens, which
  // additionally *cannot* be reordered because its build.mjs generates a source
  // file that tsup then compiles.
  clean: false,
  treeshake: true,
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
