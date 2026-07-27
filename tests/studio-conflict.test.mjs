import assert from "node:assert/strict";
import test from "node:test";
import { mergeAiManagedConflict } from "../app/studio-conflict.mjs";

function fixture() {
  return {
    version: 1,
    currentArticleId: "article",
    currentOutlineId: "outline",
    articles: [{ id: "article", lastOutlineId: "outline", updatedAt: "base", chapters: [{ id: "chapter", outlines: [{
      id: "outline", title: "", titleGenerationPending: true, plan: "原大纲", content: "", state: "saved", updatedAt: "base", versions: [],
    }] }] }],
    tasks: [{ id: "task", outlineId: "outline", state: "running", phase: "connecting", createdAt: "2026-01-01T00:00:00.000Z" }],
    settings: {},
  };
}

test("rebases outline edits over AI heartbeats and generated candidates", () => {
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
  serverOutline.versions = [{ id: "version-ai", source: "AI Generate", taskId: "task", content: "生成正文" }];

  const merged = mergeAiManagedConflict(base, local, server);
  assert.ok(merged);
  const outline = merged.articles[0].chapters[0].outlines[0];
  assert.equal(outline.plan, "手机修改后的大纲");
  assert.equal(outline.title, "", "a changed plan must still receive a fresh title later");
  assert.equal(outline.titleGenerationPending, true);
  assert.deepEqual(outline.versions.map((version) => version.id), ["version-ai"]);
  assert.equal(merged.tasks[0].state, "success");
  assert.equal(merged.currentOutlineId, "outline-local-selection");
});

test("keeps a genuine same-data conflict for explicit user resolution", () => {
  const base = fixture();
  const local = structuredClone(base);
  const server = structuredClone(base);
  local.articles[0].chapters[0].outlines[0].plan = "本机大纲";
  server.articles[0].chapters[0].outlines[0].plan = "其他设备大纲";
  assert.equal(mergeAiManagedConflict(base, local, server), null);
});
