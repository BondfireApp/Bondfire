import { requireOrgRole } from "../../../_lib/auth.js";
import { runAppMigrations } from '../../../_lib/migrations.js'

async function latestStudioSig(db, orgId) {
  const docs = await db.prepare(
    `SELECT id, updated_at FROM studio_docs WHERE org_id = ? ORDER BY updated_at DESC, id ASC`
  ).bind(orgId).all();
  const blocks = await db.prepare(
    `SELECT id, updated_at FROM studio_blocks WHERE org_id = ? ORDER BY updated_at DESC, id ASC`
  ).bind(orgId).all();

  const docsSig = (docs.results || []).map((row) => `${row?.id || ""}:${row?.updated_at || 0}`).join("|");
  const blocksSig = (blocks.results || []).map((row) => `${row?.id || ""}:${row?.updated_at || 0}`).join("|");
  return `${docsSig}__${blocksSig}`;
}

function sse(data, event) {
  const lines = [];
  if (event) lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };

      let lastSig = "";
      try {
        lastSig = await latestStudioSig(env.BF_DB, orgId);
        controller.enqueue(encoder.encode(sse({ sig: lastSig }, "ready")));
      } catch {
        controller.enqueue(encoder.encode(sse({ sig: "" }, "ready")));
      }

      const heartbeat = setInterval(async () => {
        if (closed) return;
        try {
          const sig = await latestStudioSig(env.BF_DB, orgId);
          if (sig !== lastSig) {
            lastSig = sig;
            controller.enqueue(encoder.encode(sse({ sig }, "studio-updated")));
          } else {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          }
        } catch {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        }
      }, 2000);

      const abort = () => {
        clearInterval(heartbeat);
        close();
      };

      request.signal?.addEventListener("abort", abort, { once: true });
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}