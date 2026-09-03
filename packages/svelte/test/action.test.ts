/**
 * `use:navx` is the half of this adapter that can leak, so it gets the
 * lifecycle tests. Svelte's action contract is a plain object — `update(param)`
 * and `destroy()` — which means it can be driven directly here, exactly as the
 * compiler would drive it, with no renderer and no `.svelte` file to compile.
 *
 * jsdom has no layout, so `attach()` falls back to measuring the element (0px,
 * hence panel mode). Every behaviour here is mode-independent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNav, navStore, navx } from '../src/index.js';

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

const toggler = (root: HTMLElement) => root.querySelector<HTMLElement>('.navx-toggler')!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('navx action', () => {
  it('attaches on creation and restores the DOM on destroy', () => {
    const nav = markup();
    expect(toggler(nav).getAttribute('aria-expanded')).toBeNull();

    const action = navx(nav);
    // attach() normalises the toggler into a real button and publishes state.
    expect(toggler(nav).getAttribute('aria-expanded')).toBe('false');
    expect(toggler(nav).getAttribute('role')).toBe('button');

    action.destroy();
    // detach() replays what it recorded — no leftover ARIA on the page.
    expect(toggler(nav).getAttribute('aria-expanded')).toBeNull();
    expect(toggler(nav).getAttribute('role')).toBeNull();
  });

  it('drives the DOM from the machine it was given', () => {
    const nav = markup();
    const machine = createNav();
    const action = navx(nav, { nav: machine });

    machine.send({ type: 'PANEL_OPEN' });
    expect(toggler(nav).getAttribute('aria-expanded')).toBe('true');

    action.destroy();
  });

  it('accepts a store as well as a machine', () => {
    const nav = markup();
    const store = navStore();
    const action = navx(nav, { nav: store });

    store.send({ type: 'PANEL_OPEN' });
    expect(toggler(nav).getAttribute('aria-expanded')).toBe('true');

    action.destroy();
    store.destroy();
  });

  it('rebinds on update without doubling up', () => {
    const nav = markup();
    const machine = createNav();
    const action = navx(nav, { nav: machine, trigger: 'click' });

    action.update({ nav: machine, trigger: 'hover' });
    expect(toggler(nav).getAttribute('aria-expanded')).toBe('false');

    // One detach, one attach: the machine still has exactly one binding, so a
    // single event produces a single state — not a toggle fighting a toggle.
    machine.send({ type: 'PANEL_TOGGLE' });
    expect(machine.getState().panelOpen).toBe(true);
    expect(toggler(nav).getAttribute('aria-expanded')).toBe('true');

    action.destroy();
    expect(toggler(nav).getAttribute('aria-expanded')).toBeNull();
  });

  it('leaves a provided machine alive after destroy', () => {
    const nav = markup();
    const machine = createNav();
    navx(nav, { nav: machine }).destroy();

    const seen = vi.fn();
    machine.subscribe(seen);
    machine.send({ type: 'PANEL_OPEN' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('disposes a machine it created itself', () => {
    const nav = markup();
    const action = navx(nav);

    // Reachable only through the DOM binding, so the machine it owns is
    // observed the way a consumer would: through the attributes it writes.
    action.destroy();
    expect(toggler(nav).getAttribute('aria-expanded')).toBeNull();
    expect(nav.querySelector('[data-navx-state]')).toBeNull();
  });

  it('hands its own machine over when update() supplies one', () => {
    const nav = markup();
    const action = navx(nav);
    const machine = createNav();

    action.update({ nav: machine });
    machine.send({ type: 'PANEL_OPEN' });
    expect(toggler(nav).getAttribute('aria-expanded')).toBe('true');

    // The previously-owned machine was disposed by update(); this one is the
    // caller's, so destroy() must leave it usable.
    action.destroy();
    const seen = vi.fn();
    machine.subscribe(seen);
    machine.send({ type: 'PANEL_CLOSE' });
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
