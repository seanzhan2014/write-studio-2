import assert from "node:assert/strict";
import test from "node:test";
import { applyLocks, configurationFingerprint, normalizeConfiguration, normalizeStyleLibrary, restoreStyleGenerateSettings, textStatistics } from "../lib/style-learning.ts";
import { articleAiSettings, createInheritedAiSettings, overrideAiSettings } from "../lib/ai-settings-inheritance.ts";
import { normalizeAiGenerateOptions } from "../lib/generate-options.ts";
import { normalizeArticleStorySettings } from "../lib/story-settings.ts";

test("advanced preferences inherit per field, can explicitly clear, and ignore unknown keys", () => {
  const base = normalizeAiGenerateOptions({ advanced: { detailOrganization: "有意义的递进", additional: "保留特殊要求" } });
  const own = normalizeAiGenerateOptions({ advanced: { actionResponse: "即时交替", additional: "", invented: "禁止带入" } }, base);
  assert.equal(own.advanced.detailOrganization, "有意义的递进");
  assert.equal(own.advanced.additional, "");
  assert.equal(own.advanced.actionResponse, "即时交替");
  assert.equal(own.advanced.invented, undefined);
});
test("learning preserves locked text and operational model settings", () => {
  const base = normalizeConfiguration({ style: "原风格", advancedStyle: { additional: "人工要求" }, generate: { model: "chosen", contentMode: "continue", advanced: { narrator: "限知" } } });
  const candidate = normalizeConfiguration({ style: "新风格", advancedStyle: { additional: "模型改写" }, generate: { model: "different", advanced: { narrator: "全知" } } });
  const result = applyLocks(candidate, base, ["style.additional", "generate.narrator"]);
  assert.equal(result.style, "新风格"); assert.equal(result.advancedStyle.additional, "人工要求");
  assert.equal(result.generate.model, "chosen"); assert.equal(result.generate.contentMode, "continue"); assert.equal(result.generate.advanced.narrator, "限知");
});

test("restoring learned style restores live style inheritance and preserves later operational edits", () => {
  const article = { aiGenerateSettings: createInheritedAiSettings("generate"), chapters: [] };
  const before = articleAiSettings(article, "generate", { generateTargetWords: 4000 });
  let current = overrideAiSettings(before, { proseControls: { ...before.proseControls, dialogueDensity: "high" } });
  current = overrideAiSettings(current, { targetWords: 2000 });
  const restored = restoreStyleGenerateSettings(current, before);
  assert.equal(restored.targetWords, 2000);
  assert.equal(restored.inheritance.targetWords, undefined);
  assert.equal(restored.inheritance["proseControls.dialogueDensity"], "global");
  article.aiGenerateSettings = restored;
  const next = articleAiSettings(article, "generate", { aiGenerateSettings: { proseControls: { dialogueDensity: "low" } } });
  assert.equal(next.proseControls.dialogueDensity, "low");
  assert.equal(next.targetWords, 2000);
});
test("reference library, scene preferences and model versions survive article normalization", () => {
  const configuration = normalizeConfiguration({ style: "朴素", scenes: [{ name:"行动",when:"关键过程",instruction:"即时展开" }] });
  const library = normalizeStyleLibrary({ references:[{id:"ref",title:"样本",text:"参考正文"}], scenes:configuration.scenes, versions:[{id:"v",name:"版本",createdAt:"now",configuration}], calibrations:{ chosen:{id:"v",model:"chosen",baseFingerprint:configurationFingerprint(configuration),configuration} },locked:["style"] });
  const story = normalizeArticleStorySettings({ location:"甲地",negativeConstraints:"约束",advancedStyle:{voice:"冷静",additional:"附加"},styleLibrary:library });
  assert.equal(story.styleLibrary.references[0].text,"参考正文"); assert.equal(story.styleLibrary.scenes[0].instruction,"即时展开");
  assert.equal(story.styleLibrary.calibrations.chosen.configuration.style,"朴素"); assert.equal(story.advancedStyle.additional,"附加");
  assert.notEqual(configurationFingerprint(configuration),configurationFingerprint({...configuration,advancedStyle:{voice:"调侃"}}));
  assert.equal(textStatistics("第一句。\n第二句。").paragraphs,2);
});
