/**
 * The React adapter holds no navigation logic, so these test the two things it
 * *is* responsible for: that the machine survives exactly as long as the
 * component, and that rendering follows the state without tearing.
 *
 * jsdom has no layout, so `attach()` cannot read a real mode from the
 * stylesheet — it falls back to measuring the element, which is 0px wide here
 * and therefore panel mode. That is fine: the behaviours under test are
 * lifecycle and subscription, both of which are mode-independent.
 */

import { act, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNav, useNav } from '../src/index.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function Nav({ machine }: { machine?: ReturnType<typeof createNav> } = {}) {
  const { ref, state, send } = useNav(machine ? { machine } : {});
  return (
    <nav className="navx" ref={ref} data-testid="nav">
      <div className="navx-panel" />
      <span data-testid="open">{state.panelOpen ? 'open' : 'shut'}</span>
      <span data-testid="path">{state.openPath.join('|') || 'none'}</span>
      <button type="button" onClick={() => send({ type: 'PANEL_TOGGLE' })}>
        toggle
      </button>
    </nav>
  );
}

describe('useNav', () => {
  it('renders the machine state and updates on a transition', () => {
    const machine = createNav();
    render(<Nav machine={machine} />);
    expect(screen.getByTestId('open').textContent).toBe('shut');

    act(() => void machine.send({ type: 'PANEL_OPEN' }));
    expect(screen.getByTestId('open').textContent).toBe('open');
  });

  it('does not re-render when a transition changes nothing', () => {
    const machine = createNav();
    const renders = vi.fn();

    function Counted() {
      const { ref, state } = useNav({ machine });
      renders();
      return (
        <nav className="navx" ref={ref}>
          {state.openPath.length}
        </nav>
      );
    }

    render(<Counted />);
    const before = renders.mock.calls.length;

    // Same path twice: the machine returns the identical object, so
    // useSyncExternalStore sees no change and React does not re-render.
    act(() => void machine.send({ type: 'SUBMENU_OPEN', path: ['1.0'] }));
    const afterFirst = renders.mock.calls.length;
    act(() => void machine.send({ type: 'SUBMENU_OPEN', path: ['1.0'] }));

    expect(afterFirst).toBeGreaterThan(before);
    expect(renders.mock.calls.length).toBe(afterFirst);
  });

  it('leaves a caller-provided machine usable after unmount', () => {
    const machine = createNav();
    const { unmount } = render(<Nav machine={machine} />);
    unmount();

    // The component disposed only what it created. A machine handed in is the
    // caller's, and disposing it would silently drop their subscribers.
    const seen = vi.fn();
    machine.subscribe(seen);
    machine.send({ type: 'PANEL_OPEN' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('detaches its own machine on unmount', () => {
    const { unmount } = render(<Nav />);
    const nav = screen.getByTestId('nav');
    // attach() writes ARIA onto the parts it finds; detach() restores them.
    unmount();
    expect(nav.isConnected).toBe(false);
  });

  it('survives Strict Mode double-mounting', () => {
    const machine = createNav();
    expect(() =>
      render(
        <StrictMode>
          <Nav machine={machine} />
        </StrictMode>,
      ),
    ).not.toThrow();

    act(() => void machine.send({ type: 'PANEL_OPEN' }));
    expect(screen.getByTestId('open').textContent).toBe('open');
  });

  it('re-attaches when the host element is replaced', () => {
    const machine = createNav();

    function Keyed() {
      const [key, setKey] = useState(0);
      const { ref } = useNav({ machine });
      return (
        <>
          <nav key={key} className="navx" ref={ref} data-testid="nav">
            <div className="navx-panel" />
          </nav>
          <button type="button" onClick={() => setKey(1)}>
            swap
          </button>
        </>
      );
    }

    render(<Keyed />);
    const first = screen.getByTestId('nav');
    act(() => screen.getByText('swap').click());
    const second = screen.getByTestId('nav');

    // A ref callback sees the swap; an effect keyed on [] would not, and the
    // new node would be left unbound while the old one leaked its listeners.
    expect(second).not.toBe(first);
    expect(second.isConnected).toBe(true);
  });
});
