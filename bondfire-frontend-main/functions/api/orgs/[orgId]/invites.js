import { ok, bad } from "../../_lib/http.js";
import { requireOrgRole, getDb } from "../../_lib/auth.js";

export async function onRequestGet(ctx) {
  return onRequest(ctx);
}

export async function onRequestPost(ctx) {
  return onRequest(ctx);
}

function randCode(len = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoids 0/O/1/I
  let out = "";
  while (out.length < len) {
    const byte=crypto.getRandomValues(new Uint8Array(1))[0];
    if(byte < 256 - (256 % alphabet.length)) out += alphabet[byte % alphabet.length];
  }
  return out;
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function ensureInvitesTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS invites (
        code TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        role TEXT NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER NOT NULL DEFAULT 1,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL
      )`
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_invites_org ON invites (org_id)`)
    .run();
}

export async function onRequest(ctx) {
  if (!ctx.env?.JWT_SECRET) return bad(500, "JWT_SECRET_MISSING");
  const { request, env, params } = ctx;

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");

  const orgId = params.orgId;
  const roleCheck = await requireOrgRole({ env, request, orgId, minRole: "owner" });
  if (!roleCheck.ok) return roleCheck.resp;

  try {
    await ensureInvitesTable(db);
    if (request.method === "GET") {
      const rows = await db
        .prepare(
          `SELECT code, role, uses, max_uses, expires_at, created_at
           FROM invites
           WHERE org_id = ?
           ORDER BY created_at DESC
           LIMIT 50`
        )
        .bind(orgId)
        .all();

      return ok({
        invites: (rows.results || []).map((r) => ({
          code: r.code,
          role: r.role || "member",
          uses: toInt(r.uses, 0),
          max_uses: toInt(r.max_uses, 1),
          expires_at: r.expires_at ? new Date(r.expires_at).getTime() : null,
          created_at: r.created_at ? new Date(r.created_at).getTime() : null,
        })),
      });
    }

    if (request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }

      const role = (body.role || "member").toString();
      if (!["viewer","member","admin"].includes(role)) return bad(400,"INVALID_INVITE_ROLE");
      const maxUses = toInt(body.maxUses ?? body.max_uses ?? body.maxUses, 1) || 1;
      const expiresInDays = toInt(body.expiresInDays, 14);

      const now = new Date();
      const expiresAt =
        expiresInDays && expiresInDays > 0
          ? new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000)
          : null;

      // Try a few times to avoid rare collisions.
      let code = null;
      for (let i = 0; i < 5; i++) {
        const candidate = randCode(10);
        const existing = await db
          .prepare("SELECT code FROM invites WHERE code = ? LIMIT 1")
          .bind(candidate)
          .first();
        if (!existing) {
          code = candidate;
          break;
        }
      }
      if (!code) return bad(500, "INVITE_CODE_COLLISION");

      await db
        .prepare(
          `INSERT INTO invites (org_id, code, role, uses, max_uses, expires_at, created_by, created_at)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?)`
        )
        .bind(
          orgId,
          code,
          role,
          maxUses,
          // D1 wants primitives. Store timestamps as epoch ms.
          expiresAt ? expiresAt.getTime() : null,
          // our JWT payload should use `sub`, but fall back just in case
          roleCheck.user?.sub || roleCheck.user?.userId || roleCheck.user?.id || null,
          now.getTime()
        )
        .run();

      return ok({
        invite: {
          code,
          role,
          uses: 0,
          max_uses: maxUses,
          expires_at: expiresAt ? expiresAt.getTime() : null,
          created_at: now.getTime(),
        },
      });
    }

    if (request.method === "DELETE") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }

      const code = String(body.code || "").trim().toUpperCase();
      if (!code) return bad(400, "MISSING_CODE");

      const res = await db
        .prepare("DELETE FROM invites WHERE org_id = ? AND code = ?")
        .bind(orgId, code)
        .run();

      // D1 returns meta info, but not always consistent across versions
      const changed = Number(res?.meta?.changes || 0);
      if (!changed) return bad(404, "INVITE_NOT_FOUND");

      return ok({ deleted: true, code });
    }

    return bad(405, "METHOD_NOT_ALLOWED");
  } catch (e) {
    return bad(500, e?.message || "INVITES_ERROR");
  }
}