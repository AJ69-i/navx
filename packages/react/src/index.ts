/**
 * @navx/react — a React binding for @navx/core.
 *
 * There is no navigation logic in this file, and that is the measure of
 * whether Stage 3's boundary was drawn in the right place. Everything here is
 * plumbing: a `useSyncExternalStore` over the machine, and a ref callback that
 * ties `attach()` to the element's lifetime. If a bug in menu behaviour could
 * be fixed by editing this file, the boundary would be wrong.
 */

import { attach, createNav } from '@navx/core';
import type { AttachOptions, NavEvent, NavMachine, NavMachineConfig, NavState } from '@navx/core';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

export interface UseNavOptions extends AttachOptions, NavMachineConfig {
  /**
   * Bring your own machine — for a nav whose state is owned further up the
   * tree, or shared with something outside React. Omit it and one is created
   * and disposed with the component.
   */
  readonly machine?: NavMachine;
}

export interface UseNavResult {
  /** Put this on the element carrying `className="navx"`. */
  readonly ref: (element: HTMLElement | null) => void;
  /** The current state. Re-renders only when it actually changes. */
  readonly state: NavState;
  readonly send: (event: NavEvent) => void;
  readonly machine: NavMachine;
}

export function useNav(options: UseNavOptions = {}): UseNavResult {
  const { machine: provided, mode, multiBranch, ...attachOptions } = options;

  /**
   * `useState`'s lazy initialiser, not `useMemo`.
   *
   * React may discard a `useMemo` value at any time and recompute it; for a
   * cache that is fine, for the object holding the nav's identity it is not —
   * a second machine would silently orphan every subscriber. The state hook is
   * the documented way to own a value for the life of a component.
   */
  const owned = useRef<NavMachine | null>(null);
  if (!provided && owned.current === null) owned.current = createNav({ mode, multiBranch });
  const machine = provided ?? (owned.current as NavMachine);

  // Dispose only what this component created. A machine passed in belongs to
  // the caller, and disposing it would drop subscribers we never registered.
  useEffect(() => {
    const created = owned.current;
    return () => {
      if (created && !provided) created.dispose();
    };
  }, [provided]);

  /**
   * `getSnapshot` must return a value that is `Object.is`-stable between
   * renders or React loops forever re-rendering. The machine already
   * guarantees that: `reduce` returns the *same object* when a transition
   * changes nothing, so identity only moves when the state truly does. That
   * property was written for this hook.
   */
  const subscribe = useCallback((onChange: () => void) => machine.subscribe(onChange), [machine]);
  const getSnapshot = useCallback(() => machine.getState(), [machine]);

  const state = useSyncExternalStore(
    subscribe,
    getSnapshot,
    // Server snapshot: the same immutable object, so an SSR render and the
    // first client render agree and hydration does not warn.
    getSnapshot,
  );

  /**
   * A ref callback rather than `useEffect` over a `useRef`.
   *
   * The element is attached the moment React gives it to us and detached the
   * moment React takes it away — including when a key changes and the node is
   * swapped without unmounting the component, which an effect keyed on `[]`
   * would miss entirely.
   *
   * The cleanup is stored rather than returned, because returning it only
   * works from React 19 onward and this adapter supports 18.
   */
  const detachRef = useRef<(() => void) | null>(null);
  const optionsRef = useRef(attachOptions);
  optionsRef.current = attachOptions;

  const ref = useCallback(
    (element: HTMLElement | null) => {
      detachRef.current?.();
      detachRef.current = null;
      if (element) detachRef.current = attach(element, machine, optionsRef.current);
    },
    [machine],
  );

  // Strict Mode mounts, unmounts and remounts; the ref callback handles that
  // symmetrically, and this covers the final unmount.
  useEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
    },
    [],
  );

  const send = useCallback((event: NavEvent) => void machine.send(event), [machine]);

  return useMemo(() => ({ ref, state, send, machine }), [ref, state, send, machine]);
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
