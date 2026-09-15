# Brand bar color controls (no editor needed)

This patch lets you change the **gray nav background** color without opening files.

## 1) Change via URL (quick)
Put colors in the URL *before the hash* and hit enter:
```
http://localhost:5173/?topfill=%23121212&brandbar=%23121212#/public
```
It saves to localStorage and sticks across reloads.

## 2) Change via console
Open DevTools → Console and run:
```js
bfSetBrandColors('#121212', '#121212')
```
(First is the gray *behind the floating pills*, second is the *brand bar*.)

## Notes
- Defaults if unset: `#0f0f0f` for both.
- Values are standard CSS colors (hex, rgb(), rgba(), etc.).
- You can still drop your own logo at `/public/logo-bondfire.png`.
