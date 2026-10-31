import assert from "node:assert/strict";
import test from "node:test";
import { readGenerateRequest, parseGenerateFields } from "../lib/generate-request.ts";
import { RequestInputError } from "../lib/request-input.ts";
import { normalizeTaskConcurrency } from "../lib/task-concurrency.ts";
import { normalizeStudioSettings } from "../lib/studio-settings.ts";
import { taskFromRow } from "../lib/task-record.ts";
import { createScopedSettingActions } from "../lib/story-setting-actions.ts";
import { normalizeChapterSettings } from "../lib/story-settings.ts";

const request = body => new Request("http://test/generate", { method: "POST", body, headers: { "Content-Type": "application/json" } });

test("generation rejects malformed JSON and non-object JSON before accessing a model", async () => {
  for (const body of ["{", "null", "[]", '"text"', "12", "true"]) {
    await assert.rejects(readGenerateRequest(request(body)), RequestInputError);
  }
});

test("generation normalizes legacy controls, explicit opt-outs and optional word limits", async () => {
  const input = { target: "content", outlineId: "outline", contentMode: "rewrite", rewriteRetention: "high", dialogueDensity: "low", includeClosingSummary: true, closingSummaryLength: "none", targetWords: "", includeExcellentFragments: true, excellentFragmentIds: ["a", "a", "b"] };
  const parsed = await readGenerateRequest(request(JSON.stringify(input)));
  assert.equal(parsed.contentMode, "rewrite");
  assert.equal(parsed.rewriteRetention, "high");
  assert.equal(parsed.proseControls.dialogueDensity, "low");
  assert.equal(parsed.closingSummaryLength, "none");
  assert.equal(parsed.targetWords, undefined);
  assert.deepEqual(parsed.excellentFragmentIds, ["a", "b"]);
  for (const targetWords of [-1, 1.5, "not-a-number", 100001]) assert.throws(() => parseGenerateFields({ targetWords }, "content"), RequestInputError);
  assert.throws(() => parseGenerateFields({ proseControls: { dialogueDensity: "invalid" } }, "content"), RequestInputError);
});

test("all settings boundaries permit five concurrent tasks and normalize invalid values", () => {
  for (const value of [1, 2, 3, 4, 5]) {
    assert.equal(normalizeTaskConcurrency(value), value);
    assert.equal(normalizeStudioSettings({ taskConcurrency: value }).taskConcurrency, value);
  }
  assert.equal(normalizeTaskConcurrency(100), 5);
  assert.equal(normalizeTaskConcurrency(-5), 1);
  assert.equal(normalizeTaskConcurrency(undefined), 2);
});

test("task mapping preserves illustration targets and execution metadata", () => {
  const task = taskFromRow({ id: "image", article_id: "a", chapter_id: "c", outline_id: "o", target: "illustration-image", status: "error", execution_origin: "cloud", context_options_json: '{"illustrationId":"image"}', input_tokens: 42, output_tokens: 12, result_version_id: "version", runner_id: "owner", lease_until: "lease" });
  assert.equal(task.target, "插图");
  assert.equal(task.state, "failed");
  assert.equal(task.executionOrigin, "cloud");
  assert.equal(task.inputTokens, 42);
  assert.equal(task.outputTokens, 12);
  assert.equal(task.contextOptions.illustrationId, "image");
  assert.equal(task.runnerId, "owner");
  assert.equal(task.leaseUntil, "lease");
});

test("restoring one character override preserves its other scoped changes and the input", () => {
  const settings = normalizeChapterSettings({ characters: { person: { start: { age: { value: "20", scope: "ongoing" } }, end: { appearance: "new coat" }, appears: { value: true, scope: "chapter" } } } });
  const before = structuredClone(settings);
  let committed;
  const actions = createScopedSettingActions(settings, next => { committed = next; }, "outline", { story: {}, character: { age: { label: "年龄" } } });
  actions.restoreCharacter("person", "age");
  assert.equal(committed.characters.person.start.age, undefined);
  assert.equal(committed.characters.person.end.appearance, "new coat");
  assert.equal(committed.characters.person.appears.value, true);
  assert.deepEqual(settings, before);
});
