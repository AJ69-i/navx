/**
 * `[navxPreset]` — the preset renderer for Angular.
 *
 * A **secondary entry point** (`@navx/angular/preset`), which is Angular
 * Package Format's own mechanism for this: ng-packagr sees the nested
 * `ng-package.json`, builds it separately and writes its own `exports` entry.
 * So `@navx/angular` on its own stays 2.1 kB and never pulls in
 * `@navx/presets`.
 *
 * A directive that renders imperatively rather than a component with a
 * template, and that is a deliberate choice rather than a shortcut. An
 * Angular template capable of expressing this markup would need recursive
 * `ng-template` blocks with an `ngSwitch` over tag names — a second,
 * Angular-flavoured description of nav markup, competing with `plan()`. The
 * whole render-plan design exists to stop that. `render()` builds the same DOM
 * the other four adapters build, from the same tree.
 */

import { DestroyRef, Directive, ElementRef, type OnChanges, inject, input } from '@angular/core';
import { NavxService } from '@navx/angular';
import { attach, createNav } from '@navx/core';
import type { AttachOptions, NavMachine } from '@navx/core';
import { plan, render } from '@navx/presets';
import type { NavxContent, NavxPreset, PlanOptions } from '@navx/presets';

@Directive({
  selector: '[navxPreset]',
  standalone: true,
})
export class NavxPresetDirective implements OnChanges {
  readonly navxPreset = input.required<NavxPreset>();
  readonly navxContent = input.required<NavxContent>();
  readonly navxIcons = input<PlanOptions['icons']>();
  readonly navxAssetBase = input<string | undefined>();
  readonly navxLabelToggler = input<string | undefined>();
  readonly navxLabelClose = input<string | undefined>();
  readonly navxOverlay = input<boolean | undefined>();
  readonly navxTrigger = input<AttachOptions['trigger']>();

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #service = inject(NavxService, { optional: true });
  readonly #machine: NavMachine;
  readonly #ownsMachine: boolean;
  #detach: (() => void) | null = null;
  #root: HTMLElement | null = null;

  constructor() {
    this.#ownsMachine = this.#service === null;
    this.#machine = this.#service?.machine ?? createNav();

    inject(DestroyRef).onDestroy(() => {
      this.#detach?.();
      this.#detach = null;
      this.#root?.remove();
      this.#root = null;
      if (this.#ownsMachine) this.#machine.dispose();
    });
  }

  /**
   * Build on the first change and rebuild on later ones.
   *
   * Unlike Stage 4's `[navx]` directive, this cannot bind in the constructor:
   * required signal inputs are not readable there, and there is nothing to
   * render until the preset and content have arrived.
   */
  ngOnChanges(): void {
    this.#build();
  }

  get machine(): NavMachine {
    return this.#machine;
  }

  #build(): void {
    this.#detach?.();
    this.#detach = null;
    this.#root?.remove();

    const tree = plan(this.navxPreset(), this.navxContent(), {
      icons: this.navxIcons(),
      assetBase: this.navxAssetBase(),
      labelToggler: this.navxLabelToggler(),
      labelClose: this.navxLabelClose(),
      overlay: this.navxOverlay(),
    });

    const host = this.#host.nativeElement;
    this.#root = render(tree, host.ownerDocument);
    host.replaceChildren(this.#root);

    const trigger = this.navxTrigger() ?? this.navxPreset().trigger;
    this.#detach = attach(this.#root, this.#machine, trigger ? { trigger } : {});
  }
}

export { plan, html, render, toTree } from '@navx/presets';
export type { NavxContent, NavxNode, NavxPreset, PlanOptions } from '@navx/presets';
