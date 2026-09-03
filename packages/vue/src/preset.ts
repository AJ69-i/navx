/**
 * `Navx` — the preset renderer for Vue.
 *
 * A subpath export (`@navx/vue/preset`), so `useNav` on its own still costs
 * 702 B. Same walker as React's; the only differences are `h` instead of
 * `createElement`, `class` instead of `className`, and children as an array
 * rather than rest arguments.
 */

import { plan, toTree } from '@navx/presets';
import type { NavxContent, NavxPreset, PlanOptions } from '@navx/presets';
import { type PropType, type VNode, computed, defineComponent, h } from 'vue';
import { useNav } from './index.js';

export const Navx = defineComponent({
  name: 'Navx',
  props: {
    preset: { type: Object as PropType<NavxPreset>, required: true },
    content: { type: Object as PropType<NavxContent>, required: true },
    icons: { type: Object as PropType<PlanOptions['icons']>, default: undefined },
    assetBase: { type: String, default: undefined },
    labelDisclosure: {
      type: Function as PropType<NonNullable<PlanOptions['labelDisclosure']>>,
      default: undefined,
    },
    labelToggler: { type: String, default: undefined },
    labelClose: { type: String, default: undefined },
    overlay: { type: Boolean, default: undefined },
    trigger: { type: String as PropType<'click' | 'hover'>, default: undefined },
  },
  setup(props) {
    const { navRef } = useNav({
      trigger: props.trigger ?? props.preset.trigger,
    });

    /**
     * `computed`, so the plan is rebuilt only when its inputs change. Vue
     * tracks the props it actually read, which is exactly the dependency list
     * React needs spelled out by hand.
     */
    const tree = computed(() =>
      plan(props.preset, props.content, {
        icons: props.icons,
        assetBase: props.assetBase,
        labelDisclosure: props.labelDisclosure,
        labelToggler: props.labelToggler,
        labelClose: props.labelClose,
        overlay: props.overlay,
      }),
    );

    // The render function returns the `.navx` root with the ref on it, so the
    // rendered DOM is the plan and nothing else.
    return () =>
      toTree<VNode>(tree.value, {
        rootProps: { ref: navRef },
        create: (tag, attrs, children) =>
          children.length === 0 ? h(tag, attrs) : h(tag, attrs, children),
      });
  },
});

export default Navx;
export { plan, html, toTree, render } from '@navx/presets';
export type { NavxContent, NavxNode, NavxPreset, PlanOptions } from '@navx/presets';
