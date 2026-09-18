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
assert.match(sidebar, /createPortal/, "Drive action menus must escape the scroll container");
assert.match(sidebar, /spaceBelow < estimatedHeight/, "Drive action menus must flip upward near the bottom edge");
assert.match(sidebar, /data-pop-direction/, "Drive action menus must expose their chosen pop direction");
assert.match(sidebar, /file\.textContent/, "Drive search must include editable text-file contents");
assert.match(sidebar, /onToggle=/, "folder open and collapse actions must be separate");
assert.match(privateStore, /WITH RECURSIVE subtree\(id\)/, "private Drive folder deletion must delete descendants instead of promoting them");
assert.doesNotMatch(privateStore, /UPDATE org_private_records SET parent_id=.*drive\/folders.*drive\/notes.*drive\/files/s, "private folder deletion must not promote children");
assert.match(preview, /DocxFilePreview/, "DOCX must render in the Drive preview");
assert.match(drive, /isBondfireTemplateFile[\s\S]*drive\/templates/, "Drive uploads must import .bftemplate files into the Templates pane");
assert.match(docx, /word\/document\.xml/, "DOCX preview must extract the document body client-side");
const sheet = fs.readFileSync(new URL("../src/components/drive/SpreadsheetFileView.jsx", import.meta.url), "utf8");
assert.match(sheet, /Delete row/, "Drive sheets must support row deletion");
assert.match(sheet, /Delete column/, "Drive sheets must support column deletion");
assert.match(sheet, /Insert row above/, "Drive sheets must support row insertion");
assert.match(sheet, /rewriteFormulaReferences/, "Drive sheet structural edits must rewrite formula references");

console.log("PASS: Drive tree, folder import, recursive deletion, and DOCX preview regressions");
