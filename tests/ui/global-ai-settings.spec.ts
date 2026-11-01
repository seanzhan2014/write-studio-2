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
  for (const name of ["正文生成", "写作准备与讨论", "自动审校", "大纲", "聊天", "图片", "学习与微调", "全局"]) {
    await tabs.getByRole("tab", { name, exact: true }).click();
    await expect(tabs.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  }
  await tabs.getByRole("tab", { name: "图片", exact: true }).click();
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
  await page.getByRole("tab", { name: "写作准备与讨论", exact: true }).click();
  await page.getByLabel("写作前最多互动轮次", { exact: true }).fill("4");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.preparationMaxRounds).toBe(4);
  await openArticleAiSettings(page);
  await expect(page.getByLabel("文章生成默认目标字数", { exact: true })).toHaveValue("2,000 字");
  const workflow = page.locator(".article-ai-task-settings > .task-parameter-settings");
  await workflow.locator(":scope > summary").click();
  await workflow.getByText("写作准备与讨论", { exact: true }).click();
  await expect(workflow.getByLabel("写作前最多互动轮次", { exact: true })).toHaveValue("4");
  await page.locator(".article-ai-inheritance").first().locator("summary").click();
  await page.getByRole("button", { name: "目标字数恢复全局默认", exact: true }).click();
  await expect(page.getByLabel("文章生成默认目标字数", { exact: true })).toHaveValue("4,000 字");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].aiGenerateSettings.inheritance.targetWords).toBe("global");
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  await expect(page.getByLabel("正文目标字数", { exact: true })).toHaveValue("4,000 字");
});
