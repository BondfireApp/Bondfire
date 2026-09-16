import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const checks = [
  ["builder selections persist across auth", "src/platform/pendingBuild.js", /PENDING_BUILD_NAME_KEY/],
  ["invite state persists across auth", "src/pages/SignIn.jsx", /bf_pending_invite_v1/],
  ["invite creator sends the selected role", "src/pages/Settings.jsx", /body: \{ role: inviteRole, expiresInDays: 14, maxUses: 1 \}/],
  ["invite selector offers viewer member and admin", "src/pages/Settings.jsx", /option value="viewer"[\s\S]*option value="member"[\s\S]*option value="admin"/],
  ["invite redemption applies the stored role", "functions/api/invites/redeem.js", /viewer","member","admin"[\s\S]*org_memberships\(org_id,user_id,role,created_at\)/],
  ["validated org target survives sign-in", "src/pages/SignIn.jsx", /ORG_ID_RE[\s\S]*requestedOrgId[\s\S]*\/overview/],
  ["global header hydrates encrypted organization identity", "src/components/AppHeader.jsx", /loadOrgIdentity\(orgId\)/],
  ["settings hydrates encrypted organization identity", "src/pages/Settings.jsx", /loadOrgIdentity\(orgId\)/],
  ["organization dashboard hydrates encrypted identities", "src/pages/OrgDash.jsx", /hydrateOrgList\(list\)/],
  ["global reliability styles are loaded", "src/AppRoot.jsx", /reliability\.css/],
  ["mobile overflow guard exists", "src/reliability.css", /overflow-x:\s*clip/],
  ["reduced motion is respected", "src/reliability.css", /prefers-reduced-motion:\s*reduce/],
  ["global nav uses the approved core logo", "src/components/AppHeader.jsx", /\/logos\/core\.png/],
  ["settings remain directly reachable", "src/components/AppHeader.jsx", /Organization settings/],
  ["support remains reachable from global navigation", "src/components/AppHeader.jsx", /\/support/],
  ["native Colophon keeps image logo upload", "src/modules/colophon/ColophonNativeModule.jsx", /NativeLogoUploadBridge/],
  ["native Colophon keeps publication-site routing separate", "src/modules/colophon/ColophonNativeModule.jsx", /ColophonPublicLinkGuard/],
  ["live Colophon domains collapse out of the editor", "src/pages/Colophon.jsx", /compactWhenLive/],
  ["domain manager exposes an explicit live-domain toggle", "src/components/PublicDomainCard.jsx", /Manage domain[\s\S]*Hide domain settings/],
  ["private organization boundary allows encrypted Colophon", "src/components/PrivateOrgBoundary.jsx", /studio\|colophon/],
  ["public organization pages set organization browser branding", "src/pages/OrganizingPublicPage.jsx", /usePublicDocumentBrand/],
  ["public publications set publication browser branding", "src/pages/PublicPublicationPage.jsx", /brandManifest[\s\S]*usePublicDocumentBrand/],
  ["Red Harbor exposes the recovered labor-history archive", "src/pages/OrganizingPublicPage.jsx", /LaborHistoryArchive/],
  ["Bulletin public theme forces readable heading contrast", "src/styles/publication-public.css", /bf-publication-main h1[\s\S]*color:#171717!important/],
  ["verified routed domains suppress irrelevant SaaS quota errors", "src/components/PublicDomainCard.jsx", /quotaLimitedExisting[\s\S]*existing routing/],
  ["custom-host resolver self-heals stale verification on live host", "functions/api/public/domain.js", /setPublicSiteDomainVerification[\s\S]*requestUrl\.hostname/],
  ["support exposes a maintainer contact", "src/pages/Support.jsx", /support@bondfireapp\.org/],
  ["support has safe network failure guidance", "src/pages/Support.jsx", /server could not be reached/i],
  ["organization REC route reuses the real capture app", "src/App.jsx", /witness\/capture[\s\S]*PublicCapture[\s\S]*embedded/],
  ["REC archive launches video capture", "src/pages/modules/WitnessArchive.jsx", /witness\/capture[\s\S]*New recording/],
  ["REC capture requests camera and microphone", "src/pages/PublicCapture.jsx", /getUserMedia[\s\S]*audio: true[\s\S]*video:/],
  ["organization REC stores archive locator without recovery phrase", "src/pages/PublicCapture.jsx", /tags: \["rec", "video", `archive:\$\{nextRecordingId\}`\]/],
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


const recArchiveSource = read("src/pages/modules/WitnessArchive.jsx");
if (/Create witness record|setDraft\(|placeholder="Summary"/.test(recArchiveSource)) {
  failed = true;
  console.error("FAIL: REC module still exposes the obsolete note-taking creator");
} else {
  console.log("PASS: REC module no longer exposes the obsolete note-taking creator");
}

const laborManifest = JSON.parse(read("public/red-harbor/labor-history/manifest.json"));
const laborPages = (laborManifest.collections || []).reduce((sum, collection) => sum + (collection.pages || []).length, 0);
if (laborManifest.collections?.length !== 5 || laborPages !== 203) {
  failed = true;
  console.error(`FAIL: Red Harbor labor archive completeness (collections=${laborManifest.collections?.length || 0}, pages=${laborPages})`);
} else {
  console.log("PASS: Red Harbor labor archive completeness (5 collections, 203 pages)");
}

if (failed) process.exit(1);
console.log(`Product reliability regression checks passed (${checks.length}).`);
