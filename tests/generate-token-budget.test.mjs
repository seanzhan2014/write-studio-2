import assert from "node:assert/strict";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";
import { reviewModelServer } from "./review-model.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;

async function api(path, method = "GET", body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { response, data };
}

test("generation leaves output limits to the provider", async (t) => {
  assert.ok(baseUrl);
  const fake = await reviewModelServer({ generationReasoningTokens: 10000 });
  t.after(() => fake.close());
  const { data: provider } = await api("/api/providers", "POST", { name: "Token budget", baseUrl: fake.baseUrl, secret: "fake-budget-key", timeoutMs: 20000 });
  const { data: model } = await api("/api/models", "POST", { providerId: provider.id, name: "Automatic budget", modelId: "default-thinking", maxInputCharacters: 120000 });

  async function reset() {
    const { data: current } = await api("/api/state");
    const data = fullStudioFixture();
    data.tasks = [];
    data.articles[0].reviewRules = "人物必须十八岁；保留环境描写。";
    const saved = await api("/api/state", "PUT", { data }, { "If-Match": String(current.revision) });
    assert.equal(saved.response.status, 200);
    fake.control.calls = [];
    const { data: baseline } = await api("/api/state");
    return baseline.data.articles[0].chapters[0].outlines.find((outline) => outline.id === "outline-current");
  }

  async function execute(options = {}) {
    const created = await api("/api/ai/tasks", "POST", {
      articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current",
      target: "content", model: model.id, contentMode: "fresh", targetWords: 4000,
      reviewMaxRounds: 0, ...options,
    }, { "Idempotency-Key": `budget-${crypto.randomUUID()}` });
    assert.equal(created.response.status, 200, JSON.stringify(created.data));
    const taskId = created.data.data.id;
    await api(`/api/ai/tasks/${taskId}/execute`, "POST", {});
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const { data } = await api("/api/ai/tasks");
      const task = data.tasks.find((item) => item.id === taskId);
      if (["success", "failed"].includes(task?.state)) return task;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail("generation did not finish");
  }

  for (const contentMode of ["fresh", "rewrite", "continue"]) {
    await t.test(`${contentMode} with a 4,000-character target can finish after reasoning`, async () => {
      await reset();
      const task = await execute({ contentMode });
      assert.equal(task.state, "success", task.error);
      assert.ok(task.resultVersionId);
      assert.ok(task.resultText.endsWith("她十七岁。\n\n窗外的雨停了。"));
      const { body } = fake.control.calls[0];
      assert.equal(Object.hasOwn(body, "max_tokens"), false);
      assert.equal(Object.hasOwn(body, "reasoning_effort"), false);
      assert.match(body.messages.at(-1).content, /<target_characters>4000<\/target_characters>/);
    });
  }

  await t.test("the same target completes generation, review, revision and verification", async () => {
    await reset();
    const task = await execute({ reviewMaxRounds: 1 });
    assert.equal(task.state, "success", task.error);
    assert.deepEqual(fake.control.calls.map((call) => call.kind), ["generate", "review", "revise", "review"]);
    assert.equal(task.resultText, "她十八岁。\n\n窗外的雨停了。");
    assert.equal(task.contextOptions.reviewReport.stopReason, "passed");
    for (const call of fake.control.calls) {
      if (call.kind === "generate") assert.equal(Object.hasOwn(call.body, "max_tokens"), false);
      else assert.equal(call.body.max_tokens, 65536);
    }
  });

  await t.test("direct and streaming generation omit the output limit with or without a target", async () => {
    await reset();
    for (const endpoint of ["generate", "generate-stream"]) {
      for (const targetWords of [4000, 0]) {
        const result = await api(`/api/ai/${endpoint}`, "POST", { outlineId: "outline-current", target: "content", model: model.id, targetWords });
        assert.equal(result.response.status, 200);
        assert.equal(result.data.text, "她十七岁。\n\n窗外的雨停了。", result.data.error);
        assert.equal(Object.hasOwn(fake.control.calls.at(-1).body, "max_tokens"), false);
      }
    }
  });

  await t.test("generation ignores a configured model output limit for every target", async () => {
    await reset();
    const { data: limited } = await api("/api/models", "POST", { providerId: provider.id, name: "Explicit budget", modelId: "limited-thinking", maxOutput: 8000, maxInputCharacters: 120000 });
    assert.equal(limited.maxOutput, 8000);
    for (const target of ["content", "outline", "chapter-title"]) {
      for (const endpoint of ["generate", "generate-stream"]) {
        const result = await api(`/api/ai/${endpoint}`, "POST", { outlineId: "outline-current", target, instruction: "测试输出上限", model: limited.id, targetWords: 4000 });
        assert.equal(result.response.status, 200, JSON.stringify(result.data));
        assert.ok(result.data.text, JSON.stringify(result.data));
        assert.equal(Object.hasOwn(fake.control.calls.at(-1).body, "max_tokens"), false);
      }
    }
    const task = await execute({ model: limited.id });
    assert.equal(task.state, "success", task.error);
    assert.equal(Object.hasOwn(fake.control.calls.at(-1).body, "max_tokens"), false);
  });

  await t.test("provider-truncated drafts never reach review or versions", async () => {
    const before = await reset();
    fake.control.mode = "truncated";
    const task = await execute({ reviewMaxRounds: 1 });
    assert.equal(task.state, "failed");
    assert.match(task.error, /输出长度上限/);
    assert.equal(task.resultVersionId, undefined);
    assert.deepEqual(fake.control.calls.map((call) => call.kind), ["generate"]);
    assert.equal(Object.hasOwn(fake.control.calls[0].body, "max_tokens"), false);
    const { data: saved } = await api("/api/state");
    const after = saved.data.articles[0].chapters[0].outlines.find((outline) => outline.id === "outline-current");
    assert.equal(after.currentVersionId, before.currentVersionId);
    assert.deepEqual(after.versions, before.versions);
  });
});
