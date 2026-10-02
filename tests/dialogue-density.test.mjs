import assert from "node:assert/strict";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";
import { reviewModelServer } from "./review-model.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;

test("prose controls reach generation, frozen task retries and review revisions", { skip: !baseUrl, timeout: 90_000 }, async (t) => {
  async function request(path, body, method = body === undefined ? "GET" : "POST", headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { response, data: text ? JSON.parse(text) : null };
  }
  async function api(...args) {
    const { response, data } = await request(...args);
    assert.ok(response.ok, `${args[0]}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  }
  const original = await api("/api/state");
  const fake = await reviewModelServer();
  let model;
  let provider;
  t.after(async () => {
    try {
      const current = await api("/api/state");
      await api("/api/state", { data: original.data }, "PUT", { "If-Match": String(current.revision) });
      if (model) await api(`/api/models/${model.id}`, undefined, "DELETE");
      if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE");
    } finally { fake.close(); }
  });
  const fixture = fullStudioFixture();
  fixture.articles[0].reviewRules = "";
  fixture.articles[0].reviewRuleItems = [];
  await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(original.revision) });
  provider = await api("/api/providers", { name: "Dialogue density test", baseUrl: fake.baseUrl, secret: "fake-dialogue-key" });
  model = await api("/api/models", { providerId: provider.id, name: "Dialogue density test", modelId: "dialogue-test", maxInputCharacters: 120000 });
  const generation = { outlineId: "outline-current", target: "content", model: model.id, instruction: "保持码头情节" };
  const taskInput = { ...generation, articleId: "article-main", chapterId: "chapter-main" };
  const lastCall = () => fake.control.calls.at(-1).body;
  const prompt = () => lastCall().messages.at(-1).content;
  const system = () => lastCall().messages[0].content;

  await t.test("legacy dialogue density remains compatible and automatic controls keep the original prompt", async () => {
    for (const contentMode of ["fresh", "rewrite", "continue"]) {
      let automaticPrompt;
      for (const dialogueDensity of [undefined, "auto", "low", "balanced", "high"]) {
        const result = await api("/api/ai/generate", { ...generation, contentMode, rewriteRetention: "high", dialogueDensity });
        if (dialogueDensity === undefined) automaticPrompt = lastCall().messages;
        if (!dialogueDensity || dialogueDensity === "auto") {
          assert.doesNotMatch(prompt(), /<dialogue_density/);
          assert.deepEqual(lastCall().messages, automaticPrompt);
        } else {
          assert.match(prompt(), new RegExp(`<dialogue_density level="${dialogueDensity}">`));
          assert.match(system(), /心理独白和引用文字不算对白/);
          assert.match(system(), /用户对具体场景的明确要求/);
          assert.match(system(), /continue 仅作用于新增正文/);
          assert.match(system(), /rewrite_retention 为 high 时优先保留原文结构/);
        }
        if (contentMode === "continue") assert.equal(result.text, "林澈看向顾屿，确认潮汐表上的时间。\n\n她十七岁。\n\n窗外的雨停了。");
      }
    }
    await api("/api/ai/generate-stream", { ...generation, dialogueDensity: "high" });
    assert.match(prompt(), /<dialogue_density level="high">/);
  });

  await t.test("all prose controls produce distinct scoped constraints", async () => {
    const proseControls = { dialogueDensity: "balanced", introspectionDensity: "high", descriptionDetail: "low", narrativePace: "fast", paragraphLength: "long" };
    await api("/api/ai/generate", { ...generation, proseControls });
    assert.match(prompt(), /<prose_controls>/);
    assert.match(prompt(), /<dialogue_density level="balanced">/);
    assert.match(prompt(), /<introspection_density level="high">/);
    assert.match(prompt(), /<description_detail level="low">/);
    assert.match(prompt(), /<narrative_pace level="fast">/);
    assert.match(prompt(), /<paragraph_length level="long">/);
    assert.match(system(), /非视角人物无法得知的内心/);
    assert.match(system(), /不得堆砌形容词/);
    assert.match(system(), /紧凑不等于跳过必要因果/);
    assert.match(system(), /短段落不得机械地一句一段/);
    assert.match(system(), /人物对白换人、场景转换、时间跳跃/);
    assert.match(system(), /多项设置同时启用时，不要求平均分配篇幅/);

    await api("/api/ai/generate", { ...generation, proseControls: { introspectionDensity: "low" } });
    assert.match(prompt(), /<introspection_density level="low">/);
    assert.doesNotMatch(prompt(), /<dialogue_density|<description_detail|<narrative_pace|<paragraph_length/);

    await api("/api/ai/generate", { ...generation, proseControls: { paragraphLength: "short" } });
    assert.match(prompt(), /<paragraph_length level="short">/);
    assert.doesNotMatch(prompt(), /<dialogue_density|<introspection_density|<description_detail|<narrative_pace/);

    await api("/api/ai/generate", { ...generation, proseControls: { dialogueDensity: "auto", introspectionDensity: "auto", descriptionDetail: "auto", narrativePace: "auto", paragraphLength: "auto" } });
    assert.doesNotMatch(prompt(), /<prose_controls>/);
  });

  await t.test("invalid density is rejected before model calls and structure generation ignores it", async () => {
    const before = fake.control.calls.length;
    for (const path of ["/api/ai/generate", "/api/ai/generate-stream", "/api/ai/tasks"]) {
      for (const dialogueDensity of ["40%", "", null, 1, {}]) {
        const result = await request(path, { ...taskInput, dialogueDensity }, "POST", { "Idempotency-Key": crypto.randomUUID() });
        assert.equal(result.response.status, 400);
        assert.match(result.data.error, /对话密度无效/);
      }
    }
    for (const path of ["/api/ai/generate", "/api/ai/generate-stream", "/api/ai/tasks"]) {
      for (const proseControls of [null, "fast", [], { introspectionDensity: "extreme" }, { descriptionDetail: 2 }, { narrativePace: "high" }, { paragraphLength: "medium" }]) {
        const result = await request(path, { ...taskInput, proseControls }, "POST", { "Idempotency-Key": crypto.randomUUID() });
        assert.equal(result.response.status, 400);
        assert.match(result.data.error, /正文控制参数无效/);
      }
    }
    assert.equal(fake.control.calls.length, before);
    for (const target of ["outline", "chapter-title"]) {
      await api("/api/ai/generate", { ...generation, target, dialogueDensity: "high" });
      assert.doesNotMatch(prompt(), /dialogue_density/);
      assert.doesNotMatch(system(), /dialogue_density/);
    }
  });

  await t.test("cancellation, reload and retry retain the original prose controls and idempotency snapshot", async () => {
    const id = `density-${crypto.randomUUID()}`;
    const originalControls = { dialogueDensity: "low", introspectionDensity: "high", descriptionDetail: "balanced", narrativePace: "slow", paragraphLength: "short" };
    const created = await api("/api/ai/tasks", { ...taskInput, proseControls: originalControls }, "POST", { "Idempotency-Key": id });
    assert.deepEqual(created.data.contextOptions.proseControls, originalControls);
    assert.equal(created.data.contextOptions.dialogueDensity, "low");
    const duplicate = await api("/api/ai/tasks", { ...taskInput, proseControls: { ...originalControls, narrativePace: "fast" } }, "POST", { "Idempotency-Key": id });
    assert.deepEqual(duplicate.data.contextOptions.proseControls, originalControls);
    assert.equal(duplicate.data.contextOptions.dialogueDensity, "low");
    await api(`/api/ai/tasks/${id}/state`, { action: "cancel" });
    await api(`/api/ai/tasks/${id}/state`, { action: "retry", proseControls: { ...originalControls, narrativePace: "fast" } });
    const reloaded = (await api("/api/state")).data.tasks.find((item) => item.id === id);
    assert.deepEqual(reloaded.contextOptions.proseControls, originalControls);
    assert.equal(reloaded.contextOptions.dialogueDensity, "low");
    await api(`/api/ai/tasks/${id}/execute`, { runnerId: `test-${id}` });
    assert.match(prompt(), /<dialogue_density level="low">/);
    assert.match(prompt(), /<introspection_density level="high">/);
    assert.match(prompt(), /<description_detail level="balanced">/);
    assert.match(prompt(), /<narrative_pace level="slow">/);
    assert.match(prompt(), /<paragraph_length level="short">/);
    const completed = (await api("/api/ai/tasks")).tasks.find((item) => item.id === id);
    assert.equal(completed.state, "success", completed.error);
    assert.deepEqual(completed.contextOptions.proseControls, originalControls);
    assert.equal(completed.contextOptions.dialogueDensity, "low");
    const legacyId = `density-legacy-${crypto.randomUUID()}`;
    const legacy = await api("/api/ai/tasks", taskInput, "POST", { "Idempotency-Key": legacyId });
    assert.equal(legacy.data.contextOptions.dialogueDensity, "auto");
    await api(`/api/ai/tasks/${legacyId}/execute`, {});
    assert.doesNotMatch(prompt(), /<dialogue_density/);
  });

  await t.test("automatic review checks and revisions preserve active prose controls", async () => {
    fake.control.calls = [];
    const id = `density-review-${crypto.randomUUID()}`;
    const proseControls = { dialogueDensity: "high", introspectionDensity: "balanced", descriptionDetail: "high", narrativePace: "fast", paragraphLength: "long" };
    await api("/api/ai/tasks", { ...taskInput, proseControls, contentMode: "rewrite", rewriteRetention: "high", reviewMaxRounds: 1 }, "POST", { "Idempotency-Key": id });
    const deadline = Date.now() + 25_000;
    let task;
    do {
      task = (await api("/api/ai/tasks")).tasks.find((item) => item.id === id);
      if (["success", "failed", "cancelled"].includes(task?.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(task.state, "success", task.error);
    assert.deepEqual(fake.control.calls.map((call) => call.kind), ["generate", "review", "revise", "review"]);
    for (const call of fake.control.calls) {
      const content = call.body.messages.at(-1).content;
      assert.match(content, /<dialogue_density level="high">/);
      assert.match(content, /<introspection_density level="balanced">/);
      assert.match(content, /<description_detail level="high">/);
      assert.match(content, /<narrative_pace level="fast">/);
      assert.match(content, /<paragraph_length level="long">/);
      if (call.kind === "review") assert.match(call.body.messages[0].content, /作为正文问题报告/);
      if (call.kind === "revise") {
        assert.match(call.body.messages[0].content, /不得扩大修改范围/);
        assert.match(call.body.messages[0].content, /本次原文保留度为 high/);
      }
    }
  });
});
