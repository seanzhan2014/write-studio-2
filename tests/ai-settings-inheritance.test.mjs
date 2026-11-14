import assert from "node:assert/strict";
import test from "node:test";
import { articleAiSettings, createInheritedAiSettings, globalAiSettings, resolveAiSettings, inheritAiSettings, overrideAiSettings, overrideGenerateSettings } from "../lib/ai-settings-inheritance.ts";
import { normalizeStudioSettings } from "../lib/studio-settings.ts";
import { serializeArticleSettings } from "../db/studio-serialization.ts";
import { DEFAULT_REWRITE_EXPRESSION, generateExpressionSettings, normalizeAiGenerateOptions } from "../lib/generate-options.ts";
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

test("the first outline ignores retired article and chapter values and follows live global defaults", () => {
  const article = fixture();
  article.chapters[0].outlines[0].generateOptions = null;
  const before = structuredClone(article);
  const settings = { generateModel: "global-model", generateTargetWords: 9000, aiGenerateSettings: { proseControls: { dialogueDensity: "high" }, includeOutlineTitle: true } };
  let value = resolveAiSettings(article, "a", "generate", "outline", settings).value;
  assert.equal(value.model, "global-model");
  assert.equal(value.targetWords, 9000);
  assert.equal(value.proseControls.dialogueDensity, "high");
  assert.equal(value.includeOutlineTitle, true);
  settings.generateTargetWords = 10000;
  value = resolveAiSettings(article, "b", "generate", "outline", settings).value;
  assert.equal(value.targetWords, 10000);
  assert.deepEqual(article, before);
});

test("legacy parent markers follow preceding outlines while zero and false overrides remain explicit", () => {
  const article = fixture();
  article.chapters[0].outlines[1].generateOptions = { targetWords: 0, includePrevious: false, model: "stale", inheritance: { model: "parent" } };
  article.chapters[0].outlines[0].generateOptions.model = "previous-model";
  let value = resolveAiSettings(article, "b", "generate").value;
  assert.equal(value.model, "previous-model");
  assert.equal(value.inheritance.model, "previous");
  assert.equal(value.targetWords, 0);
  assert.equal(value.includePrevious, false);
  article.chapters[0].outlines[1].generateOptions = normalizeAiGenerateOptions(value);
  article.chapters[0].outlines[0].generateOptions.model = "updated-model";
  value = resolveAiSettings(article, "b", "generate").value;
  assert.equal(value.model, "updated-model");
  assert.equal(value.tasks.chatModel, "outline-chat");
});

test("rewrite preferences inherit independently and mode switches retain both choices", () => {
  const article = fixture();
  article.chapters[0].settings = undefined;
  article.chapters[0].outlines[0].generateOptions = normalizeAiGenerateOptions({ proseControls: { dialogueDensity: "high" }, advanced: { psychology: "普通写作" }, closingSummaryLength: "medium" });
  let options = overrideGenerateSettings(resolveAiSettings(article, "b", "generate").value, { contentMode: "rewrite" });
  assert.deepEqual(generateExpressionSettings(options), DEFAULT_REWRITE_EXPRESSION);
  options = normalizeAiGenerateOptions(overrideGenerateSettings(options, { proseControls: { ...generateExpressionSettings(options).proseControls, dialogueDensity: "low" }, advanced: { dialogue: "改写专属" }, closingSummaryLength: "short" }));
  article.chapters[0].outlines[1].generateOptions = options;
  let resolved = resolveAiSettings(article, "b", "generate").value;
  assert.equal(generateExpressionSettings(resolved).proseControls.dialogueDensity, "low");
  assert.equal(generateExpressionSettings(resolved).closingSummaryLength, "short");
  assert.deepEqual(generateExpressionSettings(resolved).advanced, { dialogue: "改写专属" });
  const writing = overrideGenerateSettings(resolved, { contentMode: "fresh" });
  assert.equal(generateExpressionSettings(writing).proseControls.dialogueDensity, "high");
  assert.equal(generateExpressionSettings(writing).closingSummaryLength, "medium");
  assert.equal(generateExpressionSettings(writing).advanced.psychology, "普通写作");
  article.chapters[0].outlines[0].generateOptions.rewriteExpression.proseControls.narrativePace = "slow";
  resolved = resolveAiSettings(article, "b", "generate").value;
  assert.equal(generateExpressionSettings(resolved).proseControls.narrativePace, "slow");
  assert.equal(generateExpressionSettings(resolved).proseControls.dialogueDensity, "low");
});

test("legacy article inheritance markers follow live globals instead of retired article settings", () => {
  const article = fixture();
  article.aiGenerateSettings = normalizeAiGenerateOptions({ closingSummaryLength: "long" });
  article.chapters[0].outlines[1].generateOptions = { includeClosingSummary: false, inheritance: { includeClosingSummary: "article" } };
  const settings = { aiGenerateSettings: { closingSummaryLength: "long" } };
  let value = resolveAiSettings(article, "b", "generate", "outline", settings).value;
  assert.equal(value.closingSummaryLength, "auto");
  assert.equal(value.includeClosingSummary, true);
  assert.equal(value.inheritance.closingSummaryLength, "global");
  settings.aiGenerateSettings.closingSummaryLength = "medium";
  value = resolveAiSettings(article, "b", "generate", "outline", settings).value;
  assert.equal(value.closingSummaryLength, "medium");
  article.chapters[0].outlines[1].generateOptions = overrideAiSettings(value, { closingSummaryLength: "none" });
  value = resolveAiSettings(article, "b", "generate", "outline", settings).value;
  assert.equal(value.closingSummaryLength, "none");
  assert.equal(value.includeClosingSummary, false);
});

test("unset settings automatically follow the previous outline across chapters, then globals", () => {
  const article = fixture();
  let resolved = resolveAiSettings(article, "b", "generate");
  assert.equal(resolved.value.targetWords, 7300);
  assert.equal(resolved.value.tasks.chatModel, "outline-chat");
  assert.equal(resolved.value.tasks.preparationMaxRounds, 5);
  assert.equal(resolved.value.tasks.reviewMaxRounds, 3);
  assert.equal(resolved.value.advanced.additional, "大纲");
  resolved = resolveAiSettings(article, "c", "generate");
  assert.match(resolved.previousLabel, /当前项/);
  assert.equal(resolved.value.targetWords, 7300);
  assert.equal(resolved.previous.tasks.chatModel, "outline-chat");
  assert.notEqual(taskNamingProfile(resolved.previous.tasks, "outlineNaming").style, "poetic");
  resolved = resolveAiSettings(article, "a", "generate");
  assert.equal(resolved.previousLabel, "全局默认");
  assert.equal(resolved.previous.targetWords, 5000);
});

test("restoring one item bypasses earlier overrides and live inheritance survives normalization", () => {
  const article = fixture();
  const settings = { generateTargetWords: 9000 };
  const resolved = resolveAiSettings(article, "b", "generate", "outline", settings);
  const inherited = inheritAiSettings(resolved.value, "previous", resolved.previous, ["targetWords", "advanced.additional", "tasks.chatModel"]);
  article.chapters[0].outlines[1].generateOptions = normalizeAiGenerateOptions(inherited);
  article.chapters[0].outlines[0].generateOptions.targetWords = 8400;
  assert.equal(resolveAiSettings(article, "b", "generate").value.targetWords, 8400);
  const restored = inheritAiSettings(inherited, "global", resolved.globalDefaults, ["targetWords"]);
  article.chapters[0].outlines[1].generateOptions = restored;
  assert.equal(resolveAiSettings(article, "b", "generate", "outline", settings).value.targetWords, 9000);
  assert.equal(resolveAiSettings(article, "b", "generate").value.advanced.additional, "大纲");
  settings.generateTargetWords = 5600;
  assert.equal(resolveAiSettings(article, "b", "generate", "outline", settings).value.targetWords, 5600);
  const edited = overrideAiSettings(restored, { advanced: { ...restored.advanced, additional: "手动" } });
  assert.equal(edited.inheritance["advanced.additional"], undefined);
  assert.equal(edited.inheritance["tasks.chatModel"], "previous");
});

test("archive and reordering recalculate the source without reading future nodes", () => {
  const article = fixture();
  article.chapters[0].outlines[0].archived = true;
  assert.equal(resolveAiSettings(article, "b", "generate").previous.targetWords, 5000);
  article.chapters[0].outlines.reverse();
  assert.equal(resolveAiSettings(article, "b", "generate").previousLabel, "全局默认");
  article.chapters.reverse();
  assert.equal(resolveAiSettings(article, "c", "generate").previous.targetWords, 5000);
});

test("illustration inheritance follows outlines and preserves intentional empty values", () => {
  const article = fixture();
  article.chapters[0].outlines[0].illustrationOptions = normalizeIllustrationOptions({ additionalPrompt: "大纲图片" });
  const resolved = resolveAiSettings(article, "c", "illustration");
  article.chapters[2].outlines[0].illustrationOptions = normalizeIllustrationOptions(inheritAiSettings(resolved.value, "previous", resolved.previous, ["additionalPrompt"]));
  assert.equal(resolveAiSettings(article, "c", "illustration").value.additionalPrompt, "大纲图片");
  article.chapters[0].outlines[0].illustrationOptions.additionalPrompt = "";
  assert.equal(resolveAiSettings(article, "c", "illustration").value.additionalPrompt, "");
  assert.equal(normalizeChapterSettings(JSON.parse(JSON.stringify(article.chapters[0].settings))).aiTasks.generate.tasks.preparationMaxRounds, 4);
});

test("legacy articles follow global workflow settings until explicitly overridden", () => {
  const article = fixture(); delete article.aiGenerateSettings.tasks;
  const value = resolveAiSettings(article, "a", "generate", "outline", { preparationMaxRounds: 1, generateReviewMaxRounds: 6, chatReasoningEffort: null }).globalDefaults;
  assert.equal(value.tasks.preparationMaxRounds, 1);
  assert.equal(value.tasks.reviewMaxRounds, 6);
  assert.equal(value.tasks.chatReasoningEffort, "__omit__");
  const normalized = normalizeAiGenerateOptions({ inheritance: { "tasks.preparationMaxRounds": "previous", "tasks.unknown": "previous", targetWords: "invalid" } });
  assert.deepEqual(normalized.inheritance, { "tasks.preparationMaxRounds": "previous" });
});

test("preparation enablement follows global defaults and preserves a scoped override", () => {
  const article = fixture();
  const settings = { preparationEnabled: false };
  let resolved = resolveAiSettings(article, "b", "generate", "outline", settings);
  assert.equal(resolved.value.tasks.preparationEnabled, false);
  article.chapters[0].outlines[1].generateOptions = normalizeAiGenerateOptions(overrideAiSettings(resolved.value, { tasks: { ...resolved.value.tasks, preparationEnabled: true } }));
  assert.equal(resolveAiSettings(article, "b", "generate", "outline", settings).value.tasks.preparationEnabled, true);
  assert.equal(resolveAiSettings(article, "a", "generate", "outline", settings).value.tasks.preparationEnabled, false);
  article.chapters[0].outlines[1].generateOptions = inheritAiSettings(resolved.value, "global", resolved.globalDefaults, ["tasks.preparationEnabled"]);
  settings.preparationEnabled = true;
  resolved = resolveAiSettings(article, "b", "generate", "outline", settings);
  assert.equal(resolved.value.tasks.preparationEnabled, true);
  assert.equal(resolved.value.tasks.preparationMaxRounds, 5);
});

test("scoped review rules support article rules, explicit replacement, and intentional disabling", () => {
  const article = { id: "article", createdAt: "2026-10-22T00:00:00Z", reviewRules: "保持事实一致" };
  assert.ok(taskReviewSnapshot(article, { reviewRules: "__article_rules__" }, "").rules.length > 0);
  assert.deepEqual(taskReviewSnapshot(article, { reviewRules: "" }, "" ).rules, []);
  assert.equal(taskReviewSnapshot(article, { reviewRules: "仅检查对白" }, "本次检查").rules[0].content, "仅检查对白");
});

test("new articles follow live global values and changing one outline field preserves other inheritance", () => {
  const article = fixture();
  article.aiGenerateSettings = createInheritedAiSettings("generate");
  article.illustrationSettings = createInheritedAiSettings("illustration");
  article.chapters = [{ id: "c", title: "章", archived: false, outlines: [{ id: "o", title: "点", archived: false, generateOptions: null }] }];
  const settings = { generateModel: "global-model", generateTargetWords: 3000, preparationMaxRounds: 2, outlineNaming_style: "poetic", aiGenerateSettings: { proseControls: { dialogueDensity: "high" }, advanced: { additional: "全局要求" } }, illustrationSettings: { additionalPrompt: "全局图片" } };
  let resolved = resolveAiSettings(article, "o", "generate", "outline", settings);
  assert.equal(resolved.value.model, "global-model");
  assert.equal(resolved.value.tasks.outlineNaming_style, "poetic");
  assert.equal(resolved.value.proseControls.dialogueDensity, "high");
  article.chapters[0].outlines[0].generateOptions = normalizeAiGenerateOptions(overrideAiSettings(resolved.value, { targetWords: 2000 }));
  settings.generateTargetWords = 4000;
  settings.generateModel = "changed-model";
  settings.preparationMaxRounds = 4;
  resolved = resolveAiSettings(article, "o", "generate", "outline", settings);
  assert.equal(resolved.globalDefaults.targetWords, 4000);
  assert.equal(resolved.value.targetWords, 2000);
  assert.equal(resolved.value.model, "changed-model");
  assert.equal(resolved.value.tasks.preparationMaxRounds, 4);
  article.chapters[0].outlines[0].generateOptions = inheritAiSettings(resolved.value, "global", resolved.globalDefaults, ["targetWords"]);
  settings.generateTargetWords = 5000;
  assert.equal(resolveAiSettings(article, "o", "generate", "outline", settings).value.targetWords, 5000);
  assert.equal(resolveAiSettings(article, "o", "illustration", "outline", settings).value.additionalPrompt, "全局图片");
});

test("article overrides and explicit empty values survive serialization without freezing other global fields", () => {
  const article = fixture();
  article.aiGenerateSettings = createInheritedAiSettings("generate");
  article.illustrationSettings = createInheritedAiSettings("illustration");
  const settings = normalizeStudioSettings({ generateTargetWords: 4000, generateModel: "global", illustrationSettings: { additionalPrompt: "global" } });
  article.aiGenerateSettings = overrideAiSettings(articleAiSettings(article, "generate", settings), { targetWords: 0, includeCharacters: false });
  article.illustrationSettings = overrideAiSettings(articleAiSettings(article, "illustration", settings), { additionalPrompt: "" });
  const serialized = serializeArticleSettings(article);
  article.aiGenerateSettings = JSON.parse(serialized[3]);
  article.illustrationSettings = JSON.parse(serialized[4]);
  settings.generateModel = "new-model";
  assert.equal(articleAiSettings(article, "generate", settings).targetWords, 0);
  assert.equal(articleAiSettings(article, "generate", settings).includeCharacters, false);
  assert.equal(articleAiSettings(article, "generate", settings).model, "new-model");
  assert.equal(articleAiSettings(article, "illustration", settings).additionalPrompt, "");
  assert.equal(article.aiGenerateSettings.inheritance.model, "global");
});

test("global review rules are live until task creation and snapshots remain immutable", () => {
  const article = { ...fixture(), id: "article", aiGenerateSettings: createInheritedAiSettings("generate") };
  const settings = normalizeStudioSettings({});
  const tasks = articleAiSettings(article, "generate", settings).tasks;
  const before = taskReviewSnapshot(article, tasks, "", settings);
  settings.reviewRuleItems[0].content = "修改后的全局规则";
  const after = taskReviewSnapshot(article, tasks, "", settings);
  assert.notEqual(before.rules[0].content, after.rules[0].content);
  assert.equal(after.rules[0].content, "修改后的全局规则");
  settings.reviewRuleItems = [];
  assert.deepEqual(taskReviewSnapshot(article, tasks, "", settings).rules, []);
  assert.equal(globalAiSettings("generate", settings).tasks.reviewRules, "__global_rules__");
});

test("chapter task defaults do not override the preceding outline for later outlines", () => {
  const article = fixture();
  article.chapters[0].settings.aiTasks.generate.advanced.additional = "前章高级要求";
  article.chapters[2].settings = normalizeChapterSettings({ aiTasks: { generate: { targetWords: 6500 } } });
  assert.equal(resolveAiSettings(article, "c2", "generate", "chapter").value.advanced.additional, "大纲");
  delete article.chapters[2].settings.aiTasks.generate;
  const inherited = resolveAiSettings(article, "c2", "generate", "chapter").value;
  article.chapters[2].settings.aiTasks.generate = overrideAiSettings(inherited, { targetWords: 6500 });
  article.chapters[0].outlines[0].generateOptions.advanced.additional = "更新后的大纲要求";
  assert.equal(resolveAiSettings(article, "c", "generate").value.advanced.additional, "更新后的大纲要求");
});

test("editing a legacy article's review rules keeps all absent workflow fields attached to globals", () => {
  const article = { ...fixture(), aiGenerateSettings: normalizeAiGenerateOptions({ model: "article-model" }) };
  const global = { generateReviewMaxRounds: 0, reviewModelMode: "inherit", reviewModel: "" };
  const value = articleAiSettings(article, "generate", global);
  article.aiGenerateSettings = overrideAiSettings(value, { tasks: { ...value.tasks, reviewRules: "__article_rules__" } });
  global.generateReviewMaxRounds = 2;
  global.reviewModelMode = "fixed";
  global.reviewModel = "review-model";
  const next = articleAiSettings(article, "generate", global);
  assert.equal(next.tasks.reviewMaxRounds, 2);
  assert.equal(next.tasks.reviewModelMode, "fixed");
  assert.equal(next.tasks.reviewModel, "review-model");
  assert.equal(next.tasks.reviewRules, "__article_rules__");
  assert.equal(next.model, "article-model");
});

test("editing a legacy scoped record preserves absent task and advanced-field inheritance", () => {
  const article = fixture();
  const global = { generateReviewMaxRounds: 1 };
  let value = resolveAiSettings(article, "a", "generate", "outline", global).value;
  article.chapters[0].outlines[0].generateOptions = overrideAiSettings(value, { model: "outline-model" });
  global.aiGenerateSettings = { advanced: { narrator: "全局叙述要求" } };
  global.reviewModel = "new-review";
  value = resolveAiSettings(article, "a", "generate", "outline", global).value;
  assert.equal(value.model, "outline-model");
  assert.equal(value.tasks.preparationMaxRounds, 5);
  assert.equal(value.tasks.reviewModel, "new-review");
  assert.equal(value.advanced.narrator, "全局叙述要求");
});
