import { colophonApiPath } from "./hostContract.js";

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request(host, path, options = {}) {
  const response = await fetch(colophonApiPath(host, path), {
    credentials: "include",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await safeJson(response);
  if (!response.ok) {
    const error = new Error(data?.error || `Colophon request failed (${response.status})`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export function createBondfireColophonAdapter(host) {
  return Object.freeze({
    host,
    session: () => request(host, "session"),
    get: (path) => request(host, path),
    post: (path, body) => request(host, path, { method: "POST", body: JSON.stringify(body ?? {}) }),
    put: (path, body) => request(host, path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
    delete: (path) => request(host, path, { method: "DELETE" }),
  });
}
