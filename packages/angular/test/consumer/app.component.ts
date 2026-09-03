/**
 * A consumer, compiled the way a consumer compiles.
 *
 * `tsc --noEmit` type-checks our *source*, and ng-packagr emits *partial*
 * declarations — neither of those runs Angular's template type-checker over a
 * template that actually uses the directive. So this fixture imports the built
 * package through its published `exports` map and compiles in `full` mode with
 * `strictTemplates`, which is what the Angular CLI does inside an application.
 *
 * If an input's type is wrong, a signal input is not bindable, or the directive
 * metadata in the emitted `.d.ts` is malformed, this file stops compiling.
 */

import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { NavxDirective, NavxService, isOpen } from '@navx/angular';
import type { NavMode } from '@navx/angular';

@Component({
  selector: 'app-header',
  standalone: true,
  // The directive is imported, not module-declared — the Stage 1 decision.
  imports: [NavxDirective],
  // Provided here, not in root: one nav per component that renders one.
  providers: [NavxService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav
      class="navx"
      navx
      [navxTrigger]="trigger()"
      [navxHoverCloseDelay]="closeDelay"
      [navxDismissOnOutside]="true"
      [navxModal]="modal()"
      [navxMode]="mode"
      [attr.data-open]="drawerOpen()"
    >
      <button class="navx-toggler" type="button">Menu</button>
      <div class="navx-panel">
        <ul class="navx-menu">
          <li class="navx-item" [attr.data-navx-state]="productsOpen() ? 'open' : null">
            <div class="navx-link">
              <a href="#products">Products</a>
              <button class="navx-chevron" type="button" aria-label="Products submenu"></button>
            </div>
            <ul class="navx-submenu">
              <li class="navx-submenu-item"><a href="#laptops">Laptops</a></li>
            </ul>
          </li>
        </ul>
      </div>
    </nav>
    <p>{{ label() }}</p>
    <button type="button" (click)="close()">Close everything</button>
  `,
})
export class AppHeaderComponent {
  /** Injected, so the template reads state without the component storing any. */
  constructor(readonly nav: NavxService) {}

  readonly trigger = signal<'click' | 'hover'>('click');
  readonly modal = signal(true);
  readonly closeDelay = 250;
  readonly mode: NavMode = 'bar';

  /** Signals all the way down: the service's state signal drives the template. */
  readonly drawerOpen = computed(() => this.nav.state().panelOpen);
  readonly productsOpen = computed(() => isOpen(this.nav.state(), ['1.0']));
  readonly label = computed(() => (this.drawerOpen() ? 'Drawer open' : 'Drawer closed'));

  close(): void {
    this.nav.send({ type: 'CLOSE_ALL' });
  }
}
