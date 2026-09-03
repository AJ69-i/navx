/**
 * `npx @navx/codemod ./src`
 *
 * Dry by default is a deliberate choice. A codemod that rewrites a hundred
 * files the first time you type its name is a codemod people run once, on a
 * copy, nervously. This one prints what it would do and requires `--write` to
 * do it, so the first run is free.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type FileReport, mergeReports, transform } from './transform.js';

const DEFAULT_EXTENSIONS = [
  '.html',
  '.htm',
  '.vue',
  '.svelte',
  '.jsx',
  '.tsx',
  '.astro',
  '.php',
  '.erb',
  '.twig',
  '.hbs',
  '.ejs',
  '.liquid',
  '.blade.php',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage']);

export interface CliOptions {
  readonly paths: readonly string[];
  readonly write: boolean;
  readonly extensions: readonly string[];
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const paths: string[] = [];
  let write = false;
  let extensions = DEFAULT_EXTENSIONS;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--write' || arg === '-w') write = true;
    else if (arg === '--ext') {
      const value = argv[++i] ?? '';
      extensions = value.split(',').map((e) => (e.startsWith('.') ? e : `.${e}`));
    } else if (!arg.startsWith('-')) paths.push(arg);
  }
  return { paths, write, extensions };
}

function* walk(target: string, extensions: readonly string[]): Generator<string> {
  const stats = statSync(target);
  if (stats.isFile()) {
    yield target;
    return;
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(target, entry.name), extensions);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      yield path.join(target, entry.name);
    }
  }
}

const section = (title: string, entries: Readonly<Record<string, number>>) => {
  const keys = Object.keys(entries);
  if (keys.length === 0) return;
  const total = Object.values(entries).reduce((a, b) => a + b, 0);
  console.log(`\n  ${title} (${total})`);
  for (const key of keys.sort((a, b) => (entries[b] as number) - (entries[a] as number))) {
    console.log(`    ${String(entries[key]).padStart(5)}  ${key}`);
  }
};

export function run(argv: readonly string[]): number {
  const { paths, write, extensions } = parseArgs(argv);

  if (paths.length === 0) {
    console.error(`
@navx/codemod — rewrite legacy NAVX markup

  npx @navx/codemod <path...> [--write] [--ext .html,.vue]

  Dry by default: prints what would change and touches nothing.
  --write   apply the changes
  --ext     comma-separated extensions (default: ${DEFAULT_EXTENSIONS.join(',')})
`);
    return 2;
  }

  const reports: FileReport[] = [];
  let scanned = 0;
  let changedFiles = 0;

  for (const target of paths) {
    for (const file of walk(target, extensions)) {
      scanned++;
      const source = readFileSync(file, 'utf8');
      const { code, report } = transform(source);
      if (!report.changed && report.dynamic.length === 0) continue;

      reports.push(report);
      if (report.changed) {
        changedFiles++;
        if (write) writeFileSync(file, code);
      }
      for (const item of report.dynamic) {
        console.log(`  ~ ${file}:${item.line}  computed class list — check by hand`);
        console.log(`      ${item.source}`);
      }
    }
  }

  const merged = mergeReports(reports);
  const total = Object.values(merged.renamed).reduce((a, b) => a + b, 0);
  const attrs = Object.values(merged.attributed).reduce((a, b) => a + b, 0);

  console.log(
    `\n${write ? 'rewrote' : 'would rewrite'} ${changedFiles} of ${scanned} file(s): ` +
      `${total} class rename(s), ${attrs} attribute(s)`,
  );

  section('renamed', merged.renamed);
  section('promoted to attributes', merged.attributed);
  section('dropped', merged.dropped);
  section('unmapped — these are not NAVX classes we know', merged.unknown);

  if (merged.dynamic.length > 0) {
    console.log(
      `\n  ${merged.dynamic.length} computed class list(s) left untouched. A codemod that rewrites\n  strings inside an expression it cannot evaluate is how a file gets corrupted.`,
    );
  }

  if (!write && changedFiles > 0) console.log('\n  Nothing was written. Re-run with --write.\n');
  else console.log('');

  // Unmapped `navigation-*` tokens are the one thing that should stop a script.
  return Object.keys(merged.unknown).length > 0 ? 1 : 0;
}
