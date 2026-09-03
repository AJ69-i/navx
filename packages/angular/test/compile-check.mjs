/**
 * @navx/angular's test suite: does the published package compile inside an
 * application?
 *
 * There is nothing here for vitest to run — an Angular adapter's contract is a
 * *compile-time* one. `tsc --noEmit` checks our sources and ng-packagr emits
 * partial declarations, but neither one runs Angular's template type-checker
 * against a template that uses the directive, which is the only place a
 * consumer would find out that an input is not bindable.
 *
 * So: two `ngc` runs against `dist/`.
 *
 *   1. test/consumer      must compile — a realistic standalone component with
 *                         every input bound, `strictTemplates` on, `full`
 *                         compilation mode.
 *   2. test/should-fail   must NOT compile — the control. A green check is
 *                         only evidence if a red one is reachable, and
 *                         template checking is easy to lose silently.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = dirname(dirname(fileURLToPath(import.meta.url)));

if (!existsSync(join(pkg, 'dist', 'package.json'))) {
  console.error('dist/ is missing — run `pnpm --filter @navx/angular build` first.');
  process.exit(1);
}

const ngc = (project) =>
  spawnSync('npx', ['ngc', '-p', project], {
    cwd: pkg,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

let failed = false;

const positive = ngc('tsconfig.consumer.json');
if (positive.status === 0) {
  console.log('ok   test/consumer compiles against dist/ (full mode, strictTemplates)');
} else {
  failed = true;
  console.log('FAIL test/consumer does not compile against dist/');
  console.log(`${positive.stdout ?? ''}${positive.stderr ?? ''}`.trimEnd());
}

const negative = ngc('tsconfig.should-fail.json');
// ngc colourises diagnostics even when its output is a pipe, and the escape
// sequences land *between* `error` and the code, so the codes have to be
// counted on stripped text. (Matching the raw stream finds nothing and reports
// a false failure — which is how this line was written the first time.)
const errors = `${negative.stdout ?? ''}${negative.stderr ?? ''}`;
// The escape is written as `\u001B` rather than a raw byte so it is visible
// in a diff. Biome's rule against control characters in regexes exists to
// catch the accidental ones; this one is the entire point of the line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI CSI sequences requires ESC.
const ANSI = /\u001B\[[0-9;]*m/g;
const plain = errors.replace(ANSI, '');
// Count the distinct diagnostics so a single error cannot stand in for three
// deliberately different mistakes.
const diagnostics = plain.match(/error (?:NG|TS)\d+/g) ?? [];

if (negative.status !== 0 && diagnostics.length >= 3) {
  console.log(
    `ok   test/should-fail is rejected — ${diagnostics.length} template diagnostics, so strictTemplates is genuinely checking our inputs`,
  );
} else {
  failed = true;
  console.log(
    negative.status === 0
      ? 'FAIL test/should-fail compiled clean — the template type-checker is not running'
      : `FAIL test/should-fail produced only ${diagnostics.length} diagnostic(s); expected 3`,
  );
  console.log(errors.trimEnd());
}

process.exit(failed ? 1 : 0);
