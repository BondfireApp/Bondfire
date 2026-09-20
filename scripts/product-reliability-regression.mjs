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
  ["organization pill returns to the current org dashboard", "src/components/AppHeader.jsx", /bf-globalOrgPill[\s\S]*\/org\/\$\{encodeURIComponent\(orgId\)\}\/overview/],
  ["FireChat navigation targets the real chat route", "src/components/AppHeader.jsx", /label: "FireChat"[\s\S]*to: `\$\{base\}\/chat`[\s\S]*moduleId: "bondfire-chat"/],
  ["private organizations allow the real FireChat route", "src/components/PrivateOrgBoundary.jsx", /witness\|chat\|chat-module\|studio/],
  ["FireChat restores recovery-code-first verification", "src/pages/BondfireChat.jsx", /decodeRecoveryKey[\s\S]*verifyWithRecoveryKey[\s\S]*Verify with recovery code[\s\S]*Verify with emoji instead/],
  ["FireChat secret storage uses the entered recovery key", "src/pages/BondfireChat.jsx", /cryptoCallbacks:[\s\S]*getSecretStorageKey[\s\S]*recoveryKeyRef\.current/],
  ["FireChat uses device-scoped Rust crypto storage", "src/pages/BondfireChat.jsx", /initRustCrypto\(\{[\s\S]*cryptoDatabasePrefix: `bf_mx_crypto_\$\{uidSafe\}_\$\{deviceSafe\}`[\s\S]*useIndexedDB: true/],
  ["FireChat recognizes Matrix cross-signing truth", "src/pages/BondfireChat.jsx", /res\.crossSigningVerified === true/],
  ["settings remain directly reachable", "src/components/AppHeader.jsx", /Organization settings/],
  ["settings resolves private mode from the organization", "src/pages/Settings.jsx", /setDetectedPrivateMode[\s\S]*\/privacy[\s\S]*state[\s\S]*!== "off"/],
  ["newsletter delivery status is independent from public settings load", "src/pages/Settings.jsx", /Promise\.allSettled[\s\S]*newsletter\/delivery[\s\S]*public\/get[\s\S]*setNlDeliveryStatus/],
  ["newsletter status distinguishes load failure from missing Resend config", "src/pages/Settings.jsx", /Resend status unavailable/],
  ["newsletter status still reports genuine missing Resend configuration", "src/pages/Settings.jsx", /Resend not configured/],
  ["newsletter subscriber loading fails closed for private storage", "src/pages/Settings.jsx", /const privateActive = String\(privacy\?\.state \|\| "off"\) !== "off"[\s\S]*setNewsletterPrivateMode\(true\)[\s\S]*newsletter\/subscribers/],
  ["public inbox only accepts actionable intake and RSVP submission types", "src/lib/privateClient.js", /PUBLIC_INBOX_SUBMISSION_TYPES=new Set\(\['intake','rsvp'\]\)/],
  ["public inbox filters encrypted submissions before rendering", "src/lib/privateClient.js", /originals\.filter\(isPublicInboxSubmission\)/],
  ["private settings avoid legacy plaintext newsletter routes", "src/pages/Settings.jsx", /if \(!privateMode\)[\s\S]*\/newsletter/],
  ["private client allows newsletter delivery operational route", "src/lib/privateClient.js", /newsletter\/delivery/],
  ["private client allows newsletter send operational route", "src/lib/privateClient.js", /newsletter\/send/],
  ["encrypted member profiles are self-service", "src/pages/Settings.jsx", /encryptWithOrgKey[\s\S]*body: \{ userId: membersMeUserId, encrypted_blob: encryptedBlob \}/],
  ["member directory prefers profile names over raw account ids", "src/pages/Settings.jsx", /memberDisplayName[\s\S]*<th>Member<\/th>[\s\S]*<th>Contact<\/th>/],
  ["member profile stays reachable from global navigation", "src/components/AppHeader.jsx", /settings\?tab=profile[\s\S]*label="My profile"/],
  ["private organization boundary allows the profile settings tab", "src/components/PrivateOrgBoundary.jsx", /\['security','members','profile','invites','pledges','public','public-inbox','newsletter'\]/],
  ["member profile writes remain self-or-admin authorized", "functions/api/orgs/[orgId]/members.js", /hasZkUpdate[\s\S]*if \(!isSelf && !isAdminish\) return bad\(403, "ADMIN_REQUIRED"\)/],
  ["private member profile ciphertext passes the private request gate", "functions/api/_lib/privateGate.js", /encryptedProfile[\s\S]*isMembershipCiphertext\(b\.encrypted_blob\)[\s\S]*return null/],
  ["support remains reachable from global navigation", "src/components/AppHeader.jsx", /\/support/],
  ["native Colophon keeps image logo upload", "src/modules/colophon/ColophonNativeModule.jsx", /NativeLogoUploadBridge/],
  ["native Colophon keeps publication-site routing separate", "src/modules/colophon/ColophonNativeModule.jsx", /ColophonPublicLinkGuard/],
  ["encrypted Colophon accepts hosted collection and item content aliases", "src/modules/colophon/privateColophonRuntime.js", /contentPath = path\.match\(\/\^\(\?:native-content\|content\)\(\?:\\\/\(\[\^\/\]\+\)\)\?\$\/[\s\S]*contentUrl\.searchParams\.set\("id", contentPath\[1\]\)[\s\S]*revisionsPath = path\.match\(\/\^\(\?:native-content-revisions\|content-revisions\)/],
  ["encrypted Colophon marks internal ciphertext transport", "src/modules/colophon/privateColophonRuntime.js", /__bf_colophon_storage=1/],
  ["Colophon bridge bypasses internal ciphertext transport", "src/modules/colophon/ColophonNativeModule.jsx", /internalPrivateStorage[\s\S]*__bf_colophon_storage[\s\S]*return originalFetch/],
  ["Colophon bridge preserves private-storage marker to the server", "src/modules/colophon/ColophonNativeModule.jsx", /internalPrivateStorage[\s\S]*Keep the marker on the server-bound request[\s\S]*return originalFetch/],
  ["Colophon gateway delegates marked storage to the private gate", "functions/api/orgs/[orgId]/colophon/[[path]].js", /__bf_colophon_storage[\s\S]*privateRequestGate[\s\S]*PRIVATE_STORAGE_ROUTE_UNAVAILABLE/],
  ["encrypted Colophon update lookups preserve the ciphertext-storage marker", "src/lib/privateClient.js", /route\.url\.searchParams\.get\('__bf_colophon_storage'\)[\s\S]*__bf_colophon_storage=1[\s\S]*transport\(currentPath\)/],
  ["Colophon dark-mode admin notices remain readable", "src/modules/colophon/colophon-native.css", /wp-admin-notices \.wp-notice[\s\S]*background: #15191d !important[\s\S]*wp-notice--error[\s\S]*#ffd7d7/],
  ["encrypted Colophon serializes writes per post", "src/modules/colophon/privateColophonRuntime.js", /contentWriteLocks[\s\S]*withContentWriteLock[\s\S]*const writeKey = `\$\{orgId\}:\$\{id\}`/],
  ["encrypted Colophon rebases same-tab autosave conflicts only", "src/modules/colophon/privateColophonRuntime.js", /recentContentWrites[\s\S]*note === "autosave"[\s\S]*locallyAdvanced[\s\S]*Reload the latest version before saving over it/],
  ["encrypted Colophon trash actions preserve the latest post body", "src/modules/colophon/privateColophonRuntime.js", /statusOnlyMutation[\s\S]*bulk trash[\s\S]*incomingForSave[\s\S]*workflowState/],
  ["encrypted Colophon keeps Trash status when a member trashes a published post", "src/modules/colophon/privateColophonRuntime.js", /const demotePublishedEdit = !statusOnlyMutation[\s\S]*rank < 2[\s\S]*published[\s\S]*const status = demotePublishedEdit \? "draft" : requestedStatus/],
  ["Colophon post-list controls keep dark-mode contrast", "src/modules/colophon/colophon-native.css", /wp-view-tab[\s\S]*background: #15191d !important[\s\S]*wp-posts-table/],
  ["Bondfire pins Colophon with real trash and permanent deletion", "package.json", /colophon\/archive\/639561cd7a56d6c6d410767b43c0f0f4a28442eb\.tar\.gz/],
  ["Colophon Posts hides trash from All", "node_modules/colophon/src/components/ContentListPage.jsx", /tab === 'all' && bucket === 'trash'/],
  ["Colophon Posts exposes permanent deletion", "node_modules/colophon/src/components/ContentListPage.jsx", /deleteNativeEntry[\s\S]*permanentlyDelete[\s\S]*Delete Permanently/],
  ["Colophon Empty Trash performs real deletes", "node_modules/colophon/src/components/ContentListPage.jsx", /async function emptyTrash[\s\S]*deleteNativeEntry/],
  ["Colophon domain management lives in Settings", "src/modules/colophon/ColophonNativeModule.jsx", /NativePublicationDomainSettingsBridge[\s\S]*data-bondfire-publication-domain-settings[\s\S]*PublicDomainCard orgId=\{orgId\} surface="publication" compactWhenLive/],
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
  ["dashboard metrics use module logos instead of abbreviations", "src/pages/Overview.jsx", /ModuleLogo[\s\S]*\/logos\/inventory\.png[\s\S]*\/logos\/needs\.png[\s\S]*\/logos\/meetings\.png[\s\S]*\/logos\/pledges\.png/],
  ["dashboard has dedicated people and newsletter logos", "src/pages/Overview.jsx", /\/logos\/people\.svg[\s\S]*\/logos\/newsletter\.svg/],
  ["private dashboard loads encrypted collections in parallel", "src/lib/privateClient.js", /tail===\'dashboard\'[\s\S]*const loadKind[\s\S]*Promise\.all\(\[/],
  ["private dashboard reuses one submissions decrypt", "src/lib/privateClient.js", /const submissionPromise=admin\?submissions\(\):Promise\.resolve\(\[\]\)/],
  ["dashboard metric abbreviations are removed", "src/pages/Overview.jsx", /mk\(\"people\", \"People\", \"\/logos\/people\.svg\"/],
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

for (const file of ["public/logos/people.svg", "public/logos/newsletter.svg"]) {
  const content = read(file).trimStart();
  if (!content.startsWith("<svg") || !content.includes("</svg>")) {
    failed = true;
    console.error(`FAIL: dashboard logo is not valid SVG markup (${file})`);
  } else {
    console.log(`PASS: dashboard logo contains SVG markup (${file})`);
  }
}


const colophonWrapperSource = read("src/pages/Colophon.jsx");
if (/PublicDomainCard/.test(colophonWrapperSource)) {
  failed = true;
  console.error("FAIL: Colophon still renders publication-domain controls above every screen");
} else {
  console.log("PASS: Colophon no longer renders publication-domain controls above every screen");
}

const appHeaderSource = read("src/components/AppHeader.jsx");
if (/label: "Module Chat"|nav-chat-module/.test(appHeaderSource)) {
  failed = true;
  console.error("FAIL: legacy Module Chat still appears in global navigation");
} else {
  console.log("PASS: legacy Module Chat is removed from global navigation");
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
