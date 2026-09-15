async function tryRun(db, sql) {
  try {
    await db.prepare(sql).run();
  } catch (e) {
    const msg = String(e?.message || "");
    // D1/SQLite throws on duplicate columns, etc. That's fine.
    if (msg.includes("duplicate") || msg.includes("already exists")) return;
    // Some D1 consoles surface generic SQLITE_ERROR for already-applied ALTERs.
    if (msg.includes("SQLITE_ERROR")) return;
    throw e;
  }
}

async function tableHasColumn(db, table, col) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all();
  const cols = (info?.results || []).map((r) => r.name);
  return cols.includes(col);
}

export async function ensureZkSchema(db) {
  // org_key_wrapped (legacy-safe)
  await tryRun(
    db,
    "CREATE TABLE IF NOT EXISTS org_key_wrapped (\n" +
      "org_id TEXT NOT NULL,\n" +
      "user_id TEXT NOT NULL,\n" +
      "wrapped_key TEXT NOT NULL,\n" +
      "kid TEXT,\n" +
      "created_at INTEGER,\n" +
      "key_version INTEGER DEFAULT 1,\n" +
      "wrapped_at INTEGER,\n" +
      "PRIMARY KEY (org_id, user_id)\n" +
    ")"
  );
  await tryRun(db, "CREATE INDEX IF NOT EXISTS idx_org_key_wrapped_org ON org_key_wrapped(org_id)");

  // org_key_recovery: optional password-derived backup of org key per user
  await tryRun(
    db,
    "CREATE TABLE IF NOT EXISTS org_key_recovery (\n" +
      "org_id TEXT NOT NULL,\n" +
      "user_id TEXT NOT NULL,\n" +
      "wrapped_key TEXT NOT NULL,\n" +
      "salt TEXT NOT NULL,\n" +
      "kdf TEXT NOT NULL,\n" +
      "updated_at INTEGER NOT NULL,\n" +
      "PRIMARY KEY (org_id, user_id)\n" +
    ")"
  );
  await tryRun(db, "CREATE INDEX IF NOT EXISTS idx_org_key_recovery_org ON org_key_recovery(org_id)");

  // org_crypto: we have two historical schemas:
  // - (org_id, version, created_at)    [early]
  // - (org_id, key_version, updated_at) [current]
  //
  // We create the *current* one, then adapt if the old one already exists.
  await tryRun(
    db,
    "CREATE TABLE IF NOT EXISTS org_crypto (\n" +
      "org_id TEXT PRIMARY KEY,\n" +
      "key_version INTEGER NOT NULL DEFAULT 1,\n" +
      "updated_at INTEGER NOT NULL\n" +
    ")"
  );

  // best-effort column adds for older schemas
  await tryRun(db, "ALTER TABLE org_key_wrapped ADD COLUMN kid TEXT");
  await tryRun(db, "ALTER TABLE org_key_wrapped ADD COLUMN created_at INTEGER");
  await tryRun(db, "ALTER TABLE org_key_wrapped ADD COLUMN key_version INTEGER DEFAULT 1");
  await tryRun(db, "ALTER TABLE org_key_wrapped ADD COLUMN wrapped_at INTEGER");

  // If org_crypto exists with legacy column "version", add key_version and backfill once.
  const hasVersion = await tableHasColumn(db, "org_crypto", "version");
  const hasKeyVersion = await tableHasColumn(db, "org_crypto", "key_version");

  if (hasVersion && !hasKeyVersion) {
    // Add as constant default (allowed). Then backfill from legacy "version".
    await tryRun(db, "ALTER TABLE org_crypto ADD COLUMN key_version INTEGER DEFAULT 1");
    await tryRun(db, "UPDATE org_crypto SET key_version = COALESCE(key_version, version)");
  }

  // If it exists but lacks updated_at, add it.
  const hasUpdatedAt = await tableHasColumn(db, "org_crypto", "updated_at");
  if (!hasUpdatedAt) {
    await tryRun(db, "ALTER TABLE org_crypto ADD COLUMN updated_at INTEGER");
    await tryRun(db, "UPDATE org_crypto SET updated_at = COALESCE(updated_at, (strftime('%s','now')*1000))");
  }

  // ===== Members + Newsletter subscribers (sensitive settings data) =====
  // Store ciphertext only in encrypted_blob. Plaintext columns may still exist for legacy/backfill.
  await tryRun(db, "ALTER TABLE org_memberships ADD COLUMN encrypted_blob TEXT");
  await tryRun(db, "ALTER TABLE org_memberships ADD COLUMN key_version INTEGER DEFAULT 1");
  await tryRun(db, "ALTER TABLE newsletter_subscribers ADD COLUMN encrypted_blob TEXT");
  await tryRun(db, "ALTER TABLE newsletter_subscribers ADD COLUMN key_version INTEGER DEFAULT 1");
}

export async function getOrgKeyVersion(db, orgId) {
  await ensureZkSchema(db);

  // Prefer key_version, but fall back to legacy "version".
  try {
    const row = await db
      .prepare("SELECT key_version FROM org_crypto WHERE org_id = ?")
      .bind(orgId)
      .first();
    return Number.isFinite(Number(row?.key_version)) ? Number(row.key_version) : 1;
  } catch (e) {
    const msg = String(e?.message || "");
    if (!msg.includes("no such column: key_version")) throw e;

    const row = await db
      .prepare("SELECT version AS key_version FROM org_crypto WHERE org_id = ?")
      .bind(orgId)
      .first();
    return Number.isFinite(Number(row?.key_version)) ? Number(row.key_version) : 1;
  }
}

export async function bumpOrgKeyVersion(db, orgId) {
  await ensureZkSchema(db);

  const cur = await getOrgKeyVersion(db, orgId);
  const next = cur + 1;
  const t = Date.now();

  // Try to write modern schema, but if org_crypto is legacy-only, update both.
  try {
    await db
      .prepare(
        "INSERT INTO org_crypto (org_id, key_version, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(org_id) DO UPDATE SET key_version = excluded.key_version, updated_at = excluded.updated_at"
      )
      .bind(orgId, next, t)
      .run();

    // If legacy "version" column exists, keep it in sync.
    try {
      await db.prepare("UPDATE org_crypto SET version = ? WHERE org_id = ?").bind(next, orgId).run();
    } catch (_) {
      // ignore if legacy column not present
    }
    return next;
  } catch (e) {
    const msg = String(e?.message || "");
    if (!msg.includes("no such column: key_version")) throw e;

    // Legacy fallback
    await db
      .prepare(
        "INSERT INTO org_crypto (org_id, version, created_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(org_id) DO UPDATE SET version = excluded.version"
      )
      .bind(orgId, next, t)
      .run();
    return next;
  }
}
