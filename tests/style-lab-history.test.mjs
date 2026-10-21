import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { styleLabSchema } from "../db/style-lab-schema.ts";
import { readStyleLabSnapshot, validateStyleLabSnapshot, importStyleLabStatements } from "../db/style-lab-history.ts";
import { normalizeConfiguration } from "../lib/style-learning.ts";
import { fullStudioFixture } from "./fixtures.mjs";
const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
async function api(path, method = "GET", data, headers = {}) {
  const response = await fetch(baseUrl + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  const body = await response.json(); assert.ok(response.ok, JSON.stringify(body)); return body;
}

test("history pagination, archive, atomic apply/restore and full replacements keep original evidence", { skip: !baseUrl }, async () => {
  const state = await api("/api/state"), data = fullStudioFixture(); data.tasks = [];
  data.articles[0].style = "作者的原始风格";
  await api("/api/state", "PUT", { data }, { "If-Match": String(state.revision) });
  const native = new DatabaseSync(process.env.WRITER_STUDIO_TEST_DB_PATH);
  const base = normalizeConfiguration({ style: data.articles[0].style }), best = normalizeConfiguration({ style: "学习得到的风格" });
  const references = [{ id: "ref", title: "原始参考", text: "需要在备份中保留的原文" }];
  const payload = { references, base, best, candidate: best, outlines: [], analyses: [best], inputTokens: 11, outputTokens: 12, round: 0, bestRound: 0, bestScore: -1, locked: [], applications: [], autoApply: false };
  try {
    native.exec("PRAGMA foreign_keys=ON; DELETE FROM style_lab_jobs");
    for (let i = 0; i < 25; i++) native.prepare("INSERT INTO style_lab_jobs(id,article_id,kind,status,phase,model_id,payload_json,created_at,updated_at) VALUES(?,?,'learn','completed','completed','missing-model',?,?,?)").run(`history-${String(i).padStart(2, "0")}`, "article-main", JSON.stringify(payload), `2026-10-20T00:00:${String(i).padStart(2, "0")}.000Z`, "2026-10-20T00:00:00.000Z");
    native.prepare("INSERT INTO style_lab_rounds VALUES('history-00',0,?)").run(JSON.stringify({ index: 0, configuration: best, drafts: [{ referenceId: "ref", scene: 0 }], evaluations: [] }));
    native.prepare("INSERT INTO style_lab_artifacts VALUES('history-00',0,0,?)").run(JSON.stringify({ referenceId: "ref", scene: 0, raw: "原试写稿", text: "审校后的试写稿" }));
    let result = await api("/api/style-lab?articleId=article-main");
    assert.equal(result.total, 25); assert.equal(result.jobs.length, 20); assert.equal(result.pages, 2); assert.equal(result.executionMode, "server");
    result = await api("/api/style-lab?articleId=article-main&page=2");
    assert.equal(result.jobs.length, 5); assert.equal(result.jobs.at(-1).id, "history-00");
    native.prepare("UPDATE style_lab_jobs SET kind='tune',status='failed',phase='generate' WHERE id='history-24'").run();
    const summary = await api("/api/style-lab");
    assert.equal(summary.active, 0); assert.equal(summary.total, 25); assert.equal(summary.failed, 1);
    assert.deepEqual(summary.jobs, [], "failed calibration remains discoverable without joining the execution queue");
    await api("/api/style-lab/history-00", "POST", { action: "archive" });
    assert.equal((await api("/api/style-lab")).total, 24);
    assert.equal((await api("/api/style-lab?articleId=article-main")).total, 24);
    assert.equal((await api("/api/style-lab?articleId=article-main&filter=archived")).jobs[0].id, "history-00");
    const before = await api("/api/state"); before.data.articles[0].summary += "完整保存时重建文章";
    await api("/api/state", "PUT", { data: before.data }, { "If-Match": String(before.revision) });
    let detail = (await api("/api/style-lab/history-00")).job;
    assert.equal(detail.payload.references[0].text, references[0].text);
    assert.equal(detail.rounds[0].drafts[0].text, "审校后的试写稿");
    await api("/api/style-lab/history-00", "POST", { action: "apply" });
    assert.equal((await api("/api/state")).data.articles[0].style, best.style);
    detail = (await api("/api/style-lab/history-00")).job;
    assert.equal(detail.payload.applications.length, 1); assert.equal(detail.payload.applications[0].before.style, base.style);
    await api("/api/style-lab/history-00", "POST", { action: "restore" });
    assert.equal((await api("/api/state")).data.articles[0].style, base.style);
    await api("/api/style-lab/history-00", "POST", { action: "apply" });
    assert.equal((await api("/api/style-lab/history-00")).job.payload.applications.length, 2, "reapplying an old result remains possible");
    const manual = await api("/api/state"); manual.data.articles[0].style = "人工修改，不得被恢复覆盖";
    await api("/api/state", "PUT", { data: manual.data }, { "If-Match": String(manual.revision) });
    const rejected = await fetch(`${baseUrl}/api/style-lab/history-00`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
    assert.equal(rejected.status, 422);
    const backup = await api("/api/style-lab/export");
    assert.equal(backup.styleLab.jobs.length, 25); assert.equal(backup.styleLab.artifacts.length, 1);
    assert.equal(JSON.parse(backup.styleLab.artifacts[0].payload_json).text, "审校后的试写稿");
    assert.equal(JSON.parse(backup.styleLab.jobs.find(job => job.id === "history-00").payload_json).applications.length, 2);
  } finally { native.close(); }
});

test("snapshot import copies history and pauses active work without copying execution leases", async () => {
  const native = new DatabaseSync(":memory:");
  native.exec("PRAGMA foreign_keys=ON; CREATE TABLE articles(id TEXT PRIMARY KEY); INSERT INTO articles VALUES('article')");
  for (const sql of styleLabSchema) native.exec(sql);
  function statement(sql, args = []) { return { bind: (...values) => statement(sql, values), async run() { return { meta: native.prepare(sql).run(...args) }; }, async all() { return { results: native.prepare(sql).all(...args) }; } }; }
  const db = { prepare: sql => statement(sql) };
  const snapshot = { jobs: [{ id: "active", article_id: "article", kind: "learn", status: "running", phase: "learn", model_id: "model", payload_json: JSON.stringify({ autoApplyPending: true, references: [] }), error: null, created_at: "date", updated_at: "date" }], rounds: [], artifacts: [] };
  try {
    validateStyleLabSnapshot(snapshot, new Set(["article"]));
    for (const sql of importStyleLabStatements(db, snapshot)) await sql.run();
    const row = native.prepare("SELECT * FROM style_lab_jobs").get();
    assert.equal(row.status, "paused"); assert.equal(row.owner, null); assert.equal(row.lease_until, null);
    assert.equal(JSON.parse(row.payload_json).autoApplyPending, false);
    assert.match(JSON.parse(row.payload_json).notice, /同步导入/);
    const exported = await readStyleLabSnapshot(db); assert.equal(exported.jobs.length, 1);
    assert.throws(() => validateStyleLabSnapshot(snapshot, new Set(["another-article"])), /无效/);
    assert.throws(() => validateStyleLabSnapshot({ ...snapshot, jobs: [...snapshot.jobs, ...snapshot.jobs] }, new Set(["article"])), /无效/);
    assert.throws(() => validateStyleLabSnapshot({ ...snapshot, rounds: [null] }, new Set(["article"])), /无效/);
  } finally { native.close(); }
});
