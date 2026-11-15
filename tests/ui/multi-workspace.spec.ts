import { expect, test, type Page } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

const url = "/articles/article-main/outlines/outline-current/write";
const pane = (page: Page, id: number) => page.getByRole("region", { name: `窗口 ${id}`, exact: true });
const layout = (page: Page, name: string) => page.getByRole("toolbar", { name: "窗口布局" }).getByRole("button", { name, exact: true });
const selectLayout = async (page: Page, name: string) => { await page.getByRole("button", { name: "窗口布局", exact: true }).click(); await layout(page,name).click(); };
const layoutTrigger = (page: Page) => page.getByRole("button", { name: "窗口布局", exact: true });
const choose = (page: Page, id: number, mode: string) => page.getByLabel(`窗口 ${id} 功能`, { exact: true }).selectOption(mode);

test.beforeEach(async ({ request }) => {
  const current = await (await request.get("/api/state")).json();
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data: fullStudioFixture(), conflictResolution: "keep-local" } })).ok()).toBeTruthy();
});

test.describe("desktop multi workspace", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium");
    await page.goto(url);
    await expect(layoutTrigger(page)).toHaveAttribute("data-layout", "single");
  });

  test("all layouts remain available in focus mode and restore their proportions", async ({ page }) => {
    await selectLayout(page, "左右");
    await expect(pane(page, 1)).toBeVisible();
    await expect(pane(page, 2)).toBeVisible();
    const splitter = page.getByRole("separator", { name: "调整左右窗口宽度" });
    await splitter.focus();
    await splitter.press("ArrowRight");
    await expect(splitter).toHaveAttribute("aria-valuenow", "52");
    await page.getByRole("button", { name: "专注写作", exact: true }).click();
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(layoutTrigger(page)).toBeVisible();
    await selectLayout(page, "上下");
    const a = (await pane(page, 1).boundingBox())!;
    const b = (await pane(page, 2).boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y + a.height - 2);
    await selectLayout(page, "四宫格");
    await expect(pane(page, 4)).toBeVisible();
    await page.getByRole("button", { name: "退出专注写作", exact: true }).click();
    await expect(layoutTrigger(page)).toHaveAttribute("data-layout", "grid");
    await expect(page.locator(".workspace-grid").getByRole("separator")).toHaveCount(2);
    await page.reload();
    await expect(layoutTrigger(page)).toHaveAttribute("data-layout", "grid");
    await expect(page.getByRole("separator", { name: "调整左右窗口宽度" })).toHaveAttribute("aria-valuenow", "52");
  });

  test("grid has two shared dividers and pointer resizing moves complete rows and columns", async ({ page }, info) => {
    await selectLayout(page, "四宫格");
    const grid = (await page.locator(".workspace-grid").boundingBox())!;
    const vertical = (await page.getByRole("separator", { name: "调整左右窗口宽度" }).boundingBox())!;
    await page.mouse.move(vertical.x + vertical.width / 2, grid.y + 80);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("role"), { x: vertical.x + vertical.width / 2, y: grid.y + 80 })).toBe("separator");
    await page.mouse.down();
    await page.mouse.move(grid.x + grid.width * .6, grid.y + 80, { steps: 10 });
    await page.mouse.up();
    const horizontal = (await page.getByRole("separator", { name: "调整上下窗口高度" }).boundingBox())!;
    await page.mouse.move(grid.x + 80, horizontal.y + horizontal.height / 2);
    await page.mouse.down();
    await page.mouse.move(grid.x + 80, grid.y + grid.height * .58, { steps: 10 });
    await page.mouse.up();
    const rects = await Promise.all([1, 2, 3, 4].map(id => pane(page, id).boundingBox()));
    expect(Math.abs(rects[0]!.width - rects[2]!.width)).toBeLessThan(1);
    expect(Math.abs(rects[1]!.x - rects[3]!.x)).toBeLessThan(1);
    expect(Math.abs(rects[0]!.height - rects[1]!.height)).toBeLessThan(1);
    expect(Math.abs(rects[2]!.y - rects[3]!.y)).toBeLessThan(1);
    expect(rects[0]!.width).toBeGreaterThan(grid.width * .58);
    expect(rects[0]!.height).toBeGreaterThan(grid.height * .56);
    expect(await pane(page, 1).evaluate(element => getComputedStyle(element).borderWidth)).toBe("0px");
    await expect(page.locator(".workspace-grid").getByRole("separator")).toHaveCount(2);
    await page.screenshot({ path: info.outputPath("four-windows.png") });
  });

  test("all sixteen function combinations are selectable without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await selectLayout(page, "左右");
    for (const left of ["write", "chat", "generate", "illustrations"]) {
      await choose(page, 1, left);
      for (const right of ["write", "chat", "generate", "illustrations"]) {
        await choose(page, 2, right);
        await expect(pane(page, 1).locator(".workspace-pane-view:not([hidden])")).toHaveCount(1);
        await expect(pane(page, 2).locator(".workspace-pane-view:not([hidden])")).toHaveCount(1);
      }
    }
    expect(errors).toEqual([]);
  });

  test("two bodies select versions independently without changing the current body", async ({ page, request }) => {
    await selectLayout(page, "左右");
    await choose(page, 2, "write");
    await page.getByLabel("窗口 2 正文版本", { exact: true }).selectOption("version-manual");
    await expect(pane(page, 1).getByLabel("正文内容", { exact: true })).toContainText("确认潮汐表");
    await expect(pane(page, 2).getByLabel("正文内容", { exact: true })).toHaveText("不可变版本正文");
    const outline = (await (await request.get("/api/state")).json()).data.articles[0].chapters[0].outlines[1];
    expect(outline.currentVersionId).toBeNull();
    await page.reload();
    await expect(page.getByLabel("窗口 2 正文版本", { exact: true })).toHaveValue("version-manual");
    await expect(pane(page, 1).getByLabel("正文内容", { exact: true })).toContainText("确认潮汐表");
  });

  test("body drafts survive changing layout and function and are quoted by chat", async ({ page }) => {
    await selectLayout(page, "左右");
    await pane(page, 1).getByLabel("正文内容", { exact: true }).press("Enter");
    await pane(page, 1).getByLabel("正文编辑器", { exact: true }).fill("正在编辑的新草稿，尚未保存。");
    await expect(pane(page, 2).getByRole("status")).toContainText("窗口 1");
    await expect(pane(page, 2).getByRole("status")).toContainText("编辑草稿");
    await choose(page, 1, "generate");
    await choose(page, 1, "write");
    await expect(pane(page, 1).getByLabel("正文编辑器", { exact: true })).toHaveValue("正在编辑的新草稿，尚未保存。");
    await selectLayout(page, "四宫格");
    await selectLayout(page, "单窗");
    await selectLayout(page, "左右");
    await expect(pane(page, 1).getByLabel("正文编辑器", { exact: true })).toHaveValue("正在编辑的新草稿，尚未保存。");
    await page.reload();
    await expect(pane(page, 1).getByLabel("正文编辑器", { exact: true })).toHaveValue("正在编辑的新草稿，尚未保存。");
  });

  test("chat sends a snapshot of the visible draft and has only copy actions", async ({ page }) => {
    await selectLayout(page, "左右");
    await pane(page, 1).getByLabel("正文内容", { exact: true }).press("Enter");
    await pane(page, 1).getByLabel("正文编辑器", { exact: true }).fill("本次聊天必须引用的未保存正文。");
    let snapshot = "";
    await page.route("**/chat/transactions", async route => {
      const body = route.request().postDataJSON();
      if (body.action === "submit") snapshot = body.promptContext.currentOutline.content;
      await route.continue();
    });
    await pane(page, 2).getByLabel("聊天消息", { exact: true }).fill("检查当前内容");
    await pane(page, 2).getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => snapshot).toBe("本次聊天必须引用的未保存正文。");
    await expect(pane(page, 2).getByRole("button", { name: "更多写作操作", exact: true })).toHaveCount(0);
  });

  test("two chat panes retain different sessions and drafts", async ({ page }) => {
    await selectLayout(page, "左右");
    await choose(page, 1, "chat");
    await pane(page, 2).locator(".chat-session-switcher").click();
    await pane(page, 2).getByRole("button", { name: /人物动机分支/ }).click();
    await pane(page, 1).getByLabel("聊天消息", { exact: true }).fill("主会话独立草稿");
    await pane(page, 2).getByLabel("聊天消息", { exact: true }).fill("另一会话独立草稿");
    await expect(pane(page, 1).getByLabel("聊天消息", { exact: true })).toHaveValue("主会话独立草稿");
    await expect(pane(page, 2).locator(".chat-thread")).toContainText("alternate-session-secret");
    await expect(pane(page, 1).locator(".chat-thread")).not.toContainText("alternate-session-secret");
    await page.reload();
    await expect(pane(page, 2).locator(".chat-session-switcher")).toContainText("人物动机分支");
  });

  test("generation and illustration forms keep separate inputs", async ({ page }) => {
    await selectLayout(page, "左右");
    await choose(page, 1, "generate");
    await choose(page, 2, "generate");
    await pane(page, 1).getByPlaceholder("补充生成要求", { exact: true }).fill("左侧生成指令");
    await pane(page, 2).getByPlaceholder("补充生成要求", { exact: true }).fill("右侧生成指令");
    await expect(pane(page, 1).getByPlaceholder("补充生成要求", { exact: true })).toHaveValue("左侧生成指令");
    await choose(page, 1, "illustrations");
    await choose(page, 2, "illustrations");
    await pane(page, 1).getByLabel("图片 prompt", { exact: true }).fill("left illustration");
    await pane(page, 2).getByLabel("图片 prompt", { exact: true }).fill("right illustration");
    await choose(page, 1, "generate");
    await expect(pane(page, 1).getByPlaceholder("补充生成要求", { exact: true })).toHaveValue("左侧生成指令");
    await choose(page, 1, "illustrations");
    await expect(pane(page, 1).getByLabel("图片 prompt", { exact: true })).toHaveValue("left illustration");
    await expect(pane(page, 2).getByLabel("图片 prompt", { exact: true })).toHaveValue("right illustration");
  });

  test("grid controls fit narrow desktop windows and share the same body draft", async ({ page }, info) => {
    await selectLayout(page, "四宫格");
    await choose(page, 2, "write");
    await pane(page, 1).getByLabel("正文内容", { exact: true }).press("Enter");
    await pane(page, 1).getByLabel("正文编辑器", { exact: true }).fill("同一正文的共享草稿。");
    await expect(pane(page, 2).getByLabel("正文内容", { exact: true })).toHaveText("同一正文的共享草稿。");
    await pane(page, 2).getByLabel("正文内容", { exact: true }).press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "此正文正在窗口 1 中编辑" })).toBeVisible();
    for (const width of [1280, 1024, 820]) {
      await page.setViewportSize({ width, height: 900 });
      const start = pane(page, 3).getByRole("button", { name: "开始生成", exact: true });
      await expect(start).toBeVisible();
      const bounds = (await pane(page, 3).boundingBox())!;
      const button = (await start.boundingBox())!;
      expect(button.x).toBeGreaterThanOrEqual(bounds.x - 1);
      expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: info.outputPath("narrow-grid.png") });
  });

  test("pane drafts recover from IndexedDB when the tab session is gone", async ({ page }) => {
    await selectLayout(page, "左右");
    await pane(page, 1).getByLabel("正文内容", { exact: true }).press("Enter");
    await pane(page, 1).getByLabel("正文编辑器", { exact: true }).fill("从浏览器本地数据库恢复的窗口草稿。");
    await expect.poll(() => page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("writer-studio-offline-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return await new Promise<boolean>(resolve => { const request = database.transaction("snapshots").objectStore("snapshots").getAll(); request.onsuccess = () => { database.close(); resolve(request.result.some(record => record.key?.startsWith("pane-draft:") && record.text.includes("从浏览器本地数据库恢复"))); }; });
    })).toBe(true);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(pane(page, 1).getByLabel("正文编辑器", { exact: true })).toHaveValue("从浏览器本地数据库恢复的窗口草稿。");
  });
});

test("mobile keeps a single workspace despite a desktop split preference", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-chromium");
  await page.addInitScript(() => localStorage.setItem("writer-studio:workspace-layout", JSON.stringify({ layout: "grid", x: .6, y: .4 })));
  await page.goto(url);
  await expect(page.getByLabel("正文内容", { exact: true })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "窗口布局" })).toHaveCount(0);
  await expect(page.locator(".workspace-divider")).toHaveCount(0);
});
