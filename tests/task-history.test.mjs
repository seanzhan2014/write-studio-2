import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseTaskHistory, taskPhaseLabels } from "../lib/task-history.ts";

const source = readFileSync(new URL("../app/ui/task-history.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React } }).outputText.replace(/^import .*;$/gm, "").replace(/^export /gm, "");
const TaskHistory = Function("React", "parseTaskHistory", "taskPhaseLabels", `${code}\nreturn TaskHistory;`)(React, parseTaskHistory, taskPhaseLabels);

test("history renders every saved step, review rounds and retry errors with only the latest step current", () => {
  const history = ["generating", "reviewing", "revising", "retrying", "revising", "verifying"].map((phase, i) => ({
    phase, at: `2026-09-11T00:00:0${i}.000Z`, attempt: 1, executionOrigin: "local", reviewRound: i < 2 ? 0 : 1,
    error: phase === "retrying" ? "连接超时 <upstream>" : null,
  }));
  const task = { state: "running", phase: "verifying", history };
  const html = renderToStaticMarkup(React.createElement(TaskHistory, { task }));
  assert.equal((html.match(/<li /g) ?? []).length, 6);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /按问题修正 · 第 1 轮/);
  assert.match(html, /连接超时 &lt;upstream&gt;/);
  const running = renderToStaticMarkup(React.createElement(TaskHistory, { task, collapsible: true }));
  assert.match(running, /<details[^>]*open=""/);
  const completed = renderToStaticMarkup(React.createElement(TaskHistory, { task: { ...task, state: "success" }, collapsible: true }));
  assert.match(completed, /<summary>运行历史 · 6 条<\/summary>/);
  assert.doesNotMatch(completed, /aria-current/);
  assert.equal((completed.match(/<li /g) ?? []).length, 6);
});

test("legacy tasks and malformed histories remain readable without inventing execution steps", () => {
  for (const history of [undefined, null, "invalid", [{ phase: "unknown" }]]) {
    const html = renderToStaticMarkup(React.createElement(TaskHistory, { task: { state: "success", history } }));
    assert.match(html, /尚无运行历史记录/);
    assert.doesNotMatch(html, /<li/);
  }
});

test("migration records rapid transitions atomically and ignores heartbeats, reloads and duplicate snapshots", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE ai_tasks(id TEXT PRIMARY KEY,phase TEXT,status TEXT,attempt INTEGER DEFAULT 0,
      execution_origin TEXT DEFAULT 'local',context_options_json TEXT DEFAULT '{}',error_message TEXT,
      created_at TEXT,started_at TEXT,completed_at TEXT,last_progress_at TEXT,received_characters INTEGER);
      INSERT INTO ai_tasks(id,phase,status,created_at) VALUES('legacy','generating','running','2026-09-01T00:00:00.000Z');`);
    db.exec(readFileSync(new URL("../drizzle/0020_ai_task_history.sql", import.meta.url), "utf8"));
    const read = (id) => JSON.parse(db.prepare("SELECT history_json FROM ai_tasks WHERE id=?").get(id).history_json);
    assert.deepEqual(read("legacy"), []);
    db.exec("UPDATE ai_tasks SET phase='failed',status='error',error_message='模型超时' WHERE id='legacy'");
    assert.deepEqual(read("legacy").map((entry) => entry.phase), ["generating", "failed"]);
    db.exec("UPDATE ai_tasks SET phase='queued',status='queued',error_message=NULL WHERE id='legacy'");
    assert.equal(read("legacy")[1].error, "模型超时");
    db.exec("INSERT INTO ai_tasks(id,phase,status,created_at) VALUES('new','queued','queued','2026-09-11T00:00:00.000Z')");
    db.exec("UPDATE ai_tasks SET phase='generating',status='running',attempt=1 WHERE id='new'");
    for (let i = 0; i < 20; i++) db.exec(`UPDATE ai_tasks SET phase='generating',received_characters=${i},last_progress_at='2026-09-11T00:00:01.000Z' WHERE id='new'`);
    assert.deepEqual(read("new").map((entry) => entry.phase), ["queued", "generating"]);
    db.exec("UPDATE ai_tasks SET phase='completed',status='success' WHERE id='new'");
    const saved = read("new");
    db.prepare("INSERT INTO ai_tasks(id,phase,status,attempt,history_json) VALUES('restored','completed','success',1,?)").run(JSON.stringify(saved));
    assert.deepEqual(read("restored"), saved);
  } finally { db.close(); }
});
