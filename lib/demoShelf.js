// Keeps the demo's shelves full.
//
// The demo is a shared copy that a visitor may browse for a long time, with the cast
// asking for the demo's things while they watch. Every ask reserves copies, and a row
// whose last copy is reserved is dropped from the page after a few seconds - the same
// rule a real owner's row follows. That is right for one visitor and wrong for the next:
// a demo left open all afternoon would slowly empty, and the person who arrives after
// them would find a half-empty shelf and nothing left to ask for.
//
// So this module does two things, both against the demo connection only:
//
//   1. lets go of asks the cast made that nobody was ever going to answer, because the
//      machine asked and then walked away from the request;
//   2. re-saves every demo account's file, which is what an owner's next upload does:
//      the shelf is full again, copies "mailed" since the last file are no longer
//      subtracted, and every row keeps the first-offered date it already had.
//
// Nothing here touches a real database, and a visitor's own requests are left alone -
// only the cast's abandoned asks are released.

import { DEMO_EXPIRE_DAYS, DEMO_HOUSE, ITEMS, OFFERS, buildItem, buildOffer } from './demoItems.js';
import { DEMO_ACCOUNT, DEMO_GUILD_SERVER } from './demo.js';
import { DEMO_CAST, castAccount } from './demoCast.js';
import { staggerFirstSeen } from './itemAges.js';
import { hashItemKey, replaceAccounts } from './store.js';

/**
 * How long an ask from the cast is left standing before the demo takes it back.
 *
 * Long enough that the visitor can watch their request be answered - the activity loop
 * answers within a tick or two - and short enough that a machine which asked and never
 * followed through cannot hold a shelf's last copy for the rest of the afternoon.
 */
export const DEMO_ASK_TTL_MS = 2 * 60 * 1000;

/** How often the shelf is topped up.
 *
 * Three minutes, not one: a restock rewrites every count back to the catalogue, so a visitor
 * watching a stack they just saw move would see it snap back with nothing to explain it. The
 * shelves are only run down by the activity loop (one action every 45s or so), so a few minutes
 * between top-ups still leaves a copy browsed all afternoon full for the next visitor.
 */
export const DEMO_RESTOCK_MS = 3 * 60 * 1000;

const RELEASE_REASON =
  'The demo let this go, so the shelves stay full for the next visitor.';

/**
 * The cast's own asks that have stood too long.
 *
 * The guard is on the requester: an ask the visitor sent is theirs to cancel, and the
 * activity answers those rather than dropping them. `submitted_at` is the send time, so
 * a basket still being filled is not touched - it has its own hold to lapse.
 */
export function abandonedAsksSql(accountCount = 1) {
  const placeholders = Array.from({ length: Math.max(1, accountCount) }, () => '?').join(', ');

  return `UPDATE guildsbounty_requests
             SET status = 'cancelled',
                 status_reason = ?,
                 closed_at = CURRENT_TIMESTAMP,
                 email_token_hash = '',
                 email_token_expires_at = NULL
           WHERE status = 'pending'
             AND requester_account_name IN (${placeholders})
             AND submitted_at IS NOT NULL
             AND submitted_at < ?`;
}

/** @returns {Promise<number>} how many asks the demo took back */
export async function releaseAbandonedAsks(
  connection,
  {
    castAccounts = DEMO_CAST.map((person) => person.account),
    olderThanMs = DEMO_ASK_TTL_MS,
    now = Date.now(),
  } = {}
) {
  const accounts = [...new Set((castAccounts || []).filter(Boolean))];

  if (accounts.length === 0) {
    return 0;
  }

  const cutoff = new Date(now - Math.max(0, Number(olderThanMs) || 0));
  const [result] = await connection.execute(abandonedAsksSql(accounts.length), [
    RELEASE_REASON,
    ...accounts,
    cutoff,
  ]);

  return Number((result && result.affectedRows) || 0);
}

/**
 * The demo person's own shelf, in the shape `replaceAccounts` takes.
 *
 * The same object a restock writes and the same one the activity loop re-saves when it reads
 * the visitor's file again, so the demo cannot build its own shelf two slightly different ways.
 */
export function demoOwnAccount({
  guild = DEMO_GUILD_SERVER,
  items = ITEMS,
  offers = OFFERS,
  accountName = DEMO_ACCOUNT,
  counts = new Map(),
  places = new Map(),
  house = false,
} = {}) {
  const guildIds = [guild.id];

  return {
    accountName,
    // A count the file last said is kept, so a re-count survives the restock that
    // follows it; a row with no stored count takes the catalogue's. Where the row sits is
    // kept the same way: a stack moved into the house is still the same row, so a re-save
    // that wrote the catalogue's location back would carry it out of the house again.
    items: items.map((spec, index) => {
      const item = buildItem(spec, index, guildIds, { accountName });
      const stored = counts.get(hashItemKey(item.itemKey));
      const place = places.get(hashItemKey(item.itemKey));
      const located = (house && spec.typeName === 'Furnishing' ? DEMO_HOUSE : null) ||
        (place && place.locationKey ? place : null);

      return {
        ...item,
        ...(located
          ? { locationKey: located.locationKey, locationLabel: located.locationLabel }
          : {}),
        ...(stored > 0 ? { itemCount: stored } : {}),
      };
    }),
    alwaysShare: offers.map((spec, index) => buildOffer(spec, index, guildIds, { accountName })),
    guilds: new Map([[guild.id, guild.name]]),
    addonVersion: 'demo',
    platform: Number(guild.platform) || 0,
    worldName: String(guild.worldName || ''),
    // A re-save carries the window with it; without it the demo would lose its LAST CHANCE
    // rows a minute after the first visitor arrived.
    expireDays: DEMO_EXPIRE_DAYS,
  };
}

/**
 * The counts the demo person's own rows hold right now, by item hash.
 *
 * A re-count is the visitor's own file saying four, and a restock that wrote the
 * catalogue's three back would undo it in front of them, with no message to explain it.
 */
export async function ownShelfCounts(connection, accountName = DEMO_ACCOUNT) {
  const [rows] = await connection.execute(
    'SELECT item_key_hash, item_count FROM guildsbounty_shared_items WHERE account_name = ?',
    [accountName]
  );

  return new Map(
    rows.map((row) => [String(row.item_key_hash), Math.max(0, Number(row.item_count) || 0)])
  );
}

/**
 * Where the demo person's own rows sit right now, by item hash.
 *
 * House storage is account-wide, so moving a stack into the house does not change which row
 * it is - and a re-save or a restock that wrote the catalogue's location back would undo the
 * move without a word, in front of the person watching it. The file keeps saying what it last
 * said, the same way it keeps the count.
 */
export async function ownShelfPlaces(connection, accountName = DEMO_ACCOUNT) {
  const [rows] = await connection.execute(
    'SELECT item_key_hash, location_key, location_label FROM guildsbounty_shared_items WHERE account_name = ?',
    [accountName]
  );

  return new Map(
    rows.map((row) => [
      String(row.item_key_hash),
      {
        locationKey: String(row.location_key || ''),
        locationLabel: String(row.location_label || ''),
      },
    ])
  );
}

/**
 * The demo person's own account object, with the counts its rows already carry - and the
 * places they sit in, so a piece put in the house stays there.
 */
export async function demoOwnShelf(
  connection,
  { guild = DEMO_GUILD_SERVER, items, offers, house = false } = {}
) {
  return demoOwnAccount({
    guild,
    items,
    offers,
    house,
    counts: await ownShelfCounts(connection, DEMO_ACCOUNT),
    places: await ownShelfPlaces(connection, DEMO_ACCOUNT),
  });
}

/**
 * Re-saves every demo account's file, the way their next upload would.
 *
 * `replaceAccounts` refreshes each row where it stands, so item ids, request history and
 * first-offered dates all survive; what changes is that the count is the catalogue's again
 * and copies handed over since the previous upload are no longer subtracted.
 *
 * @returns {Promise<number>} how many accounts were written
 */
export async function restockDemoShelf(
  connection,
  { guild = DEMO_GUILD_SERVER, cast = DEMO_CAST, items = ITEMS, offers = OFFERS } = {}
) {
  const guilds = new Map([[guild.id, guild.name]]);
  const platform = Number(guild.platform) || 0;
  const worldName = String(guild.worldName || '');
  const accounts = [
    await demoOwnShelf(connection, { guild, items, offers }),
    ...cast.map((person) => castAccount(person, guilds, { platform, worldName })),
  ];

  await replaceAccounts(connection, accounts, { sourceFile: 'Demo restock' });
  await staggerFirstSeen(connection, {
    accountNames: accounts.map((account) => account.accountName),
  });

  return accounts.length;
}

/** Whether enough time has passed since the last top-up to justify another one. */
export function shouldRestock(lastAt, now = Date.now(), interval = DEMO_RESTOCK_MS) {
  const last = Number(lastAt) || 0;

  return last === 0 || now - last >= Math.max(0, Number(interval) || 0);
}

let lastRestockAt = 0;
let restocking = null;

/**
 * Top up if it is time to. The in-flight promise is shared, so two pages arriving
 * together cannot write the same shelves twice.
 *
 * @returns {Promise<{released: number, accounts: number}|null>} null when nothing ran
 */
export async function keepDemoShelfFull(connection, { now = Date.now(), interval } = {}) {
  if (!shouldRestock(lastRestockAt, now, interval)) {
    return restocking ? { released: 0, accounts: 0 } : null;
  }

  if (restocking) {
    return restocking;
  }

  lastRestockAt = now;

  restocking = (async () => {
    try {
      const released = await releaseAbandonedAsks(connection, { now });
      const accounts = await restockDemoShelf(connection);

      return { released, accounts };
    } finally {
      restocking = null;
    }
  })();

  return restocking;
}

/** Only for tests and for a demo database that has just been rebuilt. */
export function forgetRestockClock() {
  lastRestockAt = 0;
  restocking = null;
}
