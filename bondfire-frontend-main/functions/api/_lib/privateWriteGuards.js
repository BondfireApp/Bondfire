import { PRIVATE_CONTENT } from '../../../shared/privateContent.js';
const q=s=>'"'+String(s).replace(/"/g,'""')+'"';
export const MIGRATION_IDENTIFIERS = new Set(['id','org_id','user_id','created_at','updated_at','parent_id','room_id','need_id']);
// Database triggers close the window where an already-running legacy request
// passed HTTP authorization just before private conversion started.
export async function installPrivateWriteGuards(db) {
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).results||[];
  const known=new Set(Object.values(PRIVATE_CONTENT).map(c=>c.table));known.add('orgs');known.add('drive_file_blobs');known.add('inventory_pars');
  for(const {name} of tables) {
    if(!known.has(name))continue;
    const columns=(await db.prepare(`PRAGMA table_info(${q(name)})`).all()).results||[];
    const root=name==='orgs';if(!root&&!columns.some(c=>c.name==='org_id'))continue;
    const org=root?'id':'org_id';
    const guard=`EXISTS(SELECT 1 FROM org_private_mode WHERE org_id=NEW.${q(org)})`;
    const clean=columns.filter(c=>!MIGRATION_IDENTIFIERS.has(c.name)).map(c=>root&&c.name==='name'?`NEW.name='Private organization'`:`(NEW.${q(c.name)} IS NULL OR NEW.${q(c.name)}='' OR NEW.${q(c.name)}=0)`);
    // Root creation and membership are created together before the mode row.
    await db.prepare(`CREATE TRIGGER IF NOT EXISTS ${q('bf_private_insert_'+name)} BEFORE INSERT ON ${q(name)} WHEN ${guard} BEGIN SELECT RAISE(ABORT,'PRIVATE_LEGACY_WRITE_FORBIDDEN'); END`).run();
    await db.prepare(`CREATE TRIGGER IF NOT EXISTS ${q('bf_private_update_'+name)} BEFORE UPDATE ON ${q(name)} WHEN ${guard} AND NOT (${clean.join(' AND ')||'1'}) BEGIN SELECT RAISE(ABORT,'PRIVATE_LEGACY_WRITE_FORBIDDEN'); END`).run();
  }
}
