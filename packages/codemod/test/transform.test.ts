/**
 * The codemod.
 *
 * Most of these test what it declines to do. A rename tool's useful failures
 * are not "missed a class" — that shows up immediately and is easy to fix —
 * but "quietly changed something it did not understand", which shows up weeks
 * later in a file nobody thought to re-read.
 */

import { describe, expect, it } from 'vitest';
import { KNOWN_TOKENS, translateToken } from '../src/map.js';
import { transform } from '../src/transform.js';

describe('translateToken', () => {
  it('renames a class', () => {
    expect(translateToken('navigation-body').classes).toEqual(['navx-panel']);
  });

  it('promotes a modifier to an attribute', () => {
    expect(translateToken('navigation-justified').attrs).toEqual([['data-navx-align', 'between']]);
  });

  it('explains a dropped class rather than silently removing it', () => {
    const result = translateToken('submenu-indicator-left');
    expect(result.classes).toEqual([]);
    expect(result.dropped).toContain(':has()');
  });

  it('handles the numbered column pattern the tables cannot list', () => {
    expect(translateToken('navigation-col-7').classes).toEqual(['navx-col-7']);
  });

  it("passes a consumer's own classes through untouched", () => {
    for (const foreign of ['col-md-6', 'fa-home', 'btn', 'my-nav', 'tw-flex']) {
      const result = translateToken(foreign);
      expect(result.classes).toEqual([foreign]);
      expect(result.foreign).toBe(true);
    }
  });

  it('flags an unknown navigation-* token instead of guessing', () => {
    const result = translateToken('navigation-invented-by-someone');
    expect(result.unknown).toBe(true);
    expect(result.classes).toEqual(['navigation-invented-by-someone']);
  });

  it('knows every token exactly once', () => {
    expect(new Set(KNOWN_TOKENS).size).toBe(KNOWN_TOKENS.length);
  });
});

describe('transform', () => {
  it('rewrites classes and promotes modifiers in one tag', () => {
    const { code, report } = transform(
      '<nav id="n" class="navigation navigation-justified sticky-top">',
    );
    expect(code).toBe(
      '<nav id="n" class="navx" data-navx-align="between" data-navx-position="sticky">',
    );
    expect(report.renamed).toEqual({ 'navigation → navx': 1 });
  });

  it('preserves surrounding attributes, order and quoting', () => {
    const { code } = transform(`<div data-x='1' class='navigation-body' aria-label="Menu">`);
    expect(code).toBe(`<div data-x='1' class='navx-panel' aria-label="Menu">`);
  });

  it('keeps foreign classes beside renamed ones, in order', () => {
    const { code } = transform('<li class="col-md-6 navigation-item fa-home">');
    expect(code).toBe('<li class="col-md-6 navx-item fa-home">');
  });

  it('drops the class attribute when nothing is left', () => {
    // `navigation-justified` is the whole class list and becomes an attribute,
    // so leaving `class=""` behind would be litter.
    const { code } = transform('<nav class="navigation-justified">');
    expect(code).toBe('<nav data-navx-align="between">');
  });

  it('writes boolean attributes bare', () => {
    const { code } = transform('<nav class="navigation navigation-transparent">');
    expect(code).toBe('<nav class="navx" data-navx-transparent>');
  });

  it('leaves a self-closing tag self-closing', () => {
    const { code } = transform('<img class="navigation-logo" src="a.png" />');
    expect(code).toBe('<img class="navx-logo" src="a.png" />');
  });

  it('leaves a file with no legacy classes byte-identical', () => {
    const source = '<div class="card"><a class="btn btn-primary" href="/">Go</a></div>\n';
    const { code, report } = transform(source);
    expect(code).toBe(source);
    expect(report.changed).toBe(false);
  });

  it('refuses to touch a computed class list, and says where', () => {
    const source = `<nav className={clsx(styles.nav, isOpen && 'navigation-body')}>`;
    const { code, report } = transform(source);
    // Rewriting a string inside an expression it cannot evaluate is how a
    // codemod corrupts a file. It reports instead.
    expect(code).toBe(source);
    expect(report.dynamic).toHaveLength(1);
    expect(report.dynamic[0]?.line).toBe(1);
  });

  it('refuses Vue and Svelte class bindings too', () => {
    for (const source of [
      `<nav :class="{ 'navigation-body': open }">`,
      '<nav v-bind:class="cls">',
      '<nav class:navigation-body={open}>',
    ]) {
      expect(transform(source).code).toBe(source);
    }
  });

  it('reports unmapped navigation-* tokens without changing them', () => {
    const { code, report } = transform('<div class="navigation-item navigation-mystery">');
    expect(code).toContain('navigation-mystery');
    expect(report.unknown).toEqual({ 'navigation-mystery': 1 });
  });

  it('does not rename a substring of a longer class', () => {
    // `navigation-body-header` must not be hit by the `navigation-body` rule.
    const { code } = transform('<div class="navigation-body-header">');
    expect(code).toBe('<div class="navx-panel-header">');
  });

  it('leaves text content and script bodies alone', () => {
    const source =
      '<p>Use the navigation-body class</p><script>const c = "navigation-body";</script>';
    expect(transform(source).code).toBe(source);
  });

  it('handles a realistic legacy nav', () => {
    const { code, report } = transform(`
<nav id="navigation" class="navigation navigation-justified">
  <div class="navigation-header">
    <div class="navigation-logo"><a href="#"><img src="logo.png" alt="logo"></a></div>
    <div class="navigation-button-toggler"><i class="hamburger-icon"></i></div>
  </div>
  <div class="navigation-body">
    <ul class="navigation-menu">
      <li class="navigation-item is-active"><a class="navigation-link" href="#">Home</a></li>
      <li class="navigation-item navigation-icon-item">
        <a class="navigation-link" href="#"><i class="fas fa-search"></i><span>Search</span></a>
        <ul class="navigation-dropdown navigation-dropdown-left">
          <li class="navigation-dropdown-item"><a class="navigation-dropdown-link" href="#">One</a></li>
        </ul>
      </li>
    </ul>
  </div>
</nav>`);

    expect(code).toContain('<nav id="navigation" class="navx" data-navx-align="between">');
    expect(code).toContain('class="navx-toggler"');
    expect(code).toContain('class="navx-toggler-icon"');
    expect(code).toContain('class="navx-item" data-navx-current');
    expect(code).toContain('class="navx-item" data-navx-item="icon"');
    expect(code).toContain('class="navx-submenu" data-navx-submenu-side="start"');
    // Font Awesome is the consumer's, and survives.
    expect(code).toContain('class="fas fa-search"');
    expect(code).not.toContain('navigation-');
    expect(report.changed).toBe(true);
  });

  it('is idempotent', () => {
    const source = '<nav class="navigation navigation-justified"><ul class="navigation-menu">';
    const once = transform(source).code;
    expect(transform(once).code).toBe(once);
  });
});
