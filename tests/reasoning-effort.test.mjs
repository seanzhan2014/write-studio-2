import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import ts from "typescript";
import { fullStudioFixture } from "./fixtures.mjs";
import { portableModels, createTransferEnvelope, parseTransferEnvelope } from "../lib/data-transfer.ts";

const code = ts.transpileModule(readFileSync(new URL("../lib/reasoning-options.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { REASONING_EFFORTS, reasoningRequestBody, reasoningEffortError, resolveReasoningEffort, taskReasoningEffort } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("reasoning inheritance distinguishes omission, explicit disabling and the none value", () => {
  assert.deepEqual(reasoningRequestBody({}), {});
  assert.deepEqual(reasoningRequestBody({ reasoningEffort: "high" }), { reasoning_effort: "high" });
  assert.deepEqual(reasoningRequestBody({ reasoningEffort: "high" }, null), {});
  for (const effort of REASONING_EFFORTS) {
    assert.deepEqual(reasoningRequestBody({ reasoningEffort: "high" }, effort), { reasoning_effort: effort });
    assert.equal(reasoningEffortError(effort), undefined);
  }
  for (const invalid of ["", "invalid", true, 1, [], {}]) assert.ok(reasoningEffortError(invalid));
  assert.equal(resolveReasoningEffort({ reasoningEffort: "high" }, undefined), "high");
  assert.equal(taskReasoningEffort({ reasoningEffort: "high", resolvedReasoningEffort: null }), null);
  assert.equal(taskReasoningEffort({ reasoningEffort: null, resolvedReasoningEffort: "low" }), "low");
  assert.equal(taskReasoningEffort({ reasoningEffort: "medium" }), "medium");
});

test("portable configuration preserves enabled, disabled and legacy model settings", () => {
  const models = ["high", null, undefined].map((effort, index) => ({ id: `m${index}`, providerId: "p", name: "模型", modelId: `model-${index}`, systemPrompt: "", temperature: null, maxOutput: null, maxInputCharacters: 60000, timeoutOverrideMs: null, reasoningEffort: effort }));
  const exported = portableModels(models);
  assert.deepEqual(exported.map((model) => model.reasoningEffort), ["high", null, null]);
  const settings = { ...fullStudioFixture().settings, generateReasoningEffort: null, chatReasoningEffort: "none", reviewReasoningEffort: "high" };
  const envelope = createTransferEnvelope("system-config", { settings, providers: [], models: exported });
  const restored = parseTransferEnvelope(JSON.parse(JSON.stringify(envelope)));
  assert.deepEqual(restored.data.models, exported);
  assert.deepEqual(restored.data.settings, settings);
});

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
test("reasoning settings survive model persistence and reach real task request paths", { skip: !baseUrl, timeout: 90_000 }, async (t) => {
  async function api(path, body, method = body ? "POST" : "GET", headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    assert.ok(response.ok, `${path}: ${response.status} ${text}`);
    return data;
  }
  const original = await api("/api/state");
  const fixture = fullStudioFixture();
  fixture.tasks = [];
  await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(original.revision) });
  const received = [];
  let failNext = false;
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    received.push(body);
    if (failNext) { failNext = false; response.writeHead(503); response.end("Temporary test failure"); return; }
    const prompt = body.messages.at(-1).content;
    if (body.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "推理设置测试回复" } }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    let content = "推理设置测试正文。";
    if (body.response_format?.json_schema?.name === "writer_studio_chapter_review") {
      content = JSON.stringify({ version: 1, chapterId: "chapter-main", sourceDigest: prompt.match(/source_digest="([^"]+)"/)[1], edits: [] });
    } else if (body.response_format) {
      content = JSON.stringify({ version: 1, sourceDigest: prompt.match(/source_digest="([^"]+)"/)[1], issues: [] });
    } else if (prompt.includes('purpose="outline-naming"')) content = "<outline_title>海港夜色中的旧日回声</outline_title>";
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const current = await api("/api/state");
    await api("/api/state", { data: original.data }, "PUT", { "If-Match": String(current.revision) });
    server.closeAllConnections(); server.close();
  });
  const provider = await api("/api/providers", { name: "Reasoning test", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "fake-reasoning-test-secret" });
  const model = await api("/api/models", { providerId: provider.id, name: "Reasoning test", modelId: "reasoning-test" });
  const patch = (body) => api(`/api/models/${model.id}`, body, "PATCH");
  const last = () => received.at(-1);
  const expectEffort = (expected) => expected === null ? assert.equal(Object.hasOwn(last(), "reasoning_effort"), false) : assert.equal(last().reasoning_effort, expected);
  const generate = (override) => api("/api/ai/generate", { outlineId: "outline-current", target: "content", model: model.id, reasoningEffort: override });

  await t.test("task preferences persist explicit disabling and can return to inheritance", async () => {
    let current = await api("/api/state");
    Object.assign(current.data.settings, { generateReasoningEffort: "high", chatReasoningEffort: null, namingReasoningEffort: "low", reviewReasoningEffort: "none" });
    await api("/api/state", { data: current.data }, "PUT", { "If-Match": String(current.revision) });
    current = await api("/api/state");
    assert.equal(current.data.settings.generateReasoningEffort, "high");
    assert.equal(current.data.settings.chatReasoningEffort, null);
    assert.equal(current.data.settings.namingReasoningEffort, "low");
    assert.equal(current.data.settings.reviewReasoningEffort, "none");
    delete current.data.settings.generateReasoningEffort;
    await api("/api/state", { data: current.data }, "PUT", { "If-Match": String(current.revision) });
    assert.equal((await api("/api/state")).data.settings.generateReasoningEffort, undefined);
  });

  await t.test("model defaults, edits, bulk creation and explicit disabling persist", async () => {
    assert.equal(model.reasoningEffort, null);
    await generate(); expectEffort(null);
    assert.equal((await patch({ reasoningEffort: "high" })).reasoningEffort, "high");
    assert.equal((await patch({ systemPrompt: "保持文字简洁" })).reasoningEffort, "high");
    assert.equal((await api("/api/models")).models.find((item) => item.id === model.id).reasoningEffort, "high");
    await generate(); expectEffort("high");
    await generate(null); expectEffort(null);
    await generate("none"); expectEffort("none");
    await generate("low"); expectEffort("low");
    const bulk = await api("/api/models/bulk", { providerId: provider.id, modelIds: ["bulk-reasoning-a", "bulk-reasoning-b"], reasoningEffort: "xhigh" });
    assert.equal(bulk.models.length, 2);
    assert.ok(bulk.models.every((item) => item.reasoningEffort === "xhigh"));
    for (const item of bulk.models) await api(`/api/models/${item.id}`, undefined, "DELETE");
    await patch({ reasoningEffort: null });
    await generate(); expectEffort(null);
    await generate("max"); expectEffort("max");
  });

  await t.test("all public AI entrypoints reject malformed effort before calling the model", async () => {
    const before = received.length;
    for (const route of ["/api/ai/generate", "/api/ai/generate-stream", "/api/ai/names", "/api/ai/review", "/api/ai/tasks", "/api/outlines/outline-current/chat/stream", "/api/outlines/outline-current/chat/transactions"]) {
      const response = await fetch(`${baseUrl}${route}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `invalid-${crypto.randomUUID()}` }, body: JSON.stringify({ action: "submit", taskId: "invalid", sessionId: "invalid", reasoningEffort: "invalid" }) });
      assert.equal(response.status, 400, route);
      assert.match(await response.text(), /reasoning_effort/, route);
    }
    assert.equal(received.length, before);
  });

  await t.test("direct chat, streaming generate, names and chapter review support overrides", async () => {
    await patch({ reasoningEffort: "high", maxOutput: 8000 });
    for (const effort of [undefined, null, "low"]) {
      await api("/api/outlines/outline-current/chat/stream", { message: "测试", model: model.id, reasoningEffort: effort });
      expectEffort(effort === undefined ? "high" : effort);
      assert.equal(Object.hasOwn(last(), "max_tokens"), false);
    }
    await api("/api/ai/generate-stream", { outlineId: "outline-current", target: "content", model: model.id, reasoningEffort: null }); expectEffort(null);
    assert.equal(Object.hasOwn(last(), "max_tokens"), false);
    await api("/api/ai/names", { articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "outline", model: model.id, reasoningEffort: "low" }); expectEffort("low");
    await api("/api/ai/review", { articleId: "article-main", chapterId: "chapter-main", model: model.id, additionalRequirement: "测试审校", reasoningEffort: null }); expectEffort(null);
  });

  await t.test("queued generation freezes inherited effort, including automatic retries", async () => {
    for (const override of [undefined, null, "low"]) {
      await patch({ reasoningEffort: "high" });
      const taskId = `reasoning-${crypto.randomUUID()}`;
      const created = await api("/api/ai/tasks", { articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "content", instruction: "测试任务参数", model: model.id, reasoningEffort: override }, "POST", { "Idempotency-Key": taskId });
      const expected = override === undefined ? "high" : override;
      assert.equal(created.data.contextOptions.resolvedReasoningEffort, expected);
      await patch({ reasoningEffort: "medium" });
      failNext = true;
      const before = received.length;
      await api(`/api/ai/tasks/${taskId}/execute`, { runnerId: `test-${taskId}` });
      assert.ok(received.length >= before + 2, "transient failure retried");
      for (const body of received.slice(before)) assert.equal(body.reasoning_effort ?? null, expected);
      const tasks = await api("/api/ai/tasks");
      assert.equal(tasks.tasks.find((item) => item.id === taskId).state, "success");
    }
  });

  await t.test("managed chat uses the submitted snapshot even after the model changes", async () => {
    await patch({ reasoningEffort: "high" });
    const taskId = `reasoning-chat-${crypto.randomUUID()}`;
    const sessionId = `session-${taskId}`;
    const message = "测试后台聊天参数";
    const created = await api("/api/outlines/outline-current/chat/transactions", { action: "submit", taskId, sessionId, message, model: model.id, reasoningEffort: null, messages: [{ id: `user-${taskId}`, role: "user", text: message, createdAt: new Date().toISOString() }] });
    assert.equal(created.task.contextOptions.resolvedReasoningEffort, null);
    await patch({ reasoningEffort: "max" });
    await api("/api/outlines/outline-current/chat/stream", { requestId: taskId, sessionId, message, model: model.id, reasoningEffort: null }, "POST", { "Idempotency-Key": taskId });
    expectEffort(null);
    assert.equal(Object.hasOwn(last(), "max_tokens"), false);
  });
});
