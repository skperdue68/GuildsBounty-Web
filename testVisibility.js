#!/usr/bin/env node
// Who may see a shared row. The list is read with one visibility clause and nothing else,
// so the clause is the whole rule: this checks it without a database, by asking the store
// for the query and reading what it said.
//
//   npm run test:visibility

import assert from 'node:assert/strict';

import { getAlwaysShareForViewer, getSharedItemsForViewer } from './lib/store.js';

const tests = [];
const t = (label, run) => tests.push([label, run]);

function recordingConnection() {
  const calls = [];

  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql: String(sql), params });
      // An empty result set: every query here is asked for its text, not its rows.
      return [[]];
    },
  };
}

const names = ['@evainefaye'];

const inventoryQuery = async (accountNames) => {
  const connection = recordingConnection();
  await getSharedItemsForViewer(connection, accountNames, {});
  return connection.calls[0];
};

const offerQuery = async (accountNames) => {
  const connection = recordingConnection();
  await getAlwaysShareForViewer(connection, accountNames, {});
  return connection.calls[0];
};

// ------------------------------------------------------------------ the owner's own rows

t('an owner sees their own items even when they carry a guild', async () => {
  const { sql } = await inventoryQuery(names);

  // The old rule only covered rows with no guild link at all, so an item stamped with a
  // guild the join could not match vanished from every list, the owner's included.
  assert.doesNotMatch(sql, /ig\.guild_id IS NULL/, 'the guild stamp must not decide this');
  assert.match(sql, /OR i\.account_name IN \(\?\)/, 'their own rows are visible on their own');
});

t('an owner sees their own standing offers the same way', async () => {
  const { sql } = await offerQuery(names);

  assert.doesNotMatch(sql, /ag\.guild_id IS NULL/);
  assert.match(sql, /OR a\.account_name IN \(\?\)/);
});

t('the guild branch is still there, so a guildmate keeps seeing the share', async () => {
  const { sql, params } = await inventoryQuery(names);

  assert.match(sql, /viewer\.account_name IS NOT NULL/, 'guild membership still reaches a row');
  assert.match(sql, /viewer\.account_name IN \(\?\)/, 'checked against the viewer\'s own accounts');
  assert.equal(params.filter((value) => value === names[0]).length, 2, 'both branches use the names');
});

t('the offer list keeps its guild branch too', async () => {
  const { sql, params } = await offerQuery(names);

  assert.match(sql, /viewer\.account_name IS NOT NULL/);
  assert.equal(params.filter((value) => value === names[0]).length, 2);
});

t('the world still has to match before a guild reaches a row', async () => {
  const { sql } = await inventoryQuery(names);

  assert.match(sql, /viewer\.platform = ig\.platform/);
  assert.match(sql, /viewer\.world_name = ig\.world_name/);
});

// ------------------------------------------------------------------- nothing is duplicated

t('an item offered to five guilds is still one row of the list', async () => {
  const { sql } = await inventoryQuery(names);

  // The visibility branch can now match on the same row twice over - by guild and by
  // ownership - so the grouping is what keeps one item one line.
  assert.match(sql, /GROUP BY i\.id/);
});

// ------------------------------------------------------------------- who this excludes

t('somebody else\'s item is not visible just for being shared', async () => {
  const { sql, params } = await inventoryQuery(names);

  assert.match(sql, /OR i\.account_name IN \(\?\)/, 'keyed on the viewer\'s own names');
  assert.equal(params[params.length - 1], names[0], 'the names, not a wildcard');
  assert.doesNotMatch(sql, /i\.account_name IN \('%/, 'no pattern that would match everyone');
});

t('with no selected account the list is the public preview, not a filtered one', async () => {
  const { sql } = await inventoryQuery([]);

  assert.match(sql, /WHERE 1 = 1/, 'nothing is hidden and nothing is restricted');
  assert.doesNotMatch(sql, /account_name IN/, 'there is nobody to key it on');
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
    console.log('FAIL ' + label + '\n     ' + error.message);
  }
}

console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures === 0 ? 0 : 1);
