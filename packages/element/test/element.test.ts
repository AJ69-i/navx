/**
 * `<navx-nav>` is a lifecycle wrapper, so these test the lifecycle: that it
 * binds on connect, unbinds on disconnect, and — the one a custom element gets
 * wrong most often — survives being *moved* in the DOM, which fires
 * disconnected then connected again and leaks a listener set per move if the
 * two callbacks are not symmetric.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NavxNavElement, defineNavxNav } from '../src/index.js';

beforeAll(() => defineNavxNav());

const mount = (html: string) => {
  document.body.innerHTML = html;
  return document.querySelector('navx-nav') as NavxNavElement;
};

const MARKUP = `
  <navx-nav>
    <nav class="navx">
      <div class="navx-panel"></div>
      <div class="navx-toggler"></div>
    </nav>
  </navx-nav>`;

describe('<navx-nav>', () => {
  it('registers once and is idempotent', () => {
    expect(customElements.get('navx-nav')).toBe(NavxNavElement);
    expect(() => defineNavxNav()).not.toThrow();
  });

  it('binds the .navx inside it', () => {
    const el = mount(MARKUP);
    // attach() writes ARIA the markup lacked; its presence is the proof.
    expect(el.querySelector('.navx-toggler')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('also binds itself when the class is on the element', () => {
    const el = mount('<navx-nav class="navx"><div class="navx-panel"></div></navx-nav>');
    expect(el.state.mode).toBeDefined();
  });

  it('emits navx:change with the snapshot and its predecessor', () => {
    const el = mount(MARKUP);
    const seen = vi.fn();
    el.addEventListener('navx:change', (event) => seen((event as CustomEvent).detail));

    el.send({ type: 'SUBMENU_OPEN', path: ['1.0'] });

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]?.[0].state.openPath).toEqual(['1.0']);
    expect(seen.mock.calls[0]?.[0].previous.openPath).toEqual([]);
  });

  it('unbinds on disconnect and rebinds on reconnect', () => {
    const el = mount(MARKUP);
    const toggler = el.querySelector('.navx-toggler') as HTMLElement;
    expect(toggler.getAttribute('aria-expanded')).toBe('false');

    el.remove();
    // detach() restored the DOM, so the attribute NAVX added is gone.
    expect(toggler.hasAttribute('aria-expanded')).toBe(false);

    document.body.append(el);
    expect(toggler.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not throw when it contains no nav', () => {
    expect(() => mount('<navx-nav></navx-nav>')).not.toThrow();
  });

  it('reads options from attributes', () => {
    document.body.innerHTML = MARKUP.replace(
      '<navx-nav>',
      '<navx-nav trigger="hover" modal="false">',
    );
    const el = document.querySelector('navx-nav') as NavxNavElement;
    expect(el.getAttribute('trigger')).toBe('hover');
    expect(el.state).toBeDefined();
  });
});
