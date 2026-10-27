import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiSettings, inheritAiSettings, overrideAiSettings, aiSettingKeys } from "../lib/ai-settings-inheritance.ts";
import { normalizeAiGenerateOptions } from "../lib/generate-options.ts";
import { normalizeIllustrationOptions } from "../lib/illustration-options.ts";
import { normalizeChapterSettings } from "../lib/story-settings.ts";
import { taskNamingProfile, taskReviewSnapshot } from "../lib/task-parameters.ts";

function fixture() {
  return { aiGenerateSettings: normalizeAiGenerateOptions({ targetWords: 5100, advanced: { additional: "文章" }, tasks: { preparationMaxRounds: 2, chatModel: "article-chat" } }), illustrationSettings: normalizeIllustrationOptions({ additionalPrompt: "文章图片" }), chapters: [
    { id: "c1", title: "第一章", archived: false, settings: normalizeChapterSettings({ aiTasks: { generate: { targetWords: 6200, tasks: { preparationMaxRounds: 4, chatModel: "chapter-chat", outlineNaming_style: "poetic" } }, illustration: { additionalPrompt: "章节图片" } } }), outlines: [{ id: "a", title: "前一项", archived: false, generateOptions: normalizeAiGenerateOptions({ targetWords: 7300, advanced: { additional: "大纲" }, tasks: { preparationMaxRounds: 5, reviewMaxRounds: 3, namingModel: "name-model", namingModelMode: "fixed", chatModel: "outline-chat" } }) }, { id: "b", title: "当前项", archived: false, generateOptions: null }] },
    { id: "archived", title: "归档章", archived: true, settings: normalizeChapterSettings({ aiTasks: { generate: { targetWords: 9900 } } }), outlines: [] },
    { id: "c2", title: "第二章", archived: false, outlines: [{ id: "c", title: "首项", archived: false, generateOptions: null }] },
  ] };
}

test("closing length inheritance migrates legacy switches and follows later article changes", () => {
  const article = fixture();
  article.aiGenerateSettings = normalizeAiGenerateOptions({ closingSummaryLength: "long" });
  article.chapters[0].outlines[1].generateOptions = { includeClosingSummary: false, inheritance: { includeClosingSummary: "article" } };
  let value = resolveAiSettings(article, "b", "generate").value;
  assert.equal(value.closingSummaryLength, "auto");
  assert.equal(value.includeClosingSummary, true);
  article.aiGenerateSettings.closingSummaryLength = "medium";
  value = resolveAiSettings(article, "b", "generate").value;
  assert.equal(value.closingSummaryLength, "medium");
  article.chapters[0].outlines[1].generateOptions = overrideAiSettings(value, { closingSummaryLength: "none" });
  value = resolveAiSettings(article, "b", "generate").value;
  assert.equal(value.closingSummaryLength, "none");
  assert.equal(value.includeClosingSummary, false);
});

test("each setting follows the previous outline, then previous chapter, then article", () => {
  const article = fixture();
  let resolved = resolveAiSettings(article, "b", "generate");
  article.chapters[0].outlines[1].generateOptions = inheritAiSettings(resolved.value, "previous", resolved.previous, aiSettingKeys("generate"));
  resolved = resolveAiSettings(article, "b", "generate");
  assert.equal(resolved.value.targetWords, 7300);
  assert.equal(resolved.value.tasks.chatModel, "outline-chat");
  assert.equal(resolved.value.tasks.preparationMaxRounds, 5);
  assert.equal(resolved.value.tasks.reviewMaxRounds, 3);
  assert.equal(resolved.value.advanced.additional, "大纲");
  resolved = resolveAiSettings(article, "c", "generate");
  assert.match(resolved.previousLabel, /第一章/);
  assert.equal(resolved.previous.targetWords, 6200);
  assert.equal(resolved.previous.tasks.chatModel, "chapter-chat");
  assert.equal(taskNamingProfile(resolved.previous.tasks, "outlineNaming").style, "poetic");
  resolved = resolveAiSettings(article, "a", "generate");
  assert.equal(resolved.previousLabel, "文章默认");
  assert.equal(resolved.previous.targetWords, 5100);
});

test("restoring one item bypasses earlier overrides and live inheritance survives normalization", () => {
  const article = fixture();
  const resolved = resolveAiSettings(article, "b", "generate");
  const inherited = inheritAiSettings(resolved.value, "previous", resolved.previous, ["targetWords", "advanced.additional", "tasks.chatModel"]);
  article.chapters[0].outlines[1].generateOptions = normalizeAiGenerateOptions(inherited);
  article.chapters[0].outlines[0].generateOptions.targetWords = 8400;
  assert.equal(resolveAiSettings(article, "b", "generate").value.targetWords, 8400);
  const restored = inheritAiSettings(inherited, "article", resolved.articleDefaults, ["targetWords"]);
  article.chapters[0].outlines[1].generateOptions = restored;
  assert.equal(resolveAiSettings(article, "b", "generate").value.targetWords, 5100);
  assert.equal(resolveAiSettings(article, "b", "generate").value.advanced.additional, "大纲");
  article.aiGenerateSettings.targetWords = 5600;
  assert.equal(resolveAiSettings(article, "b", "generate").value.targetWords, 5600);
  const edited = overrideAiSettings(restored, { advanced: { ...restored.advanced, additional: "手动" } });
  assert.equal(edited.inheritance["advanced.additional"], undefined);
  assert.equal(edited.inheritance["tasks.chatModel"], "previous");
});

test("archive and reordering recalculate the source without reading future nodes", () => {
  const article = fixture();
  article.chapters[0].outlines[0].archived = true;
  assert.equal(resolveAiSettings(article, "b", "generate").previous.targetWords, 5100);
  article.chapters[0].outlines.reverse();
  assert.equal(resolveAiSettings(article, "b", "generate").previousLabel, "文章默认");
  article.chapters.reverse();
  assert.equal(resolveAiSettings(article, "c", "generate").previous.targetWords, 5100);
});

test("illustration inheritance preserves intentional empty values and chapter data", () => {
  const article = fixture();
  const resolved = resolveAiSettings(article, "c", "illustration");
  article.chapters[2].outlines[0].illustrationOptions = normalizeIllustrationOptions(inheritAiSettings(resolved.value, "previous", resolved.previous, ["additionalPrompt"]));
  assert.equal(resolveAiSettings(article, "c", "illustration").value.additionalPrompt, "章节图片");
  article.chapters[0].settings.aiTasks.illustration.additionalPrompt = "";
  assert.equal(resolveAiSettings(article, "c", "illustration").value.additionalPrompt, "");
  assert.equal(normalizeChapterSettings(JSON.parse(JSON.stringify(article.chapters[0].settings))).aiTasks.generate.tasks.preparationMaxRounds, 4);
});

test("legacy articles follow global workflow settings until explicitly overridden", () => {
  const article = fixture(); delete article.aiGenerateSettings.tasks;
  const value = resolveAiSettings(article, "a", "generate", "outline", { preparationMaxRounds: 1, generateReviewMaxRounds: 6, chatReasoningEffort: null }).articleDefaults;
  assert.equal(value.tasks.preparationMaxRounds, 1);
  assert.equal(value.tasks.reviewMaxRounds, 6);
  assert.equal(value.tasks.chatReasoningEffort, "__omit__");
  const normalized = normalizeAiGenerateOptions({ inheritance: { "tasks.preparationMaxRounds": "previous", "tasks.unknown": "previous", targetWords: "invalid" } });
  assert.deepEqual(normalized.inheritance, { "tasks.preparationMaxRounds": "previous" });
});

test("scoped review rules support article rules, explicit replacement, and intentional disabling", () => {
  const article = { id: "article", createdAt: "2026-10-22T00:00:00Z", reviewRules: "保持事实一致" };
  assert.ok(taskReviewSnapshot(article, { reviewRules: "__article_rules__" }, "").rules.length > 0);
  assert.deepEqual(taskReviewSnapshot(article, { reviewRules: "" }, "" ).rules, []);
  assert.equal(taskReviewSnapshot(article, { reviewRules: "仅检查对白" }, "本次检查").rules[0].content, "仅检查对白");
});
