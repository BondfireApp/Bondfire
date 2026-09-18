import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canApplyStudioRemoteSnapshot,
  cloneStudioElements,
  moveStudioElementsBetweenPages,
  pasteStudioElements,
  syncStudioLegacyRoot,
  updateStudioDocument,
  updateStudioPage,
} from "../src/studio/studioState.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const studioSource = fs.readFileSync(path.join(root, "src/pages/Studio.jsx"), "utf8");

function makeDoc() {
  return syncStudioLegacyRoot({
    id: "doc-1",
    name: "Untitled Flyer",
    preset: "flyer",
    pages: [
      { id: "page-1", width: 1080, height: 1350, background: "#ffffff", guides: [{ id: "g1", orientation: "vertical", position: 100 }], elements: [{ id: "star-1", type: "shape", name: "Star", x: 10, y: 20, width: 100, height: 100 }] },
      { id: "page-2", width: 1080, height: 1350, background: "#111111", guides: [{ id: "g2", orientation: "horizontal", position: 200 }], elements: [{ id: "text-2", type: "text", name: "Page 2", text: "second", x: 30, y: 40, width: 200, height: 80 }] },
    ],
  });
}

// 1. Renaming a document changes document.name, not page state.
{
  const before = makeDoc();
  const after = updateStudioDocument(before, { name: "Meeting Flyer" }, 10);
  assert.equal(after.name, "Meeting Flyer");
  assert.deepEqual(after.pages, before.pages);
  assert.equal(after.pages[0].name, undefined);
}

// 2. Pages keep independent element arrays.
{
  const before = makeDoc();
  const after = updateStudioPage(before, 1, (page) => ({ elements: [...page.elements, { id: "shape-2", type: "shape", x: 5, y: 5 }] }), 20);
  assert.equal(after.pages[0].elements.length, 1);
  assert.equal(after.pages[1].elements.length, 2);
  assert.notStrictEqual(after.pages[0].elements, after.pages[1].elements);
}

// 3. Both active and inactive page render paths must read page.elements.
{
  const pageElementRenders = studioSource.match(/\(page\.elements \|\| \[\]\)\.map/g) || [];
  assert.ok(pageElementRenders.length >= 2, "Studio must render page.elements in both active and inactive page paths");
}

// 4. Editing Page 1 after Page 2 exists still edits Page 1.
{
  const before = makeDoc();
  const after = updateStudioPage(before, 0, { background: "#ff0000" }, 30);
  assert.equal(after.pages[0].background, "#ff0000");
  assert.equal(after.pages[1].background, "#111111");
}

// 5. Paste is element-scoped and cannot replace/delete the document.
{
  const before = makeDoc();
  let n = 0;
  const result = pasteStudioElements(before, 1, [{ id: "clip", type: "shape", x: 3, y: 4 }], { idFactory: () => `paste-${++n}`, offset: 24, now: 40 });
  assert.equal(result.document.id, before.id);
  assert.equal(result.document.name, before.name);
  assert.equal(result.document.pages.length, 2);
  assert.equal(result.document.pages[0].elements.length, 1);
  assert.equal(result.document.pages[1].elements.length, 2);
}

// 6. Repeated paste creates independent unique element IDs.
{
  let n = 0;
  const idFactory = () => `id-${++n}`;
  const clip = [{ id: "source", type: "shape", x: 0, y: 0 }];
  const first = cloneStudioElements(clip, { idFactory });
  const second = cloneStudioElements(clip, { idFactory });
  const third = cloneStudioElements(clip, { idFactory });
  const fourth = cloneStudioElements(clip, { idFactory });
  assert.equal(new Set([first[0].id, second[0].id, third[0].id, fourth[0].id]).size, 4);
}

// 7. Cross-page move transfers an element between page arrays and keeps identity/content.
{
  const before = makeDoc();
  const moved = moveStudioElementsBetweenPages(before, 0, 1, ["star-1"], { deltaX: 50, deltaY: 60, now: 50 });
  assert.equal(moved.document.pages[0].elements.some((el) => el.id === "star-1"), false);
  const target = moved.document.pages[1].elements.find((el) => el.id === "star-1");
  assert.ok(target);
  assert.equal(target.name, "Star");
  assert.equal(target.x, 60);
  assert.equal(target.y, 80);
}

// 8. Page backgrounds remain independent.
{
  const before = makeDoc();
  const after = updateStudioPage(before, 1, { background: "#00ff00" }, 60);
  assert.equal(after.pages[0].background, "#ffffff");
  assert.equal(after.pages[1].background, "#00ff00");
}

// 9. Guides remain page-specific.
{
  const before = makeDoc();
  const after = updateStudioPage(before, 1, (page) => ({ guides: [...page.guides, { id: "g3", orientation: "vertical", position: 300 }] }), 70);
  assert.deepEqual(after.pages[0].guides.map((guide) => guide.id), ["g1"]);
  assert.deepEqual(after.pages[1].guides.map((guide) => guide.id), ["g2", "g3"]);
}

// 10. A stale hydration response cannot overwrite newer or unsynced local edits.
{
  assert.equal(canApplyStudioRemoteSnapshot({ requestLocalRevision: 2, currentLocalRevision: 3, syncedLocalRevision: 2 }), false);
  assert.equal(canApplyStudioRemoteSnapshot({ requestLocalRevision: 3, currentLocalRevision: 3, syncedLocalRevision: 2 }), false);
  assert.equal(canApplyStudioRemoteSnapshot({ requestLocalRevision: 3, currentLocalRevision: 3, syncedLocalRevision: 3, hasActiveInteraction: true }), false);
  assert.equal(canApplyStudioRemoteSnapshot({ requestLocalRevision: 3, currentLocalRevision: 3, syncedLocalRevision: 3, hasActiveInteraction: false }), true);
}

// Clipboard group relationships survive cloning, but are detached from the source group IDs.
{
  let n = 0;
  const cloned = cloneStudioElements([
    { id: "a", type: "shape", groupId: "group-original", x: 0, y: 0 },
    { id: "b", type: "shape", groupId: "group-original", x: 20, y: 20 },
  ], { idFactory: () => `new-${++n}`, offset: 24 });
  assert.notEqual(cloned[0].groupId, "group-original");
  assert.equal(cloned[0].groupId, cloned[1].groupId);
  assert.notEqual(cloned[0].id, cloned[1].id);
}

// Source-level guardrails for the editor wiring itself.
assert.match(studioSource, /updateStudioDocument\(doc, patch\)/, "document metadata must use updateStudioDocument");
assert.match(studioSource, /updateStudioPage\(doc, activePageIndex, patch\)/, "page properties must use updateStudioPage");
assert.match(studioSource, /getPageTargetAtClientPoint/, "cross-page dragging must hit-test page DOM bounds");
assert.match(studioSource, /New design/, "Studio must expose a primary New design flow");
assert.match(studioSource, /\/logos\/studio\.svg/, "Studio module surfaces must use the graphic-design Studio SVG");
assert.match(studioSource, /setFuture\(\(f\) => \[clone\(docs\), \.\.\.f\]\);\s*markStudioLocalEdit\(\);\s*setDocs\(last\);/, "undo must advance the local Studio revision before restoring state");
assert.match(studioSource, /setHistory\(\(h\) => \[\.\.\.h, clone\(docs\)\]\);\s*markStudioLocalEdit\(\);\s*setDocs\(first\);/, "redo must advance the local Studio revision before restoring state");

console.log("Studio editor regression checks passed.");
