#!/usr/bin/env node
// An upload, and every other page: does the change reach them, and does what arrives carry
// the menus, the choices and the numbers?
//
// The push carries no item data on purpose - the socket only says "something you can see has
// changed", and each page fetches the list it is allowed to see through its own signed-in
// request. That means the chain is the feature: an upload that commits rows and never
// announces them leaves every other window showing the list as it was before the upload, with
// dropdowns that no longer match the rows under them. There is no browser test for that here,
// so this reads the four links and checks each one is still there and still in the right order.
//
//   npm run test:live-push

import assert from 'node:assert/strict';
import fs from 'node:fs';

import { assetUrl, BUILD_STAMP } from './lib/views.js';

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

const server = read('server.js');
const realtime = read('lib/realtime.js');
const app = read('public/app.js');

// ------------------------------------------------------------ the upload announces itself

t('a committed upload announces itself to every open page', () => {
  const upload = server.slice(
    server.indexOf('async function applySavedVariablesUpload('),
    server.indexOf("app.post('/upload'")
  );

  assert.match(
    upload,
    /notifyItemsChanged\(\s*'upload',/,
    'the upload calls the one announcement every other change uses'
  );

  // Announced after the rows are committed, and before the icon work, so a page that hears
  // it finds the new list rather than the one the upload replaced, and nobody waits on UESP
  // before seeing their own items.
  const commit = upload.indexOf('const summary = await replaceAccounts(');
  const announced = upload.indexOf("notifyItemsChanged(\n    'upload'");

  assert.ok(commit > -1, 'the rows are committed inside it');
  assert.ok(announced > commit, 'and the announcement comes after the commit');

  // A call that sits behind `&&` or `void` reads the same to a text search and announces
  // nothing, so the announcement has to be a statement of its own.
  const before = upload.slice(0, announced).split('\n').pop();

  assert.equal(before.trim(), '', 'and it stands on its own line, not behind a short-circuit');
  assert.ok(
    announced < upload.indexOf('cacheItemIcons('),
    'and before the icon work, which can take a moment on UESP'
  );
});

t('a file that cannot be read announces nothing', () => {
  const upload = server.slice(
    server.indexOf('async function applySavedVariablesUpload('),
    server.indexOf("app.post('/upload'")
  );

  // Every refusal throws before the commit, so the announcement - which sits after it - is
  // never reached. A bad file must not move anybody else's page.
  const announced = upload.indexOf("notifyItemsChanged(\n    'upload'");
  const firstThrow = upload.indexOf('throw invalid');

  assert.ok(firstThrow > -1 && firstThrow < announced, 'the parse refusal comes first');
});

t('the automatic uploader goes through the same announcement', () => {
  assert.equal(
    (server.match(/await applySavedVariablesUpload\(/g) || []).length,
    2,
    'the card and the GuildSync token both use the one function'
  );
  assert.doesNotMatch(
    server.slice(server.indexOf("app.post('/upload'")).slice(0, 900),
    /notifyItemsChanged\(/,
    'so the route itself does not have to remember to announce anything'
  );
});

// ---------------------------------------------------------- the socket carries the word

t('the announcement is a broadcast, coalesced, to every page', () => {
  assert.match(realtime, /io\.emit\('items:changed', payload\)/, 'every open page is told');
  assert.match(realtime, /setTimeout\(flush, coalesceMs\)/, 'and one upload is one broadcast');
  assert.match(
    realtime,
    /Socket deliberately carries no item data|socket deliberately carries no item data/i,
    'the socket carries the word, not the rows'
  );
});

t('a demo change stays inside the demo room', () => {
  assert.match(
    server,
    /if \(requestDatabase\.getStore\(\) === DEMO_DATABASE\) \{\s*realtime\.notifyDemoChange\(kind, message\);/,
    'the demo sandbox is announced to demo pages only'
  );
  assert.match(realtime, /io\.to\(DEMO_ROOM\)\.emit\('items:changed', payload\)/, 'and sent there');
});

// --------------------------------------------------- the page fetches what it may see

t('a page that hears the word fetches its own list, with its own filters', () => {
  assert.match(app, /socket\.on\('items:changed', \(\) => scheduleRefresh\(\)\)/, 'it listens');
  assert.match(app, /fetch\(`\/items\$\{query\}`/, 'and fetches the list fragment');

  const refresh = app.slice(app.indexOf('  async function refresh()'), app.indexOf('  function scheduleRefresh('));

  assert.match(refresh, /const query = listQuery\(\);/, 'built from the address bar');
  assert.match(
    refresh,
    /applyRegion\(html\)/,
    'and the answer replaces the region'
  );
});

t('the fragment is the same region the page was built from, menus and all', () => {
  const route = server.slice(server.indexOf("app.get('/items'"), server.indexOf("app.get('/items'") + 700);

  assert.match(route, /collectViewerData\(req, readFilters\(req\.query/, 'read with the asking page’s filters');
  assert.match(route, /renderListRegion\(data\)/, 'and drawn as the whole region');
  assert.match(route, /status\(503\)/, 'a database hiccup leaves the good list on screen');
});

t('the new region is applied whole, then the numbers are read back off it', () => {
  const apply = app.slice(app.indexOf('  function applyRegion(html)'), app.indexOf('  function applyRegion(html)') + 6000);

  assert.match(apply, /reconcileLiveNode\(listRegion, next\)/, 'the list region is reconciled');
  assert.match(apply, /syncFilterCard\(\);\n    applyListSearch\(\);/s, 'the filter row is decided for the open tab');
  assert.match(apply, /applyListSearch\(\);\n    \/\/ The rows are new[\s\S]{0,200}syncCounts\(\);/s, 'and the counts follow the new rows');
});

// ------------------------------------------------------------ the browser gets this build

t('every stylesheet and script is asked for at the build this page was made with', () => {
  const views = read('lib/views.js');
  const shell = views.slice(views.indexOf('function pageShell('), views.indexOf('function pageShell(') + 4200);

  // A URL with no version on it is the one thing a deploy cannot change inside a cache, and a
  // browser holding yesterday's stylesheet is a fix that never arrives: the menu renders under
  // the search row and the dropdown keeps hiding its own options, exactly as before.
  assert.doesNotMatch(
    shell,
    /(?:href|src)="\/(?:styles\.css|app\.js|header-menu\.js|requests-sort\.js|password-toggle\.js|password-check\.js|auth-panel\.js|rebrand-notice\.js)[^"]*"/,
    'nothing is linked without the stamp'
  );
  assert.match(shell, /assetUrl\('\/styles\.css'\)/, 'including the stylesheet');
  assert.match(shell, /assetUrl\('\/app\.js'\)/, 'and the script that runs the list');
  assert.match(views, /statSync\(path\.join\(PUBLIC_DIR, name\)\)/, 'the stamp is the files\' own size and time');
});

t('the same stamp is on the page, so a stale page can be told by eye', () => {
  const views = read('lib/views.js');

  assert.match(views, /<span class="build-stamp"[^>]*>build \$\{BUILD_STAMP\}<\/span>/, 'the footer carries it');
  assert.match(read('public/styles.css'), /\.build-stamp \{[^}]*font-size: 11px/, 'small enough to ignore');
  assert.match(assetUrl('/app.js'), /^\/app\.js\?v=[0-9a-f]{10}$/, 'a versioned URL');
  assert.equal(assetUrl('/app.js'), assetUrl('/app.js'), 'the same file, the same URL');
  assert.equal(assetUrl('/app.js').split('?v=')[1], BUILD_STAMP, 'one stamp for the page and its files');
});

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
