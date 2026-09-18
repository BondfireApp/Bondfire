import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../functions/api/_lib/auth.js", import.meta.url), "utf8");

assert.equal(/searchParams\.get\(["']bf_token["']\)/.test(source), false, "session tokens must never be accepted from URL query parameters");
assert.match(source, /headers\.get\(["']authorization["']\)/, "Bearer authorization support must remain available");
assert.match(source, /cookies\.bf_at/, "httpOnly cookie session support must remain available");
assert.match(source, /org_memberships WHERE org_id = \? AND user_id = \?/, "organization authorization must remain server-side");

console.log("auth hardening regression checks passed");
