/**
 * The Vue adapter's job is reactivity integration and lifetime, so that is
 * what these test. `effectScope` stands in for a component instance: it is the
 * primitive `setup()` runs inside, and `scope.stop()` fires `onScopeDispose`
 * exactly as unmounting would — without needing a renderer, an SFC compiler or
 * a `mount()` helper in the dependency tree.
 *
 * jsdom has no layout, so `attach()` falls back to measuring the element (0px,
 * hence panel mode). Every behaviour here is mode-independent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { createNav, useNav } from '../src/index.js';

function markup(): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'navx';
  nav.innerHTML = `
    <div class="navx-toggler"></div>
    <div class="navx-panel">
      <ul class="navx-menu">
        <li class="navx-item">
          <div class="navx-link">
            <a href="#products">Products</a>
            <button class="navx-chevron" type="button" aria-label="Products submenu"></button>
          </div>
          <ul class="navx-submenu">
            <li class="navx-submenu-item"><a href="#laptops">Laptops</a></li>
          </ul>
        </li>
      </ul>
    </div>`;
  document.body.append(nav);
  return nav;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useNav', () => {
  it('tracks machine state reactively', async () => {
    const machine = createNav();
    const scope = effectScope();
    const { state } = scope.run(() => useNav({ machine }))!;

    expect(state.value.panelOpen).toBe(false);
    machine.send({ type: 'PANEL_OPEN' });
    await nextTick();
    expect(state.value.panelOpen).toBe(true);

    scope.stop();
  });

  it('exposes the snapshot itself, not a reactive proxy of it', () => {
    const machine = createNav();
    const scope = effectScope();
    const { state } = scope.run(() => useNav({ machine }))!;

    // The whole reason for `shallowRef`. With `ref`, Vue would deep-proxy the
    // snapshot and this identity check would fail — and with it every identity
    // guarantee the machine makes, including the "same object when nothing
    // changed" contract the adapters rely on to avoid redundant work.
    expect(state.value).toBe(machine.getState());

    machine.send({ type: 'SUBMENU_OPEN', path: ['1.0'] });
    expect(state.value).toBe(machine.getState());
    expect(state.value.openPath).toEqual(['1.0']);

    scope.stop();
  });

  it('unsubscribes when the scope stops', async () => {
    const machine = createNav();
    const scope = effectScope();
    const { state } = scope.run(() => useNav({ machine }))!;

    scope.stop();
    machine.send({ type: 'PANEL_OPEN' });
    await nextTick();

    // Stale, because the subscription is gone — not because the machine is.
    expect(state.value.panelOpen).toBe(false);
    expect(machine.getState().panelOpen).toBe(true);
  });

  it('leaves a provided machine usable after disposal', () => {
    const machine = createNav();
    const scope = effectScope();
    scope.run(() => useNav({ machine }));
    scope.stop();

    const seen = vi.fn();
    machine.subscribe(seen);
    machine.send({ type: 'PANEL_OPEN' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('disposes a machine it created itself', () => {
    const scope = effectScope();
    const { machine } = scope.run(() => useNav())!;

    const seen = vi.fn();
    machine.subscribe(seen);
    scope.stop();

    // dispose() dropped every subscriber, including the one added above.
    machine.send({ type: 'PANEL_OPEN' });
    expect(seen).not.toHaveBeenCalled();
  });

  it('attaches when navRef is set and detaches when the scope stops', async () => {
    const nav = markup();
    const scope = effectScope();
    const { navRef } = scope.run(() => useNav())!;

    const toggler = nav.querySelector<HTMLElement>('.navx-toggler')!;
    expect(toggler.getAttribute('aria-expanded')).toBeNull();

    navRef.value = nav;
    await nextTick();
    // attach() normalises the toggler into a button and publishes its state.
    expect(toggler.getAttribute('aria-expanded')).toBe('false');
    expect(toggler.getAttribute('role')).toBe('button');

    scope.stop();
    // detach() restores exactly what it found — no leftover ARIA.
    expect(toggler.getAttribute('aria-expanded')).toBeNull();
    expect(toggler.getAttribute('role')).toBeNull();
  });

  it('rebinds when navRef points at a different element', async () => {
    const first = markup();
    const second = markup();
    const scope = effectScope();
    const { navRef } = scope.run(() => useNav())!;

    navRef.value = first;
    await nextTick();
    navRef.value = second;
    await nextTick();

    const togglerOf = (root: HTMLElement) =>
      root.querySelector<HTMLElement>('.navx-toggler')!.getAttribute('aria-expanded');

    // The watcher detaches the old element before attaching the new one, so a
    // swapped host does not leave the previous node bound.
    expect(togglerOf(first)).toBeNull();
    expect(togglerOf(second)).toBe('false');

    scope.stop();
  });
});
