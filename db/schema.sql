PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  mfa_secret_base32 TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS org_memberships (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS org_module_configs (
  org_id TEXT PRIMARY KEY,
  enabled_modules_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_org_module_configs_updated_at ON org_module_configs(updated_at DESC);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS needs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_people_org ON people(org_id);
CREATE INDEX IF NOT EXISTS idx_needs_org ON needs(org_id);
CREATE INDEX IF NOT EXISTS idx_needs_public ON needs(is_public);

CREATE TABLE IF NOT EXISTS org_invites (
  code TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  uses INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites(org_id);

/*
  SECURITY ADDITIONS (2026-02)
  Notes:
  - The older users.mfa_enabled + users.mfa_secret_base32 fields are deprecated.
  - MFA is now stored in user_mfa + login_mfa_challenges + user_mfa_recovery_codes.
  - ZK scaffolding uses users.public_key + org_keys + org_key_wrapped.
*/

-- Best-effort rate limiting for auth endpoints.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- User public key for future org key wrapping.
-- (Run ALTER TABLE users ADD COLUMN public_key TEXT; in D1 if missing.)

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

-- Refresh tokens (optional future use).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- MFA
CREATE TABLE IF NOT EXISTS login_mfa_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_mfa (
  user_id TEXT PRIMARY KEY,
  totp_secret_encrypted TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS drive_folders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drive_notes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT,
  content TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drive_files (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT,
  mime TEXT,
  size INTEGER,
  storage_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drive_templates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT,
  title TEXT,
  content TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drive_folders_org_parent ON drive_folders(org_id, parent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_notes_org_parent ON drive_notes(org_id, parent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_drive_files_org_parent ON drive_files(org_id, parent_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drive_files_storage_key ON drive_files(storage_key);
CREATE INDEX IF NOT EXISTS idx_drive_templates_org_updated ON drive_templates(org_id, updated_at DESC);


-- Emergency mode backend foundation.
CREATE TABLE IF NOT EXISTS emergency_status (
  id TEXT PRIMARY KEY,
  is_active INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL DEFAULT 'normal',
  message TEXT NOT NULL DEFAULT '',
  started_at INTEGER,
  ended_at INTEGER,
  updated_by_user_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS org_emergency_state (
  org_id TEXT PRIMARY KEY,
  lockdown_enabled INTEGER NOT NULL DEFAULT 0,
  lockdown_reason TEXT NOT NULL DEFAULT '',
  lockdown_set_by_user_id TEXT,
  lockdown_set_at INTEGER,
  lockdown_cleared_by_user_id TEXT,
  lockdown_cleared_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS emergency_protocol_state (
  org_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL DEFAULT 'normal',
  isolated INTEGER NOT NULL DEFAULT 0,
  isolated_by_user_id TEXT,
  isolated_at INTEGER,
  recovered_by_user_id TEXT,
  recovered_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS emergency_reports (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  status TEXT NOT NULL DEFAULT 'recorded',
  actor_user_id TEXT,
  summary TEXT NOT NULL,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_emergency_reports_org_created ON emergency_reports(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_reports_type_created ON emergency_reports(event_type, created_at DESC);
