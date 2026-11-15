import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { characterPhotos, normalizeCharacterPhotos, normalizePhotoDraft, photoStyle, photoSyncStatus } from "../lib/character-photos.ts";
import { fullStudioFixture } from "./fixtures.mjs";
import { normalizeStudioData, durableSnapshot, diffStudioData } from "./studio-test-runtime.mjs";
const base = process.env.WRITER_STUDIO_TEST_BASE_URL;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";
const image = { id: "local-1", assetKey: "illustrations/abcdef01-1234", mime: "image/png", name: "参考", createdAt: "2026-10-17", source: "upload", status: "reference" };
test("gallery snapshots keep candidates separate, retain versions and resolve image style precedence", () => {
  const g = characterPhotos();
  g.photos = Array.from({ length: 12 }, (_, i) => ({ ...image, id: `p-${i}`, status: i < 10 ? "approved" : "candidate" }));
  g.coverId = "p-0"; g.referenceIds = ["p-0", "p-1"]; g.draft.prompt = "笑一点";
  assert.equal(normalizeCharacterPhotos(g).photos.length, 12);
  assert.deepEqual(photoStyle(g.draft, g, "ink"), { stylePreset: "ink", styleSource: "跟随文章" });
  g.stylePreset = "anime";
  assert.equal(photoStyle(g.draft, g, "ink").stylePreset, "anime");
  g.draft.style = "cinematic";
  assert.equal(photoStyle(g.draft, g, "ink").stylePreset, "cinematic");
  const before = fullStudioFixture(), after = structuredClone(before);
  after.articles[0].characters[0].photos = g;
  const normalized = durableSnapshot(normalizeStudioData(after));
  assert.deepEqual(normalized.articles[0].characters[0].photos, normalizeCharacterPhotos(g));
  assert.equal(diffStudioData(before, normalized).characters.upsert[0].character.photos.photos.length, 12);
  assert.equal(normalizeCharacterPhotos({ photos: [{ ...image, assetKey: "../../secret" }] }).photos.length, 0);
  assert.equal(normalizePhotoDraft({ count: 500 }).count, 1);
});

test("other image adapters accept local identity references and prose uses the adopted photo snapshot", { skip: !base, timeout: 45000 }, async t => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, type: req.headers["content-type"], body: Buffer.concat(chunks).toString() });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: png, media_type: "image/png" }] }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  async function api(path, body, method = body === undefined ? "GET" : "POST", headers = {}) {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text(); const data = raw ? JSON.parse(raw) : null;
    assert.ok(response.ok, `${path}: ${raw}`); return data;
  }
  const before = await api("/api/state"), created = [], models = [];
  t.after(async () => { try { for (const m of models) await api(`/api/models/${m.id}`, undefined, "DELETE"); for (const p of created) await api(`/api/providers/${p.id}`, undefined, "DELETE"); const current = await api("/api/state"); await api("/api/state", { data: before.data }, "PUT", { "If-Match": String(current.revision) }); } finally { server.closeAllConnections(); server.close(); } });
  const fixture = fullStudioFixture(); const id = fixture.articles[0].characters[0].id;
  await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(before.revision) });
  const photo = (action, rest = {}) => api("/api/ai/character-photos", { action, characterId: id, ...rest });
  const uploaded = await photo("upload", { dataUrl: `data:image/png;base64,${png}`, name: "身份参考" });
  for (const adapter of ["openrouter", "openai-compatible"]) {
    const provider = await api("/api/providers", { name: adapter, adapterKind: adapter, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "mock-images" }); created.push(provider);
    const metadata = { source: "provider", inputModalities: ["text", "image"], outputModalities: ["image"], supportedParameters: { images: { referenceImage: true, maxImages: 4 } } };
    const model = (await api("/api/models/bulk", { providerId: provider.id, modelIds: ["portrait"], metadataByModelId: { portrait: metadata } })).models[0]; models.push(model);
    const job = (await photo("generate", { requestId: crypto.randomUUID(), draft: { ...characterPhotos().draft, modelId: model.id, prompt: "侧面，保持人物一致", referenceIds: uploaded.gallery.referenceIds } })).jobs[0];
    await api("/api/ai/character-photos", { action: "execute", jobId: job.id });
    const done = (await api(`/api/ai/character-photos?characterId=${id}`)).jobs.find(j => j.id === job.id);
    assert.equal(done.state, "success", done.error);
    const call = calls.at(-1);
    if (adapter === "openrouter") {
      assert.equal(call.path, "/v1/images");
      const body = JSON.parse(call.body); assert.equal(body.input_references[0].image_url.url, `data:image/png;base64,${png}`); assert.equal(body.input_references[0].type, "image_url");
    } else { assert.equal(call.path, "/v1/images/edits"); assert.match(call.type, /multipart\/form-data/); assert.match(call.body, /name="image"/); assert.match(call.body, /侧面，保持人物一致/); }
    await photo("cover", { photoId: done.photoId });
    const prose = await api("/api/ai/illustrations", { action: "image", outlineId: "outline-current", model: model.id, prompt: "人物在雨夜码头", characterId: id });
    assert.ok(prose.src);
    const history = await api("/api/ai/illustrations?outlineId=outline-current");
    const record = history.records.find(r => r.model === model.id && r.prompt === "人物在雨夜码头");
    assert.equal(record.status, "success");
    assert.ok(record.characterReference.photos.length);
    assert.ok(!record.characterReference.visual);
  }
});

test("portraits upload, iterate, recover native tasks, adopt and reconcile full remote galleries", { skip: !base, timeout: 90000 }, async t => {
  const calls = []; let imageCount = 9, scope = "workspace-1", createCount = 0, loseResponse = false, remoteMember = false, loseAssetResponse = false;
  const modelId = "test/portrait";
  const entry = { model: modelId, displayName: "Portrait", modality: "image", tasks: ["text-to-image", "image-to-image", "edit"], enabled: true, available: true, inputSchema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string", maxLength: 12000 }, image_urls: { type: "array", maxItems: 4, items: { type: "string" } } }, additionalProperties: false } };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const body = req.headers["content-type"]?.includes("application/json") ? JSON.parse(raw.toString() || "{}") : undefined;
    calls.push({ path: req.url, method: req.method, body, auth: req.headers.authorization, idempotency: req.headers["idempotency-key"] });
    const url = `http://127.0.0.1:${server.address().port}`;
    const asset = i => ({ id: `ast_${i}`, uri: `spicy://a/ast_${i}`, name: `照片 ${i}`, kind: "image", previewUrl: `${url}/picture.png?asset=${i}` });
    if (req.url.startsWith("/picture.png")) { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(Buffer.concat([Buffer.from(png, "base64"), Buffer.from(req.url.includes("asset=") ? req.url : "")])); }
    if (req.url === "/signed-upload") { assert.equal(req.headers.authorization, undefined); assert.deepEqual(raw, Buffer.from(png, "base64")); res.writeHead(200); return res.end(); }
    let data;
    if (req.url === "/api/v1/assets/usage") data = { scope: { workspaceId: scope } };
    else if (req.url === "/api/v1/assets/entities/role-1") { const assets = Array.from({ length: imageCount }, (_, i) => asset(i)); if (remoteMember) assets.push({ ...asset("saved"), id: "ast_saved", uri: "spicy://a/ast_saved" }); data = { id: "role-1", kind: "character", name: "定妆角色", assets, cover: assets[0] }; }
    else if (req.url.startsWith("/api/v1/assets/ast_")) data = asset(req.url.split("ast_")[1]);
    else if (req.url === "/api/v1/common/upload-url") data = { fileId: "fil_local", uploadUrl: `${url}/signed-upload`, headers: { "Content-Type": "image/png", "Content-Length": String(Buffer.from(png, "base64").length) }, maxBytes: 10485760, method: "PUT" };
    else if (req.url === "/api/v1/files/fil_local/commit") data = { status: "ready", uri: "spicy://f/fil_local" };
    else if (req.url === "/api/v1/assets") { if (loseAssetResponse) { loseAssetResponse = false; res.destroy(); return; } assert.ok(req.headers["idempotency-key"]); data = { id: "ast_saved", uri: "spicy://a/ast_saved", name: "定稿", kind: "image" }; }
    else if (req.url === "/api/v1/models?includeSchema=1") data = { items: [entry] };
    else if (req.url === `/api/v1/models/${modelId}`) data = entry;
    else if (req.url === "/api/v1/jobs/quote") data = { quoteId: "quote-1", estimatedCost: "0.1" };
    else if (req.url === "/api/v1/jobs/createTask") {
      createCount++; if (loseResponse) { loseResponse = false; res.destroy(); return; }
      data = { taskId: `job-${req.headers["idempotency-key"]}`, state: "queued" };
    } else if (req.url.startsWith("/api/v1/jobs/recordInfo")) data = { taskId: new URL(req.url, url).searchParams.get("taskId"), state: "succeeded", output: { assets: [{ url: `${url}/picture.png`, mime: "image/png" }] } };
    else { res.writeHead(404); return res.end(JSON.stringify({ code: 404, msg: "unknown mock route" })); }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ code: 200, data }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  async function api(path, body, method = body === undefined ? "GET" : "POST", headers = {}) {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text(); const data = raw ? JSON.parse(raw) : null; assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`); return data;
  }
  const original = await api("/api/state"); let provider, model;
  const fixture = fullStudioFixture(); const personId = fixture.articles[0].characters[0].id;
  fixture.settings.illustrationSettings = { stylePreset: "ink", promptLanguage: "zh", resolution: "" };
  t.after(async () => { try { if (model) await api(`/api/models/${model.id}`, undefined, "DELETE"); if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE"); const current = await api("/api/state"); await api("/api/state", { data: original.data }, "PUT", { "If-Match": String(current.revision) }); } finally { server.closeAllConnections(); server.close(); } });
  await api("/api/state", { data: fixture }, "PUT", { "If-Match": String(original.revision) });
  const photo = (action, rest = {}) => api("/api/ai/character-photos", { action, characterId: personId, ...rest });
  const overview = () => api(`/api/ai/character-photos?characterId=${personId}`);
  const upload = await photo("upload", { dataUrl: `data:image/png;base64,${png}`, name: "正面.png" });
  assert.equal(upload.gallery.photos.length, 1); assert.equal(upload.gallery.coverId, "");
  await photo("upload", { dataUrl: `data:image/png;base64,${png}`, name: "重复.png" });
  assert.equal((await overview()).gallery.photos.length, 1);
  provider = await api("/api/providers", { name: "图像服务", adapterKind: "spicyapi", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "photo-secret" });
  const catalog = await api(`/api/providers/${provider.id}/discover`, {});
  model = (await api("/api/models/bulk", { providerId: provider.id, modelIds: [modelId], metadataByModelId: { [modelId]: catalog.catalog[0].metadata } })).models[0];
  const draft = { ...characterPhotos().draft, modelId: model.id, prompt: "微笑，浅色衣服", referenceIds: upload.gallery.referenceIds, experimentId: "group-1" };
  await photo("draft", { draft });
  assert.deepEqual((await overview()).gallery.draft, draft);
  const requestId = crypto.randomUUID();
  const first = (await photo("generate", { requestId, draft })).jobs[0];
  assert.equal((await photo("generate", { requestId, draft })).jobs[0].id, first.id);
  async function finished(id, desired = ["success", "error", "interrupted"]) {
    for (let i = 0; i < 120; i++) { await api("/api/ai/character-photos", { action: "execute", jobId: id }); const job = (await overview()).jobs.find(j => j.id === id); if (desired.includes(job.state)) return job; await new Promise(r => setTimeout(r, 100)); } throw new Error("portrait did not finish");
  }
  const done = await finished(first.id); assert.equal(done.state, "success", done.error);
  assert.match(done.snapshot.prompt, /国风水墨/); assert.equal(done.snapshot.references.length, 1);
  assert.equal(createCount, 1); assert.equal((await overview()).gallery.coverId, "");
  assert.equal((await overview()).gallery.photos.find(p => p.id === done.photoId).status, "candidate");
  const saved = await photo("cover", { photoId: done.photoId }); assert.equal(saved.gallery.coverId, done.photoId);
  const second = (await photo("generate", { requestId: crypto.randomUUID(), draft: { ...draft, basePhotoId: done.photoId, prompt: "改成侧面" } })).jobs[0];
  const v2 = await finished(second.id); assert.equal(v2.state, "success", v2.error);
  let g = (await overview()).gallery;
  assert.equal(g.photos.find(p => p.id === v2.photoId).parentId, done.photoId); assert.equal(g.coverId, done.photoId);
  await photo("cover", { photoId: v2.photoId }); g = (await overview()).gallery;
  assert.equal(g.photos.find(p => p.id === done.photoId).status, "approved");
  loseResponse = true;
  const uncertain = (await photo("generate", { requestId: crypto.randomUUID(), draft })).jobs[0];
  assert.equal((await finished(uncertain.id)).state, "interrupted");
  const lostCreate = calls.filter(c => c.path === "/api/v1/jobs/createTask").at(-1);
  await photo("job", { jobId: uncertain.id, operation: "resume" });
  const recovered = await finished(uncertain.id); assert.equal(recovered.state, "success", recovered.error);
  const replay = calls.filter(c => c.path === "/api/v1/jobs/createTask").at(-1);
  assert.equal(replay.idempotency, lostCreate.idempotency); assert.deepEqual(replay.body, lostCreate.body);
  const refInput = calls.find(c => c.path === "/api/v1/jobs/quote").body.input;
  assert.deepEqual(refInput.image_urls, ["spicy://f/fil_local"]);
  g = (await photo("refresh", { providerId: provider.id, remoteCharacterId: "role-1" })).gallery;
  assert.equal(g.binding.order.length, 9); assert.equal(g.photos.filter(p => p.remote?.member).length, 9);
  const draftBeforeRefresh = g.draft;
  imageCount = 10; g = (await photo("refresh")).gallery;
  assert.equal(g.binding.order.length, 10); assert.deepEqual(g.draft, draftBeforeRefresh);
  loseAssetResponse = true;
  const lostSave = await fetch(base + "/api/ai/character-photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", characterId: personId }) });
  assert.equal(lostSave.status, 400);
  const firstSave = calls.filter(c => c.path === "/api/v1/assets").at(-1);
  await photo("sync"); g = (await overview()).gallery;
  const replaySave = calls.filter(c => c.path === "/api/v1/assets").find((c, i, all) => i > all.indexOf(firstSave) && c.idempotency === firstSave.idempotency);
  assert.ok(replaySave); assert.deepEqual(replaySave.body, firstSave.body);
  assert.ok(g.photos.some(p => p.status === "approved" && p.remote && !p.remote.member));
  assert.ok(photoSyncStatus(g).pending > 0);
  remoteMember = true; g = (await photo("refresh")).gallery;
  assert.equal(g.photos.find(p => p.id === v2.photoId).remote.member, true);
  scope = "wrong-workspace";
  const mismatch = await fetch(base + "/api/ai/character-photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh", characterId: personId }) });
  assert.equal(mismatch.status, 400); assert.match((await mismatch.json()).error, /工作区已改变/);
});

