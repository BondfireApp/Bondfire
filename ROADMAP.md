# Bondfire v3 Roadmap Tracker

**Locked Stable:** v3 (`2025-08-12`)

This file is the single source of truth for what's planned and what's done. Only add to this file—don't rewrite history.

---

## Phase 0 – Lock & Backup (Now)
- [x] Confirm v3 build is stable and backed up
- [x] Store a clean untouched copy of `/bondfire-version-3-full-rebuild.zip` in archive for quick rollback
- [x] Document current features and known quirks

## Phase 1 – Core UI/Nav Cleanup
**Goal:** Nail top nav and dashboards before touching data logic.
- [ ] Remove all leftover bottom nav code
- [ ] Make top nav bar fully floating with **Dashboard / People / Inventory / Needs / Meetings / Settings** in red
- [ ] Ensure no hidden references to removed nav elements
- [ ] Fix org summary card so each org has its own display logic (no cross-updates)
- [ ] Smoke test all views for layout breakage

### Acceptance Criteria
- [ ] No bottom nav visible or referenced in code
- [ ] Top nav renders correctly on every route
- [ ] Org summary cards do not mirror or bleed data
- [ ] No console errors related to removed nav

## Phase 2 – Data Integrity & Cross-Org Fixes
**Goal:** Kill any “data bleed” and validate correct scoping.
- [ ] Audit each dashboard widget to confirm it only pulls the current org’s data
- [ ] Verify Create/Edit forms only mutate relevant org records
- [ ] Add guardrails to prevent cross-org writes (e.g., orgId assertions)
- [ ] Add unit tests for scoping on key modules (People, Inventory, Needs)

### Acceptance Criteria
- [ ] All widgets pass scoped data checks
- [ ] CRUD ops verify orgId before write
- [ ] Tests in place and passing

## Phase 3 – Feature Restoration from Pre‑v3
**Goal:** Bring back prior working features without destabilizing v3.
- [ ] Advanced filters for People, Inventory, Needs
- [ ] Meeting notes with attachments (if previously working)
- [ ] Quick‑add buttons for Inventory and Needs
- [ ] QoL: search highlighting, inline edits

### Acceptance Criteria
- [ ] Filters persist per session
- [ ] Notes and attachments save+load without errors
- [ ] Quick‑add flows work from dashboard and module pages

## Phase 4 – New Features & UX Improvements
**Goal:** Carefully add the good stuff.
- [ ] Roles & permissions (Admin/Staff/Volunteer)
- [ ] Bulk upload for People/Inventory (CSV)
- [ ] Needs tracking: statuses + tagging
- [ ] Dashboard custom widgets (per user)

### Acceptance Criteria
- [ ] Permission matrix enforced on routes and actions
- [ ] Bulk upload validates + rolls back on error
- [ ] Needs have lifecycle states + filters
- [ ] Users can pick/hide dashboard widgets

## Phase 5 – Final Polish & Release
**Goal:** Production‑ready build with clean presentation.
- [ ] Bug sweep and triage board cleared
- [ ] Performance: lazy loading, caching
- [ ] Theme options: light/dark/red punk
- [ ] Final deployment package
- [ ] Quick‑start guide added to repo

---

## Work Log
_Add notes here as we go. Newest on top._

- `2025-08-12` – Roadmap tracker added to repo (ROADMAP.md, CHANGELOG.md, /docs).

