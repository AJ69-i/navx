/**
 * @navx/angular — an Angular binding for @navx/core.
 *
 * A standalone directive and an injectable, and no navigation logic in either.
 * The directive owns the element lifetime; the machine owns the state; signals
 * are the bridge.
 *
 * @example
 * ```html
 * <nav class="navx" navx [navxTrigger]="'hover'"> … </nav>
 * ```
 */

import {
  DestroyRef,
  Directive,
  ElementRef,
  Injectable,
  type OnChanges,
  type Signal,
  inject,
  input,
  signal,
} from '@angular/core';
import { attach, createNav } from '@navx/core';
import type { AttachOptions, NavEvent, NavMachine, NavMode, NavState } from '@navx/core';

/**
 * A nav's state, as a signal.
 *
 * Provide it wherever the nav lives — usually on the component that renders
 * the markup — and inject it into any child that needs to read or drive the
 * state. `providedIn: 'root'` would make one nav per application, which is
 * wrong the moment a page has a header and a sidebar.
 */
@Injectable()
export class NavxService {
  readonly machine: NavMachine = createNav();

  readonly #state = signal<NavState>(this.machine.getState());
  /** Read in a template with `nav.state().panelOpen`. */
  readonly state: Signal<NavState> = this.#state.asReadonly();

  constructor() {
    const unsubscribe = this.machine.subscribe((next) => this.#state.set(next));
    // `DestroyRef` rather than `ngOnDestroy`: an injectable provided on a
    // component is destroyed with it, and this is the hook that fires.
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.machine.dispose();
    });
  }

  send(event: NavEvent): void {
    this.machine.send(event);
  }
}

/**
 * `navx` — binds the element it sits on.
 *
 * Standalone, so it is imported by the component that uses it rather than
 * carried by a module nobody wants. It resolves the machine from an injected
 * `NavxService` when one is provided, and otherwise owns one for its own
 * lifetime, so the simple case needs no providers at all.
 */
@Directive({
  selector: '[navx]',
  standalone: true,
})
export class NavxDirective implements OnChanges {
  readonly navxTrigger = input<AttachOptions['trigger']>();
  readonly navxHoverCloseDelay = input<number | undefined>();
  readonly navxDismissOnOutside = input<boolean | undefined>();
  readonly navxModal = input<boolean | undefined>();
  readonly navxMode = input<NavMode | undefined>();

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly #service = inject(NavxService, { optional: true });
  readonly #machine: NavMachine;
  readonly #ownsMachine: boolean;
  #detach: (() => void) | null = null;

  constructor() {
    this.#ownsMachine = this.#service === null;
    this.#machine = this.#service?.machine ?? createNav({ mode: this.navxMode() });

    // Attach in the constructor rather than ngOnInit: the host element already
    // exists by the time a directive is constructed, and `attach()` only needs
    // the element.
    this.#bind();

    inject(DestroyRef).onDestroy(() => {
      this.#detach?.();
      this.#detach = null;
      // Only a machine this directive created; one from the service belongs to
      // the service, which disposes it on its own destruction.
      if (this.#ownsMachine) this.#machine.dispose();
    });
  }

  /**
   * Rebind when an input changes.
   *
   * Signal inputs do not fire `ngOnChanges` on their own, but a directive that
   * declares it still receives one for template-bound inputs — and re-running
   * `attach()` is cheap because `detach()` restores the DOM first, so there is
   * no accumulated state to clean up.
   */
  ngOnChanges(): void {
    if (this.#detach) this.#bind();
  }

  get machine(): NavMachine {
    return this.#machine;
  }

  #bind(): void {
    this.#detach?.();
    const options: AttachOptions = {
      trigger: this.navxTrigger(),
      hoverCloseDelay: this.navxHoverCloseDelay(),
      dismissOnOutside: this.navxDismissOnOutside(),
      modal: this.navxModal(),
    };
    this.#detach = attach(this.#host.nativeElement, this.#machine, options);
  }
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
