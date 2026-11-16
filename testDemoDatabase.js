#!/usr/bin/env node
// The demo's own database, written the way the demo writes it.
//
// The demo's seeding and its shelf maintenance are the two things that only ever ran
// against a real MariaDB, and the suite that used to cover request answering had been
// failing since the item-scope change - which is exactly the sort of thing nobody notices
// when the database tests need a server nobody has. This one builds the demo's database
// from the real migrations, seeds it with the real `ensureDemoData`, and then re-counts a
// stack, drops a row and restocks, checking the rows rather than the sentences.
//
//   npm run test:demo-database
//
// Settings are read exactly as the site reads them (MARIADB_HOST, MARIADB_PORT,
// MARIADB_USER, MARIADB_PASSWORD, GUILDSBOUNTY_DATABASE) and the database is DROPPED
// before it is rebuilt, so the name has to end in _test.

import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

import { openDatabase, readConfig } from './lib/database.js';
import { DEMO_ACCOUNT, ensureDemoData } from './lib/demo.js';
import { DEMO_CAST } from './lib/demoCast.js';
import { demoOwnShelf, restockDemoShelf } from './lib/demoShelf.js';
import { refreshedShelf } from './lib/demoActivity.js';
import { hashItemKey, replaceAccounts } from './lib/store.js';

process.env.GUILDSBOUNTY_DATABASE = process.env.GUILDSBOUNTY_DATABASE || 'guildsbounty_demo_test';

const config = readConfig();

if (!config.database.endsWith('_test')) {
  console.error(
    `Refusing to run: GUILDSBOUNTY_DATABASE is "${config.database}" and this test drops it.\n` +
      'Use a name ending in _test, for example GUILDSBOUNTY_DATABASE=guildsbounty_demo_test.'
  );
  process.exit(2);
}

const tests = [];
const t = (label, run) => tests.push([label, run]);

let connection;
let demo;

/** The demo person's own rows, as the page would find them. */
async function ownRows() {
  const [rows] = await connection.execute(
    `SELECT item_key_hash, item_name, item_count
       FROM guildsbounty_shared_items
      WHERE account_name = ?
      ORDER BY id ASC`,
    [DEMO_ACCOUNT]
  );

  return rows;
}

async function requestRows() {
  const [rows] = await connection.execute(
    `SELECT status, quantity, quantity_requested, item_name, owner_account_name
       FROM guildsbounty_requests
      WHERE requester_account_name = ?
      ORDER BY id ASC`,
    [DEMO_ACCOUNT]
  );

  return rows;
}

const byHash = (rows, item) => rows.find((row) => row.item_key_hash === hashItemKey(item.itemKey));

t('the demo database is built from the real schema and the real seeding', async () => {
  assert.ok(demo.userId > 0, 'the demo person has to exist to own a history');
  assert.equal(demo.cast.seeded.length, DEMO_CAST.length, 'and its guildmates with it');
  assert.ok((await ownRows()).length > 0, "and the visitor's own shelf");
});

t('the Sent tab starts with a whole handover, a short one and a refusal', async () => {
  const rows = await requestRows();

  assert.equal(rows.length, 3, `expected three seeded asks, got ${rows.length}`);
  assert.deepEqual(
    rows.map((row) => `${row.status}:${row.quantity}:${row.quantity_requested}`).sort(),
    ['cancelled:0:2', 'fulfilled:1:2', 'fulfilled:2:2'],
    'the three shapes the Qty column has to be able to read'
  );

  for (const row of rows) {
    assert.ok(String(row.item_name || '').trim(), 'each row names the piece that was asked for');
    assert.ok(
      DEMO_CAST.some((person) => person.account === row.owner_account_name),
      `and belongs to a guildmate, not to ${row.owner_account_name}`
    );
  }
});

t('the history is written once, not on every sign-in', async () => {
  await ensureDemoData(connection);
  await ensureDemoData(connection);

  assert.equal((await requestRows()).length, 3, 'a history with rows in it is left alone');
});

t('a re-count is not undone by the restock that follows it', async () => {
  const shelf = await demoOwnShelf(connection);
  const target = shelf.items[0];
  // A draw of 0 takes the first free index and, with one copy under it, counts upward - so
  // the number that has to survive the restock is a different one from the catalogue's.
  const { items } = refreshedShelf(shelf.items, { moves: 1, random: () => 0 });
  const counted = items[0].itemCount;

  assert.notEqual(counted, target.itemCount, 'the re-count has to move the number to be worth checking');

  const [written] = await replaceAccounts(connection, [{ ...shelf, items }], {
    sourceFile: 'test',
  });

  assert.equal(written.refreshedItems, 1, 'the write has to call it a refresh, not an add');
  assert.equal(byHash(await ownRows(), target).item_count, counted, 'and store the new number');

  await restockDemoShelf(connection);

  assert.equal(
    byHash(await ownRows(), target).item_count,
    counted,
    'the restock has to keep the count the file last reported, not the catalogue one'
  );
});

t('a row saved out of the file leaves the shelf, and the restock brings it back', async () => {
  const shelf = await demoOwnShelf(connection);
  const dropped = shelf.items[1];
  const kept = shelf.items.filter((_item, index) => index !== 1);

  const [written] = await replaceAccounts(connection, [{ ...shelf, items: kept }], {
    sourceFile: 'test',
  });

  assert.equal(Number(written.removedItems), 1, 'one row fewer has to read as one item removed');
  assert.equal(byHash(await ownRows(), dropped), undefined, 'and the row has to be gone');

  await restockDemoShelf(connection);

  assert.ok(byHash(await ownRows(), dropped), 'the restock puts a row the file stopped sharing back');
});

let failures = 0;

try {
  const admin = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
  await admin.end();

  ({ connection } = await openDatabase(config));
} catch (error) {
  console.error(
    `Cannot reach MariaDB at ${config.host}:${config.port} as ${config.user}: ${error.message}\n` +
      'This test needs a real MariaDB. Set MARIADB_HOST / MARIADB_USER / MARIADB_PASSWORD and try again.'
  );
  process.exit(1);
}

try {
  demo = await ensureDemoData(connection);

  for (const [label, run] of tests) {
    try {
      await run();
      console.log(`ok   ${label}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${label}\n     ${error.message}`);
    }
  }
} finally {
  if (connection && connection.end) await connection.end();
}

console.log(`\n${tests.length - failures}/${tests.length} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
