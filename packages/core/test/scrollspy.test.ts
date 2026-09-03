// @vitest-environment jsdom
/**
 * Scroll-spy.
 *
 * The environment pragma above is per-file on purpose. The rest of this
 * package's tests are pure — a state machine and a source-level lint — and run
 * in Node in milliseconds; loading jsdom for all of them to serve one file
 * would tax every future test with a dependency it does not use.
 *
 * jsdom has no `IntersectionObserver` and no layout engine, which turns out to
 * be convenient: the missing observer exercises the fallback path for free, and
 * stubbing `getBoundingClientRect` lets a test place a section anywhere on an
 * imaginary page and assert what the module concludes. What is *not* tested
 * here is the browser's own scrolling — that is the point of pushing it onto
 * the browser.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attach } from '../src/attach.js';
import { createNav } from '../src/machine.js';
import { spy } from '../src/scrollspy.js';

/** A nav whose links point at three sections, plus a placeholder `#`. */
function page() {
  document.body.innerHTML = `
    <nav class="navx" id="nav">
      <div class="navx-header">
        <button class="navx-toggler" type="button" aria-expanded="false"></button>
      </div>
      <div class="navx-panel">
        <ul class="navx-menu">
          <li class="navx-item" data-navx-current=""><a class="navx-link" href="#">Home</a></li>
          <li class="navx-item"><a class="navx-link" href="#one">One</a></li>
          <li class="navx-item"><a class="navx-link" href="#two">Two</a></li>
          <li class="navx-item"><a class="navx-link" href="#missing">Missing</a></li>
        </ul>
      </div>
    </nav>
    <section id="one"></section>
    <section id="two"></section>
  `;
  return document.getElementById('nav') as HTMLElement;
}

/** Place a section on an imaginary page, in viewport coordinates. */
function place(id: string, top: number, height: number) {
  const el = document.getElementById(id) as HTMLElement;
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('spy', () => {
  it('reports the section straddling the probe line', () => {
    const root = page();
    place('one', -10, 100); // covers the viewport top
    place('two', 90, 100);
    const nav = createNav();

    const stop = spy(root, nav);
    expect(nav.getState().activeId).toBe('one');

    place('one', -200, 100);
    place('two', -100, 300); // now covers the top
    window.dispatchEvent(new Event('scroll'));
    expect(nav.getState().activeId).toBe('two');

    stop();
  });

  it('honours offset by moving the probe line down', () => {
    const root = page();
    // With no offset the probe is at 0 and `one` wins; at 80 it is `two`.
    place('one', 0, 60);
    place('two', 60, 200);
    const nav = createNav();

    const stop = spy(root, nav, { offset: 80 });
    expect(nav.getState().activeId).toBe('two');
    stop();
  });

  it('sets scroll-margin on targets and restores it on teardown', () => {
    const root = page();
    place('one', 0, 100);
    place('two', 100, 100);
    const one = document.getElementById('one') as HTMLElement;
    one.style.setProperty('scroll-margin-block-start', '5px');

    const stop = spy(root, createNav(), { offset: 64 });
    expect(one.style.getPropertyValue('scroll-margin-block-start')).toBe('64px');
    expect(document.documentElement.style.getPropertyValue('scroll-behavior')).toBe('smooth');

    stop();
    // Exactly what was there before — not "removed", which would be a
    // different wrong answer for an element that already had the property.
    expect(one.style.getPropertyValue('scroll-margin-block-start')).toBe('5px');
    expect(document.documentElement.style.getPropertyValue('scroll-behavior')).toBe('');
  });

  it('ignores `#` placeholders and unresolvable fragments', () => {
    const root = page();
    place('one', 0, 100);
    place('two', 100, 100);
    const nav = createNav();
    const stop = spy(root, nav);

    // `#` and `#missing` contribute no targets, so nothing throws and the two
    // real sections still work. The catalogue is full of `href="#"`.
    expect(nav.getState().activeId).toBe('one');
    stop();
  });

  it('is inert when no link resolves to a section', () => {
    document.body.innerHTML = `
      <nav class="navx" id="nav"><a class="navx-link" href="#">Home</a></nav>`;
    const root = document.getElementById('nav') as HTMLElement;
    const nav = createNav();
    const stop = spy(root, nav);
    expect(nav.getState().activeId).toBeNull();
    expect(() => stop()).not.toThrow();
  });

  it('clears the machine on teardown and is idempotent', () => {
    const root = page();
    place('one', 0, 100);
    place('two', 100, 100);
    const nav = createNav();
    const stop = spy(root, nav);
    expect(nav.getState().activeId).toBe('one');

    stop();
    expect(nav.getState().activeId).toBeNull();
    expect(() => stop()).not.toThrow();
  });

  it('removes its listeners', () => {
    const root = page();
    place('one', 0, 100);
    place('two', 100, 100);
    const add = vi.spyOn(window, 'addEventListener');
    const nav = createNav();

    const stop = spy(root, nav);
    // The fallback path registers through the AbortController, which is what
    // the lifecycle-discipline gate enforces at the source level.
    for (const call of add.mock.calls) {
      const options = call[2] as AddEventListenerOptions | undefined;
      expect(options?.signal, `${String(call[0])} listener has no signal`).toBeDefined();
    }
    stop();

    // After teardown a scroll must not move the machine.
    window.dispatchEvent(new Event('scroll'));
    expect(nav.getState().activeId).toBeNull();
    add.mockRestore();
  });
});

describe('attach renders activeId', () => {
  it('marks the item whose link targets the active section', () => {
    const root = page();
    place('one', 0, 100);
    place('two', 100, 100);
    const nav = createNav();
    const detach = attach(root, nav);
    const stop = spy(root, nav);

    const items = [...root.querySelectorAll('.navx-item')];
    expect(items[1]?.hasAttribute('data-navx-current')).toBe(true);

    place('one', -200, 100);
    place('two', -50, 300);
    window.dispatchEvent(new Event('scroll'));
    expect(items[1]?.hasAttribute('data-navx-current')).toBe(false);
    expect(items[2]?.hasAttribute('data-navx-current')).toBe(true);

    stop();
    detach();
  });

  it("never touches a preset's own current marker when nothing spies", () => {
    const root = page();
    const nav = createNav();
    const detach = attach(root, nav);

    // `Home` is marked current in the markup and has `href="#"`. A nav with no
    // scroll-spy must leave it exactly alone — clearing it was the bug the
    // `spyEngaged` latch exists to prevent.
    const home = root.querySelector('.navx-item') as HTMLElement;
    expect(home.hasAttribute('data-navx-current')).toBe(true);

    nav.send({ type: 'PANEL_TOGGLE' });
    expect(home.hasAttribute('data-navx-current')).toBe(true);
    detach();
  });

  it('restores the markup on detach', () => {
    const root = page();
    place('one', 0, 100);
    place('two', 100, 100);
    const nav = createNav();
    const detach = attach(root, nav);
    const stop = spy(root, nav);

    const one = root.querySelectorAll('.navx-item')[1] as HTMLElement;
    expect(one.hasAttribute('data-navx-current')).toBe(true);

    stop();
    detach();
    expect(one.hasAttribute('data-navx-current')).toBe(false);
  });
});
