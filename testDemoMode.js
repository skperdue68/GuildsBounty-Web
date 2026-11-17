// The Demo sign-in and the two gates in front of the site.
//
// No MariaDB here, so the database half runs against a connection that records the
// statements it is given and answers with the minimum each caller needs. What is
// checked is the shape of what would be written and the rules that decide what a demo
// session may do - the two things that would be wrong in a way nobody notices until
// somebody has reserved an item that never existed.

import {
  DEMO_ACCOUNT,
  DEMO_DATABASE,
  DEMO_EMAIL,
  DEMO_GUILD,
  DEMO_GUILD_SERVER,
  DEMO_LOGIN,
  DEMO_PASSWORD,
  DEMO_WORLD,
  copyDemoData,
  databaseForUser,
  demoDatabaseConfig,
  demoRefusal,
  demoRefusalMessage,
  demoRemovalRestores,
  ensureDemoData,
  findDemoSignIn,
} from './lib/demo.js';
import {
  DEMO_CAST,
  castAccount,
  castCatalogue,
  castEmail,
  ensureDemoCast,
} from './lib/demoCast.js';
import { DEMO_EXPIRE_DAYS, ITEMS, OFFERS, buildItem, buildOffer } from './lib/demoItems.js';
import {
  DEMO_ACTIVITY_SCENARIOS,
  demoActivityPause,
  demoAnswerAmount,
  pickScenario,
  refreshedShelf,
  runDemoActivity,
  shelfChange,
  uploadChangeWords,
} from './lib/demoActivity.js';
import { readFileSync } from 'node:fs';

import { DEMO_VIEWER_TTL_MS, activeDemoViewers, noteViewer } from './lib/demoPresence.js';
import {
  DEMO_ASK_TTL_MS,
  DEMO_RESTOCK_MS,
  abandonedAsksSql,
  demoOwnAccount,
  ownShelfCounts,
  shouldRestock,
} from './lib/demoShelf.js';
import { AGE_HOURS, planAges, untouchedRowsSql } from './lib/itemAges.js';
import { stamp } from './lib/log.js';
import { platformName, readAccountServer, serverChoices, serverLabel } from './lib/serverLabel.js';
import { hashItemKey, linkAccountToUser, listAccountServers } from './lib/store.js';
import { seedDemoRequestHistory } from './lib/demoRequests.js';
import {
  emailLine,
  inventoryTable,
  renderPage,
  renderSignInPage,
  renderUploadPage,
} from './lib/views.js';

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertMatch(text, pattern, message) {
  if (!pattern.test(text)) {
    throw new Error(`${message} (looked for ${pattern})`);
  }
}

/**
 * A connection that records every statement. `answers` maps a fragment of SQL to the
 * rows that statement returns, so one stub can serve the demo lookup and the writes
 * that follow it.
 */
function fakeConnection({ userRow = null, sharedCount = 0, pendingRows = null } = {}) {
  const statements = [];

  return {
    statements,
    calls(pattern) {
      return statements.filter((entry) => pattern.test(entry.sql));
    },
    async execute(sql, params) {
      statements.push({ sql, params: params || [] });

      // mysql2 answers `[rows, fields]`, and the store reads the first element of each
      // call as either a row list or an insert result, so the two shapes must differ.
      if (/^\s*SELECT/i.test(sql)) {
        if (/FROM guildsbounty_users WHERE is_demo = 1/.test(sql)) {
          return [userRow ? [userRow] : [], {}];
        }
        if (/COUNT\(\*\) AS n FROM guildsbounty_shared_items/.test(sql)) {
          return [[{ n: sharedCount }], {}];
        }
        if (pendingRows && /FROM guildsbounty_requests/.test(sql)) {
          return [pendingRows, {}];
        }
        return [[], {}];
      }

      return [{ insertId: 7, affectedRows: 1 }, {}];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
  };
}

// ------------------------------------------------------------------ the constants
check('the demo guild is the one that was asked for, on PC and NA', () => {
  assert(DEMO_GUILD.name === 'Alphabet Mafia', `expected Alphabet Mafia, got ${DEMO_GUILD.name}`);
  assert(DEMO_WORLD.platform === 2, `expected platform 2 (PC), got ${DEMO_WORLD.platform}`);
  assert(DEMO_WORLD.worldName === 'NA Megaserver', `got ${DEMO_WORLD.worldName}`);
  assert(
    DEMO_LOGIN === 'demo@perdues.me' && DEMO_PASSWORD === 'demo@perdues.me',
    'the pair is demo@perdues.me / demo@perdues.me'
  );
});

check('the demo account is not the one seedDemo.js writes into real guilds', () => {
  assert(DEMO_ACCOUNT !== '@DemoTrader', 'the demo must use its own account');
});

// A shelf of names says nothing about whether a piece is any use: ESO gates gear by level or
// by champion points, and the enchantment is often the reason somebody wants it. The
// catalogue is the shape an upload writes, so those fields have to be filled the way a real
// file fills them - without them every demo row read as a level 0 item with no glyph.
check('the demo gear carries its level, its champion points and its enchantment', () => {
  const gear = ITEMS.filter((spec) => spec.cp);

  assert(gear.length >= 5, `expected the demo to share some gear, got ${gear.length}`);
  assert(
    gear.every((spec) => spec.level === 50 && spec.cp === 160),
    'CP gear is level 50 with a champion point requirement'
  );
  assert(
    gear.every((spec) => String(spec.enchant || '').startsWith('Glyph of')),
    'every gear row names the glyph it carries'
  );
  assert(
    ITEMS.find((spec) => spec.name === 'Dwemer Frame').cp === undefined,
    'a material has no champion points to report'
  );

  const built = buildItem(gear[0], 0, [DEMO_GUILD.id]);

  assert(built.requiredCp === 160 && built.requiredLevel === 50, 'both reach the row');
  assert(built.enchantName === gear[0].enchant, 'and so does the glyph');

  // The catalogue is camelCase, the way an upload hands a row to the store; the list reads
  // the row the query returns, which is snake_case. Both ends are covered here: the fields
  // the writer sets, then the line the reader gets out of them.
  const staff = ITEMS.find((spec) => spec.name === "Mother's Sorrow Inferno Staff");
  const staffRow = buildItem(staff, 0, [DEMO_GUILD.id]);
  const html = inventoryTable(
    [
      {
        ...staffRow,
        item_key_hash: 'demo',
        guild_names: DEMO_GUILD.name,
        required_level: staffRow.requiredLevel,
        required_cp: staffRow.requiredCp,
        enchant_name: staffRow.enchantName,
      },
    ],
    { mine: false, filters: {} }
  );

  assertMatch(html, /Level CP160/, 'the row says what it requires');
  assertMatch(html, /Glyph of Increase Magical Harm/, 'and what it is enchanted with');
});

// Not everything on the shelf is gear, and the list reads as a list of items rather than a
// list of gear: a material with no level printed at all looked half-finished beside the
// sword above it. Everything the catalogue shares is level 1 unless it is gear and says
// otherwise. What a material has not got is a champion point requirement, a glyph or a
// style, and none of those is invented for it.
check('what is not gear is level 1, and claims nothing else', () => {
  const plain = ITEMS.filter((spec) => ![1, 2, 3].includes(spec.type));
  const plainOffers = OFFERS.filter((spec) => ![1, 2, 3].includes(spec.type));

  assert(plain.length >= 3, `expected some non-gear on the demo shelf, got ${plain.length}`);
  assert(plainOffers.length >= 1, `expected non-gear on the always-shared list, got ${plainOffers.length}`);

  for (const spec of plain) {
    assert(spec.level === 1, `${spec.name} carries level 1`);
    assert(spec.cp === undefined, `${spec.name} carries no champion points`);
    assert(spec.enchant === undefined, `${spec.name} carries no glyph`);
    assert(spec.style === undefined, `${spec.name} carries no style`);

    const row = buildItem(spec, 0, [DEMO_GUILD.id]);

    assert(row.requiredLevel === 1 && row.requiredCp === 0, `${spec.name} reaches the list as level 1`);
    assert(row.enchantName === '' && row.styleName === '', `${spec.name} stays bare otherwise`);
  }

  for (const spec of plainOffers) {
    assert(spec.level === 1, `${spec.name} carries level 1`);
    assert(spec.cp === undefined && spec.enchant === undefined, `${spec.name} carries nothing else`);
    assert(
      buildOffer(spec, 0, [DEMO_GUILD.id]).requiredLevel === 1,
      `${spec.name} reaches the offer list as level 1`
    );
  }

  // And the line a reader gets out of it: a level, the name, and no glyph made up to fill
  // the space beside it.
  const frame = ITEMS.find((spec) => spec.name === 'Dwemer Frame');
  const row = buildItem(frame, 0, [DEMO_GUILD.id]);
  const html = inventoryTable(
    [
      {
        ...row,
        // The list reads the row a query hands it, which is snake_case.
        item_name: row.itemName,
        item_count: row.itemCount,
        item_key_hash: 'demo-plain',
        guild_names: DEMO_GUILD.name,
        required_level: row.requiredLevel,
        required_cp: row.requiredCp,
        enchant_name: row.enchantName,
        style_name: row.styleName,
      },
    ],
    { mine: false, filters: {} }
  );

  assertMatch(html, /Level 1/, 'the row says it is level 1');
  assertMatch(html, /Dwemer Frame/, 'and still names the item');
  assert(!html.includes('Glyph'), 'with no glyph invented for it');
});

// ------------------------------------------------------------------ what is refused
check('a demo session may rehearse everything except uploads and password resets', () => {
  const refused = [
    ['POST', '/upload'],
    ['POST', '/auth/email/forgot'],
    ['POST', '/auth/email/reset/abc123'],
    ['POST', '/simulate/nudge'],
  ];

  for (const [method, path] of refused) {
    assert(demoRefusal(method, path), `${method} ${path} must be refused`);
  }

  const allowed = [
    ['POST', '/requests'],
    ['POST', '/requests/submit'],
    ['POST', '/requests/41/cancel'],
    ['POST', '/accounts/add'],
    ['POST', '/accounts/remove'],
    ['POST', '/browsing-account'],
    ['POST', '/owner/requests'],
    ['POST', '/logout'],
    ['POST', '/auth/email'],
    ['GET', '/upload'],
  ];

  for (const [method, path] of allowed) {
    assert(!demoRefusal(method, path), `${method} ${path} must be allowed inside the demo copy`);
  }
});

check('each refusal says what it is about', () => {
  assertMatch(demoRefusalMessage('/upload'), /switched off/i, 'the upload refusal must say so');
  assertMatch(
    demoRefusalMessage('/auth/email/forgot'),
    /reset link/i,
    'the reset refusal must say no link is sent'
  );
});

// ----------------------------------------------------------------------- seeding
await checkAsync('a fresh database gets the demo person, account, guild and items', async () => {
  const connection = fakeConnection();
  const result = await ensureDemoData(connection);

  assert(result.created, 'the person should have been created');
  assert(result.seeded, 'the items should have been written');
  assert(result.userId === 7, `expected user 7, got ${result.userId}`);

  const userInsert = connection.calls(/INSERT INTO guildsbounty_users/)[0];
  assert(userInsert, 'no user row was written');
  assertMatch(
    userInsert.sql,
    /is_demo\)\s*VALUES \(\?, \?, 0, 1\)/s,
    'the person must be written with is_demo = 1'
  );

  const identity = connection.calls(/INSERT INTO guildsbounty_user_identities/)[0];
  assert(identity, 'no sign-in identity was written');
  assert(
    identity.params[0] === DEMO_LOGIN,
    `identity should be ${DEMO_LOGIN}, got ${identity.params[0]}`
  );

  const account = connection.calls(/INSERT INTO guildsbounty_accounts/)[0];
  assert(account, 'the ESO account was never linked to the demo person');
  assert(account.params.includes(DEMO_ACCOUNT), 'the link must name the demo account');
  assert(account.params.includes(2), 'the platform must travel with the account');
  assert(account.params.includes('NA Megaserver'), 'the world must travel with the account');

  const guild = connection.calls(/INSERT INTO guildsbounty_guilds/)[0];
  assert(guild, 'the guild was never written');
  assert(guild.params.includes('Alphabet Mafia'), 'the guild name must be Alphabet Mafia');
  assert(guild.params.includes(2) && guild.params.includes('NA Megaserver'), 'the guild needs its world');
});

await checkAsync('an existing demo person is not rewritten on every visit', async () => {
  const connection = fakeConnection({ userRow: { id: 42 }, sharedCount: 9 });
  const result = await ensureDemoData(connection);

  assert(result.userId === 42, 'the existing person should be reused');
  assert(!result.created, 'nobody should be created twice');
  assert(!result.seeded, 'existing items must be left alone');
  assert(
    connection
      .calls(/INSERT INTO guildsbounty_users/)
      .filter((call) => call.params.includes(DEMO_EMAIL)).length === 0,
    'no second demo person'
  );
  assert(connection.calls(/INSERT INTO guildsbounty_shared_items/).length === 0, 'no rewrite');
});

// --------------------------------------------------------------------- the copy
await checkAsync('the demo copy is filled from the site, with people anonymised', async () => {
  const statements = [];

  const connection = {
    async query(sql) {
      statements.push(sql);

      if (/^SHOW TABLES FROM/.test(sql)) {
        return [
          [
            { 'Tables_in_guildsbounty': 'guildsbounty_users' },
            { 'Tables_in_guildsbounty': 'guildsbounty_shared_items' },
            { 'Tables_in_guildsbounty': 'guildsbounty_sessions' },
            { 'Tables_in_guildsbounty': 'guildsbounty_schema_migrations' },
          ],
          {},
        ];
      }

      return [[], {}];
    },
  };

  const result = await copyDemoData(connection, { sourceDatabase: 'guildsbounty' });
  const sql = statements.join('\n');

  assert(result.copied === 2, `expected 2 tables copied, got ${result.copied}`);
  assert(result.failed.length === 0, 'nothing should have failed');
  assertMatch(
    sql,
    /INSERT INTO `guildsbounty-demo`\.`guildsbounty_users` SELECT \* FROM `guildsbounty`\.`guildsbounty_users`/,
    'the people must be copied across'
  );
  assert(!sql.includes('guildsbounty_sessions'), 'sessions must never be copied');
  assert(!sql.includes('guildsbounty_schema_migrations'), 'the demo keeps its own migration ledger');
  assert(sql.includes('SET SESSION FOREIGN_KEY_CHECKS = 0'), 'foreign keys must be off while copying');
  assertMatch(sql, /UPDATE `guildsbounty-demo`\.guildsbounty_users[\s\S]*Member /, 'people must be renamed');
  assert(sql.includes('DELETE FROM `guildsbounty-demo`.guildsbounty_passwords'), 'copied passwords must go');
  assert(
    sql.includes('DELETE FROM `guildsbounty-demo`.guildsbounty_user_identities'),
    'copied sign-ins must go'
  );
});

await checkAsync('one damaged table does not cost the rest of the copy', async () => {
  const connection = {
    async query(sql) {
      if (/^SHOW TABLES FROM/.test(sql)) {
        return [
          [
            { 'Tables_in_guildsbounty': 'guildsbounty_users' },
            { 'Tables_in_guildsbounty': 'guildsbounty_requests' },
          ],
          {},
        ];
      }

      if (sql.includes('`guildsbounty_requests`')) {
        throw new Error('Table is damaged');
      }

      return [[], {}];
    },
  };

  const result = await copyDemoData(connection, { sourceDatabase: 'guildsbounty' });

  assert(result.copied === 1, `expected 1 table copied, got ${result.copied}`);
  assert(
    result.failed.length === 1 && result.failed[0].table === 'guildsbounty_requests',
    'the failing table must be reported'
  );
  assert(result.failed[0].error === 'Table is damaged', 'the reason must travel with it');
});

// ------------------------------------------------------------------- the sign-in
await checkAsync('the demo signs in as a person marked demo', async () => {
  const connection = {
    async execute() {
      return [
        [
          {
            id: 42,
            display_name: 'Demo',
            email: 'demo@example.com',
            password_hash: 'scrypt$1$2$3$abc$def',
            is_demo: 1,
          },
        ],
      ];
    },
  };

  const login = await findDemoSignIn(connection);

  assert(login, 'the demo sign-in was not found');
  assert(login.userId === 42, `expected 42, got ${login.userId}`);
  assert(login.isDemo === true, 'isDemo must be true for the demo person');
});

// ------------------------------------------------------------------------ the views
const providers = [
  { key: 'discord', label: 'Discord' },
  { key: 'google', label: 'Google' },
];

const emptyData = {
  user: null,
  providers,
  accounts: [],
  browsingAccount: '',
  sharedItems: [],
  requestItems: [],
  alwaysShare: [],
  requestOffers: [],
  facets: { types: [], owners: [] },
  filters: {},
  requests: [],
  basket: { count: 0, quantity: 0, secondsLeft: 0, holdMinutes: 5 },
  basketRows: [],
  dbError: null,
};

check('a visitor is shown the three ways in and no items', () => {
  const page = renderSignInPage({ providers });

  assertMatch(page, /Sign in with Discord/, 'Discord sign-in is missing');
  assertMatch(page, /Sign in with Google/, 'Google sign-in is missing');
  assertMatch(page, /action="\/auth\/email"/, 'the email and password form is missing');
  assertMatch(page, /demo@perdues\.me/, 'the demo sign-in is not mentioned');
  assertMatch(page, /password\s*<strong>demo@perdues\.me<\/strong>/, 'the demo password is not mentioned');
  assert(!page.includes('data-item-key'), 'no item may be rendered to a visitor');
});

check('the demo pair is boxed rather than another grey hint', () => {
  const page = renderSignInPage({ providers });

  assertMatch(page, /class="demo-callout"/, 'the demo sign-in must be its own box');
  assertMatch(page, /class="demo-callout-body"/, 'the box must carry the explanation');
  assertMatch(page, /demo@perdues\.me/, 'the demo address must still be in it');
  assertMatch(page, /<strong>demo@perdues\.me<\/strong>/, 'the demo password must still be in it');
});

check('the brand is one picture of the whole lockup', () => {
  const page = renderSignInPage({ providers });
  const header = page.slice(page.indexOf('<header class="top-bar">'), page.indexOf('</header>'));

  assert(header.includes('class="brand-logo"'), 'the header must draw the plaque');
  assert(
    header.includes('src="/brand/GuildsBounty-Both.png"'),
    'the plaque is the one picture file, holding the chest, the name and the line'
  );
  assert(
    header.includes('width="1752"') && header.includes('height="897"'),
    'the picture must declare its size so the bar can grow to it'
  );
  assert(
    header.includes('alt="Guild\'s Bounty - shared items across your guilds"'),
    'the picture must carry the name and the line for a reader who cannot see it'
  );
  assert(!header.includes('class="brand-mark"'), 'the mark is no longer a picture of its own');
  assert(!header.includes('class="brand-wordmark"'), 'the name is no longer a separate picture');
  assert(!header.includes('class="brand-subtitle"'), 'the line is part of the picture now');
  assert(!header.includes('<svg'), 'the artwork must be the file, not a picture pasted into the page');
});

check('the browsing-as label carries a real middle dot, not its escaped entity', () => {
  const page = renderPage({
    ...emptyData,
    user: { id: 5, username: 'someone', provider: 'password' },
    accounts: [
      {
        accountName: DEMO_ACCOUNT,
        itemCount: 2,
        guildCount: 1,
        guilds: [{}],
        platform: 2,
        worldName: 'NA Megaserver',
      },
    ],
  });

  assert(page.includes('Browsing as'), 'the picker must say which account is being browsed as');
  assert(page.includes('PC \u00b7 NA Megaserver'), 'the label must use a real middle dot');
  assert(!page.includes('&amp;middot;'), 'the entity must not reach the reader escaped');
});

check('the addon links live in the header, once, signed out and signed in', () => {
  const demoPage = renderPage({
    ...emptyData,
    user: { id: 42, username: 'Demo', provider: 'password', isDemo: true },
    accounts: [{ accountName: DEMO_ACCOUNT, itemCount: 9, guildCount: 1, guilds: [] }],
  });
  const uploadGate = renderPage({
    ...emptyData,
    user: { id: 5, username: 'someone', provider: 'password' },
    accounts: [],
  });

  for (const [name, page] of [
    ['sign-in', renderSignInPage({ providers })],
    ['demo', demoPage],
    ['upload gate', uploadGate],
  ]) {
    const copies = (page.match(/class="addon-download"/g) || []).length;

    assert(copies === 1, `${name}: expected the addon line once, found ${copies}`);

    const header = page.slice(
      page.indexOf('<header class="top-bar">'),
      page.indexOf('</header>') + '</header>'.length
    );

    assert(header.includes('esoui.com/downloads/dl4533'), `${name}: the addon must sit in the top bar`);
    assert(!header.includes('www.minion.gg'), `${name}: the Minion link is gone`);
    assert(!/downloads\/info\d+\.html/.test(page), `${name}: the ESOUI page link is gone`);

    // Brand and addon line share one left-hand group, so the line sits in the same place
    // whether or not somebody is signed in and whatever width the account area takes.
    const brandAt = header.indexOf('class="brand"');
    const addonAt = header.indexOf('class="addon-download"');

    assert(header.includes('class="top-bar-left"'), `${name}: the left-hand group must exist`);
    assert(brandAt !== -1 && addonAt > brandAt, `${name}: the addon line must sit beside the brand`);

    // The demo banner used to carry its own copy, which is how the same box appeared
    // twice on one screen.
    const banner = page.slice(page.indexOf('Demo mode'), page.indexOf('Your ESO accounts'));
    assert(!banner.includes('addon-downloads'), `${name}: the demo banner must not repeat it`);
  }
});

check('the demo lets go of asks nobody was going to answer', () => {
  const sql = abandonedAsksSql(3);

  assert(sql.includes("status = 'pending'"), 'only a request still standing can be released');
  assert(
    /requester_account_name IN \(\?, \?, \?\)/.test(sql),
    "only the guildmates' asks are released, never the visitor's own"
  );
  assert(sql.includes('submitted_at < ?'), 'an ask still being filled is left alone');
  assert(/status_reason = \?/.test(sql), 'the release says why, so the history reads properly');
  assert(DEMO_ASK_TTL_MS === 120000, `two minutes, not ${DEMO_ASK_TTL_MS}`);
});

check('a demo restock runs at most every few minutes', () => {
  assert(shouldRestock(0, 5000), 'the first call always runs');
  assert(!shouldRestock(1000, 1000 + DEMO_RESTOCK_MS - 1), 'never twice inside the window');
  assert(shouldRestock(1000, 1000 + DEMO_RESTOCK_MS), 'once the window is up it runs again');
  assert(
    DEMO_RESTOCK_MS === 3 * 60 * 1000,
    `three minutes, not ${DEMO_RESTOCK_MS}: a restock puts every count back, so doing it often is visible`
  );
});

check('every line the site prints carries the time it happened', () => {
  const fixed = stamp(new Date(2026, 10, 9, 5, 2, 3));

  assert(fixed === '2026-11-09 05:02:03', `expected 2026-11-09 05:02:03, got "${fixed}"`);
  assert(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp()),
    'a stamp is a date and a time, to the second'
  );
});

check('a fresh shelf is dated across a spread rather than all today', () => {
  const three = planAges(3);

  assert(three.length === 3, 'one age per row');
  assert(three[0] === AGE_HOURS[0], 'the first row gets the oldest age');
  assert(three[2] === AGE_HOURS[AGE_HOURS.length - 1], 'the last row gets the newest age');
  assert(three[0] > three[1] && three[1] > three[2], 'the ages descend');
  assert(planAges(0).length === 0, 'nothing to date is no plan');

  const many = planAges(20);

  assert(many.length === 20, 'every row gets an age');
  assert(
    many.every((hours) => AGE_HOURS.includes(hours)),
    'every age is one the ladder knows, so a fresh database always looks the same'
  );
});

// LAST CHANCE only exists on a shelf whose owner carries expireDays, so a demo without one
// can never show the pill however old its rows are. The window is also what decides how
// many rows carry it: a window of nothing flags none, one shorter than every age flags all
// of them, and neither shows the difference the pill is supposed to make.
check('the demo shelf carries a window, so LAST CHANCE has something to flag', () => {
  assert(DEMO_EXPIRE_DAYS > 0, 'a window of 0 would never flag a row');

  const agesInDays = planAges(ITEMS.length).map((hours) => hours / 24);

  assert(
    agesInDays.some((days) => days >= DEMO_EXPIRE_DAYS),
    'at least one demo row is past the window, or no pill is ever drawn'
  );
  assert(
    agesInDays.some((days) => days < DEMO_EXPIRE_DAYS),
    'and at least one is inside it, or the pill would be on every row'
  );

  const guilds = new Map([[DEMO_GUILD.id, DEMO_GUILD.name]]);

  assert(
    castAccount(DEMO_CAST[0], guilds).expireDays === DEMO_EXPIRE_DAYS,
    'the guildmates share under the same window, so the pill is not only on the visitor\u2019s own rows'
  );
});

check('only rows nobody has touched since they were inserted are dated', () => {
  const sql = untouchedRowsSql('guildsbounty_shared_items');

  assert(sql.includes('first_seen_at = last_seen_at'), 'a re-saved row must keep its first date');
  assert(/ORDER BY item_name/.test(sql), 'the same item lands on the same rung every time');

  let refused = false;

  try {
    untouchedRowsSql('guildsbounty_users');
  } catch {
    refused = true;
  }

  assert(refused, 'a table with no living dates must be refused rather than guessed at');
});

check('attaching an ESO account asks for its platform and server, both required', () => {
  const page = renderPage({
    ...emptyData,
    user: { id: 5, username: 'someone', provider: 'password' },
    accounts: [
      {
        accountName: '@someone',
        itemCount: 1,
        guildCount: 1,
        guilds: [],
        // A file has arrived, so the dialog lets this person attach another name by hand.
        lastUpload: { uploaded_at: '2026-11-01 10:00:00', source_file: 'GuildsBountySavedVars.lua' },
      },
    ],
    accountServers: [
      { platform: 2, worldName: 'EU Megaserver' },
      { platform: 2, worldName: 'PTS' },
    ],
  });

  assertMatch(page, /<select name="platform" required>/, 'the platform must be a required choice');
  assertMatch(page, /<select name="worldName" required>/, 'the server must be a required choice');
  assertMatch(page, /<option value="2" selected>PC<\/option>/, 'platform 2 must be the default');
  assert(page.includes('>EU Megaserver<'), 'a server already recorded must be offered');
  assert(page.includes('>PTS<'), 'every recorded server is offered, not only the megaservers');
  assert(page.includes('>NA Megaserver<'), 'the known megaservers are offered before the first upload');
});

check('the attach form refuses a body with no platform or no server', () => {
  const known = serverChoices([]);
  assert(known.platforms.length === 1, 'only PC is known before any upload');
  assert(known.worlds.length === 2, 'the two megaservers are the known worlds');

  const recorded = serverChoices([
    { platform: 2, worldName: 'PTS' },
    { platform: 2, worldName: 'PTS' },
  ]);
  assert(recorded.worlds.filter((world) => world === 'PTS').length === 1, 'a server recorded twice is offered once');

  assert(
    serverLabel(readAccountServer({ platform: '2', worldName: 'NA Megaserver' })) === 'PC \u00b7 NA Megaserver',
    'a complete choice reads back as one label'
  );
  assert(readAccountServer({ worldName: 'NA Megaserver' }) === null, 'a platform is required');
  assert(readAccountServer({ platform: '0', worldName: 'NA Megaserver' }) === null, 'platform 0 means "not on a file yet"');
  assert(readAccountServer({ platform: '2', worldName: '   ' }) === null, 'a server is required');
});

await checkAsync('a name attached from the form is written with its platform and server', async () => {
  const log = [];
  const connection = {
    async execute(sql, params = []) {
      log.push({ sql, params });
      return [[], []];
    },
  };

  const outcome = await linkAccountToUser(connection, {
    accountName: '@new-player',
    userId: 9,
    platform: 2,
    worldName: 'EU Megaserver',
  });

  assert(outcome === 'linked', `expected a new link, got ${outcome}`);

  const insert = log.find((call) => /INSERT INTO guildsbounty_accounts/.test(call.sql));
  assert(insert, 'the account was never written');
  assert(insert.params.includes('EU Megaserver'), 'the server must be written with the name');
  assert(insert.params.includes(2), 'the platform must be written with the name');
  assert(insert.params.includes('@new-player'), 'the name must be written');
});

await checkAsync('re-attaching the demo account keeps the server its file recorded', async () => {
  const log = [];
  const connection = {
    async execute(sql, params = []) {
      log.push({ sql, params });
      if (/SELECT user_id/.test(sql)) {
        return [[{ user_id: 42 }], []];
      }
      return [[], []];
    },
  };

  const outcome = await linkAccountToUser(connection, { accountName: DEMO_ACCOUNT, userId: 42 });
  assert(outcome === 'already-linked', `expected the existing link, got ${outcome}`);

  const update = log.find((call) => /UPDATE guildsbounty_accounts/.test(call.sql));
  assert(update, 'the account was never re-attached');
  assert(!/platform/.test(update.sql), 'with no form behind it there is no platform to write');
});

await checkAsync('the form reads the servers already recorded in the database', async () => {
  const connection = {
    async execute() {
      return [[{ platform: 2, world_name: 'PTS' }, { platform: 2, world_name: 'EU Megaserver' }], []];
    },
  };

  const rows = await listAccountServers(connection);
  assert(rows.length === 2, `expected two recorded servers, got ${rows.length}`);
  assert(rows[0].worldName === 'PTS' && rows[0].platform === 2, 'the row must come back as platform and name');
});

check('a signed-in person with no ESO account is asked to upload', () => {
  const page = renderPage({
    ...emptyData,
    user: { id: 5, username: 'someone', provider: 'password' },
    accounts: [],
  });

  assertMatch(page, /id="savedvars"/, 'the upload field is missing');
  assertMatch(page, /Upload your GuildsBounty\.lua File from your Saved Variables Folder Here/, 'the upload card is missing');
  assert(!page.includes('data-item-key'), 'no item may be listed before an upload');
});

check('the upload page itself carries the drop zone and no list', () => {
  const page = renderUploadPage({ user: { id: 5, username: 'someone' }, providers });

  assertMatch(page, /id="savedvars"/, 'the upload field is missing');
  assert(!page.includes('data-item-key'), 'a list would be a way round the gate');
});

check('a demo session says so, and keeps every tool it can rehearse with', () => {
  const page = renderPage({
    ...emptyData,
    user: { id: 42, username: 'Demo', provider: 'password', isDemo: true },
    accounts: [{ accountName: DEMO_ACCOUNT, itemCount: 9, guildCount: 1, guilds: [] }],
  });

  assertMatch(page, /Demo mode/, 'the banner is missing');
  assertMatch(page, /email (?:is|are) disabled/i, 'the banner must say email is disabled');
  assertMatch(page, /Add or remove ESO accounts/, 'the demo must be able to try the account dialog');
  assertMatch(page, /Requests Received/, 'the demo must be able to try the owner pages');
});

check('an ordinary session shows no demo banner', () => {
  const page = renderPage({
    ...emptyData,
    user: { id: 5, username: 'someone', provider: 'password' },
    accounts: [{ accountName: '@someone', itemCount: 3, guildCount: 1, guilds: [] }],
  });

  assert(!page.includes('Demo mode'), 'the banner must only appear for the demo');
});

check('the demo has a database of its own, apart from the real one', () => {
  assert(DEMO_DATABASE === 'guildsbounty-demo', `expected guildsbounty-demo, got ${DEMO_DATABASE}`);
  assert(DEMO_DATABASE !== 'guildsbounty', 'the demo must not share the real database');
});

check('the demo connection keeps the site settings and swaps only the name', () => {
  const config = demoDatabaseConfig({
    host: 'db.internal',
    port: 3307,
    user: 'guildsbounty',
    password: 'secret',
    database: 'guildsbounty',
  });

  assert(config.database === DEMO_DATABASE, `expected ${DEMO_DATABASE}, got ${config.database}`);
  assert(config.host === 'db.internal' && config.port === 3307, 'the host and port must be kept');
  assert(config.user === 'guildsbounty' && config.password === 'secret', 'the login must be kept');
});

check('the demo database can never be the site database', () => {
  for (const name of ['guildsbounty-demo', 'GuildsBounty-Demo', '']) {
    let refused = false;

    try {
      demoDatabaseConfig({ database: name });
    } catch {
      refused = true;
    }

    assert(refused, `"${name}" must be refused, because the demo copy is dropped at startup`);
  }
});

check('only a demo session is pointed at the demo database', () => {
  assert(databaseForUser({ id: 42, isDemo: true }) === DEMO_DATABASE, 'the demo must read the demo copy');
  assert(databaseForUser({ id: 5, isDemo: false }) === null, 'an ordinary person stays in the real one');
  assert(databaseForUser({ id: 5 }) === null, 'a session without the flag stays in the real one');
  assert(databaseForUser(null) === null, 'a visitor has no demo database to read');
});

check('a demo upload card keeps the drop zone but says uploading is switched off', () => {
  const page = renderPage({
    ...emptyData,
    user: { id: 42, username: 'Demo', provider: 'password', isDemo: true },
    accounts: [{ accountName: DEMO_ACCOUNT, itemCount: 9, guildCount: 1, guilds: [] }],
  });

  assertMatch(page, /id="savedvars"/, 'the demo should still see the drop zone');
  assertMatch(page, /id="demoUploadNotice"/, 'the upload restriction is not explained');
  assertMatch(page, /switched off/i, 'the notice must say uploading is switched off');
  assertMatch(page, /sign in as yourself/i, 'the notice must say how to upload for real');
});

check('an ordinary upload card carries no demo restriction', () => {
  const page = renderPage({
    ...emptyData,
    user: { id: 5, username: 'someone', provider: 'password' },
    accounts: [{ accountName: '@someone', itemCount: 3, guildCount: 1, guilds: [] }],
  });

  assert(!page.includes('demoUploadNotice'), 'only a demo may be told uploading is off');
});

// --------------------------------------------------------------------- the cast
check('the demo guild has other people to ask, and none of them is the demo', () => {
  assert(DEMO_CAST.length >= 3, `expected at least three guildmates, got ${DEMO_CAST.length}`);

  const accounts = DEMO_CAST.map((person) => person.account);
  assert(new Set(accounts).size === accounts.length, 'each guildmate is a separate account');
  assert(!accounts.includes(DEMO_ACCOUNT), 'the demo account itself cannot be a guildmate');

  for (const person of DEMO_CAST) {
    const { items } = castCatalogue(person);
    assert(items.length > 0, `${person.account} shares nothing, so nobody can ask them`);
    assert(
      items.every((item) => item && item.name && item.qualityName),
      `${person.account} has a catalogue entry that is not an item`
    );
    assert(
      /@demo-cast\.invalid$/.test(castEmail(person.account)),
      `${person.account} needs an address that cannot receive mail`
    );
  }
});

await checkAsync('the cast is written into the demo guild through the upload path', async () => {
  const connection = fakeConnection();
  const result = await ensureDemoCast(connection, {
    guildId: DEMO_GUILD.id,
    guildName: DEMO_GUILD.name,
    platform: DEMO_WORLD.platform,
    worldName: DEMO_WORLD.worldName,
  });

  assert(
    result.seeded.length === DEMO_CAST.length,
    `expected ${DEMO_CAST.length} seeded, got ${result.seeded.length}`
  );

  const shared = connection.calls(/INSERT INTO guildsbounty_shared_items/);
  assert(shared.length >= DEMO_CAST.length, 'every guildmate must share at least one item');

  const written = JSON.stringify(shared.map((call) => call.params));
  assert(written.includes('@NightMarket'), 'the guildmates\u2019 items must name their account');

  const links = connection.calls(/INSERT IGNORE INTO guildsbounty_shared_item_guilds/);
  assert(links.length >= DEMO_CAST.length, 'every shared item must carry its guild link');
  assert(
    links.some((call) => call.params.includes(DEMO_GUILD.id)),
    'the items must be offered to the demo guild'
  );

  const identities = connection.calls(/INSERT INTO guildsbounty_user_identities/);
  assert(
    identities.some((call) => call.params.includes('demo-cast')),
    'a guildmate needs a person row of its own, kept apart from real sign-ins'
  );
});

await checkAsync('a guildmate who already shares is left alone', async () => {
  const connection = fakeConnection({ sharedCount: 3 });
  const result = await ensureDemoCast(connection, { guildId: DEMO_GUILD.id });

  assert(result.seeded.length === 0, 'nothing should be written again');
  assert(result.kept.length === DEMO_CAST.length, 'every guildmate is already there');
  assert(
    connection.calls(/INSERT INTO guildsbounty_shared_items/).length === 0,
    'an existing shelf must not be rewritten on every boot'
  );
});

// ----------------------------------------------------------------- the activity

/**
 * A draw that lands in the middle of the shelf change's slice of the rotation.
 *
 * A test that wants one scenario has to ask for that scenario's slice: the value that used
 * to mean "the last one" means a different thing as soon as another action is added.
 */
function stockDraw() {
  const index = DEMO_ACTIVITY_SCENARIOS.indexOf('stock');
  return (index + 0.5) / DEMO_ACTIVITY_SCENARIOS.length;
}

check('every action is reachable, and a request is seen from both sides', () => {
  // One draw from the middle of each scenario's slice of the range, so a scenario added to the
  // rotation has to be reachable here as well.
  const seen = new Set(
    DEMO_ACTIVITY_SCENARIOS.map((_name, index) =>
      pickScenario(() => (index + 0.5) / DEMO_ACTIVITY_SCENARIOS.length)
    )
  );

  assert(seen.size === DEMO_ACTIVITY_SCENARIOS.length, `expected every scenario, got ${[...seen]}`);
  assert(seen.has('ask') && seen.has('answer'), 'asking and answering must both happen');
  assert(seen.has('stock'), 'and a shelf has to be able to change under a watching page');
});

check('a guildmate sometimes gains a piece and sometimes loses one', () => {
  const gained = shelfChange([], { random: () => 0 });
  assert(gained && gained.add, 'a shelf with nothing on it takes a piece');

  const lost = shelfChange([0, 1, 2], { random: () => 0.9 });
  assert(lost && lost.add === false, 'a shelf with pieces to spare can let one go');
  assert([0, 1, 2].includes(lost.index), 'the piece that goes is one it was sharing');

  assert(
    shelfChange([0, 1], { random: () => 0.9 }) === null,
    'a shelf is never taken below two pieces, so the demo cannot run itself empty'
  );
  const everything = ITEMS.map((_item, index) => index);
  const fromFull = shelfChange(everything, { random: () => 0.9 });

  assert(
    fromFull && fromFull.add === false,
    'a shelf holding the whole catalogue cannot add, so it lets a piece go instead'
  );
});

check('a guildmate sometimes sends nothing back, and sometimes sends short', () => {
  assert(demoAnswerAmount(2, { random: () => 0 }) === 0, 'the low third is a refusal');
  assert(demoAnswerAmount(2, { random: () => 0.5 }) === 1, 'the middle third is one short');
  assert(demoAnswerAmount(2, { random: () => 0.9 }) === 2, 'the rest hands over the whole ask');
  assert(demoAnswerAmount(0, { random: () => 0.9 }) === 1, 'an ask with no number is one copy');
  assert(demoAnswerAmount('3', { random: () => 0.9 }) === 3, 'and a posted number is read');

  // One copy cannot be sent short: "0 of 1" is a refusal, and a handover of none is not one.
  assert(demoAnswerAmount(1, { random: () => 0.5 }) === 1, 'a single copy is still handed over');
  assert(demoAnswerAmount(10, { random: () => 0.5 }) === 9, 'a stack of ten arrives as nine');

  // All three answers, inside one wheel: each has to turn up in an afternoon of the demo.
  const answers = [0, 0.2, 0.5, 0.8, 0.99].map((value) =>
    demoAnswerAmount(2, { random: () => value })
  );

  assert(answers.includes(0), 'a refusal happens');
  assert(answers.includes(1), 'and so does a handover one short');
  assert(answers.includes(2), 'and the whole ask');
});

await checkAsync('a shelf that changes is written the way a file is written', async () => {
  const connection = fakeConnection();
  // Drawn from the middle of the shelf change's slice of the rotation, and past the halfway
  // point so the change is a piece going rather than another arriving: a guildmate holding
  // three pieces has one to let go of.
  const outcome = await runDemoActivity(connection, {
    cast: [{ account: '@SomebodyElse', character: 'Somebody-Else', items: [0, 1, 2], offers: [] }],
    random: () => stockDraw(),
  });

  assert(
    outcome && outcome.kind === 'stock',
    `expected a shelf change, got ${outcome && outcome.kind}`
  );
  assert(
    connection.calls(/INSERT INTO guildsbounty_shared_items/).length > 0,
    'the piece goes in through replaceAccounts, the call an upload makes'
  );
  assert(
    connection.calls(/DELETE FROM guildsbounty_shared_items/).length > 0,
    'and the shelf is pruned by the same call, so a piece that left really leaves the list'
  );
  assert(
    /put|let/.test(outcome.summary),
    `the summary should say what moved, got "${outcome.summary}"`
  );
});

await checkAsync('the piece that leaves is the one the message names', async () => {
  // The piece that can empty its type out of the menus sits first on the shelf, so "the last
  // piece on the shelf" and "the piece the message names" are different answers here.
  const first = ITEMS.findIndex((spec, index) =>
    ITEMS.some((other, otherIndex) => otherIndex !== index && other.typeName === spec.typeName)
  );
  const twin = ITEMS.findIndex(
    (spec, index) => index !== first && spec.typeName === ITEMS[first].typeName
  );
  const alone = ITEMS.findIndex(
    (spec, index) => index !== first && index !== twin && spec.typeName !== ITEMS[first].typeName
  );

  assert(alone > -1 && twin > -1 && first > -1, 'MISSING ANCHOR: three catalogue pieces, two of a type');

  const shelf = [alone, first, twin];
  const connection = fakeConnection();
  const outcome = await runDemoActivity(connection, {
    cast: [{ account: '@SomebodyElse', character: 'Somebody-Else', items: shelf, offers: [] }],
    random: () => stockDraw(),
  });

  assert(
    outcome && outcome.kind === 'stock',
    `expected a shelf change, got ${outcome && outcome.kind}`
  );
  assert(
    outcome.summary.includes(ITEMS[alone].name),
    `the message should name ${ITEMS[alone].name}, got "${outcome.summary}"`
  );

  const written = connection
    .calls(/INSERT INTO guildsbounty_shared_items/)
    .map((call) => call.params.join('|'))
    .join('\n');

  assert(!written.includes(ITEMS[alone].name), 'the piece the message names is not written back');
  assert(written.includes(ITEMS[twin].name), 'and the pieces behind it on the shelf stay');
});

// What the answer scenario reads: one ask waiting on a guildmate's shelf, aimed at the demo
// account. `random` is spent in a fixed order - the person, the scenario, then the amount - so
// a run of it can be scripted.
const sequence = (values) => () => (values.length > 0 ? values.shift() : 0);

const pendingAsk = (asked) => [
  {
    id: 31,
    item_kind: 'inventory',
    item_name: ITEMS[0].name,
    item_id: 1001,
    icon_key: '',
    quality: ITEMS[0].quality,
    item_type_name: ITEMS[0].typeName,
    trait: '',
    enchant_name: '',
    style_name: '',
    required_level: 0,
    required_cp: 0,
    location_label: 'Bank',
    owner_account_name: '@SomebodyElse',
    requester_account_name: DEMO_ACCOUNT,
    quantity: asked,
    quantity_requested: asked,
    submitted_at: '2026-11-10T10:00:00Z',
  },
];

await checkAsync('once in three the guildmate has nothing to send, and the ask is cancelled', async () => {
  const connection = fakeConnection({ pendingRows: pendingAsk(2) });
  const outcome = await runDemoActivity(connection, {
    cast: [
      { userId: 5, account: '@SomebodyElse', character: 'Somebody-Else', items: [], offers: [] },
    ],
    random: sequence([0, 0, 0]),
  });

  assert(outcome && outcome.kind === 'answer', `expected an answer, got ${outcome && outcome.kind}`);
  assert(
    /nothing to send/.test(outcome.summary),
    `the message should say nothing was sent, got "${outcome.summary}"`
  );

  const cancelled = connection.calls(/SET status = 'cancelled'/);

  assert(cancelled.length === 1, `expected one cancellation, got ${cancelled.length}`);
  assert(/quantity = 0/.test(cancelled[0].sql), 'and nothing recorded as sent');
  assert(
    connection.calls(/SET status = 'fulfilled'/).length === 0,
    'nothing may be handed over on that answer'
  );
});

await checkAsync('once in three it is one short, and the row reads 1 of 2', async () => {
  const connection = fakeConnection({ pendingRows: pendingAsk(2) });
  const outcome = await runDemoActivity(connection, {
    cast: [
      { userId: 5, account: '@SomebodyElse', character: 'Somebody-Else', items: [], offers: [] },
    ],
    random: sequence([0, 0, 0.5]),
  });

  assert(outcome && outcome.kind === 'answer', `expected an answer, got ${outcome && outcome.kind}`);
  assert(/1 copy/.test(outcome.summary), `the message should say one copy, got "${outcome.summary}"`);

  const fulfilled = connection.calls(/SET status = 'fulfilled'/);
  const [, sent, asked, reason] = [null, ...fulfilled[0].params];

  assert(Number(sent) === 1 && Number(asked) === 2, `expected 1 of 2, got ${sent} of ${asked}`);
  assert(reason === '1 of 2 sent', `the row carries the short handover, got "${reason}"`);
});

await checkAsync('and the rest of the time the whole ask is handed over', async () => {
  const connection = fakeConnection({ pendingRows: pendingAsk(2) });
  const outcome = await runDemoActivity(connection, {
    cast: [
      { userId: 5, account: '@SomebodyElse', character: 'Somebody-Else', items: [], offers: [] },
    ],
    random: sequence([0, 0, 0.9]),
  });

  assert(outcome && outcome.kind === 'answer', `expected an answer, got ${outcome && outcome.kind}`);
  assert(/2 copies/.test(outcome.summary), `expected two copies, got "${outcome.summary}"`);

  const fulfilled = connection.calls(/SET status = 'fulfilled'/);

  assert(fulfilled.length === 1, `expected one handover, got ${fulfilled.length}`);
  assert(Number(fulfilled[0].params[0]) === 2, 'two copies, which is what was asked for');
});

check('a piece leaving is the last of its type when there is one', () => {
  // Two pieces of one type and a third of another, so only the third can empty a type out of
  // the menus. It is first on the shelf, so "the last piece" and "the last of its type" give
  // different answers - and the second is the one that shows an open page the change.
  const first = ITEMS.findIndex((spec, index) =>
    ITEMS.some((other, otherIndex) => otherIndex !== index && other.typeName === spec.typeName)
  );
  const twin = ITEMS.findIndex(
    (spec, index) => index !== first && spec.typeName === ITEMS[first].typeName
  );
  const alone = ITEMS.findIndex(
    (spec, index) => index !== first && index !== twin && spec.typeName !== ITEMS[first].typeName
  );

  assert(
    first > -1 && twin > -1 && alone > -1,
    'MISSING ANCHOR: three catalogue pieces, two of a type and one of another'
  );

  const shelf = [alone, first, twin];
  const change = shelfChange(shelf, {
    cast: [{ account: '@Somebody', items: shelf }],
    random: () => 0.9,
  });

  assert(change && change.add === false, 'the shelf lets a piece go');
  assert(change.index === alone, 'and it is the piece whose type nobody else shares');
});

check('a piece arriving prefers a type nobody is sharing yet', () => {
  const shared = 'Weapon';
  const onShelf = ITEMS.findIndex((item) => item.typeName === shared);
  const candidate = ITEMS.findIndex((item, index) => index !== onShelf && item.typeName !== shared);

  assert(onShelf > -1 && candidate > -1, 'MISSING ANCHOR: two catalogue pieces of different types');

  const change = shelfChange([], {
    cast: [{ account: '@Somebody', items: [onShelf] }],
    random: () => 0,
  });

  assert(change && change.add, 'the shelf takes a piece');
  assert(
    ITEMS[change.index].typeName !== shared,
    `expected a type that is not shared yet, got ${ITEMS[change.index].typeName}`
  );
});

check('the pause between actions is drawn fresh rather than fixed', () => {
  const shortest = demoActivityPause(45000, () => 0);
  const longest = demoActivityPause(45000, () => 1);

  assert(shortest === 27000, `expected 60% of the base, got ${shortest}`);
  assert(longest === 63000, `expected 140% of the base, got ${longest}`);
  assert(
    shortest !== longest && demoActivityPause(45000, () => 0.5) === 45000,
    'each action must wait a random time, with the configured interval as the average'
  );
  assert(demoActivityPause(0) === 0, '0 means no activity at all');
});

check('the demo acts about once a minute rather than every quarter of one', () => {
  const server = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const block = server.slice(
    server.indexOf('const DEMO_ACTIVITY_MS'),
    server.indexOf('let demoActivityBusy')
  );

  assert(
    /DEMO_ACTIVITY_MS \?\? 45000/.test(block) && /return 45000;/.test(block),
    '45s by default, because every action but one moves a quantity somebody may be reading'
  );
  assert(!/15000/.test(block), 'and not the fifteen seconds that made the board churn');
});

check('a demo page counts as watching until it goes quiet', () => {
  const viewers = new Map();
  noteViewer(viewers, 'a', 1000);
  noteViewer(viewers, 'b', 1000);

  assert(activeDemoViewers(viewers, 1000 + DEMO_VIEWER_TTL_MS) === 2, 'a live page is counted');
  assert(
    activeDemoViewers(viewers, 1000 + DEMO_VIEWER_TTL_MS + 1) === 0,
    'a silent page must stop the activity'
  );
  assert(viewers.size === 0, 'the silent page must be forgotten, not counted for ever');
});

check('the heartbeat a demo page sends is not one of the refusals', () => {
  assert(
    !demoRefusal('POST', '/demo/heartbeat'),
    'the page must be able to say it is still open'
  );
});

check('an ESO account says which platform and server it lives on', () => {
  assert(platformName(2) === 'PC', `expected PC for platform 2, got "${platformName(2)}"`);
  assert(platformName(0) === '', 'an account with no file behind it has no platform');
  assert(
    platformName(7) === 'platform 7',
    'a platform number this site cannot name is shown as itself, never guessed at'
  );
  assert(
    serverLabel({ platform: 2, worldName: 'NA Megaserver' }) === 'PC \u00b7 NA Megaserver',
    'both halves belong on one line'
  );
  assert(serverLabel({ worldName: 'PTS' }) === 'PTS', 'a world without a platform is still shown');
  assert(serverLabel({ platform: 2 }) === 'PC', 'a platform without a world is still shown');
  assert(serverLabel({}) === '', 'nothing known says nothing');
});

check('the accounts dialog shows the platform and the server beside the name', () => {
  const page = renderPage({
    ...emptyData,
    user: { id: 42, username: 'Demo', provider: 'password', isDemo: true },
    accounts: [
      {
        accountName: DEMO_ACCOUNT,
        itemCount: 9,
        guildCount: 1,
        platform: 2,
        worldName: 'NA Megaserver',
        guilds: [],
      },
    ],
  });

  assertMatch(page, /PC \u00b7 NA Megaserver/, 'the account must name its platform and megaserver');
  assert(page.includes(DEMO_ACCOUNT), 'the account must still be named beside them');
});

check('removing the demo account puts it straight back', () => {
  assert(
    demoRemovalRestores({ isDemo: true }, DEMO_ACCOUNT),
    'the demo account is the one the demo browses as, so it must be restored'
  );
  assert(
    !demoRemovalRestores({ isDemo: true }, '@SomeoneElse'),
    'another account really can be removed in the demo'
  );
  assert(
    !demoRemovalRestores({ isDemo: false }, DEMO_ACCOUNT),
    'an ordinary person keeps the removal they asked for'
  );
  assert(!demoRemovalRestores(null, DEMO_ACCOUNT), 'a visitor has nothing to restore');
});

check('the demo shows its own address as a verified sign-in, like anybody else', () => {
  const demo = emailLine({ id: 42, username: 'Demo', isDemo: true, email: '', emailVerified: false });

  assertMatch(demo, /demo@perdues\.me/, 'the demo address must be shown');
  assertMatch(demo, /\(verified\)/, 'it must read as verified, the way an ordinary sign-in does');
  assert(
    !demo.includes('not shared with this site'),
    'the demo must not look like a provider that withheld its address'
  );

  const provider = emailLine({
    id: 5,
    username: 'someone',
    email: 'them@example.com',
    emailVerified: true,
  });
  assertMatch(provider, /\(verified\)/, 'an ordinary verified address still reads verified');

  const quiet = emailLine({ id: 6, username: 'quiet', email: '', emailVerified: false });
  assertMatch(
    quiet,
    /not shared with this site/,
    'a provider that shares no address must still say so'
  );
});

check('a demo page marks itself so the sandbox knows somebody is watching', () => {
  const demoPage = renderPage({
    ...emptyData,
    user: { id: 42, username: 'Demo', provider: 'password', isDemo: true },
    accounts: [{ accountName: DEMO_ACCOUNT, itemCount: 9, guildCount: 1, guilds: [] }],
  });
  const ordinaryPage = renderPage({
    ...emptyData,
    user: { id: 5, username: 'someone', provider: 'password' },
    accounts: [{ accountName: '@someone', itemCount: 3, guildCount: 1, guilds: [] }],
  });

  assertMatch(demoPage, /<body[^>]*data-demo="1"/, 'the demo page must carry data-demo');
  assert(
    !ordinaryPage.includes('data-demo'),
    'an ordinary page must not keep the sandbox alive'
  );
});

// The refresh scenario: the one upload the demo could not show, where nothing arrives and
// nothing leaves but a stack is re-counted.
const refreshShelf = () => [
  { itemName: 'Soul Gem', itemCount: 3 },
  { itemName: 'Dreugh Wax', itemCount: 1 },
  { itemName: 'Rubedite Ingot', itemCount: 2 },
];

check('a re-saved file moves a stack, up or down, and keeps every piece', () => {
  const shelf = refreshShelf();
  // The stack, then whether it goes down: 3 -> 4, then 1 -> 2.
  const { items, moved } = refreshedShelf(shelf, { random: sequence([0, 0.9, 0.2, 0.9]) });

  assert(items.length === 3, 'nothing is added or removed');
  assert(
    items.map((item) => item.itemName).join(',') === 'Soul Gem,Dreugh Wax,Rubedite Ingot',
    'the same three pieces, in the same order'
  );
  assert(moved.length === 2, 'two stacks re-counted');
  assert(
    moved[0].from === 3 && moved[0].to === 4,
    'the first went up'
  );
  assert(
    moved[1].from === 1 && moved[1].to === 2,
    'and a shelf of single copies only ever grows'
  );
  assert(shelf[0].itemCount === 3, 'the shelf it was given is not written over');

  const down = refreshedShelf(refreshShelf(), { random: sequence([0, 0.1]), moves: 1 });

  assert(down.moved.length === 1, 'one move when only one is asked for');
  assert(down.moved[0].to === 2, 'a stack can also come down');
  // 2 -> 1 is the floor: zero would be the piece leaving the shelf, which is not a refresh.
  const floor = refreshedShelf([{ itemName: 'Ancient Silk', itemCount: 2 }], {
    random: sequence([0, 0.1, 0.1]),
  });

  assert(floor.items[0].itemCount === 1, 'the last copy is never taken');
  assert(
    refreshedShelf([{ itemName: 'Ancient Silk', itemCount: 1 }], {
      random: sequence([0, 0.1]),
    }).items[0].itemCount === 2,
    'and a lone copy is re-counted upwards instead'
  );
});

check('a shelf with nothing on it is a refresh that does nothing', () => {
  const empty = refreshedShelf([]);

  assert(empty.items.length === 0 && empty.moved.length === 0, 'no pieces, no moves, no crash');
  assert(refreshedShelf(null).moved.length === 0, 'and nothing handed in is not a crash either');
});

check('a refresh never counts one row twice', () => {
  for (const pick of [0, 0.3, 0.6, 0.9]) {
    const { moved } = refreshedShelf(refreshShelf(), {
      random: sequence([pick, 0.2, pick, 0.7]),
    });
    const names = moved.map((move) => move.name);

    assert(
      new Set(names).size === names.length,
      `${pick}: two moves are two rows, not one row re-counted`
    );
  }
});

check('the demo says what its guildmates did, in the banner rather than as a toast', () => {
  const app = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const from = app.indexOf("socket.on('items:changed'");
  const handler = app.slice(from, from + 800);
  const views = readFileSync(new URL('./lib/views.js', import.meta.url), 'utf8');

  assert(from > 0, 'the list still listens for a change');
  assertMatch(handler, /payload\.demo/, 'only a push from the demo copy says anything');
  assertMatch(
    handler,
    /querySelector\('\[data-demo-activity\]'\)/,
    'and the sentence goes into the banner'
  );
  assert(
    !/showToast/.test(handler),
    'not into a toast, which would replace whatever the visitor is reading every tick'
  );
  assertMatch(views, /class="demo-activity" data-demo-activity hidden/, 'the banner carries the line');
});

check('the demo re-reads your own file, and that is the only thing it announces', () => {
  const activity = readFileSync(new URL('./lib/demoActivity.js', import.meta.url), 'utf8');
  const server = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const refresh = activity.slice(activity.indexOf('async function refreshMyShelf'));
  const own = demoOwnAccount();

  assert(
    own.accountName === DEMO_ACCOUNT,
    `the file re-saved must be the demo person's, not ${own.accountName}`
  );
  assert(
    own.items.length === ITEMS.length && own.alwaysShare.length === OFFERS.length,
    'the whole catalogue, so the shelf is as full as the seeded one'
  );
  assert(own.expireDays === DEMO_EXPIRE_DAYS, 'and the LAST CHANCE window travels with it');
  assert(
    /kind: 'refresh',\s*mine: true/.test(refresh),
    "the re-save is marked as the visitor's own"
  );

  const tick = server.slice(
    server.indexOf('if (outcome?.activity)'),
    server.indexOf('Demo activity: nothing happened')
  );

  assert(
    /if \(outcome\.activity\.mine\) \{\s*realtime\.notifyDemoChange/.test(tick),
    "only the visitor's own file reaches the page as a message"
  );
  assert(
    !/if \(outcome\?\.activity\) \{\s*realtime\.notifyDemoChange/.test(server),
    "a guildmate's stack moving under the list says nothing - the rows just update"
  );
});

check('the demo guild is described once, not rebuilt by each caller', () => {
  assert(
    DEMO_GUILD_SERVER.id === DEMO_GUILD.id &&
      DEMO_GUILD_SERVER.name === DEMO_GUILD.name &&
      DEMO_GUILD_SERVER.platform === DEMO_WORLD.platform &&
      DEMO_GUILD_SERVER.worldName === DEMO_WORLD.worldName,
    'the shorthand has to say exactly what the guild and its world say'
  );

  for (const file of ['./lib/demoActivity.js', './lib/demoShelf.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');

    assert(
      !/platform: DEMO_WORLD\.platform/.test(source),
      `${file} builds its own copy of the guild instead of using DEMO_GUILD_SERVER`
    );
  }
});

check('a re-count survives the restock that follows it', () => {
  const plain = demoOwnAccount();
  const first = plain.items[0];
  const counted = Math.max(1, Number(first.itemCount) || 1) + 3;
  const kept = demoOwnAccount({ counts: new Map([[hashItemKey(first.itemKey), counted]]) });

  assert(
    kept.items[0].itemCount === counted,
    `the count the file last said has to be written back, got ${kept.items[0].itemCount}`
  );
  assert(
    kept.items[1].itemCount === plain.items[1].itemCount,
    'a row with no stored count still takes the catalogue number'
  );
  assert(kept.items.length === plain.items.length, 'the shelf is neither longer nor shorter');
});

await checkAsync('the restock reads the counts that are already there', async () => {
  const statements = [];
  const connection = {
    async execute(sql, params) {
      statements.push({ sql, params });
      if (/SELECT item_key_hash, item_count/.test(sql)) {
        return [[{ item_key_hash: 'a'.repeat(40), item_count: 4 }], {}];
      }
      return [{ affectedRows: 1 }, {}];
    },
  };

  const counts = await ownShelfCounts(connection, DEMO_ACCOUNT);
  const read = statements[0];

  assert(counts.get('a'.repeat(40)) === 4, 'the stored count is what comes back');
  assert(
    /FROM guildsbounty_shared_items WHERE account_name = \?/.test(read.sql),
    'read from the rows that are about to be rewritten'
  );
  assert(read.params[0] === DEMO_ACCOUNT, "and for the visitor's own account");
});

await checkAsync('the demo history starts with a whole handover, a short one and a refusal', async () => {
  const statements = [];
  const connection = {
    async execute(sql, params) {
      statements.push({ sql, params });
      if (/COUNT\(\*\) AS n FROM guildsbounty_requests/.test(sql)) {
        return [[{ n: 0 }], {}];
      }
      return [{ affectedRows: 1 }, {}];
    },
  };

  const written = await seedDemoRequestHistory(connection, {
    userId: 42,
    demoAccount: DEMO_ACCOUNT,
  });
  const inserts = statements.filter((entry) => /INSERT INTO guildsbounty_requests/.test(entry.sql));

  assert(written === 3 && inserts.length === 3, `expected three rows, got ${written}`);

  const shapes = inserts.map((entry) => ({
    status: entry.params[4],
    sent: entry.params[2],
    asked: entry.params[3],
  }));

  assert(
    shapes.some((shape) => shape.status === 'fulfilled' && shape.sent === shape.asked),
    'a whole handover, so a plain number is on screen from the first page load'
  );
  assert(
    shapes.some((shape) => shape.status === 'fulfilled' && shape.sent < shape.asked),
    'one sent short, so the tab shows "1 of 2"'
  );
  assert(
    shapes.some((shape) => shape.status === 'cancelled' && shape.sent === 0),
    'and one refused, which reads a bare 0'
  );
  assert(
    inserts.every((entry) => entry.params[1] === DEMO_ACCOUNT && entry.params[0] === 42),
    "every row is the visitor's own ask, addressed to the demo person"
  );
  assert(
    inserts.every((entry) => /FROM guildsbounty_shared_items s/.test(entry.sql)),
    'and each borrows a real shared row, so the name and quality are real'
  );

  const guard = {
    async execute(sql) {
      assert(
        !/INSERT INTO guildsbounty_requests/.test(sql),
        'a history that already has rows must not be rewritten'
      );
      return [[{ n: 3 }], {}];
    },
  };

  assert(
    (await seedDemoRequestHistory(guard, { userId: 42, demoAccount: DEMO_ACCOUNT })) === 0,
    'and the second run writes nothing'
  );
});

check("the visitor's own file can also lose a row, and that is announced too", () => {
  const activity = readFileSync(new URL('./lib/demoActivity.js', import.meta.url), 'utf8');
  const lose = activity.slice(
    activity.indexOf('async function loseMyRow'),
    activity.indexOf('The shelf a re-save reports')
  );

  assert(lose.length > 0, 'MISSING ANCHOR: loseMyRow');
  assert(
    /kind: 'stock',\s*mine: true/.test(lose),
    "a row leaving the visitor's own file is their news, like the re-count"
  );
  assert(/removedItems\) > 0/.test(lose), 'and a row the store held back is not announced as lost');
  assert(
    /myStock: \(\) => loseMyRow/.test(activity),
    'the rotation has to include it, or the number is never reached'
  );
  assert(
    DEMO_ACTIVITY_SCENARIOS.filter((name) => name === 'myStock' || name === 'refresh').length === 2,
    "both of the visitor's own actions are in the rotation"
  );
});

check('the pinned header re-measures when its own block wraps', () => {
  const app = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const block = app.slice(
    app.indexOf('new ResizeObserver(measureStickyBars)'),
    app.indexOf("window.addEventListener('resize', measureStickyBars)")
  );

  assert(
    block.includes("'.list-top'"),
    'the block the guild pills sit in has to be watched itself, not only through the page'
  );
  assert(block.includes("'.top-bar'"), 'and the site header that pushes it down');
  assert(
    /observer\.observe\(document\.body\)/.test(block),
    'the body still has to be watched, because the list region is replaced'
  );
});

check('the refresh summary reads exactly like the upload box does', () => {
  // The browser's half of the same sentence, sliced out of the file it actually loads.
  const app = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('// ------------------------------------------------- upload change summary');
  const end = app.indexOf('// ---------------------------------------------- end upload change summary');
  const { uploadChangeSummary } = new Function(
    `${app.slice(start, end)}\nreturn { uploadChangeSummary };`
  )();

  for (const entry of [
    { removedItems: 0, addedItems: 0, refreshedItems: 2 },
    { removedItems: 1, addedItems: 0, refreshedItems: 3 },
    { removedItems: 0, addedItems: 0, refreshedItems: 1 },
    { removedItems: 2, addedItems: 1, refreshedItems: 0 },
    {},
  ]) {
    assert(
      uploadChangeWords(entry) === uploadChangeSummary(entry),
      `${JSON.stringify(entry)}: the demo says what a real upload says`
    );
  }

  assert(
    uploadChangeWords({ removedItems: 0, addedItems: 0, refreshedItems: 2 }) ===
      '0 items removed, 0 items added, 2 items refreshed',
    'and says all three numbers, in the order the page does'
  );
});

console.log('');
console.log(`${passed}/${passed + failed} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
