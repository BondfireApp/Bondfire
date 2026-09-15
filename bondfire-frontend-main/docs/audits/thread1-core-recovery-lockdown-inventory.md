# Thread 1 — Core Recovery + Lockdown Inventory (Backend Only)

Date: 2026-04-24

## 1) Existing recovery / lockdown / emergency-adjacent backend routes

### Account/session + recovery-adjacent auth routes
- `POST /api/auth/login` — password login, creates refresh token session; branches to MFA challenge when enabled.
- `POST /api/auth/login/mfa` — completes MFA challenge (TOTP or MFA recovery code), then creates refresh token session.
- `POST /api/auth/refresh` — rotates refresh token and issues a new access token.
- `GET /api/auth/sessions` — lists recent refresh token rows for current user.
- `POST /api/auth/logout` — revokes current refresh token (if cookie present) and clears auth cookies.
- `POST /api/auth/logout_all` — deletes all refresh token rows for current user and clears auth cookies.
- `POST /api/auth/mfa/setup` — generates TOTP seed.
- `POST /api/auth/mfa/confirm` — verifies TOTP and creates MFA recovery codes.
- `POST /api/auth/mfa/disable` — disables MFA and deletes MFA recovery/challenge rows.

### Org key recovery routes
- `GET|POST|DELETE /api/orgs/:orgId/recovery` — per-user org recovery blob in `org_key_recovery` (`wrapped_key`, `salt`, `kdf`).
- `GET|POST|DELETE /api/orgs/:orgId/zk/recovery` — per-user org recovery payload in `org_key_recovery` (`recovery_payload`), with backward-compat fallback to legacy columns.

### Invite + membership entry routes
- `GET|POST|DELETE /api/orgs/:orgId/invites` — owner-managed invite codes.
- `POST /api/invites/redeem` — joins org membership via invite code.

### ZK key distribution routes (operationally sensitive)
- `GET /api/orgs/:orgId/zk/status` — reports whether any wrapped keys exist for org.
- `GET /api/orgs/:orgId/zk/wrapped` — returns caller’s latest wrapped org key.
- `POST /api/orgs/:orgId/zk/wrap` — stores wrapped keys (admin+).
- `POST /api/orgs/:orgId/zk/rotate` — bumps org key version and can store wraps (owner).

## 2) Existing helper functions and infra relevant to recovery/lockdown

### Auth/session enforcement helpers
- `requireUser({ env, request })` supports bearer token, cookie token(s), and URL query token (`bf_token`).
- `requireOrgRole({ env, request, orgId, minRole })` role-gates on `org_memberships`.
- `getUserIdFromRequest(request, env)` convenience lookup.
- Session utilities: refresh schema setup, token hashing, cookie issue/clear helpers.

### Error helpers
- `_lib/http.js`: `ok`, `bad`, `err`, `requireMethod`, `readJSON` (default response shape `{ ok: false, error: ... }`).
- `_lib/errors.js`: `ApiError`/`unauthorized`/`forbidden` structured exception path (different envelope).

### Audit/activity helper
- `_lib/activity.js`: `logActivity` best-effort insert into `activity` table; intentionally non-blocking and swallows failures.

## 3) DB inventory relevant to requested scope

In `db/schema.sql`:
- `refresh_tokens` (session persistence)
- `login_mfa_challenges`
- `user_mfa`
- `user_mfa_recovery_codes`
- `org_key_wrapped`
- `org_invites`

Observed in route/runtime code (not all represented in base schema file):
- `org_key_recovery` table is ensured at runtime in recovery/zk helpers.
- Many invite routes use `invites` table name (not `org_invites`).

## 4) Inconsistent auth/session enforcement (current-state findings)

1. **Token source inconsistency risk**: `requireUser` accepts `bf_token` query parameter as authentication input, which is looser than cookie/bearer-only handling and can be used by any route that calls `requireUser`/`requireOrgRole`.
2. **DB binding consistency gap**: several auth routes directly use `env.BF_DB` while others use `getDb()` fallback (`BF_DB|DB|db`). This can produce route-by-route behavior differences in multi-env setups.
3. **Missing DB null-check in `auth/sessions`**: route gets `db = getDb(env)` but does not guard null before `db.prepare(...)`.
4. **Invite schema naming inconsistency**: canonical schema defines `org_invites`, while active invite routes read/write `invites`; this can create environment drift if migration/bootstrap path differs.

## 5) Inconsistent 401/403/error response patterns (current-state findings)

1. **Mixed error envelope styles**:
   - Most backend routes return `_lib/http.bad()` shape (`{ ok:false, error:"CODE" }`).
   - Some shared modules throw `_lib/errors.ApiError` shape (`{ code, message, details }` after normalization).
2. **Mixed semantic error payloads in invite redeem**:
   - Returns free-text messages (`"Missing invite code"`, `"Invite expired"`) with 400 instead of stable code-like strings used elsewhere.
3. **Mixed internal error exposure**:
   - Several handlers return `bad(500, e?.message || ...)`, exposing raw runtime message strings; others return fixed error codes.
4. **401/403 convention mostly consistent in helpers**:
   - `requireUser` => 401, `requireOrgRole` membership/role failures => 403, but routes outside helper paths sometimes diverge in message/code style.

## 6) Missing audit hooks on already-existing sensitive actions

No activity/audit logging was found on several sensitive routes/actions:

- Session security actions:
  - `POST /api/auth/logout_all`
  - `POST /api/auth/logout`
  - `POST /api/auth/refresh`
  - `POST /api/auth/login` and `POST /api/auth/login/mfa` (success/failure security events)
- MFA lifecycle actions:
  - `POST /api/auth/mfa/setup`
  - `POST /api/auth/mfa/confirm`
  - `POST /api/auth/mfa/disable`
- Invite lifecycle actions:
  - `GET|POST|DELETE /api/orgs/:orgId/invites` (create/delete/list)
  - `POST /api/invites/redeem`
- Recovery/key-control actions:
  - `GET|POST|DELETE /api/orgs/:orgId/recovery`
  - `GET|POST|DELETE /api/orgs/:orgId/zk/recovery`
  - `POST /api/orgs/:orgId/zk/rotate`
  - `POST /api/orgs/:orgId/zk/wrap`

Contrast: activity logging exists for non-security CRUD domains like needs/people/inventory/meetings.

## 7) Notes explicitly out of scope for this batch

- No new flows implemented.
- No lockdown/recovery architecture changes proposed in code.
- This is inventory + inconsistency identification only.
