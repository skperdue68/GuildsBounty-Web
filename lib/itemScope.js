// What a row belongs to, and therefore what makes two rows the same item.
//
// A bag belongs to a character. The bank, a house's storage and the furnishing vault belong
// to the account - the same stacks are there whichever character walks up to them. A guild
// bank belongs to the guild: several accounts look at the same shelves.
//
// The row's identity follows the storage, not whoever happened to scan it. When the character
// was part of the key, every account-wide stack became a new row the moment a different
// character ran a scan: the old row was pruned and an identical one inserted, which is what
// made an upload say hundreds of items were removed while the total stayed right.
//
// The scope is the first half of the uniqueness rule (item_scope, item_key_hash) on both item
// tables, so it has to be written the same way by everything that shares a table: the parser's
// rows, the demo's fixtures and the simulator's, and the backfill in migration 031 all end up
// here through the store's write lists.

// The addon names the storage a stack was found in. Older files write `inventory:<character>`
// and `inventory`, the bank is `bank`, house storage is `housestorage:<n>`, the furnishing
// vault is `furnishingvault`, and a guild bank is `guildbank:<guild id>`.
const GUILD_BANK = 'guildbank';
const INVENTORY = 'inventory';

/**
 * The scope key for one row: `char:<account>:<character>`, `acct:<account>`, or
 * `guild:<platform>:<world>:<location>`.
 *
 * A guild bank carries the platform and the megaserver because a guild id means nothing
 * without them: the same number on NA and EU is two different guilds, and their shelves must
 * not share rows. Everything else is the account's own, whatever the location is called - a
 * place the addon has not taught us yet is still account storage, never a character's.
 *
 * @param {{accountName: string, characterName: string, locationKey: string}} item
 * @param {{platform?: number, worldName?: string}} [world] the server the file was written on
 * @returns {string} lower case, so the key is stable however the file spells a name
 */
export function itemScopeKey(item, world = {}) {
  const account = String(item?.accountName || '').trim().toLowerCase();
  const character = String(item?.characterName || '').trim().toLowerCase();
  const location = String(item?.locationKey || '').trim().toLowerCase();

  if (location.startsWith(GUILD_BANK)) {
    const platform = String(world?.platform ?? 0).trim();
    const worldName = String(world?.worldName || '').trim().toLowerCase();

    return `guild:${platform}:${worldName}:${location}`;
  }

  if (location.startsWith(INVENTORY)) {
    return `char:${account}:${character}`;
  }

  return `acct:${account}`;
}

/** True for the rows that belong to a guild's bank rather than to one account's storage. */
export function isGuildScope(scope) {
  return String(scope || '').startsWith('guild:');
}

/** True for the rows that belong to one character's own bags. */
export function isCharacterScope(scope) {
  return String(scope || '').startsWith('char:');
}
