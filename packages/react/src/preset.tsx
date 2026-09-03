/**
 * `<Navx>` — the preset renderer for React.
 *
 * A subpath export (`@navx/react/preset`) rather than part of the main entry,
 * so a consumer using `useNav` headlessly still ships 620 B and never pulls
 * `@navx/presets` into their bundle.
 *
 * There is no markup in this file. `plan()` decides what a nav looks like and
 * `toTree()` walks it; all this adds is `createElement`, a `useMemo` and the
 * `useNav` ref. That is the point of the render-plan design — if this file
 * grew a conditional about menus or chevrons it would become the sixth place
 * that knows what nav markup is, and the drift would start there.
 */

import { plan, toTree } from '@navx/presets';
import type { NavxContent, NavxPreset, PlanOptions } from '@navx/presets';
import { type ReactElement, createElement, useMemo } from 'react';
import { useNav } from './index.js';
import type { UseNavOptions } from './index.js';

export interface NavxProps extends PlanOptions, Omit<UseNavOptions, 'mode'> {
  readonly preset: NavxPreset;
  readonly content: NavxContent;
}

export function Navx(props: NavxProps): ReactElement {
  const {
    preset,
    content,
    icons,
    assetBase,
    labelDisclosure,
    labelToggler,
    labelClose,
    overlay,
    ...navOptions
  } = props;

  const { ref } = useNav({
    ...navOptions,
    // A preset may prefer hover; anything the caller passed still wins, since
    // `navOptions` is spread first only for fields the preset does not set.
    ...(preset.trigger && navOptions.trigger === undefined ? { trigger: preset.trigger } : {}),
  });

  /**
   * The plan is derived state, so it is memoised on its inputs.
   *
   * Planning is cheap — a pure walk over a few hundred bytes of chrome — but
   * doing it every render would hand React a brand-new element tree each time
   * and defeat the reconciliation this adapter exists to cooperate with.
   */
  const tree = useMemo(
    () =>
      plan(preset, content, {
        icons,
        assetBase,
        labelDisclosure,
        labelToggler,
        labelClose,
        overlay,
      }),
    [preset, content, icons, assetBase, labelDisclosure, labelToggler, labelClose, overlay],
  );

  return useMemo(
    () =>
      // `ReactElement | string`, because the plan's children include text
      // nodes. Typing the walker as `ReactElement` alone forced an
      // `unknown[]` cast at the `createElement` call, which is exactly the
      // sort of cast that hides a real mismatch — and did: `tsc` rejected it
      // the moment the declaration build started reading .tsx files.
      toTree<ReactElement | string>(tree, {
        // React is the one framework that will not accept `class`.
        classProp: 'className',
        // The ref lands on the `.navx` root itself, so the DOM stays exactly
        // what the plan says — no wrapper element the stylesheet never saw.
        rootProps: { ref },
        create: (tag, p, children) =>
          children.length === 0 ? createElement(tag, p) : createElement(tag, p, ...children),
      }) as ReactElement,
    [tree, ref],
  );
}

export { plan, html, toTree, render } from '@navx/presets';
export type { NavxContent, NavxNode, NavxPreset, PlanOptions } from '@navx/presets';
