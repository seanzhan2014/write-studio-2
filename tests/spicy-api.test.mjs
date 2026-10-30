import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const parameterCode = ts.transpileModule(readFileSync(new URL("../lib/image-model-parameters.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const parameterUrl = `data:text/javascript;base64,${Buffer.from(parameterCode).toString("base64")}`;
const code = ts.transpileModule(readFileSync(new URL("../lib/spicy-api.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replaceAll("./image-model-parameters", parameterUrl);
const { isSpicyApi, spicyApiBaseUrl, spicyChatBaseUrl, discoverSpicyCatalog, spicyImageInput, generateSpicyImage } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
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

test("native catalog exposes callable image models and schema enums", async t => {
  const calls = mockApi(t, () => success({ items: [model, { ...model, model: "disabled", enabled: false }, { ...model, model: "unavailable", available: false }, { ...model, model: "edit", tasks: ["edit"] }, { ...model, model: "video", modality: "video" }, { ...model, model: "controlnet", inputSchema: { required: ["prompt", "control_image_url"] } }] }));
  const result = await discoverSpicyCatalog("https://api.spicyapi.ai/v1", "fake-secret");
  assert.equal(calls[0].url, "https://api.spicyapi.ai/api/v1/models?includeSchema=1");
  assert.equal(calls[0].headers.Authorization, "Bearer fake-secret");
  assert.equal(result.catalog.length, 1);
  assert.equal(result.catalog[0].name, "Wan 2.7 Pro");
  assert.deepEqual(result.catalog[0].metadata.outputModalities, ["image"]);
  assert.deepEqual(result.catalog[0].metadata.supportedParameters.aspect_ratio.values, ["1:1", "16:9"]);
  assert.equal(result.warnings.length, 1);
});

test("native catalog includes available chat models alongside images and excludes other tasks", async t => {
  const chat = { model: "publisher/writer/chat", displayName: "Writer", modality: "text", tasks: ["chat"], enabled: true, available: true, inputSchema: { properties: { messages: { type: "array" }, reasoning_effort: { type: "string", enum: ["low", "high"] } } } };
  const calls = mockApi(t, () => success({ items: [model, chat, { ...chat, model: "disabled", enabled: false }, { ...chat, model: "unavailable", available: false }, { ...chat, model: "embedding", tasks: ["embedding"] }, { ...chat, model: "audio", modality: "audio" }] }));
  const result = await discoverSpicyCatalog("https://api.spicyapi.ai/api/v1", "fake-secret");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.spicyapi.ai/api/v1/models?includeSchema=1");
  assert.deepEqual(result.catalog.map(entry => entry.id), [model.model, chat.model]);
  const writer = result.catalog.find(entry => entry.id === chat.model);
  assert.equal(writer.name, "Writer");
  assert.deepEqual(writer.metadata.inputModalities, ["text"]);
  assert.deepEqual(writer.metadata.outputModalities, ["text"]);
  assert.deepEqual(writer.metadata.supportedParameters.reasoning_effort.values, ["low", "high"]);
  assert.deepEqual(result.catalog[0].metadata.outputModalities, ["image"]);
});

test("text-only accounts can synchronize and an empty callable catalog reports both supported capabilities", async t => {
  let items = [{ model: "publisher/writer/chat", modality: "text", tasks: ["chat"], enabled: true, available: true }];
  mockApi(t, () => success({ items }));
  assert.equal((await discoverSpicyCatalog("https://api.spicyapi.ai", "fake-secret")).catalog[0].name, items[0].model);
  items = [];
  await assert.rejects(discoverSpicyCatalog("https://api.spicyapi.ai", "fake-secret"), /文字或图片模型/);
});

test("image input follows current schema and forces one output without OpenAI defaults", () => {
  assert.deepEqual(spicyImageInput(model, "A lighthouse", { aspectRatio: "16:9", resolution: "2k" }), { prompt: "A lighthouse", aspect_ratio: "16:9", resolution: "2k", num_outputs: 1 });
  assert.throws(() => spicyImageInput(model, "A lighthouse", { size: "1024x1024" }), /size/);
  assert.throws(() => spicyImageInput(model, "A lighthouse", { resolution: "4K" }), /resolution/);
  assert.throws(() => spicyImageInput(model, "x".repeat(5001)), /长度/);
  assert.throws(() => spicyImageInput({ ...model, available: false }, "hello"), /不可调用/);
});

test("Spicy image settings follow the current schema and preserve false and zero values", () => {
  const configured = { ...model, inputSchema: { ...model.inputSchema, additionalProperties: false, properties: { ...model.inputSchema.properties, seed: { type: "integer" }, enable_prompt_expansion: { type: "boolean" } } } };
  const input = spicyImageInput(configured, "A tree", { parameters: { seed: 0, enable_prompt_expansion: false } });
  assert.equal(input.seed, 0); assert.equal(input.enable_prompt_expansion, false);
  assert.throws(() => spicyImageInput(model, "A tree", { parameters: { seed: 42 } }), /不支持高级参数/);
  assert.throws(() => spicyImageInput(configured, "A tree", { parameters: { steps: 20 } }), /不支持高级参数/);
});

test("reference models are discovered with image capabilities and preserve URI order in native input", async t => {
  const edit = { ...model, model: "example/identity/edit", tasks: ["image-to-image"], inputSchema: { type: "object", required: ["prompt", "image_urls"], additionalProperties: false, properties: { prompt: { type: "string" }, image_urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3, "x-ui": { widget: "multi-upload", accept: "image/*" } } } } };
  mockApi(t, () => success({ items: [model, edit] }));
  const result = await discoverSpicyCatalog("https://api.spicyapi.ai", "fake-secret");
  const entry = result.catalog.find(item => item.id === edit.model);
  assert.deepEqual(entry.metadata.inputModalities, ["text", "image"]);
  assert.equal(entry.metadata.supportedParameters.image_urls.maxImages, 3);
  assert.equal(entry.metadata.supportedParameters.image_urls.required, true);
  const referenceImages = ["spicy://a/ast_side", "spicy://a/ast_front"];
  assert.deepEqual(spicyImageInput(edit, "portrait", { referenceImages }), { prompt: "portrait", image_urls: referenceImages });
  assert.throws(() => spicyImageInput(edit, "portrait"), /参考图/);
  assert.throws(() => spicyImageInput(model, "portrait", { referenceImages }), /不支持人物参考图/);
  assert.throws(() => spicyImageInput(edit, "portrait", { referenceImages: [...referenceImages, ...referenceImages] }), /最多支持 3/);
  const single = { ...edit, inputSchema: { required: ["prompt", "image_url"], properties: { prompt: { type: "string" }, image_url: { type: "string", "x-ui": { widget: "upload", accept: "image/*" } } } } };
  assert.equal(spicyImageInput(single, "portrait", { referenceImages: referenceImages.slice(0, 1) }).image_url, referenceImages[0]);
  assert.throws(() => spicyImageInput(single, "portrait", { referenceImages }), /最多支持 1/);
});

test("conditional reference requirements and masks fail before a paid request", async t => {
  const conditional = { ...model, inputSchema: { required: ["prompt"], anyOf: [{ required: ["image_urls"] }], properties: { prompt: { type: "string" }, image_urls: { type: "array", items: { type: "string" }, maxItems: 2 } } } };
  assert.throws(() => spicyImageInput(conditional, "portrait"), /实时结构/);
  assert.deepEqual(spicyImageInput(conditional, "portrait", { referenceImages: ["spicy://a/ast_face"] }).image_urls, ["spicy://a/ast_face"]);
  const mask = { ...model, inputSchema: { required: ["prompt", "mask_image_url"], properties: { prompt: { type: "string" }, mask_image_url: { type: "string", "x-ui": { widget: "upload", accept: "image/*" } } } } };
  const calls = mockApi(t, () => success(mask));
  await assert.rejects(generateSpicyImage({ baseUrl: "https://api.spicyapi.ai", secret: "fake-secret", modelId: "mask", timeoutMs: 1000 }, "portrait", { referenceImages: ["spicy://a/ast_face"] }), /不支持人物参考图/);
  assert.equal(calls.length, 1);
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
