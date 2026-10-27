import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { fullStudioFixture } from "./fixtures.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
test("Civitai provider discovers, caches, enables and generates an illustration through native workflows", { skip: !baseUrl, timeout: 45000 }, async t => {
  const calls = [];
  const id = "urn:air:sdxl:checkpoint:civitai:101055@128078";
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";
  const server = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    calls.push({ path: request.url, authorization: request.headers.authorization, body: raw ? JSON.parse(raw) : null });
    if (request.url === "/output.png") { response.writeHead(200, { "Content-Type": "image/png" }); return response.end(Buffer.from(png, "base64")); }
    response.setHeader("Content-Type", "application/json");
    if (request.url.includes("sort=Newest")) {
      const index = Number(new URL(request.url, "http://test").searchParams.get("cursor") || 0);
      return response.end(JSON.stringify({ items: [{ id: index + 1, name: `Catalog Painter ${index}`, type: "Checkpoint", supportsGeneration: true, modelVersions: [{ id: index + 10, name: "new", baseModel: "SDXL 1.0" }, { id: index + 100, name: "old", baseModel: "SDXL 1.0" }] }], metadata: index < 4 ? { nextCursor: String(index + 1) } : {} }));
    }
    if (request.url.startsWith("/api/v1/models?")) return response.end(JSON.stringify({ items: [{ id: 101055, name: "Test Painter", type: "Checkpoint", supportsGeneration: true, modelVersions: [{ id: 128078, name: "v1", baseModel: "SDXL 1.0", supportsGeneration: true }] }], metadata: {} }));
    if (request.url === "/v2/consumer/workflows?wait=0") { response.statusCode = 202; return response.end(JSON.stringify({ id: "wf_integration", status: "processing" })); }
    if (request.url === "/v2/consumer/workflows/wf_integration") return response.end(JSON.stringify({ id: "wf_integration", status: "succeeded", steps: [{ output: { images: [{ url: `http://127.0.0.1:${server.address().port}/output.png` }] } }] }));
    response.statusCode = 404; response.end(JSON.stringify({ error: "wrong adapter endpoint" }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  async function api(path, body, method = body === undefined ? "GET" : "POST", headers = {}) {
    const response = await fetch(baseUrl + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text(); const data = raw ? JSON.parse(raw) : null;
    assert.ok(response.ok, `${path}: ${response.status} ${raw}`); return data;
  }
  const original = await api("/api/state");
  let provider, model, job;
  t.after(async () => {
    try {
      if (job) await api(`/api/ai/illustrations/${job.id}`, undefined, "DELETE");
      if (model) await api(`/api/models/${model.id}`, undefined, "DELETE");
      if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE");
      const state = await api("/api/state");
      await api("/api/state", { data: original.data }, "PUT", { "If-Match": String(state.revision) });
    } finally { server.closeAllConnections(); server.close(); }
  });
  await api("/api/state", { data: fullStudioFixture() }, "PUT", { "If-Match": String(original.revision) });
  provider = await api("/api/providers", { name: "Civitai integration", adapterKind: "civitai", baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, secret: "civitai-integration-secret" });
  const discovered = await api(`/api/providers/${provider.id}/discover`, {});
  assert.equal(discovered.catalog[0].id, id);
  assert.deepEqual(discovered.catalog[0].metadata.outputModalities, ["image"]);
  assert.deepEqual((await api(`/api/providers/${provider.id}/discover`)).catalog, discovered.catalog);
  let cursor = null;
  const completeCatalog = [];
  do {
    const page = await api(`/api/providers/${provider.id}/catalog-pages`, { cursor });
    completeCatalog.push(...page.catalog); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(completeCatalog.length, 10, "all five pages and both versions are available");
  assert.ok(completeCatalog.some(entry => entry.id.endsWith("5@104")));
  assert.deepEqual((await api(`/api/providers/${provider.id}/discover`)).catalog, discovered.catalog, "search pages do not overwrite the saved default catalog");
  const invalid = await fetch(`${baseUrl}/api/providers/${provider.id}/catalog-pages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cursor: 123 }) });
  assert.equal(invalid.status, 400);
  model = (await api("/api/models/bulk", { providerId: provider.id, modelIds: [id], metadataByModelId: { [id]: discovered.catalog[0].metadata } })).models[0];
  assert.equal(model.adapterKind, "civitai");
  const before = (await api("/api/state")).data.articles;
  job = (await api("/api/ai/illustrations", { action: "image", background: true, outlineId: "outline-current", model: model.id, prompt: "A lighthouse at dusk", size: "1216x832" })).record;
  await api(`/api/ai/illustrations/${job.id}/execute`, {});
  for (let attempt = 0; attempt < 100; attempt++) {
    job = (await api(`/api/ai/illustrations/${job.id}`)).record;
    if (["success", "error"].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(job.status, "success", job.error);
  const submissions = calls.filter(call => call.path === "/v2/consumer/workflows?wait=0");
  assert.equal(submissions.length, 1);
  const input = submissions[0].body.steps[0].input;
  assert.equal(input.engine, "sdcpp"); assert.equal(input.ecosystem, "sdxl");
  assert.equal(input.checkpointModel, id); assert.equal(input.quantity, 1);
  assert.equal(input.width, 1216); assert.equal(input.height, 832);
  assert.equal(submissions[0].authorization, "Bearer civitai-integration-secret");
  assert.equal(calls.find(call => call.path === "/output.png").authorization, undefined);
  const image = await fetch(`${baseUrl}${job.src}?download=1`);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, "base64"));
  assert.deepEqual((await api("/api/state")).data.articles, before);
});
