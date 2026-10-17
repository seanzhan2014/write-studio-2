import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { matchingPhotoEdit, selectPhotoModel, photoModelOptions } from "../lib/photo-model-resolution.ts";
import { EMPTY_PHOTO_DRAFT } from "../lib/character-photos.ts";
import { fullStudioFixture } from "./fixtures.mjs";

const metadata = refs => ({ source: "provider", inputModalities: refs ? ["text", "image"] : ["text"], outputModalities: ["image"], supportedParameters: refs ? { image_urls: { referenceImage: true, maxImages: 3, required: true }, resolution: { values: ["2k"] } } : { size: { values: ["1024x1024"] } } });
test("photo models match a verified edit sibling and retain native image-input models", () => {
  const root = { modelId: "lab/person/text-to-image", name: "Portrait", metadata: metadata(false) };
  const entry = { id: "lab/person/edit", name: "Portrait Edit", metadata: metadata(true) };
  assert.equal(selectPhotoModel(root, [entry], false).model.modelId, root.modelId);
  assert.equal(selectPhotoModel(root, [entry], true).model.modelId, entry.id);
  assert.equal(selectPhotoModel(root, [entry], true).automaticEdit, true);
  assert.equal(selectPhotoModel(root, [], true).automaticEdit, false);
  assert.equal(matchingPhotoEdit(root.modelId, [{ ...entry, id: "other/person/edit" }]), undefined);
  assert.equal(matchingPhotoEdit(root.modelId, [{ ...entry, metadata: metadata(false) }]), undefined);
  assert.equal(selectPhotoModel({ ...root, metadata: metadata(true) }, [entry], true).model.modelId, root.modelId);
  assert.equal(selectPhotoModel(root, [{ id: root.modelId, name: "Updated", metadata: metadata(true) }], true).model.metadata.inputModalities.includes("image"), true);
  const options = { ...EMPTY_PHOTO_DRAFT, size: "1024x1024", resolution: "2k", quality: "high", prompt: "keep identity", referenceIds: ["face"] };
  assert.deepEqual(photoModelOptions(options, { ...root, metadata: metadata(true) }, true), { ...options, size: "", quality: "" });
  assert.deepEqual(photoModelOptions(options, root, false), options);
});

const base = process.env.WRITER_STUDIO_TEST_BASE_URL;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";
test("configured generation model automatically uses unconfigured edit model and freezes it for retry", { skip: !base, timeout: 45000 }, async t => {
  const rootId = "lab/portrait/text-to-image", editId = "lab/portrait/edit";
  const calls = [];
  let offerEdit = true;
  const entry = (id, refs) => ({ model: id, displayName: refs ? "Portrait Editing" : "Portrait Generation", modality: "image", tasks: [refs ? "image-to-image" : "text-to-image"], enabled: true, available: true, inputSchema: { type: "object", additionalProperties: false, required: refs ? ["prompt", "image_urls"] : ["prompt"], properties: { prompt: { type: "string", maxLength: 12000 }, ...(refs ? { image_urls: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } } } : { size: { type: "string", enum: ["1024x1024"] } }) } } });
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const body = req.headers["content-type"]?.includes("application/json") && raw.length ? JSON.parse(raw.toString()) : undefined;
    calls.push({ path: req.url, body });
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.url === "/image") { res.setHeader("Content-Type", "image/png"); return res.end(Buffer.from(png, "base64")); }
    if (req.url === "/upload") { assert.equal(req.headers.authorization, undefined); return res.end(); }
    let data;
    if (req.url === "/api/v1/models?includeSchema=1") data = { items: [entry(rootId, false), ...(offerEdit ? [entry(editId, true)] : [])] };
    else if (req.url === `/api/v1/models/${rootId}`) data = entry(rootId, false);
    else if (req.url === `/api/v1/models/${editId}`) data = entry(editId, true);
    else if (req.url === "/api/v1/common/upload-url") data = { fileId: "fil_photo", uploadUrl: origin + "/upload", headers: { "Content-Type": "image/png" } };
    else if (req.url === "/api/v1/files/fil_photo/commit") data = { status: "ready", uri: "spicy://f/fil_photo" };
    else if (req.url === "/api/v1/jobs/quote") data = { quoteId: "quote", estimatedCost: "0.1" };
    else if (req.url === "/api/v1/jobs/createTask") data = { taskId: "remote-" + calls.length, state: "succeeded", output: { assets: [{ url: origin + "/image", mime: "image/png" }] } };
    else { res.statusCode = 404; return res.end(JSON.stringify({ code: 404, msg: "unknown mock path" })); }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ code: 200, data }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  async function api(path, body, method = body === undefined ? "GET" : "POST", headers = {}) {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); const data = text ? JSON.parse(text) : null;
    assert.ok(response.ok, `${path}: ${text}`); return data;
  }
  const before = await api("/api/state"); let provider, model;
  t.after(async () => { try { if (model) await api(`/api/models/${model.id}`, undefined, "DELETE"); if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE"); const current = await api("/api/state"); await api("/api/state", { data: before.data }, "PUT", { "If-Match": String(current.revision) }); } finally { server.closeAllConnections(); server.close(); } });
  const fixture = fullStudioFixture(); const characterId = fixture.articles[0].characters[0].id;
  await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(before.revision) });
  provider = await api("/api/providers", { name: "Image service", adapterKind: "spicyapi", baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`, secret: "mock-photo-secret" });
  model = (await api("/api/models/bulk", { providerId: provider.id, modelIds: [rootId], metadataByModelId: { [rootId]: metadata(false) } })).models[0];
  const photo = (action, rest = {}) => api("/api/ai/character-photos", { action, characterId, ...rest });
  const choice = await api(`/api/ai/character-photos?modelId=${model.id}&references=0`);
  assert.equal(choice.model.modelId, rootId); assert.equal(choice.editVersion.modelId, editId);
  assert.equal((await api("/api/models")).models.filter(m => m.providerId === provider.id).length, 1);
  const uploaded = await photo("upload", { dataUrl: `data:image/png;base64,${png}`, name: "face" });
  const withRefs = await api(`/api/ai/character-photos?modelId=${model.id}&references=1`);
  assert.equal(withRefs.model.modelId, editId); assert.equal(withRefs.automaticEdit, true);
  assert.equal(withRefs.model.metadata.supportedParameters.image_urls.maxImages, 3);
  const draft = { ...EMPTY_PHOTO_DRAFT, modelId: model.id, prompt: "keep face, change clothes", referenceIds: uploaded.gallery.referenceIds, size: "1024x1024" };
  const job = (await photo("generate", { requestId: crypto.randomUUID(), draft })).jobs[0];
  assert.equal(job.snapshot.model.modelId, editId); assert.equal(job.snapshot.model.requestedModelId, rootId); assert.equal(job.snapshot.draft.modelId, model.id); assert.equal(job.snapshot.draft.size, "");
  await api("/api/ai/character-photos", { action: "execute", jobId: job.id });
  let saved = (await api(`/api/ai/character-photos?characterId=${characterId}`)).jobs.find(j => j.id === job.id);
  assert.equal(saved.state, "success", saved.error);
  assert.equal(calls.filter(c => c.path === "/api/v1/jobs/createTask").at(-1).body.model, editId);
  assert.deepEqual(calls.filter(c => c.path === "/api/v1/jobs/quote").at(-1).body.input.image_urls, ["spicy://f/fil_photo"]);
  offerEdit = false;
  const retry = (await photo("generate", { requestId: crypto.randomUUID(), retryId: job.id })).jobs[0];
  assert.equal(retry.snapshot.model.modelId, editId);
  await api("/api/ai/character-photos", { action: "execute", jobId: retry.id });
  saved = (await api(`/api/ai/character-photos?characterId=${characterId}`)).jobs.find(j => j.id === retry.id);
  assert.equal(saved.state, "success", saved.error);
  const plain = (await photo("generate", { requestId: crypto.randomUUID(), draft: { ...draft, referenceIds: [] } })).jobs[0];
  assert.equal(plain.snapshot.model.modelId, rootId);
  await api("/api/ai/character-photos", { action: "execute", jobId: plain.id });
  assert.equal(calls.filter(c => c.path === "/api/v1/jobs/createTask").at(-1).body.model, rootId);
  // A fresh connection has no edit entry: no quote or charged create is made.
  const changed = await api(`/api/providers/${provider.id}`, { name: "Image service refreshed" }, "PATCH");
  assert.ok(changed);
  const creates = calls.filter(c => c.path === "/api/v1/jobs/createTask").length;
  const blocked = await fetch(base + "/api/ai/character-photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", characterId, requestId: crypto.randomUUID(), draft }) });
  assert.equal(blocked.status, 400); assert.match((await blocked.json()).error, /没有可用/);
  assert.equal(calls.filter(c => c.path === "/api/v1/jobs/createTask").length, creates);
});
