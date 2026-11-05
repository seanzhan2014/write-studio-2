import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";
import { createInheritedAiSettings } from "../../lib/ai-settings-inheritance";
import { openArticleAiSettings } from "./article-ai-settings-helper";

test.beforeEach(async ({ request }) => {
  const current = await (await request.get("/api/state")).json();
  const data = fullStudioFixture();
  data.tasks = [];
  data.articles[0].aiGenerateSettings = createInheritedAiSettings("generate");
  Object.assign(data.articles[0], { illustrationSettings: createInheritedAiSettings("illustration") });
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data, conflictResolution: "keep-local" } })).ok()).toBeTruthy();
});

test("global task categories replace the article tab and image prompt entry on desktop and mobile", async ({ page }, info) => {
  await page.goto("/settings/tasks");
  const navigation = page.getByRole("navigation", { name: "设置分类" });
  await expect(navigation.getByRole("button", { name: "AI提示", exact: true })).toHaveCount(0);
  const tabs = page.getByRole("tablist", { name: "AI 任务分类" });
  for (const name of ["正文生成", "写作准备", "自动审校", "大纲", "聊天", "图片", "学习与微调", "全局"]) {
    await tabs.getByRole("tab", { name, exact: true }).click();
    await expect(tabs.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  }
  await tabs.getByRole("tab", { name: "图片", exact: true }).click();
  await page.getByRole("tab", { name: "风格库", exact: true }).click();
  await expect(page.getByRole("region", { name: "图片风格管理" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("ai-task-images.png"), fullPage: true });
  await page.goto("/articles/article-main/info/basic");
  await expect(page.getByRole("tab", { name: "AI 任务设定", exact: true })).toHaveCount(0);
  await page.goto("/settings/prompts");
  await expect(page.getByRole("region", { name: "图片风格管理" })).toBeVisible();
});

test("global changes propagate across reloads while an article field override remains independent", async ({ page, request }) => {
  await page.goto("/settings/tasks");
  await page.getByLabel("文章生成默认目标字数", { exact: true }).fill("3000");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.generateTargetWords).toBe(3000);
  await openArticleAiSettings(page);
  await expect(page.getByLabel("文章生成默认目标字数", { exact: true })).toHaveValue("3,000 字");
  await page.getByLabel("文章生成默认目标字数", { exact: true }).fill("2000");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].aiGenerateSettings.inheritance.targetWords).toBeUndefined();
  await page.goto("/settings/tasks");
  await page.getByLabel("文章生成默认目标字数", { exact: true }).fill("4000");
  await page.getByRole("tab", { name: "写作准备", exact: true }).click();
  await page.getByLabel("写作前最多互动轮次", { exact: true }).fill("4");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.preparationMaxRounds).toBe(4);
  await openArticleAiSettings(page);
  await expect(page.getByLabel("文章生成默认目标字数", { exact: true })).toHaveValue("2,000 字");
  const workflow = page.locator(".article-ai-task-settings > .task-parameter-settings");
  await workflow.locator(":scope > summary").click();
  await workflow.getByText("写作准备", { exact: true }).click();
  await expect(workflow.getByLabel("写作前最多互动轮次", { exact: true })).toHaveValue("4");
  await page.locator(".article-ai-inheritance").first().locator("summary").click();
  await page.getByRole("button", { name: "目标字数恢复全局默认", exact: true }).click();
  await expect(page.getByLabel("文章生成默认目标字数", { exact: true })).toHaveValue("4,000 字");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].aiGenerateSettings.inheritance.targetWords).toBe("global");
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  await expect(page.getByLabel("正文目标字数", { exact: true })).toHaveValue("4,000 字");
});

test("outline settings preserve conditional values and model inheritance when switching choices", async ({ page, request }) => {
  await page.goto("/settings/tasks");
  await page.getByRole("tab", { name: "大纲", exact: true }).click();
  const format = page.getByRole("combobox", { name: "章节名称格式", exact: true });
  await expect(page.getByLabel("章节最少字数", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "章节词牌", exact: true })).toHaveCount(0);
  await format.click();
  await page.getByRole("option", { name: "词牌风格", exact: true }).click();
  await expect(page.getByLabel("章节最少字数", { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "章节词牌", exact: true }).click();
  await page.getByRole("option", { name: "蝶恋花", exact: true }).click();
  await page.getByRole("combobox", { name: "章节语言风格", exact: true }).click();
  await page.getByRole("option", { name: "自定义", exact: true }).click();
  await page.getByLabel("章节自定义语言风格", { exact: true }).fill("短句，保持含蓄");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.chapterNaming_customStyle).toBe("短句，保持含蓄");
  await format.click();
  await page.getByRole("option", { name: "字数范围", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.chapterNaming_format).toBe("range");
  await page.reload();
  await page.getByRole("tab", { name: "大纲", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "命名模型", exact: true })).toHaveValue("跟随生成模型");
  await expect(page.getByLabel("章节自定义语言风格", { exact: true })).toHaveValue("短句，保持含蓄");
  await format.click();
  await page.getByRole("option", { name: "词牌风格", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "章节词牌", exact: true })).toHaveValue("蝶恋花");
});

test("the global preparation switch persists and disables inherited preparation controls", async ({ page, request }) => {
  await page.goto("/settings/tasks");
  await page.getByRole("tab", { name: "写作准备", exact: true }).click();
  const enabled = page.getByRole("checkbox", { name: "生成写作准备稿", exact: true });
  await expect(enabled).toBeChecked();
  await page.getByLabel("写作前最多互动轮次", { exact: true }).fill("2");
  await enabled.uncheck();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.preparationEnabled).toBe(false);
  await page.reload();
  await page.getByRole("tab", { name: "写作准备", exact: true }).click();
  await expect(enabled).not.toBeChecked();
  await expect(page.getByLabel("写作前最多互动轮次", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("写作前最多互动轮次", { exact: true })).toHaveValue("2");
  await openArticleAiSettings(page);
  const workflow = page.locator(".article-ai-task-settings > .task-parameter-settings");
  await workflow.locator(":scope > summary").click();
  await workflow.getByText("写作准备", { exact: true }).click();
  await expect(workflow.getByRole("checkbox", { name: "生成写作准备稿", exact: true })).not.toBeChecked();
  await expect(workflow.getByLabel("写作前最多互动轮次", { exact: true })).toBeDisabled();
  await workflow.getByRole("checkbox", { name: "生成写作准备稿", exact: true }).check();
  await expect(workflow.getByLabel("写作前最多互动轮次", { exact: true })).toBeEnabled();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].aiGenerateSettings.tasks.preparationEnabled).toBe(true);
  expect((await (await request.get("/api/state")).json()).data.settings.preparationEnabled).toBe(false);
});
