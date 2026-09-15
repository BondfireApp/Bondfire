# Thread 4: Events Backend Completion Spec

## Decision
Stop frontend usability implementation and return a backend completion spec.

## Why this is required
- The existing Events page calls `GET /api/orgs/:orgId/events`, but the org API folder currently has no `events` endpoint implementation.
- Without this backend, the Events page cannot reliably support list/create/refresh flows.

## Missing endpoint files
### Required
- `functions/api/orgs/[orgId]/events.js`

### Optional (only if the repo already prefers resource-id routes)
- `functions/api/orgs/[orgId]/events/[eventId].js`

## Required method support
Implement in `functions/api/orgs/[orgId]/events.js`:

- `onRequestGet`
  - Auth: `requireOrgRole(..., minRole: "viewer")`
  - Behavior: list events for org
  - Response shape: `json({ ok: true, events: [...] })`

- `onRequestPost`
  - Auth: `requireOrgRole(..., minRole: "member")`
  - Behavior: create event
  - Validation: require non-empty `title`
  - Response shape: `json({ ok: true, id })`

Optional, only if clearly aligned with existing module patterns:
- `onRequestPut`
  - Auth: `requireOrgRole(..., minRole: "member")`
  - Behavior: update event by `id`

## Expected backend style (match current org module APIs)
Use the same primitives and conventions as current org modules:
- Helpers: `json`, `bad`, `now`, `uuid` from `functions/api/_lib/http.js`
- Auth guard: `requireOrgRole` from `functions/api/_lib/auth.js`
- Database: `env.BF_DB`
- Additive schema guards in-file (`CREATE TABLE IF NOT EXISTS ...`, `ALTER TABLE ...` in try/catch)
- No auth/session redesign

## Minimum event schema/fields
Store and return:
- `id`
- `org_id`
- `title`
- `starts_at`
- `ends_at`
- `location`
- `description`
- `created_at`
- `updated_at`

Suggested table guard in endpoint:
- `events` with `(id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT NOT NULL, starts_at INTEGER, ends_at INTEGER, location TEXT, description TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
- Useful index: `(org_id, starts_at)`

## API behavior details
### GET list
- SQL: `SELECT id, title, starts_at, ends_at, location, description, created_at, updated_at FROM events WHERE org_id = ? ORDER BY starts_at DESC, created_at DESC`
- Return empty array when none.

### POST create
- Parse JSON body safely.
- `title`: trim and require.
- `starts_at`/`ends_at`: allow numeric timestamps; if missing, default `starts_at = now()`, `ends_at = starts_at`.
- `location` and `description`: optional strings, default empty string.
- Generate `id = uuid()` and timestamps from `now()`.

### Error handling
- Use `bad(400, "MISSING_TITLE")` for validation failures.
- Let unexpected errors return platform defaults (consistent with existing handlers) unless existing module pattern wraps them.

## Frontend impact after backend is added
Once the endpoint above exists, `src/pages/modules/Events.jsx` can be updated in-place (no route/nav changes) to provide:
- list events
- create event form (title, starts_at, ends_at, location, description)
- useful empty state
- refresh after create
- clear API error states

No router/nav/auth/dashboard/security changes are required for that follow-up frontend pass.
