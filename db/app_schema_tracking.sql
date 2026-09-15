CREATE TABLE IF NOT EXISTS app_schema_state (
  scope TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO app_schema_state (scope, version, updated_at)
VALUES ('global', 0, CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS idx_app_schema_migrations_version
ON app_schema_migrations(version);
