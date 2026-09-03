import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/scrollspy.ts'],
  format: ['esm', 'cjs'],
  dts: false, // see scripts/emit-types.mjs — rollup-plugin-dts breaks on TypeScript 7
  clean: true,
  // Self-contained entries, so the size budget measures the real payload.
  splitting: false,
  treeshake: true,
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
