import { expect, test, type Locator, type Page } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

async function expectIconControl(target: Locator) {
  await expect(target).toBeVisible();
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  const glyph = await target.locator(".icon svg").boundingBox();
  expect(glyph).not.toBeNull();
  expect(glyph!.width).toBeGreaterThanOrEqual(17);
  expect(glyph!.width).toBeLessThanOrEqual(21);
  expect(glyph!.height).toBeGreaterThanOrEqual(17);
  expect(glyph!.height).toBeLessThanOrEqual(21);
}

async function swipeOutlineLeft(target: Locator) {
  await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const y = bounds.top + bounds.height / 2;
    const startX = bounds.right - 24;
    const endX = startX - 92;
    const touch = (x: number) => new Touch({ identifier: 7, target: element, clientX: x, clientY: y, screenX: x, screenY: y });
    const start = touch(startX);
    element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [start], targetTouches: [start], changedTouches: [start] }));
    const move = touch(endX);
    element.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [move], targetTouches: [move], changedTouches: [move] }));
    element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [move] }));
  });
}

async function selectReaderTextAndOpenMenu(target: Locator, selectedText: string) {
  await target.evaluate((element, value) => {
    const text = element.textContent ?? "";
    const start = text.indexOf(value);
    if (start < 0) throw new Error(`selection text missing: ${value}`);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let offset = 0;
    while (node && offset + (node.textContent?.length ?? 0) <= start) {
      offset += node.textContent?.length ?? 0;
      node = walker.nextNode();
    }
    if (!node) throw new Error("selection text node missing");
    const range = document.createRange();
    range.setStart(node, start - offset);
    range.setEnd(node, start - offset + value.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const bounds = range.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: bounds.left + 4, clientY: bounds.bottom + 4 }));
  }, selectedText);
}

async function selectReaderText(target: Locator, selectedText: string) {
  await target.evaluate((element, value) => {
    const text = element.textContent ?? "";
    const start = text.indexOf(value);
    if (start < 0) throw new Error(`selection text missing: ${value}`);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let offset = 0;
    while (node && offset + (node.textContent?.length ?? 0) <= start) {
      offset += node.textContent?.length ?? 0;
      node = walker.nextNode();
    }
    if (!node) throw new Error("selection text node missing");
    const range = document.createRange();
    range.setStart(node, start - offset);
    range.setEnd(node, start - offset + value.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, selectedText);
}

async function doubleTouch(target: Locator) {
  await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, pointerType: "touch", clientX: bounds.left + 24, clientY: bounds.top + 24 };
    element.dispatchEvent(new PointerEvent("pointerup", { ...options, pointerId: 11 }));
    element.dispatchEvent(new PointerEvent("pointerup", { ...options, pointerId: 12 }));
  });
}

const mobileOverlayViewports = [
  { name: "常见竖屏", width: 390, height: 844 },
  { name: "小型竖屏", width: 320, height: 568 },
  { name: "短横屏", width: 667, height: 375 },
  { name: "键盘压缩高度", width: 390, height: 480 },
] as const;

async function expectInsideViewport(page: Page, target: Locator) {
  await expect.poll(async () => {
    const bounds = await target.boundingBox();
    const viewport = page.viewportSize();
    return Boolean(bounds && viewport
      && bounds.x >= -1
      && bounds.y >= -1
      && bounds.x + bounds.width <= viewport.width + 1
      && bounds.y + bounds.height <= viewport.height + 1);
  }, { message: "浮层或操作控件应在过渡动画结束后完整位于视口内" }).toBe(true);
}

async function expectOverlayContract(page: Page, surface: Locator) {
  await expect(surface).toBeVisible();
  await expectInsideViewport(page, surface);
  await expect(surface).toHaveCSS("display", "flex");
  await expect(surface).toHaveCSS("overflow", "hidden");
  const scrollOwners = surface.locator(".ws-overlay-body--scroll, [data-ui-overlay-scroll]");
  await expect(scrollOwners).toHaveCount(1);
  const owner = scrollOwners.first();
  await expect(owner).toHaveCSS("overflow-y", "auto");
  const metrics = await owner.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  if (metrics.scrollHeight > metrics.clientHeight + 1) {
    await owner.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const after = await owner.evaluate((element) => element.scrollTop);
    expect(after).toBeGreaterThan(0);
  }
}

test.beforeEach(async ({ request }) => {
  const current = await request.get("/api/state");
  expect(current.ok()).toBeTruthy();
  const payload = await current.json() as { revision: number };
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fullStudioFixture(), conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();
});

test("all application pages share the control and typography scale", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const articleBase = "/articles/article-main";
  const routes = [
    `${articleBase}/outlines/outline-current/write`,
    `${articleBase}/outlines/outline-current/chat`,
    `${articleBase}/outlines/outline-current/generate`,
    `${articleBase}/chapters/chapter-main`,
    `${articleBase}/outlines/edit-all`,
    `${articleBase}/edit`,
    `${articleBase}/read`,
    `${articleBase}/search`,
    `${articleBase}/info/basic`,
    `${articleBase}/info/characters`,
    `${articleBase}/info/relationships`,
    "/settings/general",
    "/settings/appearance",
    "/settings/models",
    "/settings/tasks",
    "/settings/database",
    "/settings/system",
  ];
  if (testInfo.project.name === "mobile-chromium") routes.unshift("/");
  const mobile = testInfo.project.name === "mobile-chromium";

  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator(".main-area")).toBeVisible({ timeout: 20_000 });
    const findings = await page.evaluate(({ mobile }) => {
      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const className = (element: Element) => (element.getAttribute("class") || "(none)").trim().replace(/\s+/g, ".").slice(0, 100);
      const pixels = (value: string) => Number(value.replace("px", ""));
      const isSaturatedBlue = (value: string) => {
        const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
        if (values.length < 3) return false;
        const scale = value.startsWith("color(srgb") ? 1 : 255;
        const [red, green, blue] = values;
        return blue > scale * 0.43 && blue > red * 1.22 && blue > green * 1.12;
      };
      const textButtons = [...document.querySelectorAll("button")].filter((element) => visible(element) && (element.textContent || "").trim());
      const visibleButtons = [...document.querySelectorAll("button,[role=button]")].filter(visible);
      const standardActions = [...document.querySelectorAll(".primary-compact,.secondary-button,.danger-button,.model-card-actions .mantine-Button-root,.character-card .card-actions button,.relationship-card .card-actions button")].filter(visible);
      const textControls = [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select")].filter(visible);
      const mainRect = document.querySelector(".main-area")?.getBoundingClientRect();
      return {
        tinyButtons: [...new Set(textButtons.filter((element) => pixels(getComputedStyle(element).fontSize) < 11).map(className))],
        blueButtons: [...new Set(visibleButtons.filter((element) => {
          const style = getComputedStyle(element);
          return isSaturatedBlue(style.backgroundColor) || isSaturatedBlue(style.color) || isSaturatedBlue(style.borderColor);
        }).map(className))],
        undersizedActions: [...new Set(standardActions.filter((element) => element.getBoundingClientRect().height + 0.1 < (mobile ? 44 : 36)).map(className))],
        smallMobileInputs: mobile ? [...new Set(textControls.filter((element) => pixels(getComputedStyle(element).fontSize) < 16).map(className))] : [],
        viewportEscape: Boolean(mainRect && (mainRect.left < -1 || mainRect.right > innerWidth + 1)),
      };
    }, { mobile });
    expect(findings, `${testInfo.project.name} ${route}`).toEqual({ tinyButtons: [], blueButtons: [], undersizedActions: [], smallMobileInputs: [], viewportEscape: false });
  }
});

test("mobile overlays stay reachable across the supported viewport matrix", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  test.setTimeout(180_000);

  for (const viewport of mobileOverlayViewports) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");

      await page.locator('[data-outline-id="outline-current"] .icon-button').click();
      const outlineDrawer = page.locator(".outline-action-drawer");
      await expectOverlayContract(page, outlineDrawer);
      const outlineActions = outlineDrawer.locator(".ws-action-sheet-list > button");
      expect(await outlineActions.count()).toBeGreaterThanOrEqual(10);
      await outlineActions.last().scrollIntoViewIfNeeded();
      await expectInsideViewport(page, outlineActions.last());
      await outlineDrawer.getByRole("button", { name: "关闭大纲操作" }).click();

      await page.locator(".mobile-chapter-card > header .icon-button").first().click();
      const chapterSheet = page.locator(".ws-action-sheet--mobile");
      await expectOverlayContract(page, chapterSheet);
      const chapterActions = chapterSheet.locator(".ws-action-sheet-list > button");
      await chapterActions.last().scrollIntoViewIfNeeded();
      await expectInsideViewport(page, chapterActions.last());
      await chapterSheet.getByRole("button", { name: "AI生成名称" }).click();
      const namingDialog = page.locator(".name-generate-dialog");
      await expectOverlayContract(page, namingDialog);
      await namingDialog.getByRole("button", { name: "关闭名称生成" }).click();

      await page.locator('[data-outline-id="outline-current"] .icon-button').click();
      await page.locator(".outline-action-drawer .ws-action-sheet-list > button").first().click();
      const editDrawer = page.locator(".outline-edit-drawer");
      await expectOverlayContract(page, editDrawer);
      await editDrawer.getByRole("button", { name: "保存大纲" }).scrollIntoViewIfNeeded();
      await expectInsideViewport(page, editDrawer.getByRole("button", { name: "保存大纲" }));
      await editDrawer.getByRole("button", { name: "关闭编辑大纲" }).click();

      await page.locator(".mobile-outline-header > button").first().click();
      const articleDrawer = page.locator(".mobile-article-drawer");
      await expectOverlayContract(page, articleDrawer);
      await articleDrawer.locator(".mobile-new-article").scrollIntoViewIfNeeded();
      await expectInsideViewport(page, articleDrawer.locator(".mobile-new-article"));
      await articleDrawer.getByRole("button", { name: "关闭文章菜单" }).click();

      await page.goto("/articles/article-main/outlines/outline-current/generate");
      await page.locator(".generate-context-summary").click();
      const contextDrawer = page.locator(".ws-scrollable-drawer").filter({ has: page.locator(".generate-context-panel") });
      await expectOverlayContract(page, contextDrawer);
      await contextDrawer.getByRole("button", { name: "关闭生成上下文" }).click();
    });
  }
});

test("all responsive overlay consumers open inside a keyboard-compressed viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 480 });

  await page.goto("/");
  await page.locator(".mobile-outline-header > button").first().click();
  await page.locator(".mobile-new-article").click();
  const newArticle = page.locator(".ws-responsive-modal").filter({ hasText: "新建文章" });
  await expectOverlayContract(page, newArticle);
  await newArticle.getByRole("button", { name: "关闭新建文章" }).click();

  await page.getByRole("button", { name: "AI 任务", exact: true }).click();
  const tasks = page.locator(".task-drawer-shell");
  await expectOverlayContract(page, tasks);
  await tasks.getByRole("button", { name: "关闭 AI 任务" }).click();

  await page.locator('[data-outline-id="outline-current"] .icon-button').click();
  await page.getByRole("button", { name: "AI Generate 大纲", exact: true }).click();
  const structureGenerate = page.locator(".structure-generate-drawer");
  await expectOverlayContract(page, structureGenerate);
  await structureGenerate.getByRole("button", { name: "关闭结构生成" }).click();

  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "选择正文版本", exact: true }).click();
  const versions = page.locator(".version-drawer-shell");
  await expectOverlayContract(page, versions);
  await versions.getByRole("button", { name: "关闭正文版本" }).click();
  await page.locator(".mobile-plan-peek").click();
  const planPeek = page.locator(".plan-peek-drawer");
  await expectOverlayContract(page, planPeek);
  await planPeek.getByRole("button", { name: "关闭此正文大纲" }).click();

  await page.goto("/articles/article-main/outlines/outline-current/generate");
  await page.locator(".generate-first-appearance-edit").click();
  const appearance = page.locator(".first-appearance-dialog");
  await expectOverlayContract(page, appearance);
  await appearance.getByRole("button", { name: "关闭首次出场人物编辑" }).click();
  await page.getByRole("button", { name: "管理预设" }).click();
  const presets = page.locator(".generate-preset-dialog");
  await expectOverlayContract(page, presets);
  await presets.getByRole("button", { name: "关闭预设管理" }).click();

  await page.goto("/articles/article-main/outlines/edit-all");
  await page.locator('[data-continuous-outline-id="outline-current"] .continuous-outline-more').click();
  await page.getByRole("menuitem", { name: "AI Chat" }).click();
  const fullChat = page.locator(".full-outline-chat-modal");
  await expectOverlayContract(page, fullChat);
  await fullChat.getByRole("button", { name: "关闭全文大纲 AI Chat" }).click();

  await page.goto("/articles/article-main/edit");
  await page.getByRole("button", { name: "AI Review" }).click();
  const review = page.locator(".ai-review-dialog");
  await expectOverlayContract(page, review);
  await review.getByRole("button", { name: "关闭 AI Review" }).click();

  await page.goto("/settings/models");
  await page.getByRole("button", { name: "新建模型" }).click();
  const modelEditor = page.locator(".ws-responsive-modal").filter({ hasText: "新建模型" });
  await expectOverlayContract(page, modelEditor);
  await modelEditor.getByRole("button", { name: "关闭模型编辑" }).click();
});

test("model settings uses a viewport-safe editor and fetches models on mobile", async ({ page }, testInfo) => {
  await page.route("**/api/models/discover", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: ["writer-fast", "writer-large"] }) });
  });
  await page.goto("/settings/models");
  await expect(page.getByRole("button", { name: "新建模型" })).toBeVisible();
  await page.getByRole("button", { name: "新建模型" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("显示名称")).toBeVisible();
  const fetchModels = page.getByRole("button", { name: "Fetch 模型列表" });
  await expect(fetchModels).toBeVisible();
  await expect(page.getByLabel("超时（分钟）")).toBeVisible();
  await expect(page.getByLabel("最大输入字符数")).toHaveValue(/60,?000/);
  if (testInfo.project.name === "mobile-chromium") {
    const fetchBounds = await fetchModels.boundingBox();
    expect(fetchBounds).not.toBeNull();
    expect(fetchBounds!.height).toBeGreaterThanOrEqual(44);
    await expect(fetchModels).toContainText("Fetch 模型列表");
  }
  await fetchModels.click();
  const discovered = page.getByLabel("选择获取到的大模型");
  await expect(discovered).toBeVisible();
  await expect(page.getByRole("dialog").getByText("writer-fast", { exact: true })).toBeVisible();
  await discovered.click();
  await page.getByRole("option", { name: "writer-large", exact: true }).click();
  await expect(page.getByLabel("模型 ID")).toHaveValue("writer-fast, writer-large");
  await discovered.click();
  for (const name of ["writer-fast", "writer-large"]) {
    const option = page.getByRole("option", { name, exact: true });
    await expect(option).toHaveAttribute("aria-selected", "true");
    await expect(option.locator("svg")).toHaveCount(1);
  }
  await expect(page.getByRole("button", { name: "保存 2 个候选" })).toBeVisible();

  const bounds = await page.getByRole("dialog").boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
});

test("model candidates can be assigned as independent task defaults", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop model settings");
  await page.route("**/api/models/discover", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: ["deepseek-chat", "deepseek-reasoner", "writer-large"] }) });
  });
  await page.route("**/api/models", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [
        { id: "deepseek-candidate", name: "DeepSeek", baseUrl: "https://models.example/v1", modelId: "deepseek-chat", systemPrompt: "", hasSecret: true, timeoutMs: 120000 },
        { id: "writer-candidate", name: "Writer", baseUrl: "https://models.example/v1", modelId: "writer-large", systemPrompt: "", hasSecret: true, timeoutMs: 120000 },
      ] }),
    });
  });
  await page.goto("/settings/models");
  const deepseek = page.locator(".model-card").filter({ hasText: "DeepSeek" });
  const writer = page.locator(".model-card").filter({ hasText: "Writer" });
  await deepseek.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "设为 Chat 默认" }).click();
  await deepseek.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "设为 Review 默认" }).click();
  await writer.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "设为 Generate 默认" }).click();
  await writer.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "设为名称生成默认" }).click();
  await expect(deepseek).toContainText("默认 AI Chat");
  await expect(deepseek).toContainText("默认 AI Review");
  await expect(writer).toContainText("默认 AI Generate");
  await expect(writer).toContainText("默认名称生成");

  await deepseek.getByRole("button", { name: "编辑" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Fetch 模型列表" }).click();
  const candidates = dialog.getByLabel("选择获取到的大模型");
  await expect(candidates).toBeVisible();
  await expect(dialog).toContainText("只有这里勾选并保存的候选才会出现在 AI Chat、Generate 和 Review 中");
  await candidates.click();
  await page.getByRole("option", { name: "deepseek-reasoner", exact: true }).click();
  await expect(dialog.getByLabel("模型 ID")).toHaveValue("deepseek-chat, writer-large, deepseek-reasoner");
  await expect(dialog.getByRole("button", { name: "保存候选配置" })).toBeVisible();
});

test("generate controls and context drawer fit the desktop viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  await expect(page.getByLabel("正文目标字数")).toHaveValue(/5,?000/);
  await expect(page.getByLabel("同时生成大纲名")).not.toBeChecked();
  await expect(page.getByRole("radio", { name: /全新生成/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /改写正文/ })).toBeEnabled();
  await expect(page.getByRole("radio", { name: /续写正文/ })).toBeEnabled();
  await page.getByRole("radio", { name: /改写正文/ }).click();
  const retention = page.getByRole("slider", { name: "原文保留度" });
  await expect(retention).toBeVisible();
  await expect(page.getByText("平衡 · 平衡改写", { exact: true })).toBeVisible();
  await retention.focus();
  await retention.press("End");
  await expect(page.getByText("高保留 · 轻度润色", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /全新生成/ }).click();
  await expect(retention).toHaveCount(0);
  await expect(page.getByText("补充指令（可选）", { exact: false })).toBeVisible();
  const firstAppearance = page.getByLabel("首次出场人物");
  await expect(firstAppearance).toContainText("顾屿");
  await expect(firstAppearance).not.toContainText("林澈");
  await firstAppearance.getByRole("button", { name: "编辑" }).click();
  const appearanceDialog = page.getByRole("dialog").filter({ hasText: "首次出场人物" });
  await expect(appearanceDialog.getByLabel("顾屿首次出场")).toBeChecked();
  await expect(appearanceDialog.getByLabel("林澈首次出场")).not.toBeChecked();
  await expect(appearanceDialog).toContainText("此前在「前序灯塔」匹配“林澈”");
  await appearanceDialog.getByLabel("林澈首次出场").check();
  await appearanceDialog.getByLabel("顾屿首次出场").uncheck();
  await appearanceDialog.getByRole("button", { name: "完成" }).click();
  await expect(firstAppearance).toContainText("林澈");
  await expect(firstAppearance).not.toContainText("顾屿");
  await page.locator(".generate-context-summary").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("本次生成上下文", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("前面大纲", { exact: false })).toBeVisible();
  await expect(page.getByText("全新生成不发送", { exact: true })).toBeVisible();
  await expect(page.getByText("本章全部大纲", { exact: false })).toHaveCount(0);
  await expect(page.locator(".context-preview").getByText("当前大纲", { exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("first appearance editor is usable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  await page.getByRole("radio", { name: /改写正文/ }).click();
  const retention = page.getByRole("slider", { name: "原文保留度" });
  await expect(retention).toBeVisible();
  const retentionBounds = await page.locator(".rewrite-retention-control").boundingBox();
  const mobileViewport = page.viewportSize()!;
  expect(retentionBounds).not.toBeNull();
  expect(retentionBounds!.x).toBeGreaterThanOrEqual(0);
  expect(retentionBounds!.x + retentionBounds!.width).toBeLessThanOrEqual(mobileViewport.width);
  const firstAppearance = page.getByLabel("首次出场人物");
  await expect(firstAppearance).toContainText("顾屿");
  await firstAppearance.getByRole("button", { name: "编辑" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "首次出场人物" });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  await dialog.getByLabel("顾屿首次出场").uncheck();
  await dialog.getByRole("button", { name: "完成" }).click();
  await expect(firstAppearance).toContainText("未推测到首次出场人物");
});

test("AI Generate controls keep mobile touch sizes and allow an unlimited word target", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/articles/article-main/outlines/outline-current/generate");

  const wordTarget = page.getByRole("textbox", { name: "正文目标字数" });
  await wordTarget.scrollIntoViewIfNeeded();
  const wordBounds = await wordTarget.boundingBox();
  expect(wordBounds).not.toBeNull();
  expect(wordBounds!.width).toBeGreaterThanOrEqual(150);
  expect(wordBounds!.height).toBeGreaterThanOrEqual(44);

  const optionBar = page.locator(".generate-option-bar");
  const optionMetrics = await optionBar.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(optionMetrics.scrollWidth).toBeLessThanOrEqual(optionMetrics.clientWidth);
  for (const selector of [".generate-excellent-fragments-toggle", ".generate-outline-title-toggle"]) {
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(48);
  }

  const submit = page.getByRole("button", { name: "开始生成" });
  const submitBounds = await submit.boundingBox();
  expect(submitBounds).not.toBeNull();
  expect(submitBounds!.width).toBeGreaterThanOrEqual(250);
  expect(submitBounds!.height).toBeGreaterThanOrEqual(48);

  const singleLineText = page.locator([
    ".generate-mode-options button > span:not(.ui-title)",
    ".generate-excellent-fragments-toggle .ui-label",
    ".generate-excellent-fragments-toggle small",
    ".generate-outline-title-toggle .ui-label",
    ".generate-outline-title-toggle small",
    ".generate-first-appearance-heading small",
    ".generate-context-copy .ui-title",
    ".generate-model-control .mantine-Select-input",
    ".generate-auto-apply-note",
  ].join(","));
  const textMetrics = await singleLineText.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
    return { height: element.getBoundingClientRect().height, lineHeight, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
  }));
  expect(textMetrics.length).toBeGreaterThan(0);
  for (const metric of textMetrics) {
    expect(metric.height).toBeLessThanOrEqual(metric.lineHeight + 2);
    expect(metric.scrollWidth).toBeLessThanOrEqual(metric.clientWidth + 1);
  }

  await wordTarget.fill("0");
  await wordTarget.press("Tab");
  await expect(wordTarget).toHaveValue("");
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: { settings: { generateTargetWords: number } } };
    return payload.data.settings.generateTargetWords;
  }).toBe(0);

  await wordTarget.fill("500");
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: { settings: { generateTargetWords: number } } };
    return payload.data.settings.generateTargetWords;
  }).toBe(500);
  await wordTarget.fill("");
  await wordTarget.press("Tab");
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: { settings: { generateTargetWords: number } } };
    return payload.data.settings.generateTargetWords;
  }).toBe(0);
});

test("AI Generate shows the configured model and no longer lists candidate bodies", async ({ page, request }, testInfo) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ id: "model-remote", name: "Remote Writer", modelId: "provider/gpt-4.2-current", hasSecret: true, timeoutMs: 600_000 }] }),
    });
  });
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const outline = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  outline.versions[0].source = "AI Generate";
  outline.versions[0].model = "Remote Writer";
  outline.versions[0].modelId = "provider/gpt-4.1-mini";
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const model = page.getByRole("combobox", { name: "本次模型" });
  await expect(model).toBeVisible();
  await model.click();
  await expect(page.getByRole("option", { name: "Remote Writer · gpt-4.2-current" })).toBeVisible();
  await page.getByRole("option", { name: "Remote Writer · gpt-4.2-current" }).click();
  await expect(model).toHaveValue("Remote Writer · gpt-4.2-current");
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    return payload.data.settings.generateModel;
  }).toBe("model-remote");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "本次模型" })).toHaveValue("Remote Writer · gpt-4.2-current");
  await expect(page.getByText("候选版本", { exact: true })).toHaveCount(0);
  await expect(page.locator(".candidate-card")).toHaveCount(0);
  await expect(page.getByText(testInfo.project.name === "mobile-chromium" ? "成功后自动设为当前正文，并保留为版本。" : "任务成功后会自动设为该大纲的当前正文，并保留在正文版本中。", { exact: true })).toBeVisible();
});

test("workspace AI tabs render before a background save finishes and reuse the preloaded model list", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop timing contract");
  let modelRequests = 0;
  await page.route("**/api/models", async (route) => {
    modelRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ id: "model-remote", name: "Remote Writer", modelId: "provider/gpt-4.2-current", hasSecret: true, timeoutMs: 600_000 }] }),
    });
  });
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await expect.poll(() => modelRequests).toBe(1);

  let releaseSave = () => undefined;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT") await saveGate;
    await route.continue();
  });
  await page.locator(".section-heading").click();
  await expect(page.locator(".save-state")).toContainText("未保存");

  try {
    await page.getByRole("tab", { name: "AI Chat" }).click();
    await expect(page.locator(".chat-view")).toBeVisible({ timeout: 800 });
  } finally {
    releaseSave();
  }
  await page.getByRole("tab", { name: "AI Generate" }).click();
  await expect(page.locator(".generate-view")).toBeVisible();
  expect(modelRequests).toBe(1);
});

test("desktop writing menu can save the current body as a named version", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  const saveAs = page.getByRole("button", { name: "另存为正文版本", exact: true });
  await expect(saveAs).toBeVisible();
  let dialogMessage = "";
  let dialogDefault = "";
  page.once("dialog", async (dialog) => { dialogMessage = dialog.message(); dialogDefault = dialog.defaultValue(); await dialog.accept("定稿版本"); });
  await saveAs.click();
  expect(dialogMessage).toBe("另存为正文版本");
  expect(dialogDefault).toMatch(/-复制$/);
  await expect(page.locator(".toast")).toContainText("已另存为「定稿版本」");

  const response = await request.get("/api/state");
  const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
  const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  expect({
    name: outline.versions[0].name,
    source: outline.versions[0].source,
    currentVersionId: outline.currentVersionId,
    defaultVersionId: outline.defaultVersionId,
    versionCount: outline.versions.length,
  }).toEqual({ name: "定稿版本", source: "手动", currentVersionId: null, defaultVersionId: null, versionCount: 2 });
});

test("desktop writing save updates the current body without creating a version or duplicate default", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  target.currentVersionId = "version-manual";
  target.defaultVersionId = "version-manual";
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByLabel("正文内容").waitFor({ state: "visible", timeout: 30_000 });
  await expect(page.getByLabel("正文内容")).toHaveText("不可变版本正文");
  await page.getByLabel("正文内容").dblclick();
  await page.getByLabel("正文编辑器").fill("直接保存的当前正文");
  await page.getByRole("button", { name: "保存正文", exact: true }).click();
  await expect(page.getByLabel("正文内容")).toHaveText("直接保存的当前正文");
  await expect(page.getByLabel("此正文大纲内容")).toHaveText("生成时的大纲快照：林澈在七码头确认潮汐密钥。");

  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
    return {
      content: outline.content,
      currentVersionId: outline.currentVersionId,
      defaultVersionId: outline.defaultVersionId,
      outlineSnapshot: outline.contentOutlineSnapshot,
      versionCount: outline.versions.length,
      versionContent: outline.versions[0].content,
    };
  }).toEqual({
    content: "直接保存的当前正文",
    currentVersionId: null,
    defaultVersionId: "version-manual",
    outlineSnapshot: { title: "生成时码头", plan: "生成时的大纲快照：林澈在七码头确认潮汐密钥。" },
    versionCount: 1,
    versionContent: "不可变版本正文",
  });

  await page.reload();
  await expect(page.getByLabel("正文内容")).toHaveText("直接保存的当前正文");
  await expect(page.getByLabel("此正文大纲内容")).toHaveText("生成时的大纲快照：林澈在七码头确认潮汐密钥。");

  await page.getByRole("button", { name: "版本", exact: true }).click();
  await expect(page.locator(".version-list article em").filter({ hasText: "默认" })).toHaveCount(1);
});

test("editing a previewed body inherits that version's outline snapshot", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  target.currentVersionId = "version-manual";
  target.defaultVersionId = "version-manual";
  target.versions.unshift({
    id: "version-preview-source",
    name: "预览来源正文",
    content: "准备手动修改的预览正文",
    source: "AI Generate",
    createdAt: "2026-08-15T00:00:00.000Z",
    outlineSnapshot: { title: "预览生成时标题", plan: "预览正文独有的大纲快照。" },
  });
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "版本", exact: true }).click();
  await page.locator(".version-list article").filter({ hasText: "预览来源正文" }).locator(".version-preview-main").click();
  await page.getByRole("button", { name: "关闭正文版本" }).click();
  await expect(page.getByLabel("正文内容")).toHaveText("准备手动修改的预览正文");
  await page.getByLabel("正文内容").dblclick();
  await page.getByLabel("正文编辑器").fill("从预览版本修改并保存的当前正文");
  await page.getByRole("button", { name: "保存正文", exact: true }).click();

  await expect(page.getByLabel("正文内容")).toHaveText("从预览版本修改并保存的当前正文");
  await expect(page.getByLabel("此正文大纲内容")).toHaveText("预览正文独有的大纲快照。");
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
    return {
      currentVersionId: outline.currentVersionId,
      defaultVersionId: outline.defaultVersionId,
      outlineSnapshot: outline.contentOutlineSnapshot,
      versionCount: outline.versions.length,
    };
  }).toEqual({
    currentVersionId: null,
    defaultVersionId: "version-manual",
    outlineSnapshot: { title: "预览生成时标题", plan: "预览正文独有的大纲快照。" },
    versionCount: 2,
  });
});

test("Generate outline editing stays local until one explicit save", async ({ page, request }, testInfo) => {
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const editor = page.getByLabel("生成使用的大纲内容");
  const save = page.getByRole("button", { name: "保存大纲", exact: true });
  const original = await editor.inputValue();
  await expect(save).toBeDisabled();

  const changed = `${original}\n手机端临时修改`;
  await editor.fill(changed);
  await expect(save).toBeEnabled();
  await expect(page.getByText("有未保存修改", { exact: true })).toBeVisible();
  await page.waitForTimeout(1_000);
  const unchanged = await request.get("/api/state");
  const unchangedState = await unchanged.json() as { data: ReturnType<typeof fullStudioFixture> };
  expect(unchangedState.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")?.plan).toBe(original);
  await expect(page.getByRole("dialog", { name: "处理保存冲突" })).toHaveCount(0);

  if (testInfo.project.name === "mobile-chromium") {
    const bounds = await save.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(40);
  }
  await save.click();
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    return state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")?.plan;
  }).toBe(changed);
  await expect(save).toBeDisabled();
  await expect(page.locator(".generate-outline-save-state")).toHaveText("已保存");
  await expect(page.getByRole("dialog", { name: "处理保存冲突" })).toHaveCount(0);
});

test("desktop version chooser previews the selected body and P sets it as default", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "版本", exact: true }).click();
  const [bodyBounds, versionBounds] = await Promise.all([
    page.locator(".writing-canvas").boundingBox(),
    page.locator(".version-drawer-shell").boundingBox(),
  ]);
  expect(bodyBounds).not.toBeNull();
  expect(versionBounds).not.toBeNull();
  expect(Math.abs(versionBounds!.width - bodyBounds!.width)).toBeLessThanOrEqual(1);
  const candidate = page.locator(".version-list article").filter({ hasText: "手动快照" });
  await candidate.locator(".version-preview-main").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("手动快照正文内容")).toContainText("不可变版本正文");
  await page.getByRole("button", { name: "关闭正文版本" }).click();
  await expect(page.locator(".version-drawer")).toHaveCount(0);
  await expect(page.locator(".version-preview-bar")).toHaveCount(0);
  await expect(page.getByLabel("正文内容")).toContainText("不可变版本正文");
  await expect(page.getByText("只读", { exact: true })).toHaveCount(0);
  await expect(page.locator(".content-word-count")).toHaveText("7 字");
  await expect(page.locator(".start-edit-button,.appreciate-body-button,.set-default-body-button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "设为当前", exact: true })).toBeVisible();
  const bodyTitle = page.getByRole("button", { name: "正文标题，双击设为默认正文" });
  await expect(bodyTitle).toContainText("手动快照");
  const previewState = await request.get("/api/state");
  const previewPayload = await previewState.json() as { data: ReturnType<typeof fullStudioFixture> };
  const previewOutline = previewPayload.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  expect({ currentVersionId: previewOutline.currentVersionId, defaultVersionId: previewOutline.defaultVersionId }).toEqual({ currentVersionId: null, defaultVersionId: null });
  await page.getByRole("button", { name: "设为当前", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("已设为当前正文");
  await expect(page.getByText("当前", { exact: true })).toBeVisible();
  const defaultButton = page.getByRole("button", { name: "设为默认正文", exact: true });
  await expect(defaultButton).toHaveAttribute("aria-pressed", "false");
  await defaultButton.click();
  await expect(page.locator(".toast")).toContainText("已设为默认正文");
  await expect(page.getByRole("button", { name: "取消默认正文", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "版本", exact: true }).click();
  await expect(page.locator(".version-list article")).toHaveCount(1);
  await expect(page.locator(".version-list article").filter({ hasText: "手动快照" })).toHaveCount(1);
  await page.getByRole("button", { name: "关闭正文版本" }).click();

  const response = await request.get("/api/state");
  const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
  const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  expect({ currentVersionId: outline.currentVersionId, defaultVersionId: outline.defaultVersionId, versionCount: outline.versions.length }).toEqual({ currentVersionId: "version-manual", defaultVersionId: "version-manual", versionCount: 1 });
});

test("desktop direct current body creates one version when set as default", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  target.content = "直接保存后准备设为默认的正文";
  target.contentName = "当前正文名称";
  target.currentVersionId = null;
  target.defaultVersionId = "version-manual";
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/write");
  await expect(page.getByLabel("正文内容")).toHaveText("直接保存后准备设为默认的正文");
  await page.getByRole("button", { name: "设为默认正文", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("已设为默认正文");

  const response = await request.get("/api/state");
  const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
  const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  expect(outline.versions).toHaveLength(2);
  expect(outline.currentVersionId).toBe(outline.versions[0].id);
  expect(outline.defaultVersionId).toBe(outline.versions[0].id);
  expect(outline.versions[0]).toMatchObject({ name: "当前正文名称", content: "直接保存后准备设为默认的正文", source: "手动" });
});

test("desktop P cancels the current default body", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  target.currentVersionId = "version-manual";
  target.defaultVersionId = "version-manual";
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/write");
  await expect(page.getByLabel("正文内容")).toHaveText("不可变版本正文");
  await page.getByRole("button", { name: "取消默认正文", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("已取消默认正文");
  await expect(page.getByLabel("正文内容")).toHaveText("不可变版本正文");

  const response = await request.get("/api/state");
  const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
  const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  expect(outline.currentVersionId).toBe("version-manual");
  expect(outline.defaultVersionId).toBeNull();
  expect(outline.versions).toHaveLength(1);
});

test("body title markers expose default and persist manual excellence", async ({ page, request }, testInfo) => {
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  target.currentVersionId = "version-manual";
  target.defaultVersionId = "version-manual";
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/write");
  const title = page.getByRole("button", { name: "正文标题，双击取消默认正文" });
  const defaultButton = page.getByRole("button", { name: "取消默认正文", exact: true });
  const excellentButton = page.getByRole("button", { name: "设为优秀正文", exact: true });
  await expect(title).toContainText("手动快照");
  await expect(defaultButton).toHaveText("P");
  await expect(defaultButton).toHaveAttribute("aria-pressed", "true");
  await expect(excellentButton).toHaveText("★");
  await expect(excellentButton).toHaveAttribute("aria-pressed", "false");
  const [titleBounds, defaultBounds, excellentBounds] = await Promise.all([title.boundingBox(), defaultButton.boundingBox(), excellentButton.boundingBox()]);
  expect(titleBounds).not.toBeNull();
  expect(defaultBounds).not.toBeNull();
  expect(excellentBounds).not.toBeNull();
  expect(defaultBounds!.x).toBeGreaterThanOrEqual(titleBounds!.x + titleBounds!.width - 1);
  expect(defaultBounds!.x - (titleBounds!.x + titleBounds!.width)).toBeLessThanOrEqual(5);
  expect(excellentBounds!.x).toBeGreaterThan(defaultBounds!.x);
  expect(defaultBounds!.width).toBeLessThanOrEqual(testInfo.project.name === "mobile-chromium" ? 34 : 26);

  await excellentButton.click();
  await expect(page.locator(".toast")).toContainText("已手动设为优秀正文");
  await expect(page.getByRole("button", { name: "取消手动优秀正文", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> & { articles: Array<{ chapters: Array<{ outlines: Array<{ id: string; manualExcellent?: boolean; versions: Array<{ id: string; manualExcellent?: boolean }> }> }> }> } };
    const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
    return { outline: outline.manualExcellent, version: outline.versions.find((version) => version.id === "version-manual")?.manualExcellent };
  }).toEqual({ outline: false, version: true });

  await page.reload();
  const persistedButton = page.getByRole("button", { name: "取消手动优秀正文", exact: true });
  await expect(persistedButton).toHaveAttribute("aria-pressed", "true");
  await persistedButton.click();
  await expect(page.getByRole("button", { name: "设为优秀正文", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("selection context menu toggles appreciation, marks candidates, and exposes AI context", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop text selection");
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")! as unknown as {
    content: string;
    contentName?: string;
    currentVersionId: string | null;
    excellentFragments?: unknown[];
  };
  target.content = "第一段值得欣赏的文字。\n\n第二段保持普通。";
  target.contentName = "欣赏测试正文";
  target.currentVersionId = null;
  target.excellentFragments = [];
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/write");
  const reader = page.getByLabel("正文内容");
  await selectReaderTextAndOpenMenu(reader, "值得欣赏");
  await page.getByRole("menuitemcheckbox", { name: "欣赏" }).click();
  await expect(reader.locator("mark.excellent-fragment")).toHaveText("值得欣赏");
  await expect(page.getByRole("button", { name: "手动保留优秀正文", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: { articles: Array<{ chapters: Array<{ outlines: Array<{ id: string; excellentFragments?: Array<{ text: string }> }> }> }> } };
    return state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")?.excellentFragments?.[0]?.text;
  }).toBe("值得欣赏");

  await selectReaderTextAndOpenMenu(reader, "值得欣赏");
  const checkedAppreciation = page.getByRole("menuitemcheckbox", { name: "欣赏" });
  await expect(checkedAppreciation).toHaveAttribute("aria-checked", "true");
  await checkedAppreciation.click();
  await expect(reader.locator("mark.excellent-fragment")).toHaveCount(0);

  await selectReaderTextAndOpenMenu(reader, "值得欣赏");
  await page.getByRole("menuitemcheckbox", { name: "欣赏" }).click();
  await expect(reader.locator("mark.excellent-fragment")).toHaveText("值得欣赏");

  await page.getByRole("button", { name: "版本" }).click();
  await expect(page.locator(".version-list article.current .excellent-fragment-dot")).toBeVisible();
  await page.getByRole("button", { name: "关闭正文版本" }).click();
  await page.getByRole("tab", { name: "AI Generate" }).click();
  await expect(page.locator(".generate-excellent-fragments-toggle input")).not.toBeChecked();
  await page.locator(".generate-context-summary").click();
  const excellentOption = page.locator(".generate-context-panel").getByLabel("参考优秀片段");
  await expect(excellentOption).not.toBeChecked();
  await excellentOption.check();
  await expect(page.locator(".generate-context-panel")).toContainText("1 个");
});

test("selecting body text automatically opens the appreciation menu on desktop and mobile", async ({ page, request }, testInfo) => {
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  target.content = "手机和桌面选中文字后，都应显示应用内欣赏菜单。";
  target.currentVersionId = null;
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/write");
  const reader = page.getByLabel("正文内容");
  await selectReaderText(reader, "应用内欣赏菜单");
  const menu = page.getByRole("menu", { name: "正文选择菜单" });
  await expect(menu).toBeVisible();
  await expectInsideViewport(page, menu);
  const appreciation = page.getByRole("menuitemcheckbox", { name: "欣赏" });
  if (testInfo.project.name === "mobile-chromium") {
    const bounds = await appreciation.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  await appreciation.click();
  await expect(reader.locator("mark.excellent-fragment")).toHaveText("应用内欣赏菜单");
});

test("body double-click and touch double-tap enter editing without losing the reading position", async ({ page, request }, testInfo) => {
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  target.content = Array.from({ length: 140 }, (_, index) => `第 ${index + 1} 段：潮声越过防波堤，林澈沿着水痕继续向前。`).join("\n\n");
  target.currentVersionId = null;
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/write");
  const reader = page.getByLabel("正文内容");
  const readingRatio = await reader.evaluate((element) => {
    const max = element.scrollHeight - element.clientHeight;
    element.scrollTop = max * 0.62;
    return element.scrollTop / max;
  });
  expect(readingRatio).toBeGreaterThan(0.5);
  if (testInfo.project.name === "mobile-chromium") await doubleTouch(reader);
  else await reader.dblclick();
  const editor = page.getByLabel("正文编辑器");
  await expect(editor).toBeVisible();
  await expect.poll(async () => editor.evaluate((element) => element.scrollTop / (element.scrollHeight - element.clientHeight))).toBeGreaterThan(0.5);
  const editingRatio = await editor.evaluate((element) => element.scrollTop / (element.scrollHeight - element.clientHeight));
  expect(Math.abs(editingRatio - readingRatio)).toBeLessThan(0.04);
  expect(await editor.evaluate((element) => element.selectionStart)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "退出编辑" }).click();
  await expect(page.getByLabel("正文内容")).toBeVisible();
  await expect.poll(async () => reader.evaluate((element) => element.scrollTop / (element.scrollHeight - element.clientHeight))).toBeGreaterThan(0.5);
  const restoredRatio = await reader.evaluate((element) => element.scrollTop / (element.scrollHeight - element.clientHeight));
  expect(Math.abs(restoredRatio - editingRatio)).toBeLessThan(0.04);
});

test("switching outlines shows each target's current body independently of its default", async ({ page, request }, testInfo) => {
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const currentOutline = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  currentOutline.content = "仅在当前大纲显示的正文";
  currentOutline.currentVersionId = null;
  const previousOutline = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-previous")!;
  previousOutline.versions = [{ id: "version-previous-default", name: "前序默认版本", content: "前序大纲的默认正文", source: "手动", createdAt: "2026-07-28T08:00:00.000Z", outlineSnapshot: { title: previousOutline.title, plan: previousOutline.plan } }];
  previousOutline.currentVersionId = "version-previous-default";
  previousOutline.defaultVersionId = null;
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  if (testInfo.project.name === "mobile-chromium") {
    await page.goto("/");
    await page.locator('[data-outline-id="outline-current"] .mobile-outline-main').click();
    await expect(page.getByLabel("正文内容")).toContainText("仅在当前大纲显示的正文");
    await page.getByRole("button", { name: "返回大纲" }).click();
    await page.locator('[data-outline-id="outline-previous"] .mobile-outline-main').click();
  } else {
    await page.goto("/articles/article-main/outlines/outline-current/write");
    await expect(page.getByLabel("正文内容")).toContainText("仅在当前大纲显示的正文");
    await page.getByRole("button", { name: "前序灯塔", exact: true }).click();
  }
  await expect(page.getByLabel("正文内容")).toHaveText("前序大纲的默认正文");
});

test("mobile starts at outline and separates article and global entry points", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "大纲" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主要功能" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "AI 任务" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置" })).toBeVisible();

  await page.getByRole("button", { name: /切换文章，当前/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  for (const name of ["全大纲编辑", "全文编辑", "搜索", "文章资料"]) await expect(page.getByRole("button", { name })).toBeVisible();
  await expect(page.getByLabel("搜索文章")).toBeVisible();
  await page.getByRole("button", { name: "关闭文章菜单" }).click();

  const more = page.getByRole("button", { name: "当前码头更多操作" });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByText("大纲操作", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑大纲" })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Chat 大纲" })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Generate 大纲" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新生成大纲名字" })).toBeVisible();
  await expect(page.getByRole("button", { name: "删除大纲" })).toBeVisible();
  await page.getByRole("button", { name: "关闭大纲操作" }).click();

  await page.getByRole("button", { name: "AI 任务" }).click();
  await expect(page.getByRole("dialog").getByText("AI 任务", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭 AI 任务" }).click();
  await page.getByRole("button", { name: "设置" }).click();
  for (const name of ["常规", "外观与编辑器", "AI 模型", "AI 任务", "数据库", "系统与诊断"]) await expect(page.getByRole("button", { name })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("mobile outline and chapter menus share a compact readable action layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.goto("/");

  async function expectReadableMenu(expectedActionCount: number) {
    const sheet = page.locator(".outline-action-drawer");
    await expectOverlayContract(page, sheet);
    const actions = sheet.locator(".ws-action-sheet-list > button");
    await expect(actions).toHaveCount(expectedActionCount);
    const metrics = await actions.evaluateAll((buttons) => buttons.map((button) => {
      const label = button.querySelector(":scope > span:last-child") as HTMLElement | null;
      return {
        iconCount: button.querySelectorAll(":scope > .ws-action-sheet-icon").length,
        labelWidth: label?.getBoundingClientRect().width ?? 0,
        lineHeight: label ? Number.parseFloat(getComputedStyle(label).lineHeight) : 0,
        fontSize: label ? Number.parseFloat(getComputedStyle(label).fontSize) : 0,
      };
    }));
    expect(metrics.every((item) => item.iconCount === 1)).toBe(true);
    expect(Math.min(...metrics.map((item) => item.labelWidth))).toBeGreaterThan(74);
    expect(metrics.every((item) => item.lineHeight >= item.fontSize * 1.3)).toBe(true);
    const sheetBounds = await sheet.boundingBox();
    expect(sheetBounds).not.toBeNull();
    expect(sheetBounds!.height).toBeLessThan(page.viewportSize()!.height * 0.75);
  }

  await page.getByRole("button", { name: "当前码头更多操作", exact: true }).click();
  await expectReadableMenu(10);
  await page.getByRole("button", { name: "关闭大纲操作", exact: true }).click();

  await page.getByRole("button", { name: "第一章更多操作", exact: true }).click();
  await expectReadableMenu(7);
  await page.getByRole("button", { name: "关闭章节菜单", exact: true }).click();
});

test("mobile outline swipe archives and restores without opening the more menu", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.goto("/");

  const showArchived = page.getByRole("switch", { name: "显示归档大纲" });
  await expect(showArchived).toHaveAttribute("aria-checked", "false");
  const current = page.locator('[data-outline-id="outline-current"]');
  await swipeOutlineLeft(current.locator(".mobile-outline-main"));
  await expect(current).toHaveClass(/reveal-left/);

  await current.getByRole("button", { name: "归档大纲：当前码头" }).click();
  await expect(page.getByText("大纲操作", { exact: true })).toHaveCount(0);
  await expect(current).toHaveCount(0);
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json();
    return payload.data.articles[0].chapters[0].outlines.find((outline: { id: string }) => outline.id === "outline-current")?.archived;
  }).toBe(true);

  await showArchived.click();
  await expect(showArchived).toHaveAttribute("aria-checked", "true");
  const archivedCurrent = page.locator('[data-outline-id="outline-current"]');
  await expect(archivedCurrent).toBeVisible();
  await expect(archivedCurrent.locator(".swipe-manage")).toHaveCSS("visibility", "hidden");
  await swipeOutlineLeft(archivedCurrent.locator(".mobile-outline-main"));
  await expect(archivedCurrent).toHaveClass(/reveal-left/);
  await expect(archivedCurrent.locator(".swipe-manage")).toHaveCSS("visibility", "visible");
  await archivedCurrent.getByRole("button", { name: "恢复大纲：当前码头" }).click();
  await expect(archivedCurrent).toBeVisible();

  await showArchived.click();
  await expect(showArchived).toHaveAttribute("aria-checked", "false");
  await expect(archivedCurrent).toBeVisible();
  await expect(page.locator('[data-outline-id="outline-archived"]')).toHaveCount(0);
});

test("full outline editor shows every plan in one auto-growing document", async ({ page, request }) => {
  await page.goto("/articles/article-main/outlines/edit-all");
  const editor = page.locator(".continuous-document-editor.outline");
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("heading", { name: "第一章" })).toBeVisible();

  const plan = editor.getByLabel("大纲内容：当前码头");
  const nextPlan = "潮位正在快速回落。\n\n林澈必须在巡逻队抵达前找到暗门。\n\n远处灯塔给出新的信号。";
  await plan.fill(nextPlan);
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    return payload.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")?.plan;
  }).toBe(nextPlan);

  const dimensions = await plan.evaluate((element) => {
    const style = getComputedStyle(element);
    return { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: style.overflowY };
  });
  expect(dimensions.clientHeight).toBeGreaterThanOrEqual(dimensions.scrollHeight - 2);
  expect(dimensions.overflowY).toBe("hidden");
});

test("full content editor saves the current body without creating a version", async ({ page, request }) => {
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  target.currentVersionId = "version-manual";
  target.defaultVersionId = "version-manual";
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/edit");
  const editor = page.locator(".continuous-document-editor.content");
  const body = editor.getByLabel("正文：当前码头");
  await expect(body).toHaveValue("不可变版本正文");
  const nextContent = "码头的风从仓库缝隙灌进来。\n\n林澈合上怀表，沿着水痕走向暗门。";
  await body.fill(nextContent);
  await editor.getByRole("heading", { name: "严格测试文章" }).click();

  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
    return outline.currentVersionId === null
      && outline.defaultVersionId === "version-manual"
      && outline.content === nextContent
      && outline.versions[0]?.content === "不可变版本正文"
      && outline.versions.length === 1;
  }).toBe(true);

  const dimensions = await body.evaluate((element) => {
    const style = getComputedStyle(element);
    return { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: style.overflowY };
  });
  expect(dimensions.clientHeight).toBeGreaterThanOrEqual(dimensions.scrollHeight - 2);
  expect(dimensions.overflowY).toBe("hidden");
  await page.reload();
  const reloadedEditor = page.locator(".continuous-document-editor.content");
  await expect(reloadedEditor.getByLabel("正文：当前码头")).toHaveValue(nextContent);
  await expect(reloadedEditor.getByRole("button", { name: "选择正文版本：当前码头" })).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
});

test("full content title row exposes AI Review and reusable multi-select requirements", async ({ page }) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ id: "review-model", name: "Kimi Review", modelId: "accounts/fireworks/models/kimi-k2p6", hasSecret: true, timeoutMs: 600_000 }] }),
    });
  });
  await page.goto("/articles/article-main/edit");
  const editor = page.locator(".continuous-document-editor.content");
  const title = editor.getByRole("heading", { name: "严格测试文章" });
  const review = editor.getByRole("button", { name: "AI Review" });
  await expect(review).toBeVisible();
  const [titleBounds, reviewBounds] = await Promise.all([title.boundingBox(), review.boundingBox()]);
  expect(titleBounds).not.toBeNull();
  expect(reviewBounds).not.toBeNull();
  expect(reviewBounds!.x).toBeGreaterThan(titleBounds!.x);
  await review.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("固定检查", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Review 章节")).toBeVisible();
  await expect(dialog.getByLabel("模型")).toHaveValue("Kimi Review · kimi-k2p6");
  const additional = dialog.getByLabel("本次附加要求");
  await additional.fill("统一雨景中的感官描写");
  await dialog.getByRole("button", { name: "保存为预定义要求" }).click();
  await expect(dialog.getByRole("checkbox", { name: "统一雨景中的感官描写" })).toBeChecked();
});

test("each body in full content editing can preview and independently set current and default", async ({ page, request }) => {
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  target.currentVersionId = "version-manual";
  target.defaultVersionId = "version-manual";
  target.versions.unshift({
    id: "version-ai-candidate",
    name: "AI 候选稿",
    content: "潮声越过防波堤，林澈在暗门前停下脚步。",
    source: "AI",
    createdAt: "2026-07-28T09:00:00.000Z",
  });
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/edit");
  const editor = page.locator(".continuous-document-editor.content");
  const body = editor.getByLabel("正文：当前码头");
  await expect(body).toHaveValue("不可变版本正文");
  await editor.getByRole("button", { name: "选择正文版本：当前码头" }).click();
  await page.getByRole("menuitem").filter({ hasText: "AI 候选稿" }).click();
  await expect(body).toHaveValue("潮声越过防波堤，林澈在暗门前停下脚步。");

  const previewState = await request.get("/api/state");
  const previewPayload = await previewState.json() as { data: ReturnType<typeof fullStudioFixture> };
  expect(previewPayload.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")?.currentVersionId).toBe("version-manual");

  await editor.getByRole("button", { name: "将“AI 候选稿”设为默认正文" }).click();
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
    return { currentVersionId: outline.currentVersionId, defaultVersionId: outline.defaultVersionId };
  }).toEqual({ currentVersionId: "version-manual", defaultVersionId: "version-ai-candidate" });
  await page.reload();
  await expect(page.locator(".continuous-document-editor.content").getByLabel("正文：当前码头")).toHaveValue("不可变版本正文");
  const reloadedEditor = page.locator(".continuous-document-editor.content");
  await reloadedEditor.getByRole("button", { name: "选择正文版本：当前码头" }).click();
  await page.getByRole("menuitem").filter({ hasText: "AI 候选稿" }).click();
  await reloadedEditor.getByRole("button", { name: "将“AI 候选稿”设为当前正文" }).click();
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    return state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")?.currentVersionId;
  }).toBe("version-ai-candidate");
  await page.reload();
  await expect(page.locator(".continuous-document-editor.content").getByLabel("正文：当前码头")).toHaveValue("潮声越过防波堤，林澈在暗门前停下脚步。");
});

test("full outline editor supports keyboard reordering from its explicit handle", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop keyboard layout");
  await page.goto("/articles/article-main/outlines/edit-all");
  const editor = page.locator(".continuous-document-editor.outline");
  const handle = editor.getByRole("button", { name: "拖动排序：当前码头" });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".continuous-drag-overlay")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(180);
  await page.keyboard.press("Space");
  await expect.poll(() => editor.locator("[data-continuous-outline-id]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-continuous-outline-id")))).toEqual([
    "outline-previous",
    "outline-after",
    "outline-current",
  ]);
});

test("AI tasks are ordered by submission time regardless of status", async ({ page, request }) => {
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number; data: ReturnType<typeof fullStudioFixture> };
  const fixture = payload.data;
  const baseTask = { articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "正文" as const, model: "", resultText: "结果" };
  fixture.tasks = [
    { ...baseTask, id: "task-middle-success", prompt: "中间提交的成功任务", state: "success", createdAt: "2026-07-28T09:00:00.000Z" },
    { ...baseTask, id: "task-old-failed", prompt: "最早提交的失败任务", state: "failed", error: "测试失败", createdAt: "2026-07-28T08:00:00.000Z" },
    { ...baseTask, id: "task-new-cancelled", prompt: "最新提交的取消任务", state: "cancelled", resultText: "很长的任务结果\n".repeat(200), createdAt: "2026-07-28T10:00:00.000Z", contextOptions: { includePrevious: true, includeCharacters: false, targetWords: 5000 } },
  ];
  fixture.tasks[2] = { ...fixture.tasks[2], phase: "receiving", attempt: 2, startedAt: "2026-07-28T09:59:00.000Z", completedAt: "2026-07-28T10:00:00.000Z", lastProgressAt: "2026-07-28T09:59:58.000Z", receivedCharacters: 2048, timeoutMs: 600_000 };
  const saved = await request.put("/api/state", { headers: { "If-Match": String(payload.revision) }, data: { data: fixture, conflictResolution: "keep-local" } });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/");
  await page.getByRole("button", { name: /^AI 任务/ }).click();
  await expect(page.locator(".task-card blockquote")).toHaveText([
    "最新提交的取消任务",
    "中间提交的成功任务",
    "最早提交的失败任务",
  ]);
  const newestTask = page.locator(".task-card").filter({ hasText: "最新提交的取消任务" });
  await newestTask.getByRole("button", { name: "打开", exact: true }).click();
  const taskDetail = page.getByRole("region", { name: "任务详情" });
  await expect(taskDetail).toBeVisible();
  await expect(taskDetail).toContainText("接收结果");
  await expect(taskDetail).toContainText("2 / 3");
  await expect(taskDetail).toContainText("10 分 00 秒");
  await expect(taskDetail).toContainText("2,048 字符");
  await expect(taskDetail).toContainText("最新提交的取消任务");
  await expect(page.getByLabel("任务结果")).toContainText("很长的任务结果");
  const taskDetailActions = page.locator(".task-detail-actions");
  await expect(taskDetailActions).toBeVisible();
  const actionsBox = await taskDetailActions.boundingBox();
  const viewport = page.viewportSize();
  expect(actionsBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(actionsBox!.y + actionsBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
  await expect(page).not.toHaveURL(/settings\/models/);
  await page.getByRole("button", { name: "返回任务列表" }).click();
  const completedBodyTask = page.locator(".task-card").filter({ hasText: "中间提交的成功任务" });
  await expect(completedBodyTask.getByRole("button", { name: "应用结果" })).toHaveCount(0);
  await completedBodyTask.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page.getByRole("button", { name: "打开生成版本" })).toBeVisible();
  await expect(page.getByRole("button", { name: "应用结果" })).toHaveCount(0);
  await page.getByRole("button", { name: "返回任务列表" }).click();
  await page.getByRole("button", { name: "清空已完成 (1)" }).click();
  await expect(page.locator(".task-card blockquote")).toHaveText([
    "最新提交的取消任务",
    "最早提交的失败任务",
  ]);
});

test("AI Chat creates a completed task linked to its conversation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  test.setTimeout(60_000);
  await page.goto("/articles/article-main/outlines/outline-current/chat");
  await page.getByLabel("AI Chat 消息").fill("检查任务中心中的聊天记录");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("我参考了", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "停止回复" })).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole("button", { name: /^AI 任务/ }).click();
  const task = page.locator(".task-card").first();
  await expect(task).toContainText("检查任务中心中的聊天记录");
  await expect(task).toContainText("目标：AI Chat");
  await expect(task).toContainText("已完成", { timeout: 20_000 });
  await expect(task.getByRole("button", { name: "应用结果" })).toHaveCount(0);
  await task.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page.getByRole("region", { name: "任务详情" })).toContainText("检查任务中心中的聊天记录");
  await expect(page.getByLabel("任务结果")).toContainText("我参考了");
  await expect(page.getByRole("button", { name: "打开对应内容" })).toBeVisible();
});

test("AI Chat finishes after leaving and clears its unread marker when opened", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.route("**/api/outlines/outline-current/chat/stream", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "后台生成的聊天回复" });
  });

  await page.goto("/articles/article-main/outlines/outline-current/chat");
  await page.getByLabel("AI Chat 消息").fill("离开聊天后继续完成");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("button", { name: "停止回复" })).toBeVisible();
  await page.getByRole("tab", { name: "写作", exact: true }).click();

  await expect(page.getByLabel("有新生成的聊天回复")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: /AI Chat/ }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("后台生成的聊天回复");
  await page.getByRole("tab", { name: "写作", exact: true }).click();
  await expect(page.getByLabel("有新生成的聊天回复")).toHaveCount(0);

  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
    const session = outline.chat.sessions.find((item) => item.id === outline.chat.activeSessionId)!;
    return session.lastReadMessageId === session.messages.at(-1)?.id;
  }).toBe(true);
});

test("AI Chat can be cancelled from the task panel after leaving", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  let releaseResponse = () => undefined;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const responseTimeout = setTimeout(() => releaseResponse(), 15_000);
  await page.route("**/api/outlines/outline-current/chat/stream", async (route) => {
    await responseGate;
    await route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "这条回复不应覆盖取消状态" }).catch(() => undefined);
  });

  await page.goto("/articles/article-main/outlines/outline-current/chat");
  await page.getByLabel("AI Chat 消息").fill("离开后取消这项任务");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("button", { name: "停止回复" })).toBeVisible();
  await page.getByRole("tab", { name: "写作", exact: true }).click();
  await page.getByRole("button", { name: /^AI 任务/ }).click();
  const task = page.locator(".task-card").filter({ hasText: "离开后取消这项任务" });
  await expect(task).toContainText("运行中");
  await task.getByRole("button", { name: "取消", exact: true }).click();
  releaseResponse();
  clearTimeout(responseTimeout);

  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    const savedTask = state.data.tasks.find((item) => item.prompt === "离开后取消这项任务");
    const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
    return {
      taskState: savedTask?.state,
      hasLateReply: outline.chat.sessions.some((session) => session.messages.some((message) => message.text.includes("不应覆盖取消状态"))),
    };
  }).toEqual({ taskState: "cancelled", hasLateReply: false });
});

test("AI Chat message action menu closes when clicking elsewhere", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.goto("/articles/article-main/outlines/outline-current/chat");
  const trigger = page.getByRole("button", { name: "更多写作操作" }).last();
  await trigger.click();
  await expect(page.locator(".message-action-menu")).toBeVisible();
  await page.getByRole("tab", { name: /AI Chat/ }).click();
  await expect(page.locator(".message-action-menu")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("AI Chat displays the configured model name and id consistently", async ({ page }) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ id: "model-remote", name: "Remote Writer", modelId: "provider/gpt-4.1-mini", hasSecret: true, timeoutMs: 600_000 }] }),
    });
  });
  await page.goto("/articles/article-main/outlines/outline-current/chat");
  const model = page.getByLabel("聊天模型");
  await expect(model).toBeVisible();
  await model.selectOption("model-remote");
  await expect(model.locator("option:checked")).toHaveText("Remote Writer · gpt-4.1-mini");
  await expect(page.locator(".message.assistant .message-meta .ui-label").first()).toHaveText("Remote Writer · gpt-4.1-mini");
});

test("mobile icon controls use glass surfaces and consistent touch sizing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.goto("/");

  const header = page.locator(".mobile-outline-header");
  await expect(header.locator(":scope > button")).toHaveCount(3);
  const tasks = header.getByRole("button", { name: "AI 任务", exact: true });
  const settings = header.getByRole("button", { name: "设置", exact: true });
  const more = page.getByRole("button", { name: "当前码头更多操作", exact: true });
  for (const control of [tasks, settings, more]) await expectIconControl(control);

  const glass = await tasks.evaluate((element) => {
    const style = getComputedStyle(element);
    return { backdrop: style.backdropFilter, background: style.backgroundColor };
  });
  expect(glass.backdrop).toContain("blur");
  expect(glass.background).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.getByText("正文已保存", { exact: true })).toHaveCount(0);
  const chapterHeaders = page.locator(".mobile-chapter-card > header");
  for (let index = 0; index < await chapterHeaders.count(); index += 1) {
    await expect(chapterHeaders.nth(index).locator(":scope > .icon-button")).toHaveCount(1);
  }

  await page.locator('[data-outline-id="outline-current"] .mobile-outline-main').click();
  await expectIconControl(page.getByRole("button", { name: "返回大纲", exact: true }));
  await expectIconControl(page.getByRole("button", { name: "选择正文版本", exact: true }));
});

test("empty outline titles use the beginning of the outline as a one-line name", async ({ page, request }, testInfo) => {
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const outline = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  outline.title = "";
  outline.plan = "暴雨后的清晨，林澈推开修理铺的门。\n她在工作台上发现一封来自未来的信，信封边缘被海水泡得发白，背面写着她自己的名字。这个名称只应占据一行，多余文字由界面自然省略。";
  const expected = outline.plan.replace(/\s+/g, " ").trim().slice(0, 80);
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  if (testInfo.project.name === "mobile-chromium") {
    await page.goto("/");
    await expect(page.locator('[data-outline-id="outline-current"] .mobile-outline-main .ui-title')).toHaveText(expected);
  } else {
    await page.goto("/articles/article-main/outlines/outline-current/write");
    await expect(page.locator(".outline-row.selected .outline-title")).toHaveText(expected);
    await expect(page.getByLabel("大纲标题")).toHaveValue("");
    await expect(page.getByLabel("大纲标题")).toHaveAttribute("placeholder", expected);
  }
  await expect(page.getByText("未命名大纲", { exact: true })).toHaveCount(0);
});

test("desktop outline rows reserve the more menu beside long titles", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const outline = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  outline.title = "这是一个足够长的大纲标题，用来确认右侧三点菜单不会被标题内容覆盖，也不会随着标题长度消失";
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/");
  const row = page.locator('[data-outline-id="outline-current"]');
  const title = row.locator(".outline-title");
  const more = row.locator(".row-more");
  await row.hover();
  await expect(more).toBeVisible();
  const titleBounds = await title.boundingBox();
  const moreBounds = await more.boundingBox();
  expect(titleBounds).not.toBeNull();
  expect(moreBounds).not.toBeNull();
  expect(titleBounds!.x + titleBounds!.width).toBeLessThanOrEqual(moreBounds!.x + 1);
  await more.click();
  await expect(page.getByText("大纲操作", { exact: true })).toBeVisible();
});

test("dedicated naming menus preview one response before applying", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop naming workflow");
  test.setTimeout(60_000);
  let calls = 0;
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/ai/names", async (route) => {
    calls += 1;
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    const chapterRequest = requestBody.target === "chapter";
    const outlineIds = Array.isArray(requestBody.outlineIds) ? requestBody.outlineIds as string[] : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chapterRequest
        ? { chapterTitle: calls >= 3 ? "雾港密钥" : "潮汐密钥", outlineTitles: outlineIds.map((id, index) => ({ id, title: `潮汐线索${index + 1}` })), inputCharacters: 1260, maxInputCharacters: 60000 }
        : { outlineTitles: [{ id: "outline-current", title: "七码头潮汐密钥" }], inputCharacters: 860, maxInputCharacters: 60000 }),
    });
  });
  await page.goto("/");
  await page.locator('[data-outline-id="outline-current"] .row-more').click();
  await page.getByRole("button", { name: "重新生成大纲名字" }).click();
  await expect(page.getByText("只发送文章资料、命名设置和当前大纲内容，不发送现有章节名、大纲名、正文、正文版本或聊天记录。")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "名称生成模型" })).toHaveValue(/继承 AI Generate/);
  await page.getByRole("button", { name: "生成名称" }).click();
  await expect(page.getByLabel("生成的大纲名：当前码头")).toHaveValue("七码头潮汐密钥");
  expect(calls).toBe(1);
  expect(requestBody).toMatchObject({ target: "outline", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current" });
  expect(requestBody).not.toHaveProperty("content");
  expect(requestBody).not.toHaveProperty("reservedTitles");
  await page.getByRole("button", { name: "应用名称" }).click();
  await expect(page.locator('[data-outline-id="outline-current"] .outline-title')).toHaveText("七码头潮汐密钥");

  await page.getByLabel("第一章更多操作").click();
  await page.getByRole("button", { name: "AI生成名称" }).click();
  await expect(page.getByText("选择生成项目")).toBeVisible();
  await expect(page.getByRole("button", { name: "取消全选" })).toBeVisible();
  await expect(page.getByLabel("选择章节名")).toBeChecked();
  await expect(page.getByRole("button", { name: "生成所选名称" })).toBeVisible();
  await page.getByRole("button", { name: "取消全选" }).click();
  await expect(page.getByLabel("选择章节名")).not.toBeChecked();
  await page.getByLabel("选择章节名").check();
  await page.getByRole("button", { name: "生成所选名称" }).click();
  await expect(page.getByLabel("生成的章节名")).toHaveValue("潮汐密钥");
  expect(calls).toBe(2);
  expect(requestBody).toMatchObject({ target: "chapter", includeChapter: true, outlineIds: [] });
  expect(requestBody).not.toHaveProperty("reservedTitles");
  await page.getByRole("button", { name: "重新生成" }).click();
  await expect(page.getByLabel("生成的章节名")).toHaveValue("雾港密钥");
  expect(calls).toBe(3);
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("button", { name: "已应用", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "应用所有名称" })).toBeVisible();
});

test("desktop full outline editor provides a scrollable viewport", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const firstChapter = fixture.articles[0].chapters[0];
  const template = firstChapter.outlines[0];
  const now = "2026-07-28T08:00:00.000Z";
  firstChapter.outlines = Array.from({ length: 28 }, (_, index) => {
    const id = `outline-scroll-${index}`;
    return {
      ...template,
      id,
      title: `滚动测试大纲 ${index + 1}`,
      plan: `滚动测试内容 ${index + 1}。`.repeat(3),
      content: "",
      currentVersionId: null,
      defaultVersionId: null,
      contentOutlineSnapshot: { title: `滚动测试大纲 ${index + 1}`, plan: `滚动测试内容 ${index + 1}。`.repeat(3) },
      versions: [],
      chat: {
        sessions: [{ id: `chat:${id}`, title: "主会话", messages: [], draft: "", includePrevious: true, includeCharacters: true, createdAt: now, updatedAt: now }],
        activeSessionId: `chat:${id}`,
      },
    };
  });
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/edit-all");
  const viewport = page.locator(".page-scroll");
  const dimensions = await viewport.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(dimensions.overflowY).toBe("auto");
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  const scrollTop = await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
});

test("full outline editor opens AI Chat with context through the current outline", async ({ page }) => {
  await page.goto("/articles/article-main/outlines/edit-all");
  const current = page.locator('[data-continuous-outline-id="outline-current"]');
  await current.locator(".continuous-outline-more").click();
  await expect(page.getByRole("menuitem", { name: "AI Chat", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "AI Chat", exact: true }).click();

  const dialog = page.locator(".full-outline-chat-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("AI Chat · 当前码头");
  await dialog.locator(".composer-context-chip").click();
  const context = dialog.locator(".chat-context-panel");
  await expect(context).toBeVisible();
  await expect(context.getByText("前面全部大纲", { exact: true })).toBeVisible();
  await expect(context.getByText("前序灯塔", { exact: true })).toBeVisible();
  await expect(context.locator('input[type="checkbox"]').first()).toBeChecked();
});

test("mobile writing view previews a selected version and explicitly saves or discards edits", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.goto("/articles/article-main/outlines/outline-current/write");
  const reader = page.getByLabel("正文内容");
  await expect(reader).toHaveText("林澈看向顾屿，确认潮汐表上的时间。");
  const readerBounds = await reader.boundingBox();
  expect(readerBounds).not.toBeNull();
  expect(readerBounds!.height).toBeGreaterThan(450);
  await expect(page.getByText("只读", { exact: true })).toHaveCount(0);
  const headingName = page.locator(".body-title-toggle > span").first();
  await headingName.evaluate((element) => { element.textContent = "这是一个用于验证手机端按钮不会被压缩变形的非常长的正文名称"; });
  const headingLayout = await page.locator(".body-title-cluster").evaluate((element) => {
    const title = element.querySelector(".body-title-toggle > span") as HTMLElement;
    const buttons = Array.from(element.querySelectorAll(".body-status-button, .body-set-current-button")) as HTMLElement[];
    const tools = element.parentElement?.querySelector(".editor-tools") as HTMLElement;
    return {
      titleTruncated: title.scrollWidth > title.clientWidth,
      toolsShrink: getComputedStyle(tools).flexShrink,
      buttonShrink: buttons.map((button) => getComputedStyle(button).flexShrink),
    };
  });
  expect(headingLayout.titleTruncated).toBe(true);
  expect(headingLayout.toolsShrink).toBe("0");
  expect(headingLayout.buttonShrink.every((value) => value === "0")).toBe(true);

  await page.getByRole("button", { name: "选择正文版本" }).click();
  await expect(page.getByText("正文版本", { exact: true })).toBeVisible();
  await expect(page.locator(".version-list article.current em")).toContainText("当前");
  await expect(page.getByRole("button", { name: "保存当前正文为新版本" })).toBeVisible();
  const candidate = page.locator(".version-list article").filter({ hasText: "手动快照" });
  await candidate.locator(".version-preview-main").click();
  await expect(page.getByLabel("手动快照正文内容")).toContainText("不可变版本正文");
  await page.getByRole("button", { name: "关闭正文版本" }).click();
  await expect(page.locator(".version-drawer")).toHaveCount(0);
  await expect(page.locator(".version-preview-bar")).toHaveCount(0);
  await expect(reader).toContainText("不可变版本正文");
  await page.getByRole("button", { name: "此正文大纲" }).click();
  await expect(page.locator('[aria-label="此正文大纲内容"]').last()).toContainText("生成时的大纲快照：林澈在七码头确认潮汐密钥。");
  await expect(page.getByText("林澈与顾屿在七码头会合。", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "关闭此正文大纲" }).first().click();

  await doubleTouch(reader);
  await expect(page.getByLabel("正文编辑器")).toHaveValue("不可变版本正文");
  await page.getByLabel("正文编辑器").fill("准备放弃的正文");
  await page.getByRole("button", { name: "退出编辑" }).click();
  await expect(page.getByRole("dialog").getByText("保存正文修改？", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(reader).toContainText("不可变版本正文");

  await doubleTouch(reader);
  await page.getByLabel("正文编辑器").fill("已明确保存的正文");
  await page.getByRole("button", { name: "退出编辑" }).click();
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(reader).toContainText("已明确保存的正文");
  const state = await page.request.get("/api/state");
  const payload = await state.json();
  const savedOutline = payload.data.articles[0].chapters[0].outlines.find((outline: { id: string }) => outline.id === "outline-current");
  expect(savedOutline.content).toBe("已明确保存的正文");
  expect(savedOutline.currentVersionId).toBeNull();
  expect(savedOutline.defaultVersionId).toBeNull();
  expect(savedOutline.versions).toHaveLength(1);
  expect(savedOutline.versions[0].content).toBe("不可变版本正文");
});

test("interrupted writing is recovered as an unsaved-content candidate", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await doubleTouch(page.getByLabel("正文内容"));
  await page.getByLabel("正文编辑器").fill("浏览器意外中断前的正文");
  await page.reload();
  await expect(page.getByLabel("正文内容")).toHaveText("林澈看向顾屿，确认潮汐表上的时间。");
  await page.getByRole("button", { name: "选择正文版本" }).click();
  const recovered = page.locator(".version-list article").filter({ hasText: "未保存内容" }).first();
  await expect(recovered).toBeVisible();
  await recovered.locator(".version-preview-main").click();
  await expect(recovered.locator(".version-content-preview")).toContainText("浏览器意外中断前的正文");
});

test("keyboard sorting commits one final outline move", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.goto("/");
  const source = page.locator('[data-outline-id="outline-current"] .mobile-outline-main');
  await expect(source).toBeVisible();
  await source.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".mobile-outline-drag-overlay")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(160);
  await page.keyboard.press("Space");
  await expect.poll(async () => page.locator("[data-outline-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-outline-id")))).toEqual(["outline-previous", "outline-after", "outline-current"]);
});

test("mobile outline menu provides one-step sorting fallback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.goto("/");
  await page.getByRole("button", { name: "当前码头更多操作" }).click();
  await expect(page.getByRole("button", { name: "上移一位" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下移一位" })).toBeVisible();
  await page.getByRole("button", { name: "上移一位" }).click();
  await expect.poll(async () => page.locator("[data-outline-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-outline-id")))).toEqual(["outline-current", "outline-previous", "outline-after"]);
});

test("desktop drag handle supports keyboard sorting and persists the new order", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.goto("/");
  const source = page.getByRole("button", { name: "拖动排序：当前码头" });
  await source.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".desktop-outline-drag-overlay")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(180);
  await page.keyboard.press("Space");
  await expect.poll(async () => page.locator(".sidebar [data-outline-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-outline-id")))).toEqual(["outline-previous", "outline-after", "outline-current"]);
  await expect.poll(async () => {
    const response = await page.request.get("/api/state");
    const payload = await response.json();
    return payload.data.articles[0].chapters[0].outlines.filter((outline: { archived: boolean }) => !outline.archived).map((outline: { id: string }) => outline.id);
  }).toEqual(["outline-previous", "outline-after", "outline-current"]);
});

test("desktop pointer drag can move an outline into an empty chapter", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  fixture.articles[0].chapters.push({ id: "chapter-empty", title: "空章节", archived: false, outlines: [] });
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/");
  const handle = page.getByRole("button", { name: "拖动排序：当前码头" });
  const target = page.locator(".chapter-group").filter({ hasText: "空章节" }).locator(".empty-chapter-drop");
  const sourceBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 10, sourceBox!.y + sourceBox!.height / 2, { steps: 3 });
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(async () => {
    const response = await page.request.get("/api/state");
    const payload = await response.json();
    return payload.data.articles[0].chapters.find((chapter: { id: string }) => chapter.id === "chapter-empty").outlines.map((outline: { id: string }) => outline.id);
  }).toEqual(["outline-current"]);
});

test("dark appearance keeps application and portal surfaces dark", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  fixture.settings.theme = "dark";
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  const expectDarkSurface = async (selector: string) => {
    const rgba = await page.locator(selector).first().evaluate((element) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
    expect(Math.max(...rgba.slice(0, 3))).toBeLessThan(96);
  };

  await page.goto("/settings/appearance");
  await expect(page.locator(".settings-nav")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
  await expectDarkSurface(".settings-nav");
  await expectDarkSurface(".setting-title");

  await page.goto("/articles/article-main/outlines/outline-current");
  await expectDarkSurface(".workspace-header");
  await expectDarkSurface(".outline-snapshot-content");

  await page.goto("/settings/models");
  await page.locator(".settings-actionbar .mantine-Button-root").click();
  await expect(page.locator(".ws-modal-content")).toBeVisible();
  await expectDarkSurface(".ws-modal-content");
  await expectDarkSurface(".ws-modal-content .mantine-Input-input");
});

test("desktop outline menu offers one-step ordering as a drag fallback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.goto("/");
  await page.locator('[data-outline-id="outline-current"] .row-more').click();
  await expect(page.getByRole("button", { name: "上移一位" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下移一位" })).toBeVisible();
  await page.getByRole("button", { name: "上移一位" }).click();
  await expect.poll(async () => page.locator(".sidebar [data-outline-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-outline-id")))).toEqual(["outline-current", "outline-previous", "outline-after"]);
});
