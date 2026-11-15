import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }, { width: 390, height: 480 }]) {
  test(`retained historical settings remain editable at ${viewport.width}x${viewport.height}`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    const before = await (await request.get("/api/state")).json();
    const data = fullStudioFixture();
    Object.assign(data.articles[0].chapters[0], { settings: { story: { era: { value: "历史时代", scope: "ongoing" } }, characters: { "character-lin": { start: { identity: { value: "历史身份", scope: "chapter" } }, end: { mentalState: "历史章末" } } } } });
    expect((await request.put("/api/state", { headers: { "If-Match": String(before.revision) }, data: { data } })).ok()).toBeTruthy();
    await page.goto("/articles/article-main/outlines/edit-all");
    await page.locator(".continuous-chapter-heading .chapter-setting-trigger").first().click();
    const panel = page.getByRole("region", { name: "第一章章节设定", exact: true });
    await expect(panel.locator(".chapter-ai-settings")).toHaveCount(0);
    const history = panel.locator("details").filter({ has: page.locator(":scope > summary", { hasText: "历史设定" }) }).first();
    await history.locator(":scope > summary").click();
    await expect(history.getByLabel("时代背景", { exact: true })).toHaveValue("历史时代");
    await history.getByLabel("时代背景", { exact: true }).fill("修改后时代");
    await history.getByText("林澈", { exact: true }).click();
    const ending = history.getByLabel("章末心理状态", { exact: true });
    await ending.scrollIntoViewIfNeeded();
    await expect(ending).toHaveValue("历史章末");
    await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].chapters[0].settings.legacy.story.era.value).toBe("修改后时代");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  });
}

test("disabling last-article startup resets the root selection while direct links still work", async ({ page, request }) => {
  const before = await (await request.get("/api/state")).json();
  await request.put("/api/state", { headers: { "If-Match": String(before.revision) }, data: { data: fullStudioFixture() } });
  await page.goto("/articles/article-main/outlines/outline-after/write");
  await page.goto("/settings/general");
  await page.getByRole("switch", { name: "启动时打开上次文章", exact: true }).uncheck();
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "大纲标题", exact: true })).toHaveValue("前序灯塔");
  await page.goto("/articles/article-main/outlines/outline-after/write");
  await expect(page.getByRole("textbox", { name: "大纲标题", exact: true })).toHaveValue("绝密后续大纲");
});
