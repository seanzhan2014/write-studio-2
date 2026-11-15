import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";
import type { StudioData } from "../../app/studio-state";

const candidateTitle = "退潮后的密钥";
const longCandidateTitle = "退潮后的密钥与雾港旧信揭示了当年失踪事件背后的另一条线索";

test.beforeEach(async ({ request }) => {
  const current = await (await request.get("/api/state")).json() as { revision: number };
  const fixture = fullStudioFixture();
  const outline = fixture.articles[0].chapters[0].outlines[1];
  outline.nameVersions = [
    { id: "name-ai-candidate", title: candidateTitle, source: "ai", createdAt: outline.updatedAt },
    { id: "name-current", title: outline.title, source: "manual", createdAt: outline.updatedAt },
    { id: "name-conflict", title: "前序灯塔", source: "ai", createdAt: outline.updatedAt },
    { id: "name-long", title: longCandidateTitle, source: "ai", createdAt: outline.updatedAt },
  ];
  outline.defaultNameVersionId = "name-current";
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data: fixture, conflictResolution: "keep-local" } })).ok()).toBeTruthy();
});

test("mobile content surfaces have no horizontal overflow when selecting outline title candidates", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile-"), "mobile title menu");
  test.setTimeout(60_000);
  await page.goto("/articles/article-main/outlines/outline-current/write");
  const trigger = page.getByRole("button", { name: "大纲标题，选择候选标题", exact: true });
  await expect(trigger).toContainText("当前码头");
  await trigger.tap();
  const menu = page.getByRole("menu", { name: "大纲标题，选择候选标题", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: /当前码头/ })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: new RegExp(`^${candidateTitle} AI 候选`) }).tap();
  await expect(menu).toBeHidden();
  await expect(trigger).toContainText(candidateTitle);
  const saved = await (await request.get("/api/state")).json() as { data: StudioData };
  const outline = saved.data.articles[0].chapters[0].outlines[1];
  expect(outline.title).toBe(candidateTitle);
  expect(outline.defaultNameVersionId).toBe("name-ai-candidate");
  expect(outline.content).toBe(fullStudioFixture().articles[0].chapters[0].outlines[1].content);
  expect(outline.versions).toEqual(expect.arrayContaining([expect.objectContaining({ id: "version-manual", content: "不可变版本正文" })]));
  expect(outline.currentVersionId).toBeNull();
  expect(outline.defaultVersionId).toBeNull();

  await page.reload();
  await expect(trigger).toContainText(candidateTitle);
  await trigger.tap();
  await expect(menu.getByRole("menuitemradio", { name: new RegExp(`^${candidateTitle} AI 候选`) })).toHaveAttribute("aria-checked", "true");
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const header = await page.locator(".mobile-header").boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  await menu.getByRole("menuitemradio", { name: /前序灯塔/ }).tap();
  await expect(menu.getByRole("alert")).toContainText("同一章节内已经使用大纲名");
  await expect(trigger).toContainText(candidateTitle);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "正文标题，选择正文候选", exact: true })).toBeVisible();
  await trigger.tap();
  await menu.getByRole("menuitemradio", { name: new RegExp(longCandidateTitle) }).tap();
  await expect(menu).toBeHidden();
  await expect(trigger).toContainText(longCandidateTitle);
  expect(await trigger.locator(".ui-title").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await trigger.tap();
  await expect(menu.getByRole("menuitemradio", { name: new RegExp(longCandidateTitle) })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: testInfo.outputPath("title-menu.png") });
});

test("mobile content surfaces have no horizontal overflow with an unnamed outline title menu", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile-"), "mobile title menu");
  const current = await (await request.get("/api/state")).json() as { revision: number; data: StudioData };
  const outline = current.data.articles[0].chapters[0].outlines[1];
  outline.title = "";
  outline.nameVersions = [];
  outline.defaultNameVersionId = null;
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data: current.data } })).ok()).toBeTruthy();
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "大纲标题，选择候选标题", exact: true }).tap();
  await expect(page.getByRole("menu", { name: "大纲标题，选择候选标题", exact: true })).toContainText("尚无候选标题");
});
