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

test("deleting current restores selection order even for repeated selections in the same millisecond", () => {
  let outline = fixture();
  for (const id of ["old", "middle", "old"]) outline = selectOutlineVersion(outline, id, now);
  outline = structuredClone(outline);
  outline = deleteOutlineVersion(outline, "old", now);
  assert.equal(outline.currentVersionId, "middle");
  assert.equal(resolvedOutlineContent(outline), "中间正文");
  outline = deleteOutlineVersion(outline, "middle", now);
  assert.equal(outline.currentVersionId, "newest");
  outline = deleteOutlineVersion(outline, "newest", now);
  assert.equal(outline.currentVersionId, null);
  assert.equal(resolvedOutlineContent(outline), "直接保存正文");
});

test("legacy current selections are remembered when switching versions", () => {
  const initial = { ...fixture(), currentVersionId: "old" };
  const selected = selectOutlineVersion(initial, "middle", now);
  assert.equal(deleteOutlineVersion(selected, "middle", now).currentVersionId, "old");
  assert.equal(initial.versions.some((version) => version.lastSelectedAt), false);
});

test("without selection history fallback uses creation time rather than array order", () => {
  const outline = { ...fixture(), currentVersionId: "newest" };
  assert.equal(deleteOutlineVersion(outline, "newest", now).currentVersionId, "middle");
});

test("deleting other versions keeps current and protects the default version", () => {
  let outline = selectOutlineVersion(fixture(), "old", now);
  outline = selectOutlineVersion(outline, "middle", now);
  outline = deleteOutlineVersion(outline, "old", now);
  assert.equal(outline.currentVersionId, "middle");
  assert.equal(deleteOutlineVersion(outline, "middle", now).currentVersionId, "newest");
  const protectedOutline = { ...outline, defaultVersionId: "middle" };
  assert.equal(deleteOutlineVersion(protectedOutline, "middle", now), protectedOutline);
  assert.equal(deleteOutlineVersion(outline, "missing", now), outline);
  assert.equal(selectOutlineVersion(outline, "missing", now), outline);
  assert.equal(selectOutlineVersion(outline, "middle", now), outline);
});
