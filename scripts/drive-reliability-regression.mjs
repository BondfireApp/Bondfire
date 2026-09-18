import assert from "node:assert/strict";
import fs from "node:fs";

const drive = fs.readFileSync(new URL("../src/pages/Drive.jsx", import.meta.url), "utf8");
const sidebar = fs.readFileSync(new URL("../src/components/drive/DriveSidebar.jsx", import.meta.url), "utf8");
const privateStore = fs.readFileSync(new URL("../functions/api/_lib/privateStore.js", import.meta.url), "utf8");
const preview = fs.readFileSync(new URL("../src/components/drive/DriveFilePreview.jsx", import.meta.url), "utf8");
const docx = fs.readFileSync(new URL("../src/components/drive/DocxFilePreview.jsx", import.meta.url), "utf8");

assert.match(drive, /const folderIndex = new Map\([\s\S]*ensureFolderChain\(parts, folderIndex\)/, "folder import must reuse one folder index across the entire batch");
assert.match(drive, /Uploaded all \$\{uploaded\} files/, "folder imports must report completion");
assert.match(drive, /onMoveFolder=\{moveFolder\}/, "Drive must wire folder drag moves into the tree");
assert.match(sidebar, /bf_drive_collapsed_v1_/, "tree collapse state must survive rerenders");
assert.match(sidebar, /application\/x-bondfire-drive-item/, "Drive tree must expose drag-and-drop move payloads");
assert.match(sidebar, /onToggle=/, "folder open and collapse actions must be separate");
assert.match(privateStore, /WITH RECURSIVE subtree\(id\)/, "private Drive folder deletion must delete descendants instead of promoting them");
assert.doesNotMatch(privateStore, /UPDATE org_private_records SET parent_id=.*drive\/folders.*drive\/notes.*drive\/files/s, "private folder deletion must not promote children");
assert.match(preview, /DocxFilePreview/, "DOCX must render in the Drive preview");
assert.match(docx, /word\/document\.xml/, "DOCX preview must extract the document body client-side");

console.log("PASS: Drive tree, folder import, recursive deletion, and DOCX preview regressions");
