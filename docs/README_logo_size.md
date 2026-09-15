# Adjust brand logo size (no code editor needed)

After applying this patch, you can change the logo size three ways:

### 1) URL (quick)
Put `logosize` before the `#` and hit enter:
```
http://localhost:5173/?logosize=28#/public
```
Accepts `px`, `%`, or `rem` (default is `px` if omitted).

### 2) Browser Console
Open DevTools → Console:
```js
bfSetLogoSize(28)          // 28px
bfSetLogoSize('32px')      // explicit unit
bfSetLogoSize('2.2rem')    // any CSS size
```

### 3) Reset to default
```js
bfSetLogoSize(24)
```

> The size persists via localStorage, so it sticks across reloads.
