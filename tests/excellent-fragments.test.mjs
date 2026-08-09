import test from "node:test";
import assert from "node:assert/strict";

import { paragraphRangeAt, reanchorExcellentFragments, toggleExcellentFragment } from "../lib/excellent-fragments.mjs";

const create = (id, createdAt = "2026-08-08T00:00:00.000Z") => ({ id, createdAt });

test("excellent fragment selection toggles contained ranges and merges overlaps", () => {
  const content = "甲乙丙丁戊己庚辛";
  const first = toggleExcellentFragment(content, [], { start: 1, end: 4 }, create("one"));
  assert.equal(first.action, "added");
  assert.deepEqual(first.fragments.map(({ start, end, text }) => ({ start, end, text })), [{ start: 1, end: 4, text: "乙丙丁" }]);

  const merged = toggleExcellentFragment(content, first.fragments, { start: 3, end: 7 }, create("two"));
  assert.equal(merged.action, "added");
  assert.deepEqual(merged.fragments.map(({ start, end, text }) => ({ start, end, text })), [{ start: 1, end: 7, text: "乙丙丁戊己庚" }]);

  const removed = toggleExcellentFragment(content, merged.fragments, { start: 2, end: 3 }, create("three"));
  assert.equal(removed.action, "removed");
  assert.deepEqual(removed.fragments, []);
});

test("excellent fragments reanchor after surrounding edits and drop changed text", () => {
  const original = "开头\n\n值得保留的句子。\n\n结尾";
  const start = original.indexOf("值得");
  const selected = toggleExcellentFragment(original, [], { start, end: start + "值得保留的句子。".length }, create("keep")).fragments;
  const inserted = reanchorExcellentFragments(original, `新增\n\n${original}`, selected);
  assert.equal(inserted[0].text, "值得保留的句子。");
  assert.equal(inserted[0].start, start + 4);
  assert.deepEqual(reanchorExcellentFragments(original, original.replace("值得保留", "已经改写"), selected), []);
});

test("double-click paragraph range uses blank lines as paragraph separators", () => {
  const content = "第一段。\n\n第二段第一句。\n第二段第二句。\n\n第三段。";
  const range = paragraphRangeAt(content, content.indexOf("第二段"));
  assert.ok(range);
  assert.equal(content.slice(range.start, range.end), "第二段第一句。\n第二段第二句。");
});
