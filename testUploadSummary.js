#!/usr/bin/env node
// What an upload says it did to a list: what went, what arrived, and what was only
// re-counted. No browser and no database - the comparison runs for real against rows in the
// shape the table hands back, and the wording is the exact function the page calls, sliced
// out of the file the browser loads.
//
//   npm run test:upload-summary

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hashItemKey, summariseItemChanges } from './lib/store.js';

const tests = [];
const t = (label, run) => tests.push([label, run]);

const appSource = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const start = appSource.indexOf(
  '// ------------------------------------------------- upload change summary'
);
const end = appSource.indexOf('// ---------------------------------------------- end upload change summary');

assert.ok(start > 0 && end > start, 'the change summary is where the test can find it');

const { uploadChangeSummary } = new Function(`
  ${appSource.slice(start, end)}
  return { uploadChangeSummary };
`)();

// A row as the table returns it, and an item as the file gives it. The link is what ties the
// two together, through its hash.
const row = (itemKey, quantity) => ({ item_key_hash: hashItemKey(itemKey), item_count: quantity });
const item = (itemKey, itemCount) => ({ itemKey, itemCount });

// ------------------------------------------------------------------ added, and nothing else

t('an item the account did not have is added', () => {
  const changes = summariseItemChanges([row('a', 1)], [item('a', 1), item('b', 2)]);

  assert.deepEqual(changes, { added: 1, refreshed: 0 });
});

t('a first upload adds everything and refreshes nothing', () => {
  const changes = summariseItemChanges([], [item('a', 1), item('b', 1), item('c', 4)]);

  assert.deepEqual(changes, { added: 3, refreshed: 0 });
});

t('an item that came back after being gone counts as added', () => {
  // The row was pruned with an earlier file, so this upload really is adding it.
  const changes = summariseItemChanges([row('a', 1)], [item('b', 1)]);

  assert.deepEqual(changes, { added: 1, refreshed: 0 });
});

// --------------------------------------------------------------- refreshed, and nothing else

t('a stack that grew is refreshed, not added', () => {
  const changes = summariseItemChanges([row('a', 1)], [item('a', 4)]);

  assert.deepEqual(changes, { added: 0, refreshed: 1 });
});

t('a stack that shrank is refreshed, not removed', () => {
  const changes = summariseItemChanges([row('a', 9)], [item('a', 2)]);

  assert.deepEqual(changes, { added: 0, refreshed: 1 });
});

t('an item at the count it already had is none of the three', () => {
  const changes = summariseItemChanges([row('a', 3), row('b', 1)], [item('a', 3), item('b', 1)]);

  assert.deepEqual(changes, { added: 0, refreshed: 0 });
});

t('one file can add and refresh at the same time, counted apart', () => {
  const changes = summariseItemChanges(
    [row('a', 1), row('b', 2), row('c', 5)],
    [item('a', 1), item('b', 3), item('d', 1), item('e', 1)]
  );

  assert.deepEqual(changes, { added: 2, refreshed: 1 });
});

// ----------------------------------------------------------------------------- the edge cases

t('the same item named twice is counted once, at the count written last', () => {
  const before = [row('a', 1)];
  const twice = [item('a', 2), item('a', 2)];

  assert.deepEqual(summariseItemChanges(before, twice), { added: 0, refreshed: 1 });

  // And a file naming one new item twice is one new item, not two.
  assert.deepEqual(summariseItemChanges([], [item('b', 1), item('b', 1)]), {
    added: 1,
    refreshed: 0,
  });
});

t('an item held back for an open request is not called refreshed', () => {
  const held = new Set([hashItemKey('a')]);
  const changes = summariseItemChanges([row('a', 1)], [item('a', 7)], held);

  assert.deepEqual(changes, { added: 0, refreshed: 0 }, 'its stored count was left alone');
});

t('nothing in the file adds and refreshes nothing, leaving removal to the prune', () => {
  assert.deepEqual(summariseItemChanges([row('a', 1), row('b', 2)], []), {
    added: 0,
    refreshed: 0,
  });
});

t('a row with no key is never mistaken for an item', () => {
  const changes = summariseItemChanges(
    [{ item_key_hash: null, item_count: 3 }],
    [item('a', 3)]
  );

  assert.deepEqual(changes, { added: 1, refreshed: 0 });
});

t('a quantity that is not a number is read as none', () => {
  const changes = summariseItemChanges([row('a', 2)], [item('a', undefined)]);

  assert.deepEqual(changes, { added: 0, refreshed: 1 });
});

// ------------------------------------------------------------------------------- the words

t('the line says what went, what arrived and what was re-counted', () => {
  assert.equal(
    uploadChangeSummary({ removedItems: 2, addedItems: 5, refreshedItems: 1 }),
    '2 items removed, 5 items added, 1 item refreshed'
  );
});

t('one of each is said in the singular', () => {
  assert.equal(
    uploadChangeSummary({ removedItems: 1, addedItems: 1, refreshedItems: 1 }),
    '1 item removed, 1 item added, 1 item refreshed'
  );
});

t('a quiet upload says zero rather than nothing at all', () => {
  assert.equal(
    uploadChangeSummary({ removedItems: 0, addedItems: 0, refreshedItems: 0 }),
    '0 items removed, 0 items added, 0 items refreshed'
  );
});

t('a count that is missing or nonsense reads as zero in the line', () => {
  assert.equal(
    uploadChangeSummary({}),
    '0 items removed, 0 items added, 0 items refreshed'
  );
  assert.equal(
    uploadChangeSummary({ removedItems: 'two', addedItems: -3, refreshedItems: null }),
    '0 items removed, 0 items added, 0 items refreshed'
  );
});

t('the upload answer on the page actually shows the line', () => {
  assert.ok(
    appSource.includes('${uploadChangeSummary(account)}'),
    'the toast must use the line, or none of the above is on screen'
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
    console.log('FAIL ' + label + '\n     ' + error.message);
  }
}

console.log(`\n${total - failures}/${total} checks passed`);
process.exit(failures === 0 ? 0 : 1);
