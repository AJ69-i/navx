/**
 * @navx/element — `<navx-nav>`, the framework-free binding.
 *
 * No Shadow DOM, by the Stage 1 decision: the whole value of NAVX is that it
 * drops into someone else's design system, and a shadow root would seal the
 * markup off from `@navx/styles`, from the consumer's own CSS, and from every
 * global stylesheet on the page. This element is a lifecycle wrapper around
 * light DOM, nothing more.
 *
 * @example
 * ```html
 * <navx-nav trigger="hover">
 *   <nav class="navx"> … </nav>
 * </navx-nav>
 * ```
 */

import { attach, createNav } from '@navx/core';
import type { AttachOptions, NavEvent, NavMachine, NavState } from '@navx/core';

/** Attribute name → how to read it into an AttachOptions field. */
const ATTRS = {
  trigger: (v: string) => (v === 'hover' ? 'hover' : 'click'),
  'hover-close-delay': (v: string) => Number(v),
  'dismiss-on-outside': (v: string) => v !== 'false',
  modal: (v: string) => v !== 'false',
  'label-toggler': (v: string) => v,
  'label-close': (v: string) => v,
} as const;

const OPTION_KEYS: Record<keyof typeof ATTRS, keyof AttachOptions> = {
  trigger: 'trigger',
  'hover-close-delay': 'hoverCloseDelay',
  'dismiss-on-outside': 'dismissOnOutside',
  modal: 'modal',
  'label-toggler': 'labelToggler',
  'label-close': 'labelClose',
};

export class NavxNavElement extends HTMLElement {
  static readonly observedAttributes = Object.keys(ATTRS);

  #machine: NavMachine | null = null;
  #detach: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;

  /** The state machine, so imperative code can drive or observe the nav. */
  get machine(): NavMachine {
    this.#machine ??= createNav({ multiBranch: this.hasAttribute('multi-branch') });
    return this.#machine;
  }

  get state(): NavState {
    return this.machine.getState();
  }

  send(event: NavEvent): void {
    this.machine.send(event);
  }

  connectedCallback(): void {
    this.#bind();

    /**
     * Re-emitted as a DOM event, so a page with no build step can listen
     * without importing anything. `detail` is the immutable snapshot, and the
     * event does not bubble past this element — a nav is not a good place to
     * put traffic on the document.
     */
    this.#unsubscribe = this.machine.subscribe((state, previous) => {
      this.dispatchEvent(new CustomEvent('navx:change', { detail: { state, previous } }));
    });
  }

  disconnectedCallback(): void {
    // Symmetric with connectedCallback, because a custom element can be moved
    // in the DOM — disconnected then reconnected — and must not leak a
    // listener set per move. This is the same discipline @navx/core enforces.
    this.#detach?.();
    this.#detach = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  attributeChangedCallback(): void {
    // Only rebind if we are live; before connection there is nothing to rebind
    // and the initial attributes will be read by connectedCallback anyway.
    if (this.isConnected && this.#detach) this.#bind();
  }

  #options(): AttachOptions {
    const options: Record<string, unknown> = {};
    for (const [attribute, parse] of Object.entries(ATTRS)) {
      const raw = this.getAttribute(attribute);
      if (raw === null) continue;
      options[OPTION_KEYS[attribute as keyof typeof ATTRS]] = parse(raw);
    }
    return options as AttachOptions;
  }

  #bind(): void {
    this.#detach?.();
    /**
     * The nav root is the `.navx` inside, or this element itself if the author
     * put the class here. Both are reasonable markup and neither should be a
     * silent no-op.
     */
    const root = this.querySelector<HTMLElement>('.navx') ?? (this.matches('.navx') ? this : null);
    this.#detach = root ? attach(root, this.machine, this.#options()) : null;
  }
}

/**
 * Registers `<navx-nav>`, once. Importing this module does not register
 * anything — a side effect on import is impossible to opt out of, and breaks
 * SSR bundles that evaluate the module on a server with no `customElements`.
 */
export function defineNavxNav(tagName = 'navx-nav'): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tagName)) return;
  customElements.define(tagName, NavxNavElement);
}

export { createNav, attach, isOpen } from '@navx/core';
export type {
  AttachOptions,
  NavEvent,
  NavListener,
  NavMachine,
  NavMachineConfig,
  NavMode,
  NavState,
} from '@navx/core';
