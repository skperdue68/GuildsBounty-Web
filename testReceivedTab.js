#!/usr/bin/env node
// The four tabs and the Requests Received list: what the row says, what order it is in, and
// what the new tab draws - the working list with its quantity and its button, and the history
// of everything already answered under it. Renders the real list region out of lib/views.js,
// so a change that renames a tab back or drops the history fails here.
//
//   npm run test:received-tab

import assert from 'node:assert/strict';
import fs from 'node:fs';

import { renderListRegion, renderPage } from './lib/views.js';

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

const item = (id, name, type) => ({
  id,
  item_name: name,
  item_type_name: type,
  held_quantity: 1,
  reserve_quantity: 0,
  reserved: 0,
  quality: 4,
  trait: '',
  location_label: 'Bank',
  account_name: '@Owner',
  first_seen_at_iso: '2026-11-01T10:00:00Z',
});

const user = { provider: 'discord', username: 'evainefaye', id: 1, accountNames: ['@Eva'] };
const accounts = [
  { accountName: '@Eva', guilds: [{ guild_name: 'G' }], platform: 'pc', worldName: 'NA' },
];

const pending = [
  {
    id: 5,
    item_name: 'Briarheart Dagger',
    item_type_name: 'Weapons',
    trait: 'Sharpened',
    quality: 4,
    owner_account_name: '@Eva',
    requester_account_name: '@Bob',
    requesters: ['@Bob'],
    asked: 2,
    requests: 1,
    first_submitted_at: '2026-11-10T10:00:00Z',
    location_label: 'Bank',
  },
];

const history = [
  {
    id: 6,
    item_name: 'Ancient Silk',
    item_type_name: 'Apparel',
    quality: 3,
    owner_account_name: '@Eva',
    requester_account_name: '@Cy',
    quantity: 1,
    quantity_requested: 3,
    status: 'fulfilled',
    fulfilled_at: '2026-11-11T10:00:00Z',
    closed_at: '2026-11-11T10:00:00Z',
  },
  {
    id: 7,
    item_name: 'Hunting Bow',
    item_type_name: 'Weapons',
    quality: 2,
    owner_account_name: '@Eva',
    requester_account_name: '@Dee',
    quantity: 2,
    quantity_requested: 2,
    status: 'cancelled',
    fulfilled_at: null,
    closed_at: '2026-11-12T10:00:00Z',
  },
];

const render = (overrides = {}) =>
  renderListRegion({
    user,
    accounts,
    browsingAccount: '@Eva',
    sharedItems: [item(1, 'Briarheart Dagger', 'Weapons')],
    requestItems: [item(1, 'Briarheart Dagger', 'Weapons')],
    alwaysShare: [],
    requestOffers: [],
    facets: { types: ['Weapons'], owners: ['@Owner'] },
    filters: { type: [], owner: [], search: '', added: '', order: [], group: true },
    requests: [],
    requestHistory: null,
    basket: { count: 0, quantity: 0, secondsLeft: 0, holdMinutes: 5 },
    basketRows: [],
    received: pending,
    receivedHistory: history,
    answered: null,
    ...overrides,
  });

// The whole page, as the route draws it: the list region is handed the received lists by
// renderPage, and a check on the region alone would not notice if it stopped doing that.
const page = () =>
  renderPage({
    user,
    providers: ['discord'],
    accounts,
    browsingAccount: '@Eva',
    sharedItems: [item(1, 'Briarheart Dagger', 'Weapons')],
    requestItems: [item(1, 'Briarheart Dagger', 'Weapons')],
    alwaysShare: [],
    requestOffers: [],
    facets: { types: ['Weapons'], owners: ['@Owner'] },
    filters: { type: [], owner: [], search: '', added: '', order: [], group: true },
    requests: [],
    requestHistory: null,
    basket: { count: 0, quantity: 0, secondsLeft: 0, holdMinutes: 5 },
    basketRows: [],
    received: pending,
    receivedHistory: history,
    answered: null,
    dbError: null,
  });

const panel = (html, name) => {
  const from = html.indexOf(`data-panel="${name}"`);

  assert.ok(from > -1, `the ${name} panel is drawn`);

  return html.slice(from);
};

// ------------------------------------------------------------------- the tab row

t('the tabs run in the order the page is used in', () => {
  const html = render();
  const order = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((match) => match[1]);

  assert.deepEqual(order, ['request', 'mine', 'offer', 'received']);
});

t('and they are called what they do', () => {
  const html = render();

  assert.match(html, /Browse Offers/);
  assert.match(html, /My Requests/);
  assert.match(html, /My Inventory/);
  assert.match(html, /Requests Received/);
  assert.doesNotMatch(html, /Others Inventory/, 'the old name is gone');
});

t('every tab carries a mark before its name', () => {
  const html = render();

  assert.equal((html.match(/class="tab-icon"/g) || []).length, 4, 'one per tab');
  assert.match(html, /class="tab-icon"[^>]*aria-hidden="true"/, 'and it is not read out');
  assert.match(html, /stroke="currentColor"/, 'it takes the tab colour');
});

t('Browse Offers is the one open, and the rest are behind it', () => {
  const html = render();
  const open = html.slice(html.indexOf('id="tabRequest"'), html.indexOf('data-tab="mine"'));
  const rest = html.slice(html.indexOf('data-tab="mine"'));

  assert.match(open, /aria-selected="true"/, 'the first tab is the one being read');
  assert.doesNotMatch(rest.slice(0, rest.indexOf('data-panel=')), /aria-selected="true"/);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  assert.match(html, /data-panel="received" hidden/);
});

t('the count on Requests Received is the number of items waiting', () => {
  const html = render();
  const tab = html.slice(html.indexOf('data-tab="received"'));

  assert.match(tab.slice(0, 800), /<span class="tab-count">1<\/span>/);
});

t('a visitor gets the one list that applies to them', () => {
  const html = render({ user: null, accounts: [], received: [], receivedHistory: [] });

  assert.match(html, /Browse Offers/);
  assert.doesNotMatch(html, /Requests Received/);
  assert.doesNotMatch(html, /data-panel="received"/);
});

t('the page carries the tab, with its waiting row and its history on it', () => {
  const html = page();

  assert.match(html, /Requests Received/);
  assert.match(html, /data-panel="received"/);
  assert.match(html, /Briarheart Dagger/, 'what is waiting is on the page');
  assert.match(html, /Ancient Silk/, 'and so is what was answered');
});

// A live refresh replaces the list region with a freshly drawn copy, so the tab has to be
// reapplied to the new tabs and panels or the reader is thrown back to Browse Offers - and
// the received rows, which arrive in that same swap, would be drawn on a hidden panel.
t('the tab stays open across a live refresh', () => {
  const app = read('public/app.js');

  assert.match(app, /panel\.hidden = panel\.dataset\.panel !== activeTab/, 'the new panels follow the tab');
  assert.match(app, /stored === 'received'/, 'and the choice outlives a page rebuild');
  assert.match(app, /has\('answered'\)\) activeTab = 'received'/, 'an answer comes back to it');
});

// ------------------------------------------------------------- the working list

t('the waiting list is the owner list: quantity asked for, and the two answers', () => {
  const html = panel(render(), 'received');

  assert.match(html, /Briarheart Dagger/);
  assert.match(html, /name="quantity"[\s\S]*?value="2"/, 'the amount sent starts at the ask');
  assert.match(html, /name="action" value="save">Fulfilled</);
  assert.match(html, /name="action" value="none">Not fulfilled</);
  assert.match(html, /data-request-sort="name"/, 'and its headings sort like the page does');
});

t('an answer given in the tab comes back to the tab', () => {
  const html = panel(render(), 'received');

  assert.match(html, /name="from" value="list"/);
});

t('the confirmation the page would show is shown in the tab', () => {
  const html = panel(render({ answered: { fulfilled: 1, cancelled: 0, rows: [] } }), 'received');

  assert.match(html, /class="status ok"/);
  assert.match(html, /Recorded: 1 request fulfilled/);
});

// ------------------------------------------------------------------- the history

t('everything already answered is under it, with what was asked and what was sent', () => {
  const html = panel(render(), 'received');
  const from = html.indexOf('Already answered');

  assert.ok(from > -1, 'the history has a heading');
  const rows = html.slice(from);

  assert.match(rows, /Ancient Silk/);
  assert.match(rows, /@Cy/);
  assert.match(rows, /<td class="num">3<\/td>/, 'asked for three');
  assert.match(rows, /<td class="num">1<\/td>/, 'one arrived');
  assert.match(rows, /Fulfilled/);
});

t('a request that was not fulfilled says so rather than reading as a handover', () => {
  const html = panel(render(), 'received');

  assert.match(html, /Hunting Bow/);
  assert.match(html, /Not fulfilled/);
});

t('both halves say what an empty one means', () => {
  const html = panel(render({ received: [], receivedHistory: [] }), 'received');

  assert.match(html, /Nothing is waiting on your items right now/);
  assert.match(html, /Nothing has been answered yet/);
});

// ------------------------------------------------------------------ the entry point

t('the avatar menu no longer sends anybody to the old page', () => {
  const views = fs.readFileSync(new URL('./lib/views.js', import.meta.url), 'utf8');

  assert.doesNotMatch(
    views,
    /href="\/owner\/requests" role="menuitem"/,
    'the tab on the list replaced that entry'
  );
});

t('the answer posted from the tab redirects to the list, not the old page', () => {
  const server = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');

  assert.match(server, /req\.body\.from\) === 'list' \? '\/' : '\/owner\/requests'/);
});

// A pushed change redraws the list through /items, not through the page, so the fragment has
// to be built from the same loader - otherwise the tab updates its count and its rows only on
// a reload, which is the one thing a live list must not do.
t('the live refresh draws the received list from the same data as the page', () => {
  const server = read('server.js');
  const at = server.indexOf("app.get('/items'");
  const route = server.slice(at, at + 900);

  assert.ok(at > -1, 'the fragment route is still there');
  assert.match(route, /collectViewerData\(/);
  assert.match(route, /renderListRegion\(data\)/);
});

t('the list loads both halves for a signed-in person', () => {
  const server = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');

  assert.match(server, /data\.received = await getOwnerRequests\(connection, accountNames\)/);
  assert.match(server, /data\.receivedHistory = await getOwnerRequestHistory\(connection, accountNames\)/);
});

t('the mark is styled to sit on the text baseline', () => {
  const css = fs.readFileSync(new URL('./public/styles.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.tab-icon {'));

  assert.match(rule.slice(0, 200), /width: 16px/);
  assert.match(rule.slice(0, 200), /margin-right: 6px/);
});

// ------------------------------------------------------------------ empty tables

// A section that disappears when it has nothing in it reads as one that failed to load, so
// each of the four tables keeps its headings and says so in one line across them.
t('an empty Requests Received tab keeps both tables and says so in each', () => {
  const empty = render({ received: [], receivedHistory: [] });
  const received = empty.slice(empty.indexOf('data-panel="received"'));

  assert.match(received, /Waiting on your items/);
  assert.match(received, /<tr class="empty-row"><td colspan="6">Nothing is waiting on your items right now\./);
  assert.match(received, /Already answered/);
  assert.match(received, /<tr class="empty-row"><td colspan="6">Nothing has been answered yet\./);
  assert.match(received, />Mail to<span class="sort-queue"/, 'the headings stay, including the answered ones');
});

t('the empty line goes away as soon as a row is there, and comes back with it', () => {
  const waiting = render({ receivedHistory: [] });
  const onlyWaiting = waiting.slice(waiting.indexOf('data-panel="received"'));
  const waitingTable = onlyWaiting.slice(0, onlyWaiting.indexOf('Already answered'));
  const answeredTable = onlyWaiting.slice(onlyWaiting.indexOf('Already answered'));

  assert.doesNotMatch(waitingTable, /class="empty-row"/, 'a request is waiting, so nothing says there is none');
  assert.match(waitingTable, /Briarheart Dagger/);
  assert.match(answeredTable, /class="empty-row"/, 'nothing answered on this fixture, so the log says so');

  const answered = render({ received: [] });
  const back = answered.slice(answered.indexOf('data-panel="received"'));

  assert.match(back.slice(0, back.indexOf('Already answered')), /class="empty-row"/);
  assert.doesNotMatch(back.slice(0, back.indexOf('Already answered')), /Briarheart Dagger/);
});

// ------------------------------------------------------------- sorting and searching

t('all four tables sort by their own headings and remember it in their own cookie', () => {
  const html = render({
    requests: [],
    basketRows: [
      { id: 9, item_name: 'Soul Gem', owner_account_name: '@Owner', quantity: 2, status: 'draft' },
    ],
    requestHistory: { page: 1, totalPages: 1 },
  });
  const mine = html.slice(html.indexOf('data-panel="mine"'), html.indexOf('data-panel="offer"'));

  assert.match(mine, /data-sort-cookie="itemshare_basket_sort"/);
  assert.match(mine, /data-sort-fields="name,from,qty,status"/);
  assert.match(mine, /data-sort-cookie="itemshare_sent_sort"/);
  assert.match(mine, /data-sort-fields="name,from,qty,sent,status"/);
  assert.match(html, /data-sort-cookie="itemshare_answered_sort"/);
  assert.match(html, /data-sort-fields="name,mail,requested,amount,answered,when"/);
  assert.match(html, /data-owner-requests/, 'the waiting table keeps the sorts it already had');
  assert.match(mine, /data-sort-name="Soul Gem"/);
  assert.match(mine, /data-sort-status="Not requested"/);
  assert.match(html, /data-sort-requested="3"/, 'asked for, on the answered row');
  assert.match(html, /data-sort-amount="1"/, 'and how many arrived');
});

t('each table carries the words its search box looks through', () => {
  const html = render({
    requests: [],
    basketRows: [
      { id: 9, item_name: 'Soul Gem', owner_account_name: '@Owner', quantity: 2, status: 'draft' },
    ],
  });

  assert.match(html, /id="listSearch-mine"/);
  assert.match(html, /id="listSearch-received"/);
  assert.match(html, /data-search="Briarheart Dagger Weapons Sharpened @Eva @Bob Bank"/);
  assert.match(html, /data-search="Ancient Silk Apparel @Cy Fulfilled"/);
  assert.match(html, /data-search="Soul Gem @Owner Not requested"/);
});

// ------------------------------------------------------------------- where links land

t('a link can name the tab it opens, and the request email names this one', () => {
  const app = read('public/app.js');
  const email = read('lib/email.js');

  assert.match(app, /const asked = new URLSearchParams\(window\.location\.search\)\.get\('tab'\)/);
  assert.match(app, /asked === 'received'/, 'received is one of the names a link may use');
  assert.match(email, /\/\?tab=received/, 'the email offers the tab beside the no-sign-in page');
  assert.match(
    read('server.js'),
    /\/requests\/fulfill\/\$\{token\}/,
    'and the message it builds still opens the page that needs no sign-in'
  );
});

t('the send instruction is a size up and has air under it', () => {
  const css = read('public/styles.css');
  const rule = css.slice(css.indexOf('.bag-note {'));

  assert.match(rule.slice(0, 200), /font-size: 14px/);
  assert.match(rule.slice(0, 200), /margin: 12px 0 14px/);
  assert.match(css.slice(css.indexOf('.empty-row td {')), /text-align: center/);
});

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
