import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const commitSha =
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  "development";

export default defineConfig({
  define: {
    __BONDFIRE_COMMIT_SHA__: JSON.stringify(commitSha),
  },

  plugins: [
    react(),

    VitePWA({
      // existing config
    }),
  ],
});

// Key change:
// - Do NOT precache index.html (or any HTML) in the service worker.
//   Precached HTML is the #1 cause of "Frankenbuilds" (new JS + old HTML or vice versa),
//   which shows up as random app resets, broken crypto stores, and "crypto not ready".
// - Also remove SW navigation fallback. You are using hash routing, so the server can
//   always serve /index.html without the SW trying to be clever.

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "robots.txt", "apple-touch-icon.png"],
      manifest: {
        name: "Bondfire",
        short_name: "Bondfire",
        description: "Mutual aid org management",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0b0b0f",
        theme_color: "#0b0b0f",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        // IMPORTANT:
        // Do not let Workbox serve HTML for navigations. HashRouter doesn't need it,
        // and SW-controlled HTML is what causes the "blink/reset" + stale builds.
        navigateFallback: undefined,

        // Only precache immutable hashed assets. NO html.
        globPatterns: ["**/*.{js,css,ico,png,svg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,

        // Keep update behavior conservative. No surprise takeovers mid-session.
        clientsClaim: false,
        skipWaiting: false,

        cleanupOutdatedCaches: true,
      }
    })
  ]
});
