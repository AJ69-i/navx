/**
 * @navx/svelte — a Svelte binding for @navx/core.
 *
 * Two exports, both of them Svelte's own primitives rather than a wrapper
 * invented for this library:
 *
 *   navStore(options)  a readable store, so `$nav` works and Svelte handles
 *                      the subscription lifecycle.
 *   navx              an action, so `use:navx` ties attach/detach to the
 *                      element's lifetime with no component code.
 *
 * The store contract is deliberately the plain one — `subscribe` returning an
 * unsubscribe function — which Svelte 3, 4 and 5 all consume natively. Runes
 * would pin this package to Svelte 5 for no gain, since the machine is already
 * the source of truth and `$state` would only mirror it.
 */

import { attach, createNav } from '@navx/core';
import type { AttachOptions, NavEvent, NavMachine, NavMachineConfig, NavState } from '@navx/core';

export interface NavStore {
  /** Svelte's store contract: `$nav` reads the current state. */
  subscribe(run: (value: NavState) => void): () => void;
  send(event: NavEvent): void;
  readonly machine: NavMachine;
  /** Drops subscribers. Only needed for a store created outside a component. */
  destroy(): void;
}

export function navStore(options: NavMachineConfig & { machine?: NavMachine } = {}): NavStore {
  const machine =
    options.machine ?? createNav({ mode: options.mode, multiBranch: options.multiBranch });

  return {
    subscribe(run) {
      // Svelte's contract requires calling the subscriber immediately with the
      // current value, before any change arrives.
      run(machine.getState());
      return machine.subscribe((next) => run(next));
    },
    send: (event) => void machine.send(event),
    machine,
    destroy: () => machine.dispose(),
  };
}

export interface NavActionOptions extends AttachOptions {
  /** The store or machine to bind. Omit to create one for this element. */
  readonly nav?: NavStore | NavMachine;
}

/**
 * `use:navx` — the DOM binding as a Svelte action.
 *
 * An action is exactly the right shape: Svelte calls it with the element once
 * it is in the document and calls `destroy()` when it leaves, which is the
 * same lifetime `attach()`/`detach()` wants. `update` re-attaches when the
 * options change, so toggling `trigger` at runtime works without a remount.
 */
export function navx(node: HTMLElement, options: NavActionOptions = {}) {
  const resolve = (o: NavActionOptions) => {
    const nav = o.nav;
    if (!nav) return { machine: createNav(), owned: true };
    return { machine: 'machine' in nav ? nav.machine : nav, owned: false };
  };

  let { machine, owned } = resolve(options);
  let detach = attach(node, machine, options);

  return {
    update(next: NavActionOptions) {
      detach();
      if (owned) machine.dispose();
      ({ machine, owned } = resolve(next));
      detach = attach(node, machine, next);
    },
    destroy() {
      detach();
      if (owned) machine.dispose();
    },
  };
}

export { createNav, attach, isOpen } from '@navx/core';
export type {
  AttachOptions,
  NavEvent,
  NavListener,
  NavMachine,
  NavMachineConfig,
  NavMode,
  NavState,
} from '@navx/core';
