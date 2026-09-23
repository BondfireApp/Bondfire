import { bad, json, now } from "../../_lib/http.js";
import { getDb, requireOrgRole } from "../../_lib/auth.js";

export const MODULE_CONFIG_SCHEMA_VERSION = 2;

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

const MODULE_ORDER = Object.freeze([
  ...DEFAULT_ENABLED_MODULES,
  "module-chat",
  "tasks", "working-groups", "decisions", "cases", "treasury",
]);

const EDITOR_ROLES = new Set(["admin", "owner"]);

export async function ensureModulesTable(db) {
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

export function parseEnabledModules(value, options = {}) {
  const includeLegacyOptionalModules = options?.includeLegacyOptionalModules === true;
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  const requested = Array.isArray(parsed) ? parsed : [];
  const wanted = new Set(
    [
      ...CORE_MODULE_IDS,
      ...(includeLegacyOptionalModules ? LEGACY_OPTIONAL_MODULE_IDS : []),
      ...requested,
    ]
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  return MODULE_ORDER.filter((id) => wanted.has(id));
}

function isLegacyModuleConfig(row) {
  return Number(row?.module_schema_version || 1) < MODULE_CONFIG_SCHEMA_VERSION;
}

function currentUserId(auth) {
  return auth?.user?.sub || auth?.user?.id || auth?.user?.userId || null;
}

function responsePayload(orgId, enabledModules, row, role) {
  return {
    ok: true,
    orgId,
    enabled_modules: enabledModules,
    version: Number(row?.version || 1),
    updated_at: row?.updated_at || null,
    can_edit: EDITOR_ROLES.has(String(role || "")),
  };
}

export async function onRequestGet({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");
  await ensureModulesTable(db);

  const row = await db.prepare(
    "SELECT org_id, enabled_modules_json, version, module_schema_version, updated_at FROM org_module_configs WHERE org_id = ?"
  ).bind(orgId).first();
  const enabledModules = row
    ? parseEnabledModules(row.enabled_modules_json, {
        includeLegacyOptionalModules: isLegacyModuleConfig(row),
      })
    : [...DEFAULT_ENABLED_MODULES];
  return json(responsePayload(orgId, enabledModules, row, auth.role));
}

export async function onRequestPut({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const auth = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!auth.ok) return auth.resp;

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");
  await ensureModulesTable(db);

  const body = await request.json().catch(() => ({}));
  const rawModules = body?.enabled_modules ?? body?.selected_modules ?? body?.modules;
  if (!Array.isArray(rawModules)) return bad(400, "MISSING_ENABLED_MODULES");

  const enabledModules = parseEnabledModules(rawModules);
  const current = await db.prepare(
    "SELECT version FROM org_module_configs WHERE org_id = ?"
  ).bind(orgId).first();
  const version = Number(current?.version || 0) + 1;
  const timestamp = now();
  const updatedBy = currentUserId(auth);

  await db.prepare(
    `INSERT INTO org_module_configs (org_id, enabled_modules_json, version, module_schema_version, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id) DO UPDATE SET
       enabled_modules_json = excluded.enabled_modules_json,
       version = excluded.version,
       module_schema_version = excluded.module_schema_version,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  ).bind(
    orgId,
    JSON.stringify(enabledModules),
    version,
    MODULE_CONFIG_SCHEMA_VERSION,
    timestamp,
    updatedBy
  ).run();

  return json(responsePayload(orgId, enabledModules, { version, updated_at: timestamp }, auth.role));
}

export async function onRequestDelete({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");
  const auth = await requireOrgRole({ env, request, orgId, minRole: "owner" });
  if (!auth.ok) return auth.resp;
  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");
  await ensureModulesTable(db);
  await db.prepare("DELETE FROM org_module_configs WHERE org_id = ?").bind(orgId).run();
  return json(responsePayload(orgId, [...DEFAULT_ENABLED_MODULES], null, auth.role));
}
