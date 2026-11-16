#!/usr/bin/env node
// The database carries the new name, and an old one is taken over on the first boot.
//
// The tables were `itemshare_*` and the migration files were `NNN_itemshare_*.sql` before the
// rename; the ledger remembers files by name, so a database still on the old names has to have
// both moved before a single migration is considered. That runs against live data and there is
// no MariaDB here to rehearse it on, so this drives applyMigrations() against a stand-in
// connection that keeps a real table list and a real ledger: it checks the order of the
// statements, that the rename is one atomic RENAME TABLE, that a table already renamed is left
// alone, and that a second boot changes nothing.
//
//   npm run test:db-names

import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { applyMigrations, readConfig } from './lib/database.js';

const tests = [];
const t = (label, run) => tests.push([label, run]);

const LEDGER = 'guildsbounty_schema_migrations';

/** A connection with enough of MariaDB's behaviour to follow the migration runner. */
function fakeDatabase({ tables = [], ledger = null } = {}) {
  const state = {
    tables: new Set(tables),
    ledger: ledger ? [...ledger] : null,
    statements: [],
  };

  const connection = {
    query: async (sql, params = []) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      state.statements.push({ text, params });

      if (text.includes('information_schema.TABLES')) {
        return [[...state.tables].map((name) => ({ name }))];
      }

      if (text.startsWith(`CREATE TABLE IF NOT EXISTS ${LEDGER}`)) {
        state.ledger = state.ledger || [];
        state.tables.add(LEDGER);
        return [{}];
      }

      if (text.startsWith('RENAME TABLE')) {
        for (const pair of text.slice('RENAME TABLE '.length).split(', ')) {
          const [from, to] = pair.split(' TO ').map((name) => name.replace(/`/g, ''));
          assert.ok(state.tables.has(from), `RENAME TABLE names a table that exists: ${from}`);
          state.tables.delete(from);
          state.tables.add(to);
        }
        return [{}];
      }

      if (text.startsWith(`UPDATE ${LEDGER} SET filename = REPLACE`)) {
        const [from, to] = params;
        state.ledger = state.ledger.map((file) => file.split(from).join(to));
        return [{}];
      }

      if (text.startsWith(`SELECT filename FROM ${LEDGER}`)) {
        return [state.ledger.map((filename) => ({ filename }))];
      }

      if (text.startsWith(`INSERT INTO ${LEDGER}`)) {
        state.ledger.push(params[0]);
        return [{}];
      }

      return [{}];
    },
  };

  return { connection, state };
}

/** Two migrations, delivered as files so the runner reads them the way it does at startup. */
async function migrationFiles() {
  const directory = await mkdtemp(join(tmpdir(), 'guildsbounty-migrations-'));

  await writeFile(
    join(directory, '001_guildsbounty_schema.sql'),
    'CREATE TABLE IF NOT EXISTS guildsbounty_users (id BIGINT PRIMARY KEY);'
  );
  await writeFile(
    join(directory, '002_guildsbounty_offers.sql'),
    'CREATE TABLE IF NOT EXISTS guildsbounty_offers (id BIGINT PRIMARY KEY);'
  );

  return pathToFileURL(`${directory}/`);
}

const migrationStatement = (state) =>
  state.statements.find(({ text }) => text.startsWith('RENAME TABLE'));

const indexOf = (state, prefix) =>
  state.statements.findIndex(({ text }) => text.startsWith(prefix));

t('a fresh database gets the new names and every migration', async () => {
  const { connection, state } = fakeDatabase();
  const applied = await applyMigrations(connection, await migrationFiles());

  assert.deepEqual(applied, ['001_guildsbounty_schema.sql', '002_guildsbounty_offers.sql']);
  assert.equal(migrationStatement(state), undefined, 'nothing old to rename');
  assert.ok(state.tables.has(LEDGER), 'the ledger is created under its new name');
});

t('an old database has every legacy table renamed in one statement, before the ledger', async () => {
  const { connection, state } = fakeDatabase({
    tables: ['itemshare_users', 'itemshare_offers', 'itemshare_schema_migrations'],
  });

  await applyMigrations(connection, await migrationFiles());

  const rename = migrationStatement(state);
  assert.ok(rename, 'the legacy tables are renamed');
  assert.equal(rename.text, 'RENAME TABLE `itemshare_users` TO `guildsbounty_users`, ' +
    '`itemshare_offers` TO `guildsbounty_offers`, ' +
    '`itemshare_schema_migrations` TO `guildsbounty_schema_migrations`',
    'one atomic RENAME TABLE, every table, ledger included');

  const renameAt = indexOf(state, 'RENAME TABLE');
  const ledgerAt = indexOf(state, 'CREATE TABLE IF NOT EXISTS ' + LEDGER);
  const readAt = indexOf(state, 'SELECT filename FROM ' + LEDGER);
  assert.ok(renameAt < ledgerAt && renameAt < readAt, 'the rename comes first');

  assert.ok(![...state.tables].some((name) => name.startsWith('itemshare_')), 'no old names left');
});

t('the ledger filenames are rewritten, so nothing is applied twice', async () => {
  const { connection, state } = fakeDatabase({
    tables: ['itemshare_users', 'itemshare_schema_migrations'],
    ledger: ['001_itemshare_schema.sql', '002_itemshare_offers.sql'],
  });

  const applied = await applyMigrations(connection, await migrationFiles());

  assert.deepEqual(applied, [], 'both migrations were already applied');
  assert.deepEqual(state.ledger, ['001_guildsbounty_schema.sql', '002_guildsbounty_offers.sql']);

  const rewriteAt = indexOf(state, `UPDATE ${LEDGER} SET filename = REPLACE`);
  const readAt = indexOf(state, `SELECT filename FROM ${LEDGER}`);
  assert.ok(rewriteAt > -1 && rewriteAt < readAt, 'the rewrite happens before the ledger is read');
});

t('a half-finished rename leaves the table that is already renamed alone', async () => {
  const { connection, state } = fakeDatabase({
    tables: ['itemshare_users', 'itemshare_offers', 'guildsbounty_users'],
  });

  await applyMigrations(connection, await migrationFiles());

  assert.equal(
    migrationStatement(state).text,
    'RENAME TABLE `itemshare_offers` TO `guildsbounty_offers`',
    'only the table still on the old name moves'
  );
  assert.ok(state.tables.has('guildsbounty_users'), 'the renamed one is not fought over');
});

t('a second boot finds nothing to do', async () => {
  const { connection, state } = fakeDatabase({
    tables: ['itemshare_users', 'itemshare_schema_migrations'],
  });
  await applyMigrations(connection, await migrationFiles());

  state.statements.length = 0;
  const applied = await applyMigrations(connection, await migrationFiles());

  assert.deepEqual(applied, [], 'nothing is applied again');
  assert.equal(migrationStatement(state), undefined, 'nothing is renamed again');
});

t('the setting and the table prefix are the new ones', async () => {
  assert.equal(readConfig({}).database, 'guildsbounty', 'the default database');
  assert.equal(readConfig({ GUILDSBOUNTY_DATABASE: 'other' }).database, 'other');
  assert.equal(
    readConfig({ ITEMSHARE_DATABASE: 'old_name' }).database,
    'old_name',
    'the old variable is still read, so an existing .env keeps working'
  );
  assert.equal(
    readConfig({ GUILDSBOUNTY_DATABASE: 'new_name', ITEMSHARE_DATABASE: 'old_name' }).database,
    'new_name',
    'the new name wins'
  );
  assert.throws(() => readConfig({ GUILDSBOUNTY_DATABASE: 'not-a-name' }), /GUILDSBOUNTY_DATABASE/);
});

let failures = 0;

for (const [label, run] of tests) {
  try {
    await run();
    console.log(`ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${label}\n     ${error.message}`);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
