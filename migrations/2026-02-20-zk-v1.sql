-- Bondfire ZK v1 + session hardening (D1)
-- Apply with: wrangler d1 execute <DBNAME> --file=...

-- User device public key registry
ALTER TABLE users ADD COLUMN public_key TEXT;

-- Org key tables (server stores ONLY wrapped blobs + encrypted metadata)
CREATE TABLE IF NOT EXISTS org_keys (
  org_id TEXT PRIMARY KEY,
  encrypted_org_metadata TEXT
);

CREATE TABLE IF NOT EXISTS org_key_wrapped (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

-- Encrypted fields
ALTER TABLE needs ADD COLUMN encrypted_description TEXT;
ALTER TABLE needs ADD COLUMN zk_key_version INTEGER;

ALTER TABLE meetings ADD COLUMN encrypted_notes TEXT;
ALTER TABLE meetings ADD COLUMN zk_key_version INTEGER;
