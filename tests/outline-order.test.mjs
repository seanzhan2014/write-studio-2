import assert from "node:assert/strict";
import test from "node:test";
import { moveOutlineBetweenChapters, moveOutlineToChapterEnd } from "../app/outline-order.mjs";

const ids = (chapters) => chapters.map((chapter) => chapter.outlines.map((outline) => outline.id));
const chapters = () => [
  { id: "chapter-a", outlines: [{ id: "a" }, { id: "b" }, { id: "c" }] },
  { id: "chapter-b", outlines: [{ id: "d" }, { id: "e" }] },
];

test("outline drag moves downward after the target", () => {
  assert.deepEqual(ids(moveOutlineBetweenChapters(chapters(), "a", "b", "after")), [["b", "a", "c"], ["d", "e"]]);
});

test("outline drag moves upward before the target", () => {
  assert.deepEqual(ids(moveOutlineBetweenChapters(chapters(), "c", "a", "before")), [["c", "a", "b"], ["d", "e"]]);
});

test("outline drag moves across chapters on either side of the target", () => {
  assert.deepEqual(ids(moveOutlineBetweenChapters(chapters(), "b", "e", "after")), [["a", "c"], ["d", "e", "b"]]);
  assert.deepEqual(ids(moveOutlineBetweenChapters(chapters(), "e", "b", "before")), [["a", "e", "b", "c"], ["d"]]);
});

test("outline drag ignores missing and self targets without mutating input", () => {
  const original = chapters();
  assert.equal(moveOutlineBetweenChapters(original, "a", "missing", "after"), original);
  assert.equal(moveOutlineBetweenChapters(original, "a", "a", "before"), original);
  assert.deepEqual(ids(original), [["a", "b", "c"], ["d", "e"]]);
});

test("outline drag can append to another or empty chapter", () => {
  const source = [...chapters(), { id: "chapter-empty", outlines: [] }];
  assert.deepEqual(ids(moveOutlineToChapterEnd(source, "b", "chapter-b")), [["a", "c"], ["d", "e", "b"], []]);
  assert.deepEqual(ids(moveOutlineToChapterEnd(source, "c", "chapter-empty")), [["a", "b"], ["d", "e"], ["c"]]);
});

test("chapter append ignores invalid targets and an outline already at the end", () => {
  const original = chapters();
  assert.equal(moveOutlineToChapterEnd(original, "missing", "chapter-b"), original);
  assert.equal(moveOutlineToChapterEnd(original, "a", "missing"), original);
  assert.equal(moveOutlineToChapterEnd(original, "c", "chapter-a"), original);
});
