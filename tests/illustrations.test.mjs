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
  await api("/api/state", { data: fullStudioFixture() }, "PUT", { "If-Match": String(original.revision) });
  const calls = [];
  let invalidSelection = false, failImage = false;
  const server = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); calls.push({ path: request.url, body, authorization: request.headers.authorization });
    response.writeHead(failImage && request.url.endsWith("/images/generations") ? 503 : 200, { "Content-Type": "application/json" });
    if (request.url.endsWith("/images/generations")) response.end(JSON.stringify(failImage ? { error: "fake-illustration-secret" } : { data: [{ b64_json: png }] }));
    else response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ excerpt: invalidSelection ? "不属于正文" : excerpt, prompt }) } }] }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  let provider;
  const createdModels = [];
  t.after(async () => {
    try {
      for (const model of createdModels) await api(`/api/models/${model.id}`, undefined, "DELETE");
      if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE");
      const current = await api("/api/state");
      await api("/api/state", { data: original.data }, "PUT", { "If-Match": String(current.revision) });
    } finally { server.closeAllConnections(); server.close(); }
  });
  provider = await api("/api/providers", { name: "插图回归 Provider", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "fake-illustration-secret" });
  const textModel = await api("/api/models", { providerId: provider.id, name: "文本模型", modelId: "text-model" });
  createdModels.push(textModel);
  const imageModel = await api("/api/models", { providerId: provider.id, name: "图片模型", modelId: "image-model", temperature: 0.4, reasoningEffort: "high" });
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
  const after = await api("/api/state"); assert.deepEqual(after.data, before.data); assert.equal(after.revision, before.revision);
});
