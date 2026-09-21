import { getDb } from "./auth.js";

const MODULE_CONFIG_SCHEMA_VERSION = 2;
const CORE_MODULE_IDS = Object.freeze(["public-site"]);
const LEGACY_OPTIONAL_MODULE_IDS = Object.freeze(["people", "newsletter"]);

const DEFAULT_ENABLED_MODULES = Object.freeze([
  ...CORE_MODULE_IDS,
  "people",
  "newsletter",
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
      module_schema_version INTEGER NOT NULL DEFAULT ${MODULE_CONFIG_SCHEMA_VERSION},
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    )`
  ).run();
  try {
    await db.prepare(
      "ALTER TABLE org_module_configs ADD COLUMN module_schema_version INTEGER NOT NULL DEFAULT 1"
    ).run();
  } catch {}
}

function parseEnabledModules(value, options = {}) {
  const includeLegacyOptionalModules = options?.includeLegacyOptionalModules === true;
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  return new Set([
    ...CORE_MODULE_IDS,
    ...(includeLegacyOptionalModules ? LEGACY_OPTIONAL_MODULE_IDS : []),
    ...(Array.isArray(parsed) ? parsed : []),
  ].map((id) => String(id || "").trim()).filter(Boolean));
}

export async function isOrgModuleEnabled(env, orgId, moduleId) {
  const db = getDb(env);
  if (!db) return false;
  await ensureModulesTable(db);
  const row = await db.prepare(
    "SELECT enabled_modules_json, module_schema_version FROM org_module_configs WHERE org_id = ?"
  ).bind(String(orgId)).first();
  if (!row) return DEFAULT_ENABLED_MODULES.includes(String(moduleId));
  return parseEnabledModules(row.enabled_modules_json, {
    includeLegacyOptionalModules: Number(row?.module_schema_version || 1) < MODULE_CONFIG_SCHEMA_VERSION,
  }).has(String(moduleId));
}
