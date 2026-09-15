export async function ensureSchema(env) {
  // Support multiple binding names across environments.
  // (This project uses BF_DB in several places.)
  const db = env?.BF_DB || env?.DB || env?.db;
  if (!db) throw new Error("NO_DB_BINDING");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS org_memberships (
      org_id TEXT,
      user_id TEXT,
      role TEXT,
      created_at INTEGER,
      PRIMARY KEY (org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      org_id TEXT,
      role TEXT,
      uses INTEGER DEFAULT 0,
      max_uses INTEGER,
      expires_at INTEGER,
      created_at INTEGER,
      created_by TEXT
    );
  `);
}
