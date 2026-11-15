import assert from "node:assert/strict";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";
import { preparationModelServer } from "./writing-preparation-model.mjs";
import { parsePreparationResponse, PREPARATION_SECTIONS, createWritingPreparation, canWritePreparedProse, preparationNeedsConfirmation } from "../lib/writing-preparation.ts";

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

test("automatic writing requires a completed brief and recorded transition; legacy tasks still require confirmation", () => {
  const workflow = createWritingPreparation(3);
  assert.equal(workflow.strategy, "minimal");
  assert.equal(workflow.requireConfirmation, false);
  workflow.stage = "writing";
  workflow.autoApprovedAt = new Date().toISOString();
  assert.equal(canWritePreparedProse(workflow), false);
  workflow.brief = "写作所需事实、行动与约束。";
  assert.equal(canWritePreparedProse(workflow), true);
  workflow.finishAfterReply = true;
  assert.equal(canWritePreparedProse(workflow), false);
  delete workflow.finishAfterReply;
  delete workflow.requireConfirmation;
  assert.equal(preparationNeedsConfirmation(workflow), true);
  assert.equal(canWritePreparedProse(workflow), false);
  workflow.confirmedAt = new Date().toISOString();
  assert.equal(canWritePreparedProse(workflow), true);
});

test("durable preparation, author discussion and final writing", async (t) => {
  const fake = await preparationModelServer();
  try {
    const provider = await api("/api/providers", "POST", { name: "Preparation integration", baseUrl: fake.baseUrl, secret: "fake-key" });
    const model = await api("/api/models", "POST", { providerId: provider.id, name: "Preparation integration", modelId: "preparation-test", maxInputCharacters: 120000 });
    async function reset() { const current = await api("/api/state"); const data = fullStudioFixture(); data.tasks = []; await api("/api/state", "PUT", { data }, { "If-Match": String(current.revision) }); fake.control.calls = []; fake.control.invalid = 0; fake.control.ask = true; fake.control.unsupportedFormat = false; fake.control.planFailures = 0; fake.control.invalidChecks = 0; }
    const create = async (rounds = 2, options = { preparationRequireConfirmation: true }) => (await api("/api/ai/tasks", "POST", { articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "content", model: model.id, preparationRounds: rounds, instruction: "让人物发现异常，先讨论再写正文", reasoningEffort: "low", ...options }, { "Idempotency-Key": crypto.randomUUID() })).data;
    const paused = (task) => task.phase === "awaiting_author" || task.phase === "awaiting_confirmation" || task.state === "failed";
    const interact = async (task, action, extra = {}) => (await api(`/api/ai/tasks/${task.id}/interaction`, "POST", { action, revision: task.contextOptions.writingPreparation.revision, ...extra })).task;

    await t.test("global interaction rounds persist through settings API and normalize invalid values", async () => {
      await reset();
      let current = await api("/api/state");
      assert.equal(current.data.settings.preparationEnabled, true);
      assert.equal(current.data.settings.preparationStrategy, "minimal");
      assert.equal(current.data.settings.preparationRequireConfirmation, false);
      await api("/api/settings", "PUT", { preparationEnabled: false, preparationMaxRounds: 5, preparationStrategy: "explore", preparationRequireConfirmation: true }, { "If-Match": String(current.revision) });
      current = await api("/api/state");
      assert.equal(current.data.settings.preparationEnabled, false);
      assert.equal(current.data.settings.preparationMaxRounds, 5);
      assert.equal(current.data.settings.preparationStrategy, "explore");
      assert.equal(current.data.settings.preparationRequireConfirmation, true);
      await api("/api/settings", "PUT", { preparationEnabled: true, preparationMaxRounds: 99, preparationStrategy: "invalid", preparationRequireConfirmation: false }, { "If-Match": String(current.revision) });
      current = await api("/api/state");
      assert.equal(current.data.settings.preparationMaxRounds, 3);
      assert.equal(current.data.settings.preparationStrategy, "minimal");
      assert.equal(current.data.settings.preparationRequireConfirmation, false);
    });

    for (const strategy of ["minimal", "explore"]) await t.test(`${strategy} stops before the cap and automatically writes when no questions remain`, async () => {
      await reset(); fake.control.ask = false;
      const created = await create(5, { preparationStrategy: strategy });
      const task = await waitTask(created.id, (item) => item.state === "success" || item.state === "failed");
      assert.equal(task.state, "success", task.error);
      const workflow = task.contextOptions.writingPreparation;
      assert.equal(workflow.round, 0);
      assert.equal(workflow.strategy, strategy);
      assert.equal(workflow.requireConfirmation, false);
      assert.ok(workflow.autoApprovedAt);
      assert.equal(workflow.confirmedAt, undefined);
      assert.deepEqual(fake.control.calls.map((call) => call.kind), ["prepare", "check", "write"]);
      assert.equal(task.attempt, 1);
      assert.equal(task.inputTokens, 36);
      assert.equal(task.outputTokens, 72);
      const prompt = fake.control.calls[0].body.messages[0].content;
      assert.match(prompt, strategy === "minimal" ? /最少条件型讨论：只询问阻碍/ : /最大探索型讨论：在轮次上限内主动探索/);
      assert.match(prompt, /最大轮次只是上限，不是目标/);
      assert.match(prompt, /开场透露的信息、暂缓解释、可用铺垫、揭示时机与触发点/);
      assert.match(prompt, /读者从前文已经知道/);
      assert.match(prompt, /普通表达选择由写作准备自行处理/);
      assert.equal(fake.control.calls[0].body.response_format.json_schema.name, "writer_studio_writing_preparation");
      assert.match(fake.control.calls[0].body.messages.at(-1).content, /<output_contract>preparation_json<\/output_contract>/);
      assert.match(fake.control.calls.at(-1).body.messages[0].content, /事件因果|事实、因果/);
      assert.match(fake.control.calls.at(-1).body.messages.at(-1).content, /confirmed_writing_brief/);
      assert.equal(task.history.some((entry) => entry.phase === "awaiting_confirmation"), false);
    });

    await t.test("zero rounds automatically writes by default", async () => {
      await reset();
      const task = await waitTask((await create(0, {})).id, (item) => item.state === "success" || item.state === "failed");
      assert.equal(task.state, "success", task.error);
      assert.deepEqual(fake.control.calls.map((call) => call.kind), ["prepare", "check", "write"]);
      assert.equal(task.contextOptions.writingPreparation.questions.length, 0);
    });

    for (const contentMode of ["fresh", "rewrite", "continue"]) await t.test(`disabled preparation writes ${contentMode} directly despite discussion and confirmation settings`, async () => {
      await reset();
      const created = await create(5, { contentMode, preparationEnabled: false, preparationRequireConfirmation: true });
      await api(`/api/ai/tasks/${created.id}/execute`, "POST");
      const task = await waitTask(created.id, (item) => ["success", "failed"].includes(item.state));
      assert.equal(task.state, "success", task.error);
      assert.equal(task.contextOptions.writingPreparation, undefined);
      assert.deepEqual(fake.control.calls.map(call => call.kind), ["write"]);
      assert.ok(task.resultVersionId);
    });

    await t.test("the server honors inherited disabled preparation and an explicit task override", async () => {
      await reset();
      let current = await api("/api/state");
      await api("/api/settings", "PUT", { preparationEnabled: false }, { "If-Match": String(current.revision) });
      const created = await create();
      await api(`/api/ai/tasks/${created.id}/execute`, "POST");
      const task = await waitTask(created.id, (item) => ["success", "failed"].includes(item.state));
      assert.equal(task.state, "success", task.error);
      assert.equal(task.contextOptions.writingPreparation, undefined);
      assert.deepEqual(fake.control.calls.map(call => call.kind), ["write"]);
      fake.control.calls = []; fake.control.ask = false;
      const enabled = await waitTask((await create(0, { preparationEnabled: true, preparationRequireConfirmation: false })).id, (item) => ["success", "failed"].includes(item.state));
      assert.equal(enabled.state, "success", enabled.error);
      assert.deepEqual(fake.control.calls.map(call => call.kind), ["prepare", "check", "write"]);
      current = await api("/api/state");
      assert.equal(current.data.settings.preparationEnabled, false);
    });

    await t.test("opt-in confirmation pauses a question-free brief and remains frozen when the global switch is turned off", async () => {
      await reset(); fake.control.ask = false;
      let task = await waitTask((await create(5)).id, paused);
      assert.equal(task.phase, "awaiting_confirmation");
      assert.equal(task.contextOptions.writingPreparation.questions.length, 0);
      assert.deepEqual(fake.control.calls.map((call) => call.kind), ["prepare", "check"]);
      const current = await api("/api/state");
      await api("/api/settings", "PUT", { preparationRequireConfirmation: false }, { "If-Match": String(current.revision) });
      await api(`/api/ai/tasks/${task.id}/execute`, "POST", {});
      assert.equal(fake.control.calls.length, 2);
      task = await interact(task, "confirm");
      task = await waitTask(task.id, (item) => item.state === "success" || item.state === "failed");
      assert.equal(task.state, "success", task.error);
      assert.ok(task.contextOptions.writingPreparation.confirmedAt);
      assert.equal(task.contextOptions.writingPreparation.autoApprovedAt, undefined);
    });

    await t.test("changing global settings does not interrupt automatic writing after a reply", async () => {
      await reset(); let task = await waitTask((await create(1, {})).id, paused);
      assert.equal(task.phase, "awaiting_author");
      const current = await api("/api/state");
      await api("/api/settings", "PUT", { preparationStrategy: "explore", preparationRequireConfirmation: true }, { "If-Match": String(current.revision) });
      task = await interact(task, "reply", { draft: { answers: { discovery: "suspect" }, note: "只保留怀疑" } });
      task = await waitTask(task.id, (item) => item.state === "success" || item.state === "failed");
      assert.equal(task.state, "success", task.error);
      assert.equal(task.contextOptions.writingPreparation.strategy, "minimal");
      assert.equal(task.contextOptions.writingPreparation.requireConfirmation, false);
      assert.equal(task.contextOptions.writingPreparation.round, 1);
      assert.deepEqual(fake.control.calls.map((call) => call.kind), ["prepare", "prepare", "check", "write"]);
      assert.match(fake.control.calls[1].body.messages.at(-1).content, /只保留怀疑/);
      assert.equal(task.contextOptions.writingPreparation.history[0].reply.note, "只保留怀疑");
      const newTask = await create(0, {});
      assert.equal(newTask.contextOptions.writingPreparation.strategy, "explore");
      assert.equal(newTask.contextOptions.writingPreparation.requireConfirmation, true);
      assert.equal((await waitTask(newTask.id, paused)).phase, "awaiting_confirmation");
    });

    await t.test("manual early finish still waits for inspection with automatic writing enabled", async () => {
      await reset(); let task = await waitTask((await create(5, {})).id, paused);
      task = await interact(task, "finish", { draft: { answers: {}, note: "先检查这份准备稿" } });
      task = await waitTask(task.id, (item) => item.phase === "awaiting_confirmation");
      assert.equal(task.contextOptions.writingPreparation.requireConfirmation, false);
      assert.deepEqual(fake.control.calls.map((call) => call.kind), ["prepare", "prepare", "check"]);
    });

    await t.test("invalid discussion preferences are rejected before calling the model", async () => {
      await reset();
      for (const options of [{ preparationEnabled: "false" }, { preparationStrategy: ["explore"] }, { preparationStrategy: "invalid" }, { preparationRequireConfirmation: "false" }]) {
        const response = await fetch(`${baseUrl}/api/ai/tasks`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "content", model: model.id, preparationRounds: 3, ...options }) });
        assert.equal(response.status, 400);
      }
      assert.equal(fake.control.calls.length, 0);
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
      assert.equal(completed.inputTokens, 72);
      assert.equal(completed.outputTokens, 144);
      assert.deepEqual(fake.control.calls.map((call) => call.kind), ["prepare", "prepare", "prepare", "check", "check", "write"]);
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
      assert.equal(fake.control.calls.length, 2);
    });
    await t.test("early finish incorporates an unsent author note before confirmation", async () => {
      await reset(); let task = await waitTask((await create(5)).id, paused);
      task = await interact(task, "finish", { draft: { answers: {}, note: "提前结束，但要保留这项约束" } });
      task = await waitTask(task.id, (item) => item.phase === "awaiting_confirmation");
      assert.equal(task.contextOptions.writingPreparation.round, 1);
      assert.match(fake.control.calls.at(-1).body.messages.at(-1).content, /保留这项约束/);
    });
    await t.test("one format correction is automatic and both responses count toward usage", async () => {
      await reset(); fake.control.invalid = 1; fake.control.ask = false;
      const task = await waitTask((await create(0, {})).id, (item) => item.state === "success" || item.state === "failed");
      assert.equal(task.state, "success", task.error);
      assert.deepEqual(fake.control.calls.map(call => call.kind), ["prepare", "prepare", "check", "write"]);
      assert.match(fake.control.calls[1].body.messages.at(-1).content, /preparation_format_repair/);
      assert.equal(task.inputTokens, 48); assert.equal(task.outputTokens, 96);
    });
    await t.test("providers rejecting structured output can still complete preparation", async () => {
      await reset(); fake.control.unsupportedFormat = true; fake.control.ask = false;
      const task = await waitTask((await create(0, {})).id, (item) => item.state === "success" || item.state === "failed");
      assert.equal(task.state, "success", task.error);
      assert.deepEqual(fake.control.calls.map(call => call.kind), ["prepare", "prepare", "check", "check", "write"]);
      assert.ok(fake.control.calls[0].body.response_format);
      assert.equal(fake.control.calls[1].body.response_format, undefined);
      assert.equal(task.inputTokens, 36); assert.equal(task.outputTokens, 72);
    });

    await t.test("a failed plan audit is repaired once and rechecked before prose", async () => {
      await reset(); fake.control.ask = false; fake.control.planFailures = 1;
      const task = await waitTask((await create(0, {})).id, item => ["success", "failed"].includes(item.state));
      assert.equal(task.state, "success", task.error);
      assert.deepEqual(fake.control.calls.map(call => call.kind), ["prepare", "check", "prepare", "check", "write"]);
      assert.match(fake.control.calls[2].body.messages.at(-1).content, /preparation_plan_repair/);
      assert.match(fake.control.calls[2].body.messages.at(-1).content, /核实前就确认结论/);
      assert.ok(task.contextOptions.writingPreparation.scenePlan.scenes.length);
      assert.match(task.contextOptions.writingPreparation.planCheck.briefDigest, /^[a-f0-9]{64}$/);
      assert.equal(task.inputTokens, 60); assert.equal(task.outputTokens, 120);
    });

    await t.test("an unresolved plan stops before writing and preserves its draft for recovery", async () => {
      await reset(); fake.control.ask = false; fake.control.planFailures = 2;
      const task = await waitTask((await create(0, {})).id, item => ["success", "failed"].includes(item.state));
      assert.equal(task.state, "failed");
      assert.match(task.error, /写作准备稿检查未通过/);
      assert.deepEqual(fake.control.calls.map(call => call.kind), ["prepare", "check", "prepare", "check"]);
      assert.match(task.contextOptions.writingPreparation.brief, /场景 S1/);
      assert.equal(task.contextOptions.writingPreparation.planCheck, undefined);
      assert.equal(task.resultVersionId, undefined);
      assert.equal(task.inputTokens, 48); assert.equal(task.outputTokens, 96);
    });

    await t.test("edited briefs invalidate cached plans, are audited verbatim, and can recover after a rejected check", async () => {
      await reset(); fake.control.ask = false;
      let task = await waitTask((await create(0)).id, paused);
      assert.ok(task.contextOptions.writingPreparation.planCheck);
      const edited = task.contextOptions.writingPreparation.brief + "\n作者确定：不得解释档案修改的真实动机。";
      task = await interact(task, "edit_brief", { brief: edited });
      assert.equal(task.contextOptions.writingPreparation.scenePlan, undefined);
      assert.equal(task.contextOptions.writingPreparation.planCheck, undefined);
      fake.control.planFailures = 1;
      await interact(task, "confirm");
      task = await waitTask(task.id, item => item.state === "failed");
      assert.equal(task.contextOptions.writingPreparation.brief, edited);
      assert.equal(task.resultVersionId, undefined);
      assert.match(fake.control.calls.at(-1).body.messages.at(-1).content, /不得解释档案修改的真实动机/);
      const recovered = edited + "\n作者修正：先核实，再作决定。";
      task = await interact(task, "edit_brief", { brief: recovered });
      assert.equal(task.phase, "awaiting_confirmation");
      assert.equal((await api("/api/ai/tasks")).tasks.find(item => item.id === task.id).state, "waiting");
      await interact(task, "confirm");
      task = await waitTask(task.id, item => ["success", "failed"].includes(item.state));
      assert.equal(task.state, "success", task.error);
      assert.deepEqual(fake.control.calls.map(call => call.kind), ["prepare", "check", "check", "check", "write"]);
      assert.equal(task.contextOptions.writingPreparation.brief, recovered);
      assert.match(fake.control.calls.at(-1).body.messages.at(-1).content, /先核实，再作决定/);
      assert.equal(task.inputTokens, 60); assert.equal(task.outputTokens, 120);
    });

    await t.test("malformed audit output receives one format correction and counts both responses", async () => {
      await reset(); fake.control.ask = false; fake.control.invalidChecks = 1;
      const task = await waitTask((await create(0, {})).id, item => ["success", "failed"].includes(item.state));
      assert.equal(task.state, "success", task.error);
      assert.deepEqual(fake.control.calls.map(call => call.kind), ["prepare", "check", "check", "write"]);
      assert.equal(task.inputTokens, 48); assert.equal(task.outputTokens, 96);
    });
    await t.test("malformed output retries are bounded and preserve a failed task for recovery", async () => {
      await reset(); fake.control.invalid = 6; let task = await waitTask((await create()).id, (item) => item.state === "failed");
      assert.equal(task.resultVersionId, undefined); assert.equal(fake.control.calls.length, 6);
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
