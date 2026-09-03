/**
 * The legacy → NAVX mapping. The canonical copy.
 *
 * This table is not documentation of a migration; it *is* the migration, and
 * it is the same table the Stage 2 gate ran against all 292 approved
 * screenshots. `tools/baseline/tools/transform-legacy.mjs` imports it from
 * here and uses it to rewrite legacy markup in the browser before comparing
 * the result pixel-for-pixel with the original. So every entry below has been
 * checked by rendering a real page with it and finding nothing moved.
 *
 * That is why the codemod lives in a published package rather than as a script
 * in the repo: a mapping table with a 292-screenshot proof behind it is worth
 * more than the fifty lines of string handling around it, and keeping a second
 * copy for the tool would have meant the proof applied to only one of them.
 *
 * Stage 1 committed to a clean break — no `navigation-*` class survives — so
 * every legacy token below becomes exactly one NAVX class, exactly one data
 * attribute, or nothing at all.
 */

/** Legacy class → NAVX class. Matched as whole class tokens, never substrings. */
export const CLASS_MAP: Readonly<Record<string, string>> = {
  navigation: 'navx',
  'navigation-header': 'navx-header',
  'navigation-button-toggler': 'navx-toggler',
  'hamburger-icon': 'navx-toggler-icon',

  'navigation-body': 'navx-panel',
  'navigation-body-header': 'navx-panel-header',
  'navigation-body-close-button': 'navx-panel-close',
  'navigation-body-section': 'navx-panel-section',

  'navigation-menu': 'navx-menu',
  'navigation-social-menu': 'navx-social',
  'navigation-item': 'navx-item',
  'navigation-link': 'navx-link',

  'navigation-brand-text': 'navx-brand',
  'navigation-logo': 'navx-logo',
  'navigation-btn': 'navx-btn',
  'navigation-badge': 'navx-badge',
  'navigation-text': 'navx-text',

  'navigation-inline-form': 'navx-form',
  'navigation-input': 'navx-input',
  'navigation-search-icon': 'navx-search-icon',

  'navigation-dropdown': 'navx-submenu',
  'navigation-dropdown-item': 'navx-submenu-item',
  'navigation-dropdown-link': 'navx-submenu-link',

  'navigation-megamenu': 'navx-megamenu',
  'navigation-megamenu-container': 'navx-megamenu-container',

  'navigation-row': 'navx-row',
  'navigation-col': 'navx-col',
  'navigation-list': 'navx-list',
  'navigation-list-heading': 'navx-list-heading',

  'navigation-tabs': 'navx-tabs',
  'navigation-tabs-nav': 'navx-tabs-nav',
  'navigation-tabs-nav-item': 'navx-tabs-nav-item',
  'navigation-tabs-pane': 'navx-tabs-pane',

  'align-to-right': 'navx-push-end',
  'align-to-left': 'navx-push-start',
  'overlay-panel': 'navx-overlay',
  'submenu-indicator': 'navx-chevron',

  // Legacy named these for device orientation; the new names say which layout
  // mode they act in, which is what the container query decides.
  'hide-on-landscape': 'navx-hide-in-bar',
  'hide-on-portrait': 'navx-hide-in-panel',
  'margin-top': 'navx-spaced',
};

/**
 * Legacy class → `[attribute, value]`. Modifiers become state, not classes.
 *
 * A class is a thing an element *is*; alignment, position and item variant are
 * things an element is *set to*. Making them attributes means CSS can target
 * them without inventing a class per combination, and means the core can write
 * them without touching `classList`.
 */
export const ATTR_MAP: Readonly<Record<string, readonly [string, string]>> = {
  'navigation-justified': ['data-navx-align', 'between'],
  'navigation-centered': ['data-navx-align', 'center'],
  'navigation-logo-top': ['data-navx-logo', 'top'],
  'navigation-transparent': ['data-navx-transparent', ''],
  'navigation-fullscreen': ['data-navx-fullscreen', ''],
  'fixed-top': ['data-navx-position', 'fixed'],
  'sticky-top': ['data-navx-position', 'sticky'],

  'navigation-icon-item': ['data-navx-item', 'icon'],
  'navigation-avatar-item': ['data-navx-item', 'avatar'],
  'navigation-dropdown-horizontal': ['data-navx-submenu', 'horizontal'],
  'navigation-megamenu-half': ['data-navx-width', 'half'],
  'navigation-megamenu-quarter': ['data-navx-width', 'quarter'],
  'navigation-dropdown-left': ['data-navx-submenu-side', 'start'],

  'is-active': ['data-navx-current', ''],
};

/** Why a legacy class has no replacement. Shown by the codemod's report. */
export const DROPPED: Readonly<Record<string, string>> = {
  'navigation-landscape':
    'the container query replaces it — no JavaScript class is needed to know the mode',
  'has-submenu': 'structural; the new CSS reads the DOM instead of a marker class',
  'navigation-submenu': 'structural; same as has-submenu',
  'scroll-momentum': 'now a plain declaration on the panel',
  'is-visible': 'becomes data-navx-state, written by @navx/core',
  'is-invisible': 'becomes data-navx-state, written by @navx/core',
  'submenu-indicator-left':
    'the arrow no longer needs telling which way its menu opens: :has() reads data-navx-submenu-side off the menu itself, so the two cannot disagree',
};

/** `navigation-col-7` → `navx-col-7`. The one pattern the tables cannot list. */
export const COL_PATTERN = /^navigation-col-(\d+)$/;

export interface TokenResult {
  /** NAVX classes this token becomes. */
  readonly classes: readonly string[];
  /** Attributes this token becomes. */
  readonly attrs: readonly (readonly [string, string])[];
  /** Set when the token is deliberately dropped; the value says why. */
  readonly dropped?: string;
  /** True when the token is not a legacy NAVX class at all — pass it through. */
  readonly foreign?: boolean;
  /** True for a `navigation-*` token with no known mapping. */
  readonly unknown?: boolean;
}

/**
 * Translate one class token.
 *
 * Anything that is not a legacy NAVX class travels through untouched. That is
 * not laziness — NAVX's whole premise is that it drops into someone else's
 * design system, so a `col-md-6` or a `fa-home` sitting beside a
 * `navigation-item` belongs to the consumer and must survive the migration
 * exactly as written.
 */
export function translateToken(token: string): TokenResult {
  const why = DROPPED[token];
  if (why !== undefined) return { classes: [], attrs: [], dropped: why };
  if (token in ATTR_MAP)
    return { classes: [], attrs: [ATTR_MAP[token] as readonly [string, string]] };
  if (token in CLASS_MAP) return { classes: [CLASS_MAP[token] as string], attrs: [] };

  const col = COL_PATTERN.exec(token);
  if (col) return { classes: [`navx-col-${col[1]}`], attrs: [] };

  if (token.startsWith('navigation-')) return { classes: [token], attrs: [], unknown: true };
  return { classes: [token], attrs: [], foreign: true };
}

/** Every legacy token this codemod knows, for the guide and for tests. */
export const KNOWN_TOKENS: readonly string[] = [
  ...Object.keys(CLASS_MAP),
  ...Object.keys(ATTR_MAP),
  ...Object.keys(DROPPED),
];
