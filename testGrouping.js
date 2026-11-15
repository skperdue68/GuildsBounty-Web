#!/usr/bin/env node
// The grouping switch: what it draws, what it says, and what the list looks like either
// way. Renders the real table out of lib/views.js - no browser, no database - so a change
// that quietly ties the headings back to the sort order fails here instead of in the list.
//
//   npm run test:grouping

import assert from 'node:assert/strict';
import fs from 'node:fs';

import { filterList } from './lib/filters.js';
import { SORT_FIELDS, parseSortOrder } from './lib/sortQueue.js';
import { readCollapsedTypes, readCookie, readGrouping } from './lib/preferences.js';
import { groupToggle, inventoryTable, renderListRegion } from './lib/views.js';

function item(id, name, type, count) {
  return {
    id,
    item_name: name,
    item_type_name: type,
    item_count: count,
    held_quantity: 0,
    reserve_quantity: 0,
    quality: 4,
    trait: '',
    location_label: '',
    account_name: '@Owner',
    first_seen_at_iso: '2026-11-01T10:00:00Z',
  };
}

const items = [
  item(1, 'Briarheart Dagger', 'Weapons', 3),
  item(2, 'Ancient Silk', 'Apparel', 2),
  item(3, 'Cuirass', 'Apparel', 1),
  item(4, 'Hunting Bow', 'Weapons', 5),
];

const headingCount = (html) => (html.match(/class="type-row"/g) || []).length;
const render = (filters) => inventoryTable(items, { mine: false, filters });
const rects = (html) => (html.match(/<rect/g) || []).length;

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

// ------------------------------------------------------------------ the list itself

t('grouping is on by default, and says so', () => {
  const html = render({});

  assert.equal(headingCount(html), 2, 'one heading per type');
  assert.match(html, /data-group-toggle aria-pressed="true"/);
  assert.match(html, /Grouped by type/);
});

t('each heading counts the rows under it', () => {
  const html = render({});

  assert.match(html, /Apparel <span class="type-count">\(2\)<\/span>/);
  assert.match(html, /Weapons <span class="type-count">\(2\)<\/span>/);
});

t('turning grouping off leaves one list with no headings', () => {
  const html = render({ group: false });

  assert.equal(headingCount(html), 0);
  assert.match(html, /data-group-toggle aria-pressed="false"/);
  assert.match(html, /One list/);
});

t('grouping off keeps the order it was given', () => {
  const html = render({ order: [{ field: 'name', dir: 'asc' }], group: false });
  const order = ['Briarheart Dagger', 'Ancient Silk', 'Cuirass', 'Hunting Bow'].map((name) =>
    html.indexOf(name)
  );

  assert.ok(order.every((at) => at > -1), 'every row is there');
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'rows stay in list order');
});

t('sorting alphabetically no longer turns grouping off', () => {
  assert.equal(headingCount(render({ order: [{ field: 'name', dir: 'asc' }], group: true })), 2);
});

t('sorting by date no longer turns grouping off', () => {
  assert.equal(headingCount(render({ order: [{ field: 'added', dir: 'asc' }], group: true })), 2);
});

t('the headings still go when grouping is off and the sort is by type', () => {
  assert.equal(headingCount(render({ order: [{ field: 'type', dir: 'asc' }], group: false })), 0);
});

t('there is one switch, and it is a button', () => {
  const html = render({});

  assert.equal((html.match(/data-group-toggle/g) || []).length, 1);
  assert.match(html, /<button class="group-toggle" type="button"/);
});

// --------------------------------------------------------------------- the picture

t('the picture for grouping shows headings over their rows', () => {
  const html = groupToggle({ group: true });

  assert.equal(rects(html), 4, 'two headings and two indented rows');
  assert.match(html, /opacity="0.55"/, 'the rows sit back from the headings');
  assert.match(html, /aria-hidden="true"/, 'the picture is not read out');
});

t('the picture for one list is equal rows', () => {
  const html = groupToggle({ group: false });

  assert.equal(rects(html), 3, 'no heading, just rows');
  assert.doesNotMatch(html, /opacity="0.55"/, 'nothing is set back');
  assert.match(html, /aria-hidden="true"/);
});

t('the words flip with the state', () => {
  assert.match(groupToggle({ group: true }), /Grouped by type<\/span>/);
  assert.match(groupToggle({ group: false }), /One list<\/span>/);
});

// ------------------------------------------------------------------- the preference

t('a missing grouping cookie means grouped', () => {
  assert.equal(readGrouping(''), true);
  assert.equal(readGrouping(undefined), true);
  assert.equal(readGrouping('1'), true);
});

t('only a deliberate zero turns grouping off', () => {
  assert.equal(readGrouping('0'), false);
  assert.equal(readGrouping('off'), true, 'junk keeps the list as it was');
});

t('one cookie can be read out of a header without the others', () => {
  const header = 'a=1; itemshare_group=0; itemshare_sort=name%3Adesc';

  assert.equal(readCookie(header, 'itemshare_group'), '0');
  assert.equal(readCookie(header, 'itemshare_sort'), 'name:desc');
  assert.equal(readCookie(header, 'missing'), '');
  assert.equal(readCookie('', 'itemshare_group'), '');
});

// ------------------------------------------------- sorting with the groups kept on

// The rows arrive already in the order the query asked for; the table buckets them by type
// and must leave that order alone inside each bucket. These feed an order that looks like
// the result of a name sort and check it survives the bucketing.
const sorted = [
  item(11, 'Amber Ring', 'Weapons', 1),
  item(12, 'Birch Cup', 'Apparel', 1),
  item(13, 'Zephyr Bow', 'Weapons', 1),
  item(14, 'Yew Log', 'Apparel', 1),
];

t('a chosen order is kept inside each group, and the groups stay', () => {
  const html = inventoryTable(sorted, {
    mine: false,
    filters: { order: [{ field: 'name', dir: 'asc' }], group: true },
  });

  assert.equal(headingCount(html), 2, 'the headings are still drawn');
  assert.ok(
    html.indexOf('Amber Ring') < html.indexOf('Zephyr Bow'),
    'the weapons keep the order they arrived in'
  );
  assert.ok(
    html.indexOf('Birch Cup') < html.indexOf('Yew Log'),
    'so do the apparel rows'
  );
});

t('the same order runs straight through when the groups are off', () => {
  const html = inventoryTable(sorted, {
    mine: false,
    filters: { order: [{ field: 'name', dir: 'asc' }], group: false },
  });
  const positions = ['Amber Ring', 'Birch Cup', 'Zephyr Bow', 'Yew Log'].map((name) =>
    html.indexOf(name)
  );

  assert.equal(headingCount(html), 0);
  assert.deepEqual(positions.slice().sort((a, b) => a - b), positions, 'one run, no regrouping');
});

t('a date order is kept inside each group too', () => {
  const html = inventoryTable(sorted, {
    mine: false,
    filters: { order: [{ field: 'added', dir: 'asc' }], group: true },
  });

  assert.equal(headingCount(html), 2);
  assert.ok(html.indexOf('Amber Ring') < html.indexOf('Zephyr Bow'));
  assert.ok(html.indexOf('Birch Cup') < html.indexOf('Yew Log'));
});

t('the sort heading still reports which way it is', () => {
  const html = render({ order: [{ field: 'name', dir: 'desc' }], group: true });

  assert.match(html, /data-sort="name" data-dir="desc"/, 'the arrow and the aria-sort follow');
  assert.equal(headingCount(html), 2, 'and sorting does not take the groups away');
});

// --------------------------------------- the server keeps the two choices apart

// The page only draws what the server asked for, so "does sorting take the groups away?"
// is really a question about readFilters, the one place that turns the two cookies into
// the two answers. These run that function out of server.js with nothing else attached.
const serverSource = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');

/** One function's source, found by name and closed by counting braces. */
function sourceOf(name) {
  const at = serverSource.indexOf('function ' + name + '(');

  if (at < 0) {
    throw new Error('MISSING ANCHOR: function ' + name + ' in server.js');
  }

  let depth = 0;

  for (let i = serverSource.indexOf('{', at); i < serverSource.length; i += 1) {
    if (serverSource[i] === '{') depth += 1;
    if (serverSource[i] === '}') depth -= 1;
    if (depth === 0) return serverSource.slice(at, i + 1);
  }

  throw new Error('unbalanced function ' + name);
}

// The columns the item list sorts by live in lib/sortQueue.js now, so the harness hands
// readFilters the same parser the server imports instead of the constant it used to hold.
const consts = serverSource.match(/const ADDED_WINDOWS = new Set\(\[[^\]]*\]\);/g) || [];

if (consts.length !== 1) {
  throw new Error('MISSING ANCHOR: ADDED_WINDOWS in server.js');
}

/** One constant's own line, so the names tested here are the names server.js uses. */
function constOf(name) {
  const match = serverSource.match(new RegExp(`const ${name} = '[^']*';`));

  if (!match) {
    throw new Error('MISSING ANCHOR: const ' + name + ' in server.js');
  }

  return match[0];
}

const readFilters = new Function(
  'readCookie',
  'readGrouping',
  'readCollapsedTypes',
  'filterList',
  'parseSortOrder',
  'SORT_FIELDS',
  [
    constOf('SORT_COOKIE'),
    constOf('GROUP_COOKIE'),
    constOf('GROUP_COOKIE_MINE'),
    constOf('FOLDED_COOKIE'),
    constOf('FOLDED_COOKIE_MINE'),
    consts[0],
    sourceOf('readParam'),
    sourceOf('readFilters'),
    'return readFilters;',
  ].join('\n')
)(readCookie, readGrouping, readCollapsedTypes, filterList, parseSortOrder, SORT_FIELDS);

/** A header the way a browser sends the cookies back, escaped as they were written. */
const cookieHeader = (cookies) =>
  Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');

t('choosing a sort leaves grouping alone', () => {
  const filters = readFilters({}, cookieHeader({ itemshare_sort: 'name:asc' }));

  assert.deepEqual(filters.order, [{ field: 'name', dir: 'asc' }], 'the queue is what was asked for');
  assert.equal(filters.group, true, 'and the headings stay on');
});

t('grouping off survives a sort being chosen', () => {
  const filters = readFilters({}, cookieHeader({ itemshare_sort: 'added:desc', itemshare_group: '0' }));

  assert.deepEqual(filters.order, [{ field: 'added', dir: 'desc' }]);
  assert.equal(filters.group, false, 'off stays off');
});

t('with neither chosen the list is grouped and ordered by type', () => {
  const filters = readFilters({}, '');

  assert.deepEqual(filters.order, [], 'no heading carries a badge until one is pressed');
  assert.equal(filters.group, true);
});

t('a second heading joins the end of the queue', () => {
  const filters = readFilters({}, cookieHeader({ itemshare_sort: 'name:asc,type:desc' }));

  assert.deepEqual(filters.order, [
    { field: 'name', dir: 'asc' },
    { field: 'type', dir: 'desc' },
  ]);
});

t('a ?sort= bookmark is still a queue of one', () => {
  const filters = readFilters({ sort: 'added', dir: 'desc' }, cookieHeader({ itemshare_sort: 'name:asc' }));

  assert.deepEqual(filters.order, [{ field: 'added', dir: 'desc' }], 'the address bar wins');
});

t('a nonsense grouping cookie does not ungroup the list', () => {
  assert.equal(readFilters({}, cookieHeader({ itemshare_sort: 'type:asc', itemshare_group: 'nonsense' })).group, true);
});

t('both list routes hand over the cookies', () => {
  const reads = (serverSource.match(/readFilters\(req\.query, req\.headers\.cookie\)/g) || []).length;

  assert.equal(reads, 2, 'the page load and the live refresh both pass them through');
});

// ------------------------------------------------ the headings keep their own order

t('the types always run A-Z, whatever the sort did to the rows', () => {
  const html = render({ order: [{ field: 'added', dir: 'desc' }] });
  const order = ['Apparel', 'Weapons'].map((name) =>
    html.indexOf(name + ' <span class="type-count">')
  );

  assert.ok(order[0] > 0 && order[1] > 0, 'both headings are drawn');
  assert.ok(
    order[0] < order[1],
    'Apparel still comes first when the newest row belongs to Weapons'
  );
});

t('three types arrive alphabetically however the rows arrive', () => {
  const rows = [
    item(21, 'Zeta Blade', 'Weapons', 1),
    item(22, 'Apple Pie', 'Consumables', 1),
    item(23, 'Yew Staff', 'Weapons', 1),
    item(24, 'Amber Ring', 'Apparel', 1),
  ];
  const html = inventoryTable(rows, { mine: false, filters: { group: true } });
  const positions = ['Apparel', 'Consumables', 'Weapons'].map((name) =>
    html.indexOf(name + ' <span class="type-count">')
  );

  assert.ok(positions.every((at) => at > 0), 'all three headings are drawn');
  assert.deepEqual(
    positions.slice().sort((a, b) => a - b),
    positions,
    'Apparel, Consumables, Weapons'
  );
});

t('the order inside a type is still the one that was chosen', () => {
  const rows = [
    item(31, 'Zeta Blade', 'Weapons', 1),
    item(32, 'Amber Ring', 'Apparel', 1),
    item(33, 'Yew Staff', 'Weapons', 1),
  ];
  const html = inventoryTable(rows, {
    mine: false,
    filters: { group: true, order: [{ field: 'name', dir: 'asc' }] },
  });

  assert.ok(
    html.indexOf('Zeta Blade') < html.indexOf('Yew Staff'),
    'the weapons keep the order they arrived in'
  );
  assert.ok(
    html.indexOf('Apparel <span') < html.indexOf('Weapons <span'),
    'while the types stay A-Z'
  );
});

// ----------------------------------------------------- two lists, two answers

// Whether a list is cut up by type is a reading choice about that list. Browse Offers and My
// Inventory used to share one cookie, so turning the headings off on one turned them off on
// the other, and the switch on each tab reported the other tab's state.
t('one list can be grouped while the other is a flat list', () => {
  const offersGrouped = { group: true, groupMine: false };
  const mineGrouped = { group: false, groupMine: true };

  assert.match(
    groupToggle(offersGrouped, '', 'request'),
    /data-group-toggle aria-pressed="true" data-group-list="request"/,
    'Browse Offers says grouped'
  );
  assert.match(
    groupToggle(offersGrouped, '', 'offer'),
    /data-group-toggle aria-pressed="false" data-group-list="offer"/,
    'while the switch on My Inventory says one list'
  );
  assert.match(groupToggle(mineGrouped, '', 'request'), /aria-pressed="false" data-group-list="request"/);
  assert.match(groupToggle(mineGrouped, '', 'offer'), /aria-pressed="true" data-group-list="offer"/);
});

t('and each table is drawn the way its own list says', () => {
  const draw = (mine, filters) => headingCount(inventoryTable(items, { mine, filters }));

  assert.equal(draw(false, { group: true, groupMine: false }), 2, 'Browse Offers grouped');
  assert.equal(draw(true, { group: true, groupMine: false }), 0, 'My Inventory flat at the same time');
  assert.equal(draw(false, { group: false, groupMine: true }), 0, 'the other way round');
  assert.equal(draw(true, { group: false, groupMine: true }), 2);

  assert.equal(draw(true, { groupMine: false }), 0, 'a missing Browse Offers flag leaves My Inventory alone');
  assert.equal(draw(false, { group: false }), 0, 'and a missing My Inventory flag leaves Browse Offers alone');
});

t('each switch writes the cookie for the list it sits on', () => {
  const app = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');

  assert.match(app, /const GROUP_COOKIES = \{ request: 'itemshare_group', offer: 'itemshare_group_mine' \}/);
  assert.match(app, /writeGroupCookie\(\s*groupButton\.getAttribute\('data-group-list'\) \|\| 'request'/);
  assert.match(server, /const GROUP_COOKIE_MINE = 'itemshare_group_mine'/);
  assert.match(server, /groupMine: readGrouping\(readCookie\(cookieHeader, GROUP_COOKIE_MINE\)\)/);
  assert.equal(
    (server.match(/readFilters\(req\.query, req\.headers\.cookie\)/g) || []).length,
    2,
    'both the page and the live fragment read it'
  );
});

// ------------------------------------------------- headings that fold their rows away

t('a folded heading keeps its count, hides its rows and points its caret', () => {
  const html = inventoryTable(items, { mine: false, filters: { collapsed: ['Weapons'] } });

  assert.match(html, /class="type-row is-collapsed"/, 'the shut heading is marked');
  assert.match(
    html,
    /data-type-toggle="Weapons" data-group-list="request" aria-expanded="false"/,
    'and says so out loud'
  );
  assert.match(html, /Weapons <span class="type-count">\(2\)<\/span>/, 'the count is still true');
  assert.match(html, /data-item-key="inv:1" hidden/, 'Briarheart Dagger is away with it');
  assert.match(html, /data-item-key="inv:4" hidden/, 'and so is Hunting Bow');
  assert.match(html, /data-item-key="inv:2" data-search/, 'Apparel is untouched');
  assert.match(
    html,
    /data-type-toggle="Apparel" data-group-list="request" aria-expanded="true"/,
    'the open heading points the other way'
  );
});

t('every fold is the list\'s own: the two lists do not share one', () => {
  const mineFolded = inventoryTable(items, { mine: true, filters: { collapsed: ['Weapons'] } });
  const offersFolded = inventoryTable(items, { mine: false, filters: { collapsedMine: ['Weapons'] } });

  assert.doesNotMatch(mineFolded, /is-collapsed/, 'a Browse Offers fold leaves My Inventory open');
  assert.doesNotMatch(offersFolded, /is-collapsed/, 'and the other way round');
});

t('the server reads the folded headings from their own cookies', () => {
  const filters = readFilters(
    {},
    cookieHeader({
      itemshare_collapsed: 'Weapons,Apparel',
      itemshare_collapsed_mine: 'Style',
    })
  );

  assert.deepEqual(filters.collapsed, ['Weapons', 'Apparel']);
  assert.deepEqual(filters.collapsedMine, ['Style']);
  assert.deepEqual(readFilters({}, '').collapsed, [], 'no cookie, nothing folded');
});

t('the browser folds into the cookie for the list it is on, and every box filters as typed', () => {
  const app = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('./public/styles.css', import.meta.url), 'utf8');

  assert.match(
    app,
    /const FOLDED_COOKIES = \{ request: 'itemshare_collapsed', offer: 'itemshare_collapsed_mine' \}/
  );
  assert.match(app, /setTypeFolded\(list, type, shut\)/);
  assert.match(app, /typeToggle\.getAttribute\('data-group-list'\) \|\| 'request'/);
  assert.doesNotMatch(
    app,
    /tab !== 'request' && tab !== 'offer'/,
    'My Requests and Requests Received narrow as they are typed, like the other two'
  );
  assert.match(app, /row\.classList\.contains\('is-collapsed'\)/, 'the search leaves a fold shut');
  assert.match(styles, /\.type-row:not\(\.is-collapsed\) \.type-caret/, 'the caret turns with the fold');
});

// ------------------------------------ opening a folded type really gives its rows back

// The fold names its list with the tab's own word, because the click handler hands that
// word to the search, which looks the list up by panel. `mine` was used for My Inventory,
// which is the *My Requests* panel: folding worked, opening did nothing, because the rows
// were handed back to a tab that draws no item table. These pin the name and the panel it
// resolves to.
const myInventory = renderListRegion({
  user: { provider: 'discord', username: 'evainefaye', id: 1, accountNames: ['@Eva'] },
  accounts: [{ accountName: '@Eva', guilds: [{ guild_name: 'G' }], platform: 'pc', worldName: 'NA' }],
  browsingAccount: '@Eva',
  // On the viewer's own account, which is what puts them on My Inventory.
  sharedItems: [
    { ...item(1, 'Briarheart Dagger', 'Weapons'), account_name: '@Eva' },
    { ...item(3, 'Ancient Silk', 'Apparel'), account_name: '@Eva' },
  ],
  requestItems: [],
  alwaysShare: [],
  requestOffers: [],
  facets: { types: ['Weapons', 'Apparel'], owners: ['@Eva'] },
  filters: { type: [], owner: [], search: '', added: '', order: [], group: true },
  requests: [],
  requestHistory: null,
  basket: { count: 0, quantity: 0, secondsLeft: 0, holdMinutes: 5 },
  basketRows: [],
  received: [],
  receivedHistory: [],
});

t('a My Inventory heading names the tab its rows live in', () => {
  const heading = myInventory.slice(myInventory.indexOf('data-panel="offer"'));

  assert.match(
    heading,
    /data-type-toggle="Apparel" data-group-list="offer"/,
    'offer is the My Inventory tab, the one whose panel holds that table'
  );
  assert.ok(
    myInventory.indexOf('data-panel="mine"') > -1,
    'and mine is the My Requests tab, which draws no type headings at all'
  );
});

t('opening a folded type is aimed at the panel that has the rows, not at "mine"', () => {
  const appSource = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const at = appSource.indexOf('function applyListSearch(');
  let depth = 0;
  let source = '';

  for (let i = appSource.indexOf('{', at); i < appSource.length; i += 1) {
    if (appSource[i] === '{') depth += 1;
    if (appSource[i] === '}') depth -= 1;

    if (depth === 0) {
      source = appSource.slice(at, i + 1);
      break;
    }
  }

  // Only the rows the test needs: the ones the server drew for two types, one of each
  // folded away, exactly as the browser would have them.
  const rows = [...myInventory.matchAll(/<tr\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((markup) => /class="type-row/.test(markup) || /data-search="/.test(markup))
    .map((markup) => {
      const classes = ((markup.match(/class="([^"]*)"/) || [])[1] || '').split(' ').filter(Boolean);
      const search = (markup.match(/data-search="([^"]*)"/) || [])[1];

      return {
        classList: {
          contains: (name) => classes.includes(name),
          add: (name) => classes.push(name),
          remove: (name) => {
            const place = classes.indexOf(name);
            if (place > -1) classes.splice(place, 1);
          },
        },
        hasAttribute: (name) => name === 'data-search' && search !== undefined,
        getAttribute: (name) => (name === 'data-search' ? search : null),
        hidden: false,
        querySelector: () => null,
      };
    });
  const body = { rows };
  const node = {
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === 'table tbody' ? [body] : []),
  };
  const listRegion = {
    querySelector: (selector) =>
      selector === '[data-panel="offer"]' ? node : selector === '[data-panel="mine"]'
        ? { querySelector: () => null, querySelectorAll: () => [] }
        : null,
  };
  const listSearchByTab = { request: '', offer: '', mine: '', received: '' };
  const { applyListSearch } = new Function(
    'listRegion',
    'listSearchByTab',
    'activeTab',
    `${source}\nreturn { applyListSearch };`
  )(listRegion, listSearchByTab, 'offer');
  const visible = () => rows.filter((row) => row.hasAttribute('data-search') && !row.hidden).length;

  assert.equal(visible(), 2, 'two rows to start with');

  // The word the handler uses is the one the heading carries, so this reads it rather than
  // assuming it: the wrong name is what made opening a fold do nothing.
  const name = (myInventory.match(/data-type-toggle="[^"]+" data-group-list="([^"]+)"/) || [])[1];

  assert.ok(name, 'the heading names its list');

  const heading = rows.find((row) => row.classList.contains('type-row'));
  heading.classList.add('is-collapsed');
  for (const row of rows.slice(1)) row.hidden = true;
  assert.equal(visible(), 0, 'folded away');

  heading.classList.remove('is-collapsed');
  for (const row of rows.slice(1)) row.hidden = false;
  applyListSearch(name);
  assert.equal(visible(), 2, 'and back again, because that name is the panel with the table');

  // And the same name finds those rows when a word is typed: proof it is the table's panel
  // and not a tab with nothing in it.
  listSearchByTab[name] = 'ancient';
  applyListSearch(name);
  assert.equal(visible(), 1, 'the word narrows the rows of that list');

  listSearchByTab[name] = '';
  applyListSearch(name);
  assert.equal(visible(), 2, 'and clearing it brings them back');
});

console.log(`\n${total - failures}/${total} passed`);

process.exit(failures ? 1 : 0);
