import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const checks = [
  ["builder selections persist across auth", "src/platform/pendingBuild.js", /PENDING_BUILD_NAME_KEY/],
  ["invite state persists across auth", "src/pages/SignIn.jsx", /bf_pending_invite_v1/],
  ["global reliability styles are loaded", "src/AppRoot.jsx", /reliability\.css/],
  ["mobile overflow guard exists", "src/reliability.css", /overflow-x:\s*clip/],
  ["reduced motion is respected", "src/reliability.css", /prefers-reduced-motion:\s*reduce/],
  ["global nav uses the approved core logo", "src/components/AppHeader.jsx", /\/logos\/core\.png/],
  ["settings remain directly reachable", "src/components/AppHeader.jsx", /Organization settings/],
  ["support remains reachable from global navigation", "src/components/AppHeader.jsx", /\/support/],
  ["native Colophon keeps image logo upload", "src/modules/colophon/ColophonNativeModule.jsx", /NativeLogoUploadBridge/],
  ["native Colophon keeps publication-site routing separate", "src/modules/colophon/ColophonNativeModule.jsx", /ColophonPublicLinkGuard/],
  ["support exposes a maintainer contact", "src/pages/Support.jsx", /support@bondfireapp\.org/],
  ["support has safe network failure guidance", "src/pages/Support.jsx", /server could not be reached/i],
  ["PWA runs standalone", "public/manifest.webmanifest", /"display"\s*:\s*"standalone"/],
  ["PWA manifest keeps install icons", "public/manifest.webmanifest", /icon-512-maskable\.png/],
];

let failed = false;
for (const [label, file, pattern] of checks) {
  const content = read(file);
  if (!pattern.test(content)) {
    failed = true;
    console.error(`FAIL: ${label} (${file})`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

if (failed) process.exit(1);
console.log(`Product reliability regression checks passed (${checks.length}).`);
