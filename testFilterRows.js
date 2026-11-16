#!/usr/bin/env node
// The filter row: which lists have one, and why Browse Offers and My Inventory no longer share
// one. A type narrowed on what other people share must not hide rows inside your own bag, and
// the two tabs whose tables are not the item list - My Requests and Requests Received - get no
// row at all. Rendered out of lib/views.js, so a change that goes back to one shared row, or
// that puts the row on every tab, fails here.
//
//   npm run test:filter-rows

import assert from 'node:assert/strict';
import fs from 'node:fs';

import { renderListRegion, filterBar, FILTER_NAMES } from './lib/views.js';

const read = (path) => fs.readFileSync(new URL(`./${path}`, import.meta.url), 'utf8');

// One function out of public/app.js, braces balanced, so a piece of the page can be run on
// its own against a fake DOM.
function functionSource(source, name) {
  const at = source.indexOf(`function ${name}(`);

  assert.ok(at > -1, `MISSING ANCHOR: function ${name} in public/app.js`);

  let depth = 0;

  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(at, i + 1);
  }

  throw new Error(`unbalanced function ${name}`);
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

const facets = { types: [{ name: 'Weapons', total: 2 }], owners: ['@Other'] };
const facetsMine = { types: [{ name: 'Apparel', total: 3 }], owners: ['@Eva'] };
const user = { provider: 'discord', username: 'evainefaye', id: 1, accountNames: ['@Eva'] };
const accounts = [{ accountName: '@Eva', guilds: [{ guild_name: 'G' }], platform: 'pc', worldName: 'NA' }];

const render = (overrides = {}) =>
  renderListRegion({
    user,
    accounts,
    browsingAccount: '@Eva',
    sharedItems: [],
    requestItems: [],
    alwaysShare: [],
    requestOffers: [],
    facets,
    facetsMine,
    filters: {},
    requests: [],
    basket: { count: 0, quantity: 0, secondsLeft: 0, holdMinutes: 5 },
    basketRows: [],
    ...overrides,
  });

t('a signed-in page draws one row per list, each naming its own list', () => {
  const html = render();

  assert.ok(html.includes('data-filters data-filter-list="request"'), 'the Browse Offers row');
  assert.ok(html.includes('data-filters data-filter-list="offer"'), 'and the My Inventory row');
});

t('a visitor gets the Browse Offers row only - they have no inventory tab', () => {
  const html = render({ user: null, accounts: [] });

  assert.ok(html.includes('data-filter-list="request"'), 'the row they can use');
  assert.equal(html.includes('data-filter-list="offer"'), false, 'and nothing for a tab they lack');
});

t('Browse Offers keeps the names every bookmark already uses', () => {
  const bar = filterBar(facets, {}, { list: 'request' });

  assert.match(bar, /name="type"/, 'type');
  assert.match(bar, /name="owner"/, 'offered by');
  assert.match(bar, /name="added"/, 'added');
  assert.deepEqual(FILTER_NAMES.request, { type: 'type', owner: 'owner', added: 'added' });
});

t('My Inventory has its own three, so the two lists cannot move each other', () => {
  const bar = filterBar(facetsMine, {}, { list: 'offer' });

  assert.match(bar, /name="mtype"/, 'type');
  assert.match(bar, /name="mowner"/, 'offered by');
  assert.match(bar, /name="madded"/, 'added');
  assert.equal(/\bname="type"/.test(bar), false, 'and does not write the first list\u2019s names');
  assert.deepEqual(FILTER_NAMES.offer, { type: 'mtype', owner: 'mowner', added: 'madded' });
});

t('each row comes back holding the choices that belong to it', () => {
  const filters = { type: ['Weapons'], owner: [], added: '7', typeMine: ['Apparel'], addedMine: '1' };
  const request = filterBar(facets, filters, { list: 'request' });
  const offer = filterBar(facetsMine, filters, { list: 'offer' });

  assert.match(request, /name="type" value="Weapons"[^>]*checked/, 'Browse Offers remembers its type');
  assert.match(request, /name="added" value="7"[^>]*checked/, 'and its window');
  assert.match(offer, /name="mtype" value="Apparel"[^>]*checked/, 'My Inventory remembers its type');
  assert.match(offer, /name="madded" value="1"[^>]*checked/, 'and its own window');
  assert.doesNotMatch(offer, /name="mtype" value="Weapons"/, 'and not the other list\u2019s choice');
});

t('the chips of each row remove that row\u2019s own choice', () => {
  const offer = filterBar(facetsMine, { typeMine: ['Apparel'], ownerMine: ['@Eva'] }, { list: 'offer' });

  assert.match(offer, /data-chip-filter="mtype" data-chip-value="Apparel"/, 'a type chip');
  assert.match(offer, /data-chip-filter="mowner" data-chip-value="@Eva"/, 'an owner chip');
  assert.equal(offer.includes('data-chip-filter="type"'), false, 'and no bare name from the other list');
});

t('a row with nothing to choose says so, and stays out of the way', () => {
  const bar = filterBar({ types: [], owners: [] }, {}, { list: 'offer' });

  assert.match(bar, /data-filter-empty="1"/, 'the empty marker app.js reads');
  assert.equal(filterBar(facetsMine, {}, { list: 'offer' }).includes('data-filter-empty'), false, 'and a full one has none');
});

// ---------------------------------------------------------------- app.js decides the rest
const app = read('public/app.js');

t('the card belongs to the two item lists and leaves the two request tabs', () => {
  assert.match(app, /function activeFilterForm\(\)/, 'one place decides which row is on screen');

  const fn = app.slice(app.indexOf('function activeFilterForm()'));

  assert.match(fn.slice(0, 600), /if \(activeTab !== 'request' && activeTab !== 'offer'\)/, 'null on the request tabs');
  assert.match(app, /function syncFilterCard\(\)/, 'which hides the rows that are not the tab\u2019s own');
  assert.match(app, /if \(card\.hidden !== empty\) card\.hidden = empty;/, 'and takes the whole card away there');
  assert.match(app, /const empty = !shown \|\| shown\.dataset\.filterEmpty === '1';/, 'or when the row has nothing to choose');
});

t('a tab change and a live refresh both decide it again', () => {
  const setTab = app.slice(app.indexOf('function setTab('), app.indexOf('function setTab(') + 2800);
  const region = app.slice(app.indexOf('function applyRegion('), app.indexOf('async function refresh()'));

  assert.match(setTab, /syncFilterCard\(\);/, 'switching tabs moves the card');
  assert.match(region, /syncFilterCard\(\);/, 'and a refresh puts it back on the right tab');
});

t('filtering one list leaves the other list\u2019s names alone', () => {
  assert.match(app, /const FILTER_PARAMS = \{/, 'both lists\u2019 names in one place');
  assert.match(app, /Object\.values\(names\)\.forEach\(\(name\) => params\.delete\(name\)\);/, 'only its own are rewritten');
  assert.match(
    app,
    /const params = new URLSearchParams\(window\.location\.search\);/,
    'built from the address bar rather than from scratch, so the other list survives'
  );
});

// ---------------------------------------------------------------- and the server reads them
const server = read('server.js');
const store = read('lib/store.js');

t('the server reads My Inventory\u2019s three under their own names', () => {
  assert.match(server, /typeMine: filterList\(query\.mtype\)/);
  assert.match(server, /ownerMine: filterList\(query\.mowner\)/);
  assert.match(server, /addedMine: ADDED_WINDOWS\.has\(addedMine\) \? addedMine : ''/);
});

t('My Inventory is queried with its own set, and Browse Offers with the first', () => {
  const fn = server.slice(server.indexOf('const mineFilters = {'));

  assert.match(fn.slice(0, 900), /type: chosenThatExist\(filters\.typeMine, data\.facetsMine\.types\)/, 'its type');
  assert.match(fn.slice(0, 900), /owner: chosenThatExist\(filters\.ownerMine, data\.facetsMine\.owners\)/, 'its owner');
  assert.match(fn.slice(0, 900), /added: filters\.addedMine/, 'its window');
  assert.match(server, /data\.sharedItems = await getSharedItemsForViewer\(connection, accountNames, \{\s*\.\.\.mineFilters,/, 'the own bag reads them');
  assert.match(server, /data\.requestItems = await getSharedItemsForViewer\(connection, requestScope, \{\s*\.\.\.requestFilters,/, 'and Browse Offers keeps its own');
});

t('each list\u2019s menus come from its own rows', () => {
  assert.match(server, /data\.facetsMine = await getOwnItemFacets\(connection, accountNames\)/, 'the own bag counts its own');
  assert.match(store, /export async function getOwnItemFacets\(connection, accountNames\)/, 'which the store answers');
  assert.match(store, /WHERE account_name IN \(\$\{inClause\(names\)\}\) AND item_type_name <> ''/, 'from the viewer\u2019s rows only');
});

t('Browse Offers counts only what somebody else is offering', () => {
  assert.match(
    server,
    /data\.facets = await getViewerFacets\(connection, requestScope, accountNames\)/,
    'its menus are told whose rows to leave out'
  );
  assert.match(
    store,
    /export async function getViewerFacets\(connection, accountNames, ownAccountNames = \[\]\)/,
    'which the store can do'
  );
  assert.match(store, /AND i\.account_name NOT IN/, 'by leaving the viewer\u2019s own rows out');
});

t('a choice whose option has gone leaves the row with it', () => {
  assert.match(server, /function chosenThatExist\(chosen, options\)/, 'the prune exists');
  assert.match(
    server,
    /type: chosenThatExist\(filters\.type, data\.facets\.types\)/,
    'Browse Offers\u2019 type is pruned'
  );
  assert.match(
    server,
    /type: chosenThatExist\(filters\.typeMine, data\.facetsMine\.types\)/,
    'so is My Inventory\u2019s'
  );
  assert.match(
    server,
    /data\.filters = \{\s*\.\.\.filters,\s*type: requestFilters\.type,\s*owner: requestFilters\.owner,\s*typeMine: mineFilters\.type,/,
    'and the page is drawn from the pruned pair'
  );
});


// ------------------------------------------------------------------ the numbers on the row

// A count beside a type exists twice - on the category heading and in the menu - and the two
// have to be the same number. The heading is drawn from the rows; the menu's is read back off
// the same rows, so a push that adds or drops rows cannot leave one of them behind.

t('the menu count is a span of its own, so the number can move without the name', () => {
  const bar = filterBar(facets, {}, { list: 'request' });

  assert.match(bar, /<span data-filter-label>Weapons<\/span>/, 'the name on its own');
  assert.match(bar, /<span class="filter-option-count">\(2\)<\/span>/, 'and the count beside it');
  assert.doesNotMatch(bar, />Weapons \(2\)</, 'the two are never fused into one label');
});

t('every row says its type and its list, so a menu can count its own', () => {
  const otherRow = {
    id: 1,
    item_key_hash: 'a1',
    item_name: 'Briarheart Dagger',
    item_type_name: 'Weapons',
    item_count: 2,
    account_name: '@Other',
  };
  const ownRow = {
    id: 2,
    item_key_hash: 'a2',
    item_name: 'Ancient Silk Robe',
    item_type_name: 'Apparel',
    item_count: 1,
    account_name: '@Eva',
  };
  const region = renderListRegion({
    user: { provider: 'discord', username: 'evainefaye', id: 1, accountNames: ['@Eva'] },
    accounts: [
      { accountName: '@Eva', guilds: [{ guild_name: 'G' }], platform: 'pc', worldName: 'NA' },
    ],
    browsingAccount: '@Eva',
    sharedItems: [ownRow],
    requestItems: [otherRow],
    requestOffers: [],
    alwaysShare: [],
    facets,
    facetsMine: { types: [], owners: [] },
    filters: {},
    requests: [],
  });

  assert.match(region, /<table class="list-table" data-list="request"/, 'the table names its list');
  assert.match(
    region,
    /data-item-key="inv:[^"]+" data-counts-tab="request" data-type-name="Weapons"/,
    'and its rows name the tab they count for and their type'
  );
  assert.match(region, /<table class="list-table" data-list="offer"/, 'so does the own-bag table');
});

t('the counts are read back off the page, not from what it was first sent', () => {
  const app = read('public/app.js');

  assert.match(app, /function syncTypeCounts\(\)/, 'the recount exists');
  assert.match(
    app,
    /table\[data-list="\$\{list\}"\] tbody tr\[data-type-name\]/,
    'it counts the rows of its own list'
  );
  assert.match(app, /count\.textContent = `\(\$\{total\}\)`/, 'and writes the number beside the type');
  assert.match(app, /option\.hidden = total === 0/, 'a type with no rows stops being a choice');
  assert.doesNotMatch(app, /drawFilterCard/, 'the card is not rebuilt from a template any more');
  assert.match(
    app,
    /syncFilterCard\(\);\n    applyListSearch\(\);/,
    'and an applied page picks its row before it narrows anything'
  );
  assert.match(
    app,
    /applyListSearch\(\);\n    \/\/ The rows are new[\s\S]{0,200}syncCounts\(\);/,
    'then counts the rows it just drew'
  );
});

t('a folded type keeps its rows, so folding cannot move a count', () => {
  const app = read('public/app.js');
  const recount = app.slice(app.indexOf('function syncTypeCounts()'));

  assert.doesNotMatch(
    recount.slice(0, 2400),
    /if \(row\.hidden\) continue/,
    'a row hidden by a fold still counts'
  );
});


// --------------------------------------------------- a type that has gone leaves the menu

t('an option with no rows left is hidden by a rule that can actually hide it', () => {
  const css = read('public/styles.css');

  assert.match(
    css,
    /\.filter-option\[hidden\]\s*\{[^}]*display:\s*none/,
    'the display on .filter-option outranks [hidden], so the menu restates it'
  );
});

t('the last row of a ticked type takes the tick and the chip with it', () => {
  const app = read('public/app.js');
  const source = functionSource(app, 'syncTypeCounts');

  const options = {};
  const boxes = {};

  for (const [type, checked] of [
    ['Weapons', true],
    ['Apparel', false],
  ]) {
    const count = { textContent: '(1)' };
    const option = { hidden: false, querySelector: (selector) => (selector === '.filter-option-count' ? count : null) };
    const box = { value: type, checked, closest: () => option };

    options[type] = { option, count };
    boxes[type] = box;
  }

  const menu = {
    querySelector: () => boxes.Weapons,
    querySelectorAll: () => [boxes.Weapons, boxes.Apparel],
  };
  const form = { dataset: { filterList: 'request' }, querySelectorAll: () => [menu] };
  const rowsLeft = [{ getAttribute: () => 'Apparel', hasAttribute: () => false }];
  const asked = [];

  const listRegion = { querySelectorAll: () => rowsLeft };
  const sync = new Function(
    'filterForms',
    'filterListOf',
    'FILTER_PARAMS',
    'listRegion',
    'applyFilters',
    `${source}
return syncTypeCounts;`
  )(
    () => [form],
    (node) => (node.dataset.filterList === 'offer' ? 'offer' : 'request'),
    { request: { type: 'type', owner: 'owner', added: 'added' }, offer: {} },
    listRegion,
    (node) => asked.push(node)
  );

  sync();

  assert.equal(options.Weapons.count.textContent, '(0)', 'Weapons counts nothing');
  assert.equal(options.Weapons.option.hidden, true, 'and is drawn away');
  assert.equal(boxes.Weapons.checked, false, 'the tick goes with it');
  assert.equal(options.Apparel.option.hidden, false, 'the type that still has rows stays');
  assert.equal(options.Apparel.count.textContent, '(1)', 'counting its row');
  assert.deepEqual(asked, [form], 'and the list is asked again without the value');
});

t('a ticked type that still has rows keeps its tick and asks for nothing', () => {
  const app = read('public/app.js');
  const source = functionSource(app, 'syncTypeCounts');

  const count = { textContent: '(0)' };
  const option = { hidden: true, querySelector: () => count };
  const box = { value: 'Weapons', checked: true, closest: () => option };
  const menu = { querySelector: () => box, querySelectorAll: () => [box] };
  const form = { dataset: { filterList: 'request' }, querySelectorAll: () => [menu] };
  const asked = [];

  const sync = new Function(
    'filterForms',
    'filterListOf',
    'FILTER_PARAMS',
    'listRegion',
    'applyFilters',
    `${source}
return syncTypeCounts;`
  )(
    () => [form],
    () => 'request',
    { request: { type: 'type', owner: 'owner', added: 'added' } },
    {
      querySelectorAll: () => [{ getAttribute: () => 'Weapons', hasAttribute: () => false }],
    },
    (node) => asked.push(node)
  );

  sync();

  assert.equal(count.textContent, '(1)', 'the number follows the row back');
  assert.equal(option.hidden, false, 'and the option is drawn again');
  assert.equal(box.checked, true, 'the reader keeps their choice');
  assert.deepEqual(asked, [], 'with no request in flight');
});


// ------------------------------------------------- the row in its new place, and the numbers

t('the filter row sits inside the list card, between the tabs and the search', () => {
  const region = renderListRegion({
    user: { provider: 'discord', username: 'evainefaye', id: 1, accountNames: ['@Eva'] },
    accounts: [
      { accountName: '@Eva', guilds: [{ guild_name: 'G' }], platform: 'pc', worldName: 'NA' },
    ],
    browsingAccount: '@Eva',
    sharedItems: [
      {
        id: 1,
        item_key_hash: 'a1',
        item_name: 'Briarheart Dagger',
        item_type_name: 'Weapons',
        item_count: 2,
        account_name: '@Eva',
      },
    ],
    requestItems: [],
    requestOffers: [],
    alwaysShare: [],
    facets,
    facetsMine,
    filters: {},
    requests: [],
    basket: [],
  });

  const head = region.indexOf('class="list-head"');
  const band = region.indexOf('class="filter-band" id="itemFilters"');
  const tools = region.indexOf('class="list-tools"');

  assert.ok(head > -1 && band > head, 'the row comes after the tabs');
  assert.ok(tools > band, 'and before the search');
  assert.doesNotMatch(
    read('lib/views.js'),
    /card card-filters/,
    'and it is no longer a card of its own above the list'
  );
});

t('the band keeps air above and below and loses the empty chip floor', () => {
  const css = read('public/styles.css');

  assert.match(css, /\.filter-band \{[^}]*padding: 16px 0 18px;/, 'air above and below');
  assert.match(css, /\.filter-chips:empty \{\s*display: none;/, 'no chip row when none are chosen');
  assert.match(css, /\.filter-chips \{[^}]*margin-top: 10px;/, 'and room for one when they are');
  assert.match(
    css,
    /\.filter-band \.filter-clear \{[^}]*align-self: flex-end;[^}]*height: 34px;/,
    'RESET sits on the bottom of the dropdowns'
  );
});

t('a tab counts its own rows, and a word takes them out of its number', () => {
  const app = read('public/app.js');
  const source = functionSource(app, 'syncTabCounts');
  const count = { textContent: '12' };
  const tab = { dataset: { tab: 'request' }, querySelector: (selector) => (selector === '.tab-count' ? count : null) };
  const left = [{ hasAttribute: () => false }, { hasAttribute: () => false }];
  const gone = [{ hasAttribute: (name) => name === 'data-search-miss' }];

  const run = (rows) =>
    new Function(
      'listRegion',
      `${source}
return syncTabCounts;`
    )({ querySelectorAll: (selector) => (selector === '[data-tab]' ? [tab] : rows) })();

  run([...left, ...gone]);

  assert.equal(count.textContent, '2', 'the two rows the word leaves are the number');

  run([]);

  assert.equal(count.textContent, '2', 'a tab with no rows of its own keeps what the server sent');
});

t('the search marks the rows it hides, so a fold and a word are told apart', () => {
  const app = read('public/app.js');
  const source = functionSource(app, 'applyListSearch');
  const marks = new Set();
  const row = {
    hidden: false,
    hasAttribute: (name) => name === 'data-search' || marks.has(name),
    getAttribute: (name) => (name === 'data-search' ? 'Briarheart Dagger Weapons' : null),
    setAttribute: (name) => marks.add(name),
    removeAttribute: (name) => marks.delete(name),
    classList: { contains: () => false },
  };

  const run = (term) =>
    new Function(
      'listRegion',
      'listSearchByTab',
      'activeTab',
      'syncCounts',
      `${source}
return applyListSearch;`
    )(
      {
        querySelector: (selector) =>
          selector === '[data-list-search]' ? { value: term, hidden: true } : null,
        querySelectorAll: (selector) => (selector === 'table tbody' ? [{ rows: [row] }] : []),
      },
      { request: term },
      'request',
      () => {}
    )();

  run('dagger');

  assert.equal(row.hidden, false, 'the matching row stays');
  assert.equal(marks.has('data-search-miss'), false, 'and is not marked');

  run('mithril');

  assert.equal(row.hidden, true, 'the row the word does not match is hidden');
  assert.equal(marks.has('data-search-miss'), true, 'and marked, so no count claims it');

  run('');

  assert.equal(marks.has('data-search-miss'), false, 'clearing the word takes the mark back');
});


// ------------------------------------------------- the number on each tab, and the pinning

const item = (key, name, type, account) => ({
  id: key,
  item_key_hash: key,
  item_name: name,
  item_type_name: type,
  item_count: 1,
  account_name: account,
});

const fourTabRegion = () =>
  renderListRegion({
    user: { provider: 'discord', username: 'evainefaye', id: 1, accountNames: ['@Eva'] },
    accounts: [
      {
        accountName: '@Eva',
        guildCount: 1,
        guilds: [{ guild_name: 'G' }],
        platform: 'pc',
        worldName: 'NA',
      },
    ],
    browsingAccount: '@Eva',
    sharedItems: [item('o1', 'Ancient Silk Robe', 'Apparel', '@Eva'), item('o2', 'Amber Ring', 'Apparel', '@Eva')],
    requestItems: [
      item('r1', 'Briarheart Dagger', 'Weapons', '@Other'),
      item('r2', 'Hunding&#39;s Rage', 'Weapons', '@Other'),
      item('r3', 'Colovian Hood', 'Apparel', '@Other'),
      item('r4', 'Own Thing', 'Motif', '@Eva'),
    ],
    requestOffers: [],
    alwaysShare: [],
    facets,
    facetsMine,
    filters: {},
    requests: [],
    basketRows: [
      { id: 11, status: 'draft', item_name: 'A', item_type_name: 'Weapons', quantity: 1, owner_account_name: '@Other' },
      { id: 12, status: 'draft', item_name: 'B', item_type_name: 'Apparel', quantity: 1, owner_account_name: '@Other' },
      { id: 13, status: 'cancelled', item_name: 'C', item_type_name: 'Motif', quantity: 1, owner_account_name: '@Other' },
    ],
    basket: { count: 2, quantity: 2, secondsLeft: 600, holdMinutes: 30 },
    received: [
      { id: 21, item_name: 'D', asked: 1, requesters: ['@Guy'], location_label: 'Bank' },
      { id: 22, item_name: 'E', asked: 2, requesters: ['@Gal'], location_label: 'Bank' },
    ],
    receivedHistory: [],
  });

const tabNumbers = (region) =>
  Object.fromEntries(
    [...region.matchAll(/<button[^>]*data-tab="([a-z]+)"[\s\S]*?<span class="tab-count">(\d+)<\/span>/g)].map(
      ([, name, number]) => [name, Number(number)]
    )
  );

const countedRows = (region, tab) =>
  [...region.matchAll(new RegExp(`<tr[^>]*data-counts-tab="${tab}"`, 'g'))].length;

t('every tab counts the rows it marks, on all four tabs', () => {
  const region = fourTabRegion();
  const numbers = tabNumbers(region);

  assert.deepEqual(
    Object.keys(numbers).sort(),
    ['mine', 'offer', 'received', 'request'],
    'all four tabs are drawn'
  );

  for (const tab of ['request', 'offer', 'mine', 'received']) {
    assert.equal(
      numbers[tab],
      countedRows(region, tab),
      `${tab}: the number on the tab is the rows it counts`
    );
  }

  assert.equal(countedRows(region, 'request'), 3, 'Browse Offers counts nobody&#39;s own rows');
  assert.equal(countedRows(region, 'mine'), 2, 'a cancelled basket row is not a request any more');
});

t('the page writes the number the rows give it, and a search takes one away', () => {
  const region = fourTabRegion();
  const numbers = tabNumbers(region);
  const spans = Object.fromEntries(
    Object.keys(numbers).map((tab) => [tab, { textContent: String(numbers[tab]) }])
  );
  const tabs = [...region.matchAll(/<button[^>]*data-tab="([a-z]+)"/g)].map((match) => ({
    dataset: { tab: match[1] },
    querySelector: (selector) =>
      selector === '.tab-count' ? spans[match[1]] || null : null,
  }));
  const rows = [...region.matchAll(/<tr[^>]*data-counts-tab="([a-z]+)"/g)].map((match) => {
    const row = { tab: match[1], marked: false };
    row.hasAttribute = (name) => name === 'data-search-miss' && row.marked;
    return row;
  });
  const app = read('public/app.js');
  const listRegion = {
    querySelectorAll: (selector) => {
      if (selector === '[data-tab]') return tabs;
      const found = /data-counts-tab="([a-z]+)"/.exec(selector);
      return found ? rows.filter((row) => row.tab === found[1]) : [];
    },
  };
  const syncTabCounts = new Function(
    'listRegion',
    `${functionSource(app, 'syncTabCounts')}
return syncTabCounts;`
  )(listRegion);

  syncTabCounts();

  for (const tab of ['request', 'offer', 'mine', 'received']) {
    assert.equal(
      spans[tab].textContent,
      String(numbers[tab]),
      `${tab}: the page agrees with the server`
    );
  }

  // One offer hidden by a word: that tab's number comes down by one, and the others stay.
  const offer = rows.find((row) => row.tab === 'offer');
  offer.marked = true;
  syncTabCounts();

  assert.equal(
    spans.offer.textContent,
    String(numbers.offer - 1),
    'the offer tab counts what the word leaves'
  );
  assert.equal(
    spans.request.textContent,
    String(numbers.request),
    'and the tab the word was not typed on is untouched'
  );
});

t('the band pins between the tabs and the search, and neither covers it', () => {
  const css = read('public/styles.css');
  const app = read('public/app.js');

  assert.match(css, /\.filter-band \{[^}]*position: sticky;/, 'the band pins');
  assert.match(
    css,
    /\.filter-band \{[^}]*top: calc\(var\(--sticky-top, 0px\) \+ var\(--list-head-h, 0px\)\);/,
    'under the tab row'
  );
  assert.match(css, /\.filter-band \{[^}]*z-index: 12;/, 'at the tab row’s level');

  assert.match(
    css,
    /\.list-tools \{[^}]*var\(--list-band-h, 0px\)/,
    'the search row pins below the band, not over it'
  );
  assert.match(
    css,
    /\.list-table thead th \{[^}]*var\(--list-band-h, 0px\)/,
    'and the column headings clear it'
  );
  assert.match(
    css,
    /\.list-tools \+ \.table-shell \.list-table thead th \{[^}]*var\(--list-band-h, 0px\)[\s\S]*?var\(--list-tools-h, 0px\)/,
    'both offsets when a search row is above the table'
  );

  assert.match(
    app,
    /publish\('--list-band-h', document\.querySelector\('\.filter-band'\)\);/,
    'the band’s height is measured, so a tab without a row measures 0px'
  );

  // The order of the stack is in the offsets: the band starts where the tab row ends, the
  // search row where the band ends, the headings under both. Nothing is given the band's
  // height as its start, so nothing can land on top of it.
  const bandRule = css.slice(css.indexOf('.filter-band {'), css.indexOf('.filter-band {') + 320);

  assert.doesNotMatch(bandRule, /--list-tools-h/, 'the band starts at the tab row, not under the search');

  const toolsRule = css.slice(css.indexOf('.list-tools {'), css.indexOf('.list-tools {') + 320);

  assert.match(toolsRule, /--list-head-h/, 'the search row starts below the tab row');
  assert.match(toolsRule, /--list-band-h/, 'and below the band');

  const toolsHeading = css.slice(
    css.indexOf('.list-tools + .table-shell .list-table thead th'),
    css.indexOf('.list-tools + .table-shell .list-table thead th') + 400
  );

  assert.match(toolsHeading, /--list-tools-h/, 'the headings under a search row clear it too');
});


// -------------------------------------------------- what the page reads before it draws

// The page puts the remembered tab on screen as it loads, and that already counts a menu and
// narrows a list. A `const` that a name like FILTER_PARAMS lives in has to be declared above
// that call: inside a function it is hoisted, but its value is not, and reading it first
// threw `Cannot access 'FILTER_PARAMS' before initialization` - which stopped the load before
// the tab handlers were wired, left both lists' filter rows on screen, and made the type
// headings stop opening.

t('the names the first render reads are declared above it', () => {
  const app = read('public/app.js');
  const firstRender = app.indexOf('\n  setTab(activeTab);');

  assert.ok(firstRender > -1, 'the page draws its first tab as it loads');

  for (const name of ['const FILTER_PARAMS', 'const TAB_KEY']) {
    assert.ok(
      app.indexOf(name) > -1 && app.indexOf(name) < firstRender,
      `${name} is declared above the first tab render`
    );
  }
});

t('a tab shows its own filter row before it narrows or counts anything', () => {
  const app = read('public/app.js');
  const tab = app.slice(app.indexOf('  function setTab('), app.indexOf('  function setTab(') + 2600);

  assert.ok(
    tab.indexOf('syncFilterCard();') > -1 &&
      tab.indexOf('syncFilterCard();') < tab.indexOf('applyListSearch();'),
    'the row comes first, so a failure below cannot leave both rows on the page'
  );

  const push = app.slice(app.indexOf('  function applyRegion('), app.indexOf('  function applyRegion(') + 6000);

  assert.ok(
    push.indexOf('syncFilterCard();') < push.indexOf('applyListSearch();') &&
      push.indexOf('applyListSearch();') < push.indexOf('syncCounts();'),
    'and a pushed page does the same, then counts the rows it just drew'
  );
});

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
