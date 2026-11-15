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

  assert.match(fn.slice(0, 700), /type: filters\.typeMine/, 'its type');
  assert.match(fn.slice(0, 700), /owner: filters\.ownerMine/, 'its owner');
  assert.match(fn.slice(0, 700), /added: filters\.addedMine/, 'its window');
  assert.match(server, /data\.sharedItems = await getSharedItemsForViewer\(connection, accountNames, \{\s*\.\.\.mineFilters,/, 'the own bag reads them');
  assert.match(server, /data\.requestItems = await getSharedItemsForViewer\(connection, requestScope, \{\s*\.\.\.filters,/, 'and Browse Offers keeps its own');
});

t('each list\u2019s menus come from its own rows', () => {
  assert.match(server, /data\.facetsMine = await getOwnItemFacets\(connection, accountNames\)/, 'the own bag counts its own');
  assert.match(store, /export async function getOwnItemFacets\(connection, accountNames\)/, 'which the store answers');
  assert.match(store, /WHERE account_name IN \(\$\{inClause\(names\)\}\) AND item_type_name <> ''/, 'from the viewer\u2019s rows only');
});

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
