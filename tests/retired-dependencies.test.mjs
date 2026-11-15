import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import { fullStudioFixture } from "./fixtures.mjs";
import { normalizeChapterSettings, resolveChapterSettings, migrateArticleStoryDetails } from "../lib/story-settings.ts";
import { normalizeStudioData } from "../lib/studio-normalization.ts";
import { globalAiSettings, resolveAiSettings, writingDefaults, overrideAiSettings } from "../lib/ai-settings-inheritance.ts";
import { normalizeAiGenerateOptions } from "../lib/generate-options.ts";
import { normalizeStyleLibrary, configurationOf } from "../lib/style-learning.ts";
import { selectAiContext } from "../lib/ai-context.ts";
import { EMPTY_PHOTO_DRAFT } from "../lib/character-photos.ts";
import { duplicateArticlesForImport } from "../lib/data-transfer.ts";
import { taskNamingProfile } from "../lib/task-parameters.ts";

test("retired scoped facts retain independent lifetimes and survive round trips and copies", () => {
  const article = fullStudioFixture().articles[0];
  article.chapters[0].settings = normalizeChapterSettings({ story: { era: { value: "旧时代", scope: "ongoing" }, tone: { value: "本章语调", scope: "chapter" } }, characters: { "character-lin": { start: { identity: { value: "本章身份", scope: "chapter" }, knownInformation: { value: "持续知情", scope: "ongoing" } }, end: { mentalState: "章末心理" } } } });
  article.chapters.push({ id: "next", title: "下一章", archived: false, outlines: [] });
  const current = resolveChapterSettings(article, "chapter-main"), next = resolveChapterSettings(article, "next");
  assert.match(current.story.summary, /旧时代/); assert.match(current.story.style, /本章语调/);
  assert.match(current.characters[0].description, /本章身份/);
  assert.doesNotMatch(next.story.style, /本章语调/); assert.doesNotMatch(next.characters[0].description, /本章身份/);
  assert.match(next.characters[0].description, /持续知情/); assert.match(next.characters[0].description, /章末心理/);
  assert.match(current.characters[0].endingChanges.description, /章末心理/);
  assert.deepEqual(normalizeChapterSettings(JSON.parse(JSON.stringify(article.chapters[0].settings))), article.chapters[0].settings);
  const copied = duplicateArticlesForImport([article], []).articles[0];
  assert.ok(copied.chapters[0].settings.legacy.characters[copied.characters[0].id]);
  assert.match(resolveChapterSettings(copied, copied.chapters.at(-1).id).characters[0].description, /章末心理/);
});

test("old article tone moves into visible metadata without duplication", () => {
  const data = fullStudioFixture(); data.articles[0].storySettings = { tone: "旧语调" };
  const once = normalizeStudioData(data), twice = normalizeStudioData(once);
  assert.match(once.articles[0].summary, /语调：旧语调/);
  assert.equal(once.articles[0].summary, twice.articles[0].summary);
  assert.match(migrateArticleStoryDetails("", "", { tone: "语调" }).summary, /语调/);
});

test("only applied learning contributes article expression and outline overrides remain authoritative", () => {
  const data = fullStudioFixture(), article = data.articles[0];
  data.settings.aiGenerateSettings = { proseControls: { dialogueDensity: "low" }, advanced: { additional: "全局" } };
  article.aiGenerateSettings = normalizeAiGenerateOptions({ model: "retired", proseControls: { dialogueDensity: "high" }, advanced: { additional: "隐藏旧值" } });
  assert.equal(writingDefaults(article, data.settings).proseControls.dialogueDensity, "low");
  article.storySettings = { styleLibrary: normalizeStyleLibrary({ expression: { proseControls: { dialogueDensity: "high" }, advanced: { additional: "已应用学习" } } }) };
  const learned = resolveAiSettings(article, "outline-previous", "generate", "outline", data.settings).value;
  assert.equal(learned.proseControls.dialogueDensity, "high"); assert.equal(learned.advanced.additional, "已应用学习");
  article.chapters[0].outlines[0].generateOptions = overrideAiSettings(learned, { proseControls: { ...learned.proseControls, dialogueDensity: "balanced" } });
  assert.equal(resolveAiSettings(article, "outline-previous", "generate", "outline", data.settings).value.proseControls.dialogueDensity, "balanced");
  assert.equal(configurationOf(article, data.settings).generate.proseControls.dialogueDensity, "high");
  article.chapters[0].settings = normalizeChapterSettings({ aiTasks: { generate: { model: "retired-chapter" } } });
  assert.notEqual(resolveAiSettings(article, "chapter-main", "generate", "chapter", data.settings).value.model, "retired-chapter");
});

const base = process.env.WRITER_STUDIO_TEST_BASE_URL;
test("current defaults govern learning, photos, generation and full-state writes", { skip: !base, timeout: 30000 }, async () => {
  const calls = [];
  const fake = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    if (request.method === "GET") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ data: [] })); return; }
    calls.push(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ choices: [{ message: { content: "模拟正文" }, finish_reason: "stop" }] }));
  });
  fake.listen(0, "127.0.0.1"); await once(fake, "listening");
  async function api(path, body, method = body === undefined ? "GET" : "POST", headers = {}) {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text(); const result = raw ? JSON.parse(raw) : null;
    assert.ok(response.ok, `${path}: ${JSON.stringify(result)}`); return result;
  }
  const before = await api("/api/state"); let provider; const createdModels = [];
  async function save(data) { const current = await api("/api/state"); return api("/api/state", { data }, "PUT", { "If-Match": String(current.revision) }); }
  try {
    provider = await api("/api/providers", { name: "Retired dependency regression", baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, secret: "mock-key" });
    const model = await api("/api/models", { providerId: provider.id, name: "Current writer", modelId: "mock", maxInputCharacters: 120000 });
    createdModels.push(model.id);
    const data = fullStudioFixture(), article = data.articles[0];
    data.settings.generateModel = model.id; data.settings.generateReviewMaxRounds = 0;
    data.settings.aiGenerateSettings = { proseControls: { dialogueDensity: "low" }, advanced: { additional: "VISIBLE_GLOBAL" } };
    data.settings.illustrationSettings = { stylePreset: "watercolor" };
    article.aiGenerateSettings = normalizeAiGenerateOptions({ model: "retired-model", advanced: { additional: "RETIRED_HIDDEN" }, tasks: { reviewMaxRounds: 1, reviewModelMode: "fixed", reviewModel: "retired-review" } });
    article.illustrationSettings = { stylePreset: "anime" };
    article.storySettings = { styleLibrary: normalizeStyleLibrary({ references: [{ id: "reference", title: "参考", text: "两位朋友核对书籍后道别。" }], expression: { proseControls: { dialogueDensity: "high" }, advanced: { dialogue: "APPLIED_LEARNING" } } }) };
    await save(data);
    const job = (await api("/api/style-lab", { articleId: article.id, kind: "learn" })).job;
    assert.equal(job.model, model.id); assert.equal(job.payload.reviewRounds, 0);
    await api(`/api/style-lab/${job.id}`, { action: "stop" });
    const options = resolveAiSettings(article, "outline-current", "generate", "outline", data.settings).value;
    await api("/api/ai/generate", { outlineId: "outline-current", target: "content", model: model.id, advanced: options.advanced, proseControls: options.proseControls, context: selectAiContext(data, "outline-current", "content", {}) });
    const prompt = calls.at(-1).messages.map(item => item.content).join("\n");
    assert.match(prompt, /APPLIED_LEARNING/); assert.match(prompt, /dialogue_density level="high"/); assert.doesNotMatch(prompt, /RETIRED_HIDDEN/);
    const image = (await api("/api/models/bulk", { providerId: provider.id, modelIds: ["portrait"], metadataByModelId: { portrait: { source: "manual", inputModalities: ["text"], outputModalities: ["image"] } } })).models[0];
    createdModels.push(image.id);
    const photos = await api("/api/ai/character-photos", { action: "generate", characterId: "character-lin", requestId: crypto.randomUUID(), draft: { ...EMPTY_PHOTO_DRAFT, prompt: "模拟照片", modelId: image.id } });
    assert.equal(photos.jobs[0].snapshot.stylePreset, globalAiSettings("illustration", data.settings).stylePreset);
    article.chapters[0].outlines[1].generateOptions = { includePrevious: false }; await save(data);
    const saved = (await api("/api/state")).data.articles[0].chapters[0].outlines[1].generateOptions;
    assert.notEqual(saved.model, "retired-model");
    const parameters = globalAiSettings("generate", { outlineNaming_format: "seven" }).tasks;
    const profile = taskNamingProfile(parameters, "outlineNaming");
    assert.equal(profile.format, "seven");
  } finally {
    try {
      await save(before.data);
      for (const id of createdModels) await api(`/api/models/${id}`, undefined, "DELETE");
      if (provider) await api(`/api/providers/${provider.id}`, undefined, "DELETE");
    } finally { fake.closeAllConnections(); await new Promise(resolve => fake.close(resolve)); }
  }
});
