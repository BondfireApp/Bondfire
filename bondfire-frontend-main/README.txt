Bondfire – Patch: remove redundant subnav + use org name on Overview
==================================================================

What this patch changes (base code only):
- Removes the inline text nav ("Overview People Inventory Needs Meetings Settings") from the **Org Overview** page.
- Replaces the "Org space" heading with the actual org's name (resolved from state).

Files to overwrite in your repo:
- src/pages/org/Overview.jsx

How to apply:
1) Unzip and overwrite the file above inside your source tree.
2) Rebuild and deploy as usual.
3) Hard refresh with DevTools → Network → Disable cache.

Generated: 2025-08-17 05:57:03 UTC
