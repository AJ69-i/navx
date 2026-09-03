/**
 * The Svelte adapter's job is to speak Svelte's contracts exactly, so these
 * assert the contract rather than the behaviour: a store must call its
 * subscriber immediately with the current value, and must hand back a working
 * unsubscribe. Get either wrong and `$nav` is silently empty on first render.
 */

import { describe, expect, it, vi } from 'vitest';
import { createNav, navStore } from '../src/index.js';

describe('navStore', () => {
  it('calls the subscriber immediately with the current state', () => {
    const seen = vi.fn();
    navStore({ mode: 'bar' }).subscribe(seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0]).toMatchObject({ mode: 'bar', panelOpen: false });
  });

  it('pushes each change, and stops after unsubscribe', () => {
    const store = navStore({ mode: 'bar' });
    const seen = vi.fn();
    const off = store.subscribe(seen);

    store.send({ type: 'SUBMENU_OPEN', path: ['1.0'] });
    expect(seen).toHaveBeenCalledTimes(2); // the initial call, then the change

    off();
    store.send({ type: 'CLOSE_ALL' });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('shares a provided machine rather than creating its own', () => {
    const machine = createNav({ mode: 'bar' });
    const store = navStore({ machine });
    const seen = vi.fn();
    store.subscribe(seen);

    // Driven from outside the store entirely — the point of accepting one.
    machine.send({ type: 'SUBMENU_OPEN', path: ['2.1'] });
    expect(seen.mock.calls.at(-1)?.[0].openPath).toEqual(['2.1']);
  });

  it('supports several independent subscribers', () => {
    const store = navStore({ mode: 'bar' });
    const a = vi.fn();
    const b = vi.fn();
    const offA = store.subscribe(a);
    store.subscribe(b);

    offA();
    store.send({ type: 'PANEL_OPEN' }); // no-op in bar mode
    store.send({ type: 'SUBMENU_OPEN', path: ['1.0'] });

    expect(a).toHaveBeenCalledTimes(1); // initial only
    expect(b).toHaveBeenCalledTimes(2);
  });
});
