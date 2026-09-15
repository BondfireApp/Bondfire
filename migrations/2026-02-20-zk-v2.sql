-- ZK v2: key versioning + encrypted columns for sensitive org data
-- Run in Cloudflare D1 console OR keep for reference.
-- D1/SQLite will error on duplicate columns if re-run.

-- org key wrapping metadata
ALTER TABLE org_key_wrapped ADD COLUMN kid TEXT;
ALTER TABLE org_key_wrapped ADD COLUMN created_at INTEGER;
ALTER TABLE org_key_wrapped ADD COLUMN key_version INTEGER DEFAULT 1;

-- track current org key version
CREATE TABLE IF NOT EXISTS org_crypto (
	org_id TEXT PRIMARY KEY,
	key_version INTEGER NOT NULL DEFAULT 1,
	updated_at INTEGER NOT NULL
);

-- encrypted fields (keep legacy plaintext columns for now)
ALTER TABLE needs ADD COLUMN encrypted_description TEXT;
ALTER TABLE needs ADD COLUMN key_version INTEGER;

ALTER TABLE meetings ADD COLUMN encrypted_notes TEXT;
ALTER TABLE meetings ADD COLUMN key_version INTEGER;

ALTER TABLE people ADD COLUMN encrypted_notes TEXT;
ALTER TABLE people ADD COLUMN key_version INTEGER;

ALTER TABLE inventory ADD COLUMN encrypted_notes TEXT;
ALTER TABLE inventory ADD COLUMN key_version INTEGER;

ALTER TABLE pledges ADD COLUMN encrypted_notes TEXT;
ALTER TABLE pledges ADD COLUMN key_version INTEGER;
