#!/usr/bin/env node
// The link a request email carries: it should open the site already signed in, on Requests
// Received, and Save on a row should record what was mailed - not answer "sign in" back at
// the person who just came from their inbox. The message and the route are checked here as
// text, so this runs without a database.
//
//   npm run test:email-link

import assert from 'node:assert/strict';
import fs from 'node:fs';

import { renderRequestEmail } from './lib/email.js';
import { renderRequestFulfillPage } from './lib/views.js';

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

const token = 'a'.repeat(64);
const siteUrl = 'https://guildsbounty.perdues.me';

const mail = renderRequestEmail({
  requester: 'Torchbug',
  requesterAccount: '@Torchbug',
  ownerAccount: '@Eva',
  items: [
    { id: 1, name: 'Briarheart Dagger', type: 'Weapon', trait: 'Sharpened', enchant: '', quality: 4, quantity: 2 },
  ],
  siteUrl,
  answerUrl: `${siteUrl}/requests/fulfill/${token}`,
});

const server = read('server.js');
const store = read('lib/store.js');

t('the email links to the answer route with its token', () => {
  assert.ok(mail.html.includes(`${siteUrl}/requests/fulfill/${token}`), 'the button carries the link');
  assert.ok(mail.text.includes(`${siteUrl}/requests/fulfill/${token}`), 'and the text version does too');
});

t('the email promises the signed-in Requests Received tab, not a password', () => {
  assert.match(mail.html, /already signed in/, 'the html says the link signs them in');
  assert.match(mail.html, /Requests Received/, 'and names the tab it lands on');
  assert.match(mail.text, /already signed in/, 'the text version says the same');
  assert.match(mail.text, /Requests Received/, 'and names the tab');
});

t('the old "Already signed in?" link, which only reached a sign-in screen, is gone', () => {
  assert.equal(mail.html.includes('Already signed in?'), false, 'no second link in the html');
  assert.equal(mail.text.includes('Already signed in?'), false, 'no second link in the text');
  assert.equal(mail.html.includes('/?tab=received'), false, 'and no bare tab address either');
});

t('both versions still say what Save does, row by row, and that 0 cancels', () => {
  assert.match(mail.html, /<strong>Save<\/strong>/, 'the html points at Save');
  assert.match(mail.text, /press Save on that row/, 'the text points at Save on the row');
  assert.match(mail.html, /<strong>0<\/strong> means you sent nothing/, 'and says what 0 means');
});

t('the answer route signs the token owner in and redirects to the tab', () => {
  assert.match(server, /getFulfillTokenOwner/, 'the route asks the store who the token belongs to');
  assert.match(
    server,
    /res\.redirect\(303, '\/\?tab=received'\)/,
    'and sends them to the Requests Received tab'
  );
  assert.match(
    server,
    /function sessionUserForOwner\(owner\)/,
    'through a session built from that person'
  );
  assert.match(server, /req\.session\.user = sessionUserForOwner\(owner\)/, 'which the route sets');
  assert.match(server, /req\.session\.accountNames = null/, 'and drops the cached account list');
});

t('a session belonging to somebody else is never replaced by an emailed link', () => {
  assert.match(
    server,
    /if \(owner && \(!signedIn \|\| Number\(signedIn\.id\) === Number\(owner\.id\)\)\)/,
    'the redirect needs nobody signed in, or the owner themselves'
  );
});

t('the bare form is still reachable, for a link whose owner cannot be read', () => {
  assert.match(server, /const wantsBareForm = String\(req\.query\.form \|\| ''\) === '1'/, '?form=1 asks for it');
  const page = renderRequestFulfillPage({
    token,
    rows: [
      {
        id: 7,
        item_name: 'Briarheart Dagger',
        item_type_name: 'Weapon',
        quality: 4,
        asked: 2,
        owner_account_name: '@Eva',
        requester_account_name: '@Torchbug',
      },
    ],
  });

  assert.ok(page.includes(`action="/requests/fulfill/${token}"`), 'and its rows post to the token');
});

t('save from the email is not refused for want of a session', () => {
  const guard = /const byEmailToken = req\.path\.startsWith\('\/requests\/fulfill\/'\);/;
  assert.match(server, guard, 'the signed-out write guard names the email form');
  assert.match(
    server,
    /if \(user \|\| req\.method !== 'POST' \|\| !req\.path\.startsWith\('\/requests'\) \|\| byEmailToken\)/,
    'and lets that one path through'
  );
  assert.match(server, /Sign in before asking for an item\./, 'while every other write still asks');
});

t('the store reads the owner from the token, pending rows only', () => {
  const fn = store.slice(store.indexOf('export async function getFulfillTokenOwner'));

  assert.ok(fn.length > 0, 'the store has the lookup');
  assert.match(fn, /email_token_hash = \?/, 'keyed on the token hash');
  assert.match(fn, /email_token_expires_at > NOW\(\)/, 'and its expiry');
  assert.match(fn, /status = 'pending'/, 'and only rows still waiting');
  assert.match(fn, /JOIN itemshare_accounts a ON a\.eso_account_name = r\.owner_account_name/, 'through the ESO accounts');
  assert.match(fn, /a\.user_id IS NOT NULL/, 'that are claimed by a user');
});

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
