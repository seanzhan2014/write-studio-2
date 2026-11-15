import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";
import { DEFAULT_CHAT_MODE_PROMPTS } from "../lib/chat-modes.ts";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;

test("chat modes route separate defaults and preserve the submitted preset across settings changes", { skip: !baseUrl, timeout: 30000 }, async t => {
  async function api(path, body, method = "POST", headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  const current = await api("/api/state", undefined, "GET");
  const fixture = fullStudioFixture();
  fixture.tasks = [];
  assert.equal((await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(current.data.revision) })).status, 200);
  const prompts = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    prompts.push(JSON.parse(body).messages[0].content);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "测试回复" } }] })}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const provider = await api("/api/providers", { name: "Chat modes", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "fake-key" });
  const model = await api("/api/models", { providerId: provider.data.id, name: "Chat modes", modelId: "chat-modes" });
  assert.equal(model.status, 201);
  const route = "/api/outlines/outline-current/chat";
  for (const [index, mode] of ["normal", "outline", "writing"].entries()) {
    const sessionId = `chat-mode-${mode}`;
    const taskId = `chat-mode-${crypto.randomUUID()}`;
    const message = "根据已有资料继续";
    const submitted = await api(`${route}/transactions`, { action: "submit", taskId, sessionId, mode, message, model: model.data.id, messages: [{ id: `user-${taskId}`, role: "user", text: message, createdAt: new Date().toISOString() }] });
    assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
    assert.equal(submitted.data.task.contextOptions.chatMode, mode);
    assert.equal(submitted.data.task.contextOptions.chatModePrompt, DEFAULT_CHAT_MODE_PROMPTS[mode]);
    if (mode === "outline") {
      const state = await api("/api/state", undefined, "GET");
      assert.equal((await api("/api/settings", { chatModePrompts: { ...DEFAULT_CHAT_MODE_PROMPTS, outline: "保存后的新大纲预定义" } }, "PUT", { "If-Match": String(state.data.revision) })).status, 200);
    }
    const stream = await fetch(`${baseUrl}${route}/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: taskId, sessionId, mode, message, model: model.data.id }) });
    assert.equal(stream.status, 200);
    assert.match(await stream.text(), /测试回复/);
    assert.ok(prompts[index].includes(DEFAULT_CHAT_MODE_PROMPTS[mode]));
    if (mode !== "writing") assert.ok(!prompts[index].includes("关键冲突、决定和关系变化应展开成可经历的场景"));
    const state = await api("/api/state", undefined, "GET");
    const outline = state.data.data.articles.flatMap(a => a.chapters).flatMap(c => c.outlines).find(o => o.id === "outline-current");
    assert.equal(outline.chat.sessions.find(s => s.id === sessionId).mode, mode);
  }
  // Direct streaming also uses the edited saved preset rather than a client-supplied instruction.
  const direct = await fetch(`${baseUrl}${route}/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "outline", message: "整理概要", model: model.data.id }) });
  assert.equal(direct.status, 200);
  await direct.text();
  assert.ok(prompts.at(-1).includes("保存后的新大纲预定义"));
  assert.ok(!prompts.at(-1).includes(DEFAULT_CHAT_MODE_PROMPTS.writing));
});
