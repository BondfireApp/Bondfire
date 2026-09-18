import { ensureEmergencySchema } from './emergency.js';
import { bad, now, uuid } from './http.js';

// D1 batch commits the status, write lock and audit record together.
export async function transitionEmergency({ env, orgId, userId, from, stage, summary }) {
  const state = await ensureEmergencySchema(env);
  if (!state.ok) return state;
  const db = state.db, timestamp = now(), eventId = uuid();
  const placeholders = from.map(() => '?').join(', ');
  const isolated = ['isolated', 'prepared', 'destroying'].includes(stage) ? 1 : 0;
  const locked = stage === 'normal' ? 0 : 1;
  await db.prepare(`INSERT OR IGNORE INTO emergency_protocol_state (org_id, stage, isolated, updated_at)
    SELECT id, 'normal', 0, ? FROM orgs WHERE id = ?`).bind(timestamp, orgId).run();
  // Each statement uses the same pre-transition state. The state change is last.
  const results = await db.batch([
    db.prepare(`INSERT INTO org_emergency_state
      (org_id, lockdown_enabled, lockdown_reason, lockdown_set_by_user_id, lockdown_set_at,
       lockdown_cleared_by_user_id, lockdown_cleared_at, updated_at)
      SELECT org_id, ?, ?, ?, ?, ?, ?, ? FROM emergency_protocol_state WHERE org_id = ? AND stage IN (${placeholders})
      ON CONFLICT(org_id) DO UPDATE SET lockdown_enabled=excluded.lockdown_enabled,
        lockdown_reason=excluded.lockdown_reason,
        lockdown_set_by_user_id=CASE WHEN excluded.lockdown_enabled=1 THEN excluded.lockdown_set_by_user_id ELSE org_emergency_state.lockdown_set_by_user_id END,
        lockdown_set_at=CASE WHEN excluded.lockdown_enabled=1 THEN excluded.lockdown_set_at ELSE org_emergency_state.lockdown_set_at END,
        lockdown_cleared_by_user_id=excluded.lockdown_cleared_by_user_id,
        lockdown_cleared_at=excluded.lockdown_cleared_at, updated_at=excluded.updated_at`)
      .bind(locked, summary, locked ? userId : null, locked ? timestamp : null, locked ? null : userId, locked ? null : timestamp, timestamp, orgId, ...from),
    db.prepare(`INSERT INTO emergency_reports (id,org_id,event_type,severity,status,actor_user_id,summary,details_json,created_at)
      SELECT ?,org_id,?,?, 'recorded',?,?,NULL,? FROM emergency_protocol_state WHERE org_id=? AND stage IN (${placeholders})`)
      .bind(eventId, `emergency.protocol.${stage}`, locked ? 'critical' : 'info', userId, summary, timestamp, orgId, ...from),
    db.prepare(`UPDATE emergency_protocol_state SET stage=?, isolated=?,
      isolated_by_user_id=CASE WHEN ?=1 THEN COALESCE(isolated_by_user_id,?) ELSE NULL END,
      isolated_at=CASE WHEN ?=1 THEN COALESCE(isolated_at,?) ELSE NULL END,
      recovered_by_user_id=CASE WHEN ?=0 THEN ? ELSE NULL END,
      recovered_at=CASE WHEN ?=0 THEN ? ELSE NULL END, updated_at=?
      WHERE org_id=? AND stage IN (${placeholders})`)
      .bind(stage, isolated, isolated, userId, isolated, timestamp, locked, userId, locked, timestamp, timestamp, orgId, ...from),
  ]);
  if (Number(results[2]?.meta?.changes) !== 1) return { ok: false, resp: bad(409, 'PROTOCOL_STAGE_CHANGED') };
  return { ok: true, protocol: { stage, isolated: !!isolated, updatedAt: timestamp }, state: { orgId, enabled: !!locked, updatedAt: timestamp } };
}
