import { expect, test, type Locator, type Page } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

test.beforeEach(async ({ request }) => {
  const current = await (await request.get("/api/state")).json();
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(current.revision) },
    data: { data: fullStudioFixture(), conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();
});

async function expectTouchHeight(controls: Locator) {
  const measurements = await controls.evaluateAll(elements => elements
    .filter(element => element.getBoundingClientRect().width > 0)
    .map(element => ({ name: element.getAttribute("aria-label") || element.textContent?.trim(), height: element.getBoundingClientRect().height })));
  expect(measurements.length).toBeGreaterThan(0);
  expect(measurements.filter(control => control.height < 43.5)).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.locator(".settings-layout").evaluate(element => ({
    width: element.clientWidth, content: element.scrollWidth,
    left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
  }));
  expect(metrics.content).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.left).toBeGreaterThanOrEqual(-1);
  expect(metrics.right).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

test("settings switches announce their purpose and retain keyboard changes", async ({ page }) => {
  await page.goto("/settings/general");
  await expect(page.getByRole("combobox", { name: "界面语言", exact: true })).toBeVisible();
  const startup = page.getByRole("switch", { name: "启动时打开上次文章", exact: true });
  const archived = page.getByRole("switch", { name: "默认显示已归档内容", exact: true });
  await expect(startup).toBeChecked();
  await startup.focus();
  await startup.press("Space");
  await expect(startup).not.toBeChecked();
  await archived.focus();
  await archived.press("Enter");
  await expect(archived).toBeChecked();
  await page.reload();
  await expect(startup).not.toBeChecked();
  await expect(archived).toBeChecked();
  await page.goto("/settings/appearance");
  await expect(page.getByRole("switch", { name: "大纲内容默认展开", exact: true })).toBeVisible();
  await page.goto("/settings/database");
  await expect(page.getByRole("switch", { name: "本地保存后自动异步复制到云端", exact: true })).toBeVisible();
});

test("tablet collapsed navigation keeps its rail width in settings and writing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop sidebar");
  for (const width of [768, 820, 1023]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings/general");
    const sidebar = page.getByRole("complementary", { name: "文章导航" });
    await expect(sidebar).toHaveClass(/collapsed/);
    await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(56);
    await sidebar.getByRole("button", { name: "返回写作", exact: true }).click();
    await expect(sidebar).not.toHaveClass(/collapsed/);
    await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(180);
    await sidebar.getByRole("button", { name: "折叠侧栏", exact: true }).click();
    await expect.poll(() => sidebar.evaluate(element => element.getBoundingClientRect().width)).toBe(56);
    await sidebar.getByRole("button", { name: "展开侧栏", exact: true }).click();
  }
});

test("chat keeps the latest message visible across viewport changes without interrupting history reading", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/articles/article-main/outlines/outline-current/chat");
  const thread = page.locator(".chat-thread");
  const bottomGap = () => thread.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop);
  await expect.poll(bottomGap).toBeLessThan(2);
  for (const viewport of [{ width: 390, height: 844 }, { width: 390, height: 480 }, { width: 667, height: 375 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(bottomGap).toBeLessThan(2);
    await expect(page.getByRole("textbox", { name: "聊天消息", exact: true })).toBeInViewport();
  }
  await thread.evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByText("old-message-00", { exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 480 });
  await expect(page.getByText("old-message-00", { exact: true })).toBeInViewport();
  await expect.poll(bottomGap).toBeGreaterThan(100);
});

for (const viewport of [
  { width: 320, height: 568 }, { width: 390, height: 844 },
  { width: 667, height: 375 }, { width: 390, height: 480 },
]) {
  test(`settings touch controls and transfer actions fit ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "mobile viewport matrix");
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto("/settings/database");
    const groups = page.locator(".transfer-card > .mantine-Group-root");
    await expect(groups).toHaveCount(2);
    for (const group of await groups.all()) {
      const buttons = group.getByRole("button");
      const first = await buttons.nth(0).boundingBox();
      const second = await buttons.nth(1).boundingBox();
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(Math.abs(first!.y - second!.y)).toBeLessThan(1);
    }
    await expectTouchHeight(page.locator(".settings-content .mantine-Button-root, .toggle"));
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("database.png") });

    await page.goto("/settings/tasks");
    const categories = page.getByRole("tablist", { name: "AI 任务分类", exact: true });
    await expect(categories).toBeVisible();
    await expectTouchHeight(categories.getByRole("tab"));
    for (const name of ["正文生成", "写作准备", "自动审校", "大纲", "聊天", "图片", "学习与微调", "全局"]) {
      await categories.getByRole("tab", { name, exact: true }).click();
      await expectTouchHeight(page.locator(".settings-content .mantine-Input-input"));
      await expectNoHorizontalOverflow(page);
    }
  });
}

test("outline titles and action icons remain readable after narrow viewport changes", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/articles/article-main/outlines/edit-all");
  const title = page.getByRole("textbox", { name: "大纲标题：当前码头", exact: true });
  await title.fill("这是用于检查手机横竖屏切换后仍能完整显示的长大纲标题".repeat(2));
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 667, height: 375 }, { width: 390, height: 480 }, { width: 820, height: 900 }]) {
    await page.setViewportSize(viewport);
    const block = page.locator('.continuous-outline-block[data-continuous-outline-id="outline-current"]');
    const field = block.locator(".continuous-outline-title-input");
    await expect.poll(() => field.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    if (viewport.width <= 480) {
      const fieldBounds = await field.boundingBox();
      const rowBounds = await block.locator(".continuous-outline-title-row").boundingBox();
      expect(fieldBounds!.width).toBeGreaterThan(rowBounds!.width * .95);
    }
    for (const selector of [".continuous-outline-chat", ".continuous-outline-properties"]) {
      const action = block.locator(selector);
      await expect(action.locator(".icon")).toBeVisible();
      const bounds = await action.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(viewport.width < 768 ? 43.5 : 30);
    }
  }
  await page.setViewportSize(testInfo.project.name === "mobile-chromium" ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("outlines.png") });
});
