#!/usr/bin/env node
// What makes two rows the same item.
//
// A row's identity is the storage it belongs to plus the item's key. A character's own bag is
// that character's, so the character stays in the key and two characters holding the same thing
// are two rows. The bank, house storage, the furnishing vault and a house are the account's,
// whichever character scanned them. A guild bank is the guild's: no account and no character in
// its key, because several accounts look at the same shelves.
//
// The identity is (item_scope, item_key_hash) on both item tables, so the scope has to be
// written the same way by the store and by migration 031's backfill, or the next upload would
// recognise none of the existing rows and re-file every one of them.
//
//   npm run test:item-scope

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isCharacterScope, isGuildScope, itemScopeKey } from './lib/itemScope.js';
import { hashItemKey, summariseItemChanges } from './lib/store.js';

const tests = [];
const t = (label, run) => tests.push([label, run]);

const WORLD = { platform: 1, worldName: 'NA Megaserver' };
const scope = (accountName, characterName, locationKey, world = WORLD) =>
  itemScopeKey({ accountName, characterName, locationKey }, world);

// ------------------------------------------------------------------ a character's own bags

t('a bag belongs to the character, so the character stays in the key', () => {
  assert.equal(scope('@a', 'Alpha', 'inventory:alpha'), 'char:@a:alpha');
  assert.equal(scope('@a', 'Alpha', 'inventory:beta'), 'char:@a:alpha', 'the seat is the character');
});

t('two characters holding the same thing are two rows', () => {
  assert.notEqual(
    scope('@a', 'Alpha', 'inventory:alpha'),
    scope('@a', 'Beta', 'inventory:beta'),
    'the same item in two bags is not one row'
  );
});

t('a bag location that does not name the character still belongs to them', () => {
  // testFulfillment writes `locationKey = "inventory"` with no character in it. The character
  // is still part of the key, or two characters' bags would collapse into one row.
  assert.equal(scope('@a', 'Alpha', 'inventory'), 'char:@a:alpha');
  assert.notEqual(scope('@a', 'Alpha', 'inventory'), scope('@a', 'Beta', 'inventory'));
});

t('the helper says which rows are a character\'s', () => {
  assert.equal(isCharacterScope(scope('@a', 'Alpha', 'inventory:alpha')), true);
  assert.equal(isCharacterScope(scope('@a', 'Alpha', 'bank')), false);
});

// --------------------------------------------------------------- the account's own storage

t('the bank and house storage belong to the account, not to the scanner', () => {
  for (const location of ['bank', 'housestorage:3', 'furnishingvault', 'house']) {
    assert.equal(scope('@a', 'Alpha', location), 'acct:@a');
    assert.equal(
      scope('@a', 'Beta', location),
      'acct:@a',
      `${location} is the same shelf for every character on the account`
    );
  }
});

t('a place the addon has not taught us yet is the account\'s, never a bag', () => {
  assert.equal(scope('@a', 'Alpha', 'somewhere:new'), 'acct:@a');
  assert.equal(scope('@a', 'Alpha', ''), 'acct:@a');
});

// ------------------------------------------------------------------------- a guild's bank

t('a guild bank belongs to the guild, not to the account or the scanner', () => {
  const fromA = scope('@a', 'Alpha', 'guildbank:748885');
  const fromB = scope('@b', 'Beta', 'guildbank:748885');

  assert.equal(fromA, 'guild:1:na megaserver:guildbank:748885');
  assert.equal(fromB, fromA, 'two members looking at one bank are looking at one row');
});

t('a guild id means nothing without its server', () => {
  assert.notEqual(
    scope('@a', 'Alpha', 'guildbank:748885', { platform: 1, worldName: 'NA Megaserver' }),
    scope('@a', 'Alpha', 'guildbank:748885', { platform: 1, worldName: 'EU Megaserver' }),
    'the same number on another megaserver is another guild'
  );
});

t('the helper says which rows are a guild\'s', () => {
  assert.equal(isGuildScope(scope('@a', 'Alpha', 'guildbank:748885')), true);
  assert.equal(isGuildScope(scope('@a', 'Alpha', 'bank')), false);
});

// -------------------------------------------------------------------------- stable spelling

t('the scope is trimmed and lower cased, so a file cannot split a row by spelling it twice', () => {
  assert.equal(scope(' @A ', ' Alpha ', ' BANK '), 'acct:@a');
  assert.equal(
    scope('@a', 'Alpha', 'inventory:alpha'),
    scope('@a', 'ALPHA', 'INVENTORY:ALPHA')
  );
  assert.equal(
    scope('@a', 'Alpha', 'guildbank:748885', { platform: 1, worldName: ' NA Megaserver ' }),
    scope('@a', 'Alpha', ' GuildBank:748885 ', WORLD)
  );
});

// ----------------------------------------------------------- what an upload says it changed

const itemRow = (itemScope, itemKey, count) => ({
  item_scope: itemScope,
  item_key_hash: hashItemKey(itemKey),
  item_count: count,
});
const bagItem = (characterName, itemKey, count) => ({
  accountName: '@a',
  characterName,
  locationKey: 'inventory',
  itemKey,
  itemCount: count,
});
const bankItem = (characterName, itemKey, count) => ({
  accountName: '@a',
  characterName,
  locationKey: 'bank',
  itemKey,
  itemCount: count,
});
const scopeOf = (thing) => thing.item_scope ?? itemScopeKey(thing, WORLD);

t('a bag copy under a second character is a new row, and the count says added', () => {
  const changes = summariseItemChanges(
    [itemRow('char:@a:alpha', 'key:l', 1)],
    [bagItem('Alpha', 'key:l', 1), bagItem('Beta', 'key:l', 1)],
    new Set(),
    scopeOf
  );

  assert.deepEqual(changes, { added: 1, refreshed: 0 }, 'two bags, two rows');
});

t('the same bank stack under a second character is neither added nor refreshed', () => {
  const changes = summariseItemChanges(
    [itemRow('acct:@a', 'key:l', 1)],
    [bankItem('Beta', 'key:l', 1)],
    new Set(),
    scopeOf
  );

  assert.deepEqual(changes, { added: 0, refreshed: 0 }, 'one shelf, one row, same count');
});

t('a bank stack whose count moved is still only refreshed', () => {
  const changes = summariseItemChanges(
    [itemRow('acct:@a', 'key:l', 1)],
    [bankItem('Beta', 'key:l', 4)],
    new Set(),
    scopeOf
  );

  assert.deepEqual(changes, { added: 0, refreshed: 1 });
});

// ------------------------------------------------------------------------- the schema

t('the identity is the scope and the key, on both item tables', () => {
  const read = (path) => readFileSync(new URL(`./${path}`, import.meta.url), 'utf8');

  assert.match(
    read('migrations/001_guildsbounty_schema.sql'),
    /UNIQUE KEY uniq_guildsbounty_shared_item_scope \(item_scope, item_key_hash\)/,
    'a fresh item table is keyed by the storage'
  );
  assert.match(
    read('migrations/008_guildsbounty_always_share.sql'),
    /UNIQUE KEY uniq_guildsbounty_always_share_scope \(item_scope, item_key_hash\)/,
    'and so are the standing offers'
  );
});

t('migration 031 backfills the same three places in the same order', () => {
  const sql = readFileSync(
    new URL('./migrations/031_guildsbounty_item_scope.sql', import.meta.url),
    'utf8'
  );
  const guild = sql.indexOf("LIKE 'guildbank%'");
  const inventory = sql.indexOf("LIKE 'inventory%'");
  const account = sql.indexOf("'acct:', LOWER(TRIM(i.account_name))");

  assert.ok(guild > 0 && inventory > guild && account > inventory, 'guild, then bags, then the rest');
  assert.match(
    sql,
    /CONCAT\('char:', LOWER\(TRIM\(i\.account_name\)\), ':', LOWER\(TRIM\(i\.character_name\)\)\)/,
    'a bag row keeps its character, exactly as itemScopeKey does'
  );
});

let total = 0;
let failures = 0;

for (const [label, run] of tests) {
  total += 1;

  try {
    await run();
    console.log('ok   ' + label);
  } catch (error) {
    failures += 1;
    console.log('FAIL ' + label + '\n     ' + error.message.split('\n')[0]);
  }
}

console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures === 0 ? 0 : 1);
