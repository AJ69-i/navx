/**
 * `use:navxPreset` — the preset renderer for Svelte.
 *
 * A subpath export (`@navx/svelte/preset`), so the store and the action on
 * their own still cost 429 B.
 *
 * An action rather than a component, and for the same reason the Stage 4
 * action was: Svelte hands an action the element and the lifetime, which is
 * exactly what building and binding a nav needs. Shipping a `.svelte`
 * component would also mean shipping a compiler-version-specific artifact and
 * giving up the single build that serves Svelte 3, 4 and 5.
 *
 * The element the action sits on *becomes* the nav — its own attributes and
 * children are replaced by the plan — so `<div use:navxPreset={…}>` renders a
 * `<nav class="navx">` in place. Nothing wraps it, so the DOM is exactly what
 * the stylesheet was validated against.
 */

import { attach, createNav } from '@navx/core';
import type { NavMachine } from '@navx/core';
import { plan, render } from '@navx/presets';
import type { NavxContent, NavxPreset, PlanOptions } from '@navx/presets';
import type { NavActionOptions } from './index.js';

export interface NavxPresetOptions extends PlanOptions, Omit<NavActionOptions, 'nav'> {
  readonly preset: NavxPreset;
  readonly content: NavxContent;
  /** Share state with the rest of the page. Omit and the action owns one. */
  readonly nav?: NavMachine | { readonly machine: NavMachine } | undefined;
}

const machineOf = (nav: NavxPresetOptions['nav']) =>
  nav ? ('machine' in nav ? nav.machine : nav) : undefined;

export function navxPreset(node: HTMLElement, options: NavxPresetOptions) {
  let detach: (() => void) | null = null;
  let owned: NavMachine | null = null;
  let root: HTMLElement | null = null;

  const build = (o: NavxPresetOptions) => {
    detach?.();
    detach = null;
    owned?.dispose();
    owned = null;
    root?.remove();

    const tree = plan(o.preset, o.content, o);
    root = render(tree, node.ownerDocument);
    // Replace, not append: two navs would both be bound and both respond.
    node.replaceChildren(root);

    const provided = machineOf(o.nav);
    const machine = provided ?? createNav();
    if (!provided) owned = machine;

    const { preset, content, icons, assetBase, labelDisclosure, overlay, nav, ...attachOpts } = o;
    detach = attach(root, machine, {
      ...attachOpts,
      ...(preset.trigger && attachOpts.trigger === undefined ? { trigger: preset.trigger } : {}),
    });
  };

  build(options);

  return {
    update(next: NavxPresetOptions) {
      build(next);
    },
    destroy() {
      detach?.();
      detach = null;
      owned?.dispose();
      owned = null;
      root?.remove();
      root = null;
    },
  };
}

export { plan, html, render, toTree } from '@navx/presets';
export type { NavxContent, NavxNode, NavxPreset, PlanOptions } from '@navx/presets';
