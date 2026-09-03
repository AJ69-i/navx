/**
 * Legacy markup → NAVX markup.
 *
 * Stage 1 committed to a clean break: no `navigation-*` classes survive. But the
 * 292 approved baselines were captured from legacy markup, so validating the new
 * stylesheet against them needs a bridge. This is it — a mechanical, auditable
 * rename so that any pixel difference is a CSS difference rather than a naming
 * one.
 *
 * It is deliberately dumb. No layout logic, no conditionals beyond the class
 * table: every legacy class becomes exactly one navx class or exactly one data
 * attribute. If a diff appears, it is the stylesheet's fault, not this file's.
 *
 * This table is also the input to the Stage 5 preset port — it *is* the
 * old-API-to-new-API map, written once here and reused there.
 */

/** Legacy class → navx class. Matched as whole class tokens, never substrings. */
export const CLASS_MAP = {
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

  // Utilities. Legacy named these for device orientation; the new names say
  // which layout mode they act in, which is what the container query decides.
  'hide-on-landscape': 'navx-hide-in-bar',
  'hide-on-portrait': 'navx-hide-in-panel',
  'margin-top': 'navx-spaced',
};

/** Legacy class → [attribute, value]. Modifiers become state, not classes. */
export const ATTR_MAP = {
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

/** Legacy classes with no new-API equivalent; dropped rather than carried. */
export const DROPPED = [
  'navigation-landscape', // the container query replaces it — no JS class needed
  'has-submenu', // structural; the new CSS reads the DOM, not a marker class
  'navigation-submenu', // ditto
  'scroll-momentum', // now a plain declaration on the panel
  'is-visible', // becomes data-navx-state, set by the caller
  'is-invisible',
  // The arrow no longer needs telling which way its menu opens: `:has()` reads
  // `data-navx-submenu-side` off the menu itself, so the two can never disagree.
  'submenu-indicator-left',
];

/**
 * Runs inside the page. Returns counts so the caller can assert the transform
 * actually did something rather than silently no-op.
 */
export function transformInPage(root, maps) {
  const { classMap, attrMap, dropped } = maps;
  let renamed = 0;
  let attributed = 0;
  const unmapped = new Set();

  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    if (!el.classList.length) continue;
    const tokens = [...el.classList];
    const next = [];

    for (const token of tokens) {
      if (dropped.includes(token)) continue;
      if (attrMap[token]) {
        const [name, value] = attrMap[token];
        el.setAttribute(name, value);
        attributed++;
        continue;
      }
      if (classMap[token]) {
        next.push(classMap[token]);
        renamed++;
        continue;
      }
      // navigation-col-7 → navx-col-7
      const col = token.match(/^navigation-col-(\d+)$/);
      if (col) {
        next.push(`navx-col-${col[1]}`);
        renamed++;
        continue;
      }
      // Anything else is a consumer class (fa-*, container, col-md-*) and is
      // carried through untouched — NAVX drops into other design systems.
      if (token.startsWith('navigation-')) unmapped.add(token);
      next.push(token);
    }

    el.className = next.join(' ');
  }

  return { renamed, attributed, unmapped: [...unmapped] };
}
