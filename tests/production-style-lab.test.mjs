import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fullStudioFixture } from "./fixtures.mjs";
import { PREPARATION_SECTIONS } from "../lib/writing-preparation.ts";
import { scenePlanFixture } from "./scene-plan-fixture.mjs";

// Run explicitly after building; normal integration tests use the dev server.
test("production bundle dispatches learning, format-corrected calibration and prepared writing without browser steps", { skip: process.env.WRITER_STUDIO_PRODUCTION_SMOKE !== "1", timeout: 90000 }, async () => {
  const workspace = process.cwd();
  const database = path.join(workspace, ".test-data", `production-style-${process.pid}.sqlite`);
  const probe = net.createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const configuration = { style: "简洁克制的口语叙述", advancedStyle: {}, generate: { advanced: {}, proseControls: {} }, scenes: [], notes: "" };
  let preparations = 0, generationInterrupted = false;
  const model = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw), system = body.messages[0].content;
    let result;
    if (system.includes("风格学习助手") || system.includes("审查并修正候选")) result = configuration;
    else if (system.includes("大纲整理助手")) result = { scenes: [{ title: "归还", plan: "两位成年人核对归还的书籍，互相道别。", targetWords: 100 }] };
    else if (system.includes("写作准备稿质量检查任务")) result = { issues: [] };
    else if (system.includes("写作前准备任务")) {
      preparations++;
      result = { brief: Object.fromEntries(PREPARATION_SECTIONS.map(([key]) => [key, "核对后道别，只使用既定事实。"])), plan: scenePlanFixture(), questions: [] };
      if (preparations === 1) result.brief.purpose = { text: "需要纠正的字段类型" };
    } else {
      if (!generationInterrupted) {
        generationInterrupted = true;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ id: "production-retry", provider: "mock-provider", choices: [{ finish_reason: "error", error: { code: 502, metadata: { error_type: "provider_unavailable" } }, message: { content: "" } }] })); return;
      }
      result = "两人核对好书籍，互相道别。脚步声渐渐远去。";
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: typeof result === "string" ? result : JSON.stringify(result) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  }).listen(0, "127.0.0.1");
  await once(model, "listening");
  let output = "";
  const startService = () => {
    const child = spawn(process.execPath, ["scripts/prod-server.mjs"], { cwd: workspace, windowsHide: true, env: {
    ...process.env, WRITER_STUDIO_DB_PATH: database, WRITER_STUDIO_HOST: "127.0.0.1", WRITER_STUDIO_PORT: String(port), WRITER_STUDIO_TEST_MODE: "0",
    }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    return child;
  };
  let service = startService();
  const api = async (url, method = "GET", data, headers = {}) => {
    const response = await fetch(origin + url, { method, headers: { "Content-Type": "application/json", ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    const body = await response.json(); assert.ok(response.ok, `${url}: ${response.status} ${JSON.stringify(body)}`); return body;
  };
  const until = async (check, message) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      assert.equal(service.exitCode, null, output.slice(-4000));
      const result = await check(); if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.fail(`${message}\n${output.slice(-4000)}`);
  };
  try {
    await until(async () => { try { return (await fetch(origin + "/api/database/status")).ok; } catch { return false; } }, "Production service did not start");
    const provider = await api("/api/providers", "POST", { name: "production-smoke", baseUrl: `http://127.0.0.1:${model.address().port}/v1`, secret: "fake-key" });
    const selectedModel = await api("/api/models", "POST", { providerId: provider.id, name: "production-smoke", modelId: "production-smoke", maxInputCharacters: 120000 });
    const current = await api("/api/state"), data = fullStudioFixture(); data.tasks = []; data.settings.generateReviewMaxRounds = 0;
    data.articles[0].storySettings = { styleLibrary: { references: [{ id: "source", title: "参考", text: "两位成年人核对书籍后道别。" }] } };
    await api("/api/state", "PUT", { data }, { "If-Match": String(current.revision) });
    let job = (await api("/api/style-lab", "POST", { articleId: "article-main", kind: "learn", model: selectedModel.id })).job;
    await until(async () => { const next = (await api(`/api/style-lab/${job.id}`)).job; assert.notEqual(next.status, "failed", next.error); return next.status === "completed" && next.payload.applied; }, "Learning did not run in the background");
    // A recovered lease after a process restart continues from the saved phase.
    const learnedId = job.id;
    await api(`/api/style-lab/${learnedId}`, "POST", { action: "restore" });
    job = (await api("/api/style-lab", "POST", { articleId: "article-main", kind: "learn", model: selectedModel.id, autoApply: false })).job;
    await api(`/api/style-lab/${job.id}`, "POST", { action: "pause" });
    service.kill(); if (service.exitCode === null) await once(service, "exit");
    const native = new DatabaseSync(database);
    const checkpoint = native.prepare("SELECT payload_json FROM style_lab_jobs WHERE id=?").get(job.id);
    const payload = JSON.parse(checkpoint.payload_json); payload.candidate = configuration; payload.referenceIndex = 1; payload.analyses = [configuration];
    native.prepare("UPDATE style_lab_jobs SET status='running',phase='validate',payload_json=?,owner='interrupted-service',lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").run(JSON.stringify(payload), job.id);
    native.close();
    service = startService();
    await until(async () => { try { return (await fetch(origin + "/api/database/status")).ok; } catch { return false; } }, "Production service did not restart");
    const recovered = await until(async () => { const next = (await api(`/api/style-lab/${job.id}`)).job; assert.notEqual(next.status, "failed", next.error); return next.status === "completed" ? next : false; }, "Learning did not resume after restart");
    assert.equal(recovered.payload.analyses.length, 1); assert.ok(!recovered.payload.applied);
    assert.equal((await api(`/api/style-lab/${learnedId}`)).job.payload.applications.length, 1, "application history survives process restart");
    job = (await api("/api/style-lab", "POST", { articleId: "article-main", kind: "tune", model: selectedModel.id, maxRounds: 1 })).job;
    const tuned = await until(async () => { const next = (await api(`/api/style-lab/${job.id}`)).job; assert.notEqual(next.status, "failed", next.error); return next.rounds?.[0]?.drafts?.[0]?.text ? next : false; }, "Calibration did not prepare and generate in the background");
    assert.match(tuned.rounds[0].drafts[0].brief, /核对后道别/);
    assert.equal(preparations, 2, "invalid preparation is corrected once in the production bundle");
    assert.ok(tuned.payload.history.some(event => event.status === "retrying" && event.diagnostics?.requestId === "production-retry"), "production bundle retries the interrupted generation and retains diagnostics");
    await api(`/api/style-lab/${job.id}`, "POST", { action: "stop" });
    const created = (await api("/api/ai/tasks", "POST", { articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "content", model: selectedModel.id, preparationRounds: 0, reviewMaxRounds: 0 }, { "Idempotency-Key": crypto.randomUUID() })).data;
    await until(async () => { const task = (await api("/api/ai/tasks")).tasks.find(item => item.id === created.id); assert.notEqual(task?.state, "failed", task?.error); return task?.state === "success"; }, "Prepared writing did not run in the background");
    assert.doesNotMatch(output, /dispatcher failed|is not a function/);
  } finally {
    service.kill();
    if (service.exitCode === null) await once(service, "exit");
    model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
    for (const suffix of ["", "-wal", "-shm"]) await rm(database + suffix, { force: true });
  }
});
