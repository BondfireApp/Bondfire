import { getDb, requireOrgRole } from './auth.js';
import { requireCookieCsrf } from './csrf.js';
import { bad, json } from './http.js';
import { isOrgModuleEnabled } from './orgModules.js';

const CONTENT_FIELDS = new Set([
  'id','slug','title','excerpt','body','richBody','author','publishedAt','published_at',
  'createdAt','created_at','updatedAt','updated_at','featuredImage','featured_image',
  'type','contentType','tags','status'
]);
const CONFIG_FIELDS = new Set([
  'text','styles','blocks','site','title','description','logoUrl','logoURL','logo_url',
  'theme','navigation','footer','homepage','typography','colors'
]);

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function cleanString(value, max = 200000) {
  return String(value ?? '').slice(0, max);
}
function jsonClone(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

export async function ensureColophonPublicationSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS org_colophon_public_config (
    org_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS org_colophon_public_content (
    org_id TEXT NOT NULL,
    id TEXT NOT NULL,
    slug TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(org_id,id)
  )`).run();
  await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS org_colophon_public_slug ON org_colophon_public_content(org_id,slug)').run();
}

function sanitizeConfig(value) {
  if (!isObject(value)) return null;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!CONFIG_FIELDS.has(key)) continue;
    out[key] = jsonClone(item);
  }
  const encoded = JSON.stringify(out);
  if (encoded.length > 512 * 1024) throw new Error('PUBLICATION_CONFIG_TOO_LARGE');
  return out;
}

function sanitizeContent(value) {
  if (!isObject(value)) return null;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!CONTENT_FIELDS.has(key)) continue;
    out[key] = jsonClone(item);
  }
  out.id = cleanString(out.id, 160);
  out.slug = cleanString(out.slug || out.id, 200);
  out.title = cleanString(out.title, 1000);
  out.status = 'published';
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(out.id)) throw new Error('INVALID_PUBLICATION_ID');
  if (!/^[a-z0-9][a-z0-9-]{0,199}$/i.test(out.slug)) throw new Error('INVALID_PUBLICATION_SLUG');
  if (!out.title) throw new Error('PUBLICATION_TITLE_REQUIRED');
  const encoded = JSON.stringify(out);
  if (encoded.length > 768 * 1024) throw new Error('PUBLICATION_CONTENT_TOO_LARGE');
  return out;
}

export async function publishColophonCopy({ env, request, orgId }) {
  if (!(await isOrgModuleEnabled(env, orgId, 'publishing-colophon'))) return bad(403, 'MODULE_DISABLED', { moduleId: 'publishing-colophon' });
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'admin' });
  if (!gate.ok) return gate.resp;
  if (request.method !== 'POST') return bad(405, 'METHOD_NOT_ALLOWED');
  const csrf = requireCookieCsrf(request);
  if (csrf) return csrf;
  const body = await request.json().catch(() => null);
  if (!body || !['config','content'].includes(body.kind) || Object.keys(body).some((key) => !['kind','id','public'].includes(key))) {
    return bad(400, 'INVALID_COLOPHON_PUBLICATION');
  }
  const db = getDb(env);
  await ensureColophonPublicationSchema(db);
  const now = Date.now();
  try {
    if (body.kind === 'config') {
      if (body.public == null) {
        await db.prepare('DELETE FROM org_colophon_public_config WHERE org_id=?').bind(orgId).run();
        return json({ ok: true, published: false });
      }
      const config = sanitizeConfig(body.public);
      await db.prepare(`INSERT INTO org_colophon_public_config(org_id,payload,updated_at) VALUES(?,?,?)
        ON CONFLICT(org_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`)
        .bind(orgId, JSON.stringify(config), now).run();
      return json({ ok: true, published: true });
    }

    const id = cleanString(body.id || body.public?.id, 160);
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) return bad(400, 'INVALID_PUBLICATION_ID');
    if (body.public == null) {
      await db.prepare('DELETE FROM org_colophon_public_content WHERE org_id=? AND id=?').bind(orgId,id).run();
      return json({ ok: true, published: false, id });
    }
    const item = sanitizeContent({ ...body.public, id });
    await db.prepare(`INSERT INTO org_colophon_public_content(org_id,id,slug,payload,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(org_id,id) DO UPDATE SET slug=excluded.slug,payload=excluded.payload,updated_at=excluded.updated_at`)
      .bind(orgId, id, item.slug, JSON.stringify(item), now).run();
    return json({ ok: true, published: true, id, slug: item.slug });
  } catch (error) {
    const code = String(error?.message || 'COLOPHON_PUBLICATION_FAILED');
    if (/UNIQUE constraint/i.test(code)) return bad(409, 'PUBLICATION_SLUG_TAKEN');
    return bad(/TOO_LARGE/.test(code) ? 413 : 400, /^[A-Z_]+$/.test(code) ? code : 'COLOPHON_PUBLICATION_FAILED');
  }
}

export async function readColophonPublication(env, orgId, slug = '') {
  const db = getDb(env);
  await ensureColophonPublicationSchema(db);
  const configRow = await db.prepare('SELECT payload FROM org_colophon_public_config WHERE org_id=?').bind(orgId).first();
  const config = configRow?.payload ? JSON.parse(configRow.payload) : {};
  if (slug) {
    const row = await db.prepare('SELECT payload FROM org_colophon_public_content WHERE org_id=? AND slug=?').bind(orgId,slug).first();
    return { config, item: row?.payload ? JSON.parse(row.payload) : null, items: [] };
  }
  const rows = await db.prepare('SELECT payload FROM org_colophon_public_content WHERE org_id=? ORDER BY updated_at DESC LIMIT 200').bind(orgId).all();
  return { config, item: null, items: (rows.results || []).map((row) => JSON.parse(row.payload)) };
}
