import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const parameterCode = ts.transpileModule(readFileSync(new URL("../lib/image-model-parameters.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const parameterUrl = `data:text/javascript;base64,${Buffer.from(parameterCode).toString("base64")}`;
const code = ts.transpileModule(readFileSync(new URL("../lib/civitai-api.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replaceAll("./image-model-parameters", parameterUrl);
const { isCivitai, civitaiBaseUrls, discoverCivitaiCatalog, readCivitaiCatalogPage, isCivitaiAirQuery, splitCivitaiAirQueries, lookupCivitaiAirBatch, parseCivitaiAir, findCivitaiModelByAir, civitaiImageInput, generateCivitaiImage } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const id = "urn:air:sdxl:checkpoint:civitai:101055@128078";
const resource = { id: 101055, name: "Painter", type: "Checkpoint", supportsGeneration: true, modelVersions: [{ id: 128078, name: "v1", baseModel: "SDXL 1.0", supportsGeneration: true }] };
const connection = { baseUrl: "https://civitai.com/api/v1", secret: "fake-civitai-key", modelId: id, timeoutMs: 5000 };
const mossId = "urn:air:mossimage:checkpoint:civitai:3018302@3426693+3321739";
const mossVersion = { id: 3426693, modelId: 3018302, name: "sft turbo v1 int8convrot", baseModel: "MOSS Image", air: mossId.split("+")[0], files: [{ id: 3321739, name: "rayMossArtshoot_sftTurboV1.safetensors", type: "Model", primary: true }] };
const mossResource = { id: 3018302, name: "Ray Moss Artshoot", type: "Checkpoint", supportsGeneration: true, modelVersions: [mossVersion] };
function mockFetch(t, handler) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { const call = { url: new URL(url), ...init, body: init?.body ? JSON.parse(init.body) : undefined }; calls.push(call); return handler(call, calls); });
  return calls;
}

test("existing Civitai URLs are detected and use separate native catalog and generation hosts", () => {
  for (const baseUrl of ["https://civitai.com", "https://civitai.com/api/v1/", "https://orchestration.civitai.com"]) {
    assert.equal(isCivitai({ baseUrl }), true);
    assert.deepEqual(civitaiBaseUrls(baseUrl), { catalog: "https://civitai.com/api/v1", generation: "https://orchestration.civitai.com/v2/consumer" });
  }
  assert.equal(isCivitai({ baseUrl: "https://civitai.com.evil.example/v1" }), false);
  assert.equal(isCivitai({ adapterKind: "civitai", baseUrl: "https://proxy.example" }), true);
  assert.deepEqual(civitaiBaseUrls("https://proxy.example/civitai/api/v1"), { catalog: "https://proxy.example/civitai/api/v1", generation: "https://proxy.example/civitai/v2/consumer" });
});

test("AIR input is recognized without treating wildcard AIR patterns as exact lookups", () => {
  assert.deepEqual(parseCivitaiAir(` ${id.toUpperCase()} `), { modelId: "101055", versionId: "128078", ecosystem: "sdxl", type: "checkpoint" });
  assert.deepEqual(parseCivitaiAir("civitai:101055@128078"), { modelId: "101055", versionId: "128078", ecosystem: undefined, type: undefined });
  assert.equal(parseCivitaiAir("air:sdxl:checkpoint:civitai:101055").versionId, null);
  assert.equal(isCivitaiAirQuery(id), true);
  assert.equal(isCivitaiAirQuery("civitai:101055@128078"), true);
  assert.equal(isCivitaiAirQuery("urn:air:sdxl:*@128078"), false);
  assert.equal(isCivitaiAirQuery("Painter"), false);
  for (const invalid of ["urn:air:sdxl:checkpoint:civitai:0@1", "urn:air:sdxl:checkpoint:civitai:1@0", "urn:air:sdxl:checkpoint:evil:1@2", "civitai:1@9007199254740992", "urn:air:broken"]) assert.equal(parseCivitaiAir(invalid), null);
});

test("exact AIR lookup fetches the requested version directly even if the model catalog omits it", async t => {
  const calls = mockFetch(t, call => call.url.pathname.includes("model-versions") ? Response.json({ ...resource.modelVersions[0], modelId: resource.id, air: id }) : Response.json({ ...resource, modelVersions: [{ id: 999999, name: "new", baseModel: "SDXL 1.0" }] }));
  const result = await findCivitaiModelByAir(connection.baseUrl, connection.secret, id.toUpperCase());
  assert.deepEqual(calls.map(call => call.url.pathname), ["/api/v1/model-versions/128078", "/api/v1/models/101055"]);
  assert.equal(result.catalog.length, 1); assert.equal(result.catalog[0].id, id);
  assert.equal(result.nextCursor, null);
  assert.ok(calls.every(call => call.headers.Authorization === `Bearer ${connection.secret}` && !call.url.search));
});

test("file-pinned AIR parsing preserves the file ID and rejects malformed or unsafe IDs", () => {
  assert.deepEqual(parseCivitaiAir(mossId.toUpperCase()), { modelId: "3018302", versionId: "3426693", ecosystem: "mossimage", type: "checkpoint", fileId: "3321739" });
  assert.equal(parseCivitaiAir("civitai:3018302@3426693+3321739").fileId, "3321739");
  for (const invalid of [mossId + "+4", mossId.replace("+3321739", "+0"), mossId.replace("+3321739", "+9007199254740992"), "urn:air:mossimage:checkpoint:civitai:3018302+3321739"]) assert.equal(parseCivitaiAir(invalid), null);
});

test("MOSS AIR lookup validates the version's actual model file and preserves it when enabling", async t => {
  const calls = mockFetch(t, call => Response.json(call.url.pathname.includes("model-versions") ? mossVersion : mossResource));
  const page = await findCivitaiModelByAir(connection.baseUrl, connection.secret, mossId);
  assert.equal(page.catalog[0].id, mossId);
  assert.equal(page.catalog[0].name, "Ray Moss Artshoot · sft turbo v1 int8convrot");
  assert.deepEqual(page.catalog[0].metadata.inputModalities, ["text"]);
  assert.deepEqual(page.catalog[0].metadata.outputModalities, ["image"]);
  assert.equal(page.catalog[0].metadata.supportedParameters.size.values[0], "1024x1024");
  assert.ok(page.catalog[0].searchTerms.includes("3321739"));
  assert.deepEqual(calls.map(call => call.url.pathname), ["/api/v1/model-versions/3426693", "/api/v1/models/3018302"]);
  await assert.rejects(findCivitaiModelByAir(connection.baseUrl, "", mossId.replace("+3321739", "+999")), /文件 ID/);
  t.mock.restoreAll();
  mockFetch(t, () => Response.json({ ...mossVersion, files: [{ id: 3321739, type: "VAE" }] }));
  await assert.rejects(findCivitaiModelByAir(connection.baseUrl, "", mossId), /权重文件/);
});

test("MOSS models appear in keyword results and default discovery without video models", async t => {
  mockFetch(t, () => Response.json({ items: [mossResource, { ...mossResource, id: 2, modelVersions: [{ id: 3, baseModel: "Wan Video 2.2 I2V-A14B" }] }], metadata: {} }));
  const page = await readCivitaiCatalogPage(connection.baseUrl, "", null, undefined, "Ray Moss");
  assert.equal(page.catalog.length, 1); assert.equal(page.catalog[0].id, mossId.split("+")[0]);
  assert.equal((await discoverCivitaiCatalog(connection.baseUrl, "")).catalog[0].id, mossId.split("+")[0]);
});

test("MOSS generation uses the Comfy SFT workflow, exact file, turbo settings and negative prompt", () => {
  const input = civitaiImageInput(mossId, "A lighthouse at dusk", { size: "1216x832", negativePrompt: "watermark, blurry" });
  assert.deepEqual(input, { engine: "comfy", ecosystem: "mossImage", model: "sft", operation: "createImage", diffusionModel: mossId, prompt: "A lighthouse at dusk", negativePrompt: "watermark, blurry", width: 1216, height: 832, quantity: 1, steps: 12, cfgScale: 1, sampler: "heunpp2", scheduler: "simple" });
  assert.equal("checkpointModel" in input, false);
  assert.equal(civitaiImageInput(mossId.toUpperCase(), "test").diffusionModel, mossId);
  assert.equal(civitaiImageInput(mossId.replace("3426693", "123"), "test").steps, 25);
  assert.throws(() => civitaiImageInput(mossId, "test", { referenceImages: ["https://example.com/reference.png"] }), /不支持人物参考图/);
});

test("configured image parameters override adapter defaults and explicit runtime values take precedence", () => {
  const input = civitaiImageInput(mossId, "A tree", { parameters: { steps: 18, cfgScale: 2, seed: 0, sampler: "euler", scheduler: "karras", width: 1216, height: 832 } });
  assert.equal(input.steps, 18); assert.equal(input.cfgScale, 2); assert.equal(input.seed, 0);
  assert.equal(input.sampler, "euler"); assert.equal(input.scheduler, "karras");
  assert.equal(input.width, 1216); assert.equal(input.height, 832); assert.equal(input.diffusionModel, mossId);
  assert.equal(civitaiImageInput(mossId, "A tree", { size: "1024x1024", parameters: { width: 1216 } }).width, 1024);
  assert.equal(civitaiImageInput(mossId, "A tree", { parameters: { engine: "future_engine", custom: { value: true }, width: 1025 } }).engine, "future_engine");
  assert.equal(civitaiImageInput(mossId, "A tree", { parameters: { width: 1025 } }).width, 1025);
  const sd = civitaiImageInput(id, "A tree", { parameters: { sampleMethod: "heun", schedule: "karras", steps: 28, cfgScale: 6, seed: 42, clipSkip: 2 } });
  assert.equal(sd.sampleMethod, "heun"); assert.equal(sd.schedule, "karras"); assert.equal(sd.seed, 42);
});

test("Civitai routes workflow and query parameters without restricting future image fields", async t => {
  const calls = mockFetch(t, () => Response.json({ id: "wf_custom", status: "succeeded", steps: [{ output: { images: [{ url: "https://images.example/tree.png" }] } }] }));
  await generateCivitaiImage(connection, "A tree", { parameters: { allowMatureContent: true, currencies: ["yellow"], "workflow.futureFlag": false, "query.futureQuery": 0, "query.hideMatureContent": true, customInput: { values: [0, false] } } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get("futureQuery"), "0");
  assert.equal(calls[0].url.searchParams.get("hideMatureContent"), "true");
  assert.equal(calls[0].body.allowMatureContent, true);
  assert.equal(calls[0].body.futureFlag, false);
  assert.deepEqual(calls[0].body.currencies, ["yellow"]);
  assert.deepEqual(calls[0].body.steps[0].input.customInput, { values: [0, false] });
  assert.equal("allowMatureContent" in calls[0].body.steps[0].input, false);
  assert.throws(() => civitaiImageInput(id, "A tree", { parameters: { allowMatureContent: false, "workflow.allowMatureContent": true } }), /重复/);
});

test("explicit image and workflow scopes submit same-name fields independently", async t => {
  const calls = mockFetch(t, () => Response.json({ id: "wf_scoped", status: "succeeded", steps: [{ output: { images: [{ url: "https://images.example/tree.png" }] } }] }));
  await generateCivitaiImage(connection, "A tree", { parameters: { "input.steps": 18, "input.custom": { value: 0 }, "input.futureFlag": false, "workflow.futureFlag": true, "workflow.allowMatureContent": false } });
  assert.equal(calls[0].body.futureFlag, true);
  assert.equal(calls[0].body.allowMatureContent, false);
  assert.equal(calls[0].body.steps[0].input.futureFlag, false);
  assert.equal(calls[0].body.steps[0].input.steps, 18);
  assert.deepEqual(calls[0].body.steps[0].input.custom, { value: 0 });
  assert.equal("input.steps" in calls[0].body.steps[0].input, false);
});

test("MOSS generation uses the version alias only after verifying the requested primary file", async t => {
  for (const primary of [true, false]) {
    t.mock.restoreAll();
    const calls = mockFetch(t, call => Response.json(call.url.pathname.includes("model-versions") ? { ...mossVersion, files: [{ ...mossVersion.files[0], primary }] } : { id: "wf_moss", status: "succeeded", steps: [{ output: { images: [{ url: "https://images.example/moss.png" }] } }] }));
    const result = await generateCivitaiImage({ ...connection, modelId: mossId }, "A tree");
    assert.equal(result.data[0].url, "https://images.example/moss.png");
    assert.equal(calls[0].url.pathname, "/api/v1/model-versions/3426693");
    assert.equal(calls[1].body.steps[0].input.diffusionModel, primary ? mossId.split("+")[0] : mossId);
    assert.equal(calls.filter(call => call.method === "POST").length, 1);
  }
  t.mock.restoreAll();
  const calls = mockFetch(t, () => Response.json({ ...mossVersion, files: [] }));
  await assert.rejects(generateCivitaiImage({ ...connection, modelId: mossId }, "A tree"), /校验失败.*未提交/);
  assert.equal(calls.filter(call => call.method === "POST").length, 0);
});

test("AIR batches split mixed separators and deduplicate identifiers case-insensitively", () => {
  assert.deepEqual(splitCivitaiAirQueries(` ,; ${id},${id.toUpperCase()};civitai:2@3，civitai:4@5；civitai:6@7\tcivitai:8@9\ncivitai:10@11 `), [id, "civitai:2@3", "civitai:4@5", "civitai:6@7", "civitai:8@9", "civitai:10@11"]);
  assert.equal(isCivitaiAirQuery(`bad; ${id}`), true);
  assert.equal(isCivitaiAirQuery("Painter XL"), false);
  assert.equal(isCivitaiAirQuery("urn:air:sdxl:*"), false);
});

test("AIR batches bound concurrency, preserve successful results and merge canonical IDs in input order", async () => {
  const calls = [], progress = [];
  let active = 0, peak = 0;
  const result = await lookupCivitaiAirBatch("civitai:1@2,civitai:2@3;CIVITAI:1@2 civitai:3@4 civitai:4@5 civitai:5@6", async air => {
    calls.push(air); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, air === "civitai:1@2" ? 15 : 2));
    active--;
    if (air === "civitai:2@3") throw new Error("未找到模型");
    const entry = { id: air === "civitai:3@4" ? "civitai:1@2" : air };
    return { catalog: [entry] };
  }, new AbortController().signal, batch => progress.push(batch));
  assert.equal(peak, 3); assert.equal(calls.length, 5);
  assert.deepEqual(result.catalog.map(entry => entry.id), ["civitai:1@2", "civitai:4@5", "civitai:5@6"]);
  assert.deepEqual(result.failures, [{ air: "civitai:2@3", message: "未找到模型" }]);
  assert.equal(result.total, 5); assert.equal(result.processed, 5);
  assert.deepEqual(progress.map(batch => batch.processed), [0, 1, 2, 3, 4, 5]);
  assert.equal(progress[0].catalog.length, 0);
});

test("canceling an AIR batch prevents queued lookups and stale progress", async () => {
  const controller = new AbortController();
  const calls = [], progress = [];
  await assert.rejects(lookupCivitaiAirBatch("civitai:1@2 civitai:2@3 civitai:3@4 civitai:4@5", async air => {
    calls.push(air); controller.abort(); return { catalog: [] };
  }, controller.signal, batch => progress.push(batch)), { name: "AbortError" });
  assert.ok(calls.length <= 3); assert.ok(!calls.includes("civitai:4@5"));
  assert.deepEqual(progress.map(batch => batch.processed), [0]);
  await assert.rejects(lookupCivitaiAirBatch(id, () => { throw Error("must not call"); }, controller.signal), { name: "AbortError" });
});

test("abbreviated AIRs resolve to canonical IDs and model AIRs return the model's versions", async t => {
  const calls = mockFetch(t, call => call.url.pathname.includes("model-versions") ? Response.json({ ...resource.modelVersions[0], modelId: resource.id, air: id }) : Response.json({ ...resource, modelVersions: [...resource.modelVersions, { id: 128079, name: "old", baseModel: "SDXL 1.0" }] }));
  assert.equal((await findCivitaiModelByAir(connection.baseUrl, "", "civitai:101055@128078")).catalog[0].id, id);
  calls.length = 0;
  const result = await findCivitaiModelByAir(connection.baseUrl, "", "air:sdxl:checkpoint:civitai:101055");
  assert.equal(result.catalog.length, 2); assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/v1/models/101055");
});

test("AIR lookups reject mismatched models, unsupported resources and inaccessible versions without scanning", async t => {
  let calls = mockFetch(t, () => Response.json({ ...resource.modelVersions[0], modelId: 999 }));
  await assert.rejects(findCivitaiModelByAir(connection.baseUrl, "", id), /不对应/);
  assert.equal(calls.length, 1);
  t.mock.restoreAll(); calls = mockFetch(t, () => Response.json({}));
  await assert.rejects(findCivitaiModelByAir(connection.baseUrl, "", id.replace("checkpoint", "lora")), /不是当前支持/);
  await assert.rejects(findCivitaiModelByAir(connection.baseUrl, "", "urn:air:invalid"), /格式无效/);
  assert.equal(calls.length, 0);
  t.mock.restoreAll(); calls = mockFetch(t, () => new Response("not found", { status: 404 }));
  await assert.rejects(findCivitaiModelByAir(connection.baseUrl, "", id), /未找到此 AIR/);
  assert.equal(calls.length, 1);
  t.mock.restoreAll();
  mockFetch(t, call => call.url.pathname.includes("model-versions") ? Response.json({ ...resource.modelVersions[0], modelId: resource.id, air: id.replace("101055@", "999@") }) : Response.json(resource));
  await assert.rejects(findCivitaiModelByAir(connection.baseUrl, "", "civitai:101055@128078"), /当前不可用/);
});

test("complete catalog pages expose every callable version with numeric and name search terms", async t => {
  const older = { id: 128079, name: "v0.9", baseModel: "SDXL 1.0", supportsGeneration: true };
  const calls = mockFetch(t, () => Response.json({ items: [{ ...resource, modelVersions: [...resource.modelVersions, older, { ...older, id: 3, supportsGeneration: false }] }], metadata: { nextCursor: "next|cursor" } }));
  const page = await readCivitaiCatalogPage(connection.baseUrl, connection.secret);
  assert.equal(page.catalog.length, 2);
  assert.deepEqual(page.catalog[1].searchTerms, ["Painter", "v0.9", "101055", "128079"]);
  assert.equal(page.nextCursor, "next|cursor");
  assert.equal(page.scanned, 1);
  assert.equal(calls[0].url.searchParams.get("sort"), "Newest");
  assert.equal(calls[0].url.searchParams.has("query"), false, "full-text search would omit valid substring/glob matches");
  assert.equal(calls[0].headers.Authorization, `Bearer ${connection.secret}`);
});

test("catalog paging continues beyond three pages, including empty compatible pages and opaque cursors", async t => {
  const calls = mockFetch(t, call => {
    const index = Number(call.url.searchParams.get("cursor") || 0);
    return Response.json({ items: index === 2 ? [{ ...resource, type: "LORA" }] : [{ ...resource, id: index + 1 }], metadata: index < 6 ? { nextCursor: String(index + 1) } : {} });
  });
  let cursor, count = 0;
  do {
    const page = await readCivitaiCatalogPage(connection.baseUrl, connection.secret, cursor);
    cursor = page.nextCursor; count += page.catalog.length;
  } while (cursor);
  assert.equal(calls.length, 7); assert.equal(count, 6);
});

test("official keyword searches retain the query on every cursor page and numeric IDs use the IDs filter", async t => {
  const calls = mockFetch(t, () => Response.json({ items: [resource], metadata: { nextCursor: "next" } }));
  await readCivitaiCatalogPage(connection.baseUrl, connection.secret, null, undefined, "Painter");
  await readCivitaiCatalogPage(connection.baseUrl, connection.secret, "next-page", undefined, "Painter");
  await readCivitaiCatalogPage(connection.baseUrl, connection.secret, null, undefined, "101055");
  await readCivitaiCatalogPage(connection.baseUrl, connection.secret);
  assert.equal(calls[0].url.searchParams.get("query"), "Painter");
  assert.equal(calls[1].url.searchParams.get("query"), "Painter");
  assert.equal(calls[1].url.searchParams.get("cursor"), "next-page");
  assert.equal(calls[2].url.searchParams.get("ids"), "101055");
  assert.equal(calls[2].url.searchParams.has("query"), false);
  assert.equal(calls[3].url.searchParams.has("query"), false);
  assert.ok(calls.every(call => !call.url.searchParams.has("page")));
});

test("full catalog paging refuses broken pagination instead of declaring a complete search", async t => {
  for (const metadata of [{ nextCursor: "same" }, { nextPage: "https://evil.example/api/v1/models?cursor=x" }, { nextPage: "https://civitai.com/api/v1/models?page=2" }]) {
    t.mock.restoreAll(); const calls = mockFetch(t, () => Response.json({ items: [resource], metadata }));
    await assert.rejects(readCivitaiCatalogPage(connection.baseUrl, connection.secret, "same"), /游标|分页/);
    assert.equal(calls.length, 1);
  }
  t.mock.restoreAll(); const calls = mockFetch(t, () => Response.json({ items: [] }));
  await assert.rejects(readCivitaiCatalogPage(connection.baseUrl, connection.secret, 123), /游标无效/);
  assert.equal(calls.length, 0);
  const page = await readCivitaiCatalogPage(connection.baseUrl, connection.secret);
  assert.deepEqual(page.catalog, []); assert.equal(page.nextCursor, null);
});

test("bounded native pages select callable checkpoints, not model resources or LoRAs", async t => {
  const calls = mockFetch(t, call => Response.json({ items: [resource, { ...resource, type: "LORA", id: 2 }, { ...resource, supportsGeneration: false, id: 3 }, { ...resource, mode: "Archived", id: 4 }, { ...resource, id: 5, modelVersions: [{ id: 6, baseModel: "Flux.1 D" }] }], metadata: { nextCursor: String(Number(call.url.searchParams.get("cursor") || 0) + 1) } }));
  const result = await discoverCivitaiCatalog(connection.baseUrl, connection.secret);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.url.searchParams.get("cursor")), [null, "1", "2"]);
  assert.ok(calls.every(call => call.url.pathname === "/api/v1/models" && call.url.searchParams.get("limit") === "10" && call.url.searchParams.get("types") === "Checkpoint" && call.url.searchParams.get("supportsGeneration") === "true" && call.headers.Authorization === `Bearer ${connection.secret}`));
  assert.equal(result.catalog.length, 1);
  assert.equal(result.catalog[0].id, id);
  assert.equal(result.catalog[0].name, "Painter · v1");
  assert.deepEqual(result.catalog[0].metadata.outputModalities, ["image"]);
  assert.deepEqual(result.catalog[0].metadata.inputModalities, ["text"]);
  assert.equal(result.catalog[0].metadata.supportedParameters.size.values[0], "1024x1024");
  assert.ok(result.warnings.some(warning => warning.includes("部分热门模型")));
  assert.ok(!JSON.stringify(result).includes(connection.secret));
});

test("catalog uses canonical AIRs and recognizes SD1 and SDXL-family versions", async t => {
  mockFetch(t, () => Response.json({ items: ["SD 1.5", "Pony", "Illustrious", "NoobAI"].map((baseModel, index) => ({ ...resource, id: index + 1, modelVersions: [{ id: index + 2, baseModel }] })), metadata: {} }));
  const result = await discoverCivitaiCatalog(connection.baseUrl, "");
  assert.equal(result.catalog.length, 4);
  assert.equal(result.catalog.find(entry => entry.id.includes(":sd1:"))?.metadata.supportedParameters.size.values[0], "512x512");
});

test("pagination rejects foreign hosts without sending them the key and stops repeated cursors", async t => {
  const calls = mockFetch(t, () => Response.json({ items: [resource], metadata: { nextPage: "https://evil.example/api/v1/models?cursor=secret" } }));
  await assert.rejects(discoverCivitaiCatalog(connection.baseUrl, connection.secret), /分页地址/);
  assert.equal(calls.length, 1);
  t.mock.restoreAll();
  const repeats = mockFetch(t, () => Response.json({ items: [resource], metadata: { nextCursor: "same" } }));
  await discoverCivitaiCatalog(connection.baseUrl, connection.secret);
  assert.equal(repeats.length, 2);
});

test("later page failures preserve successful entries with redacted warnings", async t => {
  mockFetch(t, (_call, calls) => calls.length === 1 ? Response.json({ items: [resource], metadata: { nextCursor: "next" } }) : new Response(`Bearer ${connection.secret}`, { status: 503 }));
  const result = await discoverCivitaiCatalog(connection.baseUrl, connection.secret);
  assert.equal(result.catalog.length, 1);
  assert.ok(result.warnings.some(warning => warning.includes("后续目录未完成")));
  assert.ok(!JSON.stringify(result).includes(connection.secret));
});

test("oversized streaming pages are canceled before buffering the entire response", async t => {
  let canceled = false;
  mockFetch(t, () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1_000_001)); }, cancel() { canceled = true; } })));
  await assert.rejects(discoverCivitaiCatalog(connection.baseUrl, ""), /单页响应过大/);
  assert.equal(canceled, true);
});

test("empty and malformed native catalogs have actionable errors", async t => {
  for (const [payload, message] of [[{ data: [resource] }, /格式无效/], [{ items: [] }, /Checkpoint/]]) {
    t.mock.restoreAll(); mockFetch(t, () => Response.json(payload));
    await assert.rejects(discoverCivitaiCatalog(connection.baseUrl, ""), message);
  }
});

test("native image input validates the AIR, prompt, dimensions and unsupported controls before submitting", () => {
  assert.deepEqual(civitaiImageInput(id, "A landscape", { size: "1216x832" }), { engine: "sdcpp", ecosystem: "sdxl", operation: "createImage", checkpointModel: id, prompt: "A landscape", width: 1216, height: 832, quantity: 1 });
  assert.equal(civitaiImageInput("urn:air:sd1:checkpoint:civitai:4384@128713", "A tree").width, 512);
  for (const invalid of ["101055", id.replace("checkpoint", "lora"), id.replace("sdxl", "flux1")]) assert.throws(() => civitaiImageInput(invalid, "test"), /AIR ID/);
  assert.throws(() => civitaiImageInput(id, "x".repeat(10_001)), /提示词/);
  assert.throws(() => civitaiImageInput(id, "test", { size: "1025x1024" }), /倍数/);
  assert.throws(() => civitaiImageInput(id, "test", { size: "4096x4096" }), /倍数/);
  assert.throws(() => civitaiImageInput(id, "test", { referenceImages: ["https://example.com/image.png"] }), /参考图/);
  assert.throws(() => civitaiImageInput(id, "test", { resolution: "4k" }), /模型默认/);
});

test("native generation submits once and polls for imageGen output without OpenAI endpoints", async t => {
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => { const timer = setInterval(() => { clearInterval(timer); callback(...args); }, delay === 2000 ? 1 : delay); return timer; });
  const calls = mockFetch(t, (call, calls) => calls.length === 1 ? Response.json({ id: "wf_test", status: "processing" }, { status: 202 }) : Response.json({ id: "wf_test", status: "succeeded", steps: [{ output: { images: [{ url: "https://images.example/output.png" }] } }] }));
  const result = await generateCivitaiImage(connection, "A lighthouse", { parameters: { "query.hideMatureContent": true } });
  assert.deepEqual(result, { data: [{ url: "https://images.example/output.png" }] });
  assert.equal(calls[0].url.href, "https://orchestration.civitai.com/v2/consumer/workflows?wait=0&hideMatureContent=true");
  assert.equal(calls[1].url.pathname, "/v2/consumer/workflows/wf_test");
  assert.equal(calls[1].url.searchParams.get("hideMatureContent"), "true");
  assert.equal(calls[0].body.steps[0].input.checkpointModel, id);
  assert.equal(calls[0].body.steps[0].input.quantity, 1);
  assert.equal(calls[0].body.steps[0].$type, "imageGen");
  assert.ok(calls[0].body.externalId);
  assert.ok(calls.every(call => call.headers.Authorization === `Bearer ${connection.secret}`));
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
});

test("unavailable Civitai outputs report the provider reason even when a download URL is present", async t => {
  const calls = mockFetch(t, () => Response.json({ id: "wf_unavailable", status: "succeeded", steps: [{ output: { images: [{ available: false, blockedReason: "Potentially ToS violating content detected", url: "https://images.example/unavailable.png" }] } }] }));
  await assert.rejects(generateCivitaiImage(connection, "A tree"), error => {
    assert.match(error.message, /Civitai 图片不可用：Potentially ToS violating content detected/);
    assert.match(error.message, /wf_unavailable/);
    return true;
  });
  assert.equal(calls.length, 1, "an unavailable output must not trigger download or a second generation");
  for (const output of [{ blobs: [{ available: false, url: "https://images.example/unavailable.png" }] }, { images: [{ blockedReason: `blocked ${connection.secret}`, url: "https://images.example/unavailable.png" }] }]) {
    t.mock.restoreAll();
    mockFetch(t, () => Response.json({ id: "wf_unavailable", status: "succeeded", steps: [{ output }] }));
    await assert.rejects(generateCivitaiImage(connection, "A tree"), error => { assert.match(error.message, /Civitai 图片不可用/); assert.ok(!error.message.includes(connection.secret)); return true; });
  }
  t.mock.restoreAll();
  mockFetch(t, () => Response.json({ id: "wf_mixed", status: "succeeded", steps: [{ output: { images: [{ available: false, url: "https://images.example/unavailable.png" }, { available: true, url: "https://images.example/available.png" }] } }] }));
  assert.equal((await generateCivitaiImage(connection, "A tree")).data[0].url, "https://images.example/available.png");
});

test("failed, missing, malformed and timed-out workflows never retry submission or leak credentials", async t => {
  for (const [payload, message] of [[{ id: "wf_failed", status: "failed", steps: [{ reason: `invalid ${connection.secret}` }] }, /wf_failed/], [{ status: "succeeded" }, /任务 ID/], [{ id: "wf_no_image", status: "succeeded", steps: [] }, /没有返回可用图片/], [{ id: "wf_invalid", status: "unknown" }, /未知任务状态/]]) {
    t.mock.restoreAll(); const calls = mockFetch(t, () => Response.json(payload));
    await assert.rejects(generateCivitaiImage(connection, "A tree"), error => { assert.match(error.message, message); assert.ok(!error.message.includes(connection.secret)); return true; });
    assert.equal(calls.length, 1);
  }
  t.mock.restoreAll();
  const calls = mockFetch(t, () => Response.json({ id: "wf_timeout", status: "preparing" }));
  await assert.rejects(generateCivitaiImage({ ...connection, timeoutMs: 5 }, "A tree"), /超时.*wf_timeout/);
  assert.equal(calls.length, 1);
});

test("an already canceled request sends no generation call", async t => {
  const calls = mockFetch(t, () => { throw new Error("must not fetch"); });
  await assert.rejects(generateCivitaiImage(connection, "A tree", {}, AbortSignal.abort()), /停止等待/);
  assert.equal(calls.length, 0);
});
