import assert from "node:assert/strict";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";
import { preparationModelServer } from "./writing-preparation-model.mjs";
import { parsePreparationResponse, PREPARATION_SECTIONS } from "../lib/writing-preparation.ts";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
async function api(path, method = "GET", data, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  const body = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}
async function waitTask(id, predicate) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const task = (await api("/api/ai/tasks")).tasks.find((item) => item.id === id);
    if (task && predicate(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Task did not reach expected state");
}

test("writing preparation requires nine sections and valid questions", () => {
  assert.throws(() => parsePreparationResponse(JSON.stringify({ brief: {}, questions: [] })));
  const brief = Object.fromEntries(PREPARATION_SECTIONS.map(([key, title]) => [key, title]));
  assert.equal(parsePreparationResponse(JSON.stringify({ brief, questions: [] })).questions.length, 0);
  assert.throws(() => parsePreparationResponse(JSON.stringify({ brief, questions: Array(4).fill({}) })));
});

test("durable preparation, author discussion and final writing", async (t) => {
  const fake = await preparationModelServer();
  try {
    const provider = await api("/api/providers", "POST", { name: "Preparation integration", baseUrl: fake.baseUrl, secret: "fake-key" });
    const model = await api("/api/models", "POST", { providerId: provider.id, name: "Preparation integration", modelId: "preparation-test", maxInputCharacters: 120000 });
    async function reset() { const current = await api("/api/state"); const data = fullStudioFixture(); data.tasks = []; await api("/api/state", "PUT", { data }, { "If-Match": String(current.revision) }); fake.control.calls = []; fake.control.invalid = 0; }
    const create = async (rounds = 2) => (await api("/api/ai/tasks", "POST", { articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "content", model: model.id, preparationRounds: rounds, instruction: "让人物发现异常，先讨论再写正文", reasoningEffort: "low" }, { "Idempotency-Key": crypto.randomUUID() })).data;
    const paused = (task) => task.phase === "awaiting_author" || task.phase === "awaiting_confirmation" || task.state === "failed";
    const interact = async (task, action, extra = {}) => (await api(`/api/ai/tasks/${task.id}/interaction`, "POST", { action, revision: task.contextOptions.writingPreparation.revision, ...extra })).task;

    await t.test("global interaction rounds persist through settings API and normalize invalid values", async () => {
      await reset();
      let current = await api("/api/state");
      await api("/api/settings", "PUT", { preparationMaxRounds: 5 }, { "If-Match": String(current.revision) });
      current = await api("/api/state");
      assert.equal(current.data.settings.preparationMaxRounds, 5);
      await api("/api/settings", "PUT", { preparationMaxRounds: 99 }, { "If-Match": String(current.revision) });
      assert.equal((await api("/api/state")).data.settings.preparationMaxRounds, 3);
    });

    await t.test("initial preparation pauses without a body/version or live lease", async () => {
      await reset(); const created = await create();
      const task = await waitTask(created.id, paused);
      assert.equal(task.phase, "awaiting_author", task.error);
      assert.equal(task.state, "waiting"); assert.equal(task.runnerId, undefined); assert.equal(task.leaseUntil, undefined);
      assert.equal(task.resultVersionId, undefined); assert.equal(fake.control.calls.length, 1);
      const before = fake.control.calls.length;
      await api(`/api/ai/tasks/${task.id}/execute`, "POST", {});
      assert.equal(fake.control.calls.length, before);
      assert.equal((await api("/api/state")).data.tasks.find((item) => item.id === task.id).contextOptions.writingPreparation.brief, task.contextOptions.writingPreparation.brief);
      const early = await fetch(`${baseUrl}/api/ai/tasks/${task.id}/interaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", revision: task.contextOptions.writingPreparation.revision }) });
      assert.equal(early.status, 409);
    });
    await t.test("two replies update a persisted brief, then explicit confirmation writes", async () => {
      await reset(); let task = await waitTask((await create()).id, paused);
      task = await interact(task, "draft", { draft: { answers: { discovery: "suspect" }, note: "对话保持克制" } });
      assert.equal((await api("/api/state")).data.tasks.find((item) => item.id === task.id).contextOptions.writingPreparation.draft.note, "对话保持克制");
      const staleRevision = task.contextOptions.writingPreparation.revision;
      task = await interact(task, "reply", { draft: { answers: { discovery: "suspect" }, note: "对话保持克制" } });
      const duplicate = await fetch(`${baseUrl}/api/ai/tasks/${task.id}/interaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reply", revision: staleRevision, draft: { answers: {}, note: "duplicate" } }) });
      assert.equal(duplicate.status, 409);
      task = await waitTask(task.id, (item) => paused(item) && item.contextOptions.writingPreparation.round === 1);
      assert.match(fake.control.calls.at(-1).body.messages.at(-1).content, /对话保持克制/);
      task = await interact(task, "reply", { draft: { answers: {}, note: "结尾留下新线索" } });
      task = await waitTask(task.id, (item) => item.phase === "awaiting_confirmation");
      assert.equal(task.contextOptions.writingPreparation.round, 2); assert.equal(task.contextOptions.writingPreparation.questions.length, 0);
      task = await interact(task, "edit_brief", { brief: task.contextOptions.writingPreparation.brief + "\n作者修改：最后不要透露动机。" });
      task = await interact(task, "confirm");
      const completed = await waitTask(task.id, (item) => item.state === "success" || item.state === "failed");
      assert.equal(completed.state, "success", completed.error);
      assert.equal(completed.inputTokens, 48);
      assert.equal(completed.outputTokens, 96);
      assert.deepEqual(fake.control.calls.map((call) => call.kind), ["prepare", "prepare", "prepare", "write"]);
      assert.ok(fake.control.calls.every((call) => call.body.reasoning_effort === "low"));
      assert.match(fake.control.calls.at(-1).body.messages.at(-1).content, /confirmed_writing_brief/);
      assert.match(fake.control.calls.at(-1).body.messages.at(-1).content, /最后不要透露动机/);
      const outline = (await api("/api/state")).data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
      assert.ok(outline.versions.some((version) => version.id === completed.resultVersionId));
      assert.ok(completed.history.some((entry) => entry.phase === "awaiting_author"));
    });
    await t.test("zero rounds still prepares and waits for confirmation", async () => {
      await reset(); const task = await waitTask((await create(0)).id, paused);
      assert.equal(task.phase, "awaiting_confirmation"); assert.equal(task.contextOptions.writingPreparation.round, 0);
      assert.equal(fake.control.calls.length, 1);
    });
    await t.test("early finish incorporates an unsent author note before confirmation", async () => {
      await reset(); let task = await waitTask((await create(5)).id, paused);
      task = await interact(task, "finish", { draft: { answers: {}, note: "提前结束，但要保留这项约束" } });
      task = await waitTask(task.id, (item) => item.phase === "awaiting_confirmation");
      assert.equal(task.contextOptions.writingPreparation.round, 1);
      assert.match(fake.control.calls.at(-1).body.messages.at(-1).content, /保留这项约束/);
    });
    await t.test("malformed output retries and preserves a failed task for recovery", async () => {
      await reset(); fake.control.invalid = 3; let task = await waitTask((await create()).id, (item) => item.state === "failed");
      assert.equal(task.resultVersionId, undefined); assert.equal(fake.control.calls.length, 3);
      await api(`/api/ai/tasks/${task.id}/state`, "POST", { action: "retry" });
      task = await waitTask(task.id, (item) => item.phase === "awaiting_author");
      assert.ok(task.contextOptions.writingPreparation.brief);
    });
    await t.test("cancel/retry restores the author turn instead of redispatching", async () => {
      await reset(); let task = await waitTask((await create()).id, paused);
      await api(`/api/ai/tasks/${task.id}/state`, "POST", { action: "cancel" });
      const resumed = await api(`/api/ai/tasks/${task.id}/state`, "POST", { action: "retry" });
      assert.equal(resumed.task.phase, "awaiting_author");
      assert.equal(fake.control.calls.length, 1);
    });
    await t.test("human edits are retained and final writing becomes a candidate", async () => {
      await reset(); let task = await waitTask((await create(0)).id, paused);
      const state = await api("/api/state"); await api("/api/outlines/outline-current/content", "PUT", { text: "作者在等待期间修改的正文" }, { "If-Match": String(state.revision) });
      await interact(task, "confirm");
      task = await waitTask(task.id, (item) => item.state === "success" || item.state === "failed");
      assert.equal(task.state, "success", task.error); assert.equal(task.contextOptions.reviewCandidateOnly, true);
      const outline = (await api("/api/state")).data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
      assert.equal(outline.content, "作者在等待期间修改的正文");
    });
  } finally { await fake.close(); }
});
