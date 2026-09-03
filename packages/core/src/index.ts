/**
 * @navx/core — the headless navigation core.
 *
 * Two layers, and the boundary between them is the point:
 *
 *   createNav()  a pure state machine. No DOM, no globals, SSR-safe, and
 *                testable in Node with no jsdom.
 *   attach()     the only module that touches a document. One delegated
 *                listener per event type, one AbortController, and a teardown
 *                that returns the DOM to exactly what it was.
 *
 * Framework adapters take the machine and render it themselves; vanilla and
 * custom-element consumers take `attach()`. Neither reimplements the logic.
 *
 * @example
 * ```ts
 * import { createNav, attach } from '@navx/core';
 *
 * const nav = createNav();
 * const detach = attach(document.querySelector('.navx')!, nav);
 *
 * nav.subscribe((state) => console.log(state.openPath));
 * detach(); // every listener, observer and timer gone; DOM restored
 * ```
 */

export { createNav, isOpen, reduce } from './machine.js';
export type {
  NavEvent,
  NavListener,
  NavMachine,
  NavMachineConfig,
  NavMode,
  NavState,
} from './machine.js';

export { attach } from './attach.js';
export type { AttachOptions } from './attach.js';
