import assert from "node:assert/strict";
import test from "node:test";
import { articleReviewRules, createReviewRuleSnapshot, hasReviewRules, normalizeReviewRuleItems, normalizeReviewRuleSnapshot, DEFAULT_REVIEW_RULES } from "../lib/review-rules.mjs";
import { mergeStudioConflict } from "../app/studio-conflict.mjs";

const article = () => ({ id: "article-a", createdAt: "2026-09-07T00:00:00.000Z", reviewRules: "保留雨景。\n对白简短。" });

test("legacy migration preserves prose and uses stable IDs on every device", () => {
  const source = article();
  const rules = articleReviewRules(source);
  assert.equal(rules.filter((rule) => rule.origin === "default").length, DEFAULT_REVIEW_RULES.length);
  assert.equal(rules.at(-1).content, source.reviewRules);
  assert.deepEqual(articleReviewRules(source), rules);
  assert.deepEqual(articleReviewRules({ ...source, reviewRuleItems: rules }), rules);
});

function previousDefaults() {
  return articleReviewRules(article()).filter((rule) => !rule.id.endsWith(":narrative-craft")).map((rule) => rule.id.endsWith(":story-consistency")
    ? { ...rule, content: "遵守生成要求、大纲和人物事实；不新增、删除或改变情节事实、人物关系和叙事顺序。" } : rule);
}

test("untouched defaults upgrade once with stable identities and preserve historical snapshots", () => {
  const oldRules = previousDefaults();
  const snapshot = normalizeReviewRuleSnapshot({ version: 1, rules: oldRules.map(({ id, title, content, revision }) => ({ id, title, content, revision })), instruction: "" });
  const upgraded = normalizeReviewRuleItems(oldRules, "article-a");
  const consistency = upgraded.find((rule) => rule.id.endsWith(":story-consistency"));
  assert.equal(consistency.revision, 2);
  assert.equal(consistency.updatedAt, oldRules.find((rule) => rule.id === consistency.id).updatedAt);
  assert.equal(upgraded.filter((rule) => rule.id.endsWith(":narrative-craft")).length, 1);
  assert.deepEqual(normalizeReviewRuleItems(upgraded, "article-a"), upgraded);
  assert.deepEqual(normalizeReviewRuleSnapshot(snapshot), snapshot);
  assert.equal(snapshot.rules.find((rule) => rule.id === consistency.id).revision, 1);
  const deleted = upgraded.filter((rule) => !rule.id.endsWith(":narrative-craft"));
  assert.deepEqual(normalizeReviewRuleItems(deleted, "article-a"), deleted);
});

test("default upgrades respect edits, archive, removed rules and intentionally empty lists", () => {
  for (const change of [
    (rules) => { rules[0].content = "保留英文对白"; rules[0].revision = 2; },
    (rules) => { rules[0].archived = true; },
    (rules) => { rules.shift(); },
  ]) {
    const rules = previousDefaults(); change(rules);
    const upgraded = normalizeReviewRuleItems(rules, "article-a");
    assert.equal(upgraded.some((rule) => rule.id.endsWith(":narrative-craft")), false);
    assert.deepEqual(upgraded.filter((rule) => !rule.id.endsWith(":story-consistency")), rules.filter((rule) => !rule.id.endsWith(":story-consistency")));
  }
  for (const change of [
    (rule) => { rule.content = "保留全部原叙事顺序"; rule.revision = 2; },
    (rule) => { rule.archived = true; },
    (rule) => { rule.origin = "custom"; },
  ]) {
    const rules = previousDefaults(); change(rules.find((rule) => rule.id.endsWith(":story-consistency")));
    assert.deepEqual(normalizeReviewRuleItems(rules, "article-a"), rules);
  }
  assert.deepEqual(normalizeReviewRuleItems([], "article-a"), []);
});

test("explicit deletion and archive never fall back to default or legacy rules", () => {
  const source = article();
  const empty = createReviewRuleSnapshot({ ...source, reviewRuleItems: [] });
  assert.deepEqual(empty.rules, []);
  assert.equal(hasReviewRules(empty), false);
  assert.equal(hasReviewRules(createReviewRuleSnapshot({ ...source, reviewRuleItems: [] }, "仅检查时间线")), true);
  const archived = articleReviewRules(source).map((rule) => ({ ...rule, archived: true }));
  assert.deepEqual(createReviewRuleSnapshot({ ...source, reviewRuleItems: archived }).rules, []);
});

test("snapshots preserve rule identity, edited content and revision after deletion", () => {
  const source = { ...article(), reviewRuleItems: articleReviewRules(article()) };
  source.reviewRuleItems[0].content = "保留所有英文对白";
  source.reviewRuleItems[0].revision = 2;
  const snapshot = createReviewRuleSnapshot(source, "本次保留较长对话");
  source.reviewRuleItems[0].content = "新要求";
  source.reviewRuleItems.length = 0;
  assert.equal(snapshot.rules[0].content, "保留所有英文对白");
  assert.equal(snapshot.rules[0].revision, 2);
  assert.equal(snapshot.instruction, "本次保留较长对话");
  assert.deepEqual(normalizeReviewRuleSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
});

test("invalid collections cannot silently turn into missing/default rules", () => {
  const rules = articleReviewRules(article());
  assert.throws(() => normalizeReviewRuleItems("[]", "article-a"), /列表/);
  assert.throws(() => normalizeReviewRuleItems([rules[0], rules[0]], "article-a"), /重复/);
  assert.throws(() => normalizeReviewRuleItems([{ ...rules[0], content: " " }], "article-a"), /不能为空/);
  assert.throws(() => normalizeReviewRuleItems([{ ...rules[0], revision: 0 }], "article-a"), /版本/);
});

test("offline edits to different rules merge independently; delete versus edit is a conflict", () => {
  const base = { articles: [{ ...article(), reviewRuleItems: articleReviewRules(article()) }], settings: {}, tasks: [] };
  const local = structuredClone(base), server = structuredClone(base);
  local.articles[0].reviewRuleItems[0].content = "本设备编辑";
  server.articles[0].reviewRuleItems[1].content = "另一设备编辑";
  const result = mergeStudioConflict(base, local, server);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.articles[0].reviewRuleItems[0].content, "本设备编辑");
  assert.equal(result.merged.articles[0].reviewRuleItems[1].content, "另一设备编辑");
  server.articles[0].reviewRuleItems.shift();
  const conflict = mergeStudioConflict(base, local, server);
  assert.equal(conflict.conflicts.length, 1);
  assert.match(conflict.conflicts[0].label, /Review 规则/);
});
