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
  const setTab = app.slice(app.indexOf('function setTab('), app.indexOf('function setTab(') + 1600);
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
  assert.match(region, /data-type-name="Weapons"/, 'and its rows name their type');
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
  assert.match(app, /function drawFilterCard\(card, content\)/, 'the card is drawn again on a push');
  assert.match(
    app,
    /syncTypeCounts\(\);\n    syncFilterCard\(\);/,
    'and an applied page is recounted before the card is decided'
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

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
