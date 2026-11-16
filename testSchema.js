#!/usr/bin/env node
// The item tables only keep what the site reads or writes.
//
// A column the code never reads is weight in every row, and a column the addon no longer
// sends can never be filled again. This checks that such a column is gone from the write
// lists, from the one query that used to select it, from the parser, from the tables that
// create the schema, and that the migration dropping it exists - so a future change that
// starts writing a dead column again fails here rather than quietly filling it with ''.
//
//   npm run test:schema

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { ITEMS, OFFERS, buildItem, buildOffer } from './lib/demoItems.js';

const tests = [];
const t = (label, run) => tests.push([label, run]);

const read = (path) => readFileSync(new URL(`./${path}`, import.meta.url), 'utf8');

const store = read('lib/store.js');
const demoItems = read('lib/demoItems.js');
const simulate = read('simulate.js');
const fulfillment = read('testFulfillment.js');
const savedVars = read('lib/savedVars.js');
const schema = read('migrations/001_guildsbounty_schema.sql');
const offers = read('migrations/008_guildsbounty_always_share.sql');
const drop = read('migrations/030_guildsbounty_drop_unused_item_columns.sql');

// What the addon stopped sending, and the site never read.
const DROPPED = [
  'item_type',
  'quality_name',
  'trait_type',
  'apparel_slot',
  'equip_type',
  'apparel_weight',
  'armor_type',
  'weapon_type',
  'weapon_handedness',
  'furniture_data_id',
  'flavor_text',
  'eso_data',
];

// These two hold every column the item list writes or reads. If a name is in either list,
// the site still has a reason to keep it.
const columnList = (name) => {
  const from = store.indexOf(`const ${name} = [`);
  assert.ok(from > -1, `${name} is where the test can find it`);

  const to = store.indexOf('];', from);
  return store
    .slice(from, to)
    .split('\n')
    .map((line) => line.trim().replace(/^'|',$/g, ''))
    .filter((line) => line && line !== `const ${name} = [` && line !== '[');
};

const itemColumns = columnList('ITEM_COLUMNS');
const offerColumns = columnList('ALWAYS_COLUMNS');

const isWord = (name) => new RegExp(`\\b${name}\\b`);

// ------------------------------------------------------------------- nothing writes them

t('the item write list no longer carries a column the site never read', () => {
  for (const name of [...DROPPED, 'last_dumped_at']) {
    assert.ok(!itemColumns.includes(name), `${name} must not be written any more`);
  }
});

t('the standing offers no longer carry them either', () => {
  for (const name of DROPPED) {
    assert.ok(!offerColumns.includes(name), `${name} must not be written any more`);
  }
});

t('the write list still holds every column the list depends on', () => {
  for (const name of [
    'item_type_name',
    'quality',
    'trait',
    'set_name',
    'enchant_name',
    'style_name',
    'required_level',
    'required_cp',
    'location_key',
    'location_label',
    'item_count',
    'held_quantity',
    'reserve_quantity',
    'first_dumped_at',
    'upload_id',
  ]) {
    assert.ok(itemColumns.includes(name), `${name} is still written`);
  }
});

// -------------------------------------------------------------------- nothing reads them

t('the inventory query selects none of them', () => {
  for (const name of [...DROPPED, 'last_dumped_at']) {
    assert.doesNotMatch(store, new RegExp(`i\\.${name}\\b`), `the query cannot select ${name}`);
  }
});

t('the parser no longer builds them from the file', () => {
  const field = {
    item_type: 'itemType',
    quality_name: 'qualityName',
    trait_type: 'traitType',
    apparel_slot: 'apparelSlot',
    equip_type: 'equipType',
    apparel_weight: 'apparelWeight',
    armor_type: 'armorType',
    weapon_type: 'weaponType',
    weapon_handedness: 'weaponHandedness',
    furniture_data_id: 'furnitureDataId',
    flavor_text: 'flavorText',
    eso_data: 'esoData',
  };

  for (const [column, name] of Object.entries(field)) {
    assert.doesNotMatch(savedVars, new RegExp(`\\b${name}:`), `${column} is not read off the file`);
  }

  assert.doesNotMatch(savedVars, /\blastDumpedAt:/, 'and neither is the row copy of a date');
});

// ------------------------------------------------------------------- nothing creates them

t('a fresh database no longer creates them on the item table', () => {
  for (const name of [...DROPPED, 'last_dumped_at']) {
    assert.doesNotMatch(schema, isWord(name), `${name} must not be created`);
  }
});

t('a fresh database no longer creates them on the offers table', () => {
  for (const name of DROPPED) {
    assert.doesNotMatch(offers, isWord(name), `${name} must not be created`);
  }
});

t('the columns the list needs are still created', () => {
  for (const name of [
    'item_key_hash',
    'item_type_name',
    'quality',
    'trait',
    'location_key',
    'location_label',
    'item_count',
    'first_dumped_at',
    'upload_id',
    'first_seen_at',
    'last_seen_at',
  ]) {
    assert.match(schema, isWord(name), `${name} is still part of the table`);
  }
});

// --------------------------------------------------------------------- the cleanup runs

t('one migration drops every one of them', () => {
  for (const name of DROPPED) {
    const drops = drop.match(new RegExp(`DROP COLUMN IF EXISTS ${name},?`, 'g')) || [];

    assert.equal(drops.length, 2, `${name} is dropped from both tables`);
  }

  assert.equal(
    (drop.match(/DROP COLUMN IF EXISTS last_dumped_at/g) || []).length,
    1,
    'the offers table never had a last-dumped stamp'
  );
});

t('the cleanup touches nothing the site still uses', () => {
  const dropped = [...drop.matchAll(/DROP COLUMN IF EXISTS (\w+)/g)].map((match) => match[1]);

  for (const name of [
    'item_type_name',
    'quality',
    'trait',
    'set_name',
    'enchant_name',
    'style_name',
    'required_level',
    'required_cp',
    'location_key',
    'location_label',
    'item_count',
    'held_quantity',
    'reserve_quantity',
    'first_dumped_at',
    'first_added_at',
    'last_updated_at',
    'first_seen_at',
    'last_seen_at',
    'upload_id',
    'icon_key',
    'item_key_hash',
  ]) {
    assert.ok(!dropped.includes(name), `${name} must survive the cleanup`);
  }
});

t('the drops are guarded, so a database without the column still migrates', () => {
  const drops = drop.match(/DROP COLUMN (?!IF EXISTS)\w+/g) || [];

  assert.deepEqual(drops, [], 'every drop says IF EXISTS');
});

t('the migration is the newest one, so it runs last', () => {
  const files = readdirSync(new URL('./migrations', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const last = files[files.length - 1];

  assert.match(last, /^030_guildsbounty_drop_unused_item_columns\.sql$/, `newest is ${last}`);
});

// --------------------------------------------------------------------- the fixtures

// A demo or simulated item is a row the site writes, so it has to be shaped like one: if it
// carries a field the table has no column for, the fixture is describing data the site cannot
// store, and the next reader has no way to tell which fields are real.
const camel = (column) => column.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

// What a builder's own object literal says, for the two files that cannot be imported here.
const builderBody = (text, marker) => {
  const from = text.indexOf(marker);
  assert.ok(from > -1, `${marker} is where the test can find it`);

  const body = text.slice(from);
  return body.slice(0, body.indexOf('\n}'));
};

t('a demo item is shaped exactly like a row, plus the guild links', () => {
  const fields = new Set(itemColumns.map(camel));
  const item = buildItem(ITEMS[0], 0, [1]);

  for (const key of Object.keys(item)) {
    if (key === 'guildIds') {
      continue;
    }

    assert.ok(fields.has(key), `${key} has no column in ITEM_COLUMNS, so nothing will store it`);
  }

  assert.ok(fields.has('itemTypeName'), 'and the type the list filters by is still there');
});

t('a demo offer is shaped exactly like a row too', () => {
  const fields = new Set(offerColumns.map(camel));
  const offer = buildOffer(OFFERS[0], 0, [1]);

  for (const key of Object.keys(offer)) {
    if (key === 'guildIds') {
      continue;
    }

    assert.ok(fields.has(key), `${key} has no column in ALWAYS_COLUMNS`);
  }
});

t('the demo builders no longer carry a column the site dropped', () => {
  const dead = ['itemType', 'qualityName', 'traitType', 'apparelSlot', 'equipType', 'apparelWeight',
    'armorType', 'weaponType', 'weaponHandedness', 'furnitureDataId', 'flavorText', 'esoData',
    'lastDumpedAt'];

  for (const marker of ['export function buildItem(', 'export function buildOffer(']) {
    const body = builderBody(demoItems, marker);

    for (const field of dead) {
      assert.doesNotMatch(body, new RegExp(`\\b${field}:`), `${field} is not a demo item field`);
    }
  }
});

t('the simulator builds the same rows, so it carries none of them either', () => {
  const dead = ['itemType', 'qualityName', 'traitType', 'apparelSlot', 'equipType', 'apparelWeight',
    'armorType', 'weaponType', 'weaponHandedness', 'furnitureDataId', 'flavorText', 'esoData',
    'lastDumpedAt'];

  for (const marker of ['function buildItem(', 'function buildOffer(']) {
    const body = builderBody(simulate, marker);

    for (const field of dead) {
      assert.doesNotMatch(body, new RegExp(`\\b${field}:`), `${field} is not a simulated item field`);
    }
  }
});

t('the fulfilment fixture is a row too, not a wider thing', () => {
  const body = builderBody(fulfillment, 'function itemFor(');

  assert.doesNotMatch(body, /\\b(itemType|qualityName|traitType|apparelSlot|equipType):/);
  assert.doesNotMatch(body, /\\b(flavorText|esoData|furnitureDataId|lastDumpedAt):/);
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
