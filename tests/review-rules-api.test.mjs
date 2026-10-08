import assert from "node:assert/strict";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";
import { reviewModelServer } from "./review-model.mjs";
import { createReviewRuleSnapshot, DEFAULT_REVIEW_RULES } from "../lib/review-rules.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
async function request(path, method = "GET", data, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: response.status, body: await response.json() };
}
async function api(...args) { const result = await request(...args); assert.ok(result.status < 300, JSON.stringify(result)); return result.body; }
async function reset() {
  const current = await api("/api/state");
  const data = fullStudioFixture();
  data.tasks = [];
  data.articles[0].reviewRules = "迁移时保留这一整段。\n包括第二行。";
  const chapter = data.articles[0].chapters[0];
  chapter.outlines = chapter.outlines.filter((outline) => outline.id === "outline-current");
  chapter.outlines[0].content = "她十七岁。\n\n窗外的雨停了。";
  chapter.outlines[0].currentVersionId = null;
  chapter.outlines[0].settings = {
    story: {
      location: { value: "潮汐观测室", scope: "chapter" },
      negativeConstraints: { value: "", scope: "chapter" },
    },
    characters: { "character-lin": { start: { age: { value: "十八岁", scope: "chapter" } }, end: {} } },
    relationships: {},
  };
  await api("/api/state", "PUT", { data }, { "If-Match": String(current.revision) });
  return (await api("/api/state")).data.articles[0];
}
async function saveRules(items) {
  const state = await api("/api/state");
  await api("/api/articles/article-main", "PATCH", { reviewRuleItems: items }, { "If-Match": String(state.revision) });
}
async function waitUntil(operation) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) { const result = await operation(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error("Timed out waiting for review task");
}
async function waitTask(id) { return waitUntil(async () => { const task = (await api("/api/ai/tasks")).tasks.find((item) => item.id === id); return task && ["success", "failed", "cancelled"].includes(task.state) ? task : null; }); }

test("article rules persist and both review paths use only frozen effective rules", async (t) => {
  const fake = await reviewModelServer();
  try {
    const provider = await api("/api/providers", "POST", { name: "Rule snapshots", baseUrl: fake.baseUrl, secret: "fake-rule-key" });
    const model = await api("/api/models", "POST", { providerId: provider.id, name: "Rule snapshots", modelId: "rule-snapshots", maxInputCharacters: 120000 });
    const chapterBody = { articleId: "article-main", chapterId: "chapter-main", model: model.id };
    const generateBody = { ...chapterBody, outlineId: "outline-current", target: "content", reviewMaxRounds: 2, instruction: "写一个短场景" };

    await t.test("legacy rules migrate once; CRUD, archive and empty collections survive reload", async () => {
      const article = await reset();
      assert.equal(article.reviewRuleItems.length, DEFAULT_REVIEW_RULES.length + 1);
      assert.equal(article.reviewRuleItems.at(-1).content, article.reviewRules);
      const rule = { ...article.reviewRuleItems[0], title: "允许英文对白", content: "保留所有英文对白", revision: 2 };
      await saveRules([rule]);
      assert.deepEqual((await api("/api/state")).data.articles[0].reviewRuleItems, [rule]);
      await saveRules([{ ...rule, archived: true }]);
      assert.equal((await request("/api/ai/review", "POST", chapterBody)).status, 422);
      await saveRules([rule]);
      assert.equal((await api("/api/state")).data.articles[0].reviewRuleItems[0].archived, false);
      await saveRules([]);
      assert.deepEqual((await api("/api/state")).data.articles[0].reviewRuleItems, []);
      assert.equal((await request("/api/ai/tasks", "POST", generateBody, { "Idempotency-Key": `empty-${crypto.randomUUID()}` })).status, 422);
    });

    await t.test("chapter review uses edited defaults and stores their snapshot despite changes during the request", async () => {
      const article = await reset();
      const rule = { ...article.reviewRuleItems[0], title: "人物年龄", content: "只检查人物年龄为十八岁；保留所有英文对白。", revision: 2 };
      await saveRules([rule]); fake.control.calls = [];
      let release;
      fake.control.gate = new Promise((resolve) => { release = resolve; });
      const pending = api("/api/ai/review", "POST", chapterBody);
      try {
        await waitUntil(() => fake.control.calls.length);
        await saveRules([]);
      } finally { release(); fake.control.gate = null; }
      const result = await pending;
      assert.equal(result.updated.length, 1);
      const messages = fake.control.calls[0].body.messages;
      assert.match(messages.at(-1).content, /只检查人物年龄为十八岁/);
      assert.match(messages.at(-1).content, /<description>海港长大的冷静修理师。<\/description>/);
      assert.match(messages.at(-1).content, /<outline_settings>/);
      assert.match(messages.at(-1).content, /<location>潮汐观测室<\/location>/);
      assert.match(messages.at(-1).content, /<age>十八岁<\/age>/);
      for (const emptyOrRemovedTag of ["type", "era", "tone", "world_rules", "negative_constraints", "appearance", "character_boundaries"]) {
        assert.doesNotMatch(messages.at(-1).content, new RegExp(`<${emptyOrRemovedTag}>`), `Review 不应发送空值或已移除设定：${emptyOrRemovedTag}`);
      }
      assert.doesNotMatch(JSON.stringify(messages), /修正中文正文中无必要|跨全部正文识别重复|不新增、删除或改变情节事实/);
      const state = await api("/api/state");
      const version = state.data.articles[0].chapters[0].outlines[0].versions.find((item) => item.id === result.updated[0].versionId);
      assert.deepEqual(version.reviewRuleSnapshot.rules, [{ id: rule.id, title: rule.title, content: rule.content, revision: 2 }]);
      assert.match(version.prompt, /人物年龄/);
      assert.deepEqual(state.data.articles[0].reviewRuleItems, []);
    });

    await t.test("generation, revision and verification retain the creation snapshot after rules are deleted", async () => {
      const article = await reset();
      const rule = { ...article.reviewRuleItems[0], title: "人物年龄", content: "唯一文章规则：人物必须十八岁。", revision: 3 };
      await saveRules([rule]); fake.control.calls = [];
      let release;
      fake.control.gate = new Promise((resolve) => { release = resolve; });
      let task;
      try {
        task = (await api("/api/ai/tasks", "POST", { ...generateBody, reviewInstruction: "本次保留雨景" }, { "Idempotency-Key": `rules-${crypto.randomUUID()}` })).data;
        await waitUntil(() => fake.control.calls.some((call) => call.kind === "review"));
        await saveRules([]);
      } finally { release(); fake.control.gate = null; }
      const completed = await waitTask(task.id);
      assert.equal(completed.state, "success", completed.error);
      assert.deepEqual(fake.control.calls.map((call) => call.kind), ["generate", "review", "revise", "review"]);
      for (const call of fake.control.calls.slice(1)) {
        const messages = JSON.stringify(call.body.messages);
        assert.match(messages, /唯一文章规则/);
        assert.match(messages, /本次保留雨景/);
        assert.doesNotMatch(messages, /修正中文正文中无必要|builtin_requirements/);
        assert.doesNotMatch(messages, /\\\"(?:summary|style|location|negativeConstraints|age|appearance|immutableTraits)\\\":\\\"\\\"/, "自动审校上下文不应序列化空设定");
      }
      const snapshot = completed.contextOptions.reviewRuleSnapshot;
      assert.equal(snapshot.rules[0].revision, 3);
      assert.deepEqual(completed.contextOptions.reviewReport.ruleSnapshot, snapshot);
      const version = (await api("/api/state")).data.articles[0].chapters[0].outlines[0].versions.find((item) => item.id === completed.resultVersionId);
      assert.deepEqual(version.reviewReport.ruleSnapshot, snapshot);
    });

    await t.test("a stale preview is rejected and an instruction alone works without restored defaults", async () => {
      const article = await reset();
      const stale = createReviewRuleSnapshot(article);
      await saveRules([]); fake.control.calls = [];
      assert.equal((await request("/api/ai/review", "POST", { ...chapterBody, ruleSnapshot: stale })).status, 409);
      assert.equal(fake.control.calls.length, 0);
      await api("/api/ai/review", "POST", { ...chapterBody, additionalRequirement: "本次仅修正年龄" });
      assert.match(fake.control.calls[0].body.messages.at(-1).content, /本次仅修正年龄/);
      assert.doesNotMatch(JSON.stringify(fake.control.calls[0].body.messages), /修正中文正文中无必要|重复场景描写/);
    });
  } finally { fake.close(); }
});
