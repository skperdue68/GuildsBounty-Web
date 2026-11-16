#!/usr/bin/env node
// The number on the avatar: how many asks are waiting on this person's own items.
//
// The badge is drawn from a count the server puts on the user before the page is rendered,
// so the markup is what is checked here - that it appears only when something is waiting,
// that it says "request" or "requests" the way a reader hears it, and that a big number
// does not make the circle wider than the avatar it sits on. The count itself is one
// query, so its shape is read the way the other store tests read theirs, and having no
// linked account has to answer without touching the database at all.
//
//   npm run test:request-badge

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { countOwnerRequests, pendingRequestBadges } from './lib/store.js';
import { renderOwnerRequestsPage } from './lib/views.js';

let total = 0;
let failures = 0;

async function t(name, fn) {
  total += 1;

  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n     ${error.message}`);
  }
}

const user = {
  username: 'Develia',
  provider: 'discord',
  providerLabel: 'Discord',
};

/** A page an owner sees, with the count the server would have hung on the user. */
const pageFor = (waiting) =>
  renderOwnerRequestsPage({
    accounts: [],
    rows: [],
    user: waiting === undefined ? { ...user } : { ...user, pendingRequests: waiting },
  });

// The browser's half of the same circle: the function that redraws it when the server pushes
// a new count. Sliced out of the file the browser actually loads, so this is the real code.
const appSource = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const badgeStart = appSource.indexOf('// ------------------------------------------------------------ pending requests badge');
const badgeEnd = appSource.indexOf('// ------------------------------------------------------ end pending requests badge');

const { pendingBadgeState } = new Function(`
  ${appSource.slice(badgeStart, badgeEnd)}
  return { pendingBadgeState };
`)();

// ------------------------------------------------------------------- the markup

await t('a request waiting puts a number on the avatar', () => {
  const html = pageFor(3);

  assert.match(html, /<span class="avatar-slot">/);
  assert.match(html, /<span class="avatar-badge" aria-hidden="true">3<\/span>/);
  assert.ok(
    html.indexOf('avatar-slot') < html.indexOf('avatar-badge'),
    'the badge is in the same box as the avatar'
  );

  const button = html.slice(html.indexOf('id="accountMenuButton"'), html.indexOf('</button>'));

  assert.match(button, /avatar-badge/, 'and inside the button that opens the menu');
});

// The header used to say the name twice over - beside the avatar, then on a row under it in a
// pill - and both read as cramped. The picture is the whole control now, and the name is
// something the menu itself says.
await t('the header is just the picture, with no name and no caret', () => {
  const html = pageFor(0);
  const button = html.slice(html.indexOf('id="accountMenuButton"'), html.indexOf('</button>'));

  assert.doesNotMatch(html, /class="account-name"/, 'no name is drawn in the header');
  assert.doesNotMatch(html, /avatar-caret/, 'and no caret, so the picture itself is the control');
  assert.doesNotMatch(html, /avatar-stack/, 'no column holding a second row either');
  assert.match(button, /class="avatar-slot"/, 'the picture is inside the button');
  assert.match(button, /data-account-name="Develia"/, 'the name stays on it for the live count');
  assert.match(button, /Account menu for Develia/, 'and it still says whose menu this is');
});

await t('nothing waiting draws no circle at all', () => {
  assert.doesNotMatch(pageFor(0), /avatar-badge/);
  assert.doesNotMatch(pageFor(0), /requests to process/);
});

await t('a page drawn before the count is known draws no circle', () => {
  assert.doesNotMatch(pageFor(undefined), /avatar-badge/);
});

await t('a count that is not a number draws no circle', () => {
  assert.doesNotMatch(pageFor('nonsense'), /avatar-badge/);
});

await t('the button says the count to somebody who cannot see the circle', () => {
  assert.match(pageFor(3), /Account menu for Develia, 3 requests to process/);
  assert.match(pageFor(1), /Account menu for Develia, 1 request to process/);
});

await t('hovering the avatar says it too', () => {
  assert.match(pageFor(2), /title="Develia - 2 requests to process"/);
  assert.match(pageFor(0), /title="Develia"/);
});

await t('past ninety-nine the circle says 99+ rather than growing', () => {
  const html = pageFor(140);

  assert.match(html, />99\+<\/span>/);
  assert.doesNotMatch(html, />140</);
});

// ------------------------------------------------- the same words, drawn live

await t('a pushed count says exactly what a reloaded page would say', () => {
  for (const waiting of [0, 1, 2, 99, 100, 140]) {
    const page = pageFor(waiting);
    const state = pendingBadgeState(waiting, 'Develia');
    const badge = state.badge.replace('+', '\\+');

    if (state.badge) {
      assert.match(
        page,
        new RegExp(`<span class="avatar-badge" aria-hidden="true">${badge}</span>`),
        `${waiting}: the circle reads the same live as on a fresh page`
      );
    } else {
      assert.doesNotMatch(page, /avatar-badge/, 'nothing waiting draws no circle either way');
    }

    assert.ok(page.includes(`title="${state.title}"`), `${waiting}: the tooltip matches`);
    assert.ok(page.includes(state.label), `${waiting}: what a screen reader hears matches`);
  }
});

await t('one request is said in the singular', () => {
  assert.equal(pendingBadgeState(1, 'Develia').label, 'Account menu for Develia, 1 request to process');
  assert.equal(pendingBadgeState(2, 'Develia').label, 'Account menu for Develia, 2 requests to process');
});

await t('a nonsense or missing count is nothing waiting, not a broken circle', () => {
  for (const value of [undefined, null, '', 'nonsense', -3, NaN]) {
    const state = pendingBadgeState(value, 'Develia');

    assert.equal(state.waiting, 0);
    assert.equal(state.badge, '');
    assert.equal(state.title, 'Develia');
  }
});

await t('the circle caps at 99+ and the exact number is not shown', () => {
  assert.equal(pendingBadgeState(99, 'Develia').badge, '99');
  assert.equal(pendingBadgeState(100, 'Develia').badge, '99+');
  assert.equal(pendingBadgeState(140, 'Develia').badge, '99+');
});

// --------------------------------------------------------- who gets told, and what

function sequencedConnection(responses) {
  const calls = [];
  let index = 0;

  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      const rows = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return [rows];
    },
  };
}

await t('an owner is found from the account a request landed on', async () => {
  const connection = sequencedConnection([
    [{ user_id: 5 }],
    [{ eso_account_name: '@Eva', user_id: 5 }],
    [{ waiting: 2 }],
  ]);

  const badges = await pendingRequestBadges(connection, ['@Eva', ' @Eva ']);

  assert.deepEqual(badges, [{ userId: 5, count: 2 }]);
  assert.equal(connection.calls.length, 3, 'owner, their accounts, then the count');

  const [owners, accounts, count] = connection.calls;

  assert.match(owners.sql, /SELECT DISTINCT a\.user_id/);
  assert.match(owners.sql, /a\.user_id IS NOT NULL/, 'an account nobody signed in for has no owner');
  assert.match(owners.sql, /eso_account_name IN \(\?\)/, 'one name given twice is one lookup');
  assert.deepEqual(owners.params, ['@Eva']);

  assert.deepEqual(accounts.params, [5], 'the count is taken over every account they own');
  assert.match(count.sql, /SELECT COUNT\(\*\) AS waiting/, 'the same query the header uses');
});

await t('no owner to tell means no query and no push', async () => {
  const connection = {
    async execute() {
      throw new Error('nothing should be asked of the database');
    },
  };

  assert.deepEqual(await pendingRequestBadges(connection, []), []);
  assert.deepEqual(await pendingRequestBadges(connection, ['   ']), []);
});

await t('an account nobody claimed is not told anything', async () => {
  const connection = sequencedConnection([[], [], []]);

  assert.deepEqual(await pendingRequestBadges(connection, ['@Nobody']), []);
});

// -------------------------------------------------------------------- the count

function fakeConnection(rows) {
  const calls = [];

  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      return [rows];
    },
  };
}

await t('the count is one query for the person\'s own accounts', async () => {
  const connection = fakeConnection([{ waiting: 4 }]);
  const waiting = await countOwnerRequests(connection, ['@Eva', ' @Eva ', '@Alt']);

  assert.equal(waiting, 4);
  assert.equal(connection.calls.length, 1);

  const { sql, params } = connection.calls[0];

  assert.match(sql, /SELECT COUNT\(\*\) AS waiting/);
  assert.match(sql, /status = 'pending'/);
  assert.match(sql, /owner_account_name IN \(\?, \?\)/);
  assert.deepEqual(params, ['@Eva', '@Alt'], 'a name given twice is still one account');
});

await t('the grouping is the one the requests list uses, so the two numbers agree', async () => {
  const connection = fakeConnection([{ waiting: 0 }]);
  await countOwnerRequests(connection, ['@Eva']);

  const { sql } = connection.calls[0];

  assert.match(sql, /SELECT DISTINCT/);

  for (const column of [
    'r.item_kind',
    'COALESCE(r.trait',
    'COALESCE(r.enchant_name',
    'COALESCE(r.style_name',
    'COALESCE(r.required_level',
    'COALESCE(r.required_cp',
  ]) {
    assert.ok(sql.includes(column), `${column} is part of what makes two asks the same`);
  }

  assert.match(
    sql,
    /CASE WHEN COALESCE\(r\.item_id, 0\) > 0 THEN 0 ELSE r\.id END/,
    'an ask with no item id is its own group rather than merged with another'
  );
});

await t('no linked account means nothing to count, and nothing to ask', async () => {
  const connection = {
    async execute() {
      throw new Error('nothing should be asked of the database');
    },
  };

  assert.equal(await countOwnerRequests(connection, []), 0);
  assert.equal(await countOwnerRequests(connection, ['  ']), 0);
});

await t('the count is a number whatever the driver hands back', async () => {
  assert.equal(await countOwnerRequests(fakeConnection([{ waiting: '7' }]), ['@Eva']), 7);
  assert.equal(await countOwnerRequests(fakeConnection([]), ['@Eva']), 0);
});

// ------------------------------------------------ where the number is kept in step
// A badge that only ever goes up is worse than none, so what is checked here is that every
// way the waiting count can move tells the person it moved. Sliced out of server.js, the
// file that is actually started, rather than copied into the test.
const serverSource = readFileSync(new URL('./server.js', import.meta.url), 'utf8');

function sourceBetween(startText, endText) {
  const start = serverSource.indexOf(startText);

  assert.ok(start >= 0, `${startText} is in the file`);

  const end = serverSource.indexOf(endText, start);

  return serverSource.slice(start, end > start ? end : undefined);
}

await t('answering on the site brings the owner\'s own count down', () => {
  const route = sourceBetween("app.post('/owner/requests'", '\napp.post(');

  assert.match(route, /recordOwnerGroupAnswer\(/, 'the owner\'s own answer');
  assert.match(
    route,
    /await announcePendingRequests\(answeredAccounts\)/,
    'and the number on their avatar is worked out again afterwards'
  );
});

await t('answering from an email link does too', () => {
  const route = sourceBetween("app.post('/requests/fulfill/:token'", '\napp.post(');

  assert.match(route, /recordFulfillment\(/, 'the answer the link carries');
  assert.match(
    route,
    /await announcePendingRequests\(outcome\.rows\.map\(\(row\) => row\.ownerAccountName\)\)/,
    'each owner named on the rows it closed'
  );
});

await t('the demo visitor\'s count moves as the cast asks them for things', () => {
  const tick = sourceBetween('async function tickDemoActivity', 'function scheduleDemoActivity');

  assert.match(
    tick,
    /pendingRequestBadges\(connection, \[DEMO_ACCOUNT\]\)/,
    'counted in the demo\'s own copy, not the real database'
  );
  assert.match(
    tick,
    /realtime\.notifyPendingRequests\(badge\.userId, badge\.count\)/,
    'and pushed to that person\'s pages'
  );
  assert.match(
    tick,
    /demoBadgeCount !== badge\.count/,
    'only when it moved, so an unchanged tick is not announced'
  );
});

await t('an upload that drops a piece drops the asks for it, and says so', () => {
  const upload = sourceBetween('async function applySavedVariablesUpload', '\napp.post(');

  assert.match(
    upload,
    /await announcePendingRequests\(uploadedAccounts\)/,
    'a file without the piece cancels its asks, so the count moves without an answer'
  );
});

await t('an answered row knows whose shelf it left', () => {
  const store = readFileSync(new URL('./lib/store.js', import.meta.url), 'utf8');

  assert.match(
    store,
    /answered\.push\(\{[\s\S]{0,800}?ownerAccountName: row\.owner_account_name \|\| ''/,
    'the badge is worked out from the row, and an email answer has no other way to say'
  );
});

console.log(`\n${total - failures}/${total} checks passed`);
process.exitCode = failures === 0 ? 0 : 1;
