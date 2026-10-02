import assert from "node:assert/strict";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";
import { durableSnapshot, diffStudioData, isStudioChangesEmpty, normalizeStudioData, reconcileTaskPoll } from "./studio-test-runtime.mjs";
import { mergeStudioConflict, resolveStudioConflict } from "../app/studio-conflict.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
async function state() {
  const response = await fetch(`${baseUrl}/api/state`);
  assert.equal(response.status, 200);
  return response.json();
}
async function write(path, body, revision, method = "POST") {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json", "If-Match": String(revision) }, body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
async function reset() {
  const current = await state();
  const data = durableSnapshot(fullStudioFixture());
  assert.equal((await write("/api/state", { data }, current.revision, "PUT")).status, 200);
  return state();
}
async function saveDiff(base, local, revision) {
  return write("/api/state/mutations", { changes: diffStudioData(durableSnapshot(base), durableSnapshot(local)) }, revision);
}

test("retired story and character fields move into the simplified text fields", () => {
  const source = fullStudioFixture();
  const article = source.articles[0];
  article.summary = "一封未来来信引出旧港秘密。";
  article.type = "近未来悬疑";
  article.storySettings = { era: "2033 年", location: "雾港", tone: "冷峻", worldRules: "改变过去会失去记忆", negativeConstraints: "不能用梦解释" };
  article.characters[0].profile = { age: "29 岁", identity: "修理师", appearance: "短发", personality: "谨慎", speechStyle: "短句", abilities: "维修", mentalState: "戒备", knownInformation: "只知道公开结论", boundaries: "不伤害无辜者", immutableTraits: "坚持验证事实" };

  const normalized = normalizeStudioData(source);
  const migratedArticle = normalized.articles[0];
  const migratedPerson = migratedArticle.characters[0];
  assert.equal(migratedArticle.type, "");
  assert.match(migratedArticle.summary, /类型：近未来悬疑/);
  assert.match(migratedArticle.summary, /时代背景：2033 年/);
  assert.match(migratedArticle.summary, /世界规则：改变过去会失去记忆/);
  assert.deepEqual(migratedArticle.storySettings, { location: "雾港", negativeConstraints: "不能用梦解释" });
  assert.match(migratedPerson.description, /身份：修理师/);
  assert.match(migratedPerson.description, /当前已知信息：只知道公开结论/);
  assert.deepEqual(migratedPerson.profile, { age: "29 岁", appearance: "短发", immutableTraits: "不伤害无辜者\n坚持验证事实" });
});

test("terminal task polling closes only the task's original outline", () => {
  const current = fullStudioFixture();
  const original = current.articles[0].chapters[0].outlines.find((outline) => outline.id === "outline-current");
  const added = structuredClone(original);
  added.id = "outline-created-while-generating";
  added.title = "生成期间新建的大纲";
  added.state = "saved";
  current.articles[0].chapters[0].outlines.push(added);
  current.currentOutlineId = added.id;
  original.state = "running";
  current.tasks = [{ id: "task-original", articleId: "article-main", chapterId: "chapter-main", outlineId: original.id, target: "正文", prompt: "生成", model: "", executionOrigin: "local", state: "running", createdAt: "2026-09-09T00:00:00.000Z" }];

  const completed = { ...current.tasks[0], state: "success", phase: "completed", resultVersionId: "version-generated" };
  const reconciled = reconcileTaskPoll(current, [completed], []);
  assert.equal(reconciled.tasks[0].state, "success");
  assert.equal(reconciled.articles[0].chapters[0].outlines.find((outline) => outline.id === original.id).state, "saved");
  assert.equal(reconciled.articles[0].chapters[0].outlines.find((outline) => outline.id === added.id).state, "saved");
  assert.equal(reconciled.currentOutlineId, added.id, "polling must not redirect the current selection or reinterpret it as the result target");
});

test("SQLite snapshot lifecycle", { skip: !baseUrl }, async (t) => {
  for (const mode of ["full snapshot", "incremental changes"]) {
    await t.test(`${mode}: create, read, save again does not invent changes or advance revision`, async () => {
      const before = await reset();
      const local = structuredClone(before.data);
      local.articles[0].aiGenerateSettings = {
        ...local.articles[0].aiGenerateSettings,
        targetWords: 6400,
        includePrevious: false,
        proseControls: { ...local.articles[0].aiGenerateSettings.proseControls, dialogueDensity: "high" },
      };
      local.articles[0].storySettings = { location: "雾港", negativeConstraints: "不能用梦解释" };
      local.articles[0].characters[0].profile = { age: "29 岁", appearance: "短发", immutableTraits: "一定验证证据" };
      local.articles[0].chapters[0].settings = { story: { location: { value: "旧码头", scope: "ongoing" } }, characters: { "character-lin": { start: { appearance: { value: "披着雨衣", scope: "chapter" } }, end: { age: "30 岁" } } }, relationships: {} };
      local.articles[0].chapters[0].outlines.find((outline) => outline.id === "outline-current").settings = { story: { summary: { value: "码头冲突升级", scope: "chapter" } }, characters: {}, relationships: {} };
      local.articles[0].chapters[0].outlines.find((outline) => outline.id === "outline-current").generateOptions = {
        ...local.articles[0].aiGenerateSettings,
        targetWords: 7200,
        contentMode: "rewrite",
      };
      local.articles[0].chapters[0].outlines.find((outline) => outline.id === "outline-current").versions[0].settingSnapshot = {
        chapterId: "chapter-main",
        story: { summary: "失序的海港", location: "旧码头", style: "克制", negativeConstraints: "不能用梦解释" },
        storySources: {},
        characters: [],
        relationships: [],
      };
      const newOutline = structuredClone(fullStudioFixture().articles[0].chapters[0].outlines[0]);
      newOutline.id = "roundtrip-outline";
      newOutline.chat.sessions[0].id = "chat:roundtrip-outline";
      newOutline.chat.activeSessionId = "chat:roundtrip-outline";
      local.articles[0].chapters.push({ id: "roundtrip-chapter", title: "未命名章节", archived: false, outlines: [newOutline] });
      const pending = durableSnapshot(local);
      const saved = mode === "full snapshot"
        ? await write("/api/state", { data: pending }, before.revision, "PUT")
        : await saveDiff(before.data, pending, before.revision);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      const loaded = await state();
      const server = durableSnapshot(loaded.data);
      const diff = diffStudioData(pending, server);
      assert.ok(isStudioChangesEmpty(diff), JSON.stringify(diff));
      assert.deepEqual(mergeStudioConflict(pending, durableSnapshot(local), server).conflicts, []);
      // The client skips empty mutation batches. An identical full snapshot is
      // also a supported API no-op and must leave both version counters alone.
      const noop = await write("/api/state", { data: loaded.data }, loaded.revision, "PUT");
      assert.equal(noop.status, 200);
      const after = await state();
      assert.equal(after.revision, loaded.revision);
      assert.equal(after.databaseVersion, loaded.databaseVersion);
    });
  }

  await t.test("legacy missing and null metadata settle after a real database roundtrip", async () => {
    const before = await reset();
    const legacy = fullStudioFixture();
    legacy.articles[0].chapters[0].nameVersions = null;
    legacy.articles[0].chapters[0].defaultNameVersionId = null;
    const saved = await write("/api/state", { data: legacy }, before.revision, "PUT");
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const loaded = await state();
    const accepted = durableSnapshot(loaded.data);
    assert.ok(isStudioChangesEmpty(diffStudioData(accepted, durableSnapshot(JSON.parse(JSON.stringify(accepted))))));
    const next = await write("/api/state", { data: loaded.data }, loaded.revision, "PUT");
    assert.equal(next.status, 200);
    assert.equal((await state()).revision, loaded.revision);
    assert.equal(accepted.articles[0].chapters[0].nameVersions[0].title, "第一章");
  });

  await t.test("stale local edit rebases over durable Chat updates, retries and converges", async () => {
    let base = await reset();
    for (let turn = 1; turn <= 3; turn += 1) {
      const local = structuredClone(base.data);
      local.articles[0].summary = `本机修改 ${turn}`;
      const taskId = `roundtrip-chat-${turn}`;
      const sessionId = "chat:outline-current";
      const message = `往返问题 ${turn}`;
      const submit = await write("/api/outlines/outline-current/chat/transactions", {
        action: "submit", taskId, sessionId, message, model: "",
        messages: [{ id: `roundtrip-user-${turn}`, role: "user", text: message, createdAt: "2026-09-07T13:00:00.000Z" }],
      }, base.revision);
      assert.equal(submit.status, 201, JSON.stringify(submit.data));
      const completed = await write("/api/outlines/outline-current/chat/transactions", {
        action: "finalize", taskId, sessionId, status: "success", result: `往返回复 ${turn}`,
      }, submit.data.revision);
      assert.equal(completed.status, 200, JSON.stringify(completed.data));
      const stale = await saveDiff(base.data, local, base.revision);
      assert.equal(stale.status, 409);
      const current = await state();
      const result = mergeStudioConflict(durableSnapshot(base.data), durableSnapshot(local), durableSnapshot(current.data));
      assert.deepEqual(result.conflicts, []);
      assert.equal((await saveDiff(current.data, result.merged, current.revision)).status, 200);
      base = await state();
      assert.equal(base.data.articles[0].summary, `本机修改 ${turn}`);
      const replies = base.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current").chat.sessions.flatMap((item) => item.messages);
      assert.equal(replies.filter((item) => item.text === `往返回复 ${turn}`).length, 1);
      assert.ok(isStudioChangesEmpty(diffStudioData(durableSnapshot(base.data), durableSnapshot(result.merged))));
    }
  });

  for (const preference of ["local", "server"]) {
    await t.test(`real conflict resolved with ${preference} survives another save and read`, async () => {
      const base = await reset();
      const local = structuredClone(base.data);
      local.articles[0].title = "本机标题";
      local.articles[0].style = "本机独立文风";
      const remote = structuredClone(base.data);
      remote.articles[0].title = "数据库标题";
      remote.articles[0].summary = "数据库独立简介";
      assert.equal((await saveDiff(base.data, remote, base.revision)).status, 200);
      assert.equal((await saveDiff(base.data, local, base.revision)).status, 409);
      const current = await state();
      const result = mergeStudioConflict(durableSnapshot(base.data), durableSnapshot(local), durableSnapshot(current.data));
      assert.equal(result.conflicts.length, 1);
      const resolved = resolveStudioConflict(durableSnapshot(base.data), durableSnapshot(local), durableSnapshot(current.data), preference);
      assert.equal((await saveDiff(current.data, resolved, current.revision)).status, 200);
      const loaded = await state();
      assert.equal(loaded.data.articles[0].title, preference === "local" ? "本机标题" : "数据库标题");
      assert.equal(loaded.data.articles[0].style, "本机独立文风");
      assert.equal(loaded.data.articles[0].summary, "数据库独立简介");
      assert.ok(isStudioChangesEmpty(diffStudioData(durableSnapshot(loaded.data), durableSnapshot(resolved))));
      assert.equal((await write("/api/state", { data: loaded.data }, loaded.revision, "PUT")).status, 200);
      assert.equal((await state()).revision, loaded.revision);
    });
  }
});
