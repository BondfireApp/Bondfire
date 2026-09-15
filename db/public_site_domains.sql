CREATE TABLE IF NOT EXISTS public_site_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  hostname TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verification_token TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  UNIQUE(scope, hostname)
);

CREATE INDEX IF NOT EXISTS idx_public_site_domains_scope
ON public_site_domains(scope);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_site_domains_primary_per_scope
ON public_site_domains(scope)
WHERE is_primary = 1;
