/**
 * The machine is pure, so its tests are too — no DOM, no jsdom, no browser.
 *
 * These assert the invariants the DOM layer is then free to assume, which is
 * the point of having a boundary: `attach()` never has to ask "could two
 * sibling menus both be open?", because that state is unrepresentable.
 */

import { describe, expect, it, vi } from 'vitest';
import { createNav, isOpen, reduce } from '../src/machine.js';
import type { NavState } from '../src/machine.js';

/*
 * `expanded` is derived from `openPath` unless a test states it, which keeps
 * every existing case reading the way it always did: in single-branch mode the
 * two are the same fact expressed twice, and the derivation is exactly the
 * invariant the reducer maintains.
 */
const state = (over: Partial<NavState> = {}): NavState => {
  const openPath = over.openPath ?? [];
  return {
    mode: 'panel',
    panelOpen: false,
    activeId: null,
    multiBranch: false,
    openPath,
    expanded: openPath.map((_, i) => openPath.slice(0, i + 1).join('\u0000')),
    ...over,
  };
};

describe('submenu paths', () => {
  it('opening a submenu records the whole chain', () => {
    const next = reduce(state({ mode: 'bar' }), {
      type: 'SUBMENU_OPEN',
      path: ['products', 'laptops'],
    });
    expect(next.openPath).toEqual(['products', 'laptops']);
  });

  it('opening a sibling closes the previous one and everything under it', () => {
    let s = state({ mode: 'bar', openPath: ['products', 'laptops'] });
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['services'] });
    expect(s.openPath).toEqual(['services']);
  });

  it('two sibling menus cannot both be open — the state cannot express it', () => {
    let s = state({ mode: 'bar' });
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['a'] });
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['b'] });
    expect(s.openPath).toEqual(['b']);
  });

  it('toggling the innermost open menu closes it but leaves its parent open', () => {
    let s = state({ mode: 'bar', openPath: ['products', 'laptops'] });
    s = reduce(s, { type: 'SUBMENU_TOGGLE', path: ['products', 'laptops'] });
    expect(s.openPath).toEqual(['products']);
  });

  /*
   * The case the suite was missing, and the reason it shipped broken: every
   * existing toggle test either matched the open chain exactly or was fully
   * closed. Toggling an *ancestor* of the open chain was never exercised, and
   * that is precisely where exact-equality fell through to the assignment
   * branch and closed the child instead of the parent.
   */
  it('toggling an open ancestor closes the ancestor, not its child', () => {
    let s = state({ mode: 'panel', openPath: ['lines', 'central'] });
    s = reduce(s, { type: 'SUBMENU_TOGGLE', path: ['lines'] });
    expect(s.openPath).toEqual([]);
  });

  it('toggling a mid-chain menu closes it and everything under it', () => {
    let s = state({ mode: 'bar', openPath: ['a', 'b', 'c', 'd'] });
    s = reduce(s, { type: 'SUBMENU_TOGGLE', path: ['a', 'b'] });
    expect(s.openPath).toEqual(['a']);
  });

  it('toggling a sibling of the open chain switches branches', () => {
    const s = reduce(state({ mode: 'bar', openPath: ['lines', 'central'] }), {
      type: 'SUBMENU_TOGGLE',
      path: ['stations'],
    });
    expect(s.openPath).toEqual(['stations']);
  });

  it('toggling a closed menu opens it', () => {
    const s = reduce(state({ mode: 'bar', openPath: ['products'] }), {
      type: 'SUBMENU_TOGGLE',
      path: ['products', 'laptops'],
    });
    expect(s.openPath).toEqual(['products', 'laptops']);
  });

  it('Escape closes one level at a time', () => {
    let s = state({ mode: 'bar', openPath: ['a', 'b', 'c'] });
    s = reduce(s, { type: 'SUBMENU_CLOSE_INNERMOST' });
    expect(s.openPath).toEqual(['a', 'b']);
    s = reduce(s, { type: 'SUBMENU_CLOSE_INNERMOST' });
    expect(s.openPath).toEqual(['a']);
    s = reduce(s, { type: 'SUBMENU_CLOSE_INNERMOST' });
    expect(s.openPath).toEqual([]);
  });

  it('Escape on a closed nav is a no-op that does not allocate', () => {
    const s = state({ mode: 'bar' });
    expect(reduce(s, { type: 'SUBMENU_CLOSE_INNERMOST' })).toBe(s);
  });

  it('an empty path is ignored rather than clearing the open chain', () => {
    const s = state({ mode: 'bar', openPath: ['a'] });
    expect(reduce(s, { type: 'SUBMENU_OPEN', path: [] })).toBe(s);
    expect(reduce(s, { type: 'SUBMENU_TOGGLE', path: [] })).toBe(s);
  });
});

describe('the drawer', () => {
  it('opens and closes in panel mode', () => {
    let s = reduce(state(), { type: 'PANEL_OPEN' });
    expect(s.panelOpen).toBe(true);
    s = reduce(s, { type: 'PANEL_CLOSE' });
    expect(s.panelOpen).toBe(false);
  });

  it('cannot open in bar mode, where no drawer exists', () => {
    const s = state({ mode: 'bar' });
    expect(reduce(s, { type: 'PANEL_OPEN' })).toBe(s);
    expect(reduce(s, { type: 'PANEL_TOGGLE' })).toBe(s);
  });

  it('closing the drawer closes the submenus inside it', () => {
    const s = reduce(state({ panelOpen: true, openPath: ['a', 'b'] }), { type: 'PANEL_CLOSE' });
    expect(s.openPath).toEqual([]);
  });
});

describe('multi-branch', () => {
  const multi = (over: Partial<NavState> = {}) =>
    state({ mode: 'panel', multiBranch: true, ...over });

  it('lets sibling branches be open at once', () => {
    let s = reduce(multi(), { type: 'SUBMENU_OPEN', path: ['lines'] });
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['stations'] });
    expect(isOpen(s, ['lines'])).toBe(true);
    expect(isOpen(s, ['stations'])).toBe(true);
  });

  it('single-branch closes the sibling instead', () => {
    let s = reduce(state({ mode: 'panel' }), { type: 'SUBMENU_OPEN', path: ['lines'] });
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['stations'] });
    expect(isOpen(s, ['lines'])).toBe(false);
    expect(isOpen(s, ['stations'])).toBe(true);
  });

  it('closing a parent hides its children but does not forget them', () => {
    let s = reduce(multi(), { type: 'SUBMENU_OPEN', path: ['lines'] });
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['lines', 'central'] });
    expect(isOpen(s, ['lines', 'central'])).toBe(true);

    s = reduce(s, { type: 'SUBMENU_TOGGLE', path: ['lines'] });
    expect(isOpen(s, ['lines'])).toBe(false);
    expect(isOpen(s, ['lines', 'central'])).toBe(false);

    // …and reopening restores the sub-tree exactly, with no memo involved.
    s = reduce(s, { type: 'SUBMENU_TOGGLE', path: ['lines'] });
    expect(isOpen(s, ['lines'])).toBe(true);
    expect(isOpen(s, ['lines', 'central'])).toBe(true);
  });

  it('single-branch forgets them, which is what an accordion is for', () => {
    let s = reduce(state({ mode: 'panel' }), { type: 'SUBMENU_OPEN', path: ['lines'] });
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['lines', 'central'] });
    s = reduce(s, { type: 'SUBMENU_TOGGLE', path: ['lines'] });
    s = reduce(s, { type: 'SUBMENU_TOGGLE', path: ['lines'] });
    expect(isOpen(s, ['lines'])).toBe(true);
    expect(isOpen(s, ['lines', 'central'])).toBe(false);
  });

  it('a bar keeps top-level siblings exclusive even with multiBranch', () => {
    let s = reduce(state({ mode: 'bar', multiBranch: true }), {
      type: 'SUBMENU_OPEN',
      path: ['services'],
    });
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['portfolio'] });
    expect(isOpen(s, ['services'])).toBe(false);
    expect(isOpen(s, ['portfolio'])).toBe(true);
  });

  it('…while a drawer lets them stack, because an accordion is readable', () => {
    let s = reduce(state({ mode: 'panel', multiBranch: true }), {
      type: 'SUBMENU_OPEN',
      path: ['services'],
    });
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['portfolio'] });
    expect(isOpen(s, ['services'])).toBe(true);
    expect(isOpen(s, ['portfolio'])).toBe(true);
  });

  it('a bar still remembers what was inside a closed root', () => {
    let s = reduce(state({ mode: 'bar', multiBranch: true }), {
      type: 'SUBMENU_OPEN',
      path: ['portfolio', 'programming'],
    });
    // Switching roots closes Portfolio…
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['services'] });
    expect(isOpen(s, ['portfolio'])).toBe(false);
    expect(isOpen(s, ['portfolio', 'programming'])).toBe(false);
    // …and coming back restores the sub-tree.
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['portfolio'] });
    expect(isOpen(s, ['portfolio', 'programming'])).toBe(true);
    expect(isOpen(s, ['services'])).toBe(false);
  });

  it('nested siblings in a bar still stack — the rule is top level only', () => {
    let s = reduce(state({ mode: 'bar', multiBranch: true }), {
      type: 'SUBMENU_OPEN',
      path: ['portfolio', 'design'],
    });
    s = reduce(s, { type: 'SUBMENU_OPEN', path: ['portfolio', 'programming'] });
    expect(isOpen(s, ['portfolio', 'design'])).toBe(true);
    expect(isOpen(s, ['portfolio', 'programming'])).toBe(true);
  });

  it('closing the drawer forgets everything in both modes', () => {
    let s = reduce(multi({ panelOpen: true }), {
      type: 'SUBMENU_OPEN',
      path: ['lines', 'central'],
    });
    s = reduce(s, { type: 'PANEL_CLOSE' });
    expect(s.expanded).toEqual([]);
    s = reduce(s, { type: 'PANEL_OPEN' });
    s = reduce(s, { type: 'SUBMENU_TOGGLE', path: ['lines'] });
    expect(isOpen(s, ['lines', 'central'])).toBe(false);
  });

  it('createNav carries the choice', () => {
    expect(createNav().getState().multiBranch).toBe(false);
    expect(createNav({ multiBranch: true }).getState().multiBranch).toBe(true);
  });

  it('a redundant open is still identity', () => {
    const s = reduce(multi(), { type: 'SUBMENU_OPEN', path: ['lines'] });
    expect(reduce(s, { type: 'SUBMENU_OPEN', path: ['lines'] })).toBe(s);
  });
});

describe('crossing the breakpoint', () => {
  it('closes everything, because a drawer accordion is not a dropdown', () => {
    const s = reduce(state({ panelOpen: true, openPath: ['a', 'b'] }), {
      type: 'MODE_SET',
      mode: 'bar',
    });
    expect(s).toEqual(state({ mode: 'bar' }));
  });

  it('a repeated MODE_SET is identity — a ResizeObserver may fire on every pixel', () => {
    const s = state({ mode: 'bar', openPath: ['a'] });
    expect(reduce(s, { type: 'MODE_SET', mode: 'bar' })).toBe(s);
  });
});

describe('subscriptions', () => {
  it('notifies only when the state actually changed', () => {
    const nav = createNav({ mode: 'bar' });
    const seen = vi.fn();
    nav.subscribe(seen);

    nav.send({ type: 'SUBMENU_OPEN', path: ['a'] });
    expect(seen).toHaveBeenCalledTimes(1);

    nav.send({ type: 'SUBMENU_OPEN', path: ['a'] }); // same path
    nav.send({ type: 'MODE_SET', mode: 'bar' }); // same mode
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('hands listeners the previous state, so a binder can diff', () => {
    const nav = createNav({ mode: 'bar' });
    nav.subscribe((next, previous) => {
      expect(previous.openPath).toEqual([]);
      expect(next.openPath).toEqual(['a']);
    });
    nav.send({ type: 'SUBMENU_OPEN', path: ['a'] });
  });

  it('survives a listener unsubscribing during its own dispatch', () => {
    const nav = createNav({ mode: 'bar' });
    const second = vi.fn();
    const off = nav.subscribe(() => off());
    nav.subscribe(second);
    expect(() => nav.send({ type: 'SUBMENU_OPEN', path: ['a'] })).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing twice is harmless', () => {
    const nav = createNav();
    const off = nav.subscribe(() => {});
    off();
    expect(() => off()).not.toThrow();
  });

  it('dispose drops every subscriber', () => {
    const nav = createNav({ mode: 'bar' });
    const seen = vi.fn();
    nav.subscribe(seen);
    nav.dispose();
    nav.send({ type: 'SUBMENU_OPEN', path: ['a'] });
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('isOpen', () => {
  const s = state({ mode: 'bar', openPath: ['products', 'laptops'] });

  it('is true for the open menu and for its ancestors', () => {
    expect(isOpen(s, ['products'])).toBe(true);
    expect(isOpen(s, ['products', 'laptops'])).toBe(true);
  });

  it('is false for siblings, for deeper paths and for nothing', () => {
    expect(isOpen(s, ['services'])).toBe(false);
    expect(isOpen(s, ['products', 'phones'])).toBe(false);
    expect(isOpen(s, ['products', 'laptops', 'gaming'])).toBe(false);
    expect(isOpen(s, [])).toBe(false);
  });
});

describe('scroll-spy state', () => {
  it('records and clears the active section', () => {
    const nav = createNav();
    expect(nav.getState().activeId).toBeNull();

    nav.send({ type: 'SPY_SET', id: 'pricing' });
    expect(nav.getState().activeId).toBe('pricing');

    nav.send({ type: 'SPY_SET', id: null });
    expect(nav.getState().activeId).toBeNull();
  });

  it('returns the same object when the section has not changed', () => {
    const nav = createNav();
    nav.send({ type: 'SPY_SET', id: 'pricing' });
    const before = nav.getState();
    // Scrolling within one section fires the observer repeatedly; each of
    // those must cost a comparison rather than a render.
    expect(nav.send({ type: 'SPY_SET', id: 'pricing' })).toBe(before);
  });

  it('notifies subscribers only on a real change', () => {
    const nav = createNav();
    let calls = 0;
    nav.subscribe(() => {
      calls++;
    });
    nav.send({ type: 'SPY_SET', id: 'a' });
    nav.send({ type: 'SPY_SET', id: 'a' });
    nav.send({ type: 'SPY_SET', id: 'b' });
    expect(calls).toBe(2);
  });

  it('survives crossing the breakpoint', () => {
    const nav = createNav({ mode: 'panel' });
    nav.send({ type: 'PANEL_OPEN' });
    nav.send({ type: 'SPY_SET', id: 'features' });

    // MODE_SET is the one transition that used to build a whole new state
    // object rather than spreading, so it would have dropped this field on
    // every resize past 992px. Which section you are reading is not something
    // a viewport change should forget.
    nav.send({ type: 'MODE_SET', mode: 'bar' });
    const state = nav.getState();
    expect(state.mode).toBe('bar');
    expect(state.panelOpen).toBe(false);
    expect(state.activeId).toBe('features');
  });
});
