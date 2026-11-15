import { openGlobalAiSettings } from "./ai-task-settings-helper";
import { expect, test } from "@playwright/test";
import type { StudioData } from "../../app/studio-state";
import { fullStudioFixture } from "../fixtures.mjs";
import { reviewModelServer } from "../review-model.mjs";
import { STANDALONE_AI_REVIEW_ENABLED } from "../../lib/features.mjs";

test.beforeEach(async ({ request }) => {
  const current = await (await request.get("/api/state")).json();
  const data = fullStudioFixture() as unknown as StudioData;
  data.tasks = [];
  data.settings.reviewPresets = ["仅检查时间线，不修改环境描写。"];
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
});

test("article rules can edit defaults, add, archive, restore and delete without repopulating", async ({ page, request }) => {
  await page.goto("/articles/article-main/info/basic");
  await openGlobalAiSettings(page, "自动审校");
  const defaultRule = page.getByLabel("规则：不必要的中英文混用", { exact: true });
  await expect(defaultRule).toContainText("有意设计的英文对白");
  await defaultRule.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("规则名称", { exact: true }).fill("英文对白保留");
  await page.getByLabel("规则内容", { exact: true }).fill("保留所有英文对白，仅修正英文拼写。");
  await page.getByRole("button", { name: "保存规则", exact: true }).click();
  const edited = page.getByLabel("规则：英文对白保留", { exact: true });
  await expect(edited).toContainText("v2");
  await edited.getByRole("button", { name: "英文对白保留的更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await expect(edited).toHaveCount(0);
  await page.getByRole("button", { name: "已归档（1）", exact: true }).click();
  await edited.getByRole("button", { name: "英文对白保留的更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "恢复", exact: true }).click();
  await page.getByRole("button", { name: "生效中（6）", exact: true }).click();
  await expect(edited).toContainText("保留所有英文对白");
  await page.getByRole("button", { name: "新增规则", exact: true }).click();
  await page.getByLabel("规则名称", { exact: true }).fill("人称一致");
  await page.getByLabel("规则内容", { exact: true }).fill("全文使用第三人称。");
  await page.getByRole("button", { name: "保存规则", exact: true }).click();
  await expect(page.getByLabel("规则：人称一致", { exact: true })).toContainText("自定义");
  await edited.getByRole("button", { name: "英文对白保留的更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.reviewRuleItems.some((rule: { title: string }) => rule.title === "英文对白保留")).toBe(false);
  await page.reload();
  await page.getByRole("tab", { name: "自动审校", exact: true }).click();
  await expect(page.getByLabel("规则：人称一致", { exact: true })).toBeVisible();
  await expect(defaultRule).toHaveCount(0);
  await expect(edited).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test("legacy presets are optional imports and archived rules disappear from run previews", async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openGlobalAiSettings(page, "自动审校");
  await expect(page.getByRole("button", { name: "生效中（6）", exact: true })).toBeVisible();
  await expect(page.getByLabel("规则：场景表现与信息揭示", { exact: true })).toContainText("不机械隐藏梦境");
  await page.getByRole("button", { name: "导入原全局预设", exact: true }).click();
  await page.getByRole("checkbox", { name: "仅检查时间线，不修改环境描写。", exact: true }).check();
  await page.getByRole("button", { name: "导入选中规则", exact: true }).click();
  const imported = page.getByLabel("规则：仅检查时间线，不修改环境描写。", { exact: true });
  await expect(imported).toContainText("原全局预设");
  await imported.getByRole("button", { name: "仅检查时间线，不修改环境描写。的更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "归档", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.reviewRuleItems.find((rule: { origin: string }) => rule.origin === "preset")?.archived).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.goto("/articles/article-main/edit");
  if (!STANDALONE_AI_REVIEW_ENABLED) {
    await expect(page.getByRole("button", { name: "AI Review", exact: true })).toHaveCount(0);
    return;
  }
  await page.getByRole("button", { name: "AI Review", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("本次文章规则（6）");
  await expect(dialog).not.toContainText("仅检查时间线，不修改环境描写。");
  await expect(dialog.getByRole("link", { name: "管理规则", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test("chapter review applies edited rules to the displayed draft and saves their snapshot", async ({ page, request }) => {
  test.skip(!STANDALONE_AI_REVIEW_ENABLED, "Standalone chapter review is temporarily hidden");
  const fake = await reviewModelServer();
  try {
    const provider = await (await request.post("/api/providers", { data: { name: "Chapter UI", baseUrl: fake.baseUrl, secret: "fake-ui-review-key" } })).json();
    const model = await (await request.post("/api/models", { data: { providerId: provider.id, name: "Chapter UI", modelId: "chapter-ui", maxInputCharacters: 120000 } })).json();
    const current = await (await request.get("/api/state")).json();
    const data = current.data as StudioData;
    data.settings.reviewModel = model.id;
    const article = data.articles[0];
    const rule = { ...article.reviewRuleItems![0], title: "人物年龄", content: "人物必须十八岁，保留所有英文对白。", revision: 2 };
    article.reviewRuleItems = [rule];
    const chapter = article.chapters[0];
    chapter.outlines = chapter.outlines.filter((outline) => outline.id === "outline-current");
    chapter.outlines[0].content = "她十七岁。\n\n窗外的雨停了。";
    chapter.outlines[0].currentVersionId = null;
    expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
    await page.goto("/articles/article-main/edit");
    await page.getByLabel("正文：当前码头", { exact: true }).fill("她十七岁。\n\n窗外的雨停了，她关上窗。");
    await page.getByRole("button", { name: "AI Review", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("人物年龄 · v2");
    await dialog.getByLabel("本次附加要求", { exact: true }).fill("保留关窗动作");
    await dialog.getByRole("button", { name: "开始 AI Review", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("正文：当前码头", { exact: true })).toHaveValue("她十八岁。\n\n窗外的雨停了，她关上窗。");
    const saved = (await (await request.get("/api/state")).json()).data as StudioData;
    const outline = saved.articles[0].chapters[0].outlines[0];
    const version = outline.versions.find((item) => item.id === outline.currentVersionId)!;
    expect(version.reviewRuleSnapshot?.rules).toEqual([{ id: rule.id, title: rule.title, content: rule.content, revision: 2 }]);
    expect(version.reviewRuleSnapshot?.instruction).toBe("保留关窗动作");
    expect(JSON.stringify(fake.control.calls[0].body.messages)).not.toContain("修正中文正文中无必要");
  } finally { fake.close(); }
});
