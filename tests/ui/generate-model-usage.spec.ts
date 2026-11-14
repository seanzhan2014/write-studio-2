import { expect, test } from "@playwright/test";
import type { StudioData } from "../../app/studio-state";
import { normalizeAiGenerateOptions } from "../../lib/generate-options";
import { fullStudioFixture } from "../fixtures.mjs";

test("generation models follow actual usage and remember their order after history is cleared", async ({ page, request }) => {
  test.setTimeout(60000);
  const models = ["A", "B", "C"].map((name) => ({ id: `recent-model-${name}`, name, providerName: "Recent", modelId: name, hasSecret: true, timeoutMs: 600000, maxInputCharacters: 60000 }));
  await page.route("**/api/models", (route) => route.fulfill({ json: { models } }));
  const current = await (await request.get("/api/state")).json();
  const data = fullStudioFixture() as unknown as StudioData;
  data.articles[0].aiGenerateSettings = normalizeAiGenerateOptions({ tasks: { preparationEnabled: false, reviewMaxRounds: 0 } });
  data.tasks = [
    { id: "older-model-use", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "正文", prompt: "older", model: "Recent-B", state: "success", executionOrigin: "local", createdAt: "2026-10-01T10:00:00Z", contextOptions: { configuredModelId: "recent-model-B", includePrevious: true, includeCharacters: true, estimatedCharacters: 0 } },
    { id: "newer-model-use", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-previous", target: "正文", prompt: "newer", model: "Recent-C", state: "success", executionOrigin: "local", createdAt: "2026-10-02T10:00:00Z", contextOptions: { configuredModelId: "recent-model-C", includePrevious: true, includeCharacters: true, estimatedCharacters: 0 } },
  ];
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const modelSelect = page.getByRole("combobox", { name: "本次模型", exact: true });
  await modelSelect.click();
  await expect(page.getByRole("option")).toHaveText(["Recent-C", "Recent-B", "本地演示引擎", "Recent-A"]);
  await page.getByRole("option", { name: "Recent-A", exact: true }).click();
  await modelSelect.click();
  await expect(page.getByRole("option")).toHaveText(["Recent-C", "Recent-B", "本地演示引擎", "Recent-A"]);
  await page.getByRole("option", { name: "本地演示引擎", exact: true }).click();
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await modelSelect.click();
  await expect(page.getByRole("option")).toHaveText(["本地演示引擎", "Recent-C", "Recent-B", "Recent-A"]);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await (await request.get("/api/ai/tasks")).json()).tasks[0]?.state, { timeout: 30000 }).toBe("success");
  await page.reload();
  await modelSelect.click();
  await expect(page.getByRole("option")).toHaveText(["本地演示引擎", "Recent-C", "Recent-B", "Recent-A"]);
  await page.keyboard.press("Escape");

  const latest = await (await request.get("/api/state")).json();
  latest.data.tasks = [];
  expect((await request.put("/api/state", { headers: { "If-Match": String(latest.revision) }, data: { data: latest.data } })).ok()).toBeTruthy();
  await page.reload();
  await modelSelect.click();
  await expect(page.getByRole("option")).toHaveText(["本地演示引擎", "Recent-C", "Recent-B", "Recent-A"]);
});
