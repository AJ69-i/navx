#!/usr/bin/env node
/**
 * Smoke-test the *published* packages, from a project that has never seen this
 * repo.
 *
 *   node tools/verify-published.mjs [version]
 *
 * `pnpm verify` proves the source is sound and `publint`/`attw` inspect a
 * tarball on disk. Neither proves that what the registry actually serves
 * installs and runs. The gap between them is small but real: a `files` entry
 * that excluded something, an export map that resolves against the workspace
 * but not against `node_modules`, a `bin` that was never chmod'd.
 *
 * So this installs from the registry into a temp directory outside the repo —
 * outside is the point, since a workspace resolution would make every check
 * pass for the wrong reason — and then uses the packages the way a consumer
 * would.
 *
 * It pays particular attention to the surfaces the local gates could not
 * reach:
 *
 *   - `@navx/presets/demo/*`, a wildcard export. `attw` reports it as
 *     "(wildcard)" and checks nothing, so this is its first real test.
 *   - the `navx-codemod` bin, which only exists once npm links it.
 *   - the CSS entry points, excluded from `attw` because they are not types.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const VERSION = process.argv[2] ?? 'latest';
const PACKAGES = [
  '@navx/tokens',
  '@navx/styles',
  '@navx/core',
  '@navx/presets',
  '@navx/react',
  '@navx/vue',
  '@navx/svelte',
  '@navx/element',
  '@navx/angular',
  '@navx/codemod',
];

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...options });

console.log(`\nNAVX · verifying published packages @ ${VERSION}\n`);

/* ── 1. the registry has them, with provenance ──────────────────────────── */

console.log('registry');
const seen = new Map();
for (const name of PACKAGES) {
  try {
    const raw = run('npm', [
      'view',
      `${name}@${VERSION}`,
      'version',
      'dist.attestations',
      '--json',
    ]);
    // `npm view` with several fields returns an object; with one, a bare value.
    const view = JSON.parse(raw);
    const version = typeof view === 'string' ? view : view.version;
    seen.set(name, version);
    const attested = typeof view === 'object' && view['dist.attestations'] !== undefined;
    check(`${name.padEnd(16)} ${version}`, true, attested ? 'provenance ✓' : 'no provenance');
  } catch (error) {
    check(name.padEnd(16), false, String(error.message).split('\n')[0]);
  }
}

const versions = [...new Set(seen.values())];
check(
  'all ten packages are the same version',
  seen.size === PACKAGES.length && versions.length === 1,
  versions.join(', '),
);

if (failures > 0) {
  console.error('\n  Nothing installed — the registry check failed first.\n');
  process.exit(1);
}
const resolved = versions[0];

/* ── 2. install into a project that knows nothing about this repo ────────── */

const dir = mkdtempSync(path.join(tmpdir(), 'navx-verify-'));
console.log(`\nfresh project  ${dir}`);

writeFileSync(
  path.join(dir, 'package.json'),
  `${JSON.stringify({ name: 'navx-verify', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
);

try {
  run('npm', ['install', '--no-audit', '--no-fund', ...PACKAGES.map((p) => `${p}@${resolved}`)], {
    cwd: dir,
  });
  check('npm install', true, `${PACKAGES.length} packages`);
} catch (error) {
  check(
    'npm install',
    false,
    String(error.stderr ?? error.message)
      .split('\n')
      .slice(0, 3)
      .join(' '),
  );
  console.error(`\n  Left the project at ${dir} for inspection.\n`);
  process.exit(1);
}

const node = (source, label) => {
  const file = path.join(dir, `${label}.mjs`);
  writeFileSync(file, source);
  return run('node', [file], { cwd: dir });
};

/* ── 3. ESM, CJS, and every subpath ──────────────────────────────────────── */

console.log('\nresolution');

try {
  const out = node(
    `
    import { attach, createNav, isOpen } from '@navx/core';
    import { spy } from '@navx/core/scrollspy';
    import { catalogue, byFixture, plan, html, render } from '@navx/presets';
    import { content } from '@navx/presets/demo/navigation15';
    import { CLASS_MAP, transform } from '@navx/codemod';
    console.log(JSON.stringify({
      fns: [attach, createNav, isOpen, spy, plan, html, render, transform].every(f => typeof f === 'function'),
      presets: catalogue.length,
      fixtures: Object.keys(byFixture).length,
      demoMenus: content.menus.length,
      classes: Object.keys(CLASS_MAP).length,
    }));
    `,
    'esm',
  );
  const r = JSON.parse(out.trim().split('\n').pop());
  check('ESM imports, including every subpath', r.fns);
  check('preset catalogue', r.presets === 28, `${r.presets} presets`);
  check('byFixture map', r.fixtures === 56, `${r.fixtures} fixtures`);
  // The wildcard export attw cannot check.
  check('@navx/presets/demo/* wildcard', r.demoMenus > 0, `${r.demoMenus} menu(s)`);
  check('codemod mapping table', r.classes >= 36, `${r.classes} class renames`);
} catch (error) {
  check('ESM imports', false, String(error.stderr ?? error.message).split('\n')[0]);
}

try {
  const out = node(
    `
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const core = require('@navx/core');
    const spy = require('@navx/core/scrollspy');
    const codemod = require('@navx/codemod');
    console.log(JSON.stringify({
      ok: typeof core.createNav === 'function' && typeof spy.spy === 'function'
          && typeof codemod.transform === 'function',
    }));
    `,
    'cjs',
  );
  check('CJS require', JSON.parse(out.trim().split('\n').pop()).ok);
} catch (error) {
  check('CJS require', false, String(error.stderr ?? error.message).split('\n')[0]);
}

/* ── 4. the CSS, which attw is excluded from ─────────────────────────────── */

console.log('\nstylesheets');
for (const [spec, min] of [
  ['@navx/styles/navx.css', 40_000],
  ['@navx/styles/navx.min.css', 20_000],
  ['@navx/styles/navx.layer.css', 40_000],
  ['@navx/tokens/tokens.css', 8_000],
  ['@navx/tokens/skins/dark.css', 200],
]) {
  try {
    const file = path.join(dir, 'node_modules', spec);
    const bytes = readFileSync(file).length;
    check(spec.padEnd(30), bytes >= min, `${bytes.toLocaleString()} B`);
  } catch {
    check(spec.padEnd(30), false, 'missing');
  }
}

/* ── 5. it actually renders ──────────────────────────────────────────────── */

console.log('\nbehaviour');
try {
  const out = node(
    `
    import { byFixture, plan, html } from '@navx/presets';
    import { content } from '@navx/presets/demo/navigation15';
    const markup = html(plan(byFixture.navigation15, content, { overlay: true }));
    console.log(JSON.stringify({
      len: markup.length,
      nav: markup.startsWith('<nav class="navx"'),
      toggler: markup.includes('class="navx-toggler"'),
      legacy: markup.includes('navigation-'),
    }));
    `,
    'render',
  );
  const r = JSON.parse(out.trim().split('\n').pop());
  check('plan + html render a nav', r.nav && r.toggler, `${r.len} bytes of markup`);
  check('no legacy class survives', !r.legacy);
} catch (error) {
  check('plan + html', false, String(error.stderr ?? error.message).split('\n')[0]);
}

try {
  const out = node(
    `
    import { transform } from '@navx/codemod';
    const { code, report } = transform('<nav class="navigation navigation-justified"><ul class="navigation-menu">');
    console.log(JSON.stringify({ code, renamed: Object.keys(report.renamed).length }));
    `,
    'codemod',
  );
  const r = JSON.parse(out.trim().split('\n').pop());
  check(
    'codemod transforms',
    r.code.includes('class="navx"') && r.code.includes('data-navx-align="between"'),
    r.code.slice(0, 52),
  );
} catch (error) {
  check('codemod transforms', false, String(error.stderr ?? error.message).split('\n')[0]);
}

/* ── 6. the bin, which only exists once npm links it ─────────────────────── */

try {
  const out = run('npx', ['--no-install', 'navx-codemod'], { cwd: dir }).toString();
  check('navx-codemod bin', out.includes('rewrite legacy NAVX markup'));
} catch (error) {
  // Usage text goes to stderr with exit 2, which is correct behaviour.
  const text = String(error.stdout ?? '') + String(error.stderr ?? '');
  check('navx-codemod bin', text.includes('rewrite legacy NAVX markup'), 'usage on stderr, exit 2');
}

/* ── 7. types resolve for a consumer ─────────────────────────────────────── */

console.log('\ntypes');
writeFileSync(
  path.join(dir, 'consumer.ts'),
  `
import { attach, createNav, type NavState } from '@navx/core';
import { spy } from '@navx/core/scrollspy';
import { plan, type NavxPreset, type NavxContent } from '@navx/presets';

export function use(root: HTMLElement, preset: NavxPreset, content: NavxContent) {
  const machine = createNav();
  const detach = attach(root, machine, { trigger: 'click' });
  const stop = spy(root, machine, { offset: 64 });
  const state: NavState = machine.getState();
  const tree = plan(preset, content);
  return { detach, stop, state, tree };
}
`,
);
writeFileSync(
  path.join(dir, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2022',
        lib: ['es2023', 'dom'],
        skipLibCheck: false,
      },
      include: ['consumer.ts'],
    },
    null,
    2,
  )}\n`,
);

try {
  run('npx', ['--yes', 'typescript@latest', 'tsc', '-p', 'tsconfig.json'], { cwd: dir });
  check('a strict consumer compiles against the published types', true);
} catch (error) {
  check(
    'a strict consumer compiles',
    false,
    String(error.stdout ?? error.message)
      .split('\n')
      .slice(0, 4)
      .join(' | '),
  );
}

/* ── done ────────────────────────────────────────────────────────────────── */

console.log('');
if (failures) {
  console.error(`  ${failures} failure(s). Project left at ${dir}\n`);
  process.exit(1);
}
console.log(`  @navx ${resolved} installs and runs from the registry.\n`);
