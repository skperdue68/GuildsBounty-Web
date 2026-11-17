// The Demo sign-in.
//
// It exists so somebody can see what the site looks like with a guild full of items
// without uploading anything or joining a guild. It runs in its own copy of the
// database, filled from the real one, so everything a visitor does there - reserving,
// cancelling, sending a basket, answering a request, adding an account - really
// happens. What cannot happen is anything that would leave the copy: no email, no
// uploaded file, no password reset link.
//
// The account is deliberately not @DemoTrader, which seedDemo.js drops into real
// guilds: those two would otherwise overwrite each other's rows.

import { findPasswordLogin, replaceAccounts } from './store.js';
import { ensureDemoCast } from './demoCast.js';
import { seedDemoRequestHistory } from './demoRequests.js';
import { staggerFirstSeen } from './itemAges.js';
import { hashPassword } from './passwords.js';
import {
  DEMO_EXPIRE_DAYS,
  ITEMS,
  OFFERS,
  buildItem,
  buildOffer,
  iconKind,
} from './demoItems.js';
import { cacheItemIcons } from './icons.js';

/**
 * The address the demo signs in with.
 *
 * A real address on the site's own domain, so the demo is used like any other account -
 * typed into the email box, with a password - rather than needing a magic word there.
 * Nothing is ever delivered to it.
 */
export const DEMO_LOGIN = 'demo@perdues.me';

/**
 * The password, which is the address itself again: one thing to remember for a sign-in that
 * exists only to be tried. Hashed for this identity only.
 */
export const DEMO_PASSWORD = 'demo@perdues.me';

export const DEMO_DISPLAY_NAME = 'Demo';

/**
 * The world the demo guild lives on, named the way the addon names it. It matches the
 * shape of a real world so the server-aware matching in lib/store.js applies unchanged.
 */
export const DEMO_WORLD = { platform: 2, worldName: 'NA Megaserver' };

/** One guild, with an id no real guild can have, so the demo cannot join somebody else's. */
export const DEMO_GUILD = { id: 9900001, name: 'Alphabet Mafia' };

/** The demo guild as the activity and restock code wants it: id and name on its megaserver. */
export const DEMO_GUILD_SERVER = {
  id: DEMO_GUILD.id,
  name: DEMO_GUILD.name,
  ...DEMO_WORLD,
};

/** The ESO account the demo items are shared from. */
export const DEMO_ACCOUNT = '@GuildsBountyDemo';

/** The address on the demo person: the same one that signs in, so the row is coherent. */
export const DEMO_EMAIL = 'demo@perdues.me';

/**
 * The database the demo lives in.
 *
 * Not a filtered view of the real one: its own copy of the same schema, so a demo
 * session can neither see nor touch a real person's rows, and the real database is not
 * opened on its behalf at all. It is dropped and rebuilt from the migrations on every
 * startup, so its schema can never drift from the real one's and the next visitor always
 * gets the curated demo rather than the leftovers of somebody's session. The hyphen is
 * legal in a quoted identifier, which is how lib/database.js creates and selects it.
 */
export const DEMO_DATABASE = 'guildsbounty-demo';

/**
 * The connection settings for the demo database: the site's own, with the name swapped.
 *
 * Refuses to hand back the site database, because the demo copy is dropped and rebuilt
 * at startup and that must never happen to the real rows.
 */
export function demoDatabaseConfig(config) {
  const site = String((config && config.database) || '').toLowerCase();

  if (!site || site === DEMO_DATABASE.toLowerCase()) {
    throw new Error(
      `The demo database (${DEMO_DATABASE}) must be a different database from the site's (${site || 'unset'})`
    );
  }

  return { ...config, database: DEMO_DATABASE };
}

const SAFE_DATABASE_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * Tables the demo copy never takes: its own sessions (a copied one would be a live
 * login), and its own migration ledger (which must stay the demo database's record).
 */
const NEVER_COPIED = new Set(['guildsbounty_sessions', 'guildsbounty_schema_migrations']);

function quoteDatabase(name, label) {
  const text = String(name || '');

  if (!SAFE_DATABASE_NAME.test(text)) {
    throw new Error(`${label} "${text}" is not a valid database name`);
  }

  return `\`${text}\``;
}

/**
 * Fills the freshly rebuilt demo copy with the site's own rows.
 *
 * Without this the demo would hold only the curated guild and could not show what a
 * real site looks like: several guilds, many owners, items that are partly reserved,
 * requests already in flight. The rows are copied table by table with their ids, so
 * the links between them survive, and then the people are anonymised - a visitor with
 * no account must not be able to read anybody's name, address or credentials, and a
 * copied password must not sign in as anybody.
 *
 * Runs only against the demo database, whose rows are about to be thrown away at the
 * next start anyway.
 *
 * @returns {Promise<{copied: number, failed: {table: string, error: string}[]}>}
 */
export async function copyDemoData(
  connection,
  { sourceDatabase, demoDatabase = DEMO_DATABASE } = {}
) {
  const source = quoteDatabase(sourceDatabase, 'The site database');
  const demo = quoteDatabase(demoDatabase, 'The demo database');

  const [tableRows] = await connection.query(`SHOW TABLES FROM ${source}`);
  const tables = tableRows
    .map((row) => String(Object.values(row)[0] || ''))
    .filter((table) => table && !NEVER_COPIED.has(table));

  if (tables.length === 0) {
    return { copied: 0, failed: [] };
  }

  // Rows keep their ids, so a request still points at its item; the order the tables
  // arrive in is not the order their foreign keys want, so the checks are off.
  await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 0');

  const failed = [];

  try {
    for (const table of tables) {
      try {
        await connection.query(
          `INSERT INTO ${demo}.\`${table}\` SELECT * FROM ${source}.\`${table}\``
        );
      } catch (error) {
        // One unreadable table must not cost the whole demo; the rest still copies and
        // the caller logs what failed.
        failed.push({ table, error: error.message });
      }
    }
  } finally {
    await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 1');
  }

  // Who people are is not part of what the demo teaches. Names and addresses become
  // placeholders, and the credentials go entirely: an emptied password table plus
  // emptied identities means no copied row can be signed into.
  await connection.query(
    `UPDATE ${demo}.guildsbounty_users
        SET display_name = CONCAT('Member ', id),
            email = CONCAT('member', id, '@guildsbounty.invalid'),
            email_verified = 0`
  );
  await connection.query(`DELETE FROM ${demo}.guildsbounty_passwords`);
  await connection.query(`DELETE FROM ${demo}.guildsbounty_user_identities`);

  return { copied: tables.length - failed.length, failed };
}

/**
 * Whether removing this account has to put it straight back.
 *
 * The demo can try the accounts dialog for real, including Remove - but the one account
 * it signs in and browses with is @GuildsBountyDemo, and losing it would leave the demo with
 * nothing to ask from. So that removal is a rehearsal too: it happens, and the account is
 * attached again in the same request. Every other account can really be removed.
 */
export function demoRemovalRestores(user, accountName) {
  return Boolean(
    user && user.isDemo && String(accountName || '').trim() === DEMO_ACCOUNT
  );
}

/**
 * Which database a request belongs in, or null for the ordinary one.
 *
 * Kept here, next to the name of the demo database, so the one rule that decides where
 * a request reads and writes can be tested without a server or a MariaDB.
 */
export function databaseForUser(user) {
  return user && user.isDemo ? DEMO_DATABASE : null;
}

/**
 * The little a demo session still may not do.
 *
 * Almost everything is a rehearsal rather than a refusal: the demo runs in its own
 * database, so reserving, cancelling, sending a basket, answering a request and
 * changing accounts all really happen - inside the copy, where nobody else can see
 * them. What has to be stopped is anything that would leave the copy:
 *
 *   /upload                  a real file would replace the demo shelf with somebody's
 *                            own inventory, and the copy is built for a walkthrough
 *   /auth/email/forgot       a reset link is an email, and the demo never sends one
 *   /auth/email/reset/:tok   the same, from the other end of the reset
 *   /simulate                it would tell every open page on the site what the demo did
 *
 * Kept as a plain predicate so the rule can be tested without a server.
 */
export function demoRefusal(method, path) {
  if (String(method || '').toUpperCase() !== 'POST') {
    return false;
  }

  const route = String(path || '');

  return (
    route === '/upload' ||
    route.startsWith('/simulate') ||
    route.startsWith('/auth/email/forgot') ||
    route.startsWith('/auth/email/reset')
  );
}

/** The sentence that explains a refusal, chosen by the route that was refused. */
export function demoRefusalMessage(path) {
  const route = String(path || '');

  if (route === '/upload') {
    return 'Uploading is switched off on a demo account: the demo already has a guild of items, and a file would replace them. Sign in as a non-demo user to upload your own saved variables.';
  }

  if (route.startsWith('/auth/email')) {
    return 'The demo never sends email, so a password reset link cannot be sent. The demo password is always demo.';
  }

  return 'That is not available in the demo.';
}

/**
 * One icon per kind of thing, taken from the live rows this copy was built from.
 *
 * The demo's catalogue is its own invention - its item ids do not belong to the items they name -
 * so asking UESP by id would draw another item's picture (the id it gives for a Dwemer Frame is
 * a tree). The rows copied out of the live database do carry their own icons, and a catalogue
 * row only needs one of its kind to look like a real one: a sword on the sword, a ring on the
 * ring. Ties are broken alphabetically so the same copy always borrows the same picture.
 */
async function liveIconsByKind(connection, { sourceDatabase = '' } = {}) {
  // Both shelves: an item and a standing offer are stored apart, and either can be the only
  // place a kind of thing appears in the live rows.
  //
  // Read from the site's own database when its name is known, not from the demo's copy of it:
  // the copy is only as current as the last rebuild, and a demo database that survived a
  // restart - or one copied before anybody had shared an item - would hand back nothing while
  // the site itself is full of pictures. The copy stays as the fallback, for the sign-in that
  // does not know where the site lives.
  const select = (from) =>
    `SELECT item_type_name, icon, source FROM (
       SELECT item_type_name, icon, 'item' AS source FROM ${from}guildsbounty_shared_items
        WHERE icon <> '' AND item_type_name <> ''
       UNION ALL
       SELECT item_type_name, icon, 'offer' AS source FROM ${from}guildsbounty_always_share
        WHERE icon <> '' AND item_type_name <> ''
     ) AS live
     GROUP BY item_type_name, icon
     ORDER BY item_type_name, icon`;

  let rows = null;
  let source = 'the demo copy';

  if (sourceDatabase) {
    try {
      [rows] = await connection.execute(
        select(`${quoteDatabase(sourceDatabase, 'The site database')}.`)
      );
      source = sourceDatabase;
    } catch {
      // No grant, or the table is not there: the copy is what this database has.
      rows = null;
    }
  }

  if (!rows) {
    [rows] = await connection.execute(select(''));
  }

  const byKind = new Map();

  for (const row of rows) {
    const kind = iconKind(row.item_type_name);
    if (!byKind.has(kind)) {
      byKind.set(kind, row.icon);
    }
  }

  return { byKind, rows: rows.length, source };
}

/** Every icon path the demo's own rows point at, from both shelves. */
async function demoIconPaths(connection) {
  const [rows] = await connection.execute(
    `SELECT DISTINCT icon FROM guildsbounty_shared_items
      WHERE account_name = ? AND icon IS NOT NULL AND icon <> ''
     UNION
     SELECT DISTINCT icon FROM guildsbounty_always_share
      WHERE account_name = ? AND icon IS NOT NULL AND icon <> ''`,
    [DEMO_ACCOUNT, DEMO_ACCOUNT]
  );

  return rows.map((row) => row.icon).filter(Boolean);
}

/**
 * Fills the demo rows that are still blank, and caches the pictures they point at.
 *
 * The first version of this only borrowed pictures while it was writing the catalogue, so a
 * demo built before it - or one built at a moment when the live copy had nothing of a kind -
 * kept its blank squares forever: the rows already exist, and the catalogue is only written
 * when the demo account has none. This runs on every boot instead. It re-reads the live copy,
 * fills the rows that are still blank, and leaves every row that already has a picture alone.
 *
 * It also caches every picture the demo's rows point at, not just the ones this pass wrote: a
 * row draws only when its bytes are in the cache, and a boot that could not reach UESP leaves
 * the path with nothing behind it.
 *
 * @returns {Promise<{filled: number, leftBlank: number, cached: number, failed: number,
 *   kinds: number, liveRows: number, source: string}>}
 */
export async function repairDemoIcons(
  connection,
  { cacheIcons = cacheItemIcons, sourceDatabase = '' } = {}
) {
  const result = { filled: 0, leftBlank: 0, cached: 0, failed: 0, kinds: 0, liveRows: 0, source: '' };

  const [blankRows] = await connection.execute(
    `SELECT item_type_name, COUNT(*) AS blank FROM guildsbounty_shared_items
      WHERE account_name = ? AND (icon IS NULL OR icon = '')
      GROUP BY item_type_name
     UNION ALL
     SELECT item_type_name, COUNT(*) AS blank FROM guildsbounty_always_share
      WHERE account_name = ? AND (icon IS NULL OR icon = '')
      GROUP BY item_type_name`,
    [DEMO_ACCOUNT, DEMO_ACCOUNT]
  );

  const blank = blankRows.filter((row) => Number(row.blank) > 0);

  if (blank.length) {
    const live = await liveIconsByKind(connection, { sourceDatabase });
    const iconsByKind = live.byKind;
    result.kinds = live.byKind.size;
    result.liveRows = live.rows;
    result.source = live.source;

    // Grouped by the picture they borrow, so one kind costs one UPDATE rather than one per row.
    const byIcon = new Map();

    for (const row of blank) {
      const typeName = row.item_type_name;
      const icon = iconsByKind.get(iconKind(typeName));

      if (!icon) {
        result.leftBlank += Number(row.blank);
        continue;
      }

      if (!byIcon.has(icon)) {
        byIcon.set(icon, []);
      }
      byIcon.get(icon).push(typeName);
    }

    for (const [icon, typeNames] of byIcon) {
      const placeholders = typeNames.map(() => '?').join(', ');

      for (const table of ['guildsbounty_shared_items', 'guildsbounty_always_share']) {
        const [updated] = await connection.execute(
          `UPDATE ${table} SET icon = ?
            WHERE account_name = ? AND (icon IS NULL OR icon = '') AND item_type_name IN (${placeholders})`,
          [icon, DEMO_ACCOUNT, ...typeNames]
        );
        result.filled += Number(updated.affectedRows || 0);
      }
    }
  }

  const paths = await demoIconPaths(connection);

  if (paths.length) {
    try {
      const { fetched, failed } = await cacheIcons(connection, paths);
      result.cached = Number(fetched || 0);
      result.failed = Number(failed || 0);
    } catch {
      // Left for a later boot; the paths are on the rows and nothing else breaks.
    }
  }

  return result;
}

/**
 * Makes the demo person, its ESO account and its items exist, once.
 *
 * Called at boot, after the demo database has been rebuilt, and again when somebody
 * signs in as Demo, so a database that was restored, or one where the demo rows were
 * removed, heals itself. The write only
 * happens while the demo account has no shared items: a page load must not rewrite
 * rows that are already there.
 *
 * @returns {Promise<{userId: number, created: boolean, seeded: boolean}>}
 */
export async function ensureDemoData(connection, { sourceDatabase = '' } = {}) {
  const [existing] = await connection.execute(
    'SELECT id FROM guildsbounty_users WHERE is_demo = 1 ORDER BY id ASC LIMIT 1'
  );

  let userId = existing && existing[0] ? Number(existing[0].id) : 0;
  let created = false;

  if (!userId) {
    // 'Demo' is shorter than the sign-up form's minimum, so the hash is made with the
    // short-password allowance that exists for this one identity.
    const passwordHash = await hashPassword(DEMO_PASSWORD, { allowShort: true });

    const [inserted] = await connection.execute(
      `INSERT INTO guildsbounty_users (display_name, email, email_verified, is_demo)
       VALUES (?, ?, 0, 1)`,
      [DEMO_DISPLAY_NAME, DEMO_EMAIL]
    );

    userId = Number(inserted.insertId);
    created = true;

    await connection.execute(
      `INSERT INTO guildsbounty_user_identities
         (provider, provider_user_id, user_id, provider_username, provider_email, email_verified)
       VALUES ('password', ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
      [DEMO_LOGIN, userId, DEMO_DISPLAY_NAME, DEMO_EMAIL]
    );

    await connection.execute(
      `INSERT INTO guildsbounty_passwords (user_id, password_hash) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
      [userId, passwordHash]
    );
  }

  const [counted] = await connection.execute(
    'SELECT COUNT(*) AS n FROM guildsbounty_shared_items WHERE account_name = ?',
    [DEMO_ACCOUNT]
  );

  const shared = Number(counted && counted[0] ? counted[0].n : 0);
  let seeded = false;

  if (shared === 0) {
    const guilds = new Map([[DEMO_GUILD.id, DEMO_GUILD.name]]);

    // What the rows in this copy look like, one picture per kind of thing. Read before the
    // catalogue is written, because it is what the catalogue borrows its icons from.
    const live = await liveIconsByKind(connection, { sourceDatabase });
    const iconFor = (typeName) => live.byKind.get(iconKind(typeName)) || '';

    const items = ITEMS.map((spec, index) =>
      buildItem(spec, index, [DEMO_GUILD.id], {
        accountName: DEMO_ACCOUNT,
        icon: iconFor(spec.typeName),
      })
    );
    const offers = OFFERS.map((spec, index) =>
      buildOffer(spec, index, [DEMO_GUILD.id], {
        accountName: DEMO_ACCOUNT,
        icon: iconFor(spec.typeName),
      })
    );

    // The same call an upload uses, so the demo account is linked to the demo person,
    // the guild is written with its world, and every item carries the guild it is
    // offered to.
    await replaceAccounts(
      connection,
      [
        {
          accountName: DEMO_ACCOUNT,
          items,
          alwaysShare: offers,
          guilds,
          addonVersion: 'demo',
          platform: DEMO_WORLD.platform,
          worldName: DEMO_WORLD.worldName,
          // The same window a real file carries, so the demo's rows age into LAST CHANCE
          // instead of never being flagged at all.
          expireDays: DEMO_EXPIRE_DAYS,
        },
      ],
      { sourceFile: 'Demo sign-in', userId }
    );

    // The pictures themselves, not just the paths: a row draws only when its path is in the icon
    // cache, which until now only an upload ever filled. Best effort - the demo signs in whether
    // or not UESP answers.
    try {
      const paths = [...new Set([...items, ...offers].map((entry) => entry.icon).filter(Boolean))];
      if (paths.length) {
        await cacheItemIcons(connection, paths);
      }
    } catch {
      // The rows keep their paths; a later pass or a later boot caches them.
    }

    seeded = true;
  }

  // Either way - a demo written just now, or one written before the catalogue had pictures, or
  // one whose pictures could not be fetched at the time - the blank squares are filled here.
  const icons = await repairDemoIcons(connection, { sourceDatabase });

  // The line names the database it read, because "no live row of that kind" and "nothing to read
  // at all" look the same from the page and are fixed differently.
  console.log(
    `[DEMO] Icons: ${icons.liveRows} live row(s) read from ${icons.source} gave a picture for ` +
      `${icons.kinds} kind(s); ${icons.filled} row(s) filled, ${icons.cached} picture(s) cached` +
      (icons.failed ? `, ${icons.failed} could not be fetched` : '') +
      (icons.leftBlank ? `, ${icons.leftBlank} row(s) left blank (no live row of that kind)` : '')
  );

  // The demo's guildmates: without them the visitor owns every row they can see, so the
  // Request tab can only mirror their own bag and there is nobody to ask or answer. They
  // are written into the same guild, so their items and the demo's are visible to each
  // other, and they heal here too when the demo person already exists.
  const cast = await ensureDemoCast(connection, {
    guildId: DEMO_GUILD.id,
    guildName: DEMO_GUILD.name,
    platform: DEMO_WORLD.platform,
    worldName: DEMO_WORLD.worldName,
    source: 'Demo sign-in',
  });

  // The demo person's own shelf is dated the same way the guildmates' is: some offers
  // months old, some made this morning, so the Added column shows that an offer keeps
  // its date while new ones arrive beside it. Rows that already had a date - copied
  // from the real database, or seeded on an earlier boot - are left alone.
  await staggerFirstSeen(connection, { accountNames: [DEMO_ACCOUNT] });

  // The three endings a request can have, in the visitor's own history from the first page
  // load. Written once: a history with rows in it is one somebody has been reading.
  await seedDemoRequestHistory(connection, { userId, demoAccount: DEMO_ACCOUNT });

  return { userId, created, seeded, cast };
}

/**
 * The demo person as a sign-in, or null when the identity is missing.
 *
 * It reads the same row an email sign-in reads, because the demo is deliberately one
 * of those: a password identity, verified the same way, with `isDemo` set so the rest
 * of the server can tell it apart.
 *
 * @returns {Promise<{userId: number, displayName: string, email: string,
 *   passwordHash: string, isDemo: boolean}|null>}
 */
export async function findDemoSignIn(connection) {
  const login = await findPasswordLogin(connection, DEMO_LOGIN);

  return login ? { ...login, isDemo: true } : null;
}
