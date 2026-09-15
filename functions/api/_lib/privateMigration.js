import { MIGRATION_IDENTIFIERS } from './privateWriteGuards.js';
import { getDriveBucket, getFileRecord } from './drive.js';
import { getDb } from './auth.js';
import { orgPrefix } from './colophonScopedRuntime.js';
import { PRIVATE_CONTENT, ensurePrivateSchema } from './privateStore.js';
import { contentContext, isCiphertext } from '../../../shared/privateContent.js';

// Control-plane metadata is necessary for authentication, access control and deletion.
// Content tables not explicitly supported remain blockers, including plugin tables.
const CONTROL = new Set(['org_private_submission_keys','org_private_submissions','org_private_key_state','org_private_scope_keys','org_private_scope_wraps','org_private_scope_recovery','org_private_key_assertions','org_public_projections','org_private_studio_state','org_private_mode','org_private_records','org_private_migrations','org_private_assertions','org_private_blobs','org_private_cleanup',
  'org_private_device_wraps','org_crypto','org_keys','org_key_wrapped','org_key_recovery','org_module_configs',
  'emergency_protocol_state']);
const q = (s) => '"' + String(s).replace(/"/g,'""') + '"';
export async function sourceHash(row) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(row)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
}
export async function migrationInventory(env, orgId) {
  const db = getDb(env); await ensurePrivateSchema(db);
  const names = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const tables = [], blockers = [];
  const map = Object.fromEntries(Object.entries(PRIVATE_CONTENT).map(([k,c]) => [c.table,k]));
  map.orgs = 'organization';
  for (const { name } of names.results || []) {
    if (/^(sqlite_|_cf_)/i.test(name) || CONTROL.has(name)) continue;
    const cols = (await db.prepare(`PRAGMA table_info(${q(name)})`).all()).results || [];
    const isRoot = name === 'orgs';
    if (!isRoot && !cols.some(c => c.name === 'org_id') && !name.startsWith(orgPrefix(orgId))) continue;
    const where = isRoot ? 'id=?' : cols.some(c=>c.name==='org_id') ? 'org_id=?' : '1=1';
    const args = where === '1=1' ? [] : [orgId];
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)} WHERE ${where}`).bind(...args).first();
    if (!count?.n) continue;
    if(name==='org_emergency_state') {
      const allowed=['','Recoverable organization lockdown enabled','Organization lockdown cleared','Organization destruction prepared; no data deleted','Permanent organization destruction started','Organization isolated to owner-only access; data and recovery keys preserved','Organization emergency restrictions lifted; normal access restored'];
      const row=await db.prepare('SELECT lockdown_reason FROM org_emergency_state WHERE org_id=?').bind(orgId).first();
      if(!allowed.includes(row?.lockdown_reason||''))blockers.push({table:name,count:1,reason:'An existing lockdown reason may contain private text and requires migration.'});
      continue;
    }
    if(name==='inventory_pars' && cols.every(c=>['org_id','inventory_id','par','updated_at'].includes(c.name))) {
      const orphan=await db.prepare('SELECT COUNT(*) AS n FROM inventory_pars p WHERE p.org_id=? AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.org_id=p.org_id AND i.id=p.inventory_id)').bind(orgId).first();
      if(orphan?.n)blockers.push({table:name,count:orphan.n,reason:'Orphaned inventory thresholds require recovery before conversion.'});
      continue;
    }
    if(name==='drive_file_blobs') {
      const orphan=await db.prepare('SELECT COUNT(*) AS n FROM drive_file_blobs b WHERE b.org_id=? AND NOT EXISTS (SELECT 1 FROM drive_files f WHERE f.org_id=b.org_id AND f.id=b.file_id)').bind(orgId).first();
      if(orphan?.n)blockers.push({table:name,count:orphan.n,reason:'Orphaned file data requires recovery before conversion.'});
      continue;
    }
    if(['invites','org_invites'].includes(name) && cols.every(c=>['code','org_id','role','uses','max_uses','expires_at','created_at','created_by'].includes(c.name)))continue;
    if (name === 'org_memberships') {
      // Global account identities remain outside the content encryption boundary.
      // Per-org avatars can identify activities, so they must be removed first.
      if (cols.some(c=>c.name==='avatar_url')) {
        const r=await db.prepare("SELECT COUNT(*) AS n FROM org_memberships WHERE org_id=? AND COALESCE(avatar_url,'')<>''").bind(orgId).first();
        if(r?.n) blockers.push({table:name, count:r.n, reason:'Organization avatar URLs must be removed before conversion.'});
      }
      continue;
    }
    const kind=map[name];
    const singleton=PRIVATE_CONTENT[kind]?.singleton;
    if (!kind || (!singleton&&!cols.some(c=>c.name==='id'))) {
      blockers.push({ table:name, count:count.n, reason:'This data needs a dedicated migration before private mode can be enabled.' });
      continue;
    }
    // Child tables outside this inventory must not be silently skipped.
    const remaining = await db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)} s WHERE ${isRoot?'s.id=?':'s.org_id=?'} AND NOT EXISTS (SELECT 1 FROM org_private_migrations m WHERE m.org_id=? AND m.kind=? AND m.id=s.${singleton?'org_id':'id'})`).bind(orgId,orgId,kind).first();
    tables.push({kind,table:name,count:count.n,remaining:remaining?.n||0});
  }
  // Unscoped dependent rows may contain private content too. Block rather than
  // treating a clean parent table as evidence that an entire plugin is private.
  for (const {name} of names.results || []) {
    if (/^(sqlite_|_cf_)/i.test(name)) continue;
    const cols=(await db.prepare(`PRAGMA table_info(${q(name)})`).all()).results||[];
    if(cols.some(c=>c.name==='org_id') || name==='orgs') continue;
    const refs=(await db.prepare(`PRAGMA foreign_key_list(${q(name)})`).all()).results||[];
    for(const ref of refs) {
      const parent=tables.find(t=>t.table===ref.table);
      if(!parent || ref.to!=='id') continue;
      const root=parent.table==='orgs';
      const r=await db.prepare(`SELECT COUNT(*) AS n FROM ${q(name)} WHERE ${q(ref.from)} IN (SELECT id FROM ${q(parent.table)} WHERE ${root?'id':'org_id'}=?)`).bind(orgId).first();
      if(r?.n) blockers.push({table:name,count:r.n,reason:'Dependent records require migration.'});
    }
  }
  if(env.BF_PUBLIC) {
    const publicConfig=await env.BF_PUBLIC.get(`org:${orgId}`);
    if(publicConfig) blockers.push({table:'public_site',count:1,reason:'An existing public site must be retired before private conversion.'});
  }
  return {tables,blockers,remaining:tables.reduce((n,t)=>n+t.remaining,0)};
}
export async function migrationPage(env,orgId,kind) {
  const db=getDb(env), table=kind==='organization'?'orgs':PRIVATE_CONTENT[kind]?.table;
  if(!table) throw new Error('UNKNOWN_MIGRATION_KIND');
  const singleton=PRIVATE_CONTENT[kind]?.singleton;
  const rows=await db.prepare(`SELECT * FROM ${q(table)} s WHERE ${table==='orgs'?'s.id':'s.org_id'}=? AND NOT EXISTS (SELECT 1 FROM org_private_migrations m WHERE m.org_id=? AND m.kind=? AND m.id=s.${singleton?'org_id':'id'}) ORDER BY ${singleton?'org_id':'id'} LIMIT 10`).bind(orgId,orgId,kind).all();
  const result=[];
  for(const row of rows.results||[]) {
    const par=kind==='inventory'?await inventoryPar(db,orgId,row.id):null;
    const view=kind==='inventory'?{...row,par:par?.par??null}:singleton?{...row,id:orgId}:row;
    result.push({row:view,sourceHash:await sourceHash(view)});
  }
  return result;
}
export async function migrateRecord(env,orgId,body) {
  const db=getDb(env), {kind,id,ciphertext}=body;
  const table=kind==='organization'?'orgs':PRIVATE_CONTENT[kind]?.table;
  if(typeof ciphertext==='string'&&ciphertext.length>1024*1024)throw new Error('PRIVATE_RECORD_TOO_LARGE');
  if(!table || !isCiphertext(ciphertext,contentContext(orgId,kind,id))) throw new Error('VALID_CIPHERTEXT_REQUIRED');
  const singleton=PRIVATE_CONTENT[kind]?.singleton;
  const where=table==='orgs'?'id=?':singleton?'org_id=?':'org_id=? AND id=?';
  const args=table==='orgs'||singleton?[orgId]:[orgId,id];
  const row=await db.prepare(`SELECT * FROM ${q(table)} WHERE ${where}`).bind(...args).first();
  const par=kind==='inventory'?await inventoryPar(db,orgId,id):null;
  const view=kind==='inventory'?{...row,par:par?.par??null}:singleton?{...row,id:orgId}:row;
  if(!row || (singleton?orgId:row.id)!==id || await sourceHash(view)!==body.sourceHash) throw new Error('MIGRATION_SOURCE_CHANGED');
  if(kind==='drive/files') {
    const blob=await db.prepare('SELECT id FROM org_private_blobs WHERE org_id=? AND id=? AND file_id=?').bind(orgId,body.payloadId||'',id).first();
    if(!blob) throw new Error('ENCRYPTED_FILE_REQUIRED');
  }
  const cols=(await db.prepare(`PRAGMA table_info(${q(table)})`).all()).results||[];
  const preserve=MIGRATION_IDENTIFIERS;
  const vals=[],sets=[];
  for(const c of cols) {
    if(preserve.has(c.name)) continue;
    let value=null;
    if(c.name==='name'&&table==='orgs') value='Private organization';
    else if(c.notnull) value=/INT|REAL|NUM|DOUBLE|FLOAT/i.test(c.type)?0:'';
    sets.push(`${q(c.name)}=?`); vals.push(value);
  }
  const t=Date.now(), predicates=Object.keys(row).map(k=>`${q(k)} IS ?`).join(' AND ');
  await db.prepare('CREATE TABLE IF NOT EXISTS org_private_assertions (org_id TEXT PRIMARY KEY, valid INTEGER CHECK(valid=1))').run();
  const parent=row.parent_id||row.room_id||null;
  await db.prepare('CREATE TABLE IF NOT EXISTS org_private_cleanup (org_id TEXT NOT NULL,id TEXT NOT NULL,storage_key TEXT,PRIMARY KEY(org_id,id))').run();
  let oldStorageKey=row.storage_key||null;
  if(kind==='drive/files' && oldStorageKey) {
    const shared=await db.prepare('SELECT id FROM drive_files WHERE org_id<>? AND storage_key=?').bind(orgId,oldStorageKey).first();
    if(shared)throw new Error('LEGACY_STORAGE_KEY_SHARED');
    if(!getDriveBucket(env)) {
      const inline=await db.prepare('SELECT file_id FROM drive_file_blobs WHERE org_id=? AND file_id=?').bind(orgId,id).first();
      if(!inline)throw new Error('LEGACY_FILE_STORAGE_UNAVAILABLE');
      oldStorageKey=null;
    }
  }
  const parCleanup=par?[db.prepare('DELETE FROM inventory_pars WHERE org_id=? AND inventory_id=? AND par IS ? AND updated_at IS ?').bind(orgId,id,par.par,par.updated_at),db.prepare('INSERT OR REPLACE INTO org_private_assertions(org_id,valid) VALUES(?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)').bind(orgId)]:[];
  const cleanup=kind==='drive/files' ? [
    db.prepare('INSERT INTO org_private_cleanup(org_id,id,storage_key) VALUES(?,?,?)').bind(orgId,id,oldStorageKey),
    db.prepare('DELETE FROM drive_file_blobs WHERE org_id=? AND file_id=?').bind(orgId,id),
  ] : [];
  await db.batch([
    db.prepare('INSERT INTO org_private_records(org_id,kind,id,parent_id,ciphertext,revision,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind(orgId,kind,id,parent,ciphertext,row.created_at||t,t),
    db.prepare(`UPDATE ${q(table)} SET ${sets.join(',')} WHERE ${where} AND ${predicates}`).bind(...vals,...args,...Object.values(row)),
    db.prepare('INSERT OR REPLACE INTO org_private_assertions(org_id,valid) VALUES(?,CASE WHEN changes()=1 THEN 1 ELSE 0 END)').bind(orgId),
    db.prepare('INSERT INTO org_private_migrations(org_id,kind,id,source_hash) VALUES(?,?,?,?)').bind(orgId,kind,id,'verified'),
    ...cleanup,
    ...parCleanup,
  ]);
}

export async function cleanupPrivateSources(env,orgId) {
  const db=getDb(env);
  const table=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='org_private_cleanup'").first();
  if(!table) return;
  const pending=await db.prepare('SELECT * FROM org_private_cleanup WHERE org_id=?').bind(orgId).all();
  for(const item of pending.results||[]) {
    if(item.storage_key) {
      const bucket=getDriveBucket(env);
      if(!bucket) throw new Error('LEGACY_FILE_STORAGE_UNAVAILABLE');
      const shared=await db.prepare('SELECT id FROM drive_files WHERE org_id<>? AND storage_key=?').bind(orgId,item.storage_key).first();
      if(shared) throw new Error('LEGACY_STORAGE_KEY_SHARED');
      await bucket.delete(item.storage_key);
    }
    await db.prepare('DELETE FROM org_private_cleanup WHERE org_id=? AND id=?').bind(orgId,item.id).run();
  }
}
export async function legacyPrivateFile(env,orgId,id) {
  const file=await getFileRecord(env,orgId,id,{includeData:true});
  if(!file) throw new Error('FILE_NOT_FOUND');
  // Preserve the encrypted payload as-is for browser-side decryption when needed.
  if(!file.dataUrl && !file.textContent && Number(file.size)>0) throw new Error('LEGACY_FILE_DATA_MISSING');
  return file;
}

async function inventoryPar(db,orgId,id) {
  const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_pars'").first();
  return exists?await db.prepare('SELECT par,updated_at FROM inventory_pars WHERE org_id=? AND inventory_id=?').bind(orgId,id).first():null;
}
