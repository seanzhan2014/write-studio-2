import { expect, test, type Page } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

const url = "/articles/article-main/outlines/outline-current/write";
const pane = (page: Page, id: number) => page.getByRole("region", { name: `窗口 ${id}`, exact: true });
const visiblePanes = (page: Page) => page.locator(".workspace-pane:not([hidden])");
async function layout(page: Page, label: string) {
  await page.getByRole("button", { name: "窗口布局", exact: true }).click();
  await page.getByRole("toolbar", { name: "窗口布局" }).getByRole("button", { name: label, exact: true }).click();
}
const choose = (page: Page, id: number, mode: string) => page.getByLabel(`窗口 ${id} 功能`, { exact: true }).selectOption(mode);

test.beforeEach(async ({ page, request }, info) => {
  test.skip(!info.project.name.startsWith("mobile-"));
  const current = await (await request.get("/api/state")).json();
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data: fullStudioFixture(), conflictResolution: "keep-local" } })).ok()).toBeTruthy();
  await page.goto(url);
  await expect(page.getByRole("button", { name: "窗口布局", exact: true })).toBeEnabled();
});

test("mobile layouts remain selectable in focus mode across phone sizes", async ({ page }, info) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    for (const [label, count] of [["左右", 2], ["上下", 2], ["四宫格", 4], ["单窗", 1]] as const) {
      await layout(page, label);
      await expect(visiblePanes(page)).toHaveCount(count);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const section of await visiblePanes(page).all()) {
        const rect = (await section.boundingBox())!;
        expect(rect.x).toBeGreaterThanOrEqual(-1);
        expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "专注写作", exact: true }).click();
  await layout(page, "四宫格");
  await expect(visiblePanes(page)).toHaveCount(4);
  await expect(page.getByRole("button", { name: "退出专注写作", exact: true })).toBeVisible();
  await expect(page.locator(".workspace-grid").getByRole("separator")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("mobile-four-windows.png") });
});

test("mobile supports repeated functions and independent body versions", async ({ page, request }) => {
  await layout(page, "左右");
  for (const mode of ["write", "chat", "generate", "illustrations"]) {
    await choose(page, 1, mode);
    await choose(page, 2, mode);
    await expect(pane(page, 1).locator(".workspace-pane-view:not([hidden])")).toHaveCount(1);
    await expect(pane(page, 2).locator(".workspace-pane-view:not([hidden])")).toHaveCount(1);
  }
  await choose(page, 1, "write");
  await choose(page, 2, "write");
  await page.getByLabel("窗口 2 正文版本", { exact: true }).selectOption("version-manual");
  await expect(pane(page, 1).getByLabel("正文内容", { exact: true })).toContainText("确认潮汐表");
  await expect(pane(page, 2).getByLabel("正文内容", { exact: true })).toHaveText("不可变版本正文");
  const data = (await (await request.get("/api/state")).json()).data;
  expect(data.articles[0].chapters[0].outlines[1].currentVersionId).toBeNull();
  await page.reload();
  await expect(page.getByLabel("窗口 2 正文版本", { exact: true })).toHaveValue("version-manual");
});

test("mobile touch resizing moves the complete grid dividers and keeps proportions", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Native CDP touch input");
  await layout(page, "四宫格");
  const grid = (await page.locator(".workspace-grid").boundingBox())!;
  const divider = (await page.getByRole("separator", { name: "调整左右窗口宽度" }).boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const x = divider.x + divider.width / 2;
  const y = grid.y + 30;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: grid.x + grid.width * .62, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByRole("separator", { name: "调整左右窗口宽度" })).toHaveAttribute("aria-valuenow", "62");
  const horizontal = (await page.getByRole("separator", { name: "调整上下窗口高度" }).boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: grid.x + 30, y: horizontal.y + horizontal.height / 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: grid.x + 30, y: grid.y + grid.height * .6 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByRole("separator", { name: "调整上下窗口高度" })).toHaveAttribute("aria-valuenow", "60");
  const a = (await pane(page, 1).boundingBox())!;
  const b = (await pane(page, 2).boundingBox())!;
  const c = (await pane(page, 3).boundingBox())!;
  const d = (await pane(page, 4).boundingBox())!;
  expect(Math.abs(a.width - c.width)).toBeLessThan(1);
  expect(Math.abs(a.height - b.height)).toBeLessThan(1);
  expect(Math.abs(b.x - d.x)).toBeLessThan(1);
  expect(Math.abs(c.y - d.y)).toBeLessThan(1);
  await page.reload();
  await expect(page.getByRole("separator", { name: "调整左右窗口宽度" })).toHaveAttribute("aria-valuenow", "62");
});

test("mobile editor and chat stay inside their panes above a simulated keyboard", async ({ page }) => {
  await layout(page, "上下");
  await pane(page, 1).getByLabel("正文内容", { exact: true }).press("Enter");
  const editor = pane(page, 1).getByLabel("正文编辑器", { exact: true });
  await editor.fill("手机分屏草稿。".repeat(60));
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 430 });
    window.visualViewport?.dispatchEvent(new Event("resize"));
  });
  await expect.poll(async () => { const rect = await page.locator(".multi-workspace").boundingBox(); return rect!.y + rect!.height; }).toBeLessThanOrEqual(431);
  const input = pane(page, 2).getByLabel("聊天消息", { exact: true });
  await input.fill("另一窗口的聊天草稿");
  const send = pane(page, 2).getByRole("button", { name: "发送消息", exact: true });
  for (const target of [editor, input, send]) {
    const rect = (await target.boundingBox())!;
    expect(rect.y + rect.height).toBeLessThanOrEqual(431);
  }
  await layout(page, "四宫格");
  await expect.poll(async () => { const bounds = await send.boundingBox(); return bounds!.y + bounds!.height; }).toBeLessThanOrEqual(431);
  await page.getByRole("button", { name: "专注写作", exact: true }).click();
  await layout(page, "左右");
  await expect(editor).toHaveValue("手机分屏草稿。".repeat(60));
  await expect(input).toHaveValue("另一窗口的聊天草稿");
});

test("mobile input drafts survive desktop and phone viewport changes", async ({ page }) => {
  await layout(page, "左右");
  await choose(page, 1, "generate");
  await choose(page, 2, "illustrations");
  const instruction = pane(page, 1).getByPlaceholder("补充生成要求", { exact: true });
  const prompt = pane(page, 2).getByLabel("图片 prompt", { exact: true });
  await instruction.fill("手机窗口生成指令");
  await prompt.fill("mobile illustration prompt");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(instruction).toHaveValue("手机窗口生成指令");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(prompt).toHaveValue("mobile illustration prompt");
  await page.getByRole("button", { name: "返回大纲", exact: true }).click();
  await expect(page.locator(".mobile-outline-home")).toBeVisible();
});
