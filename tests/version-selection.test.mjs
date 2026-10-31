import assert from "node:assert/strict";
import test from "node:test";
import { deleteOutlineVersion, resolvedOutlineContent, selectOutlineVersion } from "../lib/outline-content.ts";

const now = "2026-10-24T00:00:00.000Z";
function fixture() {
  return {
    content: "直接保存正文", currentVersionId: null, defaultVersionId: null,
    versions: [
      { id: "newest", content: "最新正文", createdAt: "2026-10-23T00:00:00Z" },
      { id: "old", content: "较早正文", createdAt: "2026-10-21T00:00:00Z" },
      { id: "middle", content: "中间正文", createdAt: "2026-10-22T00:00:00Z" },
    ],
  };
}

test("deleting current advances in list order regardless of selection history", () => {
  let outline = fixture();
  for (const id of ["old", "middle", "newest"]) outline = selectOutlineVersion(outline, id, now);
  outline = structuredClone(outline);
  outline = deleteOutlineVersion(outline, "newest", now);
  assert.equal(outline.currentVersionId, "old");
  assert.equal(resolvedOutlineContent(outline), "较早正文");
  outline = deleteOutlineVersion(outline, "old", now);
  assert.equal(outline.currentVersionId, "middle");
  assert.equal(resolvedOutlineContent(outline), "中间正文");
  outline = deleteOutlineVersion(outline, "middle", now);
  assert.equal(outline.currentVersionId, null);
  assert.equal(resolvedOutlineContent(outline), "直接保存正文");
});

test("deleting the last item wraps to the first remaining version", () => {
  const initial = { ...fixture(), currentVersionId: "old" };
  const selected = selectOutlineVersion(initial, "middle", now);
  assert.equal(deleteOutlineVersion(selected, "middle", now).currentVersionId, "newest");
  assert.equal(initial.versions.some((version) => version.lastSelectedAt), false);
});

test("without selection history deletion still uses list order", () => {
  const outline = { ...fixture(), currentVersionId: "newest" };
  assert.equal(deleteOutlineVersion(outline, "newest", now).currentVersionId, "old");
});

test("deleting a default version clears its default marker and keeps other current versions", () => {
  let outline = selectOutlineVersion(fixture(), "old", now);
  outline = selectOutlineVersion(outline, "middle", now);
  outline = deleteOutlineVersion(outline, "old", now);
  assert.equal(outline.currentVersionId, "middle");
  assert.equal(deleteOutlineVersion(outline, "middle", now).currentVersionId, "newest");
  const defaultOutline = { ...outline, defaultVersionId: "newest" };
  const deleted = deleteOutlineVersion(defaultOutline, "newest", now);
  assert.equal(deleted.defaultVersionId, null);
  assert.equal(deleted.currentVersionId, "middle");
  assert.deepEqual(deleted.versions.map((version) => version.id), ["middle"]);
  assert.equal(deleteOutlineVersion(outline, "missing", now), outline);
  assert.equal(selectOutlineVersion(outline, "missing", now), outline);
  assert.equal(selectOutlineVersion(outline, "middle", now), outline);
});

test("deleting a current default version also advances and clears the default marker", () => {
  const outline = { ...fixture(), currentVersionId: "newest", defaultVersionId: "newest" };
  const deleted = deleteOutlineVersion(outline, "newest", now);
  assert.equal(deleted.currentVersionId, "old");
  assert.equal(deleted.defaultVersionId, null);
  assert.equal(resolvedOutlineContent(deleted), "较早正文");
});

test("deleting direct content clears its metadata and advances to the first saved version", () => {
  const outline = { ...fixture(), contentName: "待删除正文", manualExcellent: true, excellentFragments: [{ id: "fragment" }], contentOutlineSnapshot: { title: "旧标题", plan: "旧快照" }, defaultVersionId: "middle" };
  const deleted = deleteOutlineVersion(outline, null, now);
  assert.equal(deleted.currentVersionId, "newest");
  assert.equal(deleted.defaultVersionId, "middle");
  assert.equal(deleted.content, "");
  assert.equal(deleted.contentName, undefined);
  assert.equal(deleted.contentOutlineSnapshot, undefined);
  assert.equal(deleted.manualExcellent, false);
  assert.deepEqual(deleted.excellentFragments, []);
  assert.equal(resolvedOutlineContent(deleted), "最新正文");
  assert.equal(deleteOutlineVersion({ ...outline, currentVersionId: "old" }, null, now).currentVersionId, "old");
});

test("deleting the final direct content leaves an empty body", () => {
  const deleted = deleteOutlineVersion({ ...fixture(), versions: [] }, null, now);
  assert.equal(deleted.currentVersionId, null);
  assert.equal(resolvedOutlineContent(deleted), "");
  assert.deepEqual(deleted.versions, []);
});
