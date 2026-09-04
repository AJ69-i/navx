/**
 * The DOM binding. The only module in @navx/core that knows a document exists.
 *
 * It reads the markup, wires one delegated listener per event type, subscribes
 * to the machine, and writes attributes. It writes nothing else: no properties
 * on the element, no injected nodes, no generated ids, no prototype patches.
 * `attach()` returns its own teardown, and after calling it the DOM is byte-for
 * byte what it was before — which is the whole reason this package exists,
 * because legacy left six listeners on `window` and `document` that nothing
 * could ever remove.
 */

import { isOpen } from './machine.js';
import type { NavMachine, NavMode, NavState } from './machine.js';

export interface AttachOptions {
  /**
   * How a submenu opens in bar mode. `'hover'` also opens on focus-within and
   * closes on Escape, because a hover-only menu fails WCAG 1.4.13.
   * Panel mode is always click — there is no hover on a drawer.
   */
  readonly trigger?: 'click' | 'hover' | undefined;
  /** Grace period before a hovered-away menu closes, in ms. */
  readonly hoverCloseDelay?: number | undefined;
  /** Close everything when a pointer goes down, or focus lands, outside the nav. */
  readonly dismissOnOutside?: boolean | undefined;
  /**
   * Treat the open drawer as modal: trap focus inside it, make the rest of the
   * page `inert`, and lock body scroll. Every one of those is reverted exactly,
   * on close and on detach.
   */
  readonly modal?: boolean | undefined;
  /**
   * Names for controls whose markup carries none. Defaults are English; a
   * localised site passes its own rather than shipping an English word inside
   * an Arabic navbar.
   */
  readonly labelDisclosure?: ((linkText: string) => string) | undefined;
  readonly labelToggler?: string | undefined;
  readonly labelClose?: string | undefined;
}

const DEFAULTS = {
  trigger: 'click',
  hoverCloseDelay: 220,
  dismissOnOutside: true,
  modal: true,
  labelDisclosure: (linkText: string) => `${linkText} submenu`,
  labelToggler: 'Menu',
  labelClose: 'Close menu',
} as const satisfies Required<AttachOptions>;

const SUBMENU = '.navx-submenu, .navx-megamenu';
const CHEVRON = '.navx-chevron';
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A submenu's identity, derived from where it sits rather than from an id
 * attribute.
 *
 * Structural, so it is identical on the server and the client and cannot
 * collide, and it means the core never writes an id — the thing that makes
 * most drawer libraries hydration-unsafe. Two submenus can share a DOM parent
 * but not a child index, so `1.3.0` names exactly one node.
 */
function pathOf(submenu: Element, root: Element): string[] {
  const path: string[] = [];
  let node: Element | null = submenu;
  while (node && node !== root) {
    if (node.matches(SUBMENU)) path.unshift(addressOf(node, root));
    node = node.parentElement;
  }
  return path;
}

/**
 * The chain of child indices from `root` down to `node` — `"2-3-1"`.
 *
 * Two earlier versions of this were not unique, and both produced the same
 * symptom: opening one dropdown marked several, because `render` marks every
 * submenu whose path reports open.
 *
 *   1. depth plus the submenu's index inside its own item. Every item is shaped
 *      `.navx-link` then the submenu, so that index is 1 in all of them and
 *      every top-level submenu in the nav shared one id.
 *
 *   2. depth plus the *item's* index among its siblings. Better, and still not
 *      unique: a preset with two menus puts item 1 of the first menu and item 1
 *      of the second at the same depth with the same index. Services and
 *      Portfolio collided again.
 *
 * A full address cannot collide, because it encodes the route rather than a
 * summary of it. Depth is implicit in its length, so `depthKey` is gone. It
 * stays hydration-safe for the same reason the others were — nothing but
 * structure goes into it, so the server and the client compute the same string.
 */
function addressOf(node: Element, root: Element): string {
  const parts: number[] = [];
  let current: Element | null = node;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    parts.unshift(parent ? [...parent.children].indexOf(current) : 0);
    current = parent;
  }
  return parts.join('-');
}

/** The submenu a chevron button controls: its next matching sibling. */
function submenuFor(chevron: Element): Element | null {
  let sibling = chevron.nextElementSibling;
  while (sibling) {
    if (sibling.matches(SUBMENU)) return sibling;
    sibling = sibling.nextElementSibling;
  }
  // Some markup nests the chevron inside the link rather than beside it.
  const link = chevron.parentElement;
  sibling = link?.nextElementSibling ?? null;
  while (sibling) {
    if (sibling.matches(SUBMENU)) return sibling;
    sibling = sibling.nextElementSibling;
  }
  return null;
}

export function attach(
  root: HTMLElement,
  machine: NavMachine,
  options: AttachOptions = {},
): () => void {
  // `{ trigger: undefined }` is a legal way for a caller to say "not set", so
  // the undefined keys are dropped before the spread — otherwise they would
  // overwrite the defaults with nothing.
  const given = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as AttachOptions;
  // `-?` strips the optionality and `NonNullable` the explicit `undefined`, so
  // the rest of the function sees settled values rather than re-checking each
  // one at every use.
  const opts = { ...DEFAULTS, ...given } as {
    [K in keyof AttachOptions]-?: NonNullable<AttachOptions[K]>;
  };
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (!view) throw new Error('attach: element is not in a live document');
  // Bound after the guard: control-flow narrowing does not reach the hoisted
  // function declarations below, and widening `win` back to nullable there
  // would mean optional chaining on every use.
  const win: Window & typeof globalThis = view;

  /**
   * One controller for every listener, and a single `abort()` to remove them
   * all. There is no per-listener bookkeeping, which is exactly how legacy
   * lost six of them: `turnOffEvents()` detached the ones it remembered.
   */
  const ac = new AbortController();
  const { signal } = ac;
  const on = <K extends keyof GlobalEventHandlersEventMap>(
    target: EventTarget,
    type: K | string,
    handler: (event: never) => void,
    capture = false,
  ) => target.addEventListener(type, handler as EventListener, { signal, capture });

  /** Timers hang off the same signal, so a teardown mid-animation cancels them. */
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const clearTimers = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };

  // ── the parts ─────────────────────────────────────────────────────────────
  const panel = root.querySelector<HTMLElement>('.navx-panel');
  const toggler = root.querySelector<HTMLElement>('.navx-toggler');
  const closeButton = root.querySelector<HTMLElement>('.navx-panel-close');
  const overlay = root.querySelector<HTMLElement>('.navx-overlay');

  /**
   * Every attribute this function writes, recorded with what was there before,
   * so teardown is a replay rather than a guess. `undefined` means the
   * attribute did not exist and must be removed again.
   */
  const written = new Map<Element, Map<string, string | undefined>>();
  const setAttr = (el: Element, name: string, value: string | null) => {
    let prior = written.get(el);
    if (!prior) {
      prior = new Map();
      written.set(el, prior);
    }
    if (!prior.has(name)) prior.set(name, el.getAttribute(name) ?? undefined);
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  };
  const restoreAttrs = () => {
    for (const [el, attrs] of written) {
      for (const [name, value] of attrs) {
        if (value === undefined) el.removeAttribute(name);
        else el.setAttribute(name, value);
      }
    }
    written.clear();
  };

  // ── mode, read from the stylesheet ────────────────────────────────────────
  /**
   * The breakpoint is not duplicated here. Stage 2 made bar/panel a container
   * query, and the stylesheet publishes its own answer as `--navx-mode` on the
   * panel; this reads it. The number 992 appears once in the codebase, in the
   * CSS, so the two cannot drift — which is legacy defect eleven, where a pair
   * of width flags were both reassigned every call and the comparison became
   * width-against-width.
   *
   * Read from the panel, not the root: an element cannot query its own
   * container.
   */
  const readMode = (): NavMode => {
    const source = panel ?? root;
    const declared = win.getComputedStyle(source).getPropertyValue('--navx-mode').trim();
    if (declared === 'bar' || declared === 'panel') return declared;
    // No stylesheet, or an older one: fall back to the element's own width.
    return root.getBoundingClientRect().width >= 992 ? 'bar' : 'panel';
  };

  const syncMode = () => machine.send({ type: 'MODE_SET', mode: readMode() });

  /**
   * A ResizeObserver when the environment has one, a window resize listener
   * when it does not.
   *
   * The observer is strictly better — it fires when the nav's own box changes,
   * so a nav in a collapsing sidebar switches mode without the viewport moving
   * at all, which is the whole point of the container query. But requiring it
   * made `attach()` throw outright in jsdom and in any environment without it,
   * which is a poor trade for a graceful fallback that costs four lines. Per
   * the Stage 1 decision: fall back, do not polyfill.
   */
  let stopObserving: () => void;
  if (typeof win.ResizeObserver === 'function') {
    const observer = new win.ResizeObserver(syncMode);
    observer.observe(root);
    stopObserving = () => observer.disconnect();
  } else {
    on(win, 'resize', syncMode);
    stopObserving = () => {}; // the signal already removes the listener
  }

  // ── modal drawer plumbing ─────────────────────────────────────────────────
  let restoreFocusTo: HTMLElement | null = null;
  let inerted: HTMLElement[] = [];
  let scrollLock: (() => void) | null = null;

  const focusables = (within: HTMLElement) =>
    [...within.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === doc.activeElement,
    );

  const enterModal = () => {
    if (!opts.modal || !panel) return;
    restoreFocusTo = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;

    // Everything outside the nav becomes inert, recorded so teardown is exact.
    for (const sibling of [...(doc.body?.children ?? [])]) {
      if (sibling === root || sibling.contains(root) || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      inerted.push(sibling);
    }

    // Scroll lock with scrollbar compensation, so the page does not jump.
    const html = doc.documentElement;
    const gap = win.innerWidth - html.clientWidth;
    const prevOverflow = html.style.overflow;
    const prevPadding = html.style.paddingInlineEnd;
    html.style.overflow = 'hidden';
    if (gap > 0) html.style.paddingInlineEnd = `${gap}px`;
    scrollLock = () => {
      html.style.overflow = prevOverflow;
      html.style.paddingInlineEnd = prevPadding;
    };

    (focusables(panel)[0] ?? closeButton ?? panel).focus?.();
  };

  const exitModal = () => {
    for (const el of inerted) el.removeAttribute('inert');
    inerted = [];
    scrollLock?.();
    scrollLock = null;
    restoreFocusTo?.focus?.();
    restoreFocusTo = null;
  };

  // ── rendering state to attributes ─────────────────────────────────────────
  const submenus = () => [...root.querySelectorAll<HTMLElement>(SUBMENU)];

  /** Latches once scroll-spy reports a section — see `render`. */
  let spyEngaged = false;

  const render = (state: NavState, previous?: NavState) => {
    for (const submenu of submenus()) {
      /*
       * `isOpen`, not a prefix test against `openPath`.
       *
       * Open-ness stopped being expressible as one chain the moment
       * `multiBranch` allowed siblings side by side, and the machine already
       * knows the answer — asking it keeps this loop from being a second,
       * subtly different implementation of the same rule.
       */
      const open = isOpen(state, pathOf(submenu, root));

      setAttr(submenu, 'data-navx-state', open ? 'open' : null);

      const item = submenu.parentElement;
      if (item) setAttr(item, 'data-navx-state', open ? 'open' : null);

      const chevron = item?.querySelector<HTMLElement>(CHEVRON) ?? null;
      if (chevron) {
        setAttr(chevron, 'aria-expanded', String(open));
        setAttr(chevron, 'data-navx-state', open ? 'open' : null);
        // Only claimed when the author gave the menu an id — the core never
        // invents one, because a generated id is what breaks hydration.
        if (submenu.id) setAttr(chevron, 'aria-controls', submenu.id);
      }
    }

    /**
     * Scroll-spy's active section, if there is one.
     *
     * `@navx/core/scrollspy` observes and sends `SPY_SET`; this is where that
     * state becomes DOM, so the rule that exactly one module writes the nav's
     * markup survives Stage 6.
     *
     * `spyEngaged` matters. `data-navx-current` is also how a preset marks the
     * current page, so a nav *without* scroll-spy must never have it touched —
     * clearing it on the first render would silently un-mark the author's own
     * current item. The flag latches the first time a section goes active, so
     * the cost to every non-spying nav is one comparison.
     */
    if (state.activeId !== null) spyEngaged = true;
    if (spyEngaged && (!previous || previous.activeId !== state.activeId)) {
      /**
       * Once scroll-spy is engaged it owns `data-navx-current` for the whole
       * nav, including items whose link is the `href="#"` placeholder.
       *
       * The first version skipped those to protect a page's own "current page"
       * marker, and the browser gate caught the consequence immediately: Home
       * stayed lit while Features lit up too, so two items read as current at
       * once. On a page that scroll-spies, "where you are" is a scroll
       * position — a second, static answer to the same question is just wrong.
       * A nav that never spies is still untouched, which is what the latch is
       * for, and `written` still restores the original marker on detach.
       */
      const target = state.activeId === null ? null : `#${state.activeId}`;
      for (const item of root.querySelectorAll<HTMLElement>('.navx-item, .navx-submenu-item')) {
        const link = item.querySelector<HTMLAnchorElement>(':scope > a, :scope > * > a');
        const active = target !== null && link?.getAttribute('href') === target;
        setAttr(item, 'data-navx-current', active ? '' : null);
      }
    }

    if (panel) setAttr(panel, 'data-navx-state', state.panelOpen ? 'open' : null);
    if (overlay) setAttr(overlay, 'data-navx-state', state.panelOpen ? 'open' : null);
    if (toggler) setAttr(toggler, 'aria-expanded', String(state.panelOpen));

    if (previous && previous.panelOpen !== state.panelOpen) {
      if (state.panelOpen) enterModal();
      else exitModal();
    }
  };

  // ── one-time ARIA the markup should have carried ──────────────────────────
  /**
   * `aria-expanded` is only valid on something that can be expanded, which a
   * bare `<div>` is not — axe calls that `aria-allowed-attr`, and it is
   * critical rather than pedantic: the attribute is ignored, so the state is
   * announced to nobody. Legacy's toggler and indicator are both plain
   * elements, so anything the core writes onto them has to come with the role
   * that makes it mean something.
   */
  const makeButton = (el: HTMLElement) => {
    if (el.tagName === 'BUTTON') return;
    if (!el.hasAttribute('role')) setAttr(el, 'role', 'button');
    if (!el.hasAttribute('tabindex')) setAttr(el, 'tabindex', '0');
  };

  /** Whether the element already says what it is, by any of the usual means. */
  const hasName = (el: HTMLElement) =>
    el.hasAttribute('aria-label') ||
    el.hasAttribute('aria-labelledby') ||
    (el.textContent ?? '').trim().length > 0 ||
    !!el.querySelector('img[alt]:not([alt=""])');

  for (const submenu of submenus()) {
    const item = submenu.parentElement;
    const chevron = item?.querySelector<HTMLElement>(CHEVRON);
    if (!chevron) continue;
    if (!chevron.hasAttribute('aria-expanded')) setAttr(chevron, 'aria-expanded', 'false');
    makeButton(chevron);

    /**
     * A disclosure with no accessible name is announced as "button", which is
     * useless when there are six of them. Presets ship a visually-hidden
     * label; when the markup has none, the control is named after the thing it
     * controls rather than left anonymous. `labelDisclosure` exists because
     * "submenu" is a word in one language.
     */
    if (!hasName(chevron)) {
      const label = item?.querySelector<HTMLElement>('.navx-link, .navx-submenu-link');
      const text = (label?.textContent ?? '').trim();
      if (text) setAttr(chevron, 'aria-label', opts.labelDisclosure(text));
    }
  }

  if (toggler) {
    if (!toggler.hasAttribute('aria-expanded')) setAttr(toggler, 'aria-expanded', 'false');
    makeButton(toggler);
    if (!hasName(toggler)) setAttr(toggler, 'aria-label', opts.labelToggler);
  }
  if (closeButton) {
    makeButton(closeButton);
    if (!hasName(closeButton)) setAttr(closeButton, 'aria-label', opts.labelClose);
  }

  // ── events ────────────────────────────────────────────────────────────────
  const pathForChevron = (chevron: Element): string[] => {
    const submenu = submenuFor(chevron);
    return submenu ? pathOf(submenu, root) : [];
  };

  on(root, 'click', (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (!target) return;

    const chevron = target.closest?.(CHEVRON);
    if (chevron && root.contains(chevron)) {
      // A <button> would do this itself; a legacy <span> with role=button
      // would not, and either way the link behind it must not navigate.
      event.preventDefault();
      const path = pathForChevron(chevron);
      if (path.length) machine.send({ type: 'SUBMENU_TOGGLE', path });
      return;
    }

    if (toggler && target.closest?.('.navx-toggler')) {
      event.preventDefault();
      machine.send({ type: 'PANEL_TOGGLE' });
      return;
    }

    if (
      (closeButton && target.closest?.('.navx-panel-close')) ||
      (overlay && target.closest?.('.navx-overlay'))
    ) {
      event.preventDefault();
      machine.send({ type: 'PANEL_CLOSE' });
    }

    // A link is left entirely alone: no preventDefault, so ⌘-click, middle
    // click, `target`, `download` and every SPA router keep working. Legacy
    // called preventDefault and then assigned window.location.href, which
    // broke all four.
  });

  on(root, 'keydown', (event: KeyboardEvent) => {
    const state = machine.getState();
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (event.key === 'Escape') {
      if (state.openPath.length > 0) {
        const chevron = chevronForPath(state.openPath);
        machine.send({ type: 'SUBMENU_CLOSE_INNERMOST' });
        chevron?.focus();
        event.preventDefault();
      } else if (state.panelOpen) {
        machine.send({ type: 'PANEL_CLOSE' });
        event.preventDefault();
      }
      return;
    }

    // Focus trap: only while the drawer is genuinely modal.
    if (event.key === 'Tab' && state.panelOpen && opts.modal && panel) {
      const items = focusables(panel);
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      if (event.shiftKey && doc.activeElement === first) {
        last.focus();
        event.preventDefault();
      } else if (!event.shiftKey && doc.activeElement === last) {
        first.focus();
        event.preventDefault();
      }
      return;
    }

    const arrow = ARROWS[event.key];
    if (!arrow) return;

    const handled = moveFocus(target, arrow, event);
    if (handled) event.preventDefault();
  });

  if (opts.trigger === 'hover') {
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    on(root, 'pointerover', (event: PointerEvent) => {
      if (machine.getState().mode !== 'bar') return;
      const submenu = nearestSubmenuTrigger(event.target as Element | null);
      if (!submenu) return;
      if (closeTimer) {
        clearTimeout(closeTimer);
        timers.delete(closeTimer);
        closeTimer = null;
      }
      machine.send({ type: 'SUBMENU_OPEN', path: pathOf(submenu, root) });
    });

    on(root, 'pointerout', (event: PointerEvent) => {
      if (machine.getState().mode !== 'bar') return;
      const to = event.relatedTarget as Node | null;
      if (to && root.contains(to)) return;
      // A delay rather than legacy's per-exit getBoundingClientRect: a
      // diagonal path from a bar item to its dropdown does not dismiss it,
      // and no layout is read on pointer movement.
      closeTimer = later(() => machine.send({ type: 'CLOSE_ALL' }), opts.hoverCloseDelay);
    });

    // Focus parity. Without this the menu is mouse-only, which is the WCAG
    // 1.4.13 failure that makes hover menus a liability in the first place.
    on(root, 'focusin', (event: FocusEvent) => {
      if (machine.getState().mode !== 'bar') return;
      const submenu = nearestSubmenuTrigger(event.target as Element | null);
      if (submenu) machine.send({ type: 'SUBMENU_OPEN', path: pathOf(submenu, root) });
    });
  }

  if (opts.dismissOnOutside) {
    on(doc, 'pointerdown', (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && root.contains(target)) return;
      machine.send({ type: 'CLOSE_ALL' });
    });

    on(doc, 'focusin', (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (target && root.contains(target)) return;
      if (machine.getState().panelOpen && opts.modal) return; // the trap owns focus
      machine.send({ type: 'CLOSE_ALL' });
    });
  }

  // ── helpers that need the closure ─────────────────────────────────────────
  function chevronForPath(path: readonly string[]): HTMLElement | null {
    const key = path.join('|');
    for (const submenu of submenus()) {
      if (pathOf(submenu, root).join('|') !== key) continue;
      return submenu.parentElement?.querySelector<HTMLElement>(CHEVRON) ?? null;
    }
    return null;
  }

  /** The submenu that hovering or focusing `el` should open, if any. */
  function nearestSubmenuTrigger(el: Element | null): HTMLElement | null {
    const item = el?.closest?.('.navx-item, .navx-submenu-item');
    if (!item || !root.contains(item)) return null;
    for (const child of item.children) {
      if (child.matches(SUBMENU)) return child as HTMLElement;
    }
    return null;
  }

  /**
   * Arrow-key movement, layered on top of the disclosure pattern rather than
   * replacing it: no roles change and Tab still walks every link, so nothing
   * is taken away from a screen-reader user to give something to a keyboard
   * user.
   */
  function moveFocus(from: HTMLElement, arrow: Arrow, event: KeyboardEvent): boolean {
    const rtl = win.getComputedStyle(root).direction === 'rtl';
    const inline = arrow === 'next-inline' || arrow === 'prev-inline';
    const forward = rtl && inline ? arrow === 'prev-inline' : arrow.startsWith('next');

    const submenu = from.closest(SUBMENU) as HTMLElement | null;

    if (arrow === 'first' || arrow === 'last') {
      const scope = submenu ?? root;
      const items = focusables(scope);
      (arrow === 'first' ? items[0] : items[items.length - 1])?.focus();
      return items.length > 0;
    }

    if (inline) {
      // → on a submenu item opens its child menu; ← closes back to the parent.
      if (forward) {
        const child = nearestSubmenuTrigger(from);
        if (child) {
          machine.send({ type: 'SUBMENU_OPEN', path: pathOf(child, root) });
          // Synchronous: `send()` writes the attributes in this tick and
          // reading `offsetParent` forces layout, so the first item is
          // focusable now. Deferring it to a 0ms timer only raced the caller.
          focusables(child)[0]?.focus();
          return true;
        }
        return false;
      }
      if (submenu && machine.getState().openPath.length > 0) {
        const chevron = chevronForPath(machine.getState().openPath);
        machine.send({ type: 'SUBMENU_CLOSE_INNERMOST' });
        chevron?.focus();
        return true;
      }
      return false;
    }

    // ↓ / ↑
    if (!submenu) {
      // On a bar item, ↓ opens its menu and steps into it.
      const child = nearestSubmenuTrigger(from);
      if (child && forward) {
        machine.send({ type: 'SUBMENU_OPEN', path: pathOf(child, root) });
        focusables(child)[0]?.focus();
        return true;
      }
      return false;
    }

    const items = focusables(submenu);
    const index = items.indexOf(from.closest<HTMLElement>(FOCUSABLE) ?? from);
    if (index === -1) return false;
    const next = forward ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
    event.stopPropagation();
    return true;
  }

  // ── go ────────────────────────────────────────────────────────────────────
  const unsubscribe = machine.subscribe(render);
  syncMode();
  render(machine.getState());

  let detached = false;
  return function detach() {
    if (detached) return; // idempotent: double teardown is a no-op, not a throw
    detached = true;
    ac.abort();
    clearTimers();
    stopObserving();
    unsubscribe();
    exitModal();
    restoreAttrs();
  };
}

type Arrow = 'next-block' | 'prev-block' | 'next-inline' | 'prev-inline' | 'first' | 'last';

const ARROWS: Record<string, Arrow> = {
  ArrowDown: 'next-block',
  ArrowUp: 'prev-block',
  ArrowRight: 'next-inline',
  ArrowLeft: 'prev-inline',
  Home: 'first',
  End: 'last',
};
