/**
 * The state machine. No DOM, no globals, no imports.
 *
 * Everything a NAVX knows about *what is open* lives here, and nothing here
 * knows that a document exists. That is not purity for its own sake — it is
 * what makes Stage 4's adapters thin. React does not want a library writing to
 * its DOM; it wants this object and will render the result itself. It also
 * means the whole behavioural surface is testable in Node in milliseconds, with
 * no jsdom and no browser.
 *
 * Legacy's equivalent state was nine properties written onto the `<nav>`
 * element plus four CSS classes, mutated from six places, with no single point
 * that could answer "what is open right now".
 */

/** Bar mode is the horizontal bar; panel mode is the off-canvas drawer. */
export type NavMode = 'bar' | 'panel';

export interface NavState {
  readonly mode: NavMode;
  /** Off-canvas drawer. Always false in bar mode, where there is no drawer. */
  readonly panelOpen: boolean;
  /**
   * The open submenu chain, outermost first — `['products', 'laptops']` means
   * Products is open and Laptops is open inside it.
   *
   * A path rather than a set, because "one menu open per level" is then an
   * invariant of the data structure instead of a rule six call sites have to
   * remember. Legacy needed `hideSubmenus("BODY")` scattered through its click
   * handler to approximate the same thing, and got it wrong for nested items.
   */
  readonly openPath: readonly string[];
}

export type NavEvent =
  | { type: 'MODE_SET'; mode: NavMode }
  | { type: 'PANEL_OPEN' }
  | { type: 'PANEL_CLOSE' }
  | { type: 'PANEL_TOGGLE' }
  /** `path` is the full ancestor chain ending at the submenu being opened. */
  | { type: 'SUBMENU_OPEN'; path: readonly string[] }
  | { type: 'SUBMENU_TOGGLE'; path: readonly string[] }
  /** Closes the deepest open submenu — what Escape does. */
  | { type: 'SUBMENU_CLOSE_INNERMOST' }
  | { type: 'CLOSE_ALL' };

export type NavListener = (state: NavState, previous: NavState) => void;

export interface NavMachine {
  getState(): NavState;
  send(event: NavEvent): NavState;
  subscribe(listener: NavListener): () => void;
  /** Drops every subscriber. Called by `attach`'s teardown. */
  dispose(): void;
}

export interface NavMachineConfig {
  /**
   * Starting mode. `attach()` corrects this from the stylesheet on first read.
   *
   * `| undefined` is explicit because this repo builds with
   * `exactOptionalPropertyTypes`, under which `{ mode: undefined }` is *not*
   * assignable to `{ mode?: NavMode }`. Every adapter destructures a caller's
   * options and forwards the rest, so without this every one of them fails to
   * compile on a field the caller simply did not set.
   */
  readonly mode?: NavMode | undefined;
}

const INITIAL: NavState = { mode: 'panel', panelOpen: false, openPath: [] };

const samePath = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The whole transition table, as one pure function.
 *
 * Returning the *same object* when nothing changed is load-bearing: `send()`
 * only notifies subscribers on identity change, so a redundant event — a
 * `MODE_SET` from a ResizeObserver that fires on every pixel of a drag, say —
 * costs one comparison rather than a DOM write and a React render.
 */
export function reduce(state: NavState, event: NavEvent): NavState {
  switch (event.type) {
    case 'MODE_SET': {
      if (event.mode === state.mode) return state;
      // Crossing the breakpoint closes everything. A submenu opened as a
      // drawer accordion is not the same box as a dropdown positioned under a
      // bar item, and leaving it open mid-transition is how legacy produced
      // menus stranded off-screen.
      return { mode: event.mode, panelOpen: false, openPath: [] };
    }

    case 'PANEL_OPEN':
      // There is no drawer in bar mode, so this cannot be true there.
      if (state.mode === 'bar' || state.panelOpen) return state;
      return { ...state, panelOpen: true };

    case 'PANEL_CLOSE':
      if (!state.panelOpen) return state;
      // Closing the drawer closes what is inside it.
      return { ...state, panelOpen: false, openPath: [] };

    case 'PANEL_TOGGLE':
      return reduce(state, { type: state.panelOpen ? 'PANEL_CLOSE' : 'PANEL_OPEN' });

    case 'SUBMENU_OPEN': {
      if (event.path.length === 0) return state;
      if (samePath(state.openPath, event.path)) return state;
      // Assignment, not insertion: opening `[a, b]` closes any sibling of `b`
      // and everything below it, in one step and by construction.
      return { ...state, openPath: [...event.path] };
    }

    case 'SUBMENU_TOGGLE': {
      if (event.path.length === 0) return state;
      // Toggling the menu that is already the deepest one open closes it and
      // leaves its ancestors open — clicking Laptops shut should not also shut
      // Products.
      if (samePath(state.openPath, event.path)) {
        return { ...state, openPath: event.path.slice(0, -1) };
      }
      return { ...state, openPath: [...event.path] };
    }

    case 'SUBMENU_CLOSE_INNERMOST': {
      if (state.openPath.length === 0) return state;
      return { ...state, openPath: state.openPath.slice(0, -1) };
    }

    case 'CLOSE_ALL': {
      if (!state.panelOpen && state.openPath.length === 0) return state;
      return { ...state, panelOpen: false, openPath: [] };
    }

    default: {
      // Exhaustiveness: adding an event without a case is a compile error.
      const never: never = event;
      return never;
    }
  }
}

export function createNav(config: NavMachineConfig = {}): NavMachine {
  let state: NavState = config.mode ? { ...INITIAL, mode: config.mode } : INITIAL;
  let listeners: NavListener[] = [];

  return {
    getState: () => state,

    send(event) {
      const previous = state;
      state = reduce(state, event);
      if (state === previous) return state;
      // Iterate a copy: a listener that unsubscribes during dispatch must not
      // shift the array out from under the loop.
      for (const listener of [...listeners]) listener(state, previous);
      return state;
    },

    subscribe(listener) {
      listeners.push(listener);
      let live = true;
      return () => {
        if (!live) return; // idempotent, so double-teardown is harmless
        live = false;
        listeners = listeners.filter((l) => l !== listener);
      };
    },

    dispose() {
      listeners = [];
    },
  };
}

/** True when `path` is the open chain or a prefix of it — i.e. this menu is open. */
export function isOpen(state: NavState, path: readonly string[]): boolean {
  if (path.length === 0 || path.length > state.openPath.length) return false;
  return path.every((id, i) => state.openPath[i] === id);
}
