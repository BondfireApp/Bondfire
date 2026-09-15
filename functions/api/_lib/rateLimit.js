// functions/api/_lib/rateLimit.js
// D1-backed rate limiter used by auth endpoints.
// If the `rate_limits` table doesn't exist (or D1 not bound), it safely no-ops (allows).
//
// Expected call shape:
//   const rl = await rateLimit({ env, key: 'login:ip:email', limit: 12, windowSec: 600 });
//   if (!rl.ok) return bad(429, 'RATE_LIMIT', { retry_after: rl.retry_after });

export async function rateLimit({ env, key, limit = 10, windowSec = 600 } = {}) {
  const now = Date.now();
  const resetAt = now + windowSec * 1000;

  if (!env?.BF_DB || !key) {
    return { ok: true, remaining: limit, reset_at: resetAt, noop: true };
  }

  try {
    const row = await env.BF_DB.prepare(
      "SELECT count, reset_at FROM rate_limits WHERE key = ?"
    ).bind(key).first();

    if (!row) {
      await env.BF_DB.prepare(
        "INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)"
      ).bind(key, 1, resetAt).run();
      return { ok: true, remaining: Math.max(0, limit - 1), reset_at: resetAt };
    }

    const rowReset = Number(row.reset_at) || 0;
    const rowCount = Number(row.count) || 0;

    if (rowReset <= now) {
      await env.BF_DB.prepare(
        "UPDATE rate_limits SET count = ?, reset_at = ? WHERE key = ?"
      ).bind(1, resetAt, key).run();
      return { ok: true, remaining: Math.max(0, limit - 1), reset_at: resetAt };
    }

    const nextCount = rowCount + 1;
    if (nextCount > limit) {
      const retryAfter = Math.max(1, Math.ceil((rowReset - now) / 1000));
      return { ok: false, remaining: 0, reset_at: rowReset, retry_after: retryAfter };
    }

    await env.BF_DB.prepare(
      "UPDATE rate_limits SET count = ? WHERE key = ?"
    ).bind(nextCount, key).run();

    return {
      ok: true,
      remaining: Math.max(0, limit - nextCount),
      reset_at: rowReset,
    };
  } catch (e) {
    // Most likely: "no such table: rate_limits" or preview without D1.
    return { ok: true, remaining: limit, reset_at: resetAt, noop: true };
  }
}
