/**
 * Source-level gates for the two properties that make teardown provable.
 *
 * The leak test in `tools/baseline` proves the current code is clean; these
 * prove the *next* commit cannot quietly stop being clean, which is the failure
 * mode that produced legacy's six orphaned listeners. `turnOffEvents()` was
 * correct on the day it was written and then five more listeners were added
 * around it.
 *
 * Reading the source is crude, but it catches exactly the mistake being
 * guarded against — a listener registered outside the AbortController — at the
 * moment it is written rather than after someone thinks to run a browser.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * Comments are stripped before any of this runs, replaced line-for-line so
 * reported line numbers stay true.
 *
 * Without it the gates read their own documentation: `machine.ts` explains
 * that it "does not know that a document exists" and was failed for the word
 * `document` in that sentence. A gate that cannot tell prose from code will be
 * silenced rather than fixed.
 */
const stripComments = (code: string) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (line) => ' '.repeat(line.length));

const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ name: f, code: stripComments(readFileSync(path.join(SRC, f), 'utf8')) }));

describe('teardown discipline', () => {
  it('every addEventListener is registered with an AbortSignal', () => {
    const offenders: string[] = [];
    for (const { name, code } of files) {
      const lines = code.split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('addEventListener')) return;
        // The `on()` helper is the sanctioned wrapper; it passes the signal.
        // Anything else must show one within the same call.
        const window = lines.slice(i, i + 4).join(' ');
        if (/signal/.test(window)) return;
        offenders.push(`${name}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders, `listeners with no signal:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('nothing is written onto the host element or a prototype', () => {
    const offenders: string[] = [];
    for (const { name, code } of files) {
      // Legacy did `Element.prototype.on = …` and `nav.showSubmenu = …`.
      // Neither shape may reappear: the first changes every page that imports
      // the library, the second makes the element and the instance hold each
      // other alive.
      for (const pattern of [/\.prototype\s*\./g, /\b(root|el|element)\.[a-zA-Z$_]+\s*=[^=]/g]) {
        for (const match of code.matchAll(pattern)) {
          const line = code.slice(0, match.index).split('\n').length;
          // Assigning to a DOM *property* the platform defines is fine —
          // `el.className`, `style`, `textContent`. Adding a new one is not.
          if (
            /\.(className|textContent|innerHTML|id|value|checked|style|tabIndex)\s*=/.test(match[0])
          ) {
            continue;
          }
          offenders.push(`${name}:${line} ${match[0].trim()}`);
        }
      }
    }
    expect(offenders, `expando or prototype writes:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the machine never mentions the DOM, so it stays Node-testable and SSR-safe', () => {
    const machine = files.find((f) => f.name === 'machine.ts');
    expect(machine).toBeDefined();
    const banned = ['document', 'window', 'HTMLElement', 'getComputedStyle', 'addEventListener'];
    const found = banned.filter((token) => new RegExp(`\\b${token}\\b`).test(machine?.code ?? ''));
    expect(found, `machine.ts references the DOM: ${found.join(', ')}`).toEqual([]);
  });
});
