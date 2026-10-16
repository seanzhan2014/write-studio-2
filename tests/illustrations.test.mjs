import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { once } from "node:events";
import ts from "typescript";
import { fullStudioFixture } from "./fixtures.mjs";

const code = ts.transpileModule(readFileSync(new URL("../lib/image-generation.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseIllustrationPrompt, parseIllustrationImage } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const content = "林澈看向顾屿，确认潮汐表上的时间。";
const excerpt = "林澈看向顾屿";
const prompt = "文学插图：两人站在码头，侧光勾勒人物轮廓，冷色调，无文字。";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";

test("illustration selection rejects invented or changed source fragments and missing prompts", () => {
  assert.deepEqual(parseIllustrationPrompt(`\`\`\`json\n${JSON.stringify({ excerpt, prompt })}\n\`\`\``, content, excerpt), { excerpt, prompt });
  for (const value of [{ excerpt: "未来发生的事情", prompt }, { excerpt: content, prompt }, { excerpt, prompt: "" }]) {
    assert.throws(() => parseIllustrationPrompt(JSON.stringify(value), content, excerpt));
  }
  assert.throws(() => parseIllustrationPrompt("不是 JSON", content));
});

test("image responses accept base64 and HTTP images and reject unsafe or empty results", () => {
  assert.equal(parseIllustrationImage({ data: [{ b64_json: png }] }).src, `data:image/png;base64,${png}`);
  assert.equal(parseIllustrationImage({ output_format: "webp", data: [{ b64_json: "YWJj" }] }).src, "data:image/webp;base64,YWJj");
  assert.equal(parseIllustrationImage({ data: [{ url: "https://example.com/image.png" }] }).src, "https://example.com/image.png");
  for (const value of [null, {}, { data: [] }, { data: [{ url: "javascript:alert(1)" }] }, { data: [{ url: "https://user:secret@example.com/a" }] }, { data: [{ b64_json: "invalid<>" }] }]) assert.throws(() => parseIllustrationImage(value));
});

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
test("real illustration API uses separate text/image requests and preserves prose", { skip: !baseUrl, timeout: 60_000 }, async (t) => {
  async function api(path, body, method = body ? "POST" : "GET", headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : null;
    assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  }
  const original = await api("/api/state");
  const fixture = fullStudioFixture(); fixture.settings.taskConcurrency = 1;
  await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(original.revision) });
  const calls = [];
  let invalidSelection = false, failImage = false, remoteImage = false, delayImage = false;
  let imageGate;
  const server = http.createServer(async (request, response) => {
    if (request.url === "/generated.png") { response.writeHead(200, { "Content-Type": "image/png" }); response.end(Buffer.from(png, "base64")); return; }
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); calls.push({ path: request.url, body, authorization: request.headers.authorization });
    if (delayImage && request.url.endsWith("/images/generations")) await new Promise(resolve => { imageGate = resolve; });
    response.writeHead(failImage && request.url.endsWith("/images/generations") ? 503 : 200, { "Content-Type": "application/json" });
    if (request.url.endsWith("/images/generations")) response.end(JSON.stringify(failImage ? { error: "fake-illustration-secret" } : { data: [remoteImage ? { url: `http://127.0.0.1:${server.address().port}/generated.png` } : { b64_json: png }] }));
    else response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ excerpt: invalidSelection ? "不属于正文" : excerpt, prompt }) } }] }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  let provider;
  const createdModels = [];
  t.after(async () => {
    try {
      imageGate?.();
      const history = await api("/api/ai/illustrations?outlineId=outline-current");
      for (const record of history.records) {
        if (["queued", "running"].includes(record.status)) await api(`/api/ai/illustrations/${record.id}`, { action: "cancel" }, "PATCH");
        await api(`/api/ai/illustrations/${record.id}`, undefined, "DELETE");
      }
      for (const model of createdModels) await api(`/api/models/${model.id}`, undefined, "DELETE");
      if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE");
      const current = await api("/api/state");
      await api("/api/state", { data: original.data }, "PUT", { "If-Match": String(current.revision) });
    } finally { server.closeAllConnections(); server.close(); }
  });
  provider = await api("/api/providers", { name: "插图回归 Provider", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "fake-illustration-secret" });
  const textModel = await api("/api/models", { providerId: provider.id, name: "文本模型", modelId: "text-model" });
  createdModels.push(textModel);
  const imageModel = await api("/api/models", { providerId: provider.id, name: "图片模型", modelId: "image-model", metadata: { source: "manual", inputModalities: ["text"], outputModalities: ["image"] }, temperature: 0.4, reasoningEffort: "high" });
  createdModels.push(imageModel);
  const send = (body) => fetch(`${baseUrl}/api/ai/illustrations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outlineId: "outline-current", ...body }) });
  const before = await api("/api/state");
  const selected = await send({ action: "prompt", content, excerpt, model: textModel.id, style: "水彩" });
  assert.equal(selected.status, 200); assert.deepEqual(await selected.json(), { excerpt, prompt });
  assert.equal(calls.at(-1).path, "/v1/chat/completions");
  assert.equal(calls.at(-1).body.model, "text-model");
  const source = JSON.parse(calls.at(-1).body.messages.at(-1).content);
  assert.equal(source.content, content); assert.equal(source.selectedExcerpt, excerpt);
  assert.ok(!JSON.stringify(source).includes("后续正文秘密"));
  const auto = await send({ action: "prompt", content, model: textModel.id });
  assert.equal(auto.status, 200);
  const generated = await send({ action: "image", prompt: `${prompt} 额外编辑`, model: imageModel.id });
  assert.equal(generated.status, 200); assert.equal((await generated.json()).src, `data:image/png;base64,${png}`);
  assert.deepEqual(calls.at(-1).body, { model: "image-model", prompt: `${prompt} 额外编辑`, n: 1, size: "1024x1024" });
  assert.equal(calls.at(-1).authorization, "Bearer fake-illustration-secret");
  for (const body of [{ action: "prompt", content: "", model: textModel.id }, { action: "prompt", content, excerpt: "不存在", model: textModel.id }, { action: "image", prompt, model: "" }, { action: "other" }]) {
    const count = calls.length; assert.equal((await send(body)).status, 400); assert.equal(calls.length, count);
  }
  invalidSelection = true;
  const invalid = await send({ action: "prompt", content, model: textModel.id }); assert.equal(invalid.status, 502);
  invalidSelection = false; failImage = true;
  const failed = await send({ action: "image", prompt, model: imageModel.id }); assert.equal(failed.status, 502);
  assert.ok(!JSON.stringify(await failed.json()).includes("fake-illustration-secret"));
  failImage = false; assert.equal((await send({ action: "image", prompt, model: imageModel.id })).status, 200);

  // Library records live independently of the prose snapshot and revisions.
  const manual = (await api("/api/ai/illustrations", { action: "save-prompt", outlineId: "outline-current", prompt, excerpt, style: "水彩" })).record;
  assert.equal(manual.status, "success");
  assert.equal((await api(`/api/ai/illustrations/${manual.id}`, { action: "archive" }, "PATCH")).record.archived, true);
  assert.equal((await api(`/api/ai/illustrations/${manual.id}`, { action: "restore" }, "PATCH")).record.archived, false);
  const key = crypto.randomUUID();
  const backgroundBody = { action: "prompt", background: true, outlineId: "outline-current", content, excerpt, model: textModel.id };
  const job = (await api("/api/ai/illustrations", backgroundBody, "POST", { "Idempotency-Key": key })).record;
  assert.equal((await api("/api/ai/illustrations", backgroundBody, "POST", { "Idempotency-Key": key })).record.id, job.id);
  const waitFor = async (id, status) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const record = (await api(`/api/ai/illustrations/${id}`)).record;
      if (record.status === status) return record;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`Task ${id} did not reach ${status}`);
  };
  // No browser or execute request is needed for self-hosted background work.
  const savedPrompt = await waitFor(job.id, "success");
  assert.equal(savedPrompt.prompt, prompt);
  remoteImage = true;
  const imageJob = (await api("/api/ai/illustrations", { action: "image", background: true, outlineId: "outline-current", prompt: savedPrompt.prompt, model: imageModel.id })).record;
  const callsBefore = calls.length;
  await Promise.all([1, 2].map(() => fetch(`${baseUrl}/api/ai/illustrations/${imageJob.id}/execute`, { method: "POST" }).then(response => response.text())));
  const savedImage = await waitFor(imageJob.id, "success");
  assert.ok(calls.length <= callsBefore + 1, "Concurrent dispatch must not duplicate model calls");
  assert.ok(savedImage.src.startsWith("/api/ai/illustrations/"));
  const imageResponse = await fetch(`${baseUrl}${savedImage.src}?download=1`);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
  assert.match(imageResponse.headers.get("content-disposition"), /attachment/);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), Buffer.from(png, "base64"));
  const imageFileCount = (await import("node:fs")).readdirSync(new URL("illustrations/", `file:///${process.env.WRITER_STUDIO_TEST_DB_PATH.replaceAll("\\", "/")}`));
  assert.ok(imageFileCount.length > 0);
  await api(`/api/ai/illustrations/${savedImage.id}`, undefined, "DELETE");
  assert.equal((await fetch(`${baseUrl}${savedImage.src}`)).status, 404);
  const remainingFiles = (await import("node:fs")).readdirSync(new URL("illustrations/", `file:///${process.env.WRITER_STUDIO_TEST_DB_PATH.replaceAll("\\", "/")}`));
  assert.equal(remainingFiles.length, imageFileCount.length - 1, "Delete must remove stored bytes");

  failImage = true; remoteImage = false;
  const failedJob = (await api("/api/ai/illustrations", { action: "image", background: true, outlineId: "outline-current", prompt, model: imageModel.id })).record;
  const failure = await waitFor(failedJob.id, "error");
  assert.ok(!failure.error.includes("fake-illustration-secret"));
  failImage = false;
  const retryResponse = await api(`/api/ai/tasks/${failedJob.id}/state`, { action: "retry" });
  assert.equal(retryResponse.task.state, "waiting");
  const retried = { id: failedJob.id };
  assert.equal(retried.id, failedJob.id);
  await waitFor(retried.id, "success");
  delayImage = true;
  const cancelled = (await api("/api/ai/illustrations", { action: "image", background: true, outlineId: "outline-current", prompt, model: imageModel.id })).record;
  await waitFor(cancelled.id, "running");
  const queued = (await api("/api/ai/illustrations", { action: "image", background: true, outlineId: "outline-current", prompt, model: imageModel.id })).record;
  const countAtCapacity = calls.length;
  await fetch(`${baseUrl}/api/ai/tasks/${queued.id}/execute`, { method: "POST" }).then(response => response.text());
  assert.equal((await api(`/api/ai/illustrations/${queued.id}`)).record.status, "queued");
  assert.equal(calls.length, countAtCapacity, "Illustrations must obey the shared task concurrency setting");
  await api(`/api/ai/tasks/${queued.id}/state`, { action: "cancel" });
  assert.equal((await api(`/api/ai/tasks/${cancelled.id}/state`, { action: "cancel" })).task.state, "cancelled");
  imageGate?.(); delayImage = false;
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal((await api(`/api/ai/illustrations/${cancelled.id}`)).record.status, "cancelled");
  const history = await api("/api/ai/illustrations?outlineId=outline-current");
  assert.ok(history.records.some(record => record.id === job.id && record.prompt === prompt));
  const after = await api("/api/state");
  assert.deepEqual(after.data.articles, before.data.articles); assert.deepEqual(after.data.settings, before.data.settings);
  assert.ok(after.revision > before.revision);
  const unified = await api("/api/ai/tasks");
  const promptTask = unified.tasks.find(task => task.id === job.id);
  assert.equal(promptTask.target, "插图 Prompt"); assert.equal(promptTask.state, "success");
  assert.ok(promptTask.history.some(entry => entry.phase === "generating"));
  const imageTask = unified.tasks.find(task => task.id === retried.id);
  assert.equal(imageTask.target, "插图"); assert.equal(imageTask.state, "success");
  assert.ok(imageTask.history.some(entry => entry.phase === "failed"));
  assert.ok(imageTask.history.some(entry => entry.phase === "saving"));
  assert.ok(unified.tasks.some(task => task.id === cancelled.id && task.state === "cancelled"));
  assert.deepEqual(unified.runningOutlineIds, []);
  const revised = structuredClone(after.data);
  revised.articles[0].summary += "插图历史持久化回归";
  revised.tasks = revised.tasks.filter(task => task.id !== job.id);
  await api("/api/state", { data: revised }, "PUT", { "If-Match": String(after.revision) });
  assert.equal((await api(`/api/ai/illustrations/${manual.id}`)).record.prompt, prompt, "Saving a full studio snapshot must preserve library history");
  assert.equal((await api(`/api/ai/illustrations/${job.id}`)).record.prompt, prompt, "Removing an AI task must retain its saved prompt");
  assert.ok(!(await api("/api/ai/tasks")).tasks.some(task => task.id === job.id), "Removed AI tasks must not reappear from library backfill");
  assert.equal((await api("/api/ai/tasks")).tasks.find(task => task.id === retried.id).target, "插图", "Full snapshot persistence must retain illustration task targets");
  const { DatabaseSync } = await import("node:sqlite");
  const legacyDb = new DatabaseSync(process.env.WRITER_STUDIO_TEST_DB_PATH);
  try {
    legacyDb.prepare("DELETE FROM ai_tasks WHERE id=?").run(retried.id);
    legacyDb.prepare("UPDATE illustration_history SET input_json=json_remove(input_json,'$._aiTaskRegistered') WHERE id=?").run(retried.id);
    assert.equal((await api("/api/ai/tasks")).tasks.filter(task => task.id === retried.id).length, 1, "Existing library jobs must appear exactly once in AI tasks");
    legacyDb.prepare("UPDATE ai_tasks SET status='running',phase='generating' WHERE id=?").run(retried.id);
    assert.equal((await api("/api/ai/tasks")).tasks.find(task => task.id === retried.id).state, "success", "A completion from the previous deployment must reach the unified task manager");
    assert.equal((await api("/api/ai/tasks")).tasks.filter(task => task.id === retried.id).length, 1);
  } finally { legacyDb.close(); }
});
