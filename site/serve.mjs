#!/usr/bin/env node
/**
 * Preview the landing page locally.
 *
 *   pnpm preview              # build, serve on 4318, rebuild on change
 *   pnpm preview -- --port 8080
 *   pnpm preview -- --once    # build and serve, no watching
 *
 * The page is a single self-contained file — tokens, stylesheet, core, icons
 * and artwork are all inlined — so it opens fine straight off disk, and the
 * verifier proves it: `verify-site.mjs` loads it over `file://` and all of its
 * checks pass, module script included (inline modules need no fetch, so the
 * CORS rule that blocks `<script type="module" src="…">` over file:// never
 * applies here).
 *
 * This exists for the difference that remains. Over `file://` every page shares
 * one opaque origin, so `localStorage` is shared with every other local file
 * you have ever opened and is refused outright by some browsers — which means
 * the theme preference, the one thing on this page that persists, is exactly
 * the thing you cannot trust when you preview it that way. Over http it behaves
 * the way it will on Pages.
 *
 * It also rebuilds. `site/index.html` is generated, and previewing a stale copy
 * of a generated file is how you end up reviewing last week's work and
 * approving it.
 */

import { spawnSync } from 'node:child_process';
import { createReadStream, watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
// 4318, because 4317 is the baseline harness and running both at once is a
// normal thing to want.
const PORT = Number(flag('port', 4318));
const WATCH = !args.includes('--once');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

/**
 * Rebuild by running the real build, as a child process.
 *
 * Importing `buildDocs()` directly would be faster and would also be a second
 * way to build the page — one that could drift from what CI runs. The whole
 * point of a preview is that it shows you what will ship.
 */
let building = false;
const build = () => {
  if (building) return true;
  building = true;
  const started = Date.now();
  const result = spawnSync(process.execPath, [join(HERE, 'build.mjs')], {
    cwd: REPO,
    encoding: 'utf8',
  });
  building = false;

  if (result.status !== 0) {
    console.error(`\n  ✗ build failed\n${result.stderr || result.stdout}`);
    return false;
  }
  const line = (result.stdout || '').trim().split('\n')[0] ?? '';
  console.log(`  ✓ ${line}  (${Date.now() - started} ms)`);
  return true;
};

console.log('\nNAVX · preview\n');
if (!build()) process.exit(1);

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const wanted = url.pathname === '/' ? '/index.html' : url.pathname;

  // Resolve, then confirm the result is still inside site/. Joining a decoded
  // path straight onto a root is the classic way to serve /etc/passwd.
  const file = resolve(HERE, `.${normalize(decodeURIComponent(wanted))}`);
  if (file !== HERE && !file.startsWith(HERE + sep)) {
    response.writeHead(403).end('outside site/');
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': info.size,
      // Never cache a preview. A 304 on the file you just rebuilt is a
      // twenty-minute debugging session about a bug you already fixed.
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${wanted}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n  http://localhost:${PORT}\n`);
  if (WATCH) console.log('  watching site/template.html, site/docs.mjs, site/build.mjs\n');
  console.log('  ctrl-c to stop\n');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is busy. Try: pnpm preview -- --port ${PORT + 1}\n`);
    process.exit(1);
  }
  throw error;
});

if (WATCH) {
  // Debounced: editors write a file in several syscalls and each one fires.
  let pending = null;
  const rebuild = (name) => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      console.log(`\n  ${name} changed`);
      build();
    }, 120);
  };

  for (const source of ['template.html', 'docs.mjs', 'build.mjs']) {
    watch(join(HERE, source), () => rebuild(`site/${source}`));
  }
}
