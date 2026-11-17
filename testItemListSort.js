#!/usr/bin/env node
// The item list's sort queue and the search box above it: what a cookie may hold, what a
// queue turns into as SQL, and what the table and the heading row draw for it. Renders the
// real table out of lib/views.js - no browser, no database.
//
//   npm run test:item-sort

import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  OWNER_SORT_FIELDS,
  SHARED_SORT_FIELDS,
  SORT_FIELDS,
  drawnQueue,
  parseSortOrder,
  queuePlace,
} from './lib/sortQueue.js';
import { orderFor } from './lib/store.js';
import { inventoryTable, listSearchBox, offerTable, renderListRegion } from './lib/views.js';

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

function item(id, name, type, extra = {}) {
  return {
    id,
    item_name: name,
    item_type_name: type,
    item_count: 1,
    // A standing offer draws a row only while the file says what is held beyond the
    // reserve, so the fixture carries one copy: a null means the upload said nothing and
    // the row these checks read would not be drawn at all.
    held_quantity: 1,
    reserve_quantity: 0,
    quality: 4,
    trait: '',
    location_label: '',
    account_name: '@Owner',
    first_seen_at_iso: '2026-11-01T10:00:00Z',
    ...extra,
  };
}

const rows = [
  item(1, 'Briarheart Dagger', 'Weapons', {
    trait: 'Sharpened',
    location_label: 'Bank 3',
    account_name: '@eva',
  }),
  item(2, 'Ancient Silk', 'Apparel', {
    trait: 'Impenetrable',
    location_label: 'Inventory (Eva)',
    account_name: '@sender2',
  }),
];

const queue = (...pairs) => pairs.map(([field, dir]) => ({ field, dir }));

// ------------------------------------------------------------------ the cookie
// The queue is the order the headings were pressed, so it is stored as written rather than
// as flags per column: what comes first has to be recoverable from the string itself.

t('a queue is read back in the order it was written', () => {
  assert.deepEqual(parseSortOrder('trait:desc,name:asc'), [
    { field: 'trait', dir: 'desc' },
    { field: 'name', dir: 'asc' },
  ]);
});

t('an empty or missing cookie means no queue at all', () => {
  assert.deepEqual(parseSortOrder(''), []);
  assert.deepEqual(parseSortOrder(undefined), []);
  assert.deepEqual(parseSortOrder(' , ,'), []);
});

t('every heading’s column is one the cookie may hold', () => {
  for (const field of SORT_FIELDS) {
    assert.deepEqual(parseSortOrder(`${field}:asc`), [{ field, dir: 'asc' }], field);
  }
  assert.deepEqual(SORT_FIELDS, ['name', 'added', 'type', 'trait', 'location', 'owner']);
});

t('a column that is not a heading is dropped rather than guessed at', () => {
  assert.deepEqual(parseSortOrder('mail:asc,stored:desc'), []);
});

t('a direction that is not one of the two is dropped', () => {
  assert.deepEqual(parseSortOrder('name:sideways,name:asc'), [{ field: 'name', dir: 'asc' }]);
});

t('a column cannot stand in the queue twice', () => {
  assert.deepEqual(parseSortOrder('name:asc,type:desc,name:desc'), [
    { field: 'name', dir: 'asc' },
    { field: 'type', dir: 'desc' },
  ], 'the first turn is kept');
});

// ------------------------------------------------------------------- the ranks

t('a heading in the queue knows its place and direction', () => {
  const order = queue(['name', 'asc'], ['trait', 'desc']);

  assert.deepEqual(queuePlace(order, 'name'), { rank: 1, dir: 'asc' });
  assert.deepEqual(queuePlace(order, 'trait'), { rank: 2, dir: 'desc' });
  assert.equal(queuePlace(order, 'type'), null, 'a column that is off has no place');
});

t('switching off the first sort renumbers the ones behind it', () => {
  const before = queue(['name', 'asc'], ['trait', 'desc'], ['owner', 'asc']);
  const after = before.slice(1);

  assert.equal(queuePlace(after, 'trait').rank, 1, 'the second sort is no longer second');
  assert.equal(queuePlace(after, 'owner').rank, 2);
});

t('reversing a sort keeps its place in the queue', () => {
  const order = queue(['name', 'desc'], ['type', 'asc']);

  assert.deepEqual(queuePlace(order, 'name'), { rank: 1, dir: 'desc' });
});

// -------------------------------------------------------- what the queue becomes
// The rows arrive already ordered, so the queue has to reach the query intact.

t('one column sorts by that column alone', () => {
  const sql = orderFor('i', queue(['name', 'asc']));

  assert.match(sql, /i\.item_name ASC/);
  assert.match(sql, /i\.item_name IS NULL OR i\.item_name = ''/, 'empty sinks');
});

t('the direction reaches the query', () => {
  assert.match(orderFor('i', queue(['trait', 'desc'])), /i\.trait DESC/);
  assert.doesNotMatch(orderFor('i', queue(['trait', 'asc'])), /i\.trait DESC/);
});

t('a second column is consulted after the first', () => {
  const sql = orderFor('i', queue(['owner', 'asc'], ['name', 'desc']));

  assert.ok(sql.indexOf('i.account_name') < sql.indexOf('i.item_name DESC'), sql);
});

t('each column carries its own direction', () => {
  const sql = orderFor('i', queue(['name', 'asc'], ['trait', 'desc']));

  assert.match(sql, /i\.item_name ASC/);
  assert.match(sql, /i\.trait DESC/);
});

t('a row with nothing in the column sinks whichever way it runs', () => {
  for (const dir of ['asc', 'desc']) {
    const sql = orderFor('i', queue(['trait', dir]));

    assert.ok(
      sql.indexOf("i.trait IS NULL OR i.trait = ''") < sql.indexOf(`i.trait ${dir.toUpperCase()}`),
      dir
    );
  }
});

t('a column the list does not have never reaches the query', () => {
  assert.doesNotMatch(orderFor('i', queue(['mail', 'asc'])), /mail/);
});

t('rows the queue cannot separate keep a stable order', () => {
  assert.match(orderFor('i', []), /i\.item_name ASC, i\.account_name ASC, i\.id ASC$/);
});

t('the offering table is ordered by location too, now that it draws the column', () => {
  const sql = orderFor('a', queue(['location', 'asc'], ['name', 'desc']));

  assert.match(sql, /a\.location_label ASC/);
  assert.match(sql, /a\.item_name DESC/);
});

// ------------------------------------------------------------- the headings

const request = (filters) => inventoryTable(rows, { mine: false, filters });
const offering = (filters) => inventoryTable(rows, { mine: true, filters });

t('every column that can decide the order is a heading that sorts', () => {
  const html = request({});

  for (const field of ['name', 'added', 'type', 'trait', 'owner']) {
    assert.match(html, new RegExp(`data-sort="${field}"`), field);
  }
});

t('location sorts on Offering, where the column is drawn', () => {
  assert.match(offering({}), /data-sort="location"/);
  assert.doesNotMatch(request({}), /data-sort="location"/, 'Request keeps others’ bags to itself');
});

t('an active heading carries its place as a superscript before the arrow', () => {
  const html = request({ order: queue(['name', 'asc'], ['trait', 'desc']) });

  assert.match(html, /<sup class="sort-rank">1<\/sup>\u25b2/);
  assert.match(html, /<sup class="sort-rank">2<\/sup>\u25bc/);
});

t('a heading that is off carries no badge', () => {
  const html = request({ order: queue(['name', 'asc']) });

  assert.match(html, /<span class="sort-queue" hidden><\/span>/);
  assert.doesNotMatch(html, /<sup class="sort-rank">2<\/sup>/);
});

t('a sort on a column this table does not draw is not a place in its queue', () => {
  // Sorted by LOCATION on My Inventory, then opened Request. That table draws no LOCATION
  // heading, so it shows no badge for it - and it must not count it either, or the page
  // looks unsorted while the first heading pressed there is numbered 2 with nothing above it.
  const html = request({ order: queue(['location', 'asc']) });

  assert.doesNotMatch(html, /<sup class="sort-rank">/, 'nothing to show, nothing counted');
});

t('so the first heading pressed on Request really is the first', () => {
  const html = request({ order: queue(['location', 'asc'], ['name', 'asc']) });

  assert.match(html, /<sup class="sort-rank">1<\/sup>\u25b2/, 'Item is 1, not 2');
  assert.doesNotMatch(html, /<sup class="sort-rank">2<\/sup>/);
});

t('My Inventory keeps LOCATION in its queue, because it draws that column', () => {
  const html = offering({ order: queue(['location', 'asc'], ['name', 'asc']) });

  assert.match(html, /aria-label="Location, sorted ascending, 1 in the sort order"/);
  assert.match(html, /aria-label="Item, sorted ascending, 2 in the sort order"/);
});

t('a standing offer on Request counts the same way its own headings do', () => {
  const html = offerTable(rows, { mine: false, filters: { order: queue(['location', 'asc'], ['owner', 'desc']) } });

  assert.match(html, /<sup class="sort-rank">1<\/sup>\u25bc/, 'Offered by is 1');
});

t('drawnQueue keeps only the columns the table is given', () => {
  const order = queue(['location', 'asc'], ['name', 'desc']);

  assert.deepEqual(drawnQueue(order, SHARED_SORT_FIELDS).map((entry) => entry.field), ['name']);
  assert.deepEqual(drawnQueue(order, OWNER_SORT_FIELDS).map((entry) => entry.field), ['location', 'name']);
  assert.deepEqual(drawnQueue(undefined, SHARED_SORT_FIELDS), []);
});

t('the Request rows are ordered by that same cut queue, not by the hidden column', () => {
  const server = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const from = server.indexOf('data.requestItems = await getSharedItemsForViewer');

  assert.match(server, /const sharedOrder = drawnQueue\(filters\.order, SHARED_SORT_FIELDS\)/);
  assert.ok(from > -1, 'the Request list is fetched');
  assert.match(server.slice(from, from + 240), /order: sharedOrder/, 'and ordered by the cut queue');

  const offers = server.indexOf('data.requestOffers = await getAlwaysShareForViewer');
  assert.ok(offers > -1);
  assert.match(server.slice(offers, offers + 260), /order: sharedOrder/);
});

t('the heading reports the direction and its place to a screen reader', () => {
  const html = request({ order: queue(['name', 'asc'], ['trait', 'desc']) });

  assert.match(html, /aria-sort="ascending"/);
  assert.match(html, /aria-label="Trait, sorted descending, 2 in the sort order"/);
  assert.match(html, /aria-label="Type, not sorted"/);
});

t('the closing table offers the same columns it has', () => {
  const html = offerTable(rows, { mine: false, filters: { order: queue(['owner', 'desc']) } });

  assert.match(html, /data-sort="owner" data-dir="desc"/);
  assert.match(html, /<sup class="sort-rank">1<\/sup>\u25bc/);
});

// ---------------------------------------------------------------- the search

t('a row says what it can be found by', () => {
  const html = offering({});

  assert.match(html, /data-search="Briarheart Dagger Weapons Sharpened Bank 3 @eva"/);
  assert.match(html, /data-search="Ancient Silk Apparel Impenetrable Inventory \(Eva\) @sender2"/);
});

t('Request can be found by the same things, minus the storage place', () => {
  const html = request({});

  assert.match(html, /data-search="Briarheart Dagger Weapons Sharpened @eva"/);
  assert.doesNotMatch(html, /data-search="[^"]*Bank 3[^"]*"/);
});

t('an offer of your own can be found by the bag it counts', () => {
  const html = offerTable(rows, { mine: true, filters: {} });

  assert.match(html, /data-search="Briarheart Dagger Weapons Sharpened Bank 3 @eva"/);
});

t('somebody else’s offer keeps their storage out of the search', () => {
  const html = offerTable(rows, { mine: false, filters: {} });

  assert.match(html, /data-search="Briarheart Dagger Weapons Sharpened @eva"/);
  assert.doesNotMatch(html, /data-search="[^"]*Bank 3[^"]*"/);
});

t('the closing table carries the list’s headings, in its order', () => {
  const headings = (html) => [...html.matchAll(/<th\b/g)].length;
  const sortable = (html) => [...html.matchAll(/data-sort="([a-z]+)"/g)].map((match) => match[1]);

  for (const mine of [false, true]) {
    const inventory = inventoryTable(rows, { mine, filters: {} });
    const offers = offerTable(rows, { mine, filters: {} });

    assert.equal(headings(offers), headings(inventory), `same number of columns, mine=${mine}`);
    assert.deepEqual(sortable(offers), sortable(inventory), `same headings, mine=${mine}`);
  }

  assert.deepEqual(sortable(offerTable(rows, { mine: true, filters: {} })), [
    'name', 'added', 'type', 'trait', 'location', 'owner',
  ]);
  assert.deepEqual(sortable(offerTable(rows, { mine: false, filters: {} })), [
    'name', 'added', 'type', 'trait', 'owner',
  ]);
});

t('both tables are cut to the same widths', () => {
  const columns = (html) => (html.match(/<colgroup>[\s\S]*?<\/colgroup>/) || [''])[0];

  for (const mine of [false, true]) {
    assert.equal(
      columns(offerTable(rows, { mine, filters: {} })),
      columns(inventoryTable(rows, { mine, filters: {} })),
      `the same <colgroup>, mine=${mine}`
    );
  }

  assert.doesNotMatch(columns(offerTable(rows, { mine: false, filters: {} })), /col-location/);
  assert.match(columns(offerTable(rows, { mine: true, filters: {} })), /col-location/);
});

t('the item column takes a share of the row, not the rest of it', () => {
  for (const mine of [false, true]) {
    const html = offerTable(rows, { mine, filters: {} });
    const widths = [...html.matchAll(/style="width:([\d.]+)%"/g)].map((match) => Number(match[1]));

    assert.equal(widths.length, mine ? 10 : 9, `one width per column, mine=${mine}`);
    assert.equal(widths.reduce((sum, width) => sum + width, 0), 100, `fills the row, mine=${mine}`);
    assert.ok(widths[0] <= 29, `ITEM keeps a share rather than the remainder, mine=${mine}`);
    // Every heading has to fit its column: OFFERED, RESERVED and AVAILABLE are the longest
    // words in the row and used to be squeezed into widths too small to draw them.
    for (const width of widths.slice(2, 5)) {
      assert.ok(width >= 8, `a quantity column holds its heading, mine=${mine}`);
    }
  }
});

t('a standing offer row fills every column its headings name', () => {
  for (const mine of [false, true]) {
    const html = offerTable([rows[0]], { mine, filters: {} });
    const columns = [...html.matchAll(/<th\b/g)].length;
    const body = html.slice(html.indexOf('<tbody>'));
    const cells = [...body.slice(0, body.indexOf('</tr>')).matchAll(/<td\b/g)].length;

    assert.equal(cells, columns, `mine=${mine}`);
  }
});

t('the heading row holds a search box with a cross to clear it', () => {
  const html = listSearchBox();

  assert.match(html, /<input class="list-search-input" id="listSearch-request" type="search"/);
  assert.match(html, /placeholder="Search this list"/);
  assert.match(html, /data-list-search="request">/);
  assert.match(html, /aria-label="Search this list"/);
});

t('the cross starts out of the way, and is a button rather than a glyph', () => {
  const html = listSearchBox();

  assert.match(html, /<button class="list-search-clear" type="button" data-list-search-clear/);
  assert.match(html, /aria-label="Clear the search"/);
  assert.match(html, /hidden>&times;<\/button>/);
});

t('the search box is not part of any form, so it cannot be submitted', () => {
  assert.doesNotMatch(listSearchBox(), /<form/);
  assert.doesNotMatch(listSearchBox(), /name="/, 'nothing to post');
});

t('the search shares the row with the grouping switch', () => {
  const region = renderListRegion({
    user: { id: 1, username: 'eva', provider: 'password' },
    accounts: [{ accountName: '@eva', guildCount: 1, guilds: [{}] }],
    sharedItems: [],
    requestItems: [item(2, 'Ancient Silk', 'Apparel', { account_name: '@sender2' })],
    alwaysShare: [],
    requestOffers: [],
    facets: { types: [{ name: 'Apparel', total: 1 }], owners: ['@sender2'] },
    filters: {},
    requests: [],
    basketRows: [],
  });

  const panel = region.indexOf('id="panelRequest"');
  const tools = region.indexOf('<div class="list-tools">');
  const search = region.indexOf('class="list-search"');
  const toggle = region.indexOf('data-group-toggle');

  assert.ok(panel > -1 && tools > -1 && search > -1 && toggle > -1, 'all four are drawn');
  assert.ok(panel < tools, 'the row belongs to the list it narrows');
  assert.ok(tools < search && search < toggle, 'the box and the switch share the row, box first');
  // One box for this tab, and the other tabs have their own: browsing offers and looking at
  // requests are different searches even when both are open at once.
  const mine = region.indexOf('id="panelMine"');
  const inRequestTab = region.slice(panel, mine > panel ? mine : undefined);

  assert.equal(
    inRequestTab.indexOf('class="list-search"', inRequestTab.indexOf('class="list-search"') + 1),
    -1,
    'one box for the tab'
  );
  assert.match(region, /id="listSearch-request"/);
  assert.match(region, /id="listSearch-mine"/, 'My Requests has one too');
  assert.match(region, /id="listSearch-received"/, 'and so does Requests Received');
});

// ------------------------------------------------- the count while searching
// A heading's number is the server's count of the whole group. app.js narrows the rows
// when a term is typed, so it has to narrow the number with them - read out of the real
// source here, so the two cannot drift apart.

const appSource = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');

// The copy of the heading row only earns its place if a press on it does what a press on the
// real heading does - and it must not add a second way round the page with the keyboard.
t('a pinned heading takes a press, and no second tab stop', () => {
  const css = fs.readFileSync(new URL('./public/styles.css', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const bar = css.match(/\.table-head\s*\{[^}]*\}/)?.[0] || '';

  assert.ok(bar, 'the pinned copy is styled');
  assert.doesNotMatch(
    bar,
    /pointer-events:\s*none/,
    'nothing stands between a press and the pinned headings'
  );
  assert.match(app, /control\.tabIndex = -1/, 'the copied buttons stay out of the tab order');
  for (const kind of ['mousedown', 'pointerdown']) {
    assert.match(
      app,
      new RegExp(`addEventListener\\('${kind}'`),
      `a ${kind} press on a copy does not leave the caret on a row that is about to move`
    );
  }
  assert.match(app, /pointerType !== 'mouse'/, 'a finger or a pen is suppressed where it focuses');
});

// The bars that pin the list have to be fully opaque. The block over the tabs was painted with
// the card's panel - 44% - so a row scrolling under it read straight through the line that
// counts what is shared, and the bars below it at 92-96% still let a row edge show.
t('the bars that pin are painted opaque, so rows cannot read through them', () => {
  const css = fs.readFileSync(new URL('./public/styles.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /--panel-solid:\s*#[0-9a-f]{6}\s*;/i,
    'a colour with no alpha in it for the bars to paint with'
  );

  const solid = (selector, body) => {
    const background = body.match(/background(?:-color)?:\s*([\s\S]*?);/)?.[1] || '';
    assert.ok(background, `${selector} is given a background`);
    assert.match(
      background.trim(),
      /(?:var\(--panel-solid\)|#[0-9a-f]{6})$/i,
      `${selector} is painted with a solid colour, not ${JSON.stringify(background.trim())}`
    );
  };

  for (const selector of [
    '.list-top',
    '.list-head',
    '.filter-band',
    '.list-tools',
  ]) {
    const block = css.match(
      new RegExp(selector.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}')
    );
    assert.ok(block, `${selector} is drawn`);
    solid(selector, block[1]);
  }

  // The column headings carry no class of their own, so they are found by the rule that pins
  // them rather than by name.
  const pinned = css.match(/\nth\s*\{[^}]*position:\s*sticky[^}]*\}/)?.[0] || '';
  assert.ok(pinned, 'the heading cells pin');
  solid('th', pinned);
});

function appBetween(start, end) {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end, from);

  assert.ok(from >= 0 && to > from, `Missing source anchors: ${start}`);
  return appSource.slice(from, to);
}

const searchSource = appBetween(
  '  function applyListSearch(tab = activeTab)',
  '  function updateSearchClear(tab)'
);

function headingRow(count) {
  const countElement = { textContent: `(${count})` };

  return {
    classList: { contains: (name) => name === 'type-row' },
    hidden: false,
    querySelector: (selector) => (selector === '.type-count' ? countElement : null),
    count: countElement,
  };
}

function itemRow(text) {
  // The marks are the ones app.js writes: `data-search-miss` on a row the word left out.
  const marks = new Set();

  return {
    classList: { contains: () => false },
    hidden: false,
    hasAttribute: (name) => (name === 'data-search' ? true : marks.has(name)),
    getAttribute: (name) => (name === 'data-search' ? text : null),
    setAttribute: (name) => marks.add(name),
    removeAttribute: (name) => marks.delete(name),
  };
}

// Runs app.js's own applyListSearch against the smallest page it can see: one table body,
// the rows in it, and nothing else.
function runSearch(term, rows) {
  const region = {
    querySelectorAll: (selector) => (selector === 'table tbody' ? [{ rows }] : []),
    querySelector: () => null,
  };
  const apply = new Function(
    'listRegion',
    'activeTab',
    'listSearchByTab',
    'syncCounts',
    `${searchSource}; return applyListSearch;`
  )(region, 'request', { request: term, offer: '' }, () => {});

  apply();

  return rows;
}

t('each heading counts its own group when nothing is being searched', () => {
  const apparel = headingRow(2);
  const weapons = headingRow(1);

  runSearch('', [
    apparel,
    itemRow('Ancient Silk Apparel Impenetrable'),
    itemRow('Cuirass Apparel Reinforced'),
    weapons,
    itemRow('Briarheart Dagger Weapons Sharpened'),
  ]);

  assert.equal(apparel.count.textContent, '(2)');
  assert.equal(weapons.count.textContent, '(1)');
});

t('a search makes the heading count the rows the word leaves', () => {
  const weapons = headingRow(2);
  const dagger = itemRow('Briarheart Dagger Weapons Sharpened');
  const ring = itemRow('Amber Ring Weapons Robust');

  runSearch('dagger', [weapons, dagger, ring]);

  assert.equal(dagger.hidden, false, 'the row that matches stays');
  assert.equal(ring.hidden, true, 'the row that does not is hidden');
  assert.equal(weapons.count.textContent, '(1)', 'the one row the word leaves');
});

t('a group with nothing to show loses its heading', () => {
  const apparel = headingRow(2);
  const weapons = headingRow(1);

  runSearch('dagger', [
    apparel,
    itemRow('Ancient Silk Apparel Impenetrable'),
    itemRow('Cuirass Apparel Reinforced'),
    weapons,
    itemRow('Briarheart Dagger Weapons Sharpened'),
  ]);

  assert.equal(apparel.hidden, true, 'no Apparel row matches, so the heading goes');
  assert.equal(weapons.hidden, false);
  assert.equal(weapons.count.textContent, '(1)');
});

// A word is typed over one tab, so it narrows that one tab. Both tables are in the page all
// the time - one is only hidden - so a pass that walked every body would filter rows its
// word was never meant for.
function panelOf(rows) {
  return {
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === 'table tbody' ? [{ rows }] : []),
  };
}

function runTabSearch(tab, terms, panels) {
  const region = {
    querySelectorAll: () => [],
    querySelector: (selector) => {
      const match = /^\[data-panel="([a-z]+)"\]$/.exec(selector);
      return match ? panels[match[1]] || null : null;
    },
  };
  const apply = new Function(
    'listRegion',
    'activeTab',
    'listSearchByTab',
    'syncCounts',
    `${searchSource}; return applyListSearch;`
  )(region, tab, terms, () => {});

  apply();
}

t('a word typed on one tab leaves the other tab alone', () => {
  const requested = [itemRow('Briarheart Dagger Weapons Sharpened'), itemRow('Amber Ring Weapons Robust')];
  const offered = [itemRow('Briarheart Dagger Weapons Sharpened'), itemRow('Amber Ring Weapons Robust')];

  runTabSearch('request', { request: 'dagger', offer: '' }, {
    request: panelOf(requested),
    offer: panelOf(offered),
  });

  assert.equal(requested[0].hidden, false, 'the dagger asked for stays');
  assert.equal(requested[1].hidden, true, 'the ring asked for goes');
  assert.equal(offered[0].hidden, false, 'Offering keeps every row it had');
  assert.equal(offered[1].hidden, false);
});

t('each tab keeps its own word', () => {
  const requested = [itemRow('Briarheart Dagger Weapons Sharpened'), itemRow('Amber Ring Weapons Robust')];
  const offered = [itemRow('Briarheart Dagger Weapons Sharpened'), itemRow('Amber Ring Weapons Robust')];

  runTabSearch('offer', { request: 'dagger', offer: 'ring' }, {
    request: panelOf(requested),
    offer: panelOf(offered),
  });

  assert.equal(offered[1].hidden, false, 'Offering is narrowed by the word typed on it');
  assert.equal(offered[0].hidden, true);
  assert.equal(requested[0].hidden, false, 'Request was not re-run against the other tab word');
  assert.equal(requested[1].hidden, false);
});

t('clearing the search puts the plain totals back', () => {
  const weapons = headingRow(2);
  const dagger = itemRow('Briarheart Dagger Weapons Sharpened');
  const ring = itemRow('Amber Ring Weapons Robust');

  runSearch('dagger', [weapons, dagger, ring]);
  runSearch('', [weapons, dagger, ring]);

  assert.equal(weapons.count.textContent, '(2)');
  assert.equal(dagger.hidden, false);
  assert.equal(ring.hidden, false);
});

t('a term matches a row the heading does not name', () => {
  const weapons = headingRow(2);
  const row = itemRow('Briarheart Dagger Weapons Sharpened');

  runSearch('sharpened', [weapons, row, itemRow('Amber Ring Weapons Robust')]);

  assert.equal(row.hidden, false, 'the trait is in the row text, the heading is not searched');
  assert.equal(weapons.count.textContent, '(1)');
});

t('an empty My Requests tab draws both tables and says so in each', () => {
  const region = renderListRegion({
    user: { id: 1, username: 'eva', provider: 'password' },
    accounts: [{ accountName: '@eva', guildCount: 1, guilds: [{}] }],
    sharedItems: [],
    requestItems: [],
    alwaysShare: [],
    requestOffers: [],
    facets: { types: [], owners: [] },
    filters: {},
    requests: [],
    basketRows: [],
  });

  const panel = region.slice(
    region.indexOf('id="panelMine"'),
    region.indexOf('id="panelOffer"')
  );

  // Neither table disappears when it is empty: the headings stay, and one line across every
  // column says there is nothing in it. A section that vanishes reads as one that failed.
  assert.match(panel, /In your basket/);
  assert.match(panel, /<tr class="empty-row"><td colspan="5">No items have been requested\./, 'the basket says so across its columns');
  assert.match(panel, /Submitted requests/);
  assert.match(panel, /No requests have been sent yet\./, 'and so does the log');
  assert.match(panel, />Qty<span class="sort-queue"/, 'the headings are still drawn under an empty list');
  assert.doesNotMatch(region, /You have not asked for anything yet/, 'the old sentence is gone');
});

t('the line above the tabs names the browsed-as account and counts properly', () => {
  const region = (items, accounts) =>
    renderListRegion({
      user: { id: 1, username: 'eva', provider: 'password' },
      accounts,
      sharedItems: [],
      requestItems: items,
      alwaysShare: [],
      requestOffers: [],
      facets: { types: [], owners: [] },
      filters: {},
      requests: [],
      basketRows: [],
    });

  const sender = { account_name: '@sender2' };
  const threeGuilds = [{ accountName: '@eva', guildCount: 3, guilds: [{}, {}, {}] }];
  const oneGuild = [{ accountName: '@eva', guildCount: 1, guilds: [{}] }];

  assert.match(
    region([item(1, 'Briarheart Dagger', 'Weapons', sender)], threeGuilds),
    />1 item shared by members of @eva&rsquo;s guilds</
  );
  assert.match(
    region(
      [
        item(1, 'Briarheart Dagger', 'Weapons', sender),
        item(2, 'Ancient Silk', 'Apparel', sender),
      ],
      oneGuild
    ),
    />2 items shared by members of @eva&rsquo;s guild</
  );
  // A visitor has no account to name, so the sentence falls back rather than leaving a gap.
  assert.match(
    region([item(1, 'Briarheart Dagger', 'Weapons', sender)], []),
    />1 item shared by members of the guilds they share with</
  );
  // The wording this replaced: "different" before the count and "other members".
  assert.doesNotMatch(region([item(1, 'Briarheart Dagger', 'Weapons', sender)], threeGuilds),
    /different item|other members/);
});

t('the guilds being browsed are named under the line, one pill each', () => {
  const accounts = [
    {
      accountName: '@eva',
      guildCount: 3,
      guilds: [
        { guild_id: 1, guild_name: 'Alphabet Mafia', invited: 0 },
        { guild_id: 2, guild_name: 'Wandering Merchants', invited: 1 },
        // A guild the upload could not name is not a pill, so it is not counted either.
        { guild_id: 3, guild_name: '   ', invited: 0 },
      ],
    },
  ];
  const html = renderListRegion({
    user: { id: 1, username: 'eva', provider: 'password' },
    accounts,
    sharedItems: [],
    requestItems: [item(1, 'Briarheart Dagger', 'Weapons', { account_name: '@sender2' })],
    alwaysShare: [],
    requestOffers: [],
    facets: { types: [], owners: [] },
    filters: {},
    requests: [],
    basketRows: [],
  });
  const pills = html.match(/<div class="guild-pills">.*?<\/div>/s)?.[0] || '';

  // The fold control comes first, then the three lines it folds away: the count line still
  // opens the block itself, and the live pill and the control stay outside the part that folds.
  assert.match(
    html,
    /<div class="list-top">\s*<button[^>]*data-list-top-toggle[^>]*aria-expanded="true"[\s\S]*?<\/button>\s*<div class="list-top-body"[^>]*><p class="offer-summary">1 item shared by members of @eva&rsquo;s guilds<\/p>/,
    'the block opens with the fold control and the count line inside the part that folds'
  );
  assert.match(
    html,
    /<\/div>\s*<span class="live-pill"/,
    'the live pill stays outside the body, so folding keeps it'
  );
  assert.equal(
    (pills.match(/<span class="chip">/g) || []).length,
    2,
    'one pill per named guild, and none for the nameless one'
  );
  assert.match(pills, /<span class="chip">Alphabet Mafia<\/span>/, 'the guild the game reports');
  assert.match(pills, /<span class="chip">Wandering Merchants<\/span>/, 'and the slot a code opened');
  assert.ok(
    html.indexOf('guild-pills') < html.indexOf('browsing-picker'),
    'the pills sit between the line they belong to and the account line'
  );
});

t('the header block above the tabs is what pins, and the tabs hang off it', () => {
  const css = fs.readFileSync('public/styles.css', 'utf8');
  const block = css.match(/\.list-top \{[^}]*\}/)?.[0] || '';
  const tabs = css.match(/\.list-head \{[^}]*\}/)?.[0] || '';

  assert.match(block, /position: sticky;/, 'the count line and guilds stay on top');
  assert.match(tabs, /top: calc\(var\(--sticky-top, 0px\) \+ var\(--list-top-h, 0px\)\)/, 'with the tabs pinned under its measured height');
  assert.match(css, /--list-top-h/, 'an offset the page measures rather than a guessed number');
});

// The floor under the pinned copy: the bottom of the lowest bar that is actually pinned over the
// table. Two of the tables on the page pin 59px below their own headings line - the second My
// Requests table, whose card's search row is pinned above it but is not its neighbour, and both
// Requests Received tables - so a floor that stopped binding would drop their copy onto a pinned
// row. The function is lifted out of public/app.js and run against a stub page, because what it
// reads - rects, a computed `top` - only exists in a browser.
function floorFor(bars, shell) {
  const source = fs.readFileSync('public/app.js', 'utf8');
  const start = source.indexOf('function pinnedFloor(shell) {');
  assert.ok(start > -1, 'pinnedFloor is still in public/app.js');

  let depth = 0;
  let end = source.length;

  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  const body = source.slice(start, end);
  const doc = { querySelectorAll: () => bars };
  const win = { getComputedStyle: (bar) => ({ top: `${bar.own}px` }) };
  const node = { DOCUMENT_POSITION_FOLLOWING: 4 };

  return new Function('document', 'window', 'Node', `${body}\nreturn pinnedFloor;`)(doc, win, node)(shell);
}

function stubBar({ name, top, own = 0, bottom, following = true, visible = true }) {
  return {
    name,
    offsetParent: visible ? {} : null,
    own,
    compareDocumentPosition: () => (following ? 4 : 0),
    getBoundingClientRect: () => ({ top, bottom }),
  };
}

t('the pinned copy clears the lowest bar pinned over the table', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');

  assert.match(
    app,
    /const line = Math\.max\(\s*parseFloat\(window\.getComputedStyle\(heading\)\.top\) \|\| 0,\s*pinnedFloor\(shell\)\s*\)/,
    'the bar takes the lower of its headings line and the bar above it, and never sits above it'
  );

  const floor = floorFor(
    [
      stubBar({ name: 'top-bar', top: 0, bottom: 113 }),
      stubBar({ name: 'filter band', top: 354, own: 354, bottom: 447 }),
      stubBar({ name: 'search row', top: 425, own: 425, bottom: 484 }),
      // A shorter bar after it: the last bar is not the lowest one, so the floor has to be a
      // running maximum rather than whichever bar came last.
      stubBar({ name: 'standing offers bar', top: 470, own: 470, bottom: 460 }),
    ],
    {}
  );

  assert.equal(floor, 484, 'the lowest bottom wins, not the last bar found');
});

t('a bar that has not reached its line yet is not a floor', () => {
  // The case that was wrong on My Requests: the search row sits in flow 59px below where it will
  // pin, and counting it pushed every visible heading, and the copy over them, down by its whole
  // height. A floor that took any bar above the table would read 683 here.
  assert.equal(
    floorFor([stubBar({ name: 'search row', top: 624, own: 425, bottom: 683 })], {}),
    0,
    'a bar still in flow is passed over'
  );

  assert.equal(
    floorFor(
      [
        stubBar({ name: 'filter band', top: 354, own: 354, bottom: 447 }),
        stubBar({ name: 'search row', top: 624, own: 425, bottom: 683 }),
      ],
      {}
    ),
    447,
    'the pinned band above it still counts'
  );
});

t('only bars over this table, and only ones on screen, are a floor', () => {
  assert.equal(
    floorFor([stubBar({ name: 'a bar after the table', top: 0, bottom: 900, following: false })], {}),
    0,
    'a bar that follows the table in the page is not over it'
  );
  assert.equal(
    floorFor([stubBar({ name: 'a bar in a hidden panel', top: 0, bottom: 900, visible: false })], {}),
    0,
    'a bar in a panel nobody is looking at is not over it either'
  );
});

console.log(`\n${total - failures}/${total} passed`);

process.exit(failures ? 1 : 0);
