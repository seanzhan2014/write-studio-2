import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";

test("catalog discovery, bulk enable, capability-specific tests and refresh preserve configured models", { skip: !baseUrl, timeout: 60000 }, async (t) => {
  const calls = []; let omitText = false, failImageDirectory = false;
  const text = { id: "writer", name: "Writer", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, context_length: 64000 };
  const image = { id: "painter", name: "Painter", architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] }, supported_parameters: { size: { type: "enum", values: ["1024x1024", "1536x1024"] }, quality: { type: "enum", values: ["high"] } } };
  const server = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ url: request.url, body, authorization: request.headers.authorization });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/models?output_modalities=all") return response.end(JSON.stringify({ data: omitText ? [image] : [text, image] }));
    if (request.url === "/v1/images/models") {
      if (failImageDirectory) { response.statusCode = 503; return response.end("Bearer catalog-test-secret"); }
      return response.end(JSON.stringify({ data: [image] }));
    }
    if (request.url === "/v1/images") return response.end(JSON.stringify({ data: [{ b64_json: png, media_type: "image/png" }] }));
    if (request.url === "/v1/chat/completions") return response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "OK" } }] }));
    response.statusCode = 404; response.end(JSON.stringify({ error: "wrong adapter path" }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  async function api(path, body, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(baseUrl + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text(); return { response, value: raw ? JSON.parse(raw) : null };
  }
  let provider; const created = [];
  t.after(async () => { try { for (const model of created) await api(`/api/models/${model.id}`, undefined, "DELETE"); if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE"); } finally { server.closeAllConnections(); server.close(); } });
  const p = await api("/api/providers", { name: "Catalog integration", adapterKind: "openrouter", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, secret: "catalog-test-secret" });
  assert.equal(p.response.status, 201); provider = p.value;
  const path = `/api/providers/${provider.id}/discover`;
  assert.equal((await api(path)).value, null);
  const discovered = await api(path, {});
  assert.equal(discovered.response.status, 200);
  assert.equal(discovered.value.catalog.length, 2);
  assert.equal(discovered.value.catalog.find((entry) => entry.id === "writer").metadata.contextLength, 64000);
  assert.deepEqual(discovered.value.catalog.find((entry) => entry.id === "painter").metadata.outputModalities, ["image"]);
  assert.deepEqual((await api(path)).value.catalog, discovered.value.catalog);
  assert.ok(!JSON.stringify(discovered.value).includes("catalog-test-secret"));
  const enabled = await api("/api/models/bulk", { providerId: provider.id, modelIds: ["writer", "painter"], metadataByModelId: Object.fromEntries(discovered.value.catalog.map((entry) => [entry.id, entry.metadata])) });
  assert.equal(enabled.response.status, 201); created.push(...enabled.value.models);
  const painter = created.find((model) => model.modelId === "painter"), writer = created.find((model) => model.modelId === "writer");
  assert.equal(painter.metadata.source, "provider");
  const textResult = await api(`/api/models/${writer.id}/test`, { operation: "text" });
  assert.equal(textResult.response.status, 200); assert.equal(calls.at(-1).url, "/v1/chat/completions");
  const count = calls.length;
  assert.equal((await api(`/api/models/${painter.id}/test`, { operation: "text" })).response.status, 502);
  assert.equal(calls.length, count, "image-only model must never receive a chat request");
  const generated = await api(`/api/models/${painter.id}/test`, { operation: "image" });
  assert.equal(generated.response.status, 200); assert.ok(generated.value.preview.src.startsWith("data:image/png;base64,"));
  assert.equal(calls.at(-1).url, "/v1/images"); assert.equal(calls.at(-1).authorization, "Bearer catalog-test-secret");
  const listed = (await api("/api/models")).value.models;
  assert.equal(listed.find((model) => model.id === painter.id).metadata.tests.image.ok, true);
  assert.equal(listed.find((model) => model.id === painter.id).metadata.tests.text.ok, false);
  assert.equal(listed.find((model) => model.id === writer.id).metadata.tests.text.ok, true);
  omitText = true; failImageDirectory = true;
  const refresh = await api(path, {});
  assert.equal(refresh.response.status, 200); assert.equal(refresh.value.warnings.length, 1);
  assert.ok(!JSON.stringify(refresh.value).includes("catalog-test-secret"));
  const after = (await api("/api/models")).value.models;
  assert.equal(after.find((model) => model.id === writer.id).metadata.contextLength, 64000, "refresh does not delete or reconfigure enabled models");
  const duplicate = await api("/api/models/bulk", { providerId: provider.id, modelIds: ["painter"] });
  assert.equal(duplicate.value.models.length, 0);
});
