import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: false, // see scripts/emit-types.mjs — rollup-plugin-dts breaks on TypeScript 7
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
