#!/usr/bin/env node
// The page's own start-up, and the two presses a reader makes before anything else: the tab
// they came for and the type heading they want opened. All three run the real app.js against a
// page of stand-ins.
//
// app.js is a single script that wires the whole list as it loads: it puts the remembered tab
// on screen, and that already narrows the rows and counts the menu beside the search. A name
// declared with `const` further down the file exists but is not yet in scope there, and
// reading it threw `Cannot access 'FILTER_PARAMS' before initialization`. The load stopped
// halfway: both lists' filter rows stayed on screen and neither the tabs nor the type headings
// answered, because the handlers below the throw were never attached.
//
// No browser is needed to see any of that. This runs the whole file, then hands the list
// region's own click listener the element a reader would have pressed, so a handler that never
// got attached, or one that throws when it runs, fails here rather than on the site.
//
//   npm run test:app-startup

import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');

const noop = () => {};

// A stand-in element with just enough of an element about it: the attributes a handler reads
// back, the class list a fold toggles, the rows a heading covers, and the closest() that
// tells a delegated click which control it hit.
function makeElement({ tagName = 'DIV', dataset = {}, attributes = {}, classes = [] } = {}) {
  const attrs = new Map(Object.entries(attributes));
  const names = new Set(classes);

  const element = {
    tagName,
    dataset,
    hidden: false,
    tabIndex: -1,
    title: '',
    textContent: '',
    nextElementSibling: null,
    focused: false,
    style: { setProperty: noop, getPropertyValue: () => '', removeProperty: noop },
    classList: {
      contains: (name) => names.has(name),
      add: (name) => names.add(name),
      remove: (name) => names.delete(name),
      toggle: (name, force) => {
        const on = force === undefined ? !names.has(name) : Boolean(force);
        if (on) names.add(name);
        else names.delete(name);
        return on;
      },
    },
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    hasAttribute: (name) => attrs.has(name),
    focus: () => {
      element.focused = true;
    },
    appendChild: (node) => node,
    insertBefore: (node) => node,
    removeChild: noop,
    cloneNode: () => element,
    remove: noop,
    childNodes: [],
    children: [],
    firstChild: null,
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getBoundingClientRect: () => ({ height: 0 }),
  };

  return element;
}

// The page as the list scripts see it: two tabs, their two panels, one row for the tab's
// number to count, and one type heading over two rows.
function fakePage() {
  const tabs = {
    request: makeElement({
      tagName: 'BUTTON',
      dataset: { tab: 'request' },
      attributes: { 'aria-selected': 'true' },
    }),
    offer: makeElement({
      tagName: 'BUTTON',
      dataset: { tab: 'offer' },
      attributes: { 'aria-selected': 'false' },
    }),
  };

  for (const tab of Object.values(tabs)) {
    const count = { textContent: '' };

    tab.closest = (selector) => (selector === '[data-tab]' ? tab : null);
    tab.querySelector = (selector) => (selector === '.tab-count' ? count : null);
    tab.count = () => count.textContent;
  }

  const panels = {
    request: makeElement({ dataset: { panel: 'request' } }),
    offer: makeElement({ dataset: { panel: 'offer' } }),
  };

  panels.offer.hidden = true;

  const countRow = makeElement({ tagName: 'TR' });

  const heading = makeElement({ tagName: 'TR', classes: ['type-row'] });
  const firstRow = makeElement({ tagName: 'TR' });
  const secondRow = makeElement({ tagName: 'TR' });

  heading.nextElementSibling = firstRow;
  firstRow.nextElementSibling = secondRow;

  const typeToggle = makeElement({
    tagName: 'BUTTON',
    attributes: {
      'data-type-toggle': 'Apparel',
      'data-group-list': 'request',
      'aria-expanded': 'true',
    },
  });

  typeToggle.closest = (selector) => {
    if (selector === '[data-type-toggle]') return typeToggle;
    if (selector === '.type-row') return heading;
    return null;
  };

  heading.querySelector = (selector) => (selector === '[data-type-toggle]' ? typeToggle : null);

  const listRegion = makeElement({});

  listRegion.querySelectorAll = (selector) => {
    if (selector === '[data-tab]') return [tabs.request, tabs.offer];
    if (selector === '[data-panel]') return [panels.request, panels.offer];
    if (selector === '[data-counts-tab="request"]') return [countRow];
    return [];
  };

  listRegion.querySelector = (selector) => {
    if (selector === '[data-panel="request"]') return panels.request;
    if (selector === '[data-panel="offer"]') return panels.offer;
    return null;
  };

  // The delegated listeners the page attaches to the list region, kept so the test can press
  // a control the way a reader would.
  const listeners = [];

  listRegion.addEventListener = (type, handler) => {
    listeners.push({ type, handler });
  };

  function press(target) {
    const event = { target, button: 0, prevented: false, preventDefault: () => (event.prevented = true) };

    for (const listener of listeners.filter((entry) => entry.type === 'click')) {
      listener.handler(event);
    }

    return event;
  }

  const filterCard = makeElement({});
  filterCard.hidden = true;

  const filterForm = makeElement({ dataset: { filterList: 'request' } });

  // The cookie jar the folds and the grouping are remembered in.
  let jar = '';

  // The toast, and the overlay the whole-page drop draws on itself the first time a file is
  // carried over the page.
  const toast = makeElement({});
  const appended = [];
  const pageListeners = [];
  const body = makeElement({});

  body.appendChild = (node) => {
    appended.push(node);
    return node;
  };

  const document = {
    getElementById: (id) => {
      if (id === 'itemLists') return listRegion;
      if (id === 'itemFilters') return filterCard;
      if (id === 'toast') return toast;
      return null;
    },
    querySelector: (selector) =>
      selector === '.top-bar' || selector === '.list-head' ? makeElement({}) : null,
    querySelectorAll: (selector) => (selector === '[data-filters]' ? [filterForm] : []),
    addEventListener: (type, handler) => pageListeners.push({ type, handler }),
    removeEventListener: noop,
    createElement: () => makeElement({}),
    createDocumentFragment: () => makeElement({}),
    body,
    head: makeElement({}),
    documentElement: makeElement({}),
    hidden: false,
  };

  // A file dragged over the page, and the drop that follows it: the two events the page-wide
  // upload listens for.
  function dragEvent(type, file) {
    const event = {
      type,
      target: body,
      defaultPrevented: false,
      prevented: false,
      preventDefault: () => {
        event.prevented = true;
        event.defaultPrevented = true;
      },
      dataTransfer: { types: file === null ? ['text/plain'] : ['Files'], files: file ? [file] : [], dropEffect: '' },
    };

    for (const listener of pageListeners.filter((entry) => entry.type === type)) {
      listener.handler(event);
    }

    return event;
  }

  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => jar,
    set: (value) => {
      const pair = value.split(';')[0];
      const name = pair.slice(0, pair.indexOf('='));
      const kept = jar.split('; ').filter((entry) => entry && !entry.startsWith(`${name}=`));
      kept.push(pair);
      jar = kept.join('; ');
    },
  });

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

  return {
    document,
    window,
    tabs,
    panels,
    heading,
    typeToggle,
    rows: [firstRow, secondRow],
    press,
    toast,
    appended,
    carriedOver: (file) => dragEvent('dragenter', file),
    dropped: (file) => dragEvent('drop', file),
    cookie: (name) => {
      const match = jar.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? decodeURIComponent(match[1]) : '';
    },
  };
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

// Every upload the page sends, in the order it sent them.
const uploads = [];

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
  fetch: async (url, options = {}) => {
    uploads.push({ url, options });
    return { ok: false, status: 400, json: async () => ({ error: 'that file was refused' }), text: async () => '' };
  },
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
  assert.equal(page.tabs.request.count(), '1');
});

t('pressing a tab brings up that tab’s list', () => {
  // The handler the page attaches to the list region, given the element a reader pressed. A
  // load that threw before that listener was attached would leave both panels as they were.
  page.press(page.tabs.offer);

  assert.equal(page.panels.offer.hidden, false, 'the tab that was pressed is the one on screen');
  assert.equal(page.panels.request.hidden, true, 'and the tab being left is hidden');
  assert.equal(page.tabs.offer.getAttribute('aria-selected'), 'true', 'and the strip agrees');
  assert.equal(page.tabs.request.getAttribute('aria-selected'), 'false');
});

t('pressing a type heading folds its rows away and remembers it', () => {
  page.press(page.typeToggle);

  assert.equal(page.typeToggle.getAttribute('aria-expanded'), 'false', 'the caret points at shut rows');
  assert.equal(page.heading.classList.contains('is-collapsed'), true);
  assert.ok(page.rows.every((row) => row.hidden), 'every row under the heading goes with it');
  assert.equal(page.cookie('guildsbounty_collapsed'), 'Apparel', 'and a refresh keeps them shut');
});

t('pressing it again brings the rows back', () => {
  page.press(page.typeToggle);

  assert.equal(page.typeToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(page.heading.classList.contains('is-collapsed'), false);
  assert.ok(page.rows.every((row) => row.hidden === false), 'the rows are on screen again');
  assert.equal(page.cookie('guildsbounty_collapsed'), '', 'and nothing is remembered as folded');
});

t('a saved variables file dropped anywhere on the page is uploaded', () => {
  const file = new File(['# saved vars'], 'GuildsBountySavedVars.lua', { type: 'text/plain' });

  // Carried over the page first: the whole page is the target, so the overlay is what tells
  // the reader that letting go here will do something.
  page.carriedOver(file);

  const overlay = page.appended.find((node) => node.id === 'dropOverlay');

  assert.ok(overlay, 'the page says where the file will go');
  assert.equal(overlay.hidden, false, 'and says it while the file is over the page');

  page.dropped(file);

  assert.equal(uploads.length, 1, 'the drop is an upload');
  assert.equal(uploads[0].url, '/upload', 'to the one upload route the card uses');
  assert.equal(overlay.hidden, true, 'and the overlay is taken away again');
});

t('dropping something else says so and sends nothing', () => {
  const sent = uploads.length;

  page.dropped(new File(['x'], 'notes.pdf', { type: 'application/pdf' }));

  assert.equal(uploads.length, sent, 'nothing leaves the page');
  assert.match(page.toast.textContent, /is not a saved variables file/, 'and the toast says why');
});

t('a guest is told to sign in rather than shown an upload error', () => {
  const sent = uploads.length;

  page.document.body.dataset.guestRequest = '1';
  page.dropped(new File(['x'], 'GuildsBountySavedVars.lua'));
  delete page.document.body.dataset.guestRequest;

  assert.equal(uploads.length, sent, 'nothing is sent without a sign-in');
  assert.match(page.toast.textContent, /Sign in with Discord or Google/, 'and the toast asks for one');
});

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
