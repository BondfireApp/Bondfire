-- Studio encrypted storage
CREATE TABLE IF NOT EXISTS studio_docs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  encrypted_blob TEXT,
  key_version INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_studio_docs_org_updated
ON studio_docs(org_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS studio_blocks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  encrypted_blob TEXT,
  key_version INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_studio_blocks_org_updated
ON studio_blocks(org_id, updated_at DESC);
