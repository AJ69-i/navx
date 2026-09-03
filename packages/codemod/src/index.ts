/**
 * The library entry: the mapping table and the transform, and nothing that
 * touches a filesystem.
 *
 * `cli.ts` is a separate entry point on purpose. Re-exporting it from here
 * pulled `node:fs` into the main entry, which makes the package unimportable
 * in a browser or a worker — and the baseline harness imports exactly this
 * build into a page, so the constraint has a test rather than a convention
 * behind it.
 */
export * from './map.js';
export * from './transform.js';
