export const APP_SCHEMA_VERSION = 6

const MIGRATIONS = [
  {
    version: 1,
    name: '001_schema_tracking',
    sql: [
      `CREATE TABLE IF NOT EXISTS app_schema_state (
        scope TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS app_schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `INSERT OR IGNORE INTO app_schema_state (scope, version, updated_at)
       VALUES ('global', 0, CURRENT_TIMESTAMP);`,
      `CREATE INDEX IF NOT EXISTS idx_app_schema_migrations_version
       ON app_schema_migrations(version);`,
    ],
  },
  {
    version: 2,
    name: '002_public_site_config',
    sql: [
      `CREATE TABLE IF NOT EXISTS public_site_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL UNIQUE,
        config_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `INSERT OR IGNORE INTO public_site_configs (scope, config_json, updated_at)
       VALUES ('global', '{}', CURRENT_TIMESTAMP);`,
      `CREATE INDEX IF NOT EXISTS idx_public_site_configs_scope
       ON public_site_configs(scope);`,
    ],
  },
  {
    version: 3,
    name: '003_native_content',
    sql: [
      `CREATE TABLE IF NOT EXISTS native_public_content (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        content_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        target TEXT NOT NULL DEFAULT 'general',
        content_type TEXT NOT NULL DEFAULT 'note',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        published_at TEXT
      );`,
      `CREATE INDEX IF NOT EXISTS idx_native_public_content_status
       ON native_public_content(status);`,
      `CREATE INDEX IF NOT EXISTS idx_native_public_content_target
       ON native_public_content(target);`,
      `CREATE INDEX IF NOT EXISTS idx_native_public_content_updated_at
       ON native_public_content(updated_at DESC);`,
      `CREATE TABLE IF NOT EXISTS native_public_content_revisions (
        id TEXT PRIMARY KEY,
        native_content_id TEXT NOT NULL,
        revision_json TEXT NOT NULL,
        revision_note TEXT NOT NULL DEFAULT 'autosave',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE INDEX IF NOT EXISTS idx_native_public_content_revisions_native_id
       ON native_public_content_revisions(native_content_id);`,
      `CREATE INDEX IF NOT EXISTS idx_native_public_content_revisions_created_at
       ON native_public_content_revisions(created_at DESC);`,
      `CREATE TABLE IF NOT EXISTS native_content_sources (
        id TEXT PRIMARY KEY,
        native_content_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_label TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL DEFAULT '',
        source_external_id TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE INDEX IF NOT EXISTS idx_native_content_sources_native_id
       ON native_content_sources(native_content_id);`,
      `CREATE INDEX IF NOT EXISTS idx_native_content_sources_source_type
       ON native_content_sources(source_type);`,
    ],
  },
  {
    version: 4,
    name: '004_media_assets',
    sql: [
      `CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        alt_text TEXT NOT NULL DEFAULT '',
        caption TEXT NOT NULL DEFAULT '',
        credit TEXT NOT NULL DEFAULT '',
        media_type TEXT NOT NULL DEFAULT 'image',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE INDEX IF NOT EXISTS idx_media_assets_updated_at
       ON media_assets(updated_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_media_assets_media_type
       ON media_assets(media_type);`,
    ],
  },
  {
    version: 5,
    name: '005_schema_state_sync',
    sql: [
      `INSERT OR IGNORE INTO app_schema_state (scope, version, updated_at)
       VALUES ('global', 0, CURRENT_TIMESTAMP);`,
    ],
  },
  {
    version: 6,
    name: '006_org_module_configs',
    sql: [
      "CREATE TABLE IF NOT EXISTS org_module_configs (org_id TEXT PRIMARY KEY, enabled_modules_json TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, updated_by TEXT);",
      "CREATE INDEX IF NOT EXISTS idx_org_module_configs_updated_at ON org_module_configs(updated_at DESC);",
    ],
  },
]

export async function ensureMigrationTables(db) {
  await runStatement(
    db,
    `CREATE TABLE IF NOT EXISTS app_schema_state (
      scope TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  )

  await runStatement(
    db,
    `CREATE TABLE IF NOT EXISTS app_schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  )

  await runStatement(
    db,
    `INSERT OR IGNORE INTO app_schema_state (scope, version, updated_at)
     VALUES ('global', 0, CURRENT_TIMESTAMP)`
  )
}



async function runStatement(db, statement) {
  if (!String(statement || '').trim()) return
  if (db?.prepare) {
    await db.prepare(statement).run()
    return
  }

  await db.exec(statement)
}

export async function getSchemaState(db) {
  await ensureMigrationTables(db)

  const current =
    (await db
      .prepare(`SELECT scope, version, updated_at FROM app_schema_state WHERE scope = ? LIMIT 1`)
      .bind('global')
      .first()) || null

  const appliedResult = await db
    .prepare(`SELECT version, name, applied_at FROM app_schema_migrations ORDER BY version ASC, id ASC`)
    .all()

  return {
    currentVersion: Number(current?.version || 0),
    updatedAt: current?.updated_at || null,
    applied: Array.isArray(appliedResult?.results) ? appliedResult.results : [],
  }
}

export async function runAppMigrations(db) {
  await ensureMigrationTables(db)
  const before = await getSchemaState(db)
  const appliedNames = new Set(before.applied.map((item) => String(item.name)))
  const newlyApplied = []

  for (const migration of MIGRATIONS) {
    if (appliedNames.has(migration.name)) continue

    for (const statement of migration.sql) {
      await runStatement(db, String(statement || '').trim())
    }

    await db
      .prepare(`
        INSERT OR IGNORE INTO app_schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `)
      .bind(migration.version, migration.name, new Date().toISOString())
      .run()

    await db
      .prepare(`
        INSERT INTO app_schema_state (scope, version, updated_at)
        VALUES ('global', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(scope) DO UPDATE SET
          version = excluded.version,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(migration.version)
      .run()

    newlyApplied.push({ version: migration.version, name: migration.name })
  }

  const after = await getSchemaState(db)
  return {
    version: after.currentVersion,
    applied: newlyApplied,
    migrations: after.applied,
  }
}
