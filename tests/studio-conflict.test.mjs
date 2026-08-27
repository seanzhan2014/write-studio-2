import assert from "node:assert/strict";
import test from "node:test";
import { durableStudioData, mergeAiManagedConflict, mergeStudioConflict, resolveStudioConflict } from "../app/studio-conflict.mjs";

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

test("accepts newer AI runtime progress without reporting an empty-body conflict", () => {
  const base = fixture();
  const local = structuredClone(base);
  const server = structuredClone(base);
  local.tasks[0] = { ...local.tasks[0], state: "running", phase: "generating", attempt: 1, receivedCharacters: 0, lastProgressAt: "local-progress", runnerId: "runner-local" };
  local.articles[0].chapters[0].outlines[0].state = "running";
  server.tasks[0] = { ...server.tasks[0], state: "running", phase: "receiving", attempt: 1, receivedCharacters: 0, lastProgressAt: "server-progress", runnerId: "runner-server" };
  server.articles[0].chapters[0].outlines[0].state = "saved";

  const result = mergeStudioConflict(base, local, server);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.merged.tasks[0].phase, "receiving");
  assert.equal(result.merged.tasks[0].lastProgressAt, "server-progress");
  assert.equal(result.merged.articles[0].chapters[0].outlines[0].state, "saved");
  assert.equal(result.merged.articles[0].chapters[0].outlines[0].content, "");
});

test("does not report a conflict for a regenerated current-name creation timestamp", () => {
  const base = fixture();
  const baseOutline = base.articles[0].chapters[0].outlines[0];
  baseOutline.nameVersions = [{ id: "name-current:outline", title: "佛堂春戏", source: "manual", createdAt: "2026-08-24T16:30:00.000Z" }];
  baseOutline.defaultNameVersionId = "name-current:outline";

  const local = structuredClone(base);
  const localOutline = local.articles[0].chapters[0].outlines[0];
  localOutline.plan = "本设备修改后的大纲";
  localOutline.nameVersions[0].createdAt = "2026-08-24T16:43:55.491Z";

  const server = structuredClone(base);
  const serverOutline = server.articles[0].chapters[0].outlines[0];
  serverOutline.updatedAt = "2026-08-24T16:52:57.596Z";
  serverOutline.nameVersions[0].createdAt = "2026-08-24T16:52:57.596Z";

  const result = mergeStudioConflict(base, local, server);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.merged.articles[0].chapters[0].outlines[0].plan, "本设备修改后的大纲");
  assert.equal(result.merged.articles[0].chapters[0].outlines[0].nameVersions[0].createdAt, "2026-08-24T16:52:57.596Z");
});

test("merges edits to one article with a concurrently imported article", () => {
  const base = fixture();
  const local = structuredClone(base);
  local.articles[0].chapters[0].outlines[0].plan = "本设备修改";
  const server = structuredClone(base);
  server.articles.push({ id: "imported", title: "新导入文章", lastOutlineId: "", updatedAt: "server", chapters: [] });

  const result = mergeStudioConflict(base, local, server);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.merged.articles.length, 2);
  assert.equal(result.merged.articles.find((article) => article.id === "article").chapters[0].outlines[0].plan, "本设备修改");
});

test("reports the exact entity and field for a real conflict", () => {
  const base = fixture();
  const local = structuredClone(base);
  const server = structuredClone(base);
  local.articles[0].title = "本设备标题";
  server.articles[0].title = "数据库标题";

  const result = mergeStudioConflict(base, local, server);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].entityId, "article");
  assert.match(result.conflicts[0].label, /文章.*标题/);
  assert.equal(result.conflicts[0].localText, "本设备标题");
  assert.equal(result.conflicts[0].serverText, "数据库标题");
});

test("keeping a local conflicting field preserves unrelated server additions", () => {
  const base = fixture();
  const local = structuredClone(base);
  const server = structuredClone(base);
  local.articles[0].title = "本设备标题";
  server.articles[0].title = "数据库标题";
  server.articles.push({ id: "imported", title: "新导入文章", lastOutlineId: "", updatedAt: "server", chapters: [] });

  const resolved = resolveStudioConflict(base, local, server, "local");
  assert.equal(resolved.articles.find((article) => article.id === "article").title, "本设备标题");
  assert.equal(resolved.articles.find((article) => article.id === "imported").title, "新导入文章");
});

test("device-only navigation and composing state are excluded from durable snapshots", () => {
  const data = fixture();
  const outline = data.articles[0].chapters[0].outlines[0];
  outline.chat = { activeSessionId: "session-2", sessions: [
    { id: "session-1", draft: "草稿", lastReadMessageId: "message-1", includePrevious: false, includeCharacters: false },
    { id: "session-2", draft: "另一个草稿", lastReadMessageId: null, includePrevious: true, includeCharacters: true },
  ] };
  data.settings = { theme: "dark", editorFont: "serif", fontSize: 22, lineHeight: 2, contentWidth: 1100, outlineExpanded: false, showArchived: true, openLastArticle: false };
  data.currentArticleId = "article";
  data.currentOutlineId = "outline";
  data.articles[0].lastOutlineId = "outline";

  const durable = durableStudioData(data);
  assert.equal(durable.currentArticleId, "");
  assert.equal(durable.currentOutlineId, "");
  assert.equal(durable.articles[0].lastOutlineId, "");
  assert.equal(durable.articles[0].chapters[0].outlines[0].chat.activeSessionId, "");
  assert.equal(durable.articles[0].chapters[0].outlines[0].chat.sessions[0].draft, "");
  assert.equal(durable.articles[0].chapters[0].outlines[0].chat.sessions[0].lastReadMessageId, null);
  assert.equal(durable.articles[0].chapters[0].outlines[0].chat.sessions[0].includePrevious, true);
  assert.equal(durable.articles[0].chapters[0].outlines[0].chat.sessions[0].includeCharacters, true);
  assert.equal(durable.settings.theme, "light");
  assert.equal(durable.settings.editorFont, "sans");
});
