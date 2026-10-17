import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { normalizeCharacterVisual } from "../lib/character-visual.ts";
import { fullStudioFixture } from "./fixtures.mjs";
import { normalizeStudioData, durableSnapshot, diffStudioData } from "./studio-test-runtime.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";
const visual = { providerId: "provider-spicy", providerBaseUrl: "https://api.spicyapi.ai/api/v1", workspaceId: "personal-1", characterId: "entity-1", characterName: "林澈", coverAssetId: "ast_front", syncedAt: "2026-10-17", images: [{ id: "ast_front", uri: "spicy://a/ast_front", name: "正面", assetKey: "illustrations/abcdef01-1234", mime: "image/png" }] };

test("visual bindings survive canonical snapshots and appear in incremental changes without signed URLs", () => {
  const initial = fullStudioFixture();
  const modified = structuredClone(initial);
  modified.articles[0].characters[0].visual = { ...visual, previewUrl: "https://expired.example/signed" };
  const normalized = durableSnapshot(normalizeStudioData(modified));
  assert.deepEqual(normalized.articles[0].characters[0].visual, visual);
  const changes = diffStudioData(durableSnapshot(normalizeStudioData(initial)), normalized);
  assert.equal(changes.characters.upsert.length, 1);
  assert.deepEqual(changes.characters.upsert[0].character.visual, visual);
  assert.equal(JSON.stringify(normalized).includes("expired.example"), false);
  assert.equal(normalizeCharacterVisual({ ...visual, images: [{ ...visual.images[0], assetKey: "../../private" }] }), undefined);
});

test("Spicy role binding, local portraits, reference generation and retries preserve the submitted identity", { skip: !baseUrl, timeout: 60000 }, async t => {
  const calls = [];
  const modelId = "example/identity/edit";
  const entry = { model: modelId, displayName: "Identity Edit", modality: "image", tasks: ["image-to-image"], enabled: true, available: true, inputSchema: { type: "object", required: ["prompt", "image_urls"], additionalProperties: false, properties: { prompt: { type: "string", maxLength: 12000 }, image_urls: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" }, "x-ui": { widget: "multi-upload", accept: "image/*" } } } } };
  let scope = "workspace-original", submitted = 0;
  const server = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    calls.push({ url: request.url, authorization: request.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
    if (request.url?.startsWith("/picture")) { response.writeHead(200, { "Content-Type": "image/png" }); return response.end(Buffer.from(png, "base64")); }
    const image = id => ({ id, uri: `spicy://a/${id}`, name: id, kind: "image", previewUrl: `http://127.0.0.1:${server.address().port}/picture-${id}.png` });
    const remote = { id: "entity-original", kind: "character", name: "原始林澈", cover: image("ast_front"), assets: [image("ast_front"), image("ast_side")] };
    let data;
    if (request.url === "/api/v1/assets/usage") data = { scope: { workspaceId: scope } };
    else if (request.url?.startsWith("/api/v1/assets/entities?")) data = { items: [remote], nextCursor: "page-2" };
    else if (request.url === "/api/v1/assets/entities/entity-original") data = remote;
    else if (request.url?.startsWith("/api/v1/assets/ast_")) data = image(request.url.split("/").at(-1));
    else if (request.url === "/api/v1/models?modality=image&includeSchema=1") data = { items: [entry] };
    else if (request.url === `/api/v1/models/${modelId}`) data = entry;
    else if (request.url === "/api/v1/jobs/quote") data = { quoteId: "quote-ref", estimatedCost: "0.15" };
    else if (request.url === "/api/v1/jobs/createTask") data = ++submitted === 1 ? { taskId: "job-failed-ref", state: "failed", errorCode: "upstream_failed", errorMessage: "try later" } : { taskId: "job-good-ref", state: "succeeded", output: { assets: [{ url: `http://127.0.0.1:${server.address().port}/picture-result.png`, mime: "image/png" }] } };
    else { response.writeHead(404); return response.end(JSON.stringify({ code: 404, msg: "unexpected test endpoint" })); }
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ code: 200, data }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  async function api(path, body, method = body === undefined ? "GET" : "POST", headers = {}) {
    if (path.startsWith("/api/characters/") && method === "PATCH") headers = { ...headers, "If-Match": String((await api("/api/state")).revision) };
    const response = await fetch(baseUrl + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text(); const data = raw ? JSON.parse(raw) : null;
    assert.ok(response.ok, `${path}: ${response.status} ${raw}`); return data;
  }
  const original = await api("/api/state"); let provider, model, job;
  t.after(async () => {
    try {
      if (job) await api(`/api/ai/illustrations/${job.id}`, undefined, "DELETE");
      if (model) await api(`/api/models/${model.id}`, undefined, "DELETE");
      if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE");
      const current = await api("/api/state"); await api("/api/state", { data: original.data }, "PUT", { "If-Match": String(current.revision) });
    } finally { server.closeAllConnections(); server.close(); }
  });
  const fixture = fullStudioFixture(); const personId = fixture.articles[0].characters[0].id;
  fixture.articles[0].chapters[0].outlines.find(outline => outline.id === "outline-current").settings = { story: {}, relationships: {}, characters: { [personId]: { start: { appearance: { value: "短发，深蓝色大衣", scope: "chapter" } }, end: {} } } };
  await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(original.revision) });
  provider = await api("/api/providers", { name: "Spicy visuals", adapterKind: "spicyapi", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "test-spicy-secret" });
  const listing = await api(`/api/ai/spicy-characters?providerId=${provider.id}`);
  assert.equal(listing.items[0].name, "原始林澈"); assert.equal(listing.nextCursor, "page-2");
  const bound = (await api("/api/ai/spicy-characters", { providerId: provider.id, characterId: "entity-original", imageIds: ["ast_side", "ast_front"], coverAssetId: "ast_side" })).visual;
  assert.deepEqual(bound.images.map(image => image.id), ["ast_front", "ast_side"]);
  assert.equal(bound.coverAssetId, "ast_side"); assert.equal(JSON.stringify(bound).includes("previewUrl"), false);
  await api(`/api/characters/${personId}`, { visual: bound }, "PATCH");
  assert.deepEqual((await api("/api/state")).data.articles[0].characters[0].visual, bound);
  const imageResponse = await fetch(`${baseUrl}/api/ai/character-images/${bound.images[0].assetKey.split("/")[1]}`);
  assert.equal(imageResponse.headers.get("content-type"), "image/png"); assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), Buffer.from(png, "base64"));
  const catalog = await api(`/api/providers/${provider.id}/discover`, {});
  model = (await api("/api/models/bulk", { providerId: provider.id, modelIds: [modelId], metadataByModelId: { [modelId]: catalog.catalog[0].metadata } })).models[0];
  const request = { action: "image", background: true, outlineId: "outline-current", model: model.id, prompt: "林澈站在雨夜码头", characterId: personId, characterReference: { name: "forged" } };
  job = (await api("/api/ai/illustrations", request)).record;
  assert.equal(job.characterReference.appearance, "短发，深蓝色大衣"); assert.notEqual(job.characterReference.name, "forged");
  await api(`/api/ai/illustrations/${job.id}/execute`, {});
  async function finished() { for (let i = 0; i < 100; i++) { const record = (await api(`/api/ai/illustrations/${job.id}`)).record; if (["success", "error"].includes(record.status)) return record; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error("job did not finish"); }
  job = await finished(); assert.equal(job.status, "error");
  await api(`/api/characters/${personId}`, { name: "已改名", visual: null, profile: { age: "45", appearance: "长发，白衣", immutableTraits: "" } }, "PATCH");
  await api(`/api/ai/illustrations/${job.id}`, { action: "retry" }, "PATCH");
  await api(`/api/ai/illustrations/${job.id}/execute`, {}); job = await finished(); assert.equal(job.status, "success", job.error);
  const submittedInputs = calls.filter(call => call.url === "/api/v1/jobs/createTask").map(call => call.body.input);
  assert.equal(submittedInputs.length, 2); assert.deepEqual(submittedInputs[0], submittedInputs[1]);
  assert.deepEqual(submittedInputs[1].image_urls, ["spicy://a/ast_front", "spicy://a/ast_side"]);
  assert.match(submittedInputs[1].prompt, /短发，深蓝色大衣/); assert.doesNotMatch(submittedInputs[1].prompt, /已改名|长发，白衣/);
  assert.ok(calls.filter(call => call.url?.startsWith("/picture")).every(call => !call.authorization));
  await api(`/api/characters/${personId}`, { visual: bound }, "PATCH"); scope = "workspace-changed";
  const before = submitted;
  const blocked = await fetch(baseUrl + "/api/ai/illustrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, background: false }) });
  assert.equal(blocked.status, 400); assert.match((await blocked.json()).error, /素材库已改变/); assert.equal(submitted, before);
});
