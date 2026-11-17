// The demo's own request history, written once.
//
// The Sent tab is where a request's three endings are read: a whole handover shows its
// number, a short one shows `1 of 2`, and a refusal shows a bare `0`. Left to the activity
// loop, all three appear whenever a guildmate happens to draw that answer - which makes
// them awkward to review, because the reviewer has to wait for luck. So the demo's history
// starts with one of each, and the loop adds to it from there.
//
// Each row is filled from a real shared item row of one of the guildmates (INSERT ...
// SELECT, LIMIT 1), so the tab shows a real item name, quality and type, and the owner is
// somebody the demo already knows. Nothing here invents an id.

import { DEMO_CAST } from './demoCast.js';

/**
 * The three endings, as the Qty column reads them.
 *
 * `asked` is what the visitor asked for, `sent` what the owner handed over. Both are two
 * so the short one has somewhere to be short of, and a single copy stays out of the demo's
 * history entirely - refused or sent whole is all one copy can do.
 */
export const DEMO_REQUEST_SHAPES = [
  { asked: 2, sent: 2, status: 'fulfilled', hoursAgo: 26 },
  { asked: 2, sent: 1, status: 'fulfilled', hoursAgo: 19 },
  { asked: 2, sent: 0, status: 'cancelled', hoursAgo: 7 },
];

const REFUSAL = 'Nothing to send this time, so the request was cancelled.';

/** The statement one shape is written with. Exported so a test can read it. */
export function demoRequestSeedSql(shape) {
  return `INSERT INTO guildsbounty_requests
            (requester_user_id, requester_account_name, owner_account_name, item_kind,
             shared_item_id, item_key_hash, item_name, item_id, quality, item_type_name,
             quantity, quantity_requested, status, status_reason,
             submitted_at, closed_at, fulfilled_at)
          SELECT ?, ?, s.account_name, 'inventory',
                 s.id, s.item_key_hash, s.item_name, s.item_id, s.quality, s.item_type_name,
                 ?, ?, ?, ?,
                 UTC_TIMESTAMP() - INTERVAL ? HOUR,
                 UTC_TIMESTAMP() - INTERVAL ? HOUR,
                 ${shape.status === 'fulfilled' ? 'UTC_TIMESTAMP() - INTERVAL ? HOUR' : 'NULL'}
            FROM guildsbounty_shared_items s
           WHERE s.account_name = ?
           ORDER BY s.item_count DESC, s.id ASC
           LIMIT 1`;
}

/**
 * Writes one answered request per shape into the demo account's history, once.
 *
 * `SELECT COUNT(*)` first, because this is called on every demo sign-in: a history that
 * already has rows is a history somebody has been reading, and a page load must not rewrite
 * it. Guessing is not needed for the item either - the INSERT takes whichever row the
 * guildmate has most of, so a request never asks for more than is there.
 *
 * @returns {Promise<number>} rows written; 0 when the history already exists
 */
export async function seedDemoRequestHistory(connection, { userId, demoAccount }) {
  const [counted] = await connection.execute(
    'SELECT COUNT(*) AS n FROM guildsbounty_requests WHERE requester_account_name = ?',
    [demoAccount]
  );

  if (Number(counted && counted[0] ? counted[0].n : 0) > 0) {
    return 0;
  }

  const owners = [...new Set(DEMO_CAST.map((person) => person.account))];
  let written = 0;

  for (const [index, shape] of DEMO_REQUEST_SHAPES.entries()) {
    const owner = owners[index % owners.length];
    const answered = shape.hoursAgo - 1;
    const params = [
      Number(userId) || 0,
      demoAccount,
      shape.sent,
      shape.asked,
      shape.status,
      shape.status === 'fulfilled' ? '' : REFUSAL,
      shape.hoursAgo,
      answered,
    ];

    if (shape.status === 'fulfilled') {
      params.push(answered);
    }

    params.push(owner);

    const [result] = await connection.execute(demoRequestSeedSql(shape), params);
    written += Number((result && result.affectedRows) || 0);
  }

  return written;
}
