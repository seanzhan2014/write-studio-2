import assert from "node:assert/strict";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;

async function api(path, { method = "GET", body, headers = {}, rawBody } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body === undefined && rawBody === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data, text };
}

async function resetFixture(transform) {
  const current = await api("/api/state");
  const fixture = fullStudioFixture();
  transform?.(fixture);
  const saved = await api("/api/state", {
    method: "PUT",
    headers: { "If-Match": String(current.data.revision) },
    body: { data: fixture, conflictResolution: "keep-local" },
  });
  assert.equal(saved.response.status, 200, saved.text);
  return saved.data.revision;
}

test("REST validation, cascades, ordering and rollback", async (t) => {
  assert.ok(baseUrl, "WRITER_STUDIO_TEST_BASE_URL is required");

  await t.test("exposes database versions and keeps unconfigured background sync inert", async () => {
    const before = await api("/api/state");
    assert.equal(Number.isSafeInteger(before.data.databaseVersion), true);
    const status = await api("/api/sync/status");
    assert.equal(status.response.status, 200, status.text);
    assert.equal(status.data.state, "not_configured");
    assert.equal(status.data.autoUploadEnabled, true);
    assert.equal(status.data.localDatabaseVersion, before.data.databaseVersion);
    const disabled = await api("/api/sync/settings", { method: "POST", body: { autoUploadEnabled: false } });
    assert.equal(disabled.response.status, 200, disabled.text);
    assert.equal(disabled.data.autoUploadEnabled, false);
    const upload = await api("/api/sync/upload", { method: "POST" });
    assert.equal(upload.response.status, 200, upload.text);
    assert.equal(upload.data.state, "disabled");
    const enabled = await api("/api/sync/settings", { method: "POST", body: { autoUploadEnabled: true } });
    assert.equal(enabled.response.status, 200, enabled.text);
    assert.equal(enabled.data.autoUploadEnabled, true);
    const remoteOnly = await api("/api/sync/remote/meta");
    assert.equal(remoteOnly.response.status, 404, remoteOnly.text);
  });

  await t.test("requires a revision for business writes and rejects malformed JSON", async () => {
    await resetFixture();
    const missing = await api("/api/outlines/outline-current", { method: "PATCH", body: { title: "不应写入" } });
    assert.equal(missing.response.status, 428, missing.text);
    const malformed = await api("/api/outlines/outline-current", { method: "PATCH", headers: { "If-Match": "1" }, rawBody: "{" });
    assert.equal(malformed.response.status, 400, malformed.text);
  });

  await t.test("uses field allow-lists instead of accepting nested graph replacement", async () => {
    let revision = await resetFixture();
    const patched = await api("/api/articles/article-main", {
      method: "PATCH",
      headers: { "If-Match": String(revision) },
      body: { title: "安全标题", chapters: [], characters: [], relationships: [], id: "hijacked", createdAt: "hijacked" },
    });
    assert.equal(patched.response.status, 200, patched.text);
    revision = patched.data.revision;
    assert.equal(patched.data.data.id, "article-main");
    assert.equal(patched.data.data.chapters.length, 2);
    assert.equal(patched.data.data.characters.length, 3);
    assert.notEqual(patched.data.data.createdAt, "hijacked");

    const bounded = await api("/api/settings", {
      method: "PUT",
      headers: { "If-Match": String(revision) },
      body: { fontSize: 999, lineHeight: -1, contentWidth: 99999, taskConcurrency: 99, unknown: "ignored" },
    });
    assert.equal(bounded.response.status, 200, bounded.text);
    assert.deepEqual(
      { fontSize: bounded.data.data.fontSize, lineHeight: bounded.data.data.lineHeight, contentWidth: bounded.data.data.contentWidth, taskConcurrency: bounded.data.data.taskConcurrency },
      { fontSize: 24, lineHeight: 1.4, contentWidth: 1200, taskConcurrency: 4 },
    );
    assert.equal("unknown" in bounded.data.data, false);
  });

  await t.test("tracks whether an outline needs an AI-generated title", async () => {
    let revision = await resetFixture();
    const created = await api("/api/chapters/chapter-main/outlines", {
      method: "POST",
      headers: { "If-Match": String(revision) },
      body: {},
    });
    assert.equal(created.response.status, 200, created.text);
    revision = created.data.revision;
    assert.equal(created.data.data.title, "");
    assert.equal(created.data.data.titleGenerationPending, true);

    const changedPlan = await api("/api/outlines/outline-current", {
      method: "PATCH",
      headers: { "If-Match": String(revision) },
      body: { plan: "林澈在潮水退去之前进入七码头。" },
    });
    assert.equal(changedPlan.response.status, 200, changedPlan.text);
    revision = changedPlan.data.revision;
    assert.equal(changedPlan.data.data.titleGenerationPending, true);

    const named = await api("/api/outlines/outline-current", {
      method: "PATCH",
      headers: { "If-Match": String(revision) },
      body: { title: "潮退之前进入七码头" },
    });
    assert.equal(named.response.status, 200, named.text);
    revision = named.data.revision;
    assert.equal(named.data.data.titleGenerationPending, false);

    const cleared = await api("/api/outlines/outline-current", {
      method: "PATCH",
      headers: { "If-Match": String(revision) },
      body: { title: "" },
    });
    assert.equal(cleared.response.status, 200, cleared.text);
    assert.equal(cleared.data.data.titleGenerationPending, true);
  });

  await t.test("accepts an empty outline title and indexes its automatic display name", async () => {
    const revision = await resetFixture();
    const plan = "暴雨后的清晨，林澈推开修理铺的门。她在工作台上发现一封来自未来的信，信封边缘被海水泡得发白，背面写着她自己的名字。";
    const updated = await api("/api/outlines/outline-current", {
      method: "PATCH",
      headers: { "If-Match": String(revision) },
      body: { title: "", plan },
    });
    assert.equal(updated.response.status, 200, updated.text);
    assert.equal(updated.data.data.title, "");
    assert.equal(updated.data.data.titleGenerationPending, true);
    const found = await api("/api/articles/article-main/search?q=%E6%9A%B4%E9%9B%A8%E5%90%8E%E7%9A%84%E6%B8%85%E6%99%A8");
    const result = found.data.data.find((item) => item.entity_id === "outline-current");
    assert.equal(result.title, plan.slice(0, 80));
  });

  await t.test("moves outlines across chapters without losing content, versions or chat", async () => {
    let revision = await resetFixture((fixture) => {
      fixture.articles[0].chapters.push({ id: "chapter-target", title: "目标章节", archived: false, outlines: [] });
      fixture.tasks.push({ id: "move-task", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "正文", prompt: "保留任务", model: "", state: "cancelled", createdAt: "2026-07-28T09:00:00.000Z" });
    });
    const moved = await api("/api/outlines/outline-current/move", {
      method: "POST",
      headers: { "If-Match": String(revision) },
      body: { chapterId: "chapter-target", position: 0 },
    });
    assert.equal(moved.response.status, 200, moved.text);
    revision = moved.data.revision;
    const state = await api("/api/state");
    const target = state.data.data.articles[0].chapters.find((chapter) => chapter.id === "chapter-target");
    const outline = target.outlines[0];
    assert.equal(outline.id, "outline-current");
    assert.equal(outline.content, "林澈看向顾屿，确认潮汐表上的时间。");
    assert.equal(outline.versions[0].id, "version-manual");
    assert.equal(outline.chat.sessions[0].messages.length, 22);
    assert.ok(state.data.data.tasks.some((task) => task.id === "move-task"));

    const fractional = await api("/api/outlines/outline-current/move", { method: "POST", headers: { "If-Match": String(revision) }, body: { chapterId: "chapter-main", position: 1.5 } });
    assert.equal(fractional.response.status, 400, fractional.text);
  });

  await t.test("keeps search synchronized with current-body changes and deletes", async () => {
    let revision = await resetFixture();
    const updated = await api("/api/outlines/outline-current/content", {
      method: "PUT", headers: { "If-Match": String(revision) }, body: { text: "唯一检索标记 海燕九号" },
    });
    assert.equal(updated.response.status, 200, updated.text);
    revision = updated.data.revision;
    assert.equal(updated.data.data.currentVersionId, null);
    const currentWorkingBody = await api("/api/articles/article-main/search?q=%E6%B5%B7%E7%87%95%E4%B9%9D%E5%8F%B7");
    assert.equal(currentWorkingBody.data.data.some((item) => item.entity_id === "outline-current"), true);
    const selected = await api("/api/versions/version-manual/default", { method: "POST", headers: { "If-Match": String(revision) }, body: {} });
    assert.equal(selected.response.status, 200, selected.text);
    revision = selected.data.revision;
    assert.equal(selected.data.data.defaultVersionId, "version-manual");
    assert.equal(selected.data.data.currentVersionId, null, "setting a default must not change current");
    const stillCurrentWorkingBody = await api("/api/articles/article-main/search?q=%E6%B5%B7%E7%87%95%E4%B9%9D%E5%8F%B7");
    assert.equal(stillCurrentWorkingBody.data.data.some((item) => item.entity_id === "outline-current"), true);
    const applied = await api("/api/versions/version-manual/apply", { method: "POST", headers: { "If-Match": String(revision) }, body: {} });
    assert.equal(applied.response.status, 200, applied.text);
    revision = applied.data.revision;
    const found = await api("/api/articles/article-main/search?q=%E4%B8%8D%E5%8F%AF%E5%8F%98%E7%89%88%E6%9C%AC%E6%AD%A3%E6%96%87");
    assert.ok(found.data.data.some((item) => item.entity_id === "outline-current"));
    const deleted = await api("/api/outlines/outline-current", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(deleted.response.status, 200, deleted.text);
    const absent = await api("/api/articles/article-main/search?q=%E4%B8%8D%E5%8F%AF%E5%8F%98%E7%89%88%E6%9C%AC%E6%AD%A3%E6%96%87");
    assert.equal(absent.data.data.some((item) => item.entity_id === "outline-current"), false);
  });

  await t.test("changes the default without changing the current body", async () => {
    let revision = await resetFixture();
    const selected = await api("/api/versions/version-manual/default", { method: "POST", headers: { "If-Match": String(revision) }, body: {} });
    assert.equal(selected.response.status, 200, selected.text);
    revision = selected.data.revision;
    assert.equal(selected.data.data.content, "林澈看向顾屿，确认潮汐表上的时间。", "setting a default must not overwrite the draft");
    assert.equal(selected.data.data.defaultVersionId, "version-manual");
    assert.equal(selected.data.data.currentVersionId, null);

    let content = await api("/api/outlines/outline-current/content");
    assert.equal(content.data.data.text, "林澈看向顾屿，确认潮汐表上的时间。");
    assert.equal(content.data.data.workingText, "林澈看向顾屿，确认潮汐表上的时间。");
    assert.equal(content.data.data.defaultVersionId, "version-manual");

    const edited = await api("/api/outlines/outline-current/content", { method: "PUT", headers: { "If-Match": String(revision) }, body: { text: "新草稿唯一标记" } });
    assert.equal(edited.response.status, 200, edited.text);
    revision = edited.data.revision;
    assert.equal(edited.data.data.defaultVersionId, "version-manual", "editing current must retain the default version");
    assert.equal(edited.data.data.currentVersionId, null);
    content = await api("/api/outlines/outline-current/content");
    assert.equal(content.data.data.text, "新草稿唯一标记");
    assert.equal(content.data.data.workingText, "新草稿唯一标记");
    const currentSearch = await api("/api/articles/article-main/search?q=%E6%96%B0%E8%8D%89%E7%A8%BF%E5%94%AF%E4%B8%80%E6%A0%87%E8%AE%B0");
    assert.equal(currentSearch.data.data.some((item) => item.entity_id === "outline-current"), true);

    const cleared = await api("/api/outlines/outline-current/default-version", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(cleared.response.status, 200, cleared.text);
    content = await api("/api/outlines/outline-current/content");
    assert.equal(content.data.data.text, "新草稿唯一标记");
    assert.equal(content.data.data.workingText, "新草稿唯一标记");
    assert.equal(content.data.data.defaultVersionId, null);
  });

  await t.test("keeps versions immutable and blocks deleting current versions", async () => {
    let revision = await resetFixture();
    const renamed = await api("/api/versions/version-manual", {
      method: "PATCH", headers: { "If-Match": String(revision) }, body: { name: "只改名称", content: "禁止修改的正文", source: "AI Generate" },
    });
    assert.equal(renamed.response.status, 200, renamed.text);
    revision = renamed.data.revision;
    assert.equal(renamed.data.data.name, "只改名称");
    assert.equal(renamed.data.data.content, "不可变版本正文");
    assert.equal(renamed.data.data.source, "手动");
    const applied = await api("/api/versions/version-manual/apply", { method: "POST", headers: { "If-Match": String(revision) }, body: {} });
    assert.equal(applied.response.status, 200, applied.text);
    revision = applied.data.revision;
    const removed = await api("/api/versions/version-manual", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(removed.response.status, 400, removed.text);
    assert.match(removed.data.message, /当前正文不能删除/);
    const switched = await api("/api/outlines/outline-current/content", { method: "PUT", headers: { "If-Match": String(revision) }, body: { text: "切回工作正文" } });
    assert.equal(switched.response.status, 200, switched.text);
    revision = switched.data.revision;
    const deleted = await api("/api/versions/version-manual", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(deleted.response.status, 200, deleted.text);
    const state = await api("/api/state");
    const outline = state.data.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
    assert.equal(outline.content, "切回工作正文");
    assert.equal(outline.currentVersionId, null);
    assert.equal(outline.versions.length, 0);
  });

  await t.test("edits chat history without mixing sessions and can clear one outline only", async () => {
    let revision = await resetFixture();
    const edited = await api("/api/chat/messages/message-10", { method: "PATCH", headers: { "If-Match": String(revision) }, body: { text: "从这里重新对话" } });
    assert.equal(edited.response.status, 200, edited.text);
    revision = edited.data.revision;
    let state = await api("/api/state");
    let current = state.data.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
    assert.equal(current.chat.sessions[0].messages.length, 11);
    assert.equal(current.chat.sessions[0].messages.at(-1).text, "从这里重新对话");
    assert.equal(current.chat.sessions[1].messages[0].text, "alternate-session-secret");
    assert.equal(state.data.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-previous").chat.sessions[0].messages.length, 0);

    const trimmed = await api("/api/chat/messages/message-5/after", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(trimmed.response.status, 200, trimmed.text);
    revision = trimmed.data.revision;
    state = await api("/api/state");
    current = state.data.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
    assert.equal(current.chat.sessions[0].messages.length, 6);

    const cleared = await api("/api/outlines/outline-current/chat", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(cleared.response.status, 200, cleared.text);
    state = await api("/api/state");
    current = state.data.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
    assert.equal(current.chat.sessions[0].messages.length, 0);
    assert.equal(current.chat.sessions[0].draft, "");
    assert.equal(current.chat.sessions[1].messages[0].text, "alternate-session-secret");
  });

  await t.test("normalizes relationship endpoints and rejects duplicates or foreign characters", async () => {
    const revision = await resetFixture();
    const duplicate = await api("/api/articles/article-main/relationships", {
      method: "POST", headers: { "If-Match": String(revision) }, body: { characterAId: "character-lin", characterBId: "character-gu", description: "重复" },
    });
    assert.equal(duplicate.response.status, 400, duplicate.text);
    const foreign = await api("/api/articles/article-main/relationships", {
      method: "POST", headers: { "If-Match": String(revision) }, body: { characterAId: "character-lin", characterBId: "character-not-in-article", description: "非法" },
    });
    assert.equal(foreign.response.status, 400, foreign.text);
    const state = await api("/api/state");
    assert.equal(state.data.revision, revision);
    assert.equal(state.data.data.articles[0].relationships.length, 1);
  });

  await t.test("edits only the four character business fields", async () => {
    const revision = await resetFixture();
    const updated = await api("/api/characters/character-lin", {
      method: "PATCH", headers: { "If-Match": String(revision) },
      body: { name: "林澈", aliases: ["阿澈", "维修师", "阿澈"], description: "更新后的人物描述", archived: true, role: "不应保存", color: "red" },
    });
    assert.equal(updated.response.status, 200, updated.text);
    assert.deepEqual(
      { name: updated.data.data.name, aliases: updated.data.data.aliases, description: updated.data.data.description, archived: updated.data.data.archived },
      { name: "林澈", aliases: ["阿澈", "维修师"], description: "更新后的人物描述", archived: true },
    );
    for (const removed of ["role", "appearance", "personality", "abilities", "background", "color"]) assert.equal(removed in updated.data.data, false);
  });

  await t.test("cascades outline, chapter and character-owned records", async () => {
    let revision = await resetFixture((fixture) => {
      fixture.tasks.push({ id: "cascade-task", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "正文", prompt: "级联", model: "", state: "cancelled", createdAt: "2026-07-28T09:00:00.000Z" });
    });
    const character = await api("/api/characters/character-gu", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(character.response.status, 200, character.text);
    revision = character.data.revision;
    let state = await api("/api/state");
    assert.equal(state.data.data.articles[0].relationships.length, 0);
    const outline = await api("/api/outlines/outline-current", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(outline.response.status, 200, outline.text);
    revision = outline.data.revision;
    state = await api("/api/state");
    assert.equal(state.data.data.tasks.some((task) => task.id === "cascade-task"), false);
    assert.equal(state.data.data.articles[0].chapters[0].outlines.some((item) => item.id === "outline-current"), false);
    const chapter = await api("/api/chapters/chapter-archived", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(chapter.response.status, 200, chapter.text);
    const integrity = await api("/api/database/integrity-check", { method: "POST" });
    assert.equal(integrity.data.ok, true);
  });

  await t.test("deletes a whole article graph and selects a valid replacement", async () => {
    let revision = await resetFixture((fixture) => {
      const second = structuredClone(fixture.articles[0]);
      second.id = "article-second";
      second.title = "保留文章";
      second.lastOutlineId = "second-outline";
      second.chapters = [{ id: "second-chapter", title: "保留章节", archived: false, outlines: [{ ...second.chapters[0].outlines[0], id: "second-outline", versions: [], chat: { sessions: [{ id: "chat:second-outline", title: "主会话", messages: [], draft: "", includePrevious: true, includeCharacters: true, createdAt: "2026-07-28T08:00:00.000Z", updatedAt: "2026-07-28T08:00:00.000Z" }], activeSessionId: "chat:second-outline" } }] }];
      second.characters = [];
      second.relationships = [];
      fixture.articles.push(second);
      fixture.tasks.push({ id: "article-task", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "正文", prompt: "文章级联", model: "", state: "cancelled", createdAt: "2026-07-28T09:00:00.000Z" });
    });
    const removed = await api("/api/articles/article-main", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(removed.response.status, 200, removed.text);
    revision = removed.data.revision;
    const state = await api("/api/state");
    assert.equal(state.data.data.articles.length, 1);
    assert.equal(state.data.data.currentArticleId, "article-second");
    assert.equal(state.data.data.currentOutlineId, "second-outline");
    assert.equal(state.data.data.tasks.some((task) => task.id === "article-task"), false);
    const deletedLast = await api("/api/articles/article-second", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(deletedLast.response.status, 200, deletedLast.text);
    const empty = await api("/api/state");
    assert.equal(empty.data.data.articles.length, 0);
    assert.equal(empty.data.data.currentArticleId, "");
    assert.equal(empty.data.data.currentOutlineId, "");
  });

  await t.test("allows the last chapter and outline to be deleted without replacement", async () => {
    let revision = await resetFixture((fixture) => {
      fixture.articles[0].chapters = [fixture.articles[0].chapters[0]];
      fixture.articles[0].chapters[0].outlines = [fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")];
      fixture.articles[0].lastOutlineId = "outline-current";
      fixture.currentOutlineId = "outline-current";
      fixture.tasks = [];
    });
    const outline = await api("/api/outlines/outline-current", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(outline.response.status, 200, outline.text);
    revision = outline.data.revision;
    let state = await api("/api/state");
    assert.equal(state.data.data.articles[0].chapters[0].outlines.length, 0);
    assert.equal(state.data.data.currentOutlineId, "");
    const chapter = await api("/api/chapters/chapter-main", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(chapter.response.status, 200, chapter.text);
    state = await api("/api/state");
    assert.equal(state.data.data.articles[0].chapters.length, 0);
  });

  await t.test("clears all business data instead of restoring demo records", async () => {
    await resetFixture();
    const cleared = await api("/api/database/business-data", { method: "DELETE" });
    assert.equal(cleared.response.status, 200, cleared.text);
    const state = await api("/api/state");
    assert.equal(state.data.data.articles.length, 0);
    assert.equal(state.data.data.tasks.length, 0);
  });

  await t.test("preserves active tasks when enforcing the 20-record limit", async () => {
    await resetFixture((fixture) => {
      fixture.tasks = Array.from({ length: 20 }, (_, index) => ({
        id: `existing-task-${index}`, articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "正文",
        prompt: `任务 ${index}`, model: "", state: index >= 17 ? "success" : "waiting", createdAt: `2026-07-28T08:${String(index).padStart(2, "0")}:00.000Z`,
      }));
    });
    const created = await api("/api/ai/tasks", {
      method: "POST", headers: { "Idempotency-Key": "task-over-limit" },
      body: { articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "content", instruction: "新任务", model: "", contentMode: "rewrite", rewriteRetention: "high", includePrevious: false, includeCharacters: true, firstAppearanceCharacterIds: ["character-gu", "character-archived", "missing"] },
    });
    assert.equal(created.response.status, 200, created.text);
    const tasks = await api("/api/ai/tasks");
    assert.equal(tasks.data.data.length, 20);
    assert.ok(tasks.data.data.some((task) => task.id === "task-over-limit"));
    for (let index = 0; index < 17; index += 1) assert.ok(tasks.data.data.some((task) => task.id === `existing-task-${index}`), `active task ${index} must remain`);
    assert.deepEqual(created.data.data.contextOptions, { includePrevious: false, includeCharacters: true, estimatedCharacters: 0, contentMode: "rewrite", rewriteRetention: "high", outlinePlanSnapshot: "林澈与顾屿在七码头会合。", outlineTitleSnapshot: "当前码头", firstAppearanceCharacterIds: ["character-gu"] });
    const state = await api("/api/state");
    assert.equal(state.data.data.articles[0].chapters[0].outlines.find((outline) => outline.id === "outline-current").generateInstruction, "新任务");

    const cancelled = await api("/api/ai/tasks/task-over-limit/cancel", { method: "POST", body: {} });
    assert.equal(cancelled.response.status, 200, cancelled.text);
    const retried = await api("/api/ai/tasks/task-over-limit/retry", { method: "POST", body: {} });
    assert.equal(retried.response.status, 200, retried.text);
    assert.equal(retried.data.data.state, "waiting");
  });

  await t.test("round-trips Chat tasks and clears only completed records", async () => {
    const revision = await resetFixture((fixture) => {
      fixture.tasks = [
        { id: "chat-complete", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "AI Chat", prompt: "分析人物动机", model: "", state: "success", resultText: "人物动机分析", createdAt: "2026-07-28T10:00:00.000Z", contextOptions: { includePrevious: true, includeCharacters: true, estimatedCharacters: 320, sessionId: "chat:outline-current" } },
        { id: "generate-failed", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "正文", prompt: "保留失败记录", model: "", state: "failed", error: "测试失败", createdAt: "2026-07-28T09:00:00.000Z" },
        { id: "chat-cancelled", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "AI Chat", prompt: "保留取消记录", model: "", state: "cancelled", createdAt: "2026-07-28T08:00:00.000Z" },
      ];
    });
    const loaded = await api("/api/state");
    const chatTask = loaded.data.data.tasks.find((task) => task.id === "chat-complete");
    assert.equal(chatTask.target, "AI Chat");
    assert.equal(chatTask.contextOptions.sessionId, "chat:outline-current");

    const cleared = await api("/api/ai/tasks/completed", { method: "DELETE", headers: { "If-Match": String(revision) } });
    assert.equal(cleared.response.status, 200, cleared.text);
    assert.equal(cleared.data.data.deleted, 1);
    const remaining = await api("/api/ai/tasks");
    assert.deepEqual(remaining.data.data.map((task) => task.id), ["generate-failed", "chat-cancelled"]);
  });

  await t.test("rolls back the whole state write when a foreign key fails", async () => {
    const revision = await resetFixture();
    const invalid = fullStudioFixture();
    invalid.articles[0].relationships.push({ id: "broken-relationship", characterAId: "character-lin", characterBId: "missing-character", description: "必须整体回滚" });
    invalid.articles[0].title = "也不应写入";
    const failed = await api("/api/state", { method: "PUT", headers: { "If-Match": String(revision) }, body: { data: invalid } });
    assert.equal(failed.response.status, 500, failed.text);
    const state = await api("/api/state");
    assert.equal(state.data.revision, revision);
    assert.equal(state.data.data.articles[0].title, "严格测试文章");
    assert.equal(state.data.data.articles[0].relationships.length, 1);
    const integrity = await api("/api/database/integrity-check", { method: "POST" });
    assert.equal(integrity.data.ok, true);
  });
});
