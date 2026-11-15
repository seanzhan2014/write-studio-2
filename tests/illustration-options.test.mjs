import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ILLUSTRATION_ADDITIONAL_PROMPT, normalizeIllustrationOptions, supportedIllustrationResolution } from "../lib/illustration-options.ts";
import { fullStudioFixture } from "./fixtures.mjs";

test("image settings normalize inherited values and preserve explicit model defaults", () => {
  assert.equal(normalizeIllustrationOptions().promptLanguage, "en");
  assert.equal(normalizeIllustrationOptions({ promptLanguage: "zh" }).promptLanguage, "en");
  const article = normalizeIllustrationOptions({ promptLanguage: "en", stylePreset: "ink", resolution: "2k", additionalPrompt: "保持人物一致" });
  assert.deepEqual(normalizeIllustrationOptions(undefined, article), article);
  assert.deepEqual(normalizeIllustrationOptions({ resolution: "" }, article), { ...article, resolution: "" });
  assert.deepEqual(normalizeIllustrationOptions({ promptLanguage: "bad", stylePreset: "bad", resolution: 4 }, article), article);
  assert.equal(normalizeIllustrationOptions({ additionalPrompt: "" }, article).additionalPrompt, "");
  assert.equal(normalizeIllustrationOptions({ additionalPrompt: 4 }, article).additionalPrompt, article.additionalPrompt);
  assert.equal(normalizeIllustrationOptions({ additionalPrompt: "长".repeat(9000) }).additionalPrompt.length, MAX_ILLUSTRATION_ADDITIONAL_PROMPT);
  assert.equal(supportedIllustrationResolution("2k", ["1K", "2K"]), "2K");
  assert.equal(supportedIllustrationResolution("4k", ["2K"]), "");
});

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
test("image presets and outline overrides survive snapshots, incremental saves and resets", { skip: !baseUrl }, async () => {
  async function api(path, body, method = body ? "POST" : "GET", headers = {}) {
    if (method === "PATCH") {
      const state = await (await fetch(`${baseUrl}/api/state`)).json();
      headers = { ...headers, "If-Match": String(state.revision) };
    }
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json();
    assert.ok(response.ok, JSON.stringify(payload));
    return payload;
  }
  const original = await api("/api/state");
  try {
    const data = fullStudioFixture();
    data.settings.illustrationSettings = { promptLanguage: "en", stylePreset: "ink", resolution: "2k", additionalPrompt: "无文字，无水印" };
    await api("/api/state", { data }, "PUT", { "If-Match": String(original.revision) });
    await api("/api/outlines/outline-current", { illustrationOptions: { stylePreset: "anime", resolution: "" } }, "PATCH");
    let state = await api("/api/state");
    let article = state.data.articles[0];
    let outline = article.chapters.flatMap(chapter => chapter.outlines).find(outline => outline.id === "outline-current");
    assert.equal(outline.illustrationOptions.stylePreset, "anime");
    assert.equal(outline.illustrationOptions.resolution, "");
    assert.equal(outline.illustrationOptions.additionalPrompt, "无文字，无水印");
    const { diffStudioData } = await import("./studio-test-runtime.mjs");
    const edited = structuredClone(state.data);
    const longPrompt = "\n\"\\\t\u0000".repeat(1500);
    edited.articles[0].chapters.flatMap(chapter => chapter.outlines).find(outline => outline.id === "outline-current").illustrationOptions.additionalPrompt = longPrompt;
    await api("/api/state/mutations", { changes: diffStudioData(state.data, edited) }, "POST", { "If-Match": String(state.revision) });
    state = await api("/api/state");
    assert.equal(state.data.articles[0].chapters.flatMap(chapter => chapter.outlines).find(outline => outline.id === "outline-current").illustrationOptions.additionalPrompt, longPrompt);
    await api("/api/articles/article-main", { illustrationSettings: { promptLanguage: "zh", stylePreset: "watercolor", resolution: "4k", additionalPrompt: "柔和光线" } }, "PATCH");
    state = await api("/api/state");
    article = state.data.articles[0];
    outline = article.chapters.flatMap(chapter => chapter.outlines).find(outline => outline.id === "outline-current");
    assert.deepEqual(article.illustrationSettings, { promptLanguage: "en", stylePreset: "watercolor", resolution: "4k", additionalPrompt: "柔和光线" });
    assert.equal(outline.illustrationOptions.stylePreset, "anime");
    assert.equal(outline.illustrationOptions.additionalPrompt, longPrompt);
    await api("/api/outlines/outline-current", { illustrationOptions: { additionalPrompt: "" } }, "PATCH");
    state = await api("/api/state");
    assert.equal(state.data.articles[0].chapters.flatMap(chapter => chapter.outlines).find(outline => outline.id === "outline-current").illustrationOptions.additionalPrompt, "");
    await api("/api/outlines/outline-current", { illustrationOptions: null }, "PATCH");
    state = await api("/api/state");
    assert.equal(state.data.articles[0].chapters.flatMap(chapter => chapter.outlines).find(outline => outline.id === "outline-current").illustrationOptions, null);
  } finally {
    const latest = await api("/api/state");
    await api("/api/state", { data: original.data }, "PUT", { "If-Match": String(latest.revision) });
  }
});
