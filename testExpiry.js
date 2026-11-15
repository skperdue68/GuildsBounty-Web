#!/usr/bin/env node
// Expiry: what the upload's expireDays becomes, what the list draws for it, and what the
// Added menu offers. Reads the real parser and renders the real table out of lib/views.js -
// no browser, no database.
//
//   npm run test:expiry

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { extractShareData } from './lib/savedVars.js';
import { filterBar, inventoryTable } from './lib/views.js';

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

function file(scopeExtra) {
  return `ItemShareSavedVars =
{
    ["Default"] =
    {
        ["@Tester"] =
        {
            ["$AccountWide"] =
            {
                ["platformRaw"] = 2,
                ["worldName"] = "NA Megaserver",
                ["itemFirstDumped"] =
                {
                    ["|H1:item:12345:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0|h|h"] = 1794000000,
                },${scopeExtra}
                ["sharedItems"] =
                {
                    [1] =
                    {
                        ["itemName"] = "Ring of the Gorethief",
                        ["itemLink"] = "|H1:item:12345:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0|h|h",
                        ["itemTypeName"] = "Apparel",
                        ["count"] = 1,
                        ["lastDumpedAt"] = 1794000000,
                    },
                },
            },
        },
    },
}
`;
}

function item(extra = {}) {
  return {
    id: 1,
    item_key_hash: 'abc',
    item_name: 'Ring of the Gorethief',
    item_type_name: 'Apparel',
    item_count: 1,
    held_quantity: 1,
    reserve_quantity: 0,
    quality: 5,
    trait: 'Robust',
    location_label: 'Bank',
    account_name: '@Tester',
    first_seen_at_iso: '2026-10-01T10:00:00Z',
    guild_names: 'Guild',
    ...extra,
  };
}

const render = (extra) => inventoryTable([item(extra)], { mine: false, filters: {} });

// ------------------------------------------------------------------ the file

t('expireDays is read per account', () => {
  const parsed = extractShareData(file('\n                ["expireDays"] = 14,'));

  assert.equal(parsed.accountExpiryDays.get('@Tester'), 14);
});

t('a file with no expireDays expires nothing', () => {
  const parsed = extractShareData(file(''));

  assert.equal(parsed.accountExpiryDays.size, 0, 'no window is invented');
});

t('a nonsense expireDays is clamped rather than trusted', () => {
  assert.equal(extractShareData(file('\n                ["expireDays"] = -3,')).accountExpiryDays.size, 0);
  assert.equal(
    extractShareData(file('\n                ["expireDays"] = 999999,')).accountExpiryDays.get('@Tester'),
    3650
  );
});

// ------------------------------------------------------- where the date lives now

// 1.11.39 keeps the date once per item link, beside the item list, and clears the copy on
// the row. Two places keeping the same item are one offer, so both rows report one day -
// and a row whose link is not in the table reports nothing rather than borrowing a date.
function fileWithTable(tableBody) {
  return `ItemShareSavedVars =
{
    ["Default"] =
    {
        ["@Tester"] =
        {
            ["$AccountWide"] =
            {
                ["platformRaw"] = 2,
                ["worldName"] = "NA Megaserver",
                ["itemFirstDumped"] = { ${tableBody} },
                ["sharedItems"] =
                {
                    [1] =
                    {
                        ["itemName"] = "Ring of the Gorethief",
                        ["itemLink"] = "|H1:item:12345:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0|h|h",
                        ["locationKey"] = "bank",
                        ["count"] = 1,
                    },
                    [2] =
                    {
                        ["itemName"] = "Ring of the Gorethief",
                        ["itemLink"] = "|H1:item:12345:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0|h|h",
                        ["locationKey"] = "house",
                        ["sharedFrom"] = "Placed (Mournoth Keep)",
                        ["count"] = 1,
                    },
                },
            },
        },
    },
}
`;
}

t('every row of a link reports the day the item was first offered', () => {
  const link = extractShareData(file('')).items[0].itemLink;
  const parsed = extractShareData(fileWithTable(`["${link}"] = 1700000000,`));

  assert.equal(parsed.items.length, 2, 'both places were read');
  assert.deepEqual(
    parsed.items.map((row) => row.firstDumpedAt),
    [1700000000, 1700000000],
    'the bank copy and the house copy agree, and neither is 0'
  );
});

t('the date comes from the table, not from a copy left on the row', () => {
  const parsed = extractShareData(file(''));
  const link = parsed.items[0].itemLink;

  assert.equal(parsed.items[0].firstDumpedAt, 1794000000, 'read from the table');

  const without = extractShareData(file('').replace(link, '|H1:item:999:0|h|h'));

  assert.equal(
    without.items[0].firstDumpedAt,
    0,
    'a link the table does not name is not given another row\'s date'
  );
});

t('the Added cell shows the date the owner\'s file gave the item', () => {
  const html = inventoryTable(
    [item({ added_at_iso: '2025-03-04T05:06:07Z' })],
    { mine: false, filters: {} }
  );

  assert.match(html, /datetime="2025-03-04T05:06:07Z"/, 'the item\'s own date, not today');
  assert.doesNotMatch(html, /datetime="2026-10-01T10:00:00Z"/, 'not the day it reached us');
});

t('a row with no date from the file still shows the day the site saw it', () => {
  const html = inventoryTable([item({})], { mine: false, filters: {} });

  assert.match(html, /datetime="2026-10-01T10:00:00Z"/);
});

// ------------------------------------------------------------------ the row

t('an expiring row carries the pill and its tooltip', () => {
  const html = render({ expiring: 1, expire_days: 14 });

  assert.match(html, /class="last-chance-pill"[^>]*>LAST CHANCE</);
  assert.match(
    html,
    /title="Item has been shared longer than 14 days and is subject to being removed from sharing, act quickly!"/
  );
});

t('the pill is the only change: the row keeps its counts', () => {
  const html = render({ expiring: 1, expire_days: 14 });

  assert.doesNotMatch(html, /class="row-last-chance"/, 'the row is not marked apart');
  assert.doesNotMatch(html, /filter: grayscale|<tr[^>]*style="[^"]*opacity/, 'nothing is dimmed');
  assert.match(html, /<td class="num">1<\/td>/, 'AVAILABLE still says 1');
});

t('a row inside its window is untouched', () => {
  assert.doesNotMatch(render({ expiring: 0, expire_days: 14 }), /last-chance-pill/);
  assert.doesNotMatch(render({}), /last-chance-pill/, 'no expireDays means no flag');
});

// ------------------------------------------------------------------ the filter

const bar = filterBar({ types: [{ name: 'Apparel', total: 1 }], owners: ['@Tester'] }, {});

t('Added is a menu like Type and Offered by, not a dropdown', () => {
  assert.doesNotMatch(bar, /<select name="added"/);
  assert.match(bar, /data-filter-menu data-all-label="Any Time"/);
  assert.match(bar, /<span class="filter-label">Added<\/span>/);
});

t('Added holds one choice at a time', () => {
  const added = bar.slice(bar.indexOf('aria-label="Added"'));

  assert.match(added, /<input type="radio" name="added" value="1"/, 'radios, not checkboxes');
  assert.doesNotMatch(added, /type="checkbox" name="added"/);
});

t('LAST CHANCE is the last choice', () => {
  const added = bar.slice(bar.indexOf('aria-label="Added"'), bar.indexOf('</details>', bar.indexOf('aria-label="Added"')));

  assert.match(added, /LAST CHANCE<\/span>/, 'the option is there');
  assert.ok(
    added.indexOf('LAST CHANCE') > added.indexOf('Last 30 Days'),
    'and it comes after the windows'
  );
  assert.match(added, /filter-option-warn/, 'drawn as the warning it is');
});

t('the filter card has no item name box and says RESET', () => {
  assert.doesNotMatch(bar, /name="q"/);
  assert.doesNotMatch(bar, /Item name/);
  assert.match(bar, />RESET</);
  assert.doesNotMatch(bar, /Clear filters/);
});

t('a chosen window is reported by its own label', () => {
  const chosen = filterBar({ types: [], owners: [] }, { added: 'last-chance' });

  assert.match(chosen, /filter-select-label">LAST CHANCE</, 'not the raw last-chance value');
  assert.match(chosen, /value="last-chance" checked/);
});

// The Added menu as it is offered: its heading, its summary, and every window in its list.
// The heading is what comes first - the list's own aria-label sits after the summary, so
// slicing from there would miss the very thing the summary says.
const addedMenu = (html) => {
  const from = html.indexOf('<span class="filter-label">Added</span>');

  return from === -1 ? '' : html.slice(from, html.indexOf('</details>', from));
};

t('the Added menu offers the windows in the order they are read', () => {
  const menu = addedMenu(bar);
  const labels = [
    'Any Time',
    'Last 24 Hours',
    'Last 3 Days',
    'Last 7 Days',
    'Last 2 Weeks',
    'Last 30 Days',
    'LAST CHANCE',
  ];
  const places = labels.map((label) => menu.indexOf(`>${label}<`));

  assert.ok(
    places.every((at) => at > -1),
    `every window is offered, missing: ${labels.filter((_, i) => places[i] === -1).join(', ')}`
  );

  for (let i = 1; i < places.length; i += 1) {
    assert.ok(places[i] > places[i - 1], `${labels[i]} comes after ${labels[i - 1]}`);
  }
});

t('nothing chosen is Any Time, and it is the choice already on', () => {
  const menu = addedMenu(bar);

  assert.match(menu, /value="" checked/, 'the list starts with no window, and says so');
  assert.match(bar, /filter-select-label">Any Time</, 'so the summary reads Any Time');
});

t('Any Time is how a window is let go of without resetting the rest', () => {
  const chosen = filterBar({ types: [], owners: ['@eva'] }, { added: '3', owner: ['@eva'] });
  const menu = addedMenu(chosen);

  assert.match(menu, /value="3" checked/, 'the chosen window is the one ticked');
  assert.doesNotMatch(menu, /value="" checked/, 'and Any Time is not');
  assert.match(menu, /value=""/, 'but it is still there to choose');
  // Picking it drops `added` from the address bar and leaves the other filters alone
  // (app.js sends only the values that are on), which is what makes it a way back.
  assert.match(chosen, /name="owner" value="@eva" checked/);
});

t('the Added summary names its window and carries no count', () => {
  const chosen = filterBar({ types: [], owners: [] }, { added: '14' });
  const menu = addedMenu(chosen);
  const summary = menu.slice(0, menu.indexOf('</summary>'));

  assert.match(summary, /filter-select-label">Last 2 Weeks</);
  assert.doesNotMatch(summary, /filter-count/, 'one choice at a time cannot count for you');
  // Type and owner still say how many of their values are on.
  assert.match(chosen, /class="filter-count/, 'the multi-value menus keep theirs');
});

t('every window the menu offers is one the server lets through', () => {
  const server = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const found = /const ADDED_WINDOWS = new Set\(\[([^\]]*)\]\);/.exec(server);

  assert.ok(found, 'the whitelist is where the test can find it');

  const allowed = found[1]
    .split(',')
    .map((value) => value.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
    .sort();

  assert.deepEqual(
    allowed,
    ['1', '3', '7', '14', '30', 'last-chance'].sort(),
    'a window the server drops would fall silently back to Any Time'
  );
});

// The markup was right both times and the stylesheet was not: a pill stretched into a bar,
// and a radio dot drawn in a menu that only takes one choice. Neither shows up in rendered
// HTML, so the two rules are read out of the stylesheet itself.
t('the pill fits its words and the Added menu draws no radio dots', () => {
  const css = readFileSync(new URL('./public/styles.css', import.meta.url), 'utf8');

  const start = css.indexOf('.last-chance-pill {');
  assert(start > -1, 'the pill has a rule of its own');
  const pill = css.slice(start, css.indexOf('}', start));
  assert(/align-self:\s*flex-start/.test(pill), 'a flex column stretches it into a bar');
  assert(/white-space:\s*nowrap/.test(pill), 'the two words stay on one line');

  assert(
    /\.filter-option input\[type=['"]radio['"]\]\s*\{/.test(css),
    'the Added menu takes one choice, so its radios are not drawn'
  );
});

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) {
  process.exit(1);
}
