#!/usr/bin/env node
// The four tabs and the Requests Received list: what the row says, what order it is in, and
// what the new tab draws - the working list with its quantity and its button, and the history
// of everything already answered under it. Renders the real list region out of lib/views.js,
// so a change that renames a tab back or drops the history fails here.
//
//   npm run test:received-tab

import assert from 'node:assert/strict';
import fs from 'node:fs';

import { renderListRegion } from './lib/views.js';

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

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
