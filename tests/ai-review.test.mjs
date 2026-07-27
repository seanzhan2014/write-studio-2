import assert from "node:assert/strict";
import test from "node:test";
import { aiReviewContentName, resolvedOutlineContentName, timestampContentName } from "../lib/content-name.mjs";
import { AiReviewResultError, applyReviewEdits, createReviewBlocks, parseReviewResponse, reviewSourceDigest } from "../lib/ai-review.mjs";

test("body names default to stable timestamps and AI Review appends to the original name", () => {
  assert.equal(timestampContentName("2026-08-03T04:05:06.000Z"), "2026-08-03 04:05:06");
  const outline = {
    contentName: "2026-08-03 04:05:06",
    contentOverride: true,
    updatedAt: "2026-08-03T04:05:06.000Z",
    versions: [],
  };
  assert.equal(resolvedOutlineContentName(outline), "2026-08-03 04:05:06");
  assert.equal(aiReviewContentName(outline), "2026-08-03 04:05:06 · AI Review");
});

test("AI Review applies non-overlapping block replacements without changing untouched text", () => {
  const outlines = [{ id: "outline-a", title: "A", plan: "", name: "初稿", text: "第一段。\n\n重复的 second scene。\n\n结尾。" }];
  const blocks = createReviewBlocks("outline-a", 0, outlines[0].text);
  const response = parseReviewResponse({
    version: 1,
    chapterId: "chapter-a",
    sourceDigest: "digest",
    edits: [{ outlineId: "outline-a", fromBlockId: blocks[1].id, toBlockId: blocks[1].id, replacement: "第二段承接。\n\n", ruleIds: ["mixed-english", "repeated-scene"] }],
  });
  const result = applyReviewEdits(outlines, response.edits);
  assert.equal(result.get("outline-a"), "第一段。\n\n第二段承接。\n\n结尾。");
});

test("AI Review rejects overlapping or cross-body edits", () => {
  const outlines = [
    { id: "a", title: "A", plan: "", name: "A", text: "一。\n\n二。\n\n三。" },
    { id: "b", title: "B", plan: "", name: "B", text: "四。" },
  ];
  const a = createReviewBlocks("a", 0, outlines[0].text);
  const b = createReviewBlocks("b", 1, outlines[1].text);
  assert.throws(() => applyReviewEdits(outlines, [{ outlineId: "a", fromBlockId: a[0].id, toBlockId: b[0].id, replacement: "", ruleIds: [] }]), AiReviewResultError);
  assert.throws(() => applyReviewEdits(outlines, [
    { outlineId: "a", fromBlockId: a[0].id, toBlockId: a[1].id, replacement: "", ruleIds: [] },
    { outlineId: "a", fromBlockId: a[1].id, toBlockId: a[2].id, replacement: "", ruleIds: [] },
  ]), AiReviewResultError);
});

test("review source digest changes with正文 name or text", async () => {
  const base = [{ id: "a", title: "A", plan: "", name: "初稿", text: "正文" }];
  const first = await reviewSourceDigest("chapter-a", base);
  assert.notEqual(first, await reviewSourceDigest("chapter-a", [{ ...base[0], name: "二稿" }]));
  assert.notEqual(first, await reviewSourceDigest("chapter-a", [{ ...base[0], text: "修改" }]));
});
