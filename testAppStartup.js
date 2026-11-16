#!/usr/bin/env node
// The page's own start-up, run once against a page just real enough to get through it.
//
// app.js is a single script that wires the whole list as it loads: it puts the remembered tab
// on screen, and that already narrows the rows and counts the menu beside the search. A name
// declared with `const` further down the file exists but is not yet in scope there, and
// reading it threw `Cannot access 'FILTER_PARAMS' before initialization`. The load stopped
// halfway: both lists' filter rows stayed on screen and neither the tabs nor the type headings
// answered, because the handlers below the throw were never attached.
//
// No browser is needed to see that. This runs the real file against a page of stand-ins and
// lets it throw if it is going to, which is the one thing the other suites could not do: they
// call a function or two out of it, and a startup that never finishes is invisible to them.
//
//   npm run test:app-startup

import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');

const noop = () => {};

// One tab, one filter row, one list region: enough that the first render reaches the counts.
function fakePage() {
  const countSpan = { textContent: '' };
  const tabButton = {
    dataset: { tab: 'request' },
    querySelector: (selector) => (selector === '.tab-count' ? countSpan : null),
    setAttribute: noop,
    getAttribute: () => null,
    tabIndex: -1,
    focus: noop,
    classList: { contains: () => false, add: noop, remove: noop },
    addEventListener: noop,
  };

  // One row for the tab's number to count, so a start-up that gets all the way through has
  // written a number rather than merely not thrown.
  const row = { hasAttribute: () => false };
  const listRegion = {
    dataset: {},
    querySelectorAll: (selector) => {
      if (selector === '[data-tab]') return [tabButton];
      if (selector === '[data-counts-tab="request"]') return [row];
      return [];
    },
    querySelector: () => null,
    addEventListener: noop,
    getBoundingClientRect: () => ({ height: 0 }),
  };

  const filterCard = {
    hidden: true,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ height: 0 }),
  };

  const filterForm = {
    dataset: { filterList: 'request' },
    hidden: false,
    querySelectorAll: () => [],
    querySelector: () => null,
    getBoundingClientRect: () => ({ height: 0 }),
  };

  const element = {
    dataset: {},
    style: { setProperty: noop, getPropertyValue: () => '' },
    classList: { contains: () => false, add: noop, remove: noop },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    appendChild: (node) => node,
    insertBefore: noop,
    setAttribute: noop,
    getAttribute: () => null,
    hasAttribute: () => false,
    getBoundingClientRect: () => ({ height: 0 }),
    cloneNode: () => element,
    firstChild: null,
    childNodes: [],
    textContent: '',
    hidden: false,
  };

  const document = {
    getElementById: (id) =>
      id === 'itemLists' ? listRegion : id === 'itemFilters' ? filterCard : element,
    querySelector: (selector) =>
      selector === '.top-bar' || selector === '.list-head' ? element : null,
    querySelectorAll: (selector) => (selector === '[data-filters]' ? [filterForm] : []),
    addEventListener: noop,
    removeEventListener: noop,
    createElement: () => element,
    createDocumentFragment: () => element,
    body: element,
    head: element,
    documentElement: element,
    hidden: false,
    cookie: '',
  };

  const window = {
    document,
    location: { search: '', pathname: '/', href: 'http://localhost/', origin: 'http://localhost' },
    history: { replaceState: noop, pushState: noop },
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout: () => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    sessionStorage: { getItem: () => null, setItem: noop },
    localStorage: { getItem: () => null, setItem: noop },
    innerHeight: 900,
    innerWidth: 1400,
    scrollTo: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    requestAnimationFrame: () => 0,
  };

  return { document, window, listRegion, tabButton, filterForm };
}

let total = 0;
let failures = 0;

function t(label, run) {
  total += 1;

  try {
    run();
    console.log('ok   ' + label);
  } catch (error) {
    failures += 1;
    console.log('FAIL ' + label + '\n     ' + error.message);
  }
}

const page = fakePage();

for (const [name, value] of Object.entries({
  window: page.window,
  document: page.document,
  sessionStorage: page.window.sessionStorage,
  localStorage: page.window.localStorage,
  location: page.window.location,
  history: page.window.history,
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  io: () => ({ on: noop, emit: noop, connected: false, disconnect: noop }),
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }),
  requestAnimationFrame: page.window.requestAnimationFrame,
})) {
  globalThis[name] = value;
}

t('the page runs its own start-up without throwing', () => {
  assert.doesNotThrow(() => new Function(source)(), 'app.js stops part-way through its load');
});

t('and gets as far as counting the rows the tab drew', () => {
  // A render that finished counts the page's one row and writes it on the tab. A load that
  // stopped half-way would leave the number blank, which is the second half of what the
  // broken version did: no numbers, and both filter rows still on screen.
  assert.equal(page.tabButton.querySelector('.tab-count').textContent, '1');
});

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
