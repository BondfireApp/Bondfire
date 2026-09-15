import { bad } from './http.js';

function getDb(env) {
  return env?.BF_DB || env?.DB || env?.db || null;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isWriteMethod(method) {
  return WRITE_METHODS.has(String(method || '').toUpperCase());
}

async function hasTable(db, name) {
  try {
    const table = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(name)
      .first();
    return !!table?.name;
  } catch (e) {
    const detail = String(e?.message || e || '');
    if (/sqlite_master|not authorized|SQLITE_AUTH|SQLITE_ERROR/i.test(detail)) return false;
    throw e;
  }
}

export async function getOrgLockdownState({ env, orgId }) {
  const db = getDb(env);
  if (!db || !orgId) throw new Error('LOCKDOWN_STATE_UNAVAILABLE');

  if (!await hasTable(db, 'org_emergency_state')) return { enabled: false };

  const row = await db
    .prepare('SELECT lockdown_enabled FROM org_emergency_state WHERE org_id = ?')
    .bind(orgId)
    .first();

  return { enabled: !!row?.lockdown_enabled };
}

export async function getOrgIsolationState({ env, orgId }) {
  const db = getDb(env);
  if (!db || !orgId) throw new Error('ISOLATION_STATE_UNAVAILABLE');

  if (!await hasTable(db, 'emergency_protocol_state')) return { isolated: false, stage: 'normal' };

  const row = await db
    .prepare('SELECT isolated, stage FROM emergency_protocol_state WHERE org_id = ?')
    .bind(orgId)
    .first();

  return {
    isolated: !!row?.isolated || ['isolated', 'prepared', 'destroying'].includes(row?.stage),
    stage: String(row?.stage || 'normal'),
  };
}

export async function enforceOrgIsolationAccess({ env, orgId }) {
  const state = await getOrgIsolationState({ env, orgId });
  if (state.isolated) {
    return { ok: false, resp: bad(403, 'ORG_ISOLATED') };
  }
  return { ok: true };
}

export async function enforceOrgWriteLockdown({ env, orgId }) {
  const state = await getOrgLockdownState({ env, orgId });
  const protocol = await getOrgIsolationState({ env, orgId });
  if (state.enabled || protocol.stage !== 'normal') {
    return { ok: false, resp: bad(403, 'ORG_LOCKDOWN_ACTIVE') };
  }
  return { ok: true };
}
