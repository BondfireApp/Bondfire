const SQLITE_RESERVED = new Set(["sqlite_master", "sqlite_sequence", "sqlite_schema", "set"]);

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function orgPrefix(orgId) {
  return `bf_colophon_${fnv1a(orgId)}_`;
}

function prefixIdentifier(identifier, prefix, ctes = new Set()) {
  const value = String(identifier || "");
  if (!value || SQLITE_RESERVED.has(value.toLowerCase()) || ctes.has(value.toLowerCase()) || value.startsWith(prefix)) {
    return value;
  }
  return `${prefix}${value}`;
}

export function scopeColophonSql(sql, orgId) {
  let text = String(sql || "");
  const prefix = orgPrefix(orgId);
  const ctes = new Set();

  for (const match of text.matchAll(/(?:\bWITH|,)\s+([A-Za-z_][A-Za-z0-9_$]*)\s+AS\s*\(/gi)) {
    ctes.add(String(match[1] || "").toLowerCase());
  }

  text = text.replace(
    /\b(CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?)([A-Za-z_][A-Za-z0-9_$]*)(\s+ON\s+)([A-Za-z_][A-Za-z0-9_$]*)/gi,
    (_all, lead, indexName, on, tableName) => `${lead}${prefixIdentifier(indexName, prefix, ctes)}${on}${prefixIdentifier(tableName, prefix, ctes)}`,
  );

  text = text.replace(
    /\b((?:CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?|ALTER\s+TABLE\s+|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?|DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?))([A-Za-z_][A-Za-z0-9_$]*)/gi,
    (_all, lead, name) => `${lead}${prefixIdentifier(name, prefix, ctes)}`,
  );

  text = text.replace(
    /\b((?:FROM|JOIN|INTO|UPDATE|REFERENCES)\s+)([A-Za-z_][A-Za-z0-9_$]*)/gi,
    (_all, lead, name) => `${lead}${prefixIdentifier(name, prefix, ctes)}`,
  );

  text = text.replace(
    /\b(PRAGMA\s+(?:table_info|index_list|foreign_key_list)\s*\(\s*)(['"]?)([A-Za-z_][A-Za-z0-9_$]*)(\2)(\s*\))/gi,
    (_all, lead, quote, name, _sameQuote, tail) => `${lead}${quote}${prefixIdentifier(name, prefix, ctes)}${quote}${tail}`,
  );

  if (/\bsqlite_(?:master|schema)\b/i.test(text)) {
    text = text.replace(
      /\b(name\s*=\s*)(['"])([A-Za-z_][A-Za-z0-9_$]*)(\2)/gi,
      (_all, lead, quote, name) => `${lead}${quote}${prefixIdentifier(name, prefix, ctes)}${quote}`,
    );
  }

  return text;
}

function wrapStatement(statement) {
  if (!statement) return statement;
  return {
    __colophonInnerStatement: statement,
    bind(...values) {
      return wrapStatement(statement.bind(...values));
    },
    first(...args) {
      return statement.first(...args);
    },
    run(...args) {
      return statement.run(...args);
    },
    all(...args) {
      return statement.all(...args);
    },
    raw(...args) {
      return statement.raw(...args);
    },
  };
}

export function createOrgScopedD1(db, orgId) {
  if (!db?.prepare) return db;

  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql) => wrapStatement(target.prepare(scopeColophonSql(sql, orgId)));
      if (prop === "batch") {
        return (statements) => target.batch((statements || []).map((statement) => statement?.__colophonInnerStatement || statement));
      }
      if (prop === "exec") return (sql) => target.exec(scopeColophonSql(sql, orgId));
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function scopedObjectKey(key, orgId) {
  const prefix = `bondfire-colophon/${fnv1a(orgId)}/`;
  const value = String(key || "").replace(/^\/+/, "");
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}

function unscopedObjectKey(key, orgId) {
  const prefix = `bondfire-colophon/${fnv1a(orgId)}/`;
  const value = String(key || "");
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function stripListedObject(value, orgId) {
  if (!value || typeof value !== "object") return value;
  return { ...value, key: unscopedObjectKey(value.key, orgId) };
}

export function createOrgScopedBucket(bucket, orgId) {
  if (!bucket?.get || !bucket?.put) return bucket;

  return new Proxy(bucket, {
    get(target, prop) {
      if (prop === "get" || prop === "head" || prop === "delete") {
        return (key, ...args) => target[prop](scopedObjectKey(key, orgId), ...args);
      }
      if (prop === "put") return (key, value, ...args) => target.put(scopedObjectKey(key, orgId), value, ...args);
      if (prop === "list") {
        return async (options = {}) => {
          const result = await target.list({ ...options, prefix: scopedObjectKey(options.prefix || "", orgId) });
          return {
            ...result,
            objects: Array.isArray(result?.objects) ? result.objects.map((item) => stripListedObject(item, orgId)) : result?.objects,
            delimitedPrefixes: Array.isArray(result?.delimitedPrefixes)
              ? result.delimitedPrefixes.map((item) => unscopedObjectKey(item, orgId))
              : result?.delimitedPrefixes,
          };
        };
      }
      if (prop === "createMultipartUpload") {
        return (key, ...args) => target.createMultipartUpload(scopedObjectKey(key, orgId), ...args);
      }
      if (prop === "resumeMultipartUpload") {
        return (key, uploadId, ...args) => target.resumeMultipartUpload(scopedObjectKey(key, orgId), uploadId, ...args);
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function isBucketLike(value) {
  return Boolean(value && typeof value === "object" && typeof value.get === "function" && typeof value.put === "function" && !value.prepare);
}

function gatewaySecret(env, orgId) {
  const master = String(env?.COLOPHON_GATEWAY_SECRET || env?.JWT_SECRET || "");
  if (!master) throw new Error("COLOPHON_GATEWAY_SECRET_REQUIRED");
  return `${master}:bondfire-colophon-gateway:${fnv1a(orgId)}`;
}

function colophonRole(role) {
  const value = String(role || "viewer").toLowerCase();
  if (value === "member") return "contributor";
  if (["owner", "admin", "editor", "contributor", "viewer"].includes(value)) return value;
  return "viewer";
}

function gatewayActorIdentity(orgId, actor = {}) {
  const sourceId = String(actor.id || actor.email || "bondfire-user").slice(0, 180);
  const id = `bondfire-${fnv1a(`${orgId}:${sourceId}`)}`;
  return {
    id,
    email: `${id}@gateway.invalid`,
    displayName: String(actor.email || sourceId || "Bondfire member").slice(0, 160),
    role: colophonRole(actor.role),
  };
}

export function createColophonScopedEnv(env, orgId) {
  const source = env || {};
  const db = source.BF_DB || source.DB || null;
  const scopedDb = createOrgScopedD1(db, orgId);
  const bucketCache = new Map();
  const sessionSecret = gatewaySecret(source, orgId);

  return new Proxy(source, {
    get(target, prop) {
      if (prop === "BF_DB" || prop === "DB") return scopedDb;
      if (prop === "colophon_SESSION_SECRET") return sessionSecret;
      const value = target[prop];
      if (!isBucketLike(value)) return value;
      if (!bucketCache.has(value)) bucketCache.set(value, createOrgScopedBucket(value, orgId));
      return bucketCache.get(value);
    },
  });
}

export async function ensureColophonGatewayActor(scopedEnv, orgId, actor = {}) {
  const db = scopedEnv?.BF_DB || scopedEnv?.DB || null;
  if (!db?.prepare) throw new Error("COLOPHON_GATEWAY_DB_REQUIRED");
  const identity = gatewayActorIdentity(orgId, actor);
  const now = new Date().toISOString();
  await db.prepare(`CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL DEFAULT 100000,
    role TEXT NOT NULL DEFAULT 'viewer',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  )`).run();
  await db.prepare(`INSERT INTO admin_users (
    id, email, display_name, password_hash, password_salt, password_iterations, role, status, created_at, updated_at
  ) VALUES (?, ?, ?, 'gateway-managed', 'gateway-managed', 1, ?, 'active', ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    email = excluded.email,
    display_name = excluded.display_name,
    role = excluded.role,
    status = 'active',
    updated_at = excluded.updated_at`).bind(
    identity.id,
    identity.email,
    identity.displayName,
    identity.role,
    now,
    now,
  ).run();
  return identity;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sign(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export async function createColophonGatewayRequest(request, orgId, actor = {}, env = {}) {
  const now = Math.floor(Date.now() / 1000);
  const secret = gatewaySecret(env, orgId);
  const bondfireRole = String(actor.bondfireRole || actor.role || "viewer").toLowerCase();
  const role = colophonRole(actor.role);
  const payload = {
    v: 2,
    sub: String(actor.displayName || actor.email || actor.id || "bondfire-user").slice(0, 254),
    userId: String(actor.id || "").slice(0, 180),
    email: String(actor.email || "").slice(0, 254),
    role,
    iat: now,
    exp: now + 300,
    sid: `bondfire-${fnv1a(`${orgId}:${actor.id || actor.email || now}`)}`,
  };
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = base64Url(await sign(secret, encoded));
  const headers = new Headers(request.headers);
  const cookies = String(headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith("colophon_session="));
  cookies.push(`colophon_session=${encodeURIComponent(`${encoded}.${signature}`)}`);
  headers.set("cookie", cookies.join("; "));
  headers.set("x-bondfire-colophon-org", String(orgId));
  headers.set("x-bondfire-colophon-role", bondfireRole);

  return new Request(request, { headers });
}
