import { expect, test } from "@playwright/test";
import type { StudioData } from "../../app/studio-state";
import { fullStudioFixture } from "../fixtures.mjs";

test("generation edits, persists and restores inherited article information in the submitted context", async ({ page, request }, info) => {
  test.setTimeout(60_000);
  const current = await (await request.get("/api/state")).json();
  const data = fullStudioFixture() as unknown as StudioData;
  const article = data.articles[0];
  article.storySettings = { location: "文章中的海港", negativeConstraints: "不出现梦境" };
  article.chapters[0].settings = { story: { style: { value: "章节中的短句", scope: "chapter" } }, characters: {}, relationships: {} };
  article.chapters[0].outlines[0].settings = {
    story: { location: { value: "灯塔库房", scope: "ongoing" } },
    characters: { "character-lin": { start: {}, end: { age: "31 岁" } } },
    relationships: { "relationship-main": { end: "前序大纲中的暂时结盟" } },
  };
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data, conflictResolution: "keep-local" } })).ok()).toBeTruthy();
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const settings = page.getByRole("region", { name: "文章资料继承", exact: true });
  await expect(settings).toBeVisible();
  await expect(page.locator(".generate-command-card .task-parameter-settings")).toHaveCount(1);
  await settings.getByRole("button", { name: "查看继承内容 · 4", exact: true }).click();
  const location = settings.locator(".inherited-setting-field").filter({ has: page.getByLabel("故事发生地点", { exact: true }) });
  await expect(location).toContainText("来自前序灯塔");
  await expect(location.getByLabel("故事发生地点", { exact: true })).toHaveValue("灯塔库房");
  const style = settings.locator(".setting-collapsible").filter({ has: page.getByLabel("写作风格", { exact: true }) });
  await style.locator(":scope > summary").click();
  await expect(style.getByLabel("写作风格", { exact: true })).toHaveValue("章节中的短句");
  await expect(style).toContainText("来自第一章");
  await location.getByLabel("故事发生地点", { exact: true }).fill("生成页中的码头");
  await location.getByLabel("生效范围", { exact: true }).selectOption("chapter");

  await settings.getByRole("tab", { name: "人物", exact: true }).click();
  await settings.getByRole("button", { name: "查看继承内容 · 2", exact: true }).click();
  const character = settings.locator(".setting-entity").filter({ has: page.locator("summary strong", { hasText: "林澈" }) });
  await character.locator(":scope > summary").click();
  await expect(character.getByLabel("年龄", { exact: true })).toHaveValue("31 岁");
  await character.getByLabel("年龄", { exact: true }).fill("32 岁");

  await settings.getByRole("tab", { name: "关系", exact: true }).click();
  await settings.getByRole("button", { name: "查看继承内容 · 1", exact: true }).click();
  const relationship = settings.locator(".setting-entity");
  await relationship.locator(":scope > summary").click();
  await expect(relationship.getByLabel("大纲开始关系", { exact: true })).toHaveValue("前序大纲中的暂时结盟");
  await relationship.getByLabel("大纲开始关系", { exact: true }).fill("生成页中的共同调查");
  await expect.poll(async () => {
    const state = await (await request.get("/api/state")).json();
    return state.data.articles[0].chapters[0].outlines[1].settings;
  }).toMatchObject({
    story: { location: { value: "生成页中的码头", scope: "chapter" } },
    characters: { "character-lin": { start: { age: { value: "32 岁" } } } },
    relationships: { "relationship-main": { start: { value: "生成页中的共同调查" } } },
  });
  await page.reload();
  await expect(settings.getByLabel("故事发生地点", { exact: true })).toHaveValue("生成页中的码头");
  await location.getByRole("button", { name: "恢复继承", exact: true }).click();
  await settings.getByRole("button", { name: "查看继承内容 · 4", exact: true }).click();
  await expect(location.getByLabel("故事发生地点", { exact: true })).toHaveValue("灯塔库房");
  await expect(location).toContainText("来自前序灯塔");
  await settings.getByRole("tab", { name: "人物", exact: true }).click();
  await expect(character.getByLabel("年龄", { exact: true })).toHaveValue("32 岁");
  await character.getByRole("button", { name: "恢复继承", exact: true }).click();
  await settings.getByRole("button", { name: "查看继承内容 · 2", exact: true }).click();
  await character.locator(":scope > summary").click();
  await expect(character.getByLabel("年龄", { exact: true })).toHaveValue("31 岁");
  await settings.getByRole("tab", { name: "关系", exact: true }).click();
  await expect(relationship.getByLabel("大纲开始关系", { exact: true })).toHaveValue("生成页中的共同调查");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: `.test-data/generate-article-settings-${info.project.name}.png`, fullPage: true });

  const submitted = page.waitForRequest(req => req.url().endsWith("/api/ai/tasks") && req.method() === "POST");
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  const context = (await submitted).postDataJSON().promptContext;
  expect(context.article).toMatchObject({ location: "灯塔库房", style: "章节中的短句", negativeConstraints: "不出现梦境" });
  expect(context.characters.find((person: { id: string }) => person.id === "character-lin").profile.age).toBe("31 岁");
  expect(context.relationships[0].description).toBe("生成页中的共同调查");
});
