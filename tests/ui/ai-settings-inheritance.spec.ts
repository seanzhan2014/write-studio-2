import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";
import { preparationModelServer } from "../writing-preparation-model.mjs";
import type { StudioData } from "../../app/studio-state";
import { normalizeAiGenerateOptions } from "../../lib/generate-options";

test("AI parameter inheritance persists and controls real preparation tasks", async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const fake = await preparationModelServer();
  try {
    const provider = await (await request.post("/api/providers", { data: { name: "Inheritance", baseUrl: fake.baseUrl, secret: "fake-key" } })).json();
    const model = await (await request.post("/api/models", { data: { providerId: provider.id, name: "Inheritance", modelId: "inheritance", maxInputCharacters: 120000 } })).json();
    const current = await (await request.get("/api/state")).json();
    const data = fullStudioFixture() as unknown as StudioData;
    const article = data.articles[0];
    article.aiGenerateSettings = normalizeAiGenerateOptions({ ...article.aiGenerateSettings, model: model.id, tasks: { preparationMaxRounds: 2, preparationStrategy: "minimal", preparationRequireConfirmation: false, chatModel: "", reviewMaxRounds: 0 } });
    article.chapters[0].outlines[0].generateOptions = normalizeAiGenerateOptions({ ...article.aiGenerateSettings, targetWords: 7800, tasks: { preparationMaxRounds: 0, preparationStrategy: "explore", preparationRequireConfirmation: true, chatReasoningEffort: "high" } });
    expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data, conflictResolution: "keep-local" } })).ok()).toBeTruthy();
    await page.goto("/articles/article-main/outlines/outline-current/generate");
    const settings = page.locator(".generate-command-card > .task-parameter-settings");
    await settings.locator(":scope > summary").click();
    const discussion = settings.locator(".task-parameter-group").filter({ has: page.locator("summary", { hasText: "写作准备与讨论" }) });
    await discussion.locator(":scope > summary").click();
    for (const label of ["讨论策略", "写作前最多互动轮次", "准备稿无问题时仍需确认"]) await discussion.getByRole("group", { name: `${label}继承`, exact: true }).getByRole("button", { name: "继承上一项", exact: true }).click();
    await expect(discussion.getByLabel("写作前最多互动轮次", { exact: true })).toHaveValue("0");
    await expect(discussion.getByLabel("准备稿无问题时仍需确认", { exact: true })).toBeChecked();
    await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].chapters[0].outlines[1].generateOptions?.inheritance?.["tasks.preparationStrategy"]).toBe("previous");
    await page.reload();
    await settings.locator(":scope > summary").click();
    await discussion.locator(":scope > summary").click();
    await expect(discussion.getByLabel("讨论策略", { exact: true })).toHaveValue("最大探索型");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    const interaction = page.locator(".task-interaction.inline");
    await expect(interaction.getByRole("button", { name: "确认准备稿并写正文", exact: true })).toBeVisible();
    const state = await (await request.get("/api/state")).json();
    const task = state.data.tasks.find((task: { outlineId: string }) => task.outlineId === "outline-current");
    expect(task.contextOptions.writingPreparation).toMatchObject({ maxRounds: 0, strategy: "explore", requireConfirmation: true });
    expect(state.data.settings.preparationStrategy).toBe("minimal");
    await discussion.getByRole("group", { name: "讨论策略继承", exact: true }).getByRole("button", { name: "退回文章默认", exact: true }).click();
    await expect(discussion.getByLabel("讨论策略", { exact: true })).toHaveValue("最少条件型");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: `.test-data/inheritance-${info.project.name}.png`, fullPage: true });
  } finally { await fake.close(); }
});

test("article and chapter defaults expose all workflow parameter groups", async ({ page, request }) => {
  const state = await (await request.get("/api/state")).json();
  const data = fullStudioFixture() as unknown as StudioData;
  data.articles[0].chapters[0].settings = { story: {}, characters: {}, relationships: {}, aiTasks: { generate: normalizeAiGenerateOptions({ tasks: { preparationMaxRounds: 4, reviewMaxRounds: 2, chatReasoningEffort: "low", outlineNaming_style: "poetic" } }) } };
  expect((await request.put("/api/state", { headers: { "If-Match": String(state.revision) }, data: { data, conflictResolution: "keep-local" } })).ok()).toBeTruthy();
  await page.goto("/articles/article-main/info/ai-tasks");
  const settings = page.locator(".article-ai-task-settings > .task-parameter-settings");
  await settings.locator(":scope > summary").click();
  for (const group of ["写作准备与讨论", "自动审校", "命名", "聊天", "插图模型"]) await expect(settings.getByText(group, { exact: true })).toBeVisible();
  await settings.getByText("写作准备与讨论", { exact: true }).click();
  await settings.getByLabel("写作前最多互动轮次", { exact: true }).fill("1");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].aiGenerateSettings.tasks?.preparationMaxRounds).toBe(1);
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const scoped = page.locator(".generate-command-card > .task-parameter-settings");
  await scoped.locator(":scope > summary").click();
  await scoped.getByText("写作准备与讨论", { exact: true }).click();
  await expect(scoped.getByLabel("写作前最多互动轮次", { exact: true })).toHaveValue("4");
  await scoped.getByRole("group", { name: "写作前最多互动轮次继承", exact: true }).getByRole("button", { name: "退回文章默认", exact: true }).click();
  await expect(scoped.getByLabel("写作前最多互动轮次", { exact: true })).toHaveValue("1");
});
