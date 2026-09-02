/**
 * Declaration emit.
 *
 * tsup's `dts: true` is NOT used anywhere in this repo. It delegates to
 * rollup-plugin-dts, which reaches into TypeScript's JS compiler-API internals
 * and throws `Cannot read properties of undefined (reading
 * 'useCaseSensitiveFileNames')` against TypeScript 7's native compiler.
 *
 * So: esbuild (via tsup) emits the JavaScript, and `tsc` emits the types. That
 * also removes a fragile third-party dependency from the critical path of "does
 * this package ship working types" — which is the single most common way a
 * published package is broken for its consumers.
 *
 * Node's CJS resolver looks for `.d.cts` beside a `.cjs`, so the emitted
 * declaration is duplicated under that extension. Done here rather than with
 * `cp` so the build works for contributors on Windows.
 */

import { execFileSync } from 'node:child_process';
import { copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();
const dist = path.join(cwd, 'dist');

execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '-p', 'tsconfig.build.json'],
  { stdio: 'inherit', cwd },
);

let duplicated = 0;
for (const entry of await readdir(dist, { recursive: true })) {
  if (!entry.endsWith('.d.ts')) continue;
  await copyFile(path.join(dist, entry), path.join(dist, entry.replace(/\.d\.ts$/, '.d.cts')));
  duplicated++;
}

console.log(`types: emitted with tsc, ${duplicated} declaration(s) duplicated as .d.cts`);
