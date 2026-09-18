# Apply v4 patch
Unzip into your project root (folder that contains `src/`). Overwrite files when prompted.

Ensure `src/main.jsx` imports:
```js
import './fixes/removeSubheader.js'
import './fixes/legacyRedirects.js'
import './fixes/hideBottomNav.js'
```
Then restart dev: `npm run dev`
