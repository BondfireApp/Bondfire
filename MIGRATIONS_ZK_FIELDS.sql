-- Run these against your D1 database if you ever see "no such column" errors.
-- D1/SQLite does not support IF NOT EXISTS for ADD COLUMN, so run and ignore errors if a column already exists.

-- People
ALTER TABLE people ADD COLUMN encrypted_notes TEXT;
ALTER TABLE people ADD COLUMN encrypted_blob TEXT;
ALTER TABLE people ADD COLUMN key_version INTEGER;

-- Meetings
ALTER TABLE meetings ADD COLUMN encrypted_notes TEXT;
ALTER TABLE meetings ADD COLUMN encrypted_blob TEXT;
ALTER TABLE meetings ADD COLUMN key_version INTEGER;

-- Inventory
ALTER TABLE inventory ADD COLUMN encrypted_notes TEXT;
ALTER TABLE inventory ADD COLUMN encrypted_blob TEXT;
ALTER TABLE inventory ADD COLUMN key_version INTEGER;

-- Needs
ALTER TABLE needs ADD COLUMN encrypted_description TEXT;
ALTER TABLE needs ADD COLUMN encrypted_blob TEXT;
ALTER TABLE needs ADD COLUMN key_version INTEGER;
