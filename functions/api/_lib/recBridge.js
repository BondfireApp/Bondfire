import { bad } from "./http.js";

const REC_API_BASE = "https://rec.bjgarr.workers.dev";

export async function recBridge(env, path, method, body) {
  const secret = String(env?.BONDFIRE_BRIDGE_SECRET || "").trim();
  if (!secret) {
    const error = new Error("REC bridge is not configured");
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${REC_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || `REC bridge request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function recBridgeError(error, fallback = "REC_BRIDGE_FAILED") {
  return bad(Number(error?.status) || 502, fallback);
}
