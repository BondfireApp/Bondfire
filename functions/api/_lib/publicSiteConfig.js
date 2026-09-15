const PUBLIC_CONFIG_SCHEMA_VERSION = 1

function normalizePublicConfig(config = {}) {
  const input = config && typeof config === 'object' ? config : {}
  return {
    ...input,
    schemaVersion: Number(input.schemaVersion || PUBLIC_CONFIG_SCHEMA_VERSION),
  }
}

import { runAppMigrations } from './migrations.js'

export async function ensurePublicSiteConfigTable(db) {
  await runAppMigrations(db)
}

export async function readPublicSiteConfig(db, scope = 'global') {
  await ensurePublicSiteConfigTable(db)

  const row = await db
    .prepare(`
      SELECT id, scope, config_json, updated_at
      FROM public_site_configs
      WHERE scope = ?
      LIMIT 1
    `)
    .bind(scope)
    .first()

  if (!row) {
    return {
      id: null,
      scope,
      config: normalizePublicConfig({}),
      updatedAt: null,
      version: PUBLIC_CONFIG_SCHEMA_VERSION,
    }
  }

  let parsed = {}
  try {
    parsed = JSON.parse(row.config_json || '{}')
  } catch {
    parsed = {}
  }

  return {
    id: row.id ?? null,
    scope: row.scope,
    config: normalizePublicConfig(parsed),
    updatedAt: row.updated_at || null,
    version: Number(parsed?.version || PUBLIC_CONFIG_SCHEMA_VERSION),
  }
}

export async function writePublicSiteConfig(db, config, scope = 'global') {
  await ensurePublicSiteConfigTable(db)

  const normalized = normalizePublicConfig(config)
  const json = JSON.stringify(normalized)

  await db
    .prepare(`
      INSERT INTO public_site_configs (scope, config_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(scope) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(scope, json)
    .run()

  return await readPublicSiteConfig(db, scope)
}

export { normalizePublicConfig, PUBLIC_CONFIG_SCHEMA_VERSION }
