import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

test.beforeEach(async ({ request }) => {
  const state = await (await request.get("/api/state")).json();
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fullStudioFixture(), conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();
});

test("an empty library can open and retain theme settings before creating an article", async ({ page, request }) => {
  const current = await (await request.get("/api/state")).json();
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(current.revision) },
    data: { data: { ...fullStudioFixture(), articles: [], currentArticleId: "", currentOutlineId: "" }, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "主题设置", exact: true }).click();
  await page.getByRole("button", { name: "鸢紫", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("自定义色调", { exact: true })).toHaveValue("#7951a8");
  await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  await expect(page.getByRole("button", { name: "新建文章", exact: true })).toBeVisible();
});

test("appearance updates colors and fonts across preview, writing and portals and survives reload", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/settings/appearance");
  await expect(page.getByRole("heading", { name: "主题与色调" })).toBeVisible({ timeout: 30_000 });
  const originalAccent = await page.locator(".appearance-preview-toolbar > span").evaluate((el) => getComputedStyle(el).color);
  await page.getByRole("button", { name: "海蓝", exact: true }).click();
  await expect(page.getByRole("button", { name: "海蓝", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".appearance-preview-toolbar > span")).not.toHaveCSS("color", originalAccent);
  await page.getByLabel("界面字体", { exact: true }).selectOption("kai");
  await page.getByLabel("正文字体", { exact: true }).selectOption("mono");
  await page.getByRole("slider", { name: /正文字号/ }).focus();
  await page.getByRole("slider", { name: /正文字号/ }).press("ArrowRight");
  await expect(page.locator(".appearance-preview-page")).toHaveCSS("font-size", "18px");
  await expect(page.locator(".appearance-preview-page")).toHaveCSS("font-family", /monospace/);
  await expect(page.locator("body")).toHaveCSS("font-family", /KaiTi/);
  await page.getByText("深色", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
  await page.getByLabel("自定义色调", { exact: true }).fill("#b34779");
  await page.getByLabel("自定义色调", { exact: true }).blur();
  await page.reload();
  await expect(page.getByLabel("自定义色调", { exact: true })).toHaveValue("#b34779");
  await expect(page.getByLabel("界面字体", { exact: true })).toHaveValue("kai");
  await expect(page.getByLabel("正文字体", { exact: true })).toHaveValue("mono");
  await expect(page.locator(".appearance-preview-page")).toHaveCSS("font-size", "18px");
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
  const accent = await page.locator("body").evaluate((el) => getComputedStyle(el).getPropertyValue("--accent"));
  await expect(page.locator(".studio-shell")).toHaveCSS("--accent", accent);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole("heading", { name: "主题与色调" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("appearance.png") });

  await page.goto("/articles/article-main/outlines/outline-current/write");
  await expect(page.getByRole("region", { name: "正文内容" })).toHaveCSS("font-family", /monospace/);
  await expect(page.getByRole("region", { name: "正文内容" })).toHaveCSS("font-size", "18px");
  await page.goto("/settings/models");
  await page.getByRole("button", { name: "新建 Provider" }).click();
  await expect(page.locator(".ws-modal-content")).toBeVisible();
  await expect(page.locator(".ws-modal-content")).toHaveCSS("--accent", accent);
  await expect(page.locator(".ws-modal-content")).toHaveCSS("font-family", /KaiTi/);
});

test("system mode follows changes and reset restores appearance without changing writing data", async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings/appearance");
  await expect(page.getByRole("heading", { name: "主题与色调" })).toBeVisible({ timeout: 30_000 });
  const before = await (await request.get("/api/state")).json();
  await page.getByText("跟随系统", { exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "light");
  await page.getByRole("button", { name: "松绿", exact: true }).click();
  await page.getByLabel("自定义色调", { exact: true }).fill("#zz");
  await expect(page.getByText("请输入完整色值，如 #2563a6")).toBeVisible();
  await page.getByLabel("自定义色调", { exact: true }).blur();
  await expect(page.getByLabel("自定义色调", { exact: true })).toHaveValue("#28735b");
  await page.getByLabel("界面字体", { exact: true }).selectOption("serif");
  await page.getByRole("button", { name: "恢复默认外观" }).click();
  await expect(page.getByText("已恢复默认外观", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("自定义色调", { exact: true })).toHaveValue("#755835");
  await expect(page.getByLabel("界面字体", { exact: true })).toHaveValue("sans");
  await expect(page.getByLabel("正文字体", { exact: true })).toHaveValue("sans");
  const after = await (await request.get("/api/state")).json();
  expect(after.data.articles).toEqual(before.data.articles);
  expect(after.revision).toEqual(before.revision);
});
