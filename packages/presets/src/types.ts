/**
 * The preset schema.
 *
 * Derived, not invented. `tools/baseline/tools/extract-presets.mjs` walks the
 * 56 legacy fixtures and reports a grammar of 64 node kinds joined by 88
 * nesting edges; everything below exists because something in that grammar
 * needs it, and nothing below exists that the grammar does not use. A schema
 * that cannot express a variant is a variant we cannot reproduce, so the
 * extractor fails loudly rather than dropping a node it has no field for.
 *
 * Two principles shape it.
 *
 * **Chrome is a preset; content is yours.** A `NavxPreset` carries layout,
 * skin, behaviour and *which slots exist* — never a label, an href or a URL.
 * Items are a separate argument, so a preset is a few hundred bytes and the
 * strings in your bundle are the strings you wrote. Each preset also ships its
 * catalogue content as an opt-in `@navx/presets/demo/<id>` import, which is
 * what the pixel gate renders and what a one-line demo uses.
 *
 * **Icons are names, not classes.** The legacy catalogue used Font Awesome
 * (`fas fa-home`, 66 occurrences of `fas` alone) and Bootstrap utilities
 * (`img-fluid`, `mt-3`, `text-justify`). Shipping those strings would make
 * this package depend on two libraries it does not install, in the dark. So an
 * icon is a semantic name and the consumer supplies the mapping — a class
 * string, or their own component. `iconMap` in `@navx/presets/demo` reproduces
 * the legacy classes exactly, which is how the baselines still apply.
 */

/**
 * A semantic icon name. Open, because your nav has icons the catalogue never
 * had — but the names the catalogue uses are listed for autocomplete.
 *
 * Nothing here implies an icon library. `NavxIconMap` is where a name becomes
 * markup.
 */
export type NavxIconName =
  | 'home'
  | 'search'
  | 'user'
  | 'cart'
  | 'settings'
  | 'mail'
  | 'menu'
  | 'sign-in'
  | 'facebook'
  | 'twitter'
  | 'instagram'
  | (string & {});

/**
 * How a name becomes markup.
 *
 * A `string` is emitted as `<i class="…">`, which is what an icon *font*
 * wants. Anything else is passed to the adapter untouched, so a React consumer
 * maps to elements and a Vue consumer to components, with no branch in this
 * package.
 */
export type NavxIconMap<T = unknown> = Readonly<Record<string, string | T>>;

export interface NavxImage {
  /**
   * Resolved against `NavxContent.assetBase` when it is relative, so demo
   * content stays portable — the extracted catalogue carries `logo.png`, not
   * one of the 112 `/legacy/Catalogue/catalogue_files/...` paths it was
   * scraped from. An absolute URL or a `data:` URI is used as given.
   */
  readonly src: string;
  readonly alt: string;
  /**
   * Passed through verbatim. The legacy demo pages put Bootstrap utilities
   * here (`img-fluid`, `pl-lg-3`); they are the *page's* classes, not NAVX's,
   * so they travel as consumer content rather than as part of a preset.
   */
  readonly className?: string;
}

/** The fields every clickable thing in a nav shares. */
export interface NavxLink {
  readonly label?: string;
  readonly href?: string;
  readonly icon?: NavxIconName;
  readonly image?: NavxImage;
  /** Rendered as `.navx-badge` inside the link — a count, usually. */
  readonly badge?: string;
  /**
   * Hide the label while the nav is a bar, keeping it in the drawer. Legacy
   * spelled this `hide-on-landscape` on a `<span>`; Stage 2 owns it as
   * `.navx-hide-in-bar`.
   */
  readonly labelHiddenInBar?: boolean;
  /**
   * Wrap the label in a `<span>` rather than emitting a bare text node.
   *
   * Only exists for pixel fidelity to the catalogue, which is inconsistent:
   * 71 of its 315 links wrap the label and the rest do not, and
   * `.navx-link i + span` means the difference shows — an icon followed by
   * bare text sits flush against it. Set automatically in the extracted demo
   * content; ignore it when writing your own, where a `<span>` is implied by
   * `icon`, `badge` or `labelHiddenInBar` needing something to hang on.
   */
  readonly wrapLabel?: boolean;
  /**
   * Hide this link while the nav is a drawer (`.navx-hide-in-panel`).
   *
   * The mirror of `labelHiddenInBar`, and legacy's `hide-on-portrait`. Some
   * things earn a place in a wide bar and only clutter a narrow drawer — an
   * avatar next to a full menu, say.
   */
  readonly hiddenInPanel?: boolean;
  /** Emits `data-navx-current`, which Stage 2 styles and Stage 3 reads. */
  readonly current?: boolean;
}

/** A top-level item. `variant` maps to Stage 2's `data-navx-item`. */
export interface NavxItem extends NavxLink {
  readonly variant?: 'icon' | 'avatar' | 'brand' | 'logo';
  readonly submenu?: NavxSubmenu;
  /**
   * Hide the whole `<li>` in drawer mode, rather than just its link.
   *
   * Separate from the inherited `hiddenInPanel` because the catalogue uses
   * both placements — 7 on the link, 4 on the item — and while the two look
   * identical when the link fills its item, "looks identical" is precisely the
   * kind of assumption the pixel gate exists to test rather than trust.
   */
  readonly hideItemInPanel?: boolean;
}

export interface NavxSubmenuItem extends NavxLink {
  /** Nested to depth 4 in the corpus, so this recurses. */
  readonly submenu?: NavxSubmenu;
}

/**
 * A dropdown or a mega-menu.
 *
 * These are genuinely different shapes rather than one shape with a flag: a
 * dropdown is a list of links, a mega-menu is a grid of content blocks. Legacy
 * modelled them as two class names on unrelated element trees and so does
 * Stage 2 (`.navx-submenu` vs `.navx-megamenu`).
 */
export type NavxSubmenu =
  | {
      readonly type: 'dropdown';
      /** `data-navx-submenu-side="start"` — opens toward the inline start. */
      readonly side?: 'start';
      /** `data-navx-submenu="horizontal"`. */
      readonly horizontal?: boolean;
      readonly items: readonly NavxSubmenuItem[];
    }
  | {
      readonly type: 'megamenu';
      readonly rows: readonly NavxRow[];
      /** `data-navx-width` — the panel's share of the container. */
      readonly width?: 'quarter' | 'half';
    };

export interface NavxRow {
  readonly cols: readonly NavxCol[];
  /**
   * Passed through verbatim — the catalogue's rows carry Bootstrap's `mb-3`.
   *
   * Mega-menu grids are the one place NAVX renders a consumer's *content
   * layout* rather than its own chrome, so utility classes reach three
   * elements there: the row, the column and the blocks inside. Dropping them
   * on the column cost 10% of `ex-megamenu`, which is what `p-2` is worth.
   */
  readonly className?: string;
}

export interface NavxCol {
  /** 1–12. Omit for an equal share; the corpus uses 3, 6 and 9. */
  readonly span?: number;
  readonly blocks: readonly NavxBlock[];
  /** Passed through verbatim — the catalogue's columns carry `p-2`. */
  readonly className?: string;
}

/** What can sit inside a mega-menu column. All five occur in the corpus. */
export type NavxBlock =
  | { readonly type: 'list'; readonly heading?: NavxLink; readonly items: readonly NavxLink[] }
  | { readonly type: 'image'; readonly image: NavxImage }
  | {
      readonly type: 'heading';
      readonly text: string;
      readonly level?: 2 | 3 | 4 | 5 | 6;
      /**
       * Passed through verbatim, like an image's or a paragraph's.
       *
       * Omitting this field was a real defect: every mega-menu heading in the
       * catalogue carries Bootstrap's `mt-3`, and dropping it moved the
       * heading and everything under it up 16px. The pixel gate caught it at
       * 25% on `ex-megamenu`.
       */
      readonly className?: string;
    }
  | { readonly type: 'text'; readonly text: string; readonly className?: string }
  /** Nested grids — five in the corpus. */
  | { readonly type: 'row'; readonly row: NavxRow };

/** One `.navx-menu`. A nav may have several; 13 variants add a social one. */
export interface NavxMenu {
  /** `.navx-social` — icon-only, and excluded from the shape skins. */
  readonly social?: boolean;
  /**
   * Push this menu toward one edge — `.navx-push-end` / `.navx-push-start`,
   * which is `margin-inline-start: auto` and so flips correctly in RTL.
   * Legacy spelled these `align-to-right` and `align-to-left`, which mean the
   * wrong thing in Arabic.
   */
  readonly push?: 'start' | 'end';
  /**
   * `.navx-spaced` — separates this menu from the one above it.
   *
   * 12 of the catalogue's 13 social menus carry it (legacy's `margin-top`),
   * so leaving it unmodelled shifted every one of them.
   */
  readonly spaced?: boolean;
  readonly items: readonly NavxItem[];
}

/** Modifiers any panel section can carry. */
export interface NavxSectionBase {
  /** `.navx-push-end` / `.navx-push-start` on the section itself. */
  readonly push?: 'start' | 'end';
  /**
   * Where the section sits relative to the menus. Defaults to `after-menus`.
   *
   * Two of the catalogue's 56 variants put their sections *first*, and
   * emitting menus-then-sections unconditionally reordered the whole drawer
   * for both. Only these two positions occur, so only these two exist —
   * arbitrary interleaving would be a schema this corpus cannot justify.
   */
  readonly place?: 'before-menus' | 'after-menus';
}

/** A `.navx-panel-section` — the drawer's non-menu content. */
export type NavxSection =
  | (NavxSectionBase & {
      readonly type: 'button';
      readonly label?: string;
      /** NAVX's own CSS-drawn magnifier — see the form variant's `glyph`. */
      readonly glyph?: 'search';
      readonly icon?: NavxIconName;
      readonly href?: string;
    })
  | (NavxSectionBase & {
      readonly type: 'form';
      readonly input: {
        readonly type?: string;
        readonly name?: string;
        readonly placeholder?: string;
      };
      readonly submit?: {
        /**
         * NAVX's own magnifier, drawn in CSS by `.navx-search-icon` — a
         * rotated bordered circle plus a `::before` handle, no font and no
         * dependency. Distinct from `icon`, which goes through the consumer's
         * icon map: mapping this one to `fas fa-search` put both classes on
         * the element and drew two magnifiers.
         */
        readonly glyph?: 'search';
        readonly icon?: NavxIconName;
        readonly label?: string;
      };
    })
  | (NavxSectionBase & { readonly type: 'text'; readonly text: string });

/** A logo: an image wrapped in a link. 47 of 56 variants have one. */
export interface NavxLogo {
  readonly image: NavxImage;
  readonly href?: string;
  /**
   * Hide this logo while the nav is a bar (`.navx-hide-in-bar`).
   *
   * A nav with a logo in the header *and* one in the drawer shows only one at
   * a time, and this is how the catalogue says which.
   */
  readonly hiddenInBar?: boolean;
}

/**
 * The chrome of a nav: everything that is not content.
 *
 * No labels, no hrefs, no URLs — which is why a preset is a few hundred bytes
 * and why swapping preset does not touch your menu. `slots` records what the
 * catalogue variant *had*, so a preset renders the same shell even before you
 * supply items.
 */
export interface NavxPreset {
  /** Stable id, matching the demo subpath: `@navx/presets/demo/<id>`. */
  readonly id: string;
  /** Human name, for docs and the gallery. */
  readonly name: string;

  /** `data-navx-align` — `between` was legacy's `navigation-justified`. */
  readonly align?: 'between' | 'center';
  /** `data-navx-logo="top"` — legacy's `navigation-logo-top`. */
  readonly logo?: 'top';
  /** `data-navx-position` — legacy's `sticky-top`. */
  readonly position?: 'sticky' | 'fixed';
  readonly transparent?: boolean;
  readonly fullscreen?: boolean;

  /** One of the ten skins in `@navx/tokens/skins`. */
  readonly skin?: NavxSkin;

  /** Passed to `attach()`. A preset may prefer hover; the consumer may not. */
  readonly trigger?: 'click' | 'hover';

  /** Which slots the variant fills. Content for them is yours. */
  readonly slots: {
    readonly logo?: boolean;
    readonly brand?: boolean;
    readonly panelLogo?: boolean;
    readonly panelBrand?: boolean;
    /** One entry per `.navx-menu`, in document order. */
    readonly menus: readonly {
      readonly social?: boolean;
      readonly push?: 'start' | 'end';
      readonly spaced?: boolean;
    }[];
    readonly sections: readonly NavxSection['type'][];
    /**
     * Whether any section is pushed to an edge. Part of the chrome, so it
     * belongs in the dedupe key: two variants alike except that one pushes its
     * search form to the inline end are not the same shell.
     */
    readonly sectionPush?: boolean;
    /**
     * Modifiers on the drawer's own header. Chrome, so they live here and
     * count toward whether two variants are the same shell.
     */
    readonly panelHeader?: {
      readonly hiddenInBar?: boolean;
      readonly push?: 'start' | 'end';
    };
  };
}

export type NavxSkin =
  | 'border-bottom'
  | 'border-top'
  | 'border-top-bottom'
  | 'bottom-arrow'
  | 'boxed'
  | 'colored'
  | 'dark'
  | 'gradient'
  | 'mini-circle'
  | 'rounded-boxed';

/**
 * The content half: what a preset deliberately does not carry.
 *
 * `@navx/presets/demo/<id>` exports one of these per variant, reproducing the
 * catalogue page. Yours will look the same and say something else.
 */
export interface NavxContent {
  readonly logo?: NavxLogo;
  readonly brand?: NavxLink;
  readonly panelLogo?: NavxLogo;
  readonly panelBrand?: NavxLink;
  /** Parallel to `preset.slots.menus`. */
  readonly menus: readonly NavxMenu[];
  /** Parallel to `preset.slots.sections`. */
  readonly sections: readonly NavxSection[];
  /** Accessible name for the toggler, which has no text of its own. */
  readonly labelToggler?: string;
  /** Accessible name for the drawer's close control. */
  readonly labelClose?: string;
  /**
   * Visible glyph inside the close control — legacy used a bare `✕`.
   *
   * Separate from `labelClose` on purpose. Reusing the glyph as the accessible
   * name makes a screen reader announce "multiplication x", which is what the
   * first version of the planner did.
   */
  readonly closeGlyph?: string;
  /**
   * Prefix for relative `NavxImage.src` values. The demo modules leave this
   * unset so nothing 404s by default; the Stage 5 pixel gate points it at the
   * legacy asset folder, which is how the rendered preset can be compared
   * against a screenshot of the original.
   */
  readonly assetBase?: string;
}
