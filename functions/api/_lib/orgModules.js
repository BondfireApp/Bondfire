import { getDb } from "./auth.js";

const DEFAULT_ENABLED_MODULES = Object.freeze([
  "people",
  "public-site",
  "needs",
  "pledges",
  "inventory",
  "meetings",
  "drive",
  "events",
  "witness-archive",
  "bondfire-chat",
  "intake",
  "studio",
  "publishing-colophon",
]);

async function ensureModulesTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS org_module_configs (
      org_id TEXT PRIMARY KEY,
      enabled_modules_json TEXT NOT NULL DEFAULT '[]',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    )`
  ).run();
}

function parseEnabledModules(value) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  return new Set((Array.isArray(parsed) ? parsed : []).map((id) => String(id || "").trim()).filter(Boolean));
}

export async function isOrgModuleEnabled(env, orgId, moduleId) {
  const db = getDb(env);
  if (!db) return false;
  await ensureModulesTable(db);
  const row = await db.prepare(
    "SELECT enabled_modules_json FROM org_module_configs WHERE org_id = ?"
  ).bind(String(orgId)).first();
  if (!row) return DEFAULT_ENABLED_MODULES.includes(String(moduleId));
  return parseEnabledModules(row.enabled_modules_json).has(String(moduleId));
}
