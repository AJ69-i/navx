/**
 * Static server for the baseline harness.
 *
 * Three mounts, deliberately separate so the legacy tree is reachable at runtime
 * without ever being copied into the repo:
 *
 *   /            → tests/harness/      the harness page
 *   /fixtures/   → tests/_fixtures/    extracted variant fragments + manifest
 *   /legacy/     → $NAVX_LEGACY_ROOT   legacy CSS, JS and images, read-only
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { REPO_ROOT, harnessPort, paths, resolveLegacyRoot } from './env.mjs';

let LEGACY_ROOT;
try {
  LEGACY_ROOT = resolveLegacyRoot();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const PORT = harnessPort();

const MOUNTS = [
  { prefix: '/fixtures/', root: paths.fixtures },
  // Stage 2: the new stack, served from the built packages so the harness
  // measures exactly what would ship rather than a copy that can drift.
  {
    prefix: '/navx/tokens.css',
    root: path.join(REPO_ROOT, '..', '..', 'packages', 'tokens', 'dist', 'tokens.css'),
    file: true,
  },
  {
    prefix: '/navx/navx.css',
    root: path.join(REPO_ROOT, '..', '..', 'packages', 'styles', 'dist', 'navx.css'),
    file: true,
  },
  {
    prefix: '/navx/skins/',
    root: path.join(REPO_ROOT, '..', '..', 'packages', 'tokens', 'dist', 'skins'),
  },
  // Stage 3: the built core, so the lifecycle harness exercises the module that
  // would actually be published rather than the TypeScript source.
  {
    prefix: '/navx/core.js',
    root: path.join(REPO_ROOT, '..', '..', 'packages', 'core', 'dist', 'index.js'),
    file: true,
  },
  { prefix: '/harness-tools/', root: path.join(REPO_ROOT, 'tools') },
  { prefix: '/legacy/', root: LEGACY_ROOT },
  { prefix: '/', root: paths.harness },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/harness.html';

  const mount = MOUNTS.find((m) => pathname.startsWith(m.prefix));
  if (!mount) {
    res.writeHead(404).end('not found');
    return;
  }

  // A `file: true` mount maps one exact URL to one exact file.
  const file = mount.file ? mount.root : path.join(mount.root, pathname.slice(mount.prefix.length));

  // Refuse traversal outside the mount root.
  if (!mount.file && !file.startsWith(mount.root + path.sep) && file !== mount.root) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${pathname}`);
  }
});

server.listen(PORT, () =>
  console.log(`harness on http://localhost:${PORT}  (legacy: ${LEGACY_ROOT})`),
);
