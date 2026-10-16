import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../lib/spicy-api.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { isSpicyApi, spicyApiBaseUrl, spicyChatBaseUrl, discoverSpicyImageCatalog, spicyImageInput, generateSpicyImage } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const model = {
  model: "alibaba/wan-2.7-pro/text-to-image", displayName: "Wan 2.7 Pro", modality: "image", tasks: ["text-to-image"], enabled: true, available: true,
  inputSchema: { required: ["prompt"], properties: { prompt: { type: "string", maxLength: 5000 }, aspect_ratio: { type: "string", enum: ["1:1", "16:9"] }, resolution: { type: "string", enum: ["1k", "2k"] }, num_outputs: { type: "integer", default: 4 } } },
};
function mockApi(t, handler) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const call = { url: String(url), ...init, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return Response.json(await handler(call, calls), { status: 200 });
  });
  return calls;
}
const success = data => ({ code: 200, msg: "success", data });

test("SpicyAPI preserves native and compatibility base paths", () => {
  for (const base of ["https://api.spicyapi.ai", "https://api.spicyapi.ai/v1/", "https://api.spicyapi.ai/api/v1"]) {
    assert.equal(spicyApiBaseUrl(base), "https://api.spicyapi.ai/api/v1");
    assert.equal(spicyChatBaseUrl(base), "https://api.spicyapi.ai/v1");
    assert.equal(isSpicyApi({ baseUrl: base }), true);
  }
  assert.equal(isSpicyApi({ adapterKind: "spicyapi", baseUrl: "http://127.0.0.1/v1" }), true);
  assert.equal(isSpicyApi({ baseUrl: "https://api.spicyapi.ai.evil.example/v1" }), false);
  assert.equal(spicyApiBaseUrl("https://proxy.example/spicy/v1"), "https://proxy.example/spicy/api/v1");
});

test("native catalog exposes only callable prompt-only image models and schema enums", async t => {
  const calls = mockApi(t, () => success({ items: [model, { ...model, model: "disabled", enabled: false }, { ...model, model: "unavailable", available: false }, { ...model, model: "edit", tasks: ["edit"] }, { ...model, model: "video", modality: "video" }, { ...model, model: "controlnet", inputSchema: { required: ["prompt", "control_image_url"] } }] }));
  const result = await discoverSpicyImageCatalog("https://api.spicyapi.ai/v1", "fake-secret");
  assert.equal(calls[0].url, "https://api.spicyapi.ai/api/v1/models?modality=image&task=text-to-image&includeSchema=1");
  assert.equal(calls[0].headers.Authorization, "Bearer fake-secret");
  assert.equal(result.catalog.length, 1);
  assert.equal(result.catalog[0].name, "Wan 2.7 Pro");
  assert.deepEqual(result.catalog[0].metadata.outputModalities, ["image"]);
  assert.deepEqual(result.catalog[0].metadata.supportedParameters.aspect_ratio.values, ["1:1", "16:9"]);
  assert.equal(result.warnings.length, 1);
});

test("image input follows current schema and forces one output without OpenAI defaults", () => {
  assert.deepEqual(spicyImageInput(model, "A lighthouse", { aspectRatio: "16:9", resolution: "2k" }), { prompt: "A lighthouse", aspect_ratio: "16:9", resolution: "2k", num_outputs: 1 });
  assert.throws(() => spicyImageInput(model, "A lighthouse", { size: "1024x1024" }), /size/);
  assert.throws(() => spicyImageInput(model, "A lighthouse", { resolution: "4K" }), /resolution/);
  assert.throws(() => spicyImageInput(model, "x".repeat(5001)), /长度/);
  assert.throws(() => spicyImageInput({ ...model, available: false }, "hello"), /不可调用/);
});

test("generation quotes then submits once, polls pending image transfer and uses the result URL", { timeout: 15000 }, async t => {
  let polls = 0;
  const calls = mockApi(t, call => {
    if (call.url.includes("/models/")) return success(model);
    if (call.url.endsWith("/quote")) return success({ quoteId: "quote-1", estimatedCost: "0.075" });
    if (call.url.endsWith("/createTask")) return success({ taskId: "job-test", state: "queued" });
    return success(++polls === 1 ? { taskId: "job-test", state: "succeeded", output: { assets: [{ pending: true }] } } : { taskId: "job-test", state: "succeeded", output: { assets: [{ url: "https://images.example/result.webp", mime: "image/webp" }] } });
  });
  const result = await generateSpicyImage({ baseUrl: "https://api.spicyapi.ai/api/v1", secret: "fake-secret", modelId: model.model, timeoutMs: 10000 }, "A lighthouse", { aspectRatio: "16:9" });
  assert.equal(result.data[0].url, "https://images.example/result.webp");
  const created = calls.filter(call => call.url.endsWith("/createTask"));
  assert.equal(created.length, 1);
  assert.ok(created[0].headers["Idempotency-Key"]);
  assert.deepEqual(created[0].body, { model: model.model, input: { prompt: "A lighthouse", aspect_ratio: "16:9", num_outputs: 1 }, quoteId: "quote-1", expectedCost: "0.075" });
  assert.equal(calls.at(-1).url, "https://api.spicyapi.ai/api/v1/jobs/recordInfo?taskId=job-test");
});

test("HTTP 200 business errors do not create tasks or leak credentials", async t => {
  const calls = mockApi(t, () => ({ code: 40101, msg: "invalid Bearer fake-secret", data: null }));
  await assert.rejects(generateSpicyImage({ baseUrl: "https://api.spicyapi.ai/v1", secret: "fake-secret", modelId: model.model, timeoutMs: 1000 }, "hello"), error => !error.message.includes("fake-secret") && error.message.includes("40101"));
  assert.equal(calls.length, 1);
});

test("a failed task is not treated as success or automatically resubmitted", async t => {
  const calls = mockApi(t, call => success(call.url.includes("/models/") ? model : call.url.endsWith("/quote") ? { quoteId: "q", estimatedCost: "0.075" } : { taskId: "job-failed", state: "failed", errorCode: "upstream_failed", errorMessage: "fake-secret" }));
  await assert.rejects(generateSpicyImage({ baseUrl: "https://api.spicyapi.ai/v1", secret: "fake-secret", modelId: model.model, timeoutMs: 1000 }, "hello"), error => error.message.includes("job-failed") && error.message.includes("upstream_failed") && !error.message.includes("fake-secret"));
  assert.equal(calls.filter(call => call.url.endsWith("/createTask")).length, 1);
});

test("timeout and cancellation stop polling and retain the remote task ID", async t => {
  const calls = mockApi(t, call => success(call.url.includes("/models/") ? model : call.url.endsWith("/quote") ? { quoteId: "q", estimatedCost: "0.075" } : { taskId: "job-still-running", state: "queued" }));
  await assert.rejects(generateSpicyImage({ baseUrl: "https://api.spicyapi.ai/v1", secret: "fake-secret", modelId: model.model, timeoutMs: 30 }, "hello"), /等待超时.*job-still-running/);
  assert.equal(calls.length, 3);
  const controller = new AbortController();
  const waiting = generateSpicyImage({ baseUrl: "https://api.spicyapi.ai/v1", secret: "fake-secret", modelId: model.model, timeoutMs: 1000 }, "hello", {}, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(waiting, /停止等待.*job-still-running/);
  assert.equal(calls.length, 6);
});
