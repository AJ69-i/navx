/**
 * Stage 5 gate A — do all the adapters render the same DOM?
 *
 * The render-plan design rests on one claim: there is exactly one description
 * of nav markup in NAVX, and the adapters only walk it. That claim is worth
 * nothing unasserted, because the failure it prevents is *silent* — React and
 * Vue drifting apart over a release or two, and nobody noticing until a
 * consumer files a bug about a class that exists in one framework's output and
 * not another's.
 *
 * So this renders all 56 extracted variants through every independent path and
 * requires them to agree exactly:
 *
 *   html()                     the string serialiser (SSR, and the reference)
 *   render()                   real DOM, via jsdom
 *   React                      createElement + renderToStaticMarkup
 *   Vue                        h + renderToString
 *   <navx-preset>              the custom element, which calls render()
 *   use:navxPreset             the Svelte action, which calls render()
 *
 * The last two are not redundant with `render()`: they prove each adapter
 * *calls* it correctly and puts the result in the right place, which is where
 * a wrapper element or a doubled subtree would show up.
 *
 * The Angular directive uses `render()` on the same code path as those two.
 * It is exercised by `packages/angular`'s own compile gate rather than here,
 * because instantiating a directive needs Angular's injector and a TestBed —
 * a lot of machinery to re-verify a function this file already checks.
 *
 * Comparison is on a canonical serialisation: attributes sorted, whitespace
 * between elements dropped. Attribute *order* is a framework artifact, not a
 * difference in the DOM, and normalising it is what makes "identical" mean
 * something rather than "React happened to emit class first".
 */

import { JSDOM } from 'jsdom';

/**
 * jsdom first, then the adapters — and the order is load-bearing.
 *
 * `@navx/element/preset` declares `class NavxPresetElement extends HTMLElement`
 * at module scope, which is evaluated on import. A static import would run it
 * before these globals exist and throw `HTMLElement is not defined`, so the
 * adapters are pulled in dynamically below. jsdom also has no ResizeObserver,
 * which `attach()` already handles by falling back to a window resize listener
 * — the Stage 4 finding, reused here for free.
 */
const dom = new JSDOM('<body></body>');
const { document } = dom.window;
globalThis.document = document;
globalThis.window = dom.window;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CustomEvent = dom.window.CustomEvent;
/**
 * jsdom's AbortController, not Node's.
 *
 * `attach()` hangs every listener off one signal, and jsdom brand-checks that
 * signal against *its own* `AbortSignal` class. Leaving Node's global in place
 * makes `addEventListener` reject it with "member 'signal' that is not of type
 * AbortSignal" — a cross-realm artifact of this harness, not a library defect;
 * in a browser both come from the same realm. vitest's jsdom environment
 * installs these for us, which is why the adapter unit tests never saw it.
 */
globalThis.AbortController = dom.window.AbortController;
globalThis.AbortSignal = dom.window.AbortSignal;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const { byFixture, html, plan, render } = await import('@navx/presets');
const { attach, createNav } = await import('@navx/core');
const { NavxPresetElement, defineNavxPreset } = await import('@navx/element/preset');
const { navxPreset } = await import('@navx/svelte/preset');
const { Navx: ReactNavx } = await import('@navx/react/preset');
const { Navx: VueNavx } = await import('@navx/vue/preset');
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { createSSRApp, h } = await import('vue');
const { renderToString } = await import('@vue/server-renderer');

/**
 * The icon map that reproduces the legacy catalogue.
 *
 * Presets carry semantic names (`icon: 'home'`), which is the whole point —
 * `@navx/presets` names no icon library. This is the mapping that makes the
 * rendered output comparable to screenshots of a page that used Font Awesome.
 */
export const LEGACY_ICONS = {
  home: 'fas fa-home',
  search: 'fas fa-search',
  user: 'fas fa-user',
  cart: 'fas fa-shopping-cart',
  settings: 'fas fa-cog',
  mail: 'fas fa-envelope',
  menu: 'fas fa-bars',
  'sign-in': 'fas fa-sign-in-alt',
  facebook: 'fab fa-facebook-f',
  twitter: 'fab fa-twitter',
  instagram: 'fab fa-instagram',
};

const IDS = Object.keys(byFixture);

/* ── canonical form ─────────────────────────────────────────────────────── */

const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link']);

/**
 * One serialisation, applied to every path's output, so differences that
 * survive are differences in the DOM rather than in a serialiser.
 */
function canonical(el) {
  const attrs = [...el.attributes]
    .map((a) => [a.name, a.value])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([n, v]) => ` ${n}="${v.replace(/"/g, '&quot;')}"`)
    .join('');
  const tag = el.tagName.toLowerCase();
  if (VOID.has(tag)) return `<${tag}${attrs}>`;

  let inner = '';
  for (const child of el.childNodes) {
    if (child.nodeType === 3) {
      const text = child.textContent.replace(/\s+/g, ' ');
      // Whitespace *between* elements is layout-irrelevant here and differs by
      // renderer; whitespace inside a text run is content and is kept.
      if (text.trim() === '') continue;
      inner += text.trim();
    } else if (child.nodeType === 1) {
      inner += canonical(child);
    }
    // Comments are skipped: Vue's SSR emits fragment anchors that carry no DOM.
  }
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/**
 * Find the nav, not the first element.
 *
 * React 19 hoists resource hints: an `<img>` in its output also produces a
 * `<link rel="preload" as="image">`, emitted *before* the tree, which belongs
 * in `<head>` and is not part of the nav. Taking `firstElementChild` compared
 * that link against our `<nav>` and reported 47 divergences that were all the
 * same non-difference. Selecting the nav is the precise fix; the preload hints
 * are React doing something useful with the `loading="eager"` the baselines
 * were captured with.
 */
const parse = (markup) => {
  const scratch = document.createElement('div');
  scratch.innerHTML = markup;
  return scratch.querySelector('nav.navx') ?? scratch.firstElementChild;
};

const fromMarkup = (markup) => canonical(parse(markup));

/* ── the paths ──────────────────────────────────────────────────────────── */

/**
 * Two groups, because `attach()` writes to the DOM.
 *
 * The core normalises ARIA on whatever it is given — that is its job — so an
 * adapter that renders *and binds* cannot be compared against one that only
 * renders. Splitting them keeps both comparisons exact instead of introducing
 * an allowance list, and buys a second assertion for free: that `attach()`
 * produces the same DOM whichever adapter called it.
 *
 *   pure      what the plan says, before any behaviour is bound
 *   attached  the same tree after attach() has normalised it
 */
async function pathsFor(id) {
  const preset = byFixture[id];
  const { content } = await import(`@navx/presets/demo/${id}`);
  const options = { icons: LEGACY_ICONS, overlay: true };
  const tree = plan(preset, content, options);

  const pure = {};
  const attached = {};

  pure['html()'] = fromMarkup(html(tree));
  pure['render()'] = canonical(render(tree, document));

  pure.react = fromMarkup(
    renderToStaticMarkup(createElement(ReactNavx, { preset, content, ...options })),
  );

  const app = createSSRApp({ render: () => h(VueNavx, { preset, content, ...options }) });
  pure.vue = fromMarkup(await renderToString(app));

  // The reference for the attached group: render, then bind, by hand.
  const bare = render(tree, document);
  document.body.append(bare);
  const machine = createNav();
  const detach = attach(bare, machine, preset.trigger ? { trigger: preset.trigger } : {});
  attached['render()+attach()'] = canonical(bare);
  detach();
  machine.dispose();
  bare.remove();

  // The custom element: properties in, bound DOM out.
  defineNavxPreset();
  const host = document.createElement('navx-preset');
  document.body.append(host);
  Object.setPrototypeOf(host, NavxPresetElement.prototype);
  host.options = options;
  host.preset = preset;
  host.content = content;
  host.connectedCallback();
  attached['<navx-preset>'] = canonical(host.firstElementChild);
  host.disconnectedCallback();
  host.remove();

  // The Svelte action, driven exactly as the compiler would drive it.
  const node = document.createElement('div');
  document.body.append(node);
  const action = navxPreset(node, { preset, content, ...options });
  attached['use:navxPreset'] = canonical(node.firstElementChild);
  action.destroy();
  node.remove();

  return { pure, attached };
}

/* ── run ────────────────────────────────────────────────────────────────── */

const failures = [];
let compared = 0;
let bytes = 0;

const check = (id, group, groupName, referenceName) => {
  const reference = group[referenceName];
  for (const [name, value] of Object.entries(group)) {
    compared++;
    if (value === reference) continue;
    let i = 0;
    while (i < reference.length && i < value.length && reference[i] === value[i]) i++;
    failures.push({
      id,
      path: `${groupName}/${name}`,
      detail:
        `diverges at byte ${i}\n` +
        `    ${referenceName}: …${reference.slice(Math.max(0, i - 60), i + 60)}\n` +
        `    ${name}: …${value.slice(Math.max(0, i - 60), i + 60)}`,
    });
  }
};

for (const id of IDS) {
  let groups;
  try {
    groups = await pathsFor(id);
  } catch (error) {
    failures.push({ id, path: '(threw)', detail: String(error?.stack ?? error) });
    continue;
  }
  bytes += groups.pure['html()'].length;
  check(id, groups.pure, 'pure', 'html()');
  check(id, groups.attached, 'attached', 'render()+attach()');
}

console.log('\nStage 5 · cross-adapter DOM identity\n');
console.log(`  variants          ${IDS.length}`);
console.log('  pure paths        4  html(), render(), React SSR, Vue SSR');
console.log('  attached paths    3  render()+attach(), <navx-preset>, use:navxPreset');
console.log(`  comparisons       ${compared}`);
console.log(`  reference bytes   ${bytes.toLocaleString()}`);

if (failures.length) {
  console.error(`\n  ${failures.length} divergence(s):\n`);
  for (const f of failures.slice(0, 10)) {
    console.error(`  ${f.id} · ${f.path}\n    ${f.detail}\n`);
  }
  if (failures.length > 10) console.error(`  … and ${failures.length - 10} more`);
  process.exit(1);
}

console.log(
  `\n  every path produces byte-identical canonical DOM for all ${IDS.length} variants.\n`,
);
