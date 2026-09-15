# BrandBar (non-floating) — v4 add-on

This patch adds a **non-floating top header** with the Bondfire name and a logo.
It does not change the floating red nav; it simply adds a brand strip above it.

## Files
- `src/fixes/brandBarMount.js` — Injects the header at the top of `<body>` on load.
- `public/bondfire-logo.svg` — Placeholder logo you can replace with your own.

## Install
1) Unzip into your project root.
2) Ensure `src/main.jsx` imports the script (add this line if missing):
   ```js
   import './fixes/brandBarMount.js'
   ```
3) Restart dev: `npm run dev`

## Custom logo
Replace `/public/bondfire-logo.svg` with your logo (`.svg` or `.png` is fine).
If no file is present, the image hides and the text “Bondfire” remains.
