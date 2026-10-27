import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { fullStudioFixture } from "./fixtures.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
test("custom style prompts reach both image steps and queued jobs retain their style snapshot", { skip: !baseUrl, timeout: 60_000 }, async t => {
  async function api(path, body, method = body ? "POST" : "GET", headers = {}) {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : null;
    assert.ok(response.ok, `${path}: ${response.status} ${raw}`);
    return data;
  }
  const original = await api("/api/state");
  const calls = [];
  const content = "她望着海边的灯塔。";
  const server = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); calls.push(body);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.url.endsWith("/images/generations") ? { data: [{ b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=" }] } : { choices: [{ message: { content: JSON.stringify({ excerpt: content, prompt: "A lighthouse by the sea at night, blue tones.", negativePrompt: "text, watermark, blurry" }) } }] }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  let provider;
  const models = [];
  t.after(async () => {
    try {
      const history = await api("/api/ai/illustrations?outlineId=outline-current");
      for (const record of history.records) { if (["queued", "running"].includes(record.status)) await api(`/api/ai/illustrations/${record.id}`, { action: "cancel" }, "PATCH"); await api(`/api/ai/illustrations/${record.id}`, undefined, "DELETE"); }
      for (const model of models) await api(`/api/models/${model.id}`, undefined, "DELETE");
      if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE");
      const latest = await api("/api/state");
      await api("/api/state", { data: original.data }, "PUT", { "If-Match": String(latest.revision) });
    } finally { server.closeAllConnections(); server.close(); }
  });
  const fixture = fullStudioFixture();
  const custom = { value: "custom-film", label: "胶片夜景", description: "蓝色颗粒", instruction: "CUSTOM_FILM_BLUE_GRAIN" };
  const edited = { value: "watercolor", label: "水彩插画", description: "修改预设", instruction: "EDITED_WATERCOLOR_PROMPT" };
  fixture.settings.illustrationStyles = [custom, edited];
  await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(original.revision) });
  provider = await api("/api/providers", { name: "风格 API 测试", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "style-test-secret" });
  const text = await api("/api/models", { providerId: provider.id, name: "文字", modelId: "text" }); models.push(text);
  const image = await api("/api/models", { providerId: provider.id, name: "图片", modelId: "image", metadata: { source: "manual", inputModalities: ["text"], outputModalities: ["image"] } }); models.push(image);
  const send = body => api("/api/ai/illustrations", { outlineId: "outline-current", ...body });
  await send({ action: "prompt", content, model: text.id, stylePreset: custom.value });
  assert.match(JSON.parse(calls.at(-1).messages.at(-1).content).visualDirection, /CUSTOM_FILM_BLUE_GRAIN/);
  await send({ action: "image", prompt: "海边的灯塔", model: image.id, stylePreset: custom.value });
  assert.match(calls.at(-1).prompt, /CUSTOM_FILM_BLUE_GRAIN/);
  await send({ action: "image", prompt: "海边的灯塔", model: image.id, stylePreset: edited.value });
  assert.match(calls.at(-1).prompt, /EDITED_WATERCOLOR_PROMPT/);
  assert.doesNotMatch(calls.at(-1).prompt, /自然晕染/);
  const manual = await send({ action: "save-prompt", prompt: "海边的灯塔", stylePreset: custom.value });
  assert.equal(manual.record.stylePreset, custom.value);
  const requestId = crypto.randomUUID();
  const body = { action: "image", background: true, outlineId: "outline-current", prompt: "海边的灯塔", model: image.id, stylePreset: custom.value };
  const queued = await api("/api/ai/illustrations", body, "POST", { "Idempotency-Key": requestId });
  const latest = await api("/api/state");
  const changes = { version: 1, settings: { ...latest.data.settings, illustrationStyles: [] }, ...Object.fromEntries(["articles", "chapters", "outlines", "characters", "relationships", "tasks"].map(key => [key, { upsert: [], delete: [] }])) };
  await api("/api/state/mutations", { changes }, "POST", { "If-Match": String(latest.revision) });
  assert.equal((await api("/api/ai/illustrations", body, "POST", { "Idempotency-Key": requestId })).record.id, queued.record.id);
  await api(`/api/ai/illustrations/${queued.record.id}/execute`, {});
  assert.equal((await api(`/api/ai/illustrations/${queued.record.id}`)).record.status, "success");
  assert.match(calls.at(-1).prompt, /CUSTOM_FILM_BLUE_GRAIN/);
  await send({ action: "image", prompt: "海边的灯塔", model: image.id, stylePreset: custom.value });
  assert.equal(calls.at(-1).prompt, "海边的灯塔", "Deleted styles fall back to the prompt without restoring presets");
  assert.deepEqual((await api("/api/state")).data.settings.illustrationStyles.map(s => s.value), ["auto"]);
});
