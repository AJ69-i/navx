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
  /**
   * The section scroll-spy currently considers active, or `null`.
   *
   * `null` rather than optional, so every field of a snapshot is always
   * present. Under `exactOptionalPropertyTypes` an optional field forces every
   * construction site to decide whether to include it, and a state machine
   * whose shape varies is a state machine whose equality is unreliable.
   *
   * Only `@navx/core/scrollspy` ever sets it. A nav without scroll-spy leaves
   * it `null` forever and `attach()` never touches `data-navx-current`.
   */
  readonly activeId: string | null;
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
  /**
   * Every *expanded* node, in the order it was expanded.
   *
   * A menu is visibly open when it and every one of its ancestors is in here,
   * which is what makes `multiBranch` fall out of the data structure rather
   * than needing a memo: closing a parent removes only the parent, so its
   * children stay expanded-but-hidden, and reopening it restores exactly what
   * was open inside.
   *
   * In single-branch mode this is always precisely the prefixes of `openPath`,
   * so the two never disagree and `openPath` keeps the meaning it always had.
   *
   * The entries are opaque keys. Ask `isOpen(state, path)` rather than reading
   * them — the encoding is an implementation detail and may change.
   */
  readonly expanded: readonly string[];
  /**
   * Whether sibling branches may be open at once. Carried in state rather than
   * closed over, so `reduce` stays a total pure function of what it is handed —
   * the property the whole test suite is written against.
   */
  readonly multiBranch: boolean;
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
  /** Scroll-spy reporting which section is in view. `null` means none. */
  | { type: 'SPY_SET'; id: string | null }
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
  /**
   * Let sibling branches stay open at once, and remember a closed parent's
   * children. Default `false` — a standard accordion, one branch at a time.
   *
   * With it on, closing a parent hides its children without forgetting them:
   * reopen the parent and the tree comes back exactly as it was. That is a
   * different product, not a better one — an accordion's whole value is that
   * only one thing is ever open — so it is opt-in.
   */
  readonly multiBranch?: boolean | undefined;
}

const INITIAL: NavState = {
  mode: 'panel',
  panelOpen: false,
  openPath: [],
  expanded: [],
  multiBranch: false,
  activeId: null,
};

const samePath = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/*
 * A path is stored as one NUL-joined string, not as an array.
 *
 * `expanded` is a hot set — every render asks it about every submenu — and the
 * array-of-arrays version needed a key function, a membership scan that
 * re-joined on every comparison, and a bespoke deep equality for identity
 * preservation. Flattening to strings deleted all three and brought the added
 * weight of `multiBranch` from 515 B to well inside the budget. NUL because it
 * cannot occur in an id that came from a DOM attribute.
 */
const SEP = '\u0000';

/** `['a','b']` → `['a', 'a\0b']` — the node and every ancestor, as keys. */
const chainOf = (path: readonly string[]): string[] =>
  path.map((_, i) => path.slice(0, i + 1).join(SEP));

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((entry, i) => entry === b[i]);

/** Open `path`, expanding its ancestors. */
const openAt = (state: NavState, path: readonly string[]): NavState => {
  const chain = chainOf(path);
  let expanded: readonly string[];

  if (!state.multiBranch) {
    // The chain *is* the open set, so a sibling closes by construction rather
    // than by a rule six call sites have to remember.
    expanded = chain;
  } else {
    // Siblings are left alone; this chain moves to the end so the most
    // recently opened branch is last.
    expanded = [...state.expanded.filter((key) => !chain.includes(key)), ...chain];
  }

  if (sameList(expanded, state.expanded) && samePath(state.openPath, path)) return state;
  return oneRootInABar({ ...state, expanded, openPath: [...path] });
};

/**
 * At most one top-level branch visible in bar mode.
 *
 * `multiBranch` is an accordion idea and a bar is not an accordion: in a
 * drawer two open branches stack and both are readable, but a bar's top-level
 * dropdown is a flyout anchored under its own item, so two open at once simply
 * land on top of each other.
 *
 * This is an invariant on the state rather than a filter inside one transition,
 * and that distinction is the fix. Filtering in `openAt` covered a click but
 * not the branch `attach()` opens for the item marked `current` — and whether
 * that arrived before or after the mode was read from the stylesheet varied
 * between page loads, so two roots could be visible or not depending on
 * timing. A rule that has to be remembered at every entry point is a rule that
 * will be missed at one of them; enforcing it once, on the way out, cannot be.
 *
 * Only a root's own key is dropped. Its descendants stay, and a descendant is
 * invisible without its ancestor, so reopening a root still restores what was
 * inside it. Nested siblings keep their multi-branch behaviour at every depth.
 */
const oneRootInABar = (state: NavState): NavState => {
  if (!state.multiBranch || state.mode !== 'bar') return state;
  const survivor = state.openPath[0];
  const expanded = state.expanded.filter((key) => key.includes(SEP) || key === survivor);
  if (sameList(expanded, state.expanded)) return state;
  return { ...state, expanded };
};

/** Close `path`. What happens to its children is the whole difference. */
const closeAt = (state: NavState, path: readonly string[]): NavState => {
  const key = path.join(SEP);
  const expanded = state.multiBranch
    ? // Only the node itself. Its descendants stay in `expanded` and simply stop
      // being visible, because visibility needs every ancestor — which is how
      // reopening restores the sub-tree with no memo to keep in sync.
      state.expanded.filter((entry) => entry !== key)
    : // The node and everything under it: an accordion forgets.
      state.expanded.filter((entry) => entry !== key && !entry.startsWith(key + SEP));
  return { ...state, expanded, openPath: path.slice(0, -1) };
};

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
      //
      // Spreading `state` rather than building a fresh object is load-bearing:
      // this was the one case that constructed a whole new state, so adding a
      // field would silently have dropped `activeId` every time the viewport
      // crossed 992px. What you are looking at is a bug that a spread prevents
      // and a literal invites.
      return oneRootInABar({
        ...state,
        mode: event.mode,
        panelOpen: false,
        openPath: [],
        expanded: [],
      });
    }

    case 'PANEL_OPEN':
      // There is no drawer in bar mode, so this cannot be true there.
      if (state.mode === 'bar' || state.panelOpen) return state;
      return { ...state, panelOpen: true };

    case 'PANEL_CLOSE':
      if (!state.panelOpen) return state;
      // Closing the drawer closes what is inside it — in both modes. Multi-branch
      // remembers across a parent toggle, not across dismissing the whole nav.
      return { ...state, panelOpen: false, openPath: [], expanded: [] };

    case 'PANEL_TOGGLE':
      return reduce(state, { type: state.panelOpen ? 'PANEL_CLOSE' : 'PANEL_OPEN' });

    case 'SUBMENU_OPEN': {
      if (event.path.length === 0) return state;
      return openAt(state, event.path);
    }

    case 'SUBMENU_TOGGLE': {
      if (event.path.length === 0) return state;
      /*
       * `isOpen`, not path equality.
       *
       * The intent was always "close the menu that was clicked". Exact equality
       * only recognised the *deepest* open menu, so clicking an ancestor while a
       * descendant was open fell through to the open branch and truncated the
       * chain — closing the child and leaving the parent open, one level too
       * deep. The prefix test makes the click land on the node it names.
       */
      return isOpen(state, event.path) ? closeAt(state, event.path) : openAt(state, event.path);
    }

    case 'SUBMENU_CLOSE_INNERMOST': {
      // Escape walks up the most recently opened chain, which is what
      // `openPath` is for even when other branches are open beside it.
      if (state.openPath.length === 0) return state;
      return closeAt(state, state.openPath);
    }

    case 'SPY_SET': {
      if (event.id === state.activeId) return state;
      return { ...state, activeId: event.id };
    }

    case 'CLOSE_ALL': {
      if (!state.panelOpen && state.openPath.length === 0 && state.expanded.length === 0) {
        return state;
      }
      return { ...state, panelOpen: false, openPath: [], expanded: [] };
    }

    default: {
      // Exhaustiveness: adding an event without a case is a compile error.
      const never: never = event;
      return never;
    }
  }
}

export function createNav(config: NavMachineConfig = {}): NavMachine {
  let state: NavState =
    config.mode || config.multiBranch
      ? {
          ...INITIAL,
          ...(config.mode ? { mode: config.mode } : {}),
          multiBranch: config.multiBranch === true,
        }
      : INITIAL;
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

/**
 * True when this menu is visibly open — it and every one of its ancestors is
 * expanded.
 *
 * Reading the whole chain rather than just the node is what makes a closed
 * parent hide its children without erasing them, and it costs nothing in
 * single-branch mode where the ancestors are always expanded anyway.
 */
export function isOpen(state: NavState, path: readonly string[]): boolean {
  if (path.length === 0) return false;
  return chainOf(path).every((key) => state.expanded.includes(key));
}
