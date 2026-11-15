#!/usr/bin/env node
// The "the site has a new name" notice: that it is drawn only for somebody arriving by the old
// address, that it carries the new one, and that it takes itself away after ten seconds or on
// the cross. The page is rendered out of lib/views.js, and the host matching is read out of
// server.js - no browser, no database.
//
//   npm run test:rebrand-notice

import assert from 'node:assert/strict';
import fs from 'node:fs';

import { renderPage } from './lib/views.js';

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

const read = (path) => fs.readFileSync(new URL(`./${path}`, import.meta.url), 'utf8');

const NEW_URL = 'https://guildsbounty.perdues.me';

// The list page with nothing in it: the notice is about the page shell, not about the rows.
const page = (rebrandNotice = null) =>
  renderPage({
    user: null,
    providers: [],
    accounts: [],
    sharedItems: [],
    requestItems: [],
    alwaysShare: [],
    requestOffers: [],
    facets: { types: [], owners: [] },
    filters: { type: [], owner: [], search: '', added: '', order: [], group: true },
    requests: [],
    requestHistory: null,
    basket: { count: 0, quantity: 0, secondsLeft: 0, holdMinutes: 5 },
    basketRows: [],
    dbError: null,
    rebrandNotice,
  });

// --------------------------------------------------------------------- the page

t('a visit by the old name gets the notice', () => {
  const html = page({ newUrl: NEW_URL });

  assert.match(html, /data-rebrand-notice/);
  assert.match(html, /ItemShare is now Guild&rsquo;s Bounty/);
});

t('and it names the address to use instead', () => {
  const html = page({ newUrl: NEW_URL });

  assert.match(html, new RegExp(`href="${NEW_URL}"`));
  assert.match(html, /guildsbounty\.perdues\.me/, 'without the scheme, as an address reads');
});

t('the notice is dismissible, and only where it is drawn', () => {
  const withNotice = page({ newUrl: NEW_URL });
  const without = page();

  assert.match(withNotice, /data-rebrand-close/, 'the cross');
  assert.match(withNotice, /aria-label="Close this notice"/);
  assert.match(withNotice, /src="\/rebrand-notice\.js"/, 'and the script that closes it');
  assert.doesNotMatch(without, /rebrand-notice/, 'no notice, no script, nothing to close');
});

t('it is a message beside the site, not a wall in front of it', () => {
  const css = read('public/styles.css');
  const rule = css.slice(css.indexOf('.rebrand-notice {'));

  assert.match(rule.slice(0, 300), /position: fixed/);
  assert.match(rule.slice(0, 300), /pointer-events: none/, 'the page stays usable behind it');
  assert.match(css.slice(css.indexOf('.rebrand-notice-card {')).slice(0, 400), /pointer-events: auto/);
});

// -------------------------------------------------------------------- the timing

t('ten seconds, or the cross, whichever comes first', () => {
  const script = read('public/rebrand-notice.js');

  assert.match(script, /const SECONDS = 10;/);
  assert.match(script, /setTimeout\(close, SECONDS \* 1000\)/);
  assert.match(script, /button\.addEventListener\('click', close\)/);
  assert.match(script, /window\.clearTimeout\(timer\)/, 'one close, not two');
});

// --------------------------------------------------------------- which name counts

t('the old name is the one the site used before the rebrand', () => {
  const server = read('server.js');

  assert.match(server, /'itemsync\.perdues\.me'/);
  assert.match(server, /process\.env\.LEGACY_HOSTS/, 'and it can be changed without a deploy');
});

t('the name the browser asked for is what is compared, not the proxy in front', () => {
  const server = read('server.js');
  const body = server.slice(server.indexOf('function requestHost(req)'));

  assert.match(body.slice(0, 500), /x-forwarded-host/);
  assert.ok(body.slice(0, 600).includes(".split(',')"), 'a proxy may list more than one');
  assert.match(body.slice(0, 500), /replace\(\/:\\d\+\$\/, ''\)/, 'a port is not part of the name');
  assert.match(body.slice(0, 500), /toLowerCase\(\)/);
});

t('only the landing page carries it, so a live refresh cannot nag', () => {
  const server = read('server.js');
  const route = server.slice(server.indexOf("app.get('/', async"));
  const until = route.indexOf('app.post(', 0);
  const body = route.slice(0, until === -1 ? 1200 : until);

  assert.match(body, /data\.rebrandNotice = arrivedFromLegacyHost\(req\)/);
  assert.match(body, /NEW_SITE_URL/);
});

t('the new address can be set too, rather than only the old one', () => {
  const server = read('server.js');

  assert.match(server, /process\.env\.NEW_SITE_URL/);
  assert.match(server, /guildsbounty\.perdues\.me/);
});

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
