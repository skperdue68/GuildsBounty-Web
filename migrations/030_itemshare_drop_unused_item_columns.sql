-- Give the item tables back the columns nothing uses any more.
--
-- The addon used to send far more per-item detail than the site ever drew: the numeric
-- item type, the quality's own name, the trait's type, the apparel and weapon descriptors
-- (slot, equip type, weight, armour class, weapon class, handedness), the furniture data
-- id, the flavour text, and the raw dump of every ESO getter that answered. The site stored
-- all of it and read none of it: the list, the filters, the tooltip, the sort orders and the
-- icon work never touched one of them. The current addon does not write them either - the
-- per-item table now carries `itemName`, `itemId`, `itemLink`, `icon`, `itemTypeName`,
-- `quality`, `trait`, `setName`, `enchantName`, `styleName`, the level/champion-point pair,
-- `locationKey`, `sharedFrom`, `characterName` and `heldCount`, which is everything the
-- columns kept below are filled from.
--
-- They are dropped rather than left standing empty, so the table says what the site really
-- has. Every drop is IF EXISTS: this is safe on a database that never created one of them
-- (a fresh install runs the edited 001/008, which no longer create them at all), and it is
-- safe to run once on an existing one.
--
-- Kept on purpose, because the site computes or reads it:
--   item_key / item_key_hash / icon / icon_key       identity, and the /icons cache
--   item_type_name                                   the type headings and the Type filter
--   quality / trait / set_name / enchant_name        drawn on the row and in the tooltip
--   style_name / required_level / required_cp        drawn in the tooltip
--   location_key / location_label                    where the share sits
--   item_count / held_quantity / reserve_quantity    what is offered, held and kept back
--   first_dumped_at                                  the day the item was first offered
--   first_seen_at / last_seen_at                     the row's own arrival, used to stagger
--                                                    dates for rows that predate the file
--   upload_id                                        the refresh mark the prune uses

ALTER TABLE itemshare_shared_items
  DROP COLUMN IF EXISTS item_type,
  DROP COLUMN IF EXISTS quality_name,
  DROP COLUMN IF EXISTS trait_type,
  DROP COLUMN IF EXISTS apparel_slot,
  DROP COLUMN IF EXISTS equip_type,
  DROP COLUMN IF EXISTS apparel_weight,
  DROP COLUMN IF EXISTS armor_type,
  DROP COLUMN IF EXISTS weapon_type,
  DROP COLUMN IF EXISTS weapon_handedness,
  DROP COLUMN IF EXISTS furniture_data_id,
  DROP COLUMN IF EXISTS flavor_text,
  DROP COLUMN IF EXISTS eso_data,
  DROP COLUMN IF EXISTS last_dumped_at;

-- The same columns on the standing offers, which mirrored the item table. This table never
-- had a last_dumped_at of its own.
ALTER TABLE itemshare_always_share
  DROP COLUMN IF EXISTS item_type,
  DROP COLUMN IF EXISTS quality_name,
  DROP COLUMN IF EXISTS trait_type,
  DROP COLUMN IF EXISTS apparel_slot,
  DROP COLUMN IF EXISTS equip_type,
  DROP COLUMN IF EXISTS apparel_weight,
  DROP COLUMN IF EXISTS armor_type,
  DROP COLUMN IF EXISTS weapon_type,
  DROP COLUMN IF EXISTS weapon_handedness,
  DROP COLUMN IF EXISTS furniture_data_id,
  DROP COLUMN IF EXISTS flavor_text,
  DROP COLUMN IF EXISTS eso_data;
