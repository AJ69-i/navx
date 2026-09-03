/**
 * `<navx-preset>` — the preset renderer with no framework at all.
 *
 * A subpath export (`@navx/element/preset`), so `<navx-nav>` on its own still
 * costs 861 B.
 *
 * Unlike `<navx-nav>`, which wraps markup an author wrote, this element
 * *renders* the markup from a preset and its content. Both are set as
 * properties rather than attributes, because a nav's content is an object
 * tree and JSON in an attribute is a trap: it silently breaks on quoting, has
 * no types, and turns a typo into an empty nav.
 *
 * ```js
 * import { justifiedLogoDual } from '@navx/presets';
 * import { content } from '@navx/presets/demo/navigation15';
 * import { defineNavxPreset } from '@navx/element/preset';
 *
 * defineNavxPreset();
 * const el = document.querySelector('navx-preset');
 * el.preset = justifiedLogoDual;
 * el.content = content;
 * ```
 */

import { attach, createNav } from '@navx/core';
import type { AttachOptions, NavEvent, NavMachine, NavState } from '@navx/core';
import { plan, render } from '@navx/presets';
import type { NavxContent, NavxPreset, PlanOptions } from '@navx/presets';

export class NavxPresetElement extends HTMLElement {
  #preset: NavxPreset | null = null;
  #content: NavxContent | null = null;
  #options: PlanOptions & AttachOptions = {};
  #machine: NavMachine | null = null;
  #detach: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;
  #root: HTMLElement | null = null;

  get machine(): NavMachine {
    this.#machine ??= createNav();
    return this.#machine;
  }

  get state(): NavState {
    return this.machine.getState();
  }

  send(event: NavEvent): void {
    this.machine.send(event);
  }

  get preset(): NavxPreset | null {
    return this.#preset;
  }
  set preset(value: NavxPreset | null) {
    this.#preset = value;
    this.#build();
  }

  get content(): NavxContent | null {
    return this.#content;
  }
  set content(value: NavxContent | null) {
    this.#content = value;
    this.#build();
  }

  /** Icon map, asset base, labels, and anything `attach()` takes. */
  get options(): PlanOptions & AttachOptions {
    return this.#options;
  }
  set options(value: PlanOptions & AttachOptions) {
    this.#options = value ?? {};
    this.#build();
  }

  connectedCallback(): void {
    this.#build();
    this.#unsubscribe = this.machine.subscribe((state, previous) => {
      this.dispatchEvent(new CustomEvent('navx:change', { detail: { state, previous } }));
    });
  }

  disconnectedCallback(): void {
    // Symmetric with connectedCallback: an element moved in the DOM is
    // disconnected then reconnected, and must not accumulate a binding per
    // move. Same discipline as `<navx-nav>` and as the core itself.
    this.#detach?.();
    this.#detach = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #build(): void {
    this.#detach?.();
    this.#detach = null;
    this.#root?.remove();
    this.#root = null;

    if (!this.isConnected || !this.#preset || !this.#content) return;

    const tree = plan(this.#preset, this.#content, this.#options);
    this.#root = render(tree, this.ownerDocument);
    this.replaceChildren(this.#root);

    const { icons, assetBase, labelDisclosure, overlay, ...attachOptions } = this.#options;
    this.#detach = attach(this.#root, this.machine, {
      ...attachOptions,
      ...(this.#preset.trigger && attachOptions.trigger === undefined
        ? { trigger: this.#preset.trigger }
        : {}),
    });
  }
}

/** Registers `<navx-preset>`, once. No side effect on import — see `@navx/element`. */
export function defineNavxPreset(tagName = 'navx-preset'): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(tagName)) return;
  customElements.define(tagName, NavxPresetElement);
}

export { plan, html, render, toTree } from '@navx/presets';
export type { NavxContent, NavxNode, NavxPreset, PlanOptions } from '@navx/presets';
