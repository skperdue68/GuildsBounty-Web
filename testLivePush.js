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
import {
  describeDroppedUpgrade,
  isCloudflareAddress,
  isLocalAddress,
} from './lib/realtime.js';

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
  assert.match(
    app,
    /socket\.on\('items:changed', \(payload\) => \{\s*scheduleRefresh\(\);/,
    'it listens and refetches, whatever the push also has to say'
  );
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

// A proxy that forwards the websocket request without its Upgrade header turns a working
// socket into a 400 in the browser's console, and nothing on this side can accept it. The log
// names the hop that dropped it, from the headers the request arrived with, so the person
// running the site knows which box to open - Cloudflare, or the proxy of their own.
t('a websocket refused for a missing Upgrade header is caught at the server', () => {
  assert.match(
    realtime,
    /url\.includes\('transport=websocket'\)/,
    'the guard looks at websocket requests'
  );
  assert.match(
    realtime,
    /toLowerCase\(\) === 'websocket'[\s\S]{0,80}return;/,
    'and only at the ones that arrived without the header'
  );
  assert.match(realtime, /describeDroppedUpgrade\(req\)/, 'the line is built from the request');
});

t('Cloudflare is named when Cloudflare itself connects to Node', () => {
  const said = describeDroppedUpgrade({
    socket: { remoteAddress: '162.158.10.5' },
    headers: { 'cf-ray': 'a5be1db54e1e1ed2-SJC', 'x-forwarded-for': '203.0.113.9' },
  });

  assert.match(said, /through Cloudflare \(cf-ray a5be1db54e1e1ed2-SJC\)/, 'the evidence is quoted');
  assert.match(said, /Cloudflare is the hop that dropped it/, 'Cloudflare is named');
  assert.match(said, /Network -> WebSockets: On/, 'and the setting that fixes it is given');
  assert.doesNotMatch(said, /proxy_http_version/, 'no nginx advice is mixed in');
});

t('the local proxy is named when Cloudflare is one hop further out', () => {
  const said = describeDroppedUpgrade({
    socket: { remoteAddress: '::ffff:127.0.0.1' },
    headers: { 'cf-ray': 'a5be1db54e1e1ed2-SJC', 'x-forwarded-for': '203.0.113.9' },
  });

  assert.match(said, /A proxy on this machine/, 'the hop on this machine is named');
  assert.match(said, /not Cloudflare/, 'and Cloudflare is cleared');
  assert.match(said, /proxy_set_header Upgrade \$http_upgrade/, 'with the nginx lines that fix it');
});

t('a plain local proxy is named without Cloudflare in the sentence', () => {
  const said = describeDroppedUpgrade({
    socket: { remoteAddress: '10.0.0.4' },
    headers: { 'x-forwarded-for': '198.51.100.7' },
  });

  assert.match(said, /with no cf-ray header/, 'the absence is evidence too');
  assert.match(said, /A local proxy is the last hop/, 'the local proxy is named');
  assert.match(said, /proxy_http_version 1\.1/, 'with the setting that fixes it');
});

t('an unrecognised hop is named by its address', () => {
  const said = describeDroppedUpgrade({ socket: { remoteAddress: '198.51.100.20' }, headers: {} });

  assert.match(said, /last hop before Node is 198\.51\.100\.20/, 'the address is the name');
  assert.match(said, /proxy_set_header Connection "upgrade"/, 'the settings are still given');
});

t('Cloudflare and private addresses are recognised', () => {
  assert.ok(isCloudflareAddress('162.158.10.5'), 'a Cloudflare range');
  assert.ok(isCloudflareAddress('104.16.1.1'), 'another Cloudflare range');
  assert.ok(!isCloudflareAddress('8.8.8.8'), 'not Cloudflare');
  assert.ok(isLocalAddress('127.0.0.1'), 'loopback');
  assert.ok(isLocalAddress('::1'), 'loopback over IPv6');
  assert.ok(isLocalAddress('10.1.2.3'), 'private');
  assert.ok(isLocalAddress('192.168.0.9'), 'private');
  assert.ok(isLocalAddress('172.16.5.4'), 'private');
  assert.ok(!isLocalAddress('8.8.8.8'), 'public');
});

console.log(`\n${total - failures}/${total} checks passed`);

if (failures > 0) {
  process.exitCode = 1;
}
