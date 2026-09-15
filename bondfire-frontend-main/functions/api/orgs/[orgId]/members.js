import { ensureDeviceKeySchema } from '../../_lib/deviceKeys.js';
import { ok, bad } from "../../_lib/http.js";
import { getDb, requireOrgRole } from "../../_lib/auth.js";
import { ensureZkSchema } from "../../_lib/zk.js";

const ALLOWED_ROLES = new Set(["viewer", "member", "admin", "owner"]);

async function ensureMembersSchema(db) {
  // Avatar URL is intentionally NOT encrypted.
  // It should usually be a Matrix mxc:// URL (Element profile photo) or https.
  // D1 doesn't support IF NOT EXISTS on ADD COLUMN, so ignore duplicate errors.
  try {
    await db.prepare("ALTER TABLE org_memberships ADD COLUMN avatar_url TEXT").run();
  } catch (e) {
    const msg = String(e?.message || e).toLowerCase();
    if (!msg.includes("duplicate column")) throw e;
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function countOwners(db, orgId) {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM org_memberships WHERE org_id = ? AND role = 'owner'")
    .bind(orgId)
    .first();
  return Number(row?.c || 0);
}

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const orgId = params.orgId;

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");

  // Ensure ZK-related columns exist (safe/no-op if already applied).
  await ensureZkSchema(db);

  // Ensure member avatar column exists.
  await ensureMembersSchema(db);
  await ensureDeviceKeySchema(db);

  // Members can view the member list and update their own avatar.
  // Admin is only required for role changes and removals.
  const gate = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!gate.ok) return gate.resp;

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const allowPlaintext = (url.searchParams.get("plaintext") || "") === "1";

      const rows = await db
        .prepare(
          `SELECT
             u.id AS user_id,
             u.email AS email,
             u.name AS name,
             u.public_key AS public_key,
             m.role AS role,
             m.created_at AS created_at,
             m.encrypted_blob AS encrypted_blob,
             m.key_version AS key_version,
             m.avatar_url AS avatar_url
           FROM org_memberships m
           JOIN users u ON u.id = m.user_id
           WHERE m.org_id = ?
           ORDER BY
             CASE m.role
               WHEN 'owner' THEN 0
               WHEN 'admin' THEN 1
               WHEN 'member' THEN 2
               ELSE 3
             END,
             lower(u.email) ASC
           LIMIT 200`
        )
        .bind(orgId)
        .all();

      const devices = await db.prepare('SELECT d.user_id,d.device_id,d.public_key FROM user_device_keys d JOIN org_memberships m ON m.user_id=d.user_id WHERE m.org_id=?').bind(orgId).all();
      return ok({
        meUserId: gate.user.sub,
        members: (rows.results || []).map((r) => {
          const hasEnc = !!r.encrypted_blob;
          return {
            userId: r.user_id,
            user_id: r.user_id,
            // Default: do not ship plaintext PII.
            // For one-time backfill/encrypt-existing, caller can use ?plaintext=1.
            email: allowPlaintext ? (r.email || "") : (hasEnc ? "__encrypted__" : ""),
            devices: (devices.results || []).filter(d => d.user_id === r.user_id),
            publicKey: r.public_key || null,
            public_key: r.public_key || null,
            name: allowPlaintext ? (r.name || "") : (hasEnc ? "__encrypted__" : ""),
            role: r.role || "member",
            createdAt: r.created_at || null,
            encrypted_blob: r.encrypted_blob || null,
            key_version: r.key_version ?? null,
            needs_encryption: !hasEnc,
            avatar_url: r.avatar_url || null,
            is_self: String(r.user_id) === String(gate.user.sub),
          };
        }),
      });
    }

    if (request.method === "PUT") {
      const body = await readJson(request);
      const userId = String(body.userId || "").trim();
      const role = body.role !== undefined ? String(body.role || "").trim() : "";
      const encryptedBlob = body.encrypted_blob ? String(body.encrypted_blob) : "";
      const keyVersion = body.key_version != null ? Number(body.key_version) : null;
      const avatarUrl = body.avatar_url !== undefined ? (String(body.avatar_url || "").trim() || null) : undefined;

      if (!userId) return bad(400, "MISSING_USER_ID");

      const hasRoleUpdate = body.role !== undefined;
      const hasZkUpdate = !!encryptedBlob;
      const hasAvatarUpdate = body.avatar_url !== undefined;

      if (!hasRoleUpdate && !hasZkUpdate && !hasAvatarUpdate) return bad(400, "MISSING_UPDATE");
      if (hasRoleUpdate && !ALLOWED_ROLES.has(role)) return bad(400, "INVALID_ROLE");

      const isSelf = String(userId) === String(gate.user.sub);
      const isAdminish = gate.role === "admin" || gate.role === "owner";

      const target = await db
        .prepare("SELECT role FROM org_memberships WHERE org_id = ? AND user_id = ?")
        .bind(orgId, userId)
        .first();

      if (!target) return bad(404, "MEMBERSHIP_NOT_FOUND");

      const targetRole = String(target.role || "member");

      if (hasRoleUpdate) {
        if (!isAdminish) return bad(403, "ADMIN_REQUIRED");
        if (role === "owner" && gate.role !== "owner") return bad(403, "OWNER_REQUIRED");

        if (targetRole === "owner" && role !== "owner") {
          if (gate.role !== "owner") return bad(403, "OWNER_REQUIRED");
          const owners = await countOwners(db, orgId);
          if (owners <= 1) return bad(400, "CANNOT_DEMOTE_LAST_OWNER");
        }

        await db
          .prepare("UPDATE org_memberships SET role = ? WHERE org_id = ? AND user_id = ?")
          .bind(role, orgId, userId)
          .run();
      }

      if (hasAvatarUpdate) {
        // Self can update self. Admin/owner can update anyone.
        if (!isSelf && !isAdminish) return bad(403, "ADMIN_REQUIRED");
        await db
          .prepare("UPDATE org_memberships SET avatar_url = ? WHERE org_id = ? AND user_id = ?")
          .bind(avatarUrl, orgId, userId)
          .run();
      }

      if (hasZkUpdate) {
        // Self can encrypt their own row. Admin/owner can backfill anyone.
        if (!isSelf && !isAdminish) return bad(403, "ADMIN_REQUIRED");
        await db
          .prepare(
            "UPDATE org_memberships SET encrypted_blob = ?, key_version = COALESCE(?, key_version) WHERE org_id = ? AND user_id = ?"
          )
          .bind(encryptedBlob, keyVersion, orgId, userId)
          .run();
      }

      return ok({ updated: true, updated_role: hasRoleUpdate, updated_zk: hasZkUpdate });
    }

    if (request.method === "DELETE") {
      const body = await readJson(request);
      const userId = String(body.userId || "").trim();
      if (!userId) return bad(400, "MISSING_USER_ID");

      if (gate.role !== "admin" && gate.role !== "owner") return bad(403, "ADMIN_REQUIRED");

      const target = await db
        .prepare("SELECT role FROM org_memberships WHERE org_id = ? AND user_id = ?")
        .bind(orgId, userId)
        .first();

      if (!target) return bad(404, "MEMBERSHIP_NOT_FOUND");

      const targetRole = String(target.role || "member");

      if (targetRole === "owner") {
        if (gate.role !== "owner") return bad(403, "OWNER_REQUIRED");
        const owners = await countOwners(db, orgId);
        if (owners <= 1) return bad(400, "CANNOT_REMOVE_LAST_OWNER");
      }

      await db.batch([
        db.prepare("DELETE FROM org_private_device_wraps WHERE org_id=? AND user_id=?").bind(orgId,userId),
        db.prepare("DELETE FROM org_key_wrapped WHERE org_id=? AND user_id=?").bind(orgId,userId),
        db.prepare("DELETE FROM org_key_recovery WHERE org_id=? AND user_id=?").bind(orgId,userId),
        db.prepare("DELETE FROM org_memberships WHERE org_id=? AND user_id=?").bind(orgId,userId),
      ]);

      return ok({ deleted: true });
    }

    return bad(405, "METHOD_NOT_ALLOWED");
  } catch (e) {
    return bad(500, e?.message || "MEMBERS_ERROR");
  }
}
