#!/usr/bin/env node
// The database carries the new name, and nothing else.
//
// The migration runner is driven here against a stand-in connection that keeps a real ledger,
// so the order of its statements can be checked without a MariaDB: the ledger is created under
// its new name, every file is applied once, and a second boot applies nothing. The real
// `migrations/` directory is read too, so a file that is not named for GuildsBounty - or one
// that creates a table called anything else - fails here rather than at startup.
//
//   npm run test:db-names

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { applyMigrations, readConfig } from './lib/database.js';

const tests = [];
const t = (label, run) => tests.push([label, run]);

const LEDGER = 'guildsbounty_schema_migrations';
const PREFIX = 'guildsbounty_';

/** A connection with enough of MariaDB's behaviour to follow the migration runner. */
function fakeDatabase() {
  const state = { tables: new Set(), ledger: null, statements: [] };

  const connection = {
    query: async (sql, params = []) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      state.statements.push({ text, params });

      if (text.startsWith(`CREATE TABLE IF NOT EXISTS ${LEDGER}`)) {
        state.ledger = state.ledger || [];
        state.tables.add(LEDGER);
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
    `CREATE TABLE IF NOT EXISTS ${PREFIX}users (id BIGINT PRIMARY KEY);`
  );
  await writeFile(
    join(directory, '002_guildsbounty_offers.sql'),
    `CREATE TABLE IF NOT EXISTS ${PREFIX}offers (id BIGINT PRIMARY KEY);`
  );

  return pathToFileURL(`${directory}/`);
}

t('a fresh database gets the new names and every migration', async () => {
  const { connection, state } = fakeDatabase();
  const applied = await applyMigrations(connection, await migrationFiles());

  assert.deepEqual(applied, ['001_guildsbounty_schema.sql', '002_guildsbounty_offers.sql']);
  assert.ok(state.tables.has(LEDGER), 'the ledger is created under its new name');
  assert.deepEqual(state.ledger, applied, 'and records what it applied');
});

t('the runner never renames anything, because nothing else is its own', async () => {
  const { connection, state } = fakeDatabase();

  await applyMigrations(connection, await migrationFiles());

  assert.ok(
    !state.statements.some(({ text }) => text.startsWith('RENAME TABLE')),
    'no table is renamed at startup'
  );
  assert.ok(
    !state.statements.some(({ text }) => text.includes('information_schema')),
    'and the schema is not inspected for leftovers'
  );
  assert.ok(
    !state.statements.some(({ text }) => text.startsWith('UPDATE ')),
    'nor is the ledger rewritten'
  );
});

t('a second boot applies nothing', async () => {
  const { connection, state } = fakeDatabase();
  const files = await migrationFiles();
  await applyMigrations(connection, files);

  state.statements.length = 0;
  const applied = await applyMigrations(connection, files);

  assert.deepEqual(applied, []);
});

t('the setting is GUILDSBOUNTY_DATABASE, and it has a sensible default', async () => {
  assert.equal(readConfig({}).database, 'guildsbounty', 'the default database');
  assert.equal(readConfig({ GUILDSBOUNTY_DATABASE: 'other' }).database, 'other');
  assert.equal(readConfig({ GUILDSBOUNTY_DATABASE: '  padded  ' }).database, 'padded');
  assert.throws(
    () => readConfig({ GUILDSBOUNTY_DATABASE: 'not-a-name' }),
    /GUILDSBOUNTY_DATABASE/,
    'a name MariaDB cannot take is refused, by name'
  );
});

t('every migration file is named for GuildsBounty and creates only its tables', async () => {
  const directory = new URL('./migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();

  assert.ok(files.length > 0, 'there are migrations to check');

  for (const file of files) {
    assert.match(file, /^\d{3}_guildsbounty_[a-z0-9_]+\.sql$/, `${file} carries the name`);

    const sql = (await readFile(new URL(file, directory), 'utf8'))
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    for (const [, table] of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`?([A-Za-z0-9_]+)`?/gu)) {
      assert.ok(table.startsWith(PREFIX), `${file} creates ${table}, which is not a ${PREFIX} table`);
    }
  }
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
