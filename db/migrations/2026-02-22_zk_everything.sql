-- ZK "encrypt everything" schema expansion (v1)
--
-- IMPORTANT:
-- SQLite/D1 does not support "ADD COLUMN IF NOT EXISTS".
-- If a line errors with "duplicate column name", just ignore that line and continue.

-- Inventory
ALTER TABLE inventory ADD COLUMN encrypted_notes TEXT;
ALTER TABLE inventory ADD COLUMN encrypted_blob TEXT;
ALTER TABLE inventory ADD COLUMN key_version INTEGER;

-- Needs
ALTER TABLE needs ADD COLUMN encrypted_blob TEXT;
ALTER TABLE needs ADD COLUMN key_version INTEGER;

-- Meetings
ALTER TABLE meetings ADD COLUMN encrypted_blob TEXT;
ALTER TABLE meetings ADD COLUMN key_version INTEGER;

-- People
ALTER TABLE people ADD COLUMN encrypted_blob TEXT;
ALTER TABLE people ADD COLUMN key_version INTEGER;

-- Orgs (optional: hide org metadata)
ALTER TABLE orgs ADD COLUMN encrypted_blob TEXT;
ALTER TABLE orgs ADD COLUMN key_version INTEGER;
