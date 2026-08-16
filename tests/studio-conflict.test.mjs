import assert from "node:assert/strict";
import test from "node:test";
import { mergeAiManagedConflict } from "../app/studio-conflict.mjs";

function fixture() {
  return {
    version: 1,
    currentArticleId: "article",
    currentOutlineId: "outline",
    articles: [{ id: "article", lastOutlineId: "outline", updatedAt: "base", chapters: [{ id: "chapter", outlines: [{
      id: "outline", title: "", titleGenerationPending: true, plan: "原大纲", content: "", currentVersionId: null, defaultVersionId: null, contentOutlineSnapshot: { title: "", plan: "原大纲" }, state: "saved", updatedAt: "base", versions: [],
    }] }] }],
    tasks: [{ id: "task", outlineId: "outline", state: "running", phase: "connecting", createdAt: "2026-01-01T00:00:00.000Z" }],
    settings: {},
  };
}

test("rebases outline edits over AI completion and accepts the generated current body", () => {
  const base = fixture();
  const local = structuredClone(base);
  local.articles[0].chapters[0].outlines[0].plan = "手机修改后的大纲";
  local.articles[0].chapters[0].outlines[0].updatedAt = "local";
  local.articles[0].updatedAt = "local";
  local.currentOutlineId = "outline-local-selection";
  local.articles[0].lastOutlineId = "outline-local-selection";

  const server = structuredClone(base);
  const serverOutline = server.articles[0].chapters[0].outlines[0];
  server.tasks[0] = { ...server.tasks[0], state: "success", phase: "completed", resultVersionId: "version-ai" };
  serverOutline.state = "saved";
  serverOutline.title = "模型生成的大纲标题";
  serverOutline.titleGenerationPending = false;
  serverOutline.currentVersionId = "version-ai";
  serverOutline.updatedAt = "server";
  serverOutline.versions = [{ id: "version-ai", name: "AI 生成正文", source: "AI Generate", taskId: "task", content: "生成正文" }];

  const merged = mergeAiManagedConflict(base, local, server);
  assert.ok(merged);
  const outline = merged.articles[0].chapters[0].outlines[0];
  assert.equal(outline.plan, "手机修改后的大纲");
  assert.equal(outline.title, "", "a changed plan must still receive a fresh title later");
  assert.equal(outline.titleGenerationPending, true);
  assert.deepEqual(outline.versions.map((version) => version.id), ["version-ai"]);
  assert.equal(outline.currentVersionId, "version-ai");
  assert.equal(outline.content, "", "AI results are not duplicated into the working body");
  assert.equal(merged.tasks[0].state, "success");
  assert.equal(merged.currentOutlineId, "outline-local-selection");
});

test("keeps a locally edited current body while retaining a concurrently generated version", () => {
  const base = fixture();
  const local = structuredClone(base);
  const localOutline = local.articles[0].chapters[0].outlines[0];
  localOutline.content = "本机刚保存的正文";
  localOutline.contentName = "本机正文";
  localOutline.currentVersionId = null;
  localOutline.updatedAt = "local";

  const server = structuredClone(base);
  const serverOutline = server.articles[0].chapters[0].outlines[0];
  server.tasks[0] = { ...server.tasks[0], state: "success", phase: "completed", resultVersionId: "version-ai" };
  serverOutline.state = "saved";
  serverOutline.currentVersionId = "version-ai";
  serverOutline.updatedAt = "server";
  serverOutline.versions = [{ id: "version-ai", name: "AI 生成正文", source: "AI Generate", taskId: "task", content: "生成正文" }];

  const merged = mergeAiManagedConflict(base, local, server);
  assert.ok(merged);
  const outline = merged.articles[0].chapters[0].outlines[0];
  assert.equal(outline.content, "本机刚保存的正文");
  assert.equal(outline.currentVersionId, null);
  assert.deepEqual(outline.versions.map((version) => version.id), ["version-ai"]);
});

test("automatically merges the server backup created for a direct current body", () => {
  const base = fixture();
  const baseOutline = base.articles[0].chapters[0].outlines[0];
  baseOutline.content = "任务开始前的直接正文";
  baseOutline.contentName = "直接正文";
  baseOutline.currentVersionId = null;

  const local = structuredClone(base);
  local.articles[0].chapters[0].outlines[0].plan = "本机修改后的大纲";
  local.articles[0].chapters[0].outlines[0].updatedAt = "local";

  const server = structuredClone(base);
  const serverOutline = server.articles[0].chapters[0].outlines[0];
  server.tasks[0] = { ...server.tasks[0], state: "success", phase: "completed", resultVersionId: "version-ai" };
  serverOutline.state = "saved";
  serverOutline.currentVersionId = "version-ai";
  serverOutline.updatedAt = "server";
  serverOutline.versions = [
    { id: "version-ai", name: "AI 生成正文", source: "AI Generate", taskId: "task", content: "生成正文" },
    { id: "version-backup", name: "AI Generate 前 · 2026-01-01 00:00:00", source: "手动", taskId: "task", content: "任务开始前的直接正文" },
  ];

  const merged = mergeAiManagedConflict(base, local, server);
  assert.ok(merged);
  const outline = merged.articles[0].chapters[0].outlines[0];
  assert.equal(outline.plan, "本机修改后的大纲");
  assert.equal(outline.currentVersionId, "version-ai");
  assert.equal(outline.content, "任务开始前的直接正文");
  assert.deepEqual(outline.versions.map((version) => version.id), ["version-ai", "version-backup"]);
});

test("keeps a genuine same-data conflict for explicit user resolution", () => {
  const base = fixture();
  const local = structuredClone(base);
  const server = structuredClone(base);
  local.articles[0].chapters[0].outlines[0].plan = "本机大纲";
  server.articles[0].chapters[0].outlines[0].plan = "其他设备大纲";
  assert.equal(mergeAiManagedConflict(base, local, server), null);
});
