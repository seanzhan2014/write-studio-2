import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fullStudioFixture } from "./fixtures.mjs";

test("built production service dispatches illustration jobs without a browser or execute request", { skip: !existsSync(new URL("../dist/server/index.js", import.meta.url)), timeout: 45000 }, async t => {
  const workspace = process.cwd();
  const database = path.join(workspace, ".test-data", `illustration-prod-${process.pid}.sqlite`);
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port;
  probe.close(); await once(probe, "close");
  const base = `http://127.0.0.1:${port}`;
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";
  const calls = [];
  const upstream = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    calls.push({ url: request.url, body: JSON.parse(raw) });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: [{ b64_json: png }] }));
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const child = spawn(process.execPath, ["scripts/prod-server.mjs"], {
    cwd: workspace,
    env: { ...process.env, WRITER_STUDIO_HOST: "127.0.0.1", WRITER_STUDIO_PORT: String(port), WRITER_STUDIO_DB_PATH: database, WRITER_STUDIO_TEST_MODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", chunk => output.push(chunk.toString()));
  child.stderr.on("data", chunk => output.push(chunk.toString()));
  let job;
  t.after(async () => {
    if (job) {
      if (["queued", "running"].includes(job.status)) await fetch(`${base}/api/ai/illustrations/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) }).catch(() => {});
      await fetch(`${base}/api/ai/illustrations/${job.id}`, { method: "DELETE" }).catch(() => {});
    }
    if (child.exitCode === null) {
      const exited = once(child, "exit"); child.kill();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    upstream.closeAllConnections(); upstream.close();
    for (const file of [database, database + "-wal", database + "-shm"]) await rm(file, { force: true });
  });
  async function api(url, body, method = body === undefined ? "GET" : "POST", headers = {}) {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    assert.ok(response.ok, `${url}: ${response.status} ${JSON.stringify(result)}`);
    return result;
  }
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) assert.fail(output.join(""));
    try { if ((await fetch(base + "/api/database/status")).ok) { ready = true; break; } } catch { /* Starting production. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, output.join(""));
  const state = await api("/api/state");
  await api("/api/state", { data: fullStudioFixture() }, "PUT", { "If-Match": String(state.revision) });
  const provider = await api("/api/providers", { name: "Production regression mock", baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, secret: "fake-production-test-secret" });
  const model = await api("/api/models", { providerId: provider.id, name: "Mock image", modelId: "mock-image", metadata: { source: "manual", inputModalities: ["text"], outputModalities: ["image"] } });
  job = (await api("/api/ai/illustrations", { action: "image", background: true, outlineId: "outline-current", model: model.id, prompt: "A blue circle" })).record;
  for (let attempt = 0; attempt < 60; attempt++) {
    job = (await api(`/api/ai/illustrations/${job.id}`)).record;
    if (job.status === "success" || job.status === "error") break;
    if (output.some(line => line.includes("Illustration dispatcher failed"))) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.equal(job.status, "success", job.error || output.join("").slice(-5000));
  assert.equal(calls.length, 1, "the production dispatcher must submit exactly once");
  assert.equal(calls[0].url, "/v1/images/generations");
  const image = await fetch(base + job.src);
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(png, "base64"));
  assert.ok(!output.some(line => line.includes("Illustration dispatcher failed")));
});
