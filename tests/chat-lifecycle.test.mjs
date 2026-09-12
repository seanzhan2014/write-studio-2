import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fullStudioFixture } from "./fixtures.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
const outlineId = "outline-current";
const route = `/api/outlines/${outlineId}/chat`;
async function api(path, body, method = body ? "POST" : "GET", headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  return { status: response.status, data };
}
async function until(check, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error("Timed out waiting for chat task");
}

test("durable chat lifecycle", { skip: !baseUrl, timeout: 90_000 }, async (t) => {
  const current = await api("/api/state");
  const fixture = fullStudioFixture();
  fixture.tasks = [];
  assert.equal((await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(current.data.revision) })).status, 200);
  let mode = "fast";
  let calls = 0;
  let upstreamClosed = false;
  let release = () => {};
  const server = http.createServer(async (request, response) => {
    request.resume();
    await once(request, "end");
    calls++;
    const requestMode = mode;
    response.on("close", () => { if (!response.writableEnded) upstreamClosed = true; });
    if (requestMode === "headers-stall") { release = () => response.end(); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "已保存部分" } }] })}\n\n`);
    if (requestMode === "body-stall") { release = () => response.end(); return; }
    if (requestMode === "gated") await new Promise((resolve) => { release = resolve; });
    if (!response.destroyed) response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "完整结果" } }] })}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { release(); server.closeAllConnections(); server.close(); });
  const provider = await api("/api/providers", { name: "Chat lifecycle", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "fake-chat-test-secret", timeoutMs: 5000 });
  assert.equal(provider.status, 201);
  const model = await api("/api/models", { providerId: provider.data.id, name: "Lifecycle model", modelId: "test-model" });
  assert.equal(model.status, 201);
  async function submit() {
    const taskId = `lifecycle-${crypto.randomUUID()}`;
    const sessionId = `session-${taskId}`;
    const message = "测试聊天可靠性";
    const created = await api(`${route}/transactions`, { action: "submit", taskId, sessionId, message, model: model.data.id, messages: [{ id: `user-${taskId}`, role: "user", text: message, createdAt: new Date().toISOString() }] });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    return { taskId, sessionId, message, model: model.data.id, requestId: taskId };
  }
  const snapshot = async (task) => (await api(`${route}/transactions`, { action: "status", ...task })).data;
  const run = (task, signal) => fetch(`${baseUrl}${route}/stream`, { method: "POST", signal, headers: { "Content-Type": "application/json", "Idempotency-Key": task.taskId }, body: JSON.stringify(task) });
  const terminal = (task) => until(async () => { const state = await snapshot(task); return state.task.state !== "running" ? state : null; });

  await t.test("saves the result without any browser completion callback; repeated acknowledgements cannot duplicate or overwrite it", async () => {
    mode = "fast";
    const task = await submit();
    const response = await run(task);
    assert.equal(response.status, 200);
    await response.text();
    const saved = await terminal(task);
    assert.equal(saved.task.state, "success");
    assert.equal(saved.task.history[0].phase, "connecting");
    assert.equal(saved.task.history.at(-1).phase, "completed");
    assert.equal(saved.task.history.filter((entry) => entry.phase === "receiving").length, 1);
    assert.equal(saved.message.text, "已保存部分完整结果");
    const attempts = await Promise.all(Array.from({ length: 3 }, () => api(`${route}/transactions`, { action: "finalize", ...task, status: "failed", result: "迟到的错误回复" })));
    for (const attempt of attempts) { assert.equal(attempt.data.task.state, "success"); assert.equal(attempt.data.message.id, saved.message.id); }
    const state = (await api("/api/state")).data.data;
    const sessions = state.articles.flatMap((a) => a.chapters.flatMap((c) => c.outlines.flatMap((o) => o.chat.sessions)));
    assert.equal(sessions.find((s) => s.id === task.sessionId).messages.filter((m) => m.role === "assistant").length, 1);
    assert.equal((await api(`${route}/transactions`, { action: "finalize", ...task, sessionId: "wrong-session", status: "success" })).status, 409);
  });

  await t.test("disconnect preserves execution and partial progress; completion survives a fresh state read", async () => {
    mode = "gated";
    const task = await submit();
    const controller = new AbortController();
    const pending = run(task, controller.signal).then((r) => r.text()).catch(() => undefined);
    await until(async () => (await snapshot(task)).task.receivedCharacters > 0);
    controller.abort();
    await pending;
    assert.equal((await snapshot(task)).task.state, "running");
    const loaded = (await api("/api/state")).data.data.tasks.find((item) => item.id === task.taskId);
    assert.equal(loaded.resultText, "已保存部分");
    release();
    assert.equal((await terminal(task)).task.state, "success");
  });

  await t.test("stale autosaves cannot replace a chat worker or its completed result", async () => {
    mode = "gated";
    const task = await submit();
    const stale = (await snapshot(task)).task;
    const pending = run(task).then((r) => r.text());
    await until(async () => (await snapshot(task)).task.receivedCharacters > 0);
    const saveStale = async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const state = await api("/api/state");
        const changes = Object.fromEntries(["articles", "chapters", "outlines", "characters", "relationships", "tasks"].map((key) => [key, { upsert: [], delete: [] }]));
        changes.version = 2;
        changes.outlines.patch = [];
        changes.tasks.upsert = [stale];
        const saved = await api("/api/state/mutations", { changes }, "POST", { "If-Match": String(state.data.revision) });
        if (saved.status === 409) continue;
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        return;
      }
      assert.fail("autosave kept conflicting");
    };
    await saveStale();
    const active = (await snapshot(task)).task;
    assert.match(active.runnerId, /^server-chat-/);
    assert.equal(active.contextOptions.serverManaged, true);
    assert.equal(active.resultText, "已保存部分");
    release();
    await pending;
    assert.equal((await terminal(task)).task.state, "success");
    await saveStale();
    const completed = await snapshot(task);
    assert.equal(completed.task.state, "success");
    assert.equal(completed.message.text, "已保存部分完整结果");
  });

  await t.test("cross-page cancellation wins over late completion and aborts upstream", async () => {
    mode = "gated";
    upstreamClosed = false;
    const task = await submit();
    const pending = run(task).then((r) => r.text());
    await until(async () => (await snapshot(task)).task.receivedCharacters > 0);
    const cancelled = await api(`/api/ai/tasks/${task.taskId}/state`, { action: "cancel" });
    assert.equal(cancelled.data.task.state, "cancelled");
    await until(() => upstreamClosed);
    release();
    await pending;
    const late = await api(`${route}/transactions`, { action: "finalize", ...task, status: "success", result: "迟到的完整结果" });
    assert.equal(late.data.task.state, "cancelled");
    assert.equal(late.data.message.text, "已保存部分");
    assert.equal((await api(`/api/ai/tasks/${task.taskId}/state`, { action: "retry" })).status, 409);
  });

  for (const stalled of ["headers-stall", "body-stall"]) await t.test(`timeout covers ${stalled} and persists failure without a client`, async () => {
    mode = stalled;
    const task = await submit();
    await (await run(task)).text();
    const saved = await terminal(task);
    assert.equal(saved.task.state, "failed");
    assert.match(saved.task.error, /超时/);
    assert.equal(saved.task.resultText ?? "", stalled === "body-stall" ? "已保存部分" : "");
  });

  await t.test("retries a failed final transaction without losing text or inserting duplicate replies", { skip: !process.env.WRITER_STUDIO_TEST_DB_PATH }, async () => {
    mode = "fast";
    const task = await submit();
    const database = new DatabaseSync(process.env.WRITER_STUDIO_TEST_DB_PATH);
    database.exec("CREATE TRIGGER fail_chat_completion BEFORE UPDATE OF status ON ai_tasks WHEN NEW.status='success' AND NEW.target='chat' BEGIN SELECT RAISE(ABORT,'injected completion failure'); END");
    const pending = run(task).then((r) => r.text());
    try {
      await until(async () => { const saved = await snapshot(task); return saved.task.phase === "saving" && saved.task.resultText === "已保存部分完整结果"; });
      database.exec("DROP TRIGGER fail_chat_completion");
      await pending;
      const completed = await terminal(task);
      assert.equal(completed.task.state, "success");
      assert.equal(completed.message.text, "已保存部分完整结果");
      assert.equal(Number(database.prepare("SELECT count(*) AS n FROM chat_messages WHERE session_id=? AND role='assistant'").get(task.sessionId).n), 1);
    } finally { database.exec("DROP TRIGGER IF EXISTS fail_chat_completion"); database.close(); }
  });

  await t.test("expired worker leases and legacy tasks recover once, retaining partial text", async () => {
    const old = await api("/api/state");
    const data = old.data.data;
    for (const legacy of [true, false]) {
      const id = `recovery-${legacy}`;
      data.tasks.unshift({ id, articleId: "article-main", chapterId: "chapter-current", outlineId, target: "AI Chat", prompt: "恢复", model: "", executionOrigin: "local", state: "running", phase: "receiving", createdAt: "2020-01-01T00:00:00.000Z", startedAt: "2020-01-01T00:00:00.000Z", timeoutMs: 5000, runnerId: `server-chat-${id}`, leaseUntil: legacy ? undefined : "2020-01-01T00:01:00.000Z", resultText: "保留的片段", contextOptions: { sessionId: "chat:outline-current", includePrevious: true, includeCharacters: true, estimatedCharacters: 0 } });
    }
    // Use the actual fixture chapter identity.
    const article = data.articles.find((a) => a.chapters.some((c) => c.outlines.some((o) => o.id === outlineId)));
    const chapter = article.chapters.find((c) => c.outlines.some((o) => o.id === outlineId));
    for (const task of data.tasks.filter((item) => item.id.startsWith("recovery-"))) { task.articleId = article.id; task.chapterId = chapter.id; }
    assert.equal((await api("/api/state", { data }, "PUT", { "If-Match": String(old.data.revision) })).status, 200);
    const recovered = await api("/api/state");
    for (const task of recovered.data.data.tasks.filter((item) => item.id.startsWith("recovery-"))) { assert.equal(task.state, "failed"); assert.equal(task.resultText, "保留的片段"); }
    assert.equal((await api("/api/state")).data.revision, recovered.data.revision);
  });
  assert.equal(calls, process.env.WRITER_STUDIO_TEST_DB_PATH ? 7 : 6, "recoveries and acknowledgements never generate again");
});
