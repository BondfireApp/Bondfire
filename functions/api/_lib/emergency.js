import { getDb, requireOrgRole, requireUser } from './auth.js';
import { bad, now, uuid } from './http.js';
import { bumpOrgKeyVersion, ensureZkSchema } from './zkSchema.js';

const SENSITIVE_META_KEY = /(token|secret|key|cookie|password|recovery|payload|plaintext|authorization)/i;

function sanitizeMeta(input, depth = 0) {
  if (depth > 3) return '[truncated]';
  if (input == null) return null;
  if (Array.isArray(input)) return input.slice(0, 20).map((item) => sanitizeMeta(item, depth + 1));
  if (typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input).slice(0, 30)) {
      out[k] = SENSITIVE_META_KEY.test(k) ? '[redacted]' : sanitizeMeta(v, depth + 1);
    }
    return out;
  }
  if (typeof input === 'string' && input.length > 300) return `${input.slice(0, 300)}...[truncated]`;
  return input;
}

export async function ensureEmergencySchema(env) {
  const db = getDb(env);
  if (!db) return { ok: false, resp: bad(500, 'NO_DB_BINDING') };

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS emergency_status (
      id TEXT PRIMARY KEY,
      is_active INTEGER NOT NULL DEFAULT 0,
      level TEXT NOT NULL DEFAULT 'normal',
      message TEXT NOT NULL DEFAULT '',
      started_at INTEGER,
      ended_at INTEGER,
      updated_by_user_id TEXT,
      updated_at INTEGER NOT NULL
    )`
  ).run();

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS org_emergency_state (
      org_id TEXT PRIMARY KEY,
      lockdown_enabled INTEGER NOT NULL DEFAULT 0,
      lockdown_reason TEXT NOT NULL DEFAULT '',
      lockdown_set_by_user_id TEXT,
      lockdown_set_at INTEGER,
      lockdown_cleared_by_user_id TEXT,
      lockdown_cleared_at INTEGER,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
    )`
  ).run();

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS emergency_protocol_state (
      org_id TEXT PRIMARY KEY,
      stage TEXT NOT NULL DEFAULT 'normal',
      isolated INTEGER NOT NULL DEFAULT 0,
      isolated_by_user_id TEXT,
      isolated_at INTEGER,
      recovered_by_user_id TEXT,
      recovered_at INTEGER,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
    )`
  ).run();

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS emergency_reports (
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
    )`
  ).run();

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_emergency_reports_org_created ON emergency_reports(org_id, created_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_emergency_reports_type_created ON emergency_reports(event_type, created_at DESC)').run();

  return { ok: true, db };
}

export async function readEmergencyStatus({ env, request, orgId = null }) {
  const user = await requireUser({ env, request });
  if (!user.ok) return user;

  const state = await ensureEmergencySchema(env);
  if (!state.ok) return state;

  const globalRow = await state.db.prepare(
    `SELECT id, is_active, level, message, started_at, ended_at, updated_by_user_id, updated_at
     FROM emergency_status
     WHERE id = 'global'`
  ).first();

  let orgLockdown = null;
  let orgProtocol = null;
  if (orgId) {
    const gate = await requireOrgRole({ env, request, orgId, minRole: 'viewer' });
    if (!gate.ok) return gate;

    orgLockdown = await state.db.prepare(
      `SELECT org_id, lockdown_enabled, lockdown_reason, lockdown_set_by_user_id, lockdown_set_at,
              lockdown_cleared_by_user_id, lockdown_cleared_at, updated_at
       FROM org_emergency_state
       WHERE org_id = ?`
    ).bind(orgId).first();

    orgProtocol = await state.db.prepare(
      `SELECT org_id, stage, isolated, isolated_by_user_id, isolated_at,
              recovered_by_user_id, recovered_at, updated_at
       FROM emergency_protocol_state
       WHERE org_id = ?`
    ).bind(orgId).first();
  }

  return {
    ok: true,
    user: user.user,
    status: {
      id: 'global',
      isActive: !!globalRow?.is_active,
      level: String(globalRow?.level || 'normal'),
      message: String(globalRow?.message || ''),
      startedAt: globalRow?.started_at || null,
      endedAt: globalRow?.ended_at || null,
      updatedAt: globalRow?.updated_at || null,
    },
    orgLockdown: orgLockdown
      ? {
          orgId: orgLockdown.org_id,
          enabled: !!orgLockdown.lockdown_enabled,
          reason: String(orgLockdown.lockdown_reason || ''),
          setByUserId: orgLockdown.lockdown_set_by_user_id || null,
          setAt: orgLockdown.lockdown_set_at || null,
          clearedByUserId: orgLockdown.lockdown_cleared_by_user_id || null,
          clearedAt: orgLockdown.lockdown_cleared_at || null,
          updatedAt: orgLockdown.updated_at || null,
        }
      : null,
    orgProtocol: orgProtocol
      ? {
          orgId: orgProtocol.org_id,
          stage: String(orgProtocol.stage || 'normal'),
          isolated: !!orgProtocol.isolated,
          isolatedByUserId: orgProtocol.isolated_by_user_id || null,
          isolatedAt: orgProtocol.isolated_at || null,
          recoveredByUserId: orgProtocol.recovered_by_user_id || null,
          recoveredAt: orgProtocol.recovered_at || null,
          updatedAt: orgProtocol.updated_at || null,
        }
      : {
          orgId,
          stage: 'normal',
          isolated: false,
          isolatedByUserId: null,
          isolatedAt: null,
          recoveredByUserId: null,
          recoveredAt: null,
          updatedAt: null,
        },
  };
}

export async function setOrgLockdownState({ env, request, orgId, enabled, reason = '', rotateKeys = false }) {
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'admin', bypassWriteLockdown: true });
  if (!gate.ok) return gate;

  const state = await ensureEmergencySchema(env);
  if (!state.ok) return state;

  const t = now();
  const userId = gate.user?.sub || gate.user?.userId || null;
  const safeReason = String(reason || '').trim().slice(0, 500);

  await state.db.prepare(
    `INSERT INTO org_emergency_state (
      org_id, lockdown_enabled, lockdown_reason, lockdown_set_by_user_id, lockdown_set_at,
      lockdown_cleared_by_user_id, lockdown_cleared_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(org_id) DO UPDATE SET
      lockdown_enabled = excluded.lockdown_enabled,
      lockdown_reason = excluded.lockdown_reason,
      lockdown_set_by_user_id = CASE WHEN excluded.lockdown_enabled = 1 THEN excluded.lockdown_set_by_user_id ELSE org_emergency_state.lockdown_set_by_user_id END,
      lockdown_set_at = CASE WHEN excluded.lockdown_enabled = 1 THEN excluded.lockdown_set_at ELSE org_emergency_state.lockdown_set_at END,
      lockdown_cleared_by_user_id = CASE WHEN excluded.lockdown_enabled = 0 THEN excluded.lockdown_cleared_by_user_id ELSE org_emergency_state.lockdown_cleared_by_user_id END,
      lockdown_cleared_at = CASE WHEN excluded.lockdown_enabled = 0 THEN excluded.lockdown_cleared_at ELSE org_emergency_state.lockdown_cleared_at END,
      updated_at = excluded.updated_at`
  )
    .bind(
      orgId,
      enabled ? 1 : 0,
      safeReason,
      enabled ? userId : null,
      enabled ? t : null,
      enabled ? null : userId,
      enabled ? null : t,
      t
    )
    .run();

  let keyRotation = null;
  if (enabled && rotateKeys) {
    const rotate = await rotateOrgKeysIfSupported(env, orgId);
    keyRotation = rotate.ok ? { rotated: true, keyVersion: rotate.keyVersion } : { rotated: false, reason: rotate.error };
  }

  const report = await writeEmergencyReport({
    env,
    request,
    orgId,
    eventType: enabled ? 'emergency.lockdown.enabled' : 'emergency.lockdown.cleared',
    severity: enabled ? 'critical' : 'info',
    status: 'recorded',
    summary: enabled ? 'Org lockdown enabled' : 'Org lockdown cleared',
    details: { reason: safeReason, keyRotation },
  });

  if (!report.ok) return report;

  return {
    ok: true,
    user: gate.user,
    state: {
      orgId,
      enabled: !!enabled,
      reason: safeReason,
      updatedAt: t,
      keyRotation,
    },
    reportId: report.reportId,
  };
}

export async function writeEmergencyReport({
  env,
  request,
  orgId = null,
  eventType,
  severity = 'info',
  status = 'recorded',
  summary,
  details = null,
}) {
  const user = await requireUser({ env, request });
  if (!user.ok) return user;

  if (orgId) {
    const gate = await requireOrgRole({ env, request, orgId, minRole: 'admin', bypassWriteLockdown: true });
    if (!gate.ok) return gate;
  }

  const state = await ensureEmergencySchema(env);
  if (!state.ok) return state;

  const id = uuid();
  const safeSummary = String(summary || '').trim().slice(0, 500);
  if (!safeSummary) return { ok: false, resp: bad(400, 'MISSING_SUMMARY') };

  const safeDetails = sanitizeMeta(details);

  await state.db.prepare(
    `INSERT INTO emergency_reports (id, org_id, event_type, severity, status, actor_user_id, summary, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    orgId,
    String(eventType || 'emergency.report'),
    String(severity || 'info'),
    String(status || 'recorded'),
    user.user?.sub || user.user?.userId || null,
    safeSummary,
    safeDetails ? JSON.stringify(safeDetails) : null,
    now()
  ).run();

  return { ok: true, reportId: id };
}

export async function readEmergencyReports({ env, request, orgId, limit = 25 }) {
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'viewer' });
  if (!gate.ok) return gate;

  const db = getDb(env);
  if (!db) return { ok: false, resp: bad(500, 'NO_DB_BINDING') };

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));

  let hasReportsTable = false;
  try {
    const tableRow = await db.prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = 'emergency_reports'
       LIMIT 1`
    ).first();
    hasReportsTable = !!tableRow?.name;
  } catch {
    hasReportsTable = false;
  }

  if (!hasReportsTable) {
    return { ok: true, reports: [] };
  }

  let rows = [];
  try {
    const result = await db.prepare(
      `SELECT id, org_id, event_type, status, actor_user_id, summary, created_at
       FROM emergency_reports
       WHERE org_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(orgId, safeLimit).all();

    rows = Array.isArray(result?.results) ? result.results : [];
  } catch {
    rows = [];
  }

  return {
    ok: true,
    reports: rows.map((row) => ({
      id: row.id,
      orgId: row.org_id || null,
      eventType: String(row.event_type || 'emergency.report'),
      outcome: String(row.status || 'recorded'),
      actorUserId: row.actor_user_id || null,
      summary: String(row.summary || '').slice(0, 500),
      createdAt: Number(row.created_at) || null,
    })),
  };
}

async function rotateOrgKeysIfSupported(env, orgId) {
  try {
    const { db } = await ensureZkSchema(env);
    const keyVersion = await bumpOrgKeyVersion(db, orgId);
    return { ok: true, keyVersion };
  } catch (e) {
    return { ok: false, error: 'KEY_ROTATION_UNAVAILABLE' };
  }
}
