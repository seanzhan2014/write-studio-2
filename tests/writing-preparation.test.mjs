import assert from "node:assert/strict";
import test from "node:test";
import { PREPARATION_SECTIONS, PreparationResponseError, parsePreparationResponse } from "../lib/writing-preparation.ts";

const brief = () => Object.fromEntries(PREPARATION_SECTIONS.map(([key, title]) => [key, `${title}：只使用已给出的事实，未知项留白。`]));

test("preparation retains localized section names and multiline lists from compatible models", () => {
  const sections = Object.fromEntries(PREPARATION_SECTIONS.map(([, title]) => [title, [title, "未知动机不写成事实。"]]));
  const result = parsePreparationResponse("```json\n" + JSON.stringify({ brief: sections, questions: [] }) + "\n```");
  assert.equal(result.brief.split("未知动机不写成事实。").length - 1, 9);
  assert.match(result.brief, /9\. 表现与篇幅\n表现与篇幅\n未知动机不写成事实。/);
});

test("preparation accepts free-text questions and optional explanatory metadata", () => {
  const result = parsePreparationResponse(JSON.stringify({ brief: brief(), questions: [
    { id: "free", title: "如何处理未知动机？" },
    { id: "choice", title: "选择下一步行动", reason: "", options: [{ id: "wait", label: "继续观察", description: "" }] },
  ] }));
  assert.deepEqual(result.questions[0], { id: "free", title: "如何处理未知动机？", reason: "", options: [] });
  assert.equal(result.questions[1].options[0].description, "");
});

test("preparation rejects incomplete or oversized sections with the failing field named", () => {
  for (const invalid of [undefined, null, "", [], { text: "不接受任意对象" }, ["文字", 12], "字".repeat(6001)]) {
    assert.throws(() => parsePreparationResponse(JSON.stringify({ brief: { ...brief(), knowledge: invalid }, questions: [] })), error => error instanceof PreparationResponseError && /brief.knowledge（认知与信息边界）/.test(error.message));
  }
});

test("malformed JSON, records and duplicate interactive IDs remain recoverable format errors", () => {
  for (const invalid of ["{broken", "null", JSON.stringify({ brief: null, questions: [] }), JSON.stringify({ brief: brief(), questions: [null] }), JSON.stringify({ brief: brief(), questions: [
    { id: "same", title: "问题1" }, { id: "same", title: "问题2" },
  ] }), JSON.stringify({ brief: brief(), questions: [{ id: "q", title: "问题", options: [null] }] })]) {
    assert.throws(() => parsePreparationResponse(invalid), PreparationResponseError);
  }
});
