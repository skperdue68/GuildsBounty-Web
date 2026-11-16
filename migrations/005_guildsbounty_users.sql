-- Sign-in providers: one person, one identity, whichever button they use.
--
-- guildsbounty_users is the person. guildsbounty_user_identities is the (provider,
-- provider_user_id) pair from Discord or Google; several identities may point at
-- the same person when their verified email matches.
--
-- The Discord columns on guildsbounty_accounts and guildsbounty_uploads are kept only
-- so existing rows survive this migration; new rows use user_id.

CREATE TABLE IF NOT EXISTS guildsbounty_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  display_name VARCHAR(96) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  -- Filled only while migrating the Discord-only schema; NULL afterwards.
  legacy_discord_user_id VARCHAR(32) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_guildsbounty_users_legacy_discord (legacy_discord_user_id),
  KEY idx_guildsbounty_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guildsbounty_user_identities (
  provider VARCHAR(16) NOT NULL,
  provider_user_id VARCHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  provider_username VARCHAR(96) NOT NULL DEFAULT '',
  provider_email VARCHAR(254) NOT NULL DEFAULT '',
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  linked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, provider_user_id),
  KEY idx_guildsbounty_user_identities_user (user_id),
  CONSTRAINT fk_guildsbounty_user_identities_user
    FOREIGN KEY (user_id) REFERENCES guildsbounty_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE guildsbounty_accounts
  ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL AFTER eso_account_name;

-- Rows written from now on do not carry a Discord user id.
ALTER TABLE guildsbounty_accounts
  MODIFY COLUMN discord_user_id VARCHAR(32) NOT NULL DEFAULT '';

ALTER TABLE guildsbounty_uploads
  ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL;

-- Carry existing Discord links across as the first identities.
INSERT INTO guildsbounty_users (display_name, email, email_verified, legacy_discord_user_id)
SELECT d.discord_username, d.discord_email, d.email_verified, d.discord_user_id
  FROM guildsbounty_discord_users d
 WHERE d.discord_user_id <> ''
ON DUPLICATE KEY UPDATE
  display_name = IF(VALUES(display_name) = '', display_name, VALUES(display_name)),
  email = IF(VALUES(email) = '', email, VALUES(email)),
  email_verified = VALUES(email_verified);

INSERT INTO guildsbounty_user_identities
  (provider, provider_user_id, user_id, provider_username, provider_email, email_verified)
SELECT 'discord', d.discord_user_id, u.id, d.discord_username, d.discord_email, d.email_verified
  FROM guildsbounty_discord_users d
  JOIN guildsbounty_users u ON u.legacy_discord_user_id = d.discord_user_id
 WHERE d.discord_user_id <> ''
ON DUPLICATE KEY UPDATE
  user_id = VALUES(user_id),
  provider_username = VALUES(provider_username),
  provider_email = VALUES(provider_email);

UPDATE guildsbounty_accounts a
  JOIN guildsbounty_user_identities i
    ON i.provider = 'discord' AND i.provider_user_id = a.discord_user_id
   SET a.user_id = i.user_id
 WHERE a.user_id IS NULL;
