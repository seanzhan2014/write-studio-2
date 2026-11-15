import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { fullStudioFixture } from "./fixtures.mjs";
import { PREPARATION_SECTIONS } from "../lib/writing-preparation.ts";
import { scenePlanFixture } from "./scene-plan-fixture.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
async function request(path, method = "GET", data) {
  const response = await fetch(baseUrl + path, { method, headers: { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { response, body: await response.json() };
}
async function api(path, method, data) { const { response, body } = await request(path, method, data); assert.ok(response.ok, JSON.stringify(body)); return body; }

test("calibration recovers transient generation errors, enforces coverage and stops retries when paused", async () => {
  const configuration = { style: "克制的口语叙述", generate: { advanced: {}, proseControls: {} }, advancedStyle: {}, scenes: [] };
  const calls = []; let generationFailure = "provider", evaluation = 0, improve = false, httpError = 0;
  const model = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), system = body.messages[0].content; calls.push(body);
    if (httpError) { res.writeHead(httpError); res.end("provider temporarily unavailable"); return; }
    let result;
    if (system.includes("风格学习助手") || system.includes("审查并修正候选") || system.includes("针对固定模型校准")) result = configuration;
    else if (system.includes("大纲整理助手")) result = { scenes: [{ title: "归还", plan: "两人核对书籍后互相道别。", targetWords: 100 }] };
    else if (system.includes("写作准备稿质量检查任务")) result = { issues: [] };
    else if (system.includes("写作前准备任务")) result = { brief: Object.fromEntries(PREPARATION_SECTIONS.map(([key]) => [key, "依据固定大纲核对书籍后道别。"])), plan: scenePlanFixture(), questions: [] };
    else if (system.includes("风格对照评估助手")) { evaluation++; result = { scores: Array(5).fill(improve && evaluation === 2 ? 12 : 18), contentScore: improve && evaluation === 2 ? 90 : 40, evidence: "按固定大纲核对事件覆盖。", suggestions: "保留因果与人物行动。" }; }
    else if (generationFailure) {
      const finishReason = generationFailure === "length" ? "length" : "error"; generationFailure = "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "failed-generation", provider: "mock-provider", choices: [{ finish_reason: finishReason, error: { code: 502, metadata: { error_type: "provider_unavailable" } }, message: { content: "" } }], usage: { prompt_tokens: 7, completion_tokens: 3 } })); return;
    } else result = "两人核对好书籍，互相道别。";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: typeof result === "string" ? result : JSON.stringify(result) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  }).listen(0, "127.0.0.1"); await once(model, "listening");
  try {
    const provider = await api("/api/providers", "POST", { name: "recovery", baseUrl: `http://127.0.0.1:${model.address().port}/v1`, secret: "fake-key" });
    const selectedModel = await api("/api/models", "POST", { providerId: provider.id, name: "recovery", modelId: "recovery", maxInputCharacters: 120000 });
    const state = await api("/api/state"), data = fullStudioFixture(); data.tasks = []; data.settings.generateReviewMaxRounds = 0;
    data.articles[0].storySettings = { styleLibrary: { references: [{ id: "source", title: "参考", text: "两人核对书籍后互相道别。" }] } };
    const saved = await fetch(baseUrl + "/api/state", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": String(state.revision) }, body: JSON.stringify({ data }) }); assert.ok(saved.ok);
    const create = async (kind = "tune") => (await api("/api/style-lab", "POST", { articleId: "article-main", kind, model: selectedModel.id, maxRounds: 1 })).job;
    const step = async job => (await api(`/api/style-lab/${job.id}/step`, "POST", {})).job;
    const finish = async job => { for (let i = 0; i < 30 && job.status !== "completed"; i++) { job = await step(job); assert.notEqual(job.status, "failed", job.error); } assert.equal(job.status, "completed"); return (await api(`/api/style-lab/${job.id}`)).job; };

    let job = await finish(await create());
    const retries = job.payload.history.filter(event => event.status === "retrying");
    assert.equal(retries.length, 1); assert.equal(retries[0].phase, "generate");
    assert.equal(retries[0].diagnostics.requestId, "failed-generation"); assert.equal(retries[0].diagnostics.provider, "mock-provider");
    assert.equal(job.rounds[0].drafts.length, 1); assert.equal(job.rounds[1].drafts.length, 1);
    assert.equal(job.payload.inputTokens, 107); assert.equal(job.payload.outputTokens, 203, "both plan audits and failed attempt usage are retained");
    assert.equal(job.payload.bestScore, -1); assert.equal(job.payload.autoApplyPending, false); assert.ok(!job.payload.applied);
    assert.match(job.payload.notice, /内容覆盖达到70分/);
    const refused = await request(`/api/style-lab/${job.id}`, "POST", { action: "apply" }); assert.equal(refused.response.status, 422);
    assert.match(refused.body.error, /内容覆盖达到70分/);
    const evaluationCall = calls.find(call => call.messages[0].content.includes("风格对照评估助手"));
    assert.match(evaluationCall.messages[0].content, /不得因省略露骨细节而扣/);
    assert.deepEqual(JSON.parse(evaluationCall.messages[1].content).outline[0].plan, "两人核对书籍后互相道别。");
    assert.match(calls.find(call => call.messages[0].content.includes("针对固定模型校准")).messages[0].content, /内容覆盖只依据本次固定大纲/);

    improve = true; evaluation = 0; job = await finish(await create());
    assert.equal(job.rounds[0].score, 90); assert.equal(job.rounds[0].contentScore, 40);
    assert.equal(job.payload.bestRound, 1); assert.equal(job.payload.bestScore, 60); assert.equal(job.payload.applied, true);

    job = await create(); while (job.phase !== "generate") job = await step(job);
    generationFailure = "length"; const lengthCalls = calls.length; job = await step(job);
    assert.equal(job.status, "failed"); assert.equal(job.phase, "generate"); assert.match(job.error, /输出长度上限/);
    assert.equal(calls.length - lengthCalls, 1); assert.equal(job.payload.history.filter(event => event.status === "retrying").length, 0);
    assert.equal((await api(`/api/style-lab/${job.id}`)).job.rounds[0].drafts.length, 0);
    await api(`/api/style-lab/${job.id}`, "POST", { action: "stop" });

    httpError = 401; job = await create("learn"); const before = calls.length; job = await step(job);
    assert.equal(job.status, "failed"); assert.equal(calls.length - before, 1); assert.equal(job.payload.history.filter(event => event.status === "retrying").length, 0);

    httpError = 503; job = await create("learn"); const pausedId = job.id, callCount = calls.length;
    const pending = step(job);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { const current = (await api(`/api/style-lab/${pausedId}`)).job; if (current.payload.history.some(event => event.status === "retrying")) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    await api(`/api/style-lab/${pausedId}`, "POST", { action: "pause" });
    assert.equal((await pending).status, "paused"); assert.equal(calls.length - callCount, 1, "pause prevents the next upstream attempt");
    await api(`/api/style-lab/${pausedId}`, "POST", { action: "stop" });
  } finally { model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); }
});
