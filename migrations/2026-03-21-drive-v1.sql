CREATE TABLE IF NOT EXISTS drive_folders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drive_folders_org_parent ON drive_folders(org_id, parent_id, updated_at);

CREATE TABLE IF NOT EXISTS drive_notes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT,
  content TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drive_notes_org_parent ON drive_notes(org_id, parent_id, updated_at);

CREATE TABLE IF NOT EXISTS drive_files (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT,
  mime TEXT,
  size INTEGER,
  storage_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drive_files_org_parent ON drive_files(org_id, parent_id, updated_at);

CREATE TABLE IF NOT EXISTS drive_templates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT,
  title TEXT,
  content TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drive_templates_org ON drive_templates(org_id, updated_at);

CREATE TABLE IF NOT EXISTS drive_file_blobs (
  file_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  mime TEXT,
  data_url TEXT,
  text_content TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drive_file_blobs_org ON drive_file_blobs(org_id, updated_at);
