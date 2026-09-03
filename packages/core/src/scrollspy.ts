/**
 * Scroll-spy — highlight the nav item whose section you are looking at.
 *
 * A subpath export (`@navx/core/scrollspy`), because most navs do not want it
 * and the base core is budgeted at 4.5 kB. Importing it is the opt-in; there
 * is no flag on `attach()`.
 *
 * The module is **pure observation**. It reads the page, decides which section
 * is active, and calls `machine.send({ type: 'SPY_SET' })`. It writes no nav
 * markup at all — `attach()` renders `state.activeId` the same way it renders
 * `openPath`, so there is still exactly one module in NAVX that touches the
 * nav's DOM. Spy observes, machine holds, attach renders.
 *
 * ## What it does not do
 *
 * There is no click handler and no scroll animation. A nav link to `#pricing`
 * is a fragment link, and browsers already know how to navigate to one:
 * smoothly if `scroll-behavior` says so, stopping short of a sticky header if
 * `scroll-margin-block-start` says so, moving focus to the target, and adding
 * a history entry so Back works. Legacy re-implemented all of that in about
 * ninety lines of `requestAnimationFrame` and `easeInOutCubic`, and got the
 * focus and history parts wrong by omission.
 *
 * So this sets two CSS properties and gets out of the way. That is why
 * `scrollSpySpeed` has no equivalent here: a duration is the one thing the
 * native path will not give you, and buying it back costs an animation loop
 * that fights the user's own scrolling and has to re-implement
 * `prefers-reduced-motion` by hand. See docs/stage6.md.
 *
 * ## Offsets
 *
 * Legacy's `scrollSpyOffset` was signed and used inconsistently — negated for
 * the scroll destination, `Math.abs()`-ed for the activation test. Here
 * `offset` is one number with one meaning: **how much room to leave above a
 * section**, which is normally the height of your sticky header. Legacy's
 * `scrollSpyOffset: -60` is `offset: 60`.
 */

import type { NavMachine } from './machine.js';

export interface SpyOptions {
  /**
   * Pixels of room to leave above a section — usually your sticky header's
   * height. Sets `scroll-margin-block-start` on each target and positions the
   * activation probe. Default 0.
   */
  readonly offset?: number | undefined;
  /**
   * Set `scroll-behavior: smooth` on the scrolling element. Default true.
   *
   * The browser already suppresses this under `prefers-reduced-motion`, which
   * is the main reason to let it own the animation.
   */
  readonly smooth?: boolean | undefined;
  /**
   * The element whose `scroll-behavior` is set. Defaults to the document
   * element — override when your page scrolls inside a container.
   */
  readonly scroller?: HTMLElement | undefined;
}

const DEFAULTS = { offset: 0, smooth: true } as const;

/** Links that point at a real fragment. `href="#"` is not one. */
const SPY_LINK = 'a[href^="#"]';

export function spy(root: HTMLElement, machine: NavMachine, options: SpyOptions = {}): () => void {
  /**
   * Plain `??` rather than the merge-and-cast `attach()` uses.
   *
   * That helper exists because `attach()` has seven options and every one has
   * a default, so a mapped `-?` type is honest there. Here `scroller` has no
   * default, and the same cast would have claimed it was always present.
   */
  const offset = options.offset ?? DEFAULTS.offset;
  const smooth = options.smooth ?? DEFAULTS.smooth;

  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (!view) return () => {};
  const win: Window & typeof globalThis = view;

  const controller = new AbortController();
  const { signal } = controller;

  /**
   * Inline styles this module wrote, and what was there before.
   *
   * Same discipline as `attach()`'s attribute map, and needed for the same
   * reason: these properties live on the *page's* sections, not on the nav, so
   * leaving them behind would outlive the nav that set them.
   */
  const written = new Map<HTMLElement, Map<string, string>>();
  const setStyle = (el: HTMLElement, prop: string, value: string) => {
    let prior = written.get(el);
    if (!prior) {
      prior = new Map();
      written.set(el, prior);
    }
    if (!prior.has(prop)) prior.set(prop, el.style.getPropertyValue(prop));
    el.style.setProperty(prop, value);
  };

  /** Resolve every fragment link in the nav to the section it points at. */
  const targets: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const link of root.querySelectorAll<HTMLAnchorElement>(SPY_LINK)) {
    const href = link.getAttribute('href') ?? '';
    // `#` alone is a placeholder, not a destination — the catalogue is full of
    // them, and treating one as a section would make every demo nav spy on
    // nothing.
    if (href.length <= 1) continue;
    const id = href.slice(1);
    if (seen.has(id)) continue;
    const section = doc.getElementById(id);
    if (!section) continue;
    seen.add(id);
    targets.push(section);
    setStyle(section, 'scroll-margin-block-start', `${offset}px`);
  }

  if (targets.length === 0) {
    // Nothing to spy on. Restore is still correct — `written` is empty — and
    // returning a live teardown keeps the caller's code uniform.
    return () => controller.abort();
  }

  if (smooth) {
    setStyle(options.scroller ?? doc.documentElement, 'scroll-behavior', 'smooth');
  }

  /**
   * Which section is active.
   *
   * The probe is a line `offset` pixels below the top of the viewport, and the
   * active section is the last one whose box straddles it — exactly legacy's
   * `top >= section.top && top < section.bottom`, in viewport coordinates.
   *
   * Rects are read live rather than cached. Legacy cached `offsetTop` and
   * `offsetHeight` at startup and re-measured on resize, which meant any
   * layout change that was not a resize — an image loading, an accordion
   * opening, a font swapping — left it pointing at the wrong section until the
   * window changed size.
   */
  const recompute = () => {
    const probe = offset;
    let active: string | null = null;
    for (const section of targets) {
      const rect = section.getBoundingClientRect();
      if (rect.top <= probe && rect.bottom > probe) active = section.id;
    }
    machine.send({ type: 'SPY_SET', id: active });
  };

  /**
   * `IntersectionObserver` is the trigger, not the rule.
   *
   * Using it to *decide* means encoding the probe line into `rootMargin`,
   * which needs the viewport height and so needs re-creating on every resize.
   * Using it to say "a boundary moved, look again" needs none of that, and the
   * look is one `getBoundingClientRect()` per section on a callback that fires
   * only when something actually crossed — rather than legacy's handler on
   * every scroll event.
   */
  let disconnect = () => {};
  if (typeof win.IntersectionObserver === 'function') {
    const observer = new win.IntersectionObserver(recompute, {
      rootMargin: `-${offset}px 0px 0px 0px`,
      threshold: [0, 1],
    });
    for (const section of targets) observer.observe(section);
    disconnect = () => observer.disconnect();
  } else {
    // Baseline 2024 says fall back, not polyfill — the same call `attach()`
    // makes for `ResizeObserver`. A passive scroll listener is worse (it runs
    // on every frame of a scroll) and completely correct.
    win.addEventListener('scroll', recompute, { passive: true, signal });
    win.addEventListener('resize', recompute, { passive: true, signal });
  }

  recompute();

  let live = true;
  return () => {
    if (!live) return; // idempotent, so double-teardown is harmless
    live = false;
    controller.abort();
    disconnect();
    for (const [el, props] of written) {
      for (const [prop, value] of props) {
        if (value === '') el.style.removeProperty(prop);
        else el.style.setProperty(prop, value);
      }
    }
    written.clear();
    // Hand the machine back a clean state, so an adapter that keeps the
    // machine across a route change does not keep a stale highlight.
    machine.send({ type: 'SPY_SET', id: null });
  };
}
