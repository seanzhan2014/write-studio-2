import assert from "node:assert/strict";
import test from "node:test";
import { PREPARATION_SECTIONS, PreparationResponseError, parsePreparationResponse } from "../lib/writing-preparation.ts";
import { parseScenePlan, preparationBriefDigest, parsePlanIssues } from "../lib/scene-plan.ts";
import { scenePlanFixture } from "./scene-plan-fixture.mjs";

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

test("scene plans preserve executable scenes, fixed facts and creative boundaries in the editable brief", () => {
  const plan = scenePlanFixture();
  const parsed = parsePreparationResponse(JSON.stringify({ brief: brief(), plan, questions: [] }), true);
  assert.deepEqual(parsed.scenePlan, plan);
  assert.match(parsed.brief, /固定情节与来源/);
  assert.match(parsed.brief, /场景 S1 · 情节 A1/);
  assert.ok(parsed.brief.includes(plan.scenes[0].actions));
  assert.ok(parsed.brief.includes(plan.creativeSpace));
  assert.throws(() => parsePreparationResponse(JSON.stringify({ brief: brief(), questions: [] }), true), PreparationResponseError);
});

test("scene plans reject uncovered events, unknown references, duplicate IDs and missing execution details", () => {
  const mutate = fn => { const plan = scenePlanFixture(); fn(plan); return plan; };
  for (const plan of [
    mutate(plan => plan.anchors.push({ id: "A2", fact: "作出关键决定。", source: "原大纲的结尾" })),
    mutate(plan => plan.scenes[0].anchors.push("missing")),
    mutate(plan => plan.anchors.push(plan.anchors[0])),
    mutate(plan => plan.scenes.push(plan.scenes[0])),
    mutate(plan => plan.scenes[0].actions = ""),
    mutate(plan => plan.scenes[0].anchors.push("A1")),
  ]) assert.throws(() => parseScenePlan(plan));
  // A quiet scene may have no opposition; bridging scenes can share a plot event.
  const plan = scenePlanFixture(); plan.scenes.push({ ...plan.scenes[0], id: "S2", obstacle: "无冲突，安静核对。" });
  assert.equal(parseScenePlan(plan).scenes.length, 2);
});

test("quality checks require concrete evidence; changing an edited brief invalidates its check", async () => {
  assert.deepEqual(parsePlanIssues('{"issues":[]}'), []);
  assert.throws(() => parsePlanIssues('{"issues":[{"sceneId":"S1","problem":"不好看","evidence":"","fix":"写好一点"}]}'));
  const first = await preparationBriefDigest("原准备稿");
  assert.equal(first, await preparationBriefDigest("原准备稿"));
  assert.notEqual(first, await preparationBriefDigest("原准备稿\n作者要求：最后不揭示动机。"));
});
