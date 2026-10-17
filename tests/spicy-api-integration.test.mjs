import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { fullStudioFixture } from "./fixtures.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";

test("SpicyAPI discovers and activates text and image models with their respective generation endpoints", { skip: !baseUrl, timeout: 45000 }, async t => {
  const calls = [];
  const id = "alibaba/wan-2.7-pro/text-to-image";
  const entry = { model: id, displayName: "Wan 2.7 Pro", modality: "image", tasks: ["text-to-image"], enabled: true, available: true, inputSchema: { required: ["prompt"], properties: { prompt: { type: "string", maxLength: 5000 }, aspect_ratio: { type: "string", enum: ["1:1", "16:9"] }, resolution: { type: "string", enum: ["1k", "2k"] } } } };
  const textId = "publisher/writer/chat";
  const textEntry = { model: textId, displayName: "Writer", modality: "text", tasks: ["chat"], enabled: true, available: true, inputSchema: { required: ["messages"], properties: { messages: { type: "array" } } } };
  const server = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    calls.push({ url: request.url, body: raw ? JSON.parse(raw) : undefined, authorization: request.headers.authorization, key: request.headers["idempotency-key"] });
    if (request.url === "/result.png") { response.writeHead(200, { "Content-Type": "image/png" }); return response.end(Buffer.from(png, "base64")); }
    response.setHeader("Content-Type", "application/json");
    let data;
    if (request.url === "/v1/chat/completions") return response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "OK" } }] }));
    if (request.url === "/api/v1/models?includeSchema=1") data = { items: [entry, textEntry] };
    else if (request.url === `/api/v1/models/${id}`) data = entry;
    else if (request.url === "/api/v1/jobs/quote") data = { quoteId: "q-live", estimatedCost: "0.075" };
    else if (request.url === "/api/v1/jobs/createTask") { response.statusCode = 202; data = { taskId: "job-persist", state: "queued" }; }
    else if (request.url === "/api/v1/jobs/recordInfo?taskId=job-persist") data = { taskId: "job-persist", state: "succeeded", output: { assets: [{ url: `http://127.0.0.1:${server.address().port}/result.png`, mime: "image/png" }] } };
    else { response.statusCode = 404; return response.end(JSON.stringify({ code: 404, msg: "wrong adapter path" })); }
    response.end(JSON.stringify({ code: 200, msg: "success", data }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  async function api(path, body, method = body === undefined ? "GET" : "POST", headers = {}) {
    const response = await fetch(baseUrl + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text(); const result = raw ? JSON.parse(raw) : null;
    assert.ok(response.ok, `${path}: ${response.status} ${raw}`);
    return result;
  }
  const original = await api("/api/state");
  let provider, model, textModel, job;
  t.after(async () => {
    try {
      if (job) await api(`/api/ai/illustrations/${job.id}`, undefined, "DELETE");
      if (model) await api(`/api/models/${model.id}`, undefined, "DELETE");
      if (textModel) await api(`/api/models/${textModel.id}`, undefined, "DELETE");
      if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE");
      const current = await api("/api/state");
      await api("/api/state", { data: original.data }, "PUT", { "If-Match": String(current.revision) });
    } finally { server.closeAllConnections(); server.close(); }
  });
  await api("/api/state", { data: fullStudioFixture() }, "PUT", { "If-Match": String(original.revision) });
  const before = (await api("/api/state")).data.articles;
  provider = await api("/api/providers", { name: "SpicyAPI integration", adapterKind: "spicyapi", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "spicy-test-secret" });
  const discovered = await api(`/api/providers/${provider.id}/discover`, {});
  assert.equal(discovered.catalog.length, 2);
  assert.deepEqual(discovered.catalog[0].metadata.outputModalities, ["image"]);
  assert.deepEqual(discovered.catalog[0].metadata.supportedParameters.resolution.values, ["1k", "2k"]);
  assert.deepEqual(discovered.catalog.find(entry => entry.id === textId).metadata.outputModalities, ["text"]);
  assert.deepEqual((await api(`/api/providers/${provider.id}/discover`)).catalog, discovered.catalog, "cached catalog retains both capabilities");
  model = (await api("/api/models/bulk", { providerId: provider.id, modelIds: [id], metadataByModelId: { [id]: discovered.catalog[0].metadata } })).models[0];
  assert.equal(model.adapterKind, "spicyapi");
  textModel = (await api("/api/models/bulk", { providerId: provider.id, modelIds: [textId], metadataByModelId: { [textId]: discovered.catalog.find(entry => entry.id === textId).metadata } })).models[0];
  assert.equal(textModel.adapterKind, "spicyapi");
  const tested = await api(`/api/models/${textModel.id}/test`, { operation: "text" });
  assert.equal(tested.ok, true);
  const chatCall = calls.find(call => call.url === "/v1/chat/completions");
  assert.equal(chatCall.body.model, textId);
  assert.equal(chatCall.authorization, "Bearer spicy-test-secret");
  assert.ok(!calls.some(call => call.url === "/api/v1/chat/completions"));
  job = (await api("/api/ai/illustrations", { action: "image", background: true, outlineId: "outline-current", model: model.id, prompt: "A lighthouse in watercolor", aspectRatio: "16:9", resolution: "2k" })).record;
  await api(`/api/ai/illustrations/${job.id}/execute`, {});
  for (let attempt = 0; attempt < 100; attempt++) {
    job = (await api(`/api/ai/illustrations/${job.id}`)).record;
    if (job.status === "success" || job.status === "error") break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(job.status, "success", job.error);
  const created = calls.filter(call => call.url === "/api/v1/jobs/createTask");
  assert.equal(created.length, 1);
  assert.ok(created[0].key);
  assert.deepEqual(created[0].body, { model: id, input: { prompt: "A lighthouse in watercolor", aspect_ratio: "16:9", resolution: "2k" }, quoteId: "q-live", expectedCost: "0.075" });
  assert.equal(created[0].authorization, "Bearer spicy-test-secret");
  assert.equal(calls.find(call => call.url === "/result.png").authorization, undefined, "signed image download must not receive the API key");
  const image = await fetch(`${baseUrl}${job.src}?download=1`);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, "base64"));
  assert.deepEqual((await api("/api/state")).data.articles, before);
});
