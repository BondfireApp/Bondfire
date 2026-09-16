import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import HostedDomainEntry from "./components/HostedDomainEntry.jsx";
import "./index.css";
import "./v3-theme.css";
import "./debug/initDebug.js";

// Temporary hard reset of stale PWA/service-worker state.
// The current repo is configured to keep SW updates until the next reload,
// which can leave you testing an older cached bundle while replacing Studio.jsx.
try {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
      } catch {}
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
      } catch {}
    });
  }
} catch {}

try {
  const stamp = new Date().toISOString();
  console.log("BONDFIRE build:", stamp);
  window.__BF_BUILD = stamp;
} catch {}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HostedDomainEntry>
      <App />
    </HostedDomainEntry>
  </React.StrictMode>
);
