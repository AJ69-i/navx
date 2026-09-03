import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/demo/*.ts'],
  format: ['esm', 'cjs'],
  dts: false, // see scripts/emit-types.mjs — rollup-plugin-dts breaks on TypeScript 7
  clean: true,
  // No code splitting: a subpath entry that re-exports a shared chunk makes
  // `dist/index.js` 73 bytes, and the size budget measuring that file then
  // passes trivially while the real payload hides next door. Self-contained
  // entries cost a little duplication and keep every budget truthful.
  splitting: false,
  treeshake: true,
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
