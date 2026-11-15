#!/usr/bin/env node
// Looking at the site as somebody else.
//
// A tool that hands one person another person's view of the site has to be narrow in three
// places at once, and this checks all three: who may use it, what it draws, and what the
// server does with it. The interesting failures are quiet ones - a menu that appears for the
// wrong account, a swap that forgets whose database it is in, or a list of everybody in the
// site written into the session row - so those are asserted rather than left to review.
//
//   npm run test:view-as

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  arrangeForMenu,
  isViewAsOperator,
  providerLabelFor,
  VIEW_AS_USERNAME,
} from './lib/viewAs.js';
import { renderMessagePage, viewAsMenu } from './lib/views.js';

const tests = [];
const t = (label, run) => tests.push([label, run]);

const read = (path) => readFileSync(new URL(`./${path}`, import.meta.url), 'utf8');

const server = read('server.js');
const store = read('lib/store.js');

const operator = { provider: 'discord', username: VIEW_AS_USERNAME, id: 1 };
const people = [
  { id: 4, name: 'Ada' },
  { id: 9, name: 'Bramwith a long name' },
];

// One page, drawn the way the site draws it, so the menu and the banner are checked as they
// actually reach a browser rather than as strings lifted out of the source.
const pageFor = (user) =>
  renderMessagePage({ heading: 'Nothing here', message: 'Nothing happened.', user });

// The body of one route, from its `app.post(` to the next route at the left margin.
const routeBody = (path) => {
  const from = server.indexOf(`app.post('${path}'`);
  assert.ok(from > -1, `${path} is a route the server serves`);

  const rest = server.slice(from + 10);
  const next = rest.search(/\napp\.(get|post|use)\(/);

  return next === -1 ? rest : rest.slice(0, next);
};

// The body of one exported store function, up to the next export.
const storeFunction = (name) => {
  const from = store.indexOf(`export async function ${name}(`);
  assert.ok(from > -1, `${name} is in the store`);

  const rest = store.slice(from);
  const next = rest.indexOf('\nexport ');

  return next === -1 ? rest : rest.slice(0, next);
};

// ------------------------------------------------------------------- who may use it

t('the Discord account named in the rule may look at the site as somebody else', () => {
  assert.equal(isViewAsOperator(operator), true);
});

t('the name is matched whatever capitals its owner typed around it', () => {
  assert.equal(isViewAsOperator({ provider: 'discord', username: 'EvaineFaye' }), true);
  assert.equal(isViewAsOperator({ provider: 'discord', username: ` ${VIEW_AS_USERNAME} ` }), true);
});

t('another Discord name may not, whatever it is', () => {
  for (const username of ['evainefay', 'evainefaye2', 'not evainefaye', 'someone']) {
    assert.equal(isViewAsOperator({ provider: 'discord', username }), false, username);
  }
});

t('the same name on another sign-in may not: a handle on Google proves nothing', () => {
  assert.equal(isViewAsOperator({ provider: 'google', username: VIEW_AS_USERNAME }), false);
  assert.equal(isViewAsOperator({ provider: 'password', username: VIEW_AS_USERNAME }), false);
  assert.equal(isViewAsOperator({ provider: '', username: VIEW_AS_USERNAME }), false);
});

t('nobody signed in may not', () => {
  assert.equal(isViewAsOperator(null), false);
  assert.equal(isViewAsOperator(undefined), false);
  assert.equal(isViewAsOperator({}), false);
  assert.equal(isViewAsOperator({ username: VIEW_AS_USERNAME }), false);
});

// Reading the rule cannot be enough for somebody to grant themselves the menu: the server
// has to be the one that attaches the list.
t('the menu is drawn only from what the server attached, not from the name', () => {
  const html = pageFor({ ...operator, username: VIEW_AS_USERNAME });

  assert.doesNotMatch(html, /account-menu-viewas/, 'a name alone draws no menu');
  assert.doesNotMatch(html, /action="\/view-as"/, 'and no form to act on');
});

t('an ordinary signed-in person never sees it', () => {
  const html = pageFor({ provider: 'discord', username: 'someone else', id: 2 });

  assert.doesNotMatch(html, /account-menu-viewas/);
  assert.doesNotMatch(html, /view-as/);
});

t('a signed-out visitor never sees it', () => {
  const html = pageFor(null);

  assert.doesNotMatch(html, /account-menu-viewas/);
  assert.doesNotMatch(html, /view-as/);
});

// --------------------------------------------------------------------- what it draws

t('the menu lists every person the server sent, with their id', () => {
  const menu = viewAsMenu({ people, acting: null });

  for (const person of people) {
    assert.match(menu, new RegExp(`value="${person.id}"`), `${person.name} is in the list`);
  }

  assert.equal((menu.match(/<option /g) || []).length, people.length, 'one line per person');
});

t('it posts the chosen id to the route the server watches', () => {
  const menu = viewAsMenu({ people, acting: null });

  assert.match(menu, /method="post"/);
  assert.match(menu, /action="\/view-as"/);
  assert.match(menu, /name="userId"/);
});

t('while looking at somebody, the list marks who it is and offers the way back', () => {
  const menu = viewAsMenu({ people, acting: { id: 9, name: 'Ada' } });

  assert.match(menu, /value="9" selected/, 'the person being looked at is the chosen one');
  assert.equal((menu.match(/ selected/g) || []).length, 1, 'and only that one');
  assert.match(menu, /action="\/view-as\/return"/);
  assert.match(menu, /Return to my own login/);
});

t('with nothing chosen there is no way back, because there is nowhere to go back from', () => {
  const menu = viewAsMenu({ people, acting: null });

  assert.doesNotMatch(menu, /view-as\/return/);
});

t('no people, no menu', () => {
  assert.equal(viewAsMenu(null), '');
  assert.equal(viewAsMenu(undefined), '');
  assert.equal(viewAsMenu({}), '');
  assert.equal(viewAsMenu({ people: [], acting: null }), '');
});

t('a name is escaped, so a person cannot write markup into the menu', () => {
  const menu = viewAsMenu({ people: [{ id: 3, name: '<img src=x onerror=1>' }], acting: null });

  assert.doesNotMatch(menu, /<img/);
  assert.match(menu, /&lt;img/);
});

t('every page says who is being looked at, and carries the way back', () => {
  const html = pageFor({
    provider: 'discord',
    username: 'Ada',
    id: 9,
    viewAs: { people, acting: { id: 9, name: 'Ada' } },
  });

  assert.match(html, /view-as-banner/);
  assert.match(html, /Viewing as Ada/);
  assert.match(html, /#9/);
  assert.match(html, /action="\/view-as\/return"/);
});

t('a page not being looked at through somebody carries no banner', () => {
  const html = pageFor({ ...operator, viewAs: { people, acting: null } });

  assert.doesNotMatch(html, /view-as-banner/);
});

// ------------------------------------------------------------------ what the server does

t('both routes re-check the rule themselves and answer everybody else with a 404', () => {
  for (const path of ['/view-as', '/view-as/return']) {
    const body = routeBody(path);

    assert.match(body, /isViewAsOperator\(/, `${path} checks who is asking`);
    assert.match(body, /404/, `${path} answers 404`);
  }
});

t('the swap reads the person from the database, not from the form', () => {
  const body = routeBody('/view-as');

  assert.match(body, /getViewAsUser\(connection, wanted, \{ isDemo: Boolean\(real\.isDemo\) \}\)/);
  assert.match(body, /if \(!person\)/, 'and refuses when there is nobody there');
});

t('the database stays the one the person who really signed in belongs to', () => {
  const body = routeBody('/view-as');

  assert.match(body, /isDemo: Boolean\(real\.isDemo\)/, 'the session keeps the real demo flag');
  assert.doesNotMatch(body, /isDemo: Boolean\(person\.isDemo\)/, 'and never the one looked at');
});

t('both ways out forget which ESO accounts the last person had', () => {
  const restore = server.slice(server.indexOf('function restoreOwnLogin('));
  const restoreBody = restore.slice(0, restore.indexOf('\n}\n'));

  assert.match(restoreBody, /accountNames = null/);
  assert.match(routeBody('/view-as'), /accountNames = null/);
});

t('picking your own name is the way back rather than a session pointed at yourself', () => {
  const body = routeBody('/view-as');

  assert.match(body, /wanted === Number\(real\.id\)/);
  assert.match(body, /restoreOwnLogin\(req\)/);
});

t('the menu data is kept out of the stored session', () => {
  assert.match(
    server,
    /enumerable: false/,
    'the session is written with JSON.stringify, so a list of everybody must not be in it'
  );
  assert.match(
    server,
    /listViewAsUsers\(connection, \{ isDemo: Boolean\(real\.isDemo\), exclude: skip \}\)/
  );
});

t('the person who really signed in is what every gate is checked against', () => {
  const open = server.slice(server.indexOf('function viewAsSignedIn('));
  const body = open.slice(0, open.indexOf('\n}\n'));

  assert.match(body, /viewAsOriginal\(req\) \|\| req\.session\.user/, 'original first, swapped second');
});

t('the provider words read the same as a real sign-in', () => {
  assert.equal(providerLabelFor('discord'), 'Discord');
  assert.equal(providerLabelFor('google'), 'Google');
  assert.equal(providerLabelFor(''), 'their account');
});

// ------------------------------------------------------------------ what the store reads

t('the list is only the people in the copy the caller belongs to, by name', () => {
  const body = storeFunction('listViewAsUsers');

  assert.match(body, /WHERE is_demo = \?/);
  assert.match(body, /ORDER BY display_name ASC, id ASC/);
});

t('one person is looked up with the same bound, and their provider read from their sign-ins', () => {
  const body = storeFunction('getViewAsUser');

  assert.match(body, /WHERE u\.id = \? AND u\.is_demo = \?/);
  assert.match(body, /itemshare_user_identities/);
  assert.match(body, /LIMIT 1/);
});

t('a form value that is not a person is refused before any query', () => {
  const body = storeFunction('getViewAsUser');

  assert.match(body, /Number\.isInteger\(id\) \|\| id <= 0/);
  assert.ok(
    body.indexOf('Number.isInteger(id)') < body.indexOf('connection.execute'),
    'the check comes first'
  );
});

// The bug this replaced: the identity table is keyed on (provider, provider_user_id) and has
// no id column, so ordering by one failed at the database and the swap never happened.
t('the sign-in rows are ordered by columns that table actually has', () => {
  const body = storeFunction('getViewAsUser');
  const schema = read('migrations/005_itemshare_users.sql');
  const from = schema.indexOf('CREATE TABLE IF NOT EXISTS itemshare_user_identities');
  const create = schema.slice(from, schema.indexOf(') ENGINE', from));

  assert.ok(from > -1 && create.length > 0, 'the identity table is in the schema');

  const named = [...new Set([...body.matchAll(/\bi\.(\w+)/g)].map((match) => match[1]))];

  assert.ok(named.length > 0, 'the subquery refers to its own columns');

  for (const column of named) {
    assert.match(create, new RegExp(`\\b${column}\\b`), `itemshare_user_identities has ${column}`);
  }
});

t('choosing a person is the whole action, with no confirm click', () => {
  const menu = viewAsMenu({ people, acting: null });
  // Everything outside <noscript> is what a browser with script draws.
  const withScript = menu.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');

  assert.match(withScript, /data-view-as-picker/);
  assert.doesNotMatch(withScript, /<button/, 'no submit button to press after choosing');
  assert.match(menu, /<noscript>[\s\S]*type="submit"/, 'a way through without script');
});

t('the page script sends the picker as soon as it changes', () => {
  const header = read('public/header-menu.js');

  assert.match(header, /\[data-view-as-picker\]/);
  assert.match(header, /requestSubmit/);
});

t('switching who you are does not raise the browser leaving question', () => {
  assert.match(
    read('public/app.js'),
    /action === '\/browsing-account' \|\| action === '\/view-as'/,
    'a held basket survives the switch, so nothing should ask about leaving'
  );
});

// ------------------------------------------------------------- who the list leaves out

t('a person who is not the operator is offered in alphabetical order', () => {
  const people = arrangeForMenu([
    { id: 7, name: 'zara' },
    { id: 3, name: 'Bram' },
    { id: 5, name: 'ada' },
    { id: 9, name: 'Ada' },
  ]);

  assert.deepEqual(
    people.map((person) => person.name),
    ['ada', 'Ada', 'Bram', 'zara'],
    'alphabetical ignoring case, and the two Adas keep a steady order by id'
  );
});

t('the order does not depend on the database, so the menu sorts for itself', () => {
  const body = storeFunction('listViewAsUsers');

  assert.match(body, /ORDER BY display_name ASC/, 'the query still asks for it');
  assert.match(body, /return arrangeForMenu\(/, 'and the result is put in order here too');
});

t('somebody with no name is still a person to look at, listed by id', () => {
  const people = arrangeForMenu([{ id: 12, name: '   ' }, { id: 4, name: 'Ada' }]);

  assert.equal(people.length, 2, 'a blank name is not a reason to hide somebody');
  assert.deepEqual(
    people.find((person) => person.id === 12),
    { id: 12, name: '#12' },
    'they are listed as their id rather than as an empty line'
  );
});

t('a row that is not a person is dropped rather than drawn', () => {
  assert.deepEqual(arrangeForMenu([{ id: 0, name: 'nobody' }, { id: 2, name: 'Ada' }]), [
    { id: 2, name: 'Ada' },
  ]);
  assert.deepEqual(arrangeForMenu(null), []);
});

t('the list leaves out the person looking, and the one being looked at', () => {
  const body = storeFunction('listViewAsUsers');

  assert.match(body, /exclude = \[\]/);
  assert.match(body, /AND id NOT IN \(\$\{inClause\(skip\)\}\)/, 'the query skips them');
  assert.match(body, /\[isDemo \? 1 : 0, \.\.\.skip\]/, 'and binds their ids');

  // Both ids are what the server hands over: yours, and the one the page is already showing.
  assert.match(server, /const skip = \[Number\(real\.id\), acting \? acting\.id : 0\]/);
  assert.match(server, /listViewAsUsers\(connection, \{ isDemo: Boolean\(real\.isDemo\), exclude: skip \}\)/);
});

t('with nobody else to offer, the menu is not drawn rather than empty', () => {
  assert.equal(viewAsMenu({ people: [], acting: null }), '');
});

let passed = 0;
let failed = 0;

for (const [label, run] of tests) {
  try {
    await run();
    passed += 1;
    console.log(`ok   ${label}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${label}`);
    console.log(`     ${String(error.message).split('\n')[0]}`);
  }
}

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
