import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fullStudioFixture } from "../fixtures.mjs";
import type { StudioData } from "../../app/studio-state";
import { STANDALONE_AI_REVIEW_ENABLED } from "../../lib/features.mjs";

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

async function swipeOutlineLeft(page: Page, target: Locator) {
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  const y = bounds!.y + bounds!.height / 2;
  const startX = bounds!.x + bounds!.width - 24;
  const endX = startX - 92;
  if (page.context().browser()?.browserType().name() !== "chromium") {
    await target.evaluate((element, points) => {
      const pointer = (type: string, x: number, buttons: number) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
        buttons,
        clientX: x,
        clientY: points.y,
      }));
      pointer("pointerdown", points.startX, 1);
      for (const x of [points.startX - 24, points.startX - 52, points.endX]) pointer("pointermove", x, 1);
      pointer("pointerup", points.endX, 0);
    }, { startX, endX, y });
    return;
  }
  const session = await page.context().newCDPSession(page);
  const point = (x: number) => ({ x, y, radiusX: 2, radiusY: 2, force: 0.7, id: 7 });
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(startX)] });
    for (const x of [startX - 24, startX - 52, endX]) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(x)] });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function touchTapCenter(page: Page, target: Locator, expectedLabel: string) {
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  const point = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  const hitLabel = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    return hit?.closest("button")?.getAttribute("aria-label") ?? "";
  }, point);
  expect(hitLabel).toBe(expectedLabel);
  await target.tap({ position: { x: bounds!.width / 2, y: bounds!.height / 2 } });
}

async function swipeNameVersion(target: Locator, direction: "left" | "right") {
  await target.evaluate((element, swipeDirection) => {
    const bounds = element.getBoundingClientRect();
    const y = bounds.top + bounds.height / 2;
    const startX = swipeDirection === "left" ? bounds.right - 24 : bounds.left + 24;
    const endX = startX + (swipeDirection === "left" ? -92 : 92);
    const pointer = (type: string, x: number, buttons: number) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 9,
      pointerType: "touch",
      isPrimary: true,
      buttons,
      clientX: x,
      clientY: y,
    }));
    pointer("pointerdown", startX, 1);
    pointer("pointermove", endX, 1);
    pointer("pointerup", endX, 0);
  }, direction);
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

test("simplified story and character settings stay clear on desktop and mobile", async ({ page }) => {
  await page.goto("/articles/article-main/info/basic");
  await expect(page.getByText("故事类型、时代背景、世界规则等内容都可以写在这里。", { exact: true })).toBeVisible();
  for (const label of ["故事发生地点", "写作风格", "负面约束"]) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  for (const removed of ["类型", "时代背景", "整体基调", "世界规则"]) await expect(page.getByLabel(removed, { exact: true })).toHaveCount(0);

  await page.goto("/articles/article-main/info/characters");
  await page.locator(".character-card").first().getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑人物" });
  await expect(dialog.getByText("身份、性格、说话方式、能力、当前心理状态和当前已知信息都可以写在这里。", { exact: true })).toBeVisible();
  for (const label of ["年龄", "外貌", "人物说明", "人物底线"]) await expect(dialog.getByLabel(label, { exact: false })).toBeVisible();
  for (const removed of ["身份", "性格", "说话方式", "能力", "当前心理状态", "当前已知信息", "行为底线", "绝对不能写崩的特点"]) {
    await expect(dialog.getByLabel(removed, { exact: true })).toHaveCount(0);
  }
  await expectInsideViewport(page, dialog);
});

test("outline settings inherit the previous outline and keep long story fields collapsed", async ({ page, request }, testInfo) => {
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const chapter = fixture.articles[0].chapters[0];
  chapter.settings = { story: { summary: { value: "章节阶段简介", scope: "chapter" } }, characters: {}, relationships: {} };
  chapter.outlines[0].settings = { story: { location: { value: "灯塔地下室", scope: "ongoing" } }, characters: {}, relationships: {} };
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  if (testInfo.project.name === "mobile-chromium") {
    await page.goto("/");
    await page.getByRole("button", { name: "当前码头更多操作" }).click();
    await page.getByRole("button", { name: "大纲设定", exact: true }).click();
  } else {
    await page.goto("/articles/article-main/outlines/outline-current/write");
    await page.getByRole("button", { name: "当前码头更多操作" }).click();
    await page.getByRole("button", { name: /^大纲设定/ }).click();
  }

  const drawer = page.getByRole("dialog").filter({ hasText: "本大纲修改" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("继承前序灯塔", { exact: false })).toBeVisible();
  await expect(drawer.getByLabel("故事发生地点", { exact: true })).toHaveValue("灯塔地下室");
  for (const label of ["简介", "写作风格"]) {
    const details = drawer.locator("details.setting-collapsible").filter({ hasText: label });
    await expect(details).not.toHaveAttribute("open", "");
    await expect(drawer.getByLabel(label, { exact: true })).not.toBeVisible();
  }
  await expectOverlayContract(page, drawer);
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
      await expect(chapterSheet.getByRole("button", { name: "AI生成名称" })).toHaveCount(0);
      await chapterSheet.getByRole("button", { name: "关闭章节菜单" }).click();

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
      await page.getByRole("button", { name: "打开生成选项" }).click();
      const optionsDrawer = page.locator(".generate-options-drawer-shell");
      await expectOverlayContract(page, optionsDrawer);
      await optionsDrawer.getByRole("button", { name: "关闭生成选项" }).click();
    });
  }
});

test("all responsive overlay consumers open inside a keyboard-compressed viewport", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 480 });

  // This test repeatedly reloads the whole application while inspecting overlays.
  // Stop seeded background work so task recovery cannot race those navigations.
  const current = await request.get("/api/state");
  const snapshot = await current.json();
  snapshot.data.tasks = snapshot.data.tasks.map((task: { state: string; phase?: string }) => task.state === "running" ? { ...task, state: "cancelled", phase: "cancelled" } : task);
  await request.put("/api/state", { headers: { "If-Match": String(snapshot.revision) }, data: { data: snapshot.data, conflictResolution: "keep-local" } });

  const gotoSettled = async (url: string) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // Autosave and background synchronization may keep the network busy
      // after the editor is usable. Wait for the rendered application instead.
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".main-area, vite-error-overlay").first()).toBeVisible();
      if (await page.locator("vite-error-overlay").count() === 0) return;
    }
    throw new Error(`开发测试服务器无法稳定打开 ${url}`);
  };

  await gotoSettled("/");
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
  await expect(structureGenerate.getByText("当前大纲内容", { exact: true })).toBeVisible();
  await expect(structureGenerate.getByLabel("推理强度设置")).toBeVisible();
  const structureSubmit = structureGenerate.getByRole("button", { name: "生成预览" });
  await structureSubmit.scrollIntoViewIfNeeded();
  await expectInsideViewport(page, structureSubmit);
  await structureGenerate.getByRole("button", { name: "关闭结构生成" }).click();

  await gotoSettled("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "选择正文版本", exact: true }).click();
  const versions = page.locator(".version-drawer-shell");
  await expectOverlayContract(page, versions);
  await versions.getByRole("button", { name: "关闭正文版本" }).click();
  await page.locator(".mobile-plan-peek").click();
  const planPeek = page.locator(".plan-peek-drawer");
  await expectOverlayContract(page, planPeek);
  await planPeek.getByRole("button", { name: "关闭此正文大纲" }).click();

  await gotoSettled("/articles/article-main/outlines/outline-current/generate");
  await page.getByRole("button", { name: "打开生成选项" }).click();
  await page.locator(".generate-first-appearance-edit").click();
  const appearance = page.locator(".first-appearance-dialog");
  await expectOverlayContract(page, appearance);
  await appearance.getByRole("button", { name: "关闭首次出场人物编辑" }).click();
  await page.getByRole("button", { name: "管理常用指令" }).click();
  const presets = page.locator(".generate-preset-dialog");
  await expectOverlayContract(page, presets);
  await presets.getByRole("button", { name: "关闭预设管理" }).click();

  await gotoSettled("/articles/article-main/outlines/edit-all");
  await page.locator('[data-continuous-outline-id="outline-current"]').getByRole("button", { name: "AI Chat", exact: true }).click();
  const fullChat = page.locator(".full-outline-chat-modal");
  await expectOverlayContract(page, fullChat);
  await fullChat.getByRole("button", { name: "关闭全文大纲 AI Chat" }).click();

  await gotoSettled("/articles/article-main/edit");
  if (STANDALONE_AI_REVIEW_ENABLED) {
    await page.getByRole("button", { name: "AI Review" }).click();
    const review = page.locator(".ai-review-dialog");
    await expectOverlayContract(page, review);
    await expect(review.locator(".ai-review-article-rules")).toBeVisible();
    await expect(review.getByLabel("推理强度设置")).toBeVisible();
    await expect(review.locator("details.ai-review-article-rules, details.ai-review-advanced")).toHaveCount(0);
    await review.getByRole("button", { name: "关闭 AI Review" }).click();
  }

  await gotoSettled("/settings/models");
  await page.getByRole("button", { name: "新建 Provider" }).click();
  const providerEditor = page.locator(".ws-responsive-modal").filter({ hasText: "新建 Provider" });
  await expectOverlayContract(page, providerEditor);
  await providerEditor.getByRole("button", { name: "关闭 Provider 编辑" }).click();
});

test("provider settings owns model discovery and opens a viewport-safe model editor", async ({ page }) => {
  await page.route("**/api/providers", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providers: [{ id: "provider-test", name: "Writer Provider", adapterKind: "openai-compatible", baseUrl: "https://models.example/v1", timeoutMs: 120000, hasSecret: true, modelCount: 0 }] }) });
  });
  await page.route("**/api/models", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [] }) });
  });
  await page.route("**/api/providers/provider-test/discover", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: ["writer-fast", "writer-large"] }) });
  });
  await page.goto("/settings/models");
  await expect(page.getByText("Providers", { exact: true })).toBeVisible();
  const providerCard = page.locator(".provider-card").filter({ hasText: "Writer Provider" });
  const providerToggle = providerCard.locator(".provider-group-toggle");
  await expect(providerToggle).toHaveAttribute("aria-label", "折叠 Provider：Writer Provider");
  await expect(providerCard.locator(".provider-group-body")).toBeVisible();
  await providerToggle.click();
  await expect(providerToggle).toHaveAttribute("aria-expanded", "false");
  await expect(providerCard.locator(".provider-group-body")).toHaveCount(0);
  await providerToggle.click();
  await expect(providerToggle).toHaveAttribute("aria-expanded", "true");
  await providerCard.getByRole("button", { name: "Writer Provider的更多操作" }).click();
  await page.getByRole("menuitem", { name: "Fetch 模型" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("显示名称")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Provider", exact: true })).toHaveValue("Writer Provider");
  await expect(page.getByLabel("最大输入字符数")).toHaveValue(/60,?000/);
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
  await expect(page.getByRole("button", { name: "添加 2 个模型" })).toBeVisible();

  const bounds = await page.getByRole("dialog").boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
});

test("secondary list actions stay behind a consistent More menu", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop list density");
  await page.goto("/articles/article-main/info/characters");
  const character = page.locator(".character-card").first();
  await expect(character.getByRole("button")).toHaveCount(2);
  await character.getByRole("button", { name: /更多操作/ }).click();
  await expect(page.getByRole("menuitem", { name: "归档" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "删除" })).toBeVisible();

  await page.goto("/articles/article-main/info/review-rules");
  const rule = page.locator(".review-rule-card").first();
  await expect(rule.getByRole("button")).toHaveCount(2);
  await rule.getByRole("button", { name: /更多操作/ }).click();
  await expect(page.getByRole("menuitem", { name: "归档" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "删除" })).toBeVisible();
});

test("relationship editing uses one responsive form", async ({ page }) => {
  await page.goto("/articles/article-main/info/relationships");
  await page.getByRole("button", { name: "新建关系" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "新建人物关系" });
  await expect(dialog.getByLabel("人物 A")).toBeVisible();
  await expect(dialog.getByLabel("人物 B")).toBeVisible();
  await expect(dialog.getByLabel("关系描述")).toBeVisible();
  await expectOverlayContract(page, dialog);
  await dialog.getByRole("button", { name: "关闭人物关系编辑" }).click();
});

test("model candidates can be assigned as independent task defaults", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop model settings");
  await page.route("**/api/providers", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providers: [
      { id: "deepseek-provider", name: "DeepSeek Provider", adapterKind: "openai-compatible", baseUrl: "https://deepseek.example/v1", timeoutMs: 120000, hasSecret: true, modelCount: 1 },
      { id: "writer-provider", name: "Writer Provider", adapterKind: "openai-compatible", baseUrl: "https://writer.example/v1", timeoutMs: 120000, hasSecret: true, modelCount: 1 },
    ] }) });
  });
  await page.route("**/api/models", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [
        { id: "deepseek-candidate", providerId: "deepseek-provider", providerName: "DeepSeek Provider", name: "DeepSeek", modelId: "deepseek-chat", systemPrompt: "", hasSecret: true, timeoutMs: 120000, timeoutOverrideMs: null, maxInputCharacters: 60000 },
        { id: "writer-candidate", providerId: "writer-provider", providerName: "Writer Provider", name: "Writer", modelId: "writer-large", systemPrompt: "", hasSecret: true, timeoutMs: 120000, timeoutOverrideMs: null, maxInputCharacters: 60000 },
      ] }),
    });
  });
  await page.goto("/settings/models");
  const deepseekProvider = page.locator(".provider-card").filter({ hasText: "DeepSeek Provider" });
  const writerProvider = page.locator(".provider-card").filter({ hasText: "Writer Provider" });
  const deepseek = deepseekProvider.locator(".provider-model-row").filter({ hasText: "DeepSeek" });
  const writer = writerProvider.locator(".provider-model-row").filter({ hasText: "Writer" });
  await expect(deepseekProvider.locator(".provider-model-row")).toHaveCount(1);
  await expect(writerProvider.locator(".provider-model-row")).toHaveCount(1);
  await expect(deepseekProvider).not.toContainText("writer-large");
  await expect(writerProvider).not.toContainText("deepseek-chat");
  await deepseek.getByRole("button", { name: "更多" }).click();
  await page.locator('[role="menuitem"]:visible').filter({ hasText: "设为 Chat 默认" }).last().click();
  await deepseek.getByRole("button", { name: "更多" }).click();
  if (STANDALONE_AI_REVIEW_ENABLED) {
    await page.locator('[role="menuitem"]:visible').filter({ hasText: "设为 Review 默认" }).last().click();
  } else {
    await expect(page.getByRole("menuitem", { name: "设为 Review 默认" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await writer.getByRole("button", { name: "更多" }).click();
  await page.locator('[role="menuitem"]:visible').filter({ hasText: "设为 Generate 默认" }).last().click();
  await writer.getByRole("button", { name: "更多" }).click();
  await page.locator('[role="menuitem"]:visible').filter({ hasText: "设为名称生成默认" }).last().click();
  await expect(deepseek).toContainText("默认 AI Chat");
  if (STANDALONE_AI_REVIEW_ENABLED) await expect(deepseek).toContainText("默认 AI Review");
  else await expect(deepseek).not.toContainText("默认 AI Review");
  await expect(writer).toContainText("默认 AI Generate");
  await expect(writer).toContainText("默认名称生成");

  await deepseek.getByRole("button", { name: "编辑" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Provider", exact: true })).toHaveValue("DeepSeek Provider");
  await expect(dialog.getByLabel("模型 ID")).toHaveValue("deepseek-chat");
  await expect(dialog.getByText("API Key")).toHaveCount(0);
});

test("generate controls and context drawer fit the desktop viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const optionsTrigger = page.getByRole("button", { name: "打开生成选项" });
  await expect(optionsTrigger).toBeVisible();
  await expect(optionsTrigger).toContainText(/5,?000 字/);
  await expect(page.getByLabel("正文目标字数")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /全新生成/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /改写正文/ })).toBeEnabled();
  await expect(page.getByRole("radio", { name: /续写正文/ })).toBeEnabled();
  await page.getByRole("radio", { name: /改写正文/ }).click();
  await optionsTrigger.click();
  await expect(page.getByRole("dialog").getByText("生成选项", { exact: true })).toBeVisible();
  await expect(page.getByLabel("正文目标字数")).toHaveValue(/5,?000/);
  await expect(page.getByLabel("同时生成大纲名")).not.toBeChecked();
  const retention = page.getByRole("slider", { name: "原文保留度" });
  await expect(retention).toBeVisible();
  await expect(page.getByText("平衡 · 平衡改写", { exact: true })).toBeVisible();
  await retention.focus();
  await retention.press("End");
  await expect(page.getByText("高保留 · 轻度润色", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭生成选项" }).click();
  await page.getByRole("radio", { name: /全新生成/ }).click();
  await expect(retention).toHaveCount(0);
  await expect(page.getByText("补充指令（可选）", { exact: false })).toBeVisible();
  await optionsTrigger.click();
  const firstAppearance = page.locator(".generate-first-appearance-edit");
  await expect(firstAppearance).toContainText("1");
  await firstAppearance.click();
  const appearanceDialog = page.getByRole("dialog").filter({ hasText: "首次出场人物" });
  await expect(appearanceDialog.getByLabel("顾屿首次出场")).toBeChecked();
  await expect(appearanceDialog.getByLabel("林澈首次出场")).not.toBeChecked();
  await expect(appearanceDialog).toContainText("此前在「前序灯塔」匹配“林澈”");
  await appearanceDialog.getByLabel("林澈首次出场").check();
  await appearanceDialog.getByLabel("顾屿首次出场").uncheck();
  await appearanceDialog.getByRole("button", { name: "完成" }).click();
  await expect(firstAppearance).toContainText("1");
  await expect(page.getByRole("dialog").getByText("上下文与人物", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("前面大纲", { exact: false })).toBeVisible();
  await expect(page.getByText("全新生成不发送", { exact: true })).toBeVisible();
  await expect(page.getByText("本章全部大纲", { exact: false })).toHaveCount(0);
  await page.getByText("查看当前大纲", { exact: true }).click();
  await expect(page.locator(".context-preview").getByText("当前大纲", { exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("tablet layouts do not crop the workspace and keep primary AI actions reachable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "tablet breakpoint");
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto("/articles/article-main/outlines/outline-current/generate");

  const viewport = page.viewportSize()!;
  for (const selector of [".studio-shell", ".main-area", ".generate-command-card"]) {
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  }
  const generateAction = await page.getByRole("button", { name: "开始生成" }).boundingBox();
  expect(generateAction).not.toBeNull();
  expect(generateAction!.y).toBeGreaterThanOrEqual(0);
  expect(generateAction!.y + generateAction!.height).toBeLessThanOrEqual(viewport.height);

  await page.goto("/settings/models");
  const settings = await page.locator(".settings-layout").boundingBox();
  expect(settings).not.toBeNull();
  expect(settings!.x + settings!.width).toBeLessThanOrEqual(viewport.width + 1);

  await page.goto("/articles/article-main/edit");
  if (STANDALONE_AI_REVIEW_ENABLED) {
    await page.getByRole("button", { name: "AI Review" }).click();
    const reviewActions = await page.locator(".ai-review-actions").boundingBox();
    expect(reviewActions).not.toBeNull();
    expect(reviewActions!.y + reviewActions!.height).toBeLessThanOrEqual(viewport.height);
  }
});

test("first appearance editor is usable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  await page.getByRole("radio", { name: /改写正文/ }).click();
  await page.getByRole("button", { name: "打开生成选项" }).click();
  const retention = page.getByRole("slider", { name: "原文保留度" });
  await expect(retention).toBeVisible();
  const retentionBounds = await page.locator(".rewrite-retention-control").boundingBox();
  const mobileViewport = page.viewportSize()!;
  expect(retentionBounds).not.toBeNull();
  expect(retentionBounds!.x).toBeGreaterThanOrEqual(0);
  expect(retentionBounds!.x + retentionBounds!.width).toBeLessThanOrEqual(mobileViewport.width);
  const firstAppearance = page.locator(".generate-first-appearance-edit");
  await expect(firstAppearance).toContainText("1");
  await firstAppearance.click();
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
  await expect(firstAppearance).toHaveText("首次出场人物");
});

test("AI Generate controls keep mobile touch sizes and allow an unlimited word target", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile layout");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/articles/article-main/outlines/outline-current/generate");

  const initialSubmit = await page.getByRole("button", { name: "开始生成" }).boundingBox();
  const initialViewport = page.viewportSize()!;
  expect(initialSubmit).not.toBeNull();
  expect(initialSubmit!.y).toBeGreaterThanOrEqual(0);
  expect(initialSubmit!.y + initialSubmit!.height).toBeLessThanOrEqual(initialViewport.height);

  const optionsTrigger = page.getByRole("button", { name: "打开生成选项" });
  await expect(optionsTrigger).toBeVisible();
  await optionsTrigger.click();
  const wordTarget = page.getByRole("textbox", { name: "正文目标字数" });
  await wordTarget.scrollIntoViewIfNeeded();
  const wordBounds = await wordTarget.boundingBox();
  expect(wordBounds).not.toBeNull();
  expect(wordBounds!.width).toBeGreaterThanOrEqual(150);
  expect(wordBounds!.height).toBeGreaterThanOrEqual(44);

  const optionsDrawer = page.locator(".generate-options-drawer");
  const optionMetrics = await optionsDrawer.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(optionMetrics.scrollWidth).toBeLessThanOrEqual(optionMetrics.clientWidth);
  const outlineTitleToggle = page.locator(".generate-outline-title-toggle");
  const toggleBounds = await outlineTitleToggle.boundingBox();
  expect(toggleBounds).not.toBeNull();
  expect(toggleBounds!.height).toBeGreaterThanOrEqual(44);

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

  await page.getByRole("button", { name: "关闭生成选项" }).click();
  const submit = page.getByRole("button", { name: "开始生成" });
  const submitBounds = await submit.boundingBox();
  expect(submitBounds).not.toBeNull();
  expect(submitBounds!.width).toBeGreaterThanOrEqual(250);
  expect(submitBounds!.height).toBeGreaterThanOrEqual(48);

  await page.locator(".generate-prompt-label textarea").fill("移动端补充指令");
  const saveInstruction = page.getByRole("button", { name: "保存指令" });
  await saveInstruction.scrollIntoViewIfNeeded();
  const saveInstructionBounds = await saveInstruction.boundingBox();
  expect(saveInstructionBounds).not.toBeNull();
  expect(saveInstructionBounds!.height).toBeGreaterThanOrEqual(40);

  const singleLineText = page.locator([
    ".generate-mode-description",
    ".generate-options-summary-copy > .ui-title",
    ".generate-options-summary-chips em",
    ".generate-auto-apply-note",
  ].join(","));
  const textMetrics = await singleLineText.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
    return { height: element.getBoundingClientRect().height, lineHeight };
  }));
  expect(textMetrics.length).toBeGreaterThan(0);
  for (const metric of textMetrics) expect(metric.height).toBeLessThanOrEqual(metric.lineHeight + 2);
});

test("mobile supplementary instruction save sends one compact outline patch", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile save path");
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  await page.locator(".generate-prompt-label textarea").fill("手机端小型增量保存");
  const pendingRequest = page.waitForRequest((request) => request.url().endsWith("/api/state/mutations") && request.method() === "POST");
  await page.getByRole("button", { name: "保存指令" }).click();
  const request = await pendingRequest;
  const body = request.postDataJSON() as { changes: { version: number; outlines: { upsert: unknown[]; patch: Array<Record<string, unknown>> } } };
  expect(body.changes.version).toBe(2);
  expect(body.changes.outlines.upsert).toHaveLength(0);
  expect(body.changes.outlines.patch).toHaveLength(1);
  expect(body.changes.outlines.patch[0]).not.toHaveProperty("versions");
  expect(body.changes.outlines.patch[0]).not.toHaveProperty("chat");
  expect(JSON.stringify(body).length).toBeLessThan(3_000);
  await expect(page.getByRole("button", { name: "保存指令" })).toHaveCount(0);
});

test("AI Generate reuses supplementary instructions only within the same outline", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop state behavior");
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  type FixtureOutline = (typeof fixture.articles)[number]["chapters"][number]["outlines"][number] & { generateInstruction: string };
  const currentOutline = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")! as FixtureOutline;
  const previousOutline = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-previous")! as typeof currentOutline;
  currentOutline.generateInstruction = "当前码头沿用的补充指令";
  previousOutline.generateInstruction = "前序灯塔自己的补充指令";
  fixture.tasks = [];
  const saved = await request.put("/api/state", { headers: { "If-Match": String(payload.revision) }, data: { data: fixture, conflictResolution: "keep-local" } });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const instruction = page.locator(".generate-prompt-label textarea");
  await expect(instruction).toHaveValue("当前码头沿用的补充指令");
  await instruction.fill("当前码头下一次仍要沿用");
  await expect(page.getByText("有未保存修改", { exact: true })).toBeVisible();
  const saveInstruction = page.getByRole("button", { name: "保存指令" });
  await expect(saveInstruction).toBeEnabled();
  const compactSave = page.waitForRequest((request) => request.url().endsWith("/api/state/mutations") && request.method() === "POST");
  await saveInstruction.click();
  const compactRequest = await compactSave;
  const compactBody = compactRequest.postDataJSON() as { changes: { version: number; outlines: { upsert: unknown[]; patch: Array<Record<string, unknown>> } } };
  expect(compactBody.changes.version).toBe(2);
  expect(compactBody.changes.outlines.upsert).toHaveLength(0);
  expect(compactBody.changes.outlines.patch).toHaveLength(1);
  expect(compactBody.changes.outlines.patch[0]).not.toHaveProperty("versions");
  expect(compactBody.changes.outlines.patch[0]).not.toHaveProperty("chat");
  expect(JSON.stringify(compactBody).length).toBeLessThan(3_000);
  await expect(saveInstruction).toHaveCount(0);
  await expect(page.locator(".generate-instruction-save-state")).toHaveCount(0);
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: { articles: Array<{ chapters: Array<{ outlines: Array<{ id: string; generateInstruction: string }> }> }> } };
    return state.data.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((item) => item.id === "outline-current")?.generateInstruction;
  }).toBe("当前码头下一次仍要沿用");
  await expect(instruction).toHaveValue("当前码头下一次仍要沿用");
  await page.getByRole("tab", { name: "AI Chat" }).click();
  await page.getByRole("tab", { name: "AI Generate" }).click();
  await expect(instruction).toHaveValue("当前码头下一次仍要沿用");
  await instruction.fill("");
  await page.getByRole("button", { name: "保存指令" }).click();
  await page.reload();
  await expect(page.locator(".generate-prompt-label textarea")).toHaveValue("");

  await page.goto("/articles/article-main/outlines/outline-previous/generate");
  await expect(page.locator(".generate-prompt-label textarea")).toHaveValue("前序灯塔自己的补充指令");
});

test("AI Generate shows the configured model and no longer lists candidate bodies", async ({ page, request }) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ id: "model-remote", providerName: "Remote Provider", name: "Remote Writer", modelId: "provider/gpt-4.2-current", hasSecret: true, timeoutMs: 600_000 }] }),
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
  await expect(page.getByRole("option", { name: "Remote Provider-Remote Writer" })).toBeVisible();
  await page.getByRole("option", { name: "Remote Provider-Remote Writer" }).click();
  await expect(model).toHaveValue("Remote Provider-Remote Writer");
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    return payload.data.settings.generateModel;
  }).toBe("model-remote");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "本次模型" })).toHaveValue("Remote Provider-Remote Writer");
  await expect(page.getByText("候选版本", { exact: true })).toHaveCount(0);
  await expect(page.locator(".candidate-card")).toHaveCount(0);
  await expect(page.getByText("完成后更新当前正文，旧版本保留。", { exact: true })).toBeVisible();
});

test("workspace AI tabs render before a background save finishes and reuse the preloaded model list", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop timing contract");
  let modelRequests = 0;
  await page.route("**/api/models", async (route) => {
    modelRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ id: "model-remote", providerName: "Remote Provider", name: "Remote Writer", modelId: "provider/gpt-4.2-current", hasSecret: true, timeoutMs: 600_000 }] }),
    });
  });
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await expect.poll(() => modelRequests).toBe(1);

  let releaseSave = () => undefined;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route("**/api/state/mutations", async (route) => {
    if (route.request().method() === "POST") await saveGate;
    await route.continue();
  });
  await page.getByRole("tab", { name: "AI Generate" }).click();
  const model = page.getByRole("combobox", { name: "本次模型" });
  await model.click();
  await page.getByRole("option", { name: "Remote Provider-Remote Writer" }).click();
  await expect(page.locator(".save-state")).toContainText(/未保存|正在保存/);

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
  await expect(save).toHaveCount(0);

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
  await expect(save).toHaveCount(0);
  await expect(page.locator(".generate-outline-save-state")).toHaveCount(0);
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
  await page.getByRole("button", { name: "打开生成选项" }).click();
  const excellentOption = page.locator(".generate-options-drawer").getByLabel("参考优秀片段");
  await expect(excellentOption).not.toBeChecked();
  await excellentOption.check();
  await expect(page.locator(".generate-options-drawer")).toContainText("1 个");
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
  const nativeContextMenuPrevented = await reader.evaluate((element) => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(nativeContextMenuPrevented).toBe(testInfo.project.name === "mobile-chromium");
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
  for (const name of ["章节与大纲", "全文编辑", "文章资料"]) await expect(page.getByRole("button", { name })).toBeVisible();
  for (const removed of ["全章节编辑", "全大纲编辑", "只看标题"]) await expect(page.getByRole("button", { name: removed, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "搜索", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("搜索文章")).toBeVisible();
  await page.getByRole("button", { name: "关闭文章菜单" }).click();
  await expect(page.getByRole("button", { name: "新建大纲", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "在第一章中新建大纲", exact: true })).toBeVisible();

  const more = page.getByRole("button", { name: "当前码头更多操作" });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByText("大纲操作", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑大纲" })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Chat 大纲" })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI Generate 大纲" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新生成大纲名字" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "删除大纲" })).toBeVisible();
  await page.getByRole("button", { name: "关闭大纲操作" }).click();

  await page.getByRole("button", { name: "AI 任务" }).click();
  await expect(page.getByRole("dialog").getByText("AI 任务", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭 AI 任务", exact: true }).click();
  await page.getByRole("button", { name: "设置" }).click();
  for (const name of ["常规", "外观与编辑器", "AI 服务", "AI 任务", "数据管理", "系统与诊断"]) await expect(page.getByRole("button", { name })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("desktop sidebar omits top-level create and search buttons", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.goto("/articles/article-main/outlines/outline-current/write");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.getByRole("button", { name: "新建大纲", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "搜索", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "在第一章中新建大纲", exact: true })).toBeVisible();
  for (const name of ["章节与大纲", "全文编辑", "文章资料"]) {
    await expect(sidebar.getByRole("button", { name, exact: true })).toBeVisible();
  }
  for (const removed of ["全章节编辑", "全大纲编辑", "只看标题"]) await expect(sidebar.getByRole("button", { name: removed, exact: true })).toHaveCount(0);
});

test("chapter creation asks for a name and its empty first outline can be deleted without confirmation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop sidebar controls");
  await page.goto("/articles/article-main/outlines/outline-current/write");

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("prompt");
    expect(dialog.message()).toBe("章节标题");
    expect(dialog.defaultValue()).toBe("未命名章节");
    await dialog.accept("临时章节");
  });
  await page.getByRole("button", { name: "新建章节", exact: true }).click();
  await expect(page.getByRole("button", { name: "临时章节更多操作", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "临时章节更多操作", exact: true }).click();
  await page.getByRole("button", { name: "删除章节", exact: true }).click();
  await expect(page.getByRole("button", { name: "临时章节更多操作", exact: true })).toHaveCount(0);
});

test("chapter outline plus inserts directly after the current outline", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop sidebar controls");
  await page.goto("/articles/article-main/outlines/outline-current/write");
  const add = page.getByRole("button", { name: "在第一章中新建大纲", exact: true });
  await expect(add).toBeVisible();
  await add.click();

  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    return payload.data.articles[0].chapters[0].outlines.filter((item) => !item.archived).map((item) => item.id);
  }).toEqual(["outline-previous", "outline-current", expect.stringMatching(/^outline-/), "outline-after"]);
});

test("data management exports a secret-free complete backup and previews article imports", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop data management flow");
  await page.route("**/api/providers", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providers: [{ id: "provider-export", name: "导出 Provider", adapterKind: "openai-compatible", baseUrl: "https://models.example/v1", timeoutMs: 120000, hasSecret: true, modelCount: 1 }] }) });
  });
  await page.route("**/api/models", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{
        id: "model-export", providerId: "provider-export", providerName: "导出 Provider", name: "导出模型", baseUrl: "https://models.example/v1", modelId: "writer-large",
        systemPrompt: "保持克制", temperature: 0.7, maxOutput: 4096, maxInputCharacters: 60000,
        timeoutMs: 120000, timeoutOverrideMs: null, hasSecret: true, secret: "never-export-this",
      }] }),
    });
  });
  await page.goto("/settings/database");
  await expect(page.getByRole("heading", { name: "数据管理" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const backupText = await readFile(downloadPath!, "utf8");
  const backup = JSON.parse(backupText);
  expect(backup).toMatchObject({ kind: "writer-studio-transfer", formatVersion: 2, scope: "complete" });
  expect(backupText).not.toContain("never-export-this");
  expect(backup.data.providers[0]).toMatchObject({ name: "导出 Provider", hadApiKey: true });
  expect(backup.data.models[0]).toMatchObject({ name: "导出模型", providerId: "provider-export" });

  const current = await request.get("/api/state");
  const snapshot = await current.json();
  const importEnvelope = {
    kind: "writer-studio-transfer",
    formatVersion: 1,
    scope: "articles",
    exportedAt: new Date().toISOString(),
    data: { articles: [snapshot.data.articles[0]], tasks: [] },
  };
  const allArticles = page.locator(".transfer-card").filter({ hasText: "所有文章" });
  const chooserPromise = page.waitForEvent("filechooser");
  await allArticles.getByRole("button", { name: "导入" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "articles.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(importEnvelope)) });
  const dialog = page.getByRole("dialog", { name: "导入所有文章" });
  await expect(dialog).toContainText("不会继续执行");
  await expect(dialog).toContainText("不覆盖现有数据");
  await dialog.getByRole("button", { name: "导入文章" }).click();
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    return (await response.json()).data.articles.length;
  }).toBe(2);
});

test("article copy choices preserve selected defaults or complete histories without AI tasks", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop article copy flow");
  type CopiedOutline = {
    title: string;
    content: string;
    currentVersionId: string | null;
    defaultVersionId: string | null;
    versions: Array<{ id: string; taskId?: string }>;
    nameVersions: Array<{ id: string }>;
    chat: { sessions: Array<{ messages: unknown[] }> };
  };
  type CopiedArticle = {
    id: string;
    title: string;
    summary: string;
    type: string;
    style: string;
    chapters: Array<{ outlines: CopiedOutline[] }>;
    characters: Array<{ id: string }>;
    relationships: Array<{ characterAId: string; characterBId: string }>;
  };
  type CopiedState = { articles: CopiedArticle[]; tasks: Array<{ articleId: string }> };
  const currentState = await request.get("/api/state");
  const currentPayload = await currentState.json() as { revision: number };
  const fixture = fullStudioFixture() as unknown as StudioData;
  const sourceArticle = fixture.articles[0];
  const sourceChapter = sourceArticle.chapters[0];
  const sourceOutline = sourceChapter.outlines.find((outline) => outline.id === "outline-current")!;
  sourceChapter.nameVersions = [
    { id: "name-chapter-default", title: sourceChapter.title, source: "manual", createdAt: sourceArticle.createdAt },
    { id: "name-chapter-candidate", title: "候选章节名", source: "ai", createdAt: sourceArticle.createdAt },
  ];
  sourceChapter.defaultNameVersionId = "name-chapter-default";
  sourceOutline.nameVersions = [
    { id: "name-outline-default", title: sourceOutline.title, source: "manual", createdAt: sourceOutline.updatedAt },
    { id: "name-outline-candidate", title: "候选大纲名", source: "ai", createdAt: sourceOutline.updatedAt },
  ];
  sourceOutline.defaultNameVersionId = "name-outline-default";
  sourceOutline.versions = [
    { id: "version-current", name: "当前正文", content: "当前版本正文", source: "手动", createdAt: sourceOutline.updatedAt, taskId: "copy-source-task", outlineSnapshot: { title: sourceOutline.title, plan: sourceOutline.plan } },
    { id: "version-default", name: "默认正文", content: "指定的默认版本正文", source: "AI Generate", createdAt: sourceOutline.updatedAt, taskId: "copy-source-task", outlineSnapshot: { title: sourceOutline.title, plan: sourceOutline.plan } },
  ];
  sourceOutline.currentVersionId = "version-current";
  sourceOutline.defaultVersionId = "version-default";
  fixture.tasks = [{
    id: "copy-source-task", articleId: sourceArticle.id, chapterId: sourceChapter.id, outlineId: sourceOutline.id,
    target: "正文", prompt: "只属于原文章", model: "", executionOrigin: "local", state: "cancelled", createdAt: sourceArticle.createdAt,
  }];
  const prepared = await request.put("/api/state", {
    headers: { "If-Match": String(currentPayload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(prepared.ok()).toBeTruthy();

  await page.goto("/articles/article-main/info/basic");
  await page.getByRole("button", { name: "文章资料更多操作" }).click();
  await page.getByRole("button", { name: "复制这篇文章" }).click();
  const defaultsDialog = page.getByRole("dialog", { name: "复制文章" });
  await expect(defaultsDialog).toBeVisible();
  for (const label of ["章节与大纲", "正文", "人物资料", "写作风格"]) await expect(defaultsDialog.getByRole("checkbox", { name: new RegExp(`^${label}`) })).toBeChecked();
  for (const label of ["文章资料", "AI 对话记录"]) await expect(defaultsDialog.getByRole("checkbox", { name: new RegExp(`^${label}`) })).not.toBeChecked();
  await expect(defaultsDialog.getByRole("radio", { name: "仅默认名称" })).toBeChecked();
  await expect(defaultsDialog.getByRole("radio", { name: "仅默认正文" })).toBeChecked();
  await defaultsDialog.getByRole("button", { name: "创建副本" }).click();
  await expect(page.getByText("文章副本已创建")).toBeVisible();

  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json();
    return payload.data.articles.length;
  }).toBe(2);
  let copiedState = ((await (await request.get("/api/state")).json()) as { data: CopiedState }).data;
  const defaultCopy = copiedState.articles.find((article) => article.title === "严格测试文章（副本）")!;
  expect(defaultCopy).toBeTruthy();
  expect(defaultCopy.summary).toBe("");
  expect(defaultCopy.type).toBe("");
  expect(defaultCopy.style).toBe("克制");
  expect(defaultCopy.chapters).toHaveLength(sourceArticle.chapters.length);
  expect(defaultCopy.characters).toHaveLength(sourceArticle.characters.length);
  expect(defaultCopy.relationships).toHaveLength(sourceArticle.relationships.length);
  const defaultOutline = defaultCopy.chapters.flatMap((chapter) => chapter.outlines).find((outline) => outline.title === sourceOutline.title)!;
  expect(defaultOutline.content).toBe("指定的默认版本正文");
  expect(defaultOutline.versions).toHaveLength(1);
  expect(defaultOutline.currentVersionId).toBe(defaultOutline.versions[0].id);
  expect(defaultOutline.defaultVersionId).toBe(defaultOutline.versions[0].id);
  expect(defaultOutline.versions[0].taskId).toBeUndefined();
  expect(defaultOutline.nameVersions).toHaveLength(1);
  expect(defaultOutline.chat.sessions).toHaveLength(1);
  expect(defaultOutline.chat.sessions[0].messages).toHaveLength(0);
  const copiedCharacterIds = new Set(defaultCopy.characters.map((character) => character.id));
  expect(copiedCharacterIds.has(defaultCopy.relationships[0].characterAId)).toBe(true);
  expect(copiedCharacterIds.has(defaultCopy.relationships[0].characterBId)).toBe(true);
  expect(copiedState.tasks).toHaveLength(1);
  expect(copiedState.tasks[0].articleId).toBe("article-main");

  await page.goto("/articles/article-main/info/basic");
  await page.getByRole("button", { name: "文章资料更多操作" }).click();
  await page.getByRole("button", { name: "复制这篇文章" }).click();
  const allDialog = page.getByRole("dialog", { name: "复制文章" });
  await allDialog.getByRole("radio", { name: "全部候选名称" }).check();
  await allDialog.getByRole("radio", { name: "全部正文版本" }).check();
  await allDialog.getByRole("checkbox", { name: /文章资料/ }).check();
  await allDialog.getByRole("checkbox", { name: /AI 对话记录/ }).check();
  await allDialog.getByRole("button", { name: "创建副本" }).click();
  await expect(page.getByText("文章副本已创建")).toBeVisible();

  await expect.poll(async () => {
    const response = await request.get("/api/state");
    return (await response.json()).data.articles.length;
  }).toBe(3);
  copiedState = ((await (await request.get("/api/state")).json()) as { data: CopiedState }).data;
  const allCopy = copiedState.articles.find((article) => article.title === "严格测试文章（副本 2）")!;
  expect(allCopy.summary).toBe(sourceArticle.summary);
  expect(allCopy.type).toBe(sourceArticle.type);
  const allOutline = allCopy.chapters.flatMap((chapter) => chapter.outlines).find((outline) => outline.title === sourceOutline.title)!;
  expect(allOutline.versions).toHaveLength(2);
  expect(allOutline.currentVersionId).not.toBe(allOutline.defaultVersionId);
  expect(allOutline.versions.every((version) => version.taskId === undefined)).toBe(true);
  expect(allOutline.nameVersions).toHaveLength(2);
  expect(new Set(allOutline.nameVersions.map((version) => version.id)).has("name-outline-default")).toBe(false);
  expect(allOutline.chat.sessions).toHaveLength(2);
  expect(allOutline.chat.sessions[0].messages).toHaveLength(22);
  expect(copiedState.tasks).toHaveLength(1);
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
  test.skip(testInfo.project.name !== "mobile-chromium" && testInfo.project.name !== "mobile-webkit-swipe", "mobile layout");
  await page.goto("/");

  const showArchived = page.getByRole("switch", { name: "显示归档大纲" });
  await expect(showArchived).toHaveAttribute("aria-checked", "false");
  const current = page.locator('[data-outline-id="outline-current"]');
  await swipeOutlineLeft(page, current.locator(".mobile-outline-main"));
  await expect(current).toHaveClass(/reveal-left/);

  await expect(current.getByRole("button", { name: "当前码头更多操作" })).toHaveCSS("pointer-events", "none");
  await touchTapCenter(page, current.getByRole("button", { name: "归档大纲：当前码头" }), "归档大纲：当前码头");
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
  await swipeOutlineLeft(page, archivedCurrent.locator(".mobile-outline-main"));
  await expect(archivedCurrent).toHaveClass(/reveal-left/);
  await expect(archivedCurrent.locator(".swipe-manage")).toHaveCSS("visibility", "visible");
  await touchTapCenter(page, archivedCurrent.getByRole("button", { name: "恢复大纲：当前码头" }), "恢复大纲：当前码头");
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
  await expect(editor.getByLabel("第 1 章标题")).toHaveValue("第一章");

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

test("unified editor keeps article, chapter, and outline settings inline and inherited values collapsed", async ({ page, request }, testInfo) => {
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const chapter = fixture.articles[0].chapters[0];
  chapter.settings = { story: { summary: { value: "章节阶段简介", scope: "chapter" } }, characters: {}, relationships: {} };
  const outline = chapter.outlines.find((item) => item.id === "outline-current")!;
  outline.settings = { story: { style: { value: "本大纲采用克制的悬疑语气", scope: "outline" } }, characters: {}, relationships: {} };
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/edit-all");
  const editor = page.locator(".continuous-document-editor.outline");
  const articleToggle = editor.locator(".page-header").getByRole("button", { name: "设定", exact: true });
  await expect(articleToggle).toHaveAttribute("aria-expanded", "false");
  await articleToggle.click();
  const articlePanel = editor.locator(".article-inline-panel");
  await expect(articlePanel).toBeVisible();
  await expect(articlePanel.getByLabel("简介", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").filter({ has: page.getByText("文章设定", { exact: true }) })).toHaveCount(0);
  await articleToggle.click();
  await expect(articlePanel).toHaveCount(0);

  const chapterSection = editor.locator(".continuous-chapter").first();
  const chapterToggle = chapterSection.locator(".continuous-chapter-heading").getByRole("button", { name: "设定 · 1", exact: true });
  await chapterToggle.click();
  const chapterPanel = chapterSection.locator(".chapter-inline-panel");
  await expect(chapterPanel.getByText("本章修改 1 项", { exact: false })).toBeVisible();
  await expect(chapterPanel.getByLabel("简介", { exact: true })).toHaveValue("章节阶段简介");
  await expect(chapterPanel.getByLabel("故事发生地点", { exact: true })).toHaveCount(0);
  const chapterInheritance = chapterPanel.getByRole("button", { name: /^查看继承内容/ });
  await expect(chapterInheritance).toHaveAttribute("aria-expanded", "false");
  await chapterInheritance.click();
  await expect(chapterPanel.getByLabel("故事发生地点", { exact: true })).toBeVisible();
  await chapterToggle.click();

  const outlineBlock = editor.locator('[data-continuous-outline-id="outline-current"]');
  const outlineToggle = outlineBlock.getByRole("button", { name: "设定 · 1", exact: true });
  await outlineToggle.click();
  const outlinePanel = outlineBlock.locator(".outline-inline-panel");
  await expect(outlinePanel.getByText("本大纲修改 1 项", { exact: false })).toBeVisible();
  await expect(outlinePanel.getByLabel("写作风格", { exact: true })).toHaveValue("本大纲采用克制的悬疑语气");
  await expect(outlinePanel.getByLabel("简介", { exact: true })).toHaveCount(0);

  if (testInfo.project.name === "mobile-chromium") {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("mobile full outline editor keeps the caret above a visual-viewport keyboard", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium" && testInfo.project.name !== "mobile-webkit-keyboard", "mobile keyboard layout");
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-after")!;
  target.plan = Array.from({ length: 42 }, (_, index) => `键盘可见性测试第 ${index + 1} 行。`).join("\n");
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.addInitScript(() => {
    class MockVisualViewport extends EventTarget {
      width = 390;
      height = 844;
      offsetLeft = 0;
      offsetTop = 0;
      pageLeft = 0;
      pageTop = 0;
      scale = 1;
    }
    const viewport = new MockVisualViewport();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    (window as Window & { setVisualViewportForTest?: (height: number, offsetTop?: number) => void }).setVisualViewportForTest = (height, offsetTop = 0) => {
      viewport.height = height;
      viewport.offsetTop = offsetTop;
      viewport.dispatchEvent(new Event("resize"));
    };
  });

  await page.goto("/articles/article-main/outlines/edit-all");
  const scroll = page.locator(".keyboard-aware-page-scroll");
  const plan = page.getByLabel("大纲内容：绝密后续大纲");
  await plan.focus();
  await plan.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.setSelectionRange(0, textarea.value.length, "forward");
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.evaluate(() => (window as Window & { setVisualViewportForTest?: (height: number) => void }).setVisualViewportForTest?.(430));

  await expect.poll(() => scroll.evaluate((element) => element.clientHeight)).toBeLessThan(430);
  await expect.poll(() => scroll.evaluate((element) => Number((element as HTMLElement).dataset.visualViewportHeight))).toBe(430);
  await expect.poll(() => plan.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(404);

  await plan.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });

  await plan.press("x");
  await expect(plan).toHaveValue(/x$/);
  await expect.poll(() => plan.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(404);
  await expect.poll(() => plan.evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(24);
  await expect.poll(() => plan.evaluate((element) => (element as HTMLTextAreaElement).scrollTop)).toBeLessThanOrEqual(1);

  await page.evaluate(() => (window as Window & { setVisualViewportForTest?: (height: number) => void }).setVisualViewportForTest?.(844));
  await expect.poll(() => scroll.evaluate((element) => element.clientHeight)).toBeGreaterThan(700);
});

test("mobile body editor keeps the caret above a visual-viewport keyboard", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium" && testInfo.project.name !== "mobile-webkit-keyboard", "mobile keyboard layout");
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const target = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  target.content = Array.from({ length: 70 }, (_, index) => `正文键盘可见性测试第 ${index + 1} 行。`).join("\n");
  target.currentVersionId = null;
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.addInitScript(() => {
    class MockVisualViewport extends EventTarget {
      width = 390;
      height = 844;
      offsetLeft = 0;
      offsetTop = 0;
      pageLeft = 0;
      pageTop = 0;
      scale = 1;
    }
    const viewport = new MockVisualViewport();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    (window as Window & { setWritingVisualViewportForTest?: (height: number, offsetTop?: number) => void }).setWritingVisualViewportForTest = (height, offsetTop = 0) => {
      viewport.height = height;
      viewport.offsetTop = offsetTop;
      viewport.dispatchEvent(new Event("resize"));
    };
  });

  await page.goto("/articles/article-main/outlines/outline-current/write");
  await doubleTouch(page.getByLabel("正文内容"));
  const shell = page.locator(".studio-shell");
  const scroll = page.locator(".writing-scroll");
  const editor = page.getByLabel("正文编辑器");
  await expect(shell).toHaveClass(/mobile-writing-editing/);
  await expect(page.locator(".mobile-header")).toBeHidden();
  await expect(page.getByRole("tablist", { name: "工作模式" })).toBeHidden();
  await expect(page.getByRole("button", { name: "此正文大纲" })).toBeHidden();
  const toolbar = page.locator(".editor-heading");
  await expect.poll(async () => (await toolbar.boundingBox())?.height ?? 999).toBeLessThanOrEqual(48);
  await expect(page.getByRole("button", { name: "退出编辑" })).toContainText("完成");

  await page.getByRole("button", { name: "更多编辑操作" }).click();
  const menu = page.getByRole("menu", { name: "编辑操作" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(5);
  await expectInsideViewport(page, menu);
  await page.getByRole("button", { name: "更多编辑操作" }).click();

  await editor.focus();
  await editor.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.evaluate(() => (window as Window & { setWritingVisualViewportForTest?: (height: number) => void }).setWritingVisualViewportForTest?.(430));

  await expect.poll(() => scroll.evaluate((element) => Number((element as HTMLElement).dataset.visualViewportHeight))).toBe(430);
  await expect.poll(() => scroll.evaluate((element) => element.clientHeight)).toBeLessThanOrEqual(430);
  await expect.poll(() => editor.evaluate((element) => element.clientHeight)).toBeGreaterThan(330);
  await editor.press("x");
  await expect(editor).toHaveValue(/x$/);
  await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect.poll(async () => (await editor.boundingBox())?.y ?? 999).toBeLessThan(60);
  await expect.poll(async () => {
    const bounds = await editor.boundingBox();
    return bounds ? bounds.y + bounds.height : 999;
  }).toBeLessThanOrEqual(430);

  await editor.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.scrollTop = 0;
    textarea.setSelectionRange(0, textarea.value.length, "forward");
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect.poll(() => editor.evaluate((element) => (element as HTMLTextAreaElement).scrollTop)).toBeGreaterThan(0);

  await editor.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.scrollTop = textarea.scrollHeight;
    textarea.setSelectionRange(0, textarea.value.length, "backward");
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect.poll(() => editor.evaluate((element) => (element as HTMLTextAreaElement).scrollTop)).toBeLessThanOrEqual(1);

  await page.evaluate(() => (window as Window & { setWritingVisualViewportForTest?: (height: number) => void }).setWritingVisualViewportForTest?.(844));
  await expect.poll(() => scroll.evaluate((element) => element.clientHeight)).toBeGreaterThan(700);
});

test("full outline editor copies every visible chapter and plan in document order", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { (window as Window & { copiedOutlineText?: string }).copiedOutlineText = text; } },
    });
  });
  await page.goto("/articles/article-main/outlines/edit-all");

  const copy = page.locator(".continuous-document-editor.outline").getByRole("button", { name: "复制", exact: true });
  await expect(copy).toBeVisible();
  const articleTitle = page.locator(".continuous-document-editor.outline .page-header h1");
  const [copyBounds, titleBounds] = await Promise.all([copy.boundingBox(), articleTitle.boundingBox()]);
  expect(copyBounds!.x).toBeGreaterThan(titleBounds!.x + titleBounds!.width);
  const copyCenterY = copyBounds!.y + copyBounds!.height / 2;
  const titleCenterY = titleBounds!.y + titleBounds!.height / 2;
  expect(Math.abs(copyCenterY - titleCenterY)).toBeLessThanOrEqual(5);
  if (testInfo.project.name === "mobile-chromium") expect(copyBounds!.height).toBeGreaterThanOrEqual(40);
  await copy.click();

  const copied = await page.evaluate(() => (window as Window & { copiedOutlineText?: string }).copiedOutlineText);
  expect(copied).toBe([
    "第 1 章 第一章",
    "1. 前序灯塔\n林澈在灯塔取得前序线索。",
    "2. 当前码头\n林澈与顾屿在七码头会合。",
    "3. 绝密后续大纲\n这是当前大纲之后的内容，绝不能进入上下文。",
  ].join("\n\n"));
  expect(copied).not.toContain("归档秘密");
  await expect(page.getByText("已复制 1 个章节和 3 条大纲")).toBeVisible();
});

test("full outline editor keeps core actions visible and groups structural actions in a menu", async ({ page, request }) => {
  await page.goto("/articles/article-main/outlines/edit-all");
  const editor = page.locator(".continuous-document-editor.outline");
  const current = editor.locator('[data-continuous-outline-id="outline-current"]');
  const drag = current.getByRole("button", { name: "拖动排序：当前码头" });
  const properties = current.getByRole("button", { name: "打开「当前码头」属性" });
  const more = current.getByRole("button", { name: "当前码头更多操作" });
  await expect(drag).toBeVisible();
  await expect(current.getByRole("button", { name: "AI Chat", exact: true })).toBeVisible();
  await expect(properties).toBeVisible();
  await expect(current.locator(".continuous-outline-secondary-actions")).toHaveCount(0);

  await properties.click();
  const propertyDrawer = page.locator(".continuous-outline-properties-drawer");
  await expect(propertyDrawer).toBeVisible();
  await expect(propertyDrawer.getByRole("tab", { name: /^设定/ })).toBeVisible();
  await propertyDrawer.getByRole("tab", { name: "名称", exact: true }).click();
  await expect(propertyDrawer.getByRole("tabpanel", { name: "大纲名称" })).toBeVisible();
  await page.getByRole("button", { name: "关闭大纲属性" }).click();

  await more.click();
  let actionMenu = page.locator(".continuous-outline-action-menu");
  await expect(actionMenu).toBeVisible();
  await actionMenu.getByRole("menuitem", { name: "在下方新建" }).click();

  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    return payload.data.articles[0].chapters[0].outlines.length;
  }).toBe(5);
  const idsAfterCreate = await editor.locator("[data-continuous-outline-id]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-continuous-outline-id")));
  const currentIndex = idsAfterCreate.indexOf("outline-current");
  expect(idsAfterCreate[currentIndex + 1]).toMatch(/^outline-/);
  expect(idsAfterCreate[currentIndex + 1]).not.toBe("outline-after");
  const created = editor.locator(`[data-continuous-outline-id="${idsAfterCreate[currentIndex + 1]}"]`);
  await expect(created.locator(".continuous-outline-title-input")).toBeFocused();
  await expect(created.locator(".continuous-outline-title-input")).toHaveValue("");
  await expect(created.locator(".continuous-text-editor.plan")).toHaveValue("");

  await more.click();
  actionMenu = page.locator(".continuous-outline-action-menu");
  const warning = page.waitForEvent("dialog");
  const removeClick = actionMenu.getByRole("menuitem", { name: "删除", exact: true }).click();
  const dialog = await warning;
  expect(dialog.message()).toContain("已有正文");
  await dialog.dismiss();
  await removeClick;
  await expect(current).toBeVisible();

  await more.click();
  actionMenu = page.locator(".continuous-outline-action-menu");
  const archiveMutation = page.waitForRequest((request) => request.url().endsWith("/api/state/mutations") && request.method() === "POST");
  await actionMenu.getByRole("menuitem", { name: "归档", exact: true }).click();
  await expect(current).toHaveCount(0);
  const archiveBody = (await archiveMutation).postDataJSON() as { changes: { outlines: { patch: Array<Record<string, unknown>> } } };
  expect(archiveBody.changes.outlines.patch.find((item) => item.id === "outline-current")).toMatchObject({ id: "outline-current", outline: { archived: true } });
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    return payload.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")?.archived;
  }).toBe(true);
});

test("unified editor moves an outline through the contextual move drawer", async ({ page, request }) => {
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  fixture.articles[0].chapters.splice(1, 0, { id: "chapter-second", title: "第二章", archived: false, outlines: [] });
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/edit-all");
  const outline = page.locator('[data-continuous-outline-id="outline-current"]');
  await outline.getByRole("button", { name: "当前码头更多操作" }).click();
  await page.locator(".continuous-outline-action-menu").getByRole("menuitem", { name: "移动到章节…", exact: true }).click();
  const picker = page.locator(".continuous-outline-properties-drawer");
  await expect(picker).toBeVisible();
  await expect(picker.getByText("选择目标章节；大纲内容、正文版本和 AI Chat 会一起保留。")).toBeVisible();
  await picker.getByRole("button", { name: /第二章/ }).click();

  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    return payload.data.articles[0].chapters.find((chapter) => chapter.id === "chapter-second")?.outlines.some((item) => item.id === "outline-current");
  }).toBe(true);
  const secondChapter = page.locator(".continuous-chapter").filter({ has: page.getByLabel("第 2 章标题") });
  await expect(secondChapter.locator('[data-continuous-outline-id="outline-current"]')).toBeVisible();
});

test("full outline editor keeps the active outline anchored when leaving and returning", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop sidebar navigation");
  const current = await request.get("/api/state");
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  fixture.articles[0].chapters[0].outlines[0].plan = "灯塔线索继续展开。\n".repeat(45);
  fixture.articles[0].chapters[0].outlines[1].plan = "码头调查继续展开。\n".repeat(45);
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "章节与大纲", exact: true }).click();
  const editor = page.locator(".continuous-document-editor.outline");
  const target = editor.locator('[data-continuous-outline-id="outline-after"]');
  const targetPlan = editor.getByLabel("大纲内容：绝密后续大纲");
  await targetPlan.scrollIntoViewIfNeeded();
  await targetPlan.focus();
  const before = await target.evaluate((element) => {
    const viewport = element.closest(".page-scroll")!;
    return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  });

  await page.getByRole("button", { name: "全文编辑", exact: true }).click();
  await expect(page.locator(".continuous-document-editor.content")).toBeVisible();
  await page.getByRole("button", { name: "章节与大纲", exact: true }).click();
  await expect(editor).toBeVisible();
  await editor.locator('[data-continuous-outline-id="outline-current"]').evaluate((element) => {
    window.setTimeout(() => { (element as HTMLElement).style.paddingBottom = "420px"; }, 120);
  });
  await expect.poll(() => target.evaluate((element) => {
    const viewport = element.closest(".page-scroll")!;
    return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  })).toBeCloseTo(before, 0);

  await expect.poll(() => page.evaluate(() => {
    const ui = JSON.parse(window.localStorage.getItem("writer-studio:device-ui-v1") ?? "{}");
    return ui.currentOutlineId;
  })).toBe("outline-after");
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

test("full content title row respects AI Review visibility and keeps article rules available", async ({ page }) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ id: "review-model", providerName: "Fireworks", name: "Kimi Review", modelId: "accounts/fireworks/models/kimi-k2p6", hasSecret: true, timeoutMs: 600_000 }] }),
    });
  });
  await page.goto("/articles/article-main/edit");
  const editor = page.locator(".continuous-document-editor.content");
  const title = editor.getByRole("heading", { name: "严格测试文章" });
  const review = editor.getByRole("button", { name: "AI Review" });
  if (!STANDALONE_AI_REVIEW_ENABLED) {
    await expect(title).toBeVisible();
    await expect(review).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "保存", exact: true })).toBeVisible();
    await page.goto("/articles/article-main/info/review-rules");
    await expect(page.getByRole("tab", { name: "审校规则", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "审校规则", exact: true })).toBeVisible();
    return;
  }
  await expect(review).toBeVisible();
  const [titleBounds, reviewBounds] = await Promise.all([title.boundingBox(), review.boundingBox()]);
  expect(titleBounds).not.toBeNull();
  expect(reviewBounds).not.toBeNull();
  expect(reviewBounds!.x).toBeGreaterThan(titleBounds!.x);
  await review.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("本次文章规则", { exact: true })).toBeVisible();
  await expect(dialog.getByText("5 条", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Review 章节")).toBeVisible();
  await expect(dialog.getByLabel("模型")).toHaveValue("Fireworks-Kimi Review");
  const additional = dialog.getByLabel("本次附加要求");
  await additional.fill("统一雨景中的感官描写");
  await expect(additional).toHaveValue("统一雨景中的感官描写");
  await expect(dialog.getByRole("link", { name: "管理规则" })).toHaveAttribute("href", "/articles/article-main/info/review-rules");
  await expect(dialog.getByLabel("推理强度设置")).toBeVisible();
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

test("AI Chat acknowledges immediately and ignores rapid duplicate submits while saving", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  test.setTimeout(60_000);
  let delayNextSubmit = false;
  let delayedSubmits = 0;
  let streamRequests = 0;
  await page.route("**/api/outlines/outline-current/chat/transactions", async (route) => {
    const body = route.request().postDataJSON() as { action?: string };
    if (body.action === "submit" && delayNextSubmit && delayedSubmits === 0) {
      delayedSubmits += 1;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    await route.continue();
  });
  await page.route("**/api/outlines/outline-current/chat/stream", async (route) => {
    streamRequests += 1;
    await route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "唯一的聊天回复" });
  });

  await page.goto("/articles/article-main/outlines/outline-current/chat");
  const question = "慢保存期间只提交一次";
  await page.getByLabel("AI Chat 消息").fill(question);
  delayNextSubmit = true;
  await page.getByRole("button", { name: "发送消息" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expect(page.getByText("正在提交", { exact: true })).toBeVisible();
  await expect(page.locator(".message.user").filter({ hasText: question })).toHaveCount(1);
  await expect(page.locator(".message.assistant").last()).toContainText("唯一的聊天回复", { timeout: 20_000 });
  await expect.poll(() => streamRequests).toBe(1);
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
    const userMessages = outline.chat.sessions.flatMap((item) => item.messages).filter((item) => item.role === "user" && item.text === question);
    const tasks = state.data.tasks.filter((item) => item.target === "AI Chat" && item.prompt === question);
    return { userMessages: userMessages.length, tasks: tasks.length, taskState: tasks[0]?.state };
  }, { timeout: 20_000 }).toEqual({ userMessages: 1, tasks: 1, taskState: "success" });
});

test("AI Chat releases its short submission lock after a save failure", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  let failNextSubmit = false;
  await page.route("**/api/outlines/outline-current/chat/transactions", async (route) => {
    const body = route.request().postDataJSON() as { action?: string };
    if (body.action === "submit" && failNextSubmit) {
      failNextSubmit = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "模拟保存失败" }) });
      return;
    }
    await route.continue();
  });

  await page.goto("/articles/article-main/outlines/outline-current/chat");
  await page.getByLabel("AI Chat 消息").fill("这次保存会失败");
  failNextSubmit = true;
  await page.getByRole("button", { name: "发送消息" }).click();

  const composer = page.getByLabel("AI Chat 消息");
  await composer.fill("保存失败后仍可继续提交");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeEnabled();
});

test("AI Chat distinguishes requesting the model from waiting for its first text", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop layout");
  await page.goto("/articles/article-main/outlines/outline-current/chat");
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/api/outlines/outline-current/chat/stream")) return originalFetch(input, init);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          window.setTimeout(() => {
            controller.enqueue(encoder.encode("分阶段返回的聊天回复\u001e"));
            controller.close();
          }, 700);
        },
      }), { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    };
  });

  await page.getByLabel("AI Chat 消息").fill("检查模型响应阶段");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText("正在请求模型", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("等待首字", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".message.assistant").last()).toContainText("分阶段返回的聊天回复", { timeout: 10_000 });
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
    const latestMessageId = session.messages.at(-1)?.id;
    return page.evaluate(({ sessionId, latestId }) => {
      const local = JSON.parse(window.localStorage.getItem("writer-studio:device-ui-v1") ?? "{}") as { lastReadBySession?: Record<string, string | null> };
      return local.lastReadBySession?.[sessionId] === latestId;
    }, { sessionId: session.id, latestId: latestMessageId });
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

test("AI Chat displays the Provider-model format consistently", async ({ page }) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ id: "model-remote", providerName: "Remote Provider", name: "Remote Writer", modelId: "provider/gpt-4.1-mini", hasSecret: true, timeoutMs: 600_000 }] }),
    });
  });
  await page.goto("/articles/article-main/outlines/outline-current/chat");
  const model = page.getByLabel("聊天模型");
  await expect(model).toBeVisible();
  await model.selectOption("model-remote");
  await expect(model.locator("option:checked")).toHaveText("Remote Provider-Remote Writer");
  await expect(page.locator(".message.assistant .message-meta .ui-label").first()).toHaveText("Remote Provider-Remote Writer");
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
    await expect(chapterHeaders.nth(index).locator(":scope > .icon-button")).toHaveCount(2);
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

test("unified chapter and outline editor generates individual names as selectable history versions", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop naming workflow");
  test.setTimeout(60_000);
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/ai/names", async (route) => {
    const requestBody = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(requestBody);
    const stateResponse = await request.get("/api/state");
    const state = await stateResponse.json() as { revision: number; data: ReturnType<typeof fullStudioFixture> };
    const article = state.data.articles.find((item) => item.id === requestBody.articleId)!;
    const chapter = article.chapters.find((item) => item.id === requestBody.chapterId)!;
    const createdAt = "2026-07-28T16:30:00.000Z";
    const outline = chapter.outlines.find((item) => item.id === requestBody.outlineId);
    const outlineCandidate = { id: "name-ai-outline-candidate", title: "七码头潮汐密钥", source: "ai", createdAt };
    const chapterCandidate = { id: "name-ai-chapter-candidate", title: "潮汐密钥", source: "ai", createdAt };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(requestBody.target === "outline"
        ? {
            outlineTitles: [{ id: requestBody.outlineId, title: "七码头潮汐密钥" }], inputCharacters: 860, maxInputCharacters: 60000,
            revision: state.revision, added: 1, articleUpdatedAt: createdAt,
            outlineStates: [{ id: outline!.id, updatedAt: createdAt, nameVersions: [outlineCandidate, ...(outline!.nameVersions ?? [])], defaultNameVersionId: outline!.defaultNameVersionId }],
          }
        : {
            chapterTitle: "潮汐密钥", outlineTitles: [], inputCharacters: 1260, maxInputCharacters: 60000,
            revision: state.revision, added: 1, articleUpdatedAt: createdAt,
            chapterState: { nameVersions: [chapterCandidate, ...(chapter.nameVersions ?? [])], defaultNameVersionId: chapter.defaultNameVersionId },
          }),
    });
  });

  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "章节与大纲", exact: true }).click();
  await page.locator(".page-header").getByRole("button", { name: "名称", exact: true }).click();
  await expect(page.locator(".name-generation-reasoning").getByLabel("推理强度设置")).toBeVisible();
  await page.locator(".page-header").getByRole("button", { name: "名称", exact: true }).click();

  const outlineBlock = page.locator('[data-continuous-outline-id="outline-current"]');
  await outlineBlock.getByRole("button", { name: "名称", exact: true }).click();
  const outlineRow = outlineBlock.locator(".unified-naming-editor");
  await expect(outlineRow.getByLabel(/新增大纲名版本/)).toBeVisible();
  const originalOutline = outlineRow.getByRole("radio", { name: /当前码头/ });
  await expect(originalOutline).toHaveAttribute("aria-checked", "true");
  await outlineRow.getByRole("button", { name: "AI 生成候选" }).click();
  const outlineCandidate = outlineRow.getByRole("radio", { name: /七码头潮汐密钥/ });
  await expect(outlineCandidate).toHaveAttribute("aria-checked", "false");
  await expect(originalOutline).toHaveAttribute("aria-checked", "true");
  expect(requests[0]).toMatchObject({ target: "outline", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current" });
  expect(requests[0]).not.toHaveProperty("content");
  await outlineCandidate.click();
  await expect(outlineCandidate).toHaveAttribute("aria-checked", "true");

  const chapterRow = page.locator(".continuous-chapter").first();
  await chapterRow.locator(".continuous-chapter-heading").getByRole("button", { name: "名称", exact: true }).click();
  const chapterNaming = chapterRow.locator(".chapter-inline-panel .unified-naming-editor");
  const originalChapter = chapterNaming.getByRole("radio", { name: /第一章/ });
  await expect(originalChapter).toHaveAttribute("aria-checked", "true");
  await chapterNaming.getByRole("button", { name: "AI 生成候选" }).click();
  const chapterCandidate = chapterNaming.getByRole("radio").filter({ has: page.getByText("潮汐密钥", { exact: true }) });
  await expect(chapterCandidate).toHaveAttribute("aria-checked", "false");
  expect(requests[1]).toMatchObject({ target: "chapter", includeChapter: true, outlineIds: [] });
  const selectedChapterSaved = page.waitForResponse((response) => response.url().endsWith("/api/state/mutations") && response.request().method() === "POST" && response.ok());
  await chapterCandidate.click();
  await selectedChapterSaved;
  await expect(chapterCandidate).toHaveAttribute("aria-checked", "true");

  await page.reload();
  const reloadedChapter = page.locator(".continuous-chapter").first();
  const reloadedOutline = page.locator('[data-continuous-outline-id="outline-current"]');
  await reloadedChapter.locator(".continuous-chapter-heading").getByRole("button", { name: "名称", exact: true }).click();
  await reloadedOutline.getByRole("button", { name: "名称", exact: true }).click();
  await expect(reloadedOutline.getByRole("radio").filter({ has: page.getByText("七码头潮汐密钥", { exact: true }) })).toHaveAttribute("aria-checked", "true");
  await expect(reloadedChapter.locator(".chapter-inline-panel").getByRole("radio").filter({ has: page.getByText("潮汐密钥", { exact: true }) })).toHaveAttribute("aria-checked", "true");
});

test("desktop unified editor deletes the default name and persists its fallback", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop naming workflow");
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const outline = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  outline.nameVersions = [
    { id: "name-outline-candidate", title: "七码头候选", source: "ai", createdAt: outline.updatedAt },
    { id: "name-outline-current", title: "当前码头", source: "manual", createdAt: outline.updatedAt },
  ];
  outline.defaultNameVersionId = "name-outline-current";
  const seeded = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(seeded.ok()).toBeTruthy();

  await page.goto("/articles/article-main/chapters/edit-all");
  const outlineBlock = page.locator('[data-continuous-outline-id="outline-current"]');
  await outlineBlock.getByRole("button", { name: "名称", exact: true }).click();
  const currentItem = outlineBlock.locator(".name-version-item").filter({ hasText: "当前码头" });
  await expect(currentItem.getByRole("button", { name: "删除大纲名「当前码头」" })).toBeVisible();
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/state/mutations") && response.request().method() === "POST" && response.ok());
  await currentItem.getByRole("button", { name: "删除大纲名「当前码头」" }).click();
  await saved;
  await expect(currentItem).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /七码头候选/ })).toHaveAttribute("aria-checked", "true");

  await page.reload();
  const reloadedOutline = page.locator('[data-continuous-outline-id="outline-current"]');
  await reloadedOutline.getByRole("button", { name: "名称", exact: true }).click();
  await expect(page.getByText("当前码头", { exact: true })).toHaveCount(0);
  await expect(reloadedOutline.getByRole("radio", { name: /七码头候选/ })).toHaveAttribute("aria-checked", "true");
});

test("mobile unified editor swipes both ways before deleting a name", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile naming workflow");
  const current = await request.get("/api/state");
  const state = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  const outline = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  outline.nameVersions = [
    { id: "name-outline-candidate", title: "待删除候选", source: "ai", createdAt: outline.updatedAt },
    { id: "name-outline-current", title: "当前码头", source: "manual", createdAt: outline.updatedAt },
  ];
  outline.defaultNameVersionId = "name-outline-current";
  const seeded = await request.put("/api/state", {
    headers: { "If-Match": String(state.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(seeded.ok()).toBeTruthy();

  await page.goto("/articles/article-main/chapters/edit-all");
  const outlineBlock = page.locator('[data-continuous-outline-id="outline-current"]');
  await outlineBlock.getByRole("button", { name: "名称", exact: true }).click();
  const item = outlineBlock.locator(".name-version-item").filter({ hasText: "待删除候选" });
  const option = item.locator(".name-version-option");
  const deleteAction = item.locator(".name-version-delete");
  await expect(deleteAction).toHaveCSS("visibility", "hidden");
  await swipeNameVersion(option, "left");
  await expect(deleteAction).toHaveCSS("visibility", "visible");
  await swipeNameVersion(option, "right");
  await expect(deleteAction).toHaveCSS("visibility", "hidden");
  await swipeNameVersion(option, "left");
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/state/mutations") && response.request().method() === "POST" && response.ok());
  await item.getByRole("button", { name: "删除大纲名「待删除候选」" }).click();
  await saved;
  await expect(item).toHaveCount(0);

  await page.reload();
  const reloadedOutline = page.locator('[data-continuous-outline-id="outline-current"]');
  await reloadedOutline.getByRole("button", { name: "名称", exact: true }).click();
  await expect(page.getByText("待删除候选", { exact: true })).toHaveCount(0);
  await expect(reloadedOutline.getByRole("radio", { name: /当前码头/ })).toHaveAttribute("aria-checked", "true");
});

test("unified editor queues one background task for every chapter and outline", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop naming workflow");
  test.setTimeout(60_000);
  let directNameCalls = 0;
  page.on("request", (requested) => { if (requested.url().endsWith("/api/ai/names")) directNameCalls += 1; });

  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "章节与大纲", exact: true }).click();
  await page.locator(".page-header").getByRole("button", { name: "名称", exact: true }).click();
  await page.getByRole("button", { name: "生成全部名称" }).click();
  const taskPanel = page.getByLabel("AI 任务");
  await expect(taskPanel.getByText("整篇章节与大纲命名", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: ReturnType<typeof fullStudioFixture> & { tasks: Array<{ target: string; state: string; contextOptions?: { nameChapterCount?: number; nameOutlineCount?: number } }> } };
    const tasks = payload.data.tasks.filter((item) => item.target === "全部名称");
    return { count: tasks.length, state: tasks[0]?.state, chapters: tasks[0]?.contextOptions?.nameChapterCount, outlines: tasks[0]?.contextOptions?.nameOutlineCount };
  }).toEqual({ count: 1, state: "success", chapters: 1, outlines: 3 });
  expect(directNameCalls).toBe(0);
  await page.getByRole("button", { name: "关闭 AI 任务", exact: true }).click();

  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const payload = await response.json() as { data: ReturnType<typeof fullStudioFixture> };
    const article = payload.data.articles[0];
    const chapter = article.chapters[0];
    return {
      aiCandidates: [chapter, ...chapter.outlines.filter((item) => !item.archived)].reduce((total, item) => total + (item.nameVersions ?? []).filter((version) => version.source === "ai").length, 0),
      titles: [chapter.title, ...chapter.outlines.filter((item) => !item.archived).map((item) => item.title)],
    };
  }).toEqual({ aiCandidates: 4, titles: ["第一章", "前序灯塔", "当前码头", "绝密后续大纲"] });
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
  await current.getByRole("button", { name: "AI Chat", exact: true }).click();

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
  await page.getByRole("button", { name: "新建 Provider" }).click();
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
