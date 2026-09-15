# Bondfire v4 (locked)

**Date:** 2025-08-13

### UI
- Floating header converted to **solid red buttons with white text** to match brand.
- Global top padding added so content never hides under the floating header.
- Legacy bottom nav hidden everywhere.

### Routing
- Legacy hashes like `#/dashboard`, `#/people`, etc. now auto-redirect to the correct org-scoped routes.
- Header links always resolve to `#/o/<orgId>/*`.

### Files included (add/overwrite only)
- `src/components/AppHeader.jsx` (v4 header)
- `src/fixes/legacyRedirects.js`
- `src/fixes/hideBottomNav.js`
- `VERSION` = v4
