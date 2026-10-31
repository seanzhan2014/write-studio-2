import { expect, test, type Locator, type Page } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

const longText = "https://example.com/" + "unbrokentext".repeat(16);

async function expectVerticalSurface(page: Page, surface: Locator) {
  const metrics = await surface.evaluate((element) => ({
    width: element.clientWidth,
    contentWidth: element.scrollWidth,
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
  }));
  expect(metrics.contentWidth, "长内容应换行，不能只裁切或隐藏横向滚动条").toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.left).toBeGreaterThanOrEqual(-1);
  expect(metrics.right).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await surface.evaluate((element) => { element.scrollLeft = 120; });
  expect(await surface.evaluate((element) => element.scrollLeft)).toBe(0);
}

async function swipe(page: Page, target: Locator, horizontal: boolean) {
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  const startX = bounds!.x + bounds!.width * .8;
  const startY = Math.min(bounds!.y + bounds!.height * .65, page.viewportSize()!.height - 80);
  const session = await page.context().newCDPSession(page);
  const point = (step: number) => ({
    x: startX - (horizontal ? step * 35 : step * 3),
    y: startY - (horizontal ? step * 3 : step * 45),
    radiusX: 2, radiusY: 2, force: .7, id: 7,
  });
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(0)] });
    for (let step = 1; step <= 4; step += 1) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(step)] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
}

test.beforeEach(async ({ request }) => {
  const current = await (await request.get("/api/state")).json();
  const data = fullStudioFixture();
  const article = data.articles[0];
  article.title = longText.slice(0, 120);
  article.chapters[0].title = longText.slice(0, 100);
  article.chapters[0].outlines[0].title = longText.slice(0, 100);
  article.chapters[0].outlines[1].title = longText.slice(0, 100);
  article.chapters[0].outlines[1].content = `${longText}\n${"正常正文内容。\n".repeat(100)}`;
  article.characters[0].name = longText.slice(0, 60);
  article.characters[0].description = longText;
  article.relationships[0].description = longText;
  expect((await request.put("/api/state", {
    headers: { "If-Match": String(current.revision) },
    data: { data, conflictResolution: "keep-local" },
  })).ok()).toBeTruthy();
});

for (const width of [320, 390, 430, 844]) {
  test(`mobile generation page stays inside its scroll owner at ${width}px`, async ({ page, request }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("mobile-"), "mobile layout");
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    const current = await (await request.get("/api/state")).json();
    current.data.articles[0].aiGenerateSettings.model = "mobile-long-model";
    current.data.settings.generatePresets = ["日常对话", longText];
    expect((await request.put("/api/state", {
      headers: { "If-Match": String(current.revision) },
      data: { data: current.data, conflictResolution: "keep-local" },
    })).ok()).toBeTruthy();
    await page.route("**/api/models", route => route.fulfill({ json: { models: [{
      id: "mobile-long-model", modelId: longText, name: longText,
      providerName: "测试服务", hasSecret: true,
    }] } }));
    await page.goto("/articles/article-main/outlines/outline-current/generate");
    await expect(page.getByRole("combobox", { name: "本次模型", exact: true })).toHaveValue(/unbrokentext/);
    await expect(page.locator(".generate-auto-apply-note")).toHaveCSS("white-space", "normal");
    const view = page.locator(".generate-view");
    const surfaces = [view, page.locator(".generate-page"), page.locator(".generate-command-card"), page.locator(".ai-settings-inheritance")];
    for (const surface of surfaces) await expectVerticalSurface(page, surface);

    await page.locator(".ai-setting-inheritance-details > summary").click();
    const parameters = page.locator(".generate-workflow-section > .task-parameter-settings");
    await parameters.locator(":scope > summary").click();
    for (const summary of await parameters.locator(".task-parameter-group > summary").all()) await summary.click();
    await page.locator(".generate-command-card > .writing-advanced > summary").click();
    for (const surface of [...surfaces, parameters]) await expectVerticalSurface(page, surface);

    await view.evaluate(element => { element.scrollTop = 0; });
    if (testInfo.project.name === "mobile-chromium") {
      await swipe(page, view, true);
      expect(await view.evaluate(element => element.scrollLeft)).toBe(0);
      await swipe(page, view, false);
      await expect.poll(() => view.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    }
    await page.screenshot({ path: `.test-data/generation-${testInfo.project.name}-${width}.png` });
  });
}

for (const width of [320, 390, 667]) {
  test(`mobile content surfaces have no horizontal overflow at ${width}px`, async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("mobile-"), "mobile layout");
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 667 ? 375 : 844 });
    for (const [route, selector] of [
      ["/articles/article-main/outlines/outline-current/write", ".content-reader"],
      ["/articles/article-main/outlines/edit-all", ".page-scroll"],
      ["/articles/article-main/read", ".page-scroll"],
      ["/articles/article-main/info/basic", ".page-scroll"],
      ["/articles/article-main/info/characters", ".page-scroll"],
      ["/articles/article-main/info/relationships", ".page-scroll"],
      ["/articles/article-main/info/ai-tasks", ".page-scroll"],
      ["/articles/article-main/outlines/outline-current/generate", ".generate-view"],
      ["/settings/appearance", ".settings-layout"],
    ]) {
      await test.step(route, async () => {
        await page.goto(route);
        const surface = page.locator(selector);
        await expect(surface).toBeVisible();
        await expectVerticalSurface(page, surface);
        if (route.endsWith("/info/characters")) {
          await page.locator(".character-card").first().getByRole("button", { name: "编辑", exact: true }).click();
          const dialog = page.getByRole("dialog", { name: "编辑人物" });
          await expect(dialog).toBeVisible();
          await expectVerticalSurface(page, dialog.locator(".ws-overlay-body--scroll, [data-ui-overlay-scroll]"));
          await dialog.getByRole("button", { name: "关闭人物编辑" }).click();
        }
      });
    }
  });
}

test("mobile reading swipes stay vertical while navigation can scroll horizontally", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Chromium native touch input");
  await page.goto("/articles/article-main/outlines/outline-current/write");
  const reader = page.getByRole("region", { name: "正文内容", exact: true });
  await expect(reader).toBeVisible();
  await expectVerticalSurface(page, reader);
  await swipe(page, reader, true);
  expect(await reader.evaluate((element) => element.scrollLeft)).toBe(0);
  await swipe(page, reader, false);
  await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.goto("/settings/appearance");
  const navigation = page.locator(".settings-nav");
  await expect(navigation).toBeVisible();
  await swipe(page, navigation, true);
  await expect.poll(() => navigation.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.locator(".settings-layout").evaluate((element) => element.scrollLeft)).toBe(0);
});

test("mobile modal windows stay fixed with touch in portrait and landscape", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Chromium native touch input");
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/articles/article-main/info/characters");
    await page.locator(".character-card").first().getByRole("button", { name: "编辑", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑人物" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("xpath=ancestor::*[@data-ui-overlay='modal']")).toHaveAttribute("data-ui-draggable", "false");
    await expect(dialog.locator(".ws-modal-drag-title")).toHaveCount(0);
    await expect(dialog).toHaveCSS("opacity", "1");
    const before = await dialog.boundingBox();
    await swipe(page, dialog.locator(".ws-modal-header"), true);
    const after = await dialog.boundingBox();
    expect(after!.x).toBeCloseTo(before!.x, 0);
    expect(after!.y).toBeCloseTo(before!.y, 0);
  }
});
