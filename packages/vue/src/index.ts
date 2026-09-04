/**
 * @navx/vue — a Vue binding for @navx/core.
 *
 * Same shape as the React adapter and the same amount of navigation logic:
 * none. `shallowRef` plus `onScopeDispose` is the whole integration, because
 * the machine already emits immutable snapshots and already owns its teardown.
 */

import { attach, createNav } from '@navx/core';
import type { AttachOptions, NavEvent, NavMachine, NavMachineConfig, NavState } from '@navx/core';
import { type Ref, type ShallowRef, onScopeDispose, shallowReadonly, shallowRef, watch } from 'vue';

export interface UseNavOptions extends AttachOptions, NavMachineConfig {
  /** Bring your own machine to share state beyond this component. */
  readonly machine?: NavMachine;
}

export interface UseNavResult {
  /** Bind to the element carrying `class="navx"` with `ref="navRef"`. */
  readonly navRef: ShallowRef<HTMLElement | null>;
  readonly state: Readonly<Ref<NavState>>;
  readonly send: (event: NavEvent) => void;
  readonly machine: NavMachine;
}

export function useNav(options: UseNavOptions = {}): UseNavResult {
  const { machine: provided, mode, multiBranch, ...attachOptions } = options;
  const machine = provided ?? createNav({ mode, multiBranch });

  /**
   * `shallowRef`, not `ref`.
   *
   * `ref` would walk the state object and make every field reactive, which
   * costs a deep traversal on each transition and — worse — would hand
   * consumers a *proxy* of the snapshot rather than the snapshot itself, so
   * the identity comparisons the machine guarantees would stop holding.
   * Snapshots are already immutable; replacing the whole ref is both correct
   * and cheaper.
   */
  const state = shallowRef<NavState>(machine.getState());
  const unsubscribe = machine.subscribe((next) => {
    state.value = next;
  });

  const navRef = shallowRef<HTMLElement | null>(null);
  let detach: (() => void) | null = null;

  /**
   * `flush: 'post'` so the element exists in the DOM when `attach()` reads it.
   * The default pre-flush would run before Vue has patched, and `attach()`
   * measures layout to decide bar or panel mode.
   */
  const stop = watch(
    navRef,
    (element) => {
      detach?.();
      detach = null;
      if (element) detach = attach(element, machine, attachOptions);
    },
    { flush: 'post' },
  );

  onScopeDispose(() => {
    stop();
    detach?.();
    detach = null;
    unsubscribe();
    // Only dispose a machine this composable created; a provided one belongs
    // to the caller and may still have subscribers elsewhere.
    if (!provided) machine.dispose();
  });

  return {
    navRef,
    /**
     * `shallowReadonly`, not `readonly`.
     *
     * `readonly()` is deep: reading `.value` through it returns
     * `readonly(snapshot)` — a proxy — and every identity guarantee above is
     * lost at the last step. (Vue skips frozen objects, so this is invisible
     * until a snapshot is not frozen, which is exactly our case.) The shallow
     * variant blocks assignment to `.value` and hands back the snapshot
     * itself, which is the contract `packages/vue/test/use-nav.test.ts`
     * asserts.
     */
    state: shallowReadonly(state) as Readonly<Ref<NavState>>,
    send: (event: NavEvent) => void machine.send(event),
    machine,
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
