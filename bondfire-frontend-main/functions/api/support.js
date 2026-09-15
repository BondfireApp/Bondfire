import { bad, json } from "./_lib/http.js";
import { getDb, requireUser } from "./_lib/auth.js";

const PUBLIC_TYPES = new Set(["bug", "feature"]);
const PRIVATE_TYPES = new Set(["account", "other"]);
const TYPE_LABELS = Object.freeze({
  bug: "Bug",
  account: "Account problem",
  feature: "Feature request",
  other: "Other",
});
const DEFAULT_GITHUB_REPOSITORY = "ash-xytcc/bondfire-frontend";
const HOSTED_SUPPORT_EMAIL = "support@bondfireapp.org";
const MAX_SUBJECT = 160;
const MAX_DESCRIPTION = 12000;

function cleanOneLine(value, max = MAX_SUBJECT) {
  return String(value || "").replace(/[\r\n\0]+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value, max = MAX_DESCRIPTION) {
  return String(value || "").replace(/\0/g, "").trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizePublicText(value, diagnostics = {}, max = MAX_DESCRIPTION) {
  let text = cleanMultiline(value, max);
  text = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{10,}/gi, "$1[redacted]")
    .replace(/\b(password|passwd|api[_ -]?key|token|secret|authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi, "$1: [redacted]");

  for (const sensitiveValue of [diagnostics?.orgId, diagnostics?.orgName]) {
    const candidate = cleanOneLine(sensitiveValue, 240);
    if (!candidate) continue;
    text = text.replace(new RegExp(escapeRegExp(candidate), "gi"), "[organization redacted]");
  }
  return text.trim().slice(0, max);
}

function publicDiagnostics(diagnostics = {}) {
  const route = cleanOneLine(diagnostics?.route, 500);
  const orgId = cleanOneLine(diagnostics?.orgId, 240);
  const normalizedRoute = orgId && route
    ? route.replace(new RegExp(`/org/${escapeRegExp(orgId)}(?=/|$)`, "gi"), "/org/:orgId")
    : route;

  return {
    version: cleanOneLine(diagnostics?.version, 80),
    route: normalizedRoute,
    userAgent: cleanOneLine(diagnostics?.userAgent, 500),
    deploymentMode: cleanOneLine(diagnostics?.deploymentMode, 80),
    enabledModules: Array.isArray(diagnostics?.enabledModules)
      ? diagnostics.enabledModules.map((item) => cleanOneLine(item, 80)).filter(Boolean).slice(0, 40)
      : [],
  };
}

function privateDiagnostics(diagnostics = {}) {
  return {
    version: cleanOneLine(diagnostics?.version, 80),
    route: cleanOneLine(diagnostics?.route, 500),
    userAgent: cleanOneLine(diagnostics?.userAgent, 500),
    deploymentMode: cleanOneLine(diagnostics?.deploymentMode, 80),
    orgId: cleanOneLine(diagnostics?.orgId, 240),
    orgName: cleanOneLine(diagnostics?.orgName, 240),
    enabledModules: Array.isArray(diagnostics?.enabledModules)
      ? diagnostics.enabledModules.map((item) => cleanOneLine(item, 80)).filter(Boolean).slice(0, 40)
      : [],
  };
}

async function ensureSupportTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS support_requests (
      idempotency_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      request_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      github_issue_number INTEGER,
      github_issue_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
}

async function readExisting(db, idempotencyKey, userId) {
  return db.prepare(`
    SELECT idempotency_key, user_id, request_type, status, github_issue_number, github_issue_url, created_at, updated_at
    FROM support_requests
    WHERE idempotency_key = ? AND user_id = ?
    LIMIT 1
  `).bind(idempotencyKey, userId).first();
}

async function markRequest(db, { idempotencyKey, userId, type, subject, status, issueNumber = null, issueUrl = null }) {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO support_requests (
      idempotency_key, user_id, request_type, subject, status,
      github_issue_number, github_issue_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idempotency_key) DO UPDATE SET
      request_type = excluded.request_type,
      subject = excluded.subject,
      status = excluded.status,
      github_issue_number = excluded.github_issue_number,
      github_issue_url = excluded.github_issue_url,
      updated_at = excluded.updated_at
  `).bind(
    idempotencyKey,
    userId,
    type,
    subject,
    status,
    issueNumber,
    issueUrl,
    now,
    now,
  ).run();
}

function githubHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_SUPPORT_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Bondfire-Support",
    "Content-Type": "application/json",
  };
}

function githubRepository(env) {
  const configured = cleanOneLine(env.SUPPORT_GITHUB_REPOSITORY || DEFAULT_GITHUB_REPOSITORY, 200);
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(configured) ? configured : DEFAULT_GITHUB_REPOSITORY;
}

async function findGithubIssueBySupportId(env, idempotencyKey) {
  const repo = githubRepository(env);
  const marker = `bondfire-support-id:${idempotencyKey}`;
  const query = encodeURIComponent(`repo:${repo} is:issue in:body \"${marker}\"`);
  const response = await fetch(`https://api.github.com/search/issues?q=${query}&per_page=1`, {
    headers: githubHeaders(env),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  const issue = Array.isArray(payload?.items) ? payload.items[0] : null;
  if (!issue?.number || !issue?.html_url) return null;
  return { number: Number(issue.number), url: String(issue.html_url) };
}

async function existingGithubLabel(env, desired) {
  const repo = githubRepository(env);
  const response = await fetch(`https://api.github.com/repos/${repo}/labels?per_page=100`, {
    headers: githubHeaders(env),
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => []);
  if (!Array.isArray(payload)) return [];
  const found = payload.find((label) => String(label?.name || "").toLowerCase() === desired.toLowerCase());
  return found?.name ? [String(found.name)] : [];
}

function formatGithubBody({ description, diagnostics, type, idempotencyKey }) {
  const safe = publicDiagnostics(diagnostics);
  const rows = [
    `**Type:** ${TYPE_LABELS[type]}`,
    safe.version ? `**Bondfire version:** ${safe.version}` : "",
    safe.route ? `**Route:** \`${safe.route}\`` : "",
    safe.deploymentMode ? `**Deployment mode:** ${safe.deploymentMode}` : "",
    safe.userAgent ? `**Browser:** ${safe.userAgent}` : "",
    safe.enabledModules.length ? `**Enabled modules:** ${safe.enabledModules.join(", ")}` : "",
  ].filter(Boolean);

  return [
    description,
    "",
    "---",
    "### Non-sensitive diagnostics",
    rows.join("\n"),
    "",
    `<!-- bondfire-support-id:${idempotencyKey} -->`,
  ].join("\n").trim();
}

async function createGithubIssue(env, { type, subject, description, diagnostics, idempotencyKey }) {
  const existing = await findGithubIssueBySupportId(env, idempotencyKey);
  if (existing) return existing;

  const repo = githubRepository(env);
  const desiredLabel = type === "bug" ? "bug" : "enhancement";
  const labels = await existingGithubLabel(env, desiredLabel);
  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({
      title: subject,
      body: formatGithubBody({ description, diagnostics, type, idempotencyKey }),
      labels,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.number || !payload?.html_url) {
    const detail = cleanOneLine(payload?.message || `GitHub returned ${response.status}`, 240);
    throw new Error(detail || "GITHUB_ISSUE_CREATE_FAILED");
  }
  return { number: Number(payload.number), url: String(payload.html_url) };
}

function formatPrivateBody({ type, subject, description, replyEmail, diagnostics, includeDiagnostics, idempotencyKey }) {
  const lines = [
    "Bondfire private support request",
    "",
    `Type: ${TYPE_LABELS[type]}`,
    `Subject: ${subject}`,
    `Reply email: ${replyEmail}`,
    `Support request ID: ${idempotencyKey}`,
    "",
    "Description:",
    description,
  ];

  if (includeDiagnostics) {
    const safe = privateDiagnostics(diagnostics);
    lines.push(
      "",
      "Non-sensitive diagnostics:",
      `Bondfire version: ${safe.version || "Unknown"}`,
      `Route: ${safe.route || "Unknown"}`,
      `Browser: ${safe.userAgent || "Unknown"}`,
      `Deployment mode: ${safe.deploymentMode || "Unknown"}`,
      `Organization ID: ${safe.orgId || "None"}`,
      `Organization name: ${safe.orgName || "None"}`,
      `Enabled modules: ${safe.enabledModules.length ? safe.enabledModules.join(", ") : "None reported"}`,
    );
  }

  lines.push(
    "",
    "This message was generated by Bondfire Support. Authentication cookies, session/API tokens, private messages, uploaded files, document contents, REC media, FireChat contents, and other private user content are not automatically attached.",
  );
  return lines.join("\r\n");
}

async function sendPrivateSupport(env, requestData) {
  const deploymentMode = cleanOneLine(env.BONDFIRE_DEPLOYMENT_MODE || "hosted", 80).toLowerCase();
  const publicSupportEmail = cleanOneLine(
    env.SUPPORT_PUBLIC_EMAIL || (deploymentMode === "self-hosted" ? "" : HOSTED_SUPPORT_EMAIL),
    254,
  );
  const from = cleanOneLine(env.SUPPORT_FROM_EMAIL || publicSupportEmail, 254);
  const to = cleanOneLine(env.SUPPORT_PRIVATE_TO, 254);
  if (!isEmail(from) || !isEmail(to)) {
    throw new Error("PRIVATE_SUPPORT_EMAIL_DESTINATION_MISSING");
  }

  const message = {
    to,
    from,
    replyTo: requestData.replyEmail,
    subject: `[Bondfire Support] ${TYPE_LABELS[requestData.type]}: ${requestData.subject}`,
    text: formatPrivateBody(requestData),
  };

  if (env.SUPPORT_EMAIL && typeof env.SUPPORT_EMAIL.send === "function") {
    await env.SUPPORT_EMAIL.send(message);
    return;
  }

  const accountId = cleanOneLine(env.CLOUDFLARE_ACCOUNT_ID, 80);
  const apiToken = String(env.CLOUDFLARE_EMAIL_API_TOKEN || "").trim();
  if (!accountId || !apiToken) {
    throw new Error("PRIVATE_SUPPORT_EMAIL_CONFIGURATION_MISSING");
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success !== true) {
    const detail = cleanOneLine(
      payload?.errors?.[0]?.message || `Cloudflare Email Service returned ${response.status}`,
      240,
    );
    throw new Error(detail || "PRIVATE_SUPPORT_EMAIL_DELIVERY_FAILED");
  }
}

export async function onRequestGet({ env, request }) {
  const auth = await requireUser({ env, request });
  if (!auth.ok) return auth.resp;

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");

  const userId = String(auth.user?.sub || "");
  const user = await db.prepare("SELECT email FROM users WHERE id = ? LIMIT 1").bind(userId).first();
  const deploymentMode = cleanOneLine(env.BONDFIRE_DEPLOYMENT_MODE || "hosted", 80) || "hosted";
  const publicSupportEmail = cleanOneLine(
    env.SUPPORT_PUBLIC_EMAIL || (deploymentMode.toLowerCase() === "self-hosted" ? "" : HOSTED_SUPPORT_EMAIL),
    254,
  );

  return json({
    ok: true,
    replyEmail: isEmail(user?.email) ? String(user.email) : "",
    publicSupportEmail,
    deploymentMode,
    publicIssueEnabled: Boolean(env.GITHUB_SUPPORT_TOKEN),
  });
}

export async function onRequestPost({ env, request }) {
  const auth = await requireUser({ env, request });
  if (!auth.ok) return auth.resp;

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return bad(400, "INVALID_REQUEST", { message: "Invalid support request." });

  const type = cleanOneLine(body.type, 30).toLowerCase();
  const subjectRaw = cleanOneLine(body.subject, MAX_SUBJECT);
  const descriptionRaw = cleanMultiline(body.description, MAX_DESCRIPTION);
  const replyEmail = cleanOneLine(body.replyEmail, 254).toLowerCase();
  const idempotencyKey = cleanOneLine(body.idempotencyKey, 120);
  const includeDiagnostics = body.includeDiagnostics !== false;
  const diagnostics = includeDiagnostics && body.diagnostics && typeof body.diagnostics === "object" ? body.diagnostics : {};

  if (!PUBLIC_TYPES.has(type) && !PRIVATE_TYPES.has(type)) return bad(400, "INVALID_TYPE", { message: "Choose a valid support request type." });
  if (!subjectRaw) return bad(400, "SUBJECT_REQUIRED", { message: "Subject is required." });
  if (!descriptionRaw) return bad(400, "DESCRIPTION_REQUIRED", { message: "Description is required." });
  if (!isEmail(replyEmail)) return bad(400, "INVALID_REPLY_EMAIL", { message: "Enter a valid reply email." });
  if (!/^[A-Za-z0-9-]{12,120}$/.test(idempotencyKey)) return bad(400, "INVALID_IDEMPOTENCY_KEY", { message: "Invalid support request identifier." });

  const userId = String(auth.user?.sub || "");
  await ensureSupportTable(db);
  const existing = await readExisting(db, idempotencyKey, userId);
  if (existing?.status === "completed") {
    if (PUBLIC_TYPES.has(existing.request_type) && existing.github_issue_number && existing.github_issue_url) {
      return json({
        ok: true,
        kind: "github",
        issueNumber: Number(existing.github_issue_number),
        issueUrl: String(existing.github_issue_url),
        duplicate: true,
      });
    }
    return json({ ok: true, kind: "private", duplicate: true });
  }
  if (existing?.status === "submitting") {
    return bad(409, "REQUEST_IN_PROGRESS", { message: "This support request is already being processed. Wait a moment before retrying." });
  }

  await markRequest(db, { idempotencyKey, userId, type, subject: subjectRaw, status: "submitting" });

  try {
    if (PUBLIC_TYPES.has(type)) {
      if (!env.GITHUB_SUPPORT_TOKEN) {
        throw new Error("GITHUB_SUPPORT_TOKEN_MISSING");
      }
      const publicSubject = sanitizePublicText(subjectRaw, diagnostics, MAX_SUBJECT);
      const publicDescription = sanitizePublicText(descriptionRaw, diagnostics, MAX_DESCRIPTION);
      const issue = await createGithubIssue(env, {
        type,
        subject: publicSubject || `${TYPE_LABELS[type]} report`,
        description: publicDescription,
        diagnostics,
        idempotencyKey,
      });
      await markRequest(db, {
        idempotencyKey,
        userId,
        type,
        subject: subjectRaw,
        status: "completed",
        issueNumber: issue.number,
        issueUrl: issue.url,
      });
      return json({ ok: true, kind: "github", issueNumber: issue.number, issueUrl: issue.url });
    }

    await sendPrivateSupport(env, {
      type,
      subject: subjectRaw,
      description: descriptionRaw,
      replyEmail,
      diagnostics,
      includeDiagnostics,
      idempotencyKey,
    });
    await markRequest(db, { idempotencyKey, userId, type, subject: subjectRaw, status: "completed" });
    return json({ ok: true, kind: "private" });
  } catch (error) {
    console.error("SUPPORT_SUBMISSION_FAILED", error);
    await markRequest(db, { idempotencyKey, userId, type, subject: subjectRaw, status: "failed" }).catch(() => {});
    const code = cleanOneLine(error?.message || "SUPPORT_SUBMISSION_FAILED", 240);
    const configError = /(_MISSING|_DESTINATION_MISSING|_BINDING_MISSING)$/.test(code);
    return bad(configError ? 503 : 502, code, {
      message: configError
        ? "Support delivery is not configured on this deployment yet. Nothing was reported as sent."
        : "Support delivery failed. Nothing was reported as sent; retrying this same submission will not intentionally create a second GitHub issue.",
    });
  }
}
