/**
 * The control for the consumer fixture.
 *
 * A green type-check only means something if a red one is possible, and
 * template type-checking is quietly easy to lose: one `any` in the emitted
 * declaration, or `strictTemplates` silently off, and every binding below
 * would compile. `test/expect-compile-failure.mjs` compiles this file and
 * fails the build if the compiler *accepts* it.
 *
 * Each binding here is wrong in a different way, so a single surviving error
 * still fails the file and the assertion stays meaningful as the API grows.
 */

import { Component } from '@angular/core';
import { NavxDirective } from '@navx/angular';

@Component({
  selector: 'app-broken',
  standalone: true,
  imports: [NavxDirective],
  template: `
    <!-- 'sometimes' is not a trigger -->
    <nav class="navx" navx [navxTrigger]="'sometimes'"></nav>
    <!-- a delay is a number of milliseconds, not a string -->
    <nav class="navx" navx [navxHoverCloseDelay]="'250ms'"></nav>
    <!-- 'desktop' is not a NavMode -->
    <nav class="navx" navx [navxMode]="'desktop'"></nav>
  `,
})
export class BrokenComponent {}
