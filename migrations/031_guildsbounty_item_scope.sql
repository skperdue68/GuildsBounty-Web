-- Identity belongs to the storage, not to whoever scanned it.
--
-- A row used to be unique on (account_name, character_name, item_key_hash). The character made
-- every account-wide stack a different row per character: the bank, house storage and the
-- furnishing vault are the same shelves whichever character walks up to them, so a file saved
-- while a different character was logged in pruned the old row and inserted an identical one.
-- That is how an upload could report hundreds of items removed while the total was exactly
-- right, and why uploading the same file again looked clean.
--
-- item_scope says what a row belongs to and is now the first half of its identity:
--
--   char:<account>:<character>               a character's own bags
--   acct:<account>                           the bank, house storage, the furnishing vault
--   guild:<platform>:<world>:<locationKey>   a guild bank, which several accounts share
--
-- A guild bank carries no account in its identity on purpose: two members looking at the same
-- shelves are looking at the same items. The account_name on such a row is the member who
-- recorded it first, and a later scan by another member refreshes the count without taking the
-- row over from under the first member's open requests.
--
-- The store writes this on every upload (lib/itemScope.js), so the backfill below has to agree
-- with it exactly - the same trimming and lower casing, the same platform default - or the next
-- upload would recognise none of these rows and re-file every one of them.

ALTER TABLE guildsbounty_shared_items
  ADD COLUMN IF NOT EXISTS item_scope VARCHAR(191) NOT NULL DEFAULT '' AFTER item_key_hash;

ALTER TABLE guildsbounty_always_share
  ADD COLUMN IF NOT EXISTS item_scope VARCHAR(191) NOT NULL DEFAULT '' AFTER item_key_hash;

-- What each existing row already is, read from the place it was found in. The accounts table is
-- joined for the platform and megaserver, because a guild id means nothing without them.
UPDATE guildsbounty_shared_items i
  LEFT JOIN guildsbounty_accounts a ON a.eso_account_name = i.account_name
   SET i.item_scope = CASE
         WHEN LOWER(TRIM(i.location_key)) LIKE 'guildbank%'
           THEN CONCAT('guild:', COALESCE(a.platform, 0), ':',
                       LOWER(TRIM(COALESCE(a.world_name, ''))), ':',
                       LOWER(TRIM(i.location_key)))
         WHEN LOWER(TRIM(i.location_key)) LIKE 'inventory%'
           THEN CONCAT('char:', LOWER(TRIM(i.account_name)), ':', LOWER(TRIM(i.character_name)))
         ELSE CONCAT('acct:', LOWER(TRIM(i.account_name)))
       END
 WHERE i.item_scope = '';

UPDATE guildsbounty_always_share o
  LEFT JOIN guildsbounty_accounts a ON a.eso_account_name = o.account_name
   SET o.item_scope = CASE
         WHEN LOWER(TRIM(o.location_key)) LIKE 'guildbank%'
           THEN CONCAT('guild:', COALESCE(a.platform, 0), ':',
                       LOWER(TRIM(COALESCE(a.world_name, ''))), ':',
                       LOWER(TRIM(o.location_key)))
         WHEN LOWER(TRIM(o.location_key)) LIKE 'inventory%'
           THEN CONCAT('char:', LOWER(TRIM(o.account_name)), ':', LOWER(TRIM(o.character_name)))
         ELSE CONCAT('acct:', LOWER(TRIM(o.account_name)))
       END
 WHERE o.item_scope = '';

-- Rows that are now the same item - the same bank stack recorded by two characters - keep the
-- newest of them, because that is the one carrying the count from the last file that was read.
-- A request follows the row it was made against and a guild link has to survive, so both are
-- moved onto the row that stays before the rest go.
UPDATE guildsbounty_requests r
  JOIN guildsbounty_shared_items i ON i.id = r.shared_item_id
  JOIN (
        SELECT item_scope, item_key_hash, MAX(id) AS keep_id
          FROM guildsbounty_shared_items
         GROUP BY item_scope, item_key_hash
        HAVING COUNT(*) > 1
       ) dup ON dup.item_scope = i.item_scope AND dup.item_key_hash = i.item_key_hash
   SET r.shared_item_id = dup.keep_id
 WHERE i.id <> dup.keep_id;

INSERT IGNORE INTO guildsbounty_shared_item_guilds (item_id, guild_id, platform, world_name)
  SELECT dup.keep_id, g.guild_id, g.platform, g.world_name
    FROM guildsbounty_shared_items i
    JOIN guildsbounty_shared_item_guilds g ON g.item_id = i.id
    JOIN (
          SELECT item_scope, item_key_hash, MAX(id) AS keep_id
            FROM guildsbounty_shared_items
           GROUP BY item_scope, item_key_hash
          HAVING COUNT(*) > 1
         ) dup ON dup.item_scope = i.item_scope AND dup.item_key_hash = i.item_key_hash
   WHERE i.id <> dup.keep_id;

DELETE i
  FROM guildsbounty_shared_items i
  JOIN (
        SELECT item_scope, item_key_hash, MAX(id) AS keep_id
          FROM guildsbounty_shared_items
         GROUP BY item_scope, item_key_hash
        HAVING COUNT(*) > 1
       ) dup ON dup.item_scope = i.item_scope AND dup.item_key_hash = i.item_key_hash
 WHERE i.id <> dup.keep_id;

-- The same merge for the standing offers, which never carried the character but do carry the
-- guild now. Nothing is deleted from the item list above and left here dangling.
UPDATE guildsbounty_requests r
  JOIN guildsbounty_always_share o ON o.id = r.always_share_id
  JOIN (
        SELECT item_scope, item_key_hash, MAX(id) AS keep_id
          FROM guildsbounty_always_share
         GROUP BY item_scope, item_key_hash
        HAVING COUNT(*) > 1
       ) dup ON dup.item_scope = o.item_scope AND dup.item_key_hash = o.item_key_hash
   SET r.always_share_id = dup.keep_id
 WHERE o.id <> dup.keep_id;

INSERT IGNORE INTO guildsbounty_always_share_guilds (always_share_id, guild_id, platform, world_name)
  SELECT dup.keep_id, g.guild_id, g.platform, g.world_name
    FROM guildsbounty_always_share o
    JOIN guildsbounty_always_share_guilds g ON g.always_share_id = o.id
    JOIN (
          SELECT item_scope, item_key_hash, MAX(id) AS keep_id
            FROM guildsbounty_always_share
           GROUP BY item_scope, item_key_hash
          HAVING COUNT(*) > 1
         ) dup ON dup.item_scope = o.item_scope AND dup.item_key_hash = o.item_key_hash
   WHERE o.id <> dup.keep_id;

DELETE o
  FROM guildsbounty_always_share o
  JOIN (
        SELECT item_scope, item_key_hash, MAX(id) AS keep_id
          FROM guildsbounty_always_share
         GROUP BY item_scope, item_key_hash
        HAVING COUNT(*) > 1
       ) dup ON dup.item_scope = o.item_scope AND dup.item_key_hash = o.item_key_hash
 WHERE o.id <> dup.keep_id;

-- And now the identity itself: the scope and the key, nothing else. A fresh database is built
-- with this rule already (001 and 008), so both statements find nothing to do there.
ALTER TABLE guildsbounty_shared_items
  DROP INDEX IF EXISTS uniq_guildsbounty_shared_item;

ALTER TABLE guildsbounty_shared_items
  ADD UNIQUE INDEX IF NOT EXISTS uniq_guildsbounty_shared_item_scope (item_scope, item_key_hash);

ALTER TABLE guildsbounty_always_share
  DROP INDEX IF EXISTS uniq_guildsbounty_always_share;

ALTER TABLE guildsbounty_always_share
  ADD UNIQUE INDEX IF NOT EXISTS uniq_guildsbounty_always_share_scope (item_scope, item_key_hash);
