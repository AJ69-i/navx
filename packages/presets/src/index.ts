/**
 * @navx/presets — the legacy catalogue as data.
 *
 * A preset is the *chrome* of a nav: how it aligns, where the logo sits,
 * whether it sticks, which slots exist, which skin it wears. It carries no
 * labels, no hrefs and no image URLs, which is why one costs about 155 bytes
 * and why swapping presets does not touch your menu.
 *
 * Content is the other half, and it is yours. Each legacy variant's own
 * content ships separately as `@navx/presets/demo/<fixture>`, so a working
 * page is one extra import and nobody's production bundle carries the word
 * "Lorem".
 *
 * ```ts
 * import { justifiedLogoDual } from '@navx/presets';
 * import { content } from '@navx/presets/demo/navigation15';
 * ```
 *
 * The 56 extracted variants collapse to 23 presets. That is not lossy: the
 * other 33 differed only in content, and `byFixture` still maps every one of
 * them to the preset that reproduces it.
 */

export * from './types.js';
export * from './catalogue.js';
export * from './plan.js';
export * from './render.js';
