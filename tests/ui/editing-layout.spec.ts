import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fullStudioFixture } from "../fixtures.mjs";
import type { StudioData } from "../../app/studio-state";

const body = Array.from({ length: 100 }, (_, index) => `第${String(index + 1).padStart(3, "0")}段：${index < 45 ? "潮声越过防波堤，林澈沿着水痕继续向前。Mixed English words remain in the same line. ".repeat(5) : "归途。"}\n　　保留缩进、空行和标点。`).join("\n\n") + "\n最终查找目标。";

test.beforeEach(async ({ page, request }) => {
  const current = await (await request.get("/api/state")).json();
  const data = fullStudioFixture();
  data.articles[0].chapters[0].outlines[1].content = body;
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data, conflictResolution: "keep-local" } })).ok()).toBeTruthy();
  await page.addInitScript({ content: await readFile("node_modules/textarea-caret/index.js", "utf8") });
});

async function characterBounds(target: Locator, offset: number) {
  return target.evaluate((element, index) => {
    if (element instanceof HTMLTextAreaElement) {
      const caret = (window as Window & { getCaretCoordinates: (element: HTMLTextAreaElement, index: number) => { left: number; top: number; height: number } }).getCaretCoordinates(element, index);
      const rect = element.getBoundingClientRect();
      return { x: rect.left + caret.left, y: rect.top + caret.top - element.scrollTop, height: caret.height };
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = index;
    let node = walker.nextNode();
    while (node && remaining >= (node.textContent?.length ?? 0)) { remaining -= node.textContent?.length ?? 0; node = walker.nextNode(); }
    if (!node) throw new Error("Text offset is outside the document");
    const range = document.createRange();
    range.setStart(node, remaining);
    range.setEnd(node, remaining + 1);
    const rect = range.getBoundingClientRect();
    // Text glyphs and textarea line boxes use different vertical origins.
    const style = getComputedStyle(element);
    const lineHeight = parseFloat(style.lineHeight);
    return { x: rect.left, y: rect.top - (lineHeight - rect.height) / 2, height: lineHeight };
  }, offset);
}

async function openFind(page: Page) {
  const mobile = await page.getByRole("button", { name: "更多编辑操作", exact: true }).isVisible();
  if (mobile) {
    await page.getByRole("button", { name: "更多编辑操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "查找与替换", exact: true }).click();
  } else await page.getByRole("button", { name: "查找正文", exact: true }).click();
}

for (const ratio of [0, .42, 1]) {
  test(`body editing retains the visible text anchor at ${ratio}`, async ({ page }, info) => {
    await page.goto("/articles/article-main/outlines/outline-current/write");
    const reader = page.getByLabel("正文内容", { exact: true });
    await expect(reader).toContainText("最终查找目标");
    await reader.evaluate((element, value) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * value; }, ratio);
    if (ratio > 0 && info.project.name === "mobile-chromium") {
      // Measure the text anchor after the scroll-responsive controls finish moving.
      const toolbar = page.locator('.workspace-pane[data-reading-chrome="hidden"] > .workspace-pane-toolbar');
      await expect(toolbar).toBeHidden();
      await expect.poll(async () => (await toolbar.boundingBox())?.height ?? 0).toBeLessThan(1);
    }
    const offset = await reader.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const lineHeight = parseFloat(style.lineHeight);
      const x = rect.left + parseFloat(style.paddingLeft) + 8;
      const y = rect.top + parseFloat(style.paddingTop) + lineHeight * 2.5;
      const range = document.caretRangeFromPoint(x, y);
      if (!range || !element.contains(range.startContainer)) throw new Error("Cannot find visible text");
      const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset);
      return prefix.toString().length;
    });
    const before = await characterBounds(reader, offset);
    const beforeRect = (await reader.boundingBox())!;
    await page.screenshot({ path: info.outputPath(`read-${ratio}.png`) });
    await reader.press("Enter");
    const editor = page.getByLabel("正文编辑器", { exact: true });
    await expect(editor).toBeFocused();
    if (ratio < 1) {
      await expect.poll(async () => {
        const rect = (await editor.boundingBox())!;
        const chromeShift = page.viewportSize()!.width < 768 ? rect.y - beforeRect.y : 0;
        return Math.abs((await characterBounds(editor, offset)).y - before.y - chromeShift);
      }).toBeLessThan(3);
    } else {
      await expect.poll(() => editor.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
    }
    expect(Math.abs((await characterBounds(editor, offset)).x - before.x)).toBeLessThan(2);
    await page.screenshot({ path: info.outputPath(`edit-${ratio}.png`) });
    await page.getByRole("button", { name: "退出编辑", exact: true }).click();
    await expect(reader).toBeVisible();
    await expect.poll(async () => Math.abs((await characterBounds(reader, offset)).y - before.y)).toBeLessThan(3);
  });
}

test("body editing keeps the clicked caret in uneven paragraphs", async ({ page }) => {
  await page.goto("/articles/article-main/outlines/outline-current/write");
  const reader = page.getByLabel("正文内容", { exact: true });
  await expect(reader).toContainText("最终查找目标");
  await reader.evaluate(element => { element.scrollTop = (element.scrollHeight - element.clientHeight) * .68; });
  const rect = await reader.boundingBox();
  const point = { x: 70, y: Math.min(rect!.height - 40, 140) };
  const expected = await reader.evaluate((element, position) => {
    const rect = element.getBoundingClientRect();
    const range = document.caretRangeFromPoint(rect.left + position.x, rect.top + position.y)!;
    const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(range.startContainer, range.startOffset);
    return prefix.toString().length;
  }, point);
  await reader.dblclick({ position: point });
  const editor = page.getByLabel("正文编辑器", { exact: true });
  await expect(editor).toBeFocused();
  const caret = await editor.evaluate(element => (element as HTMLTextAreaElement).selectionStart);
  expect(Math.abs(caret - expected)).toBeLessThan(40);
  const caretBounds = await characterBounds(editor, caret);
  const editorBounds = await editor.boundingBox();
  expect(caretBounds.y).toBeGreaterThanOrEqual(editorBounds!.y);
  expect(caretBounds.y + caretBounds.height).toBeLessThanOrEqual(editorBounds!.y + editorBounds!.height);
});

test("body find reveals the selected result and replacement treats dollar signs literally", async ({ page }) => {
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByLabel("正文内容", { exact: true }).press("Enter");
  const editor = page.getByLabel("正文编辑器", { exact: true });
  await openFind(page);
  await page.getByRole("textbox", { name: "查找正文", exact: true }).fill("最终查找目标");
  await page.getByRole("button", { name: "下一个", exact: true }).click();
  const bounds = await characterBounds(editor, body.indexOf("最终查找目标"));
  const rect = await editor.boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(rect!.y);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(rect!.y + rect!.height);
  await page.getByRole("textbox", { name: "替换内容", exact: true }).fill("$&-$1-$$");
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(editor).toHaveValue(body.replace("最终查找目标", () => "$&-$1-$$"));
});

test("focus writing keeps the entire body editor within its scroll surface", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "desktop focus mode");
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "专注写作", exact: true }).click();
  await page.getByLabel("正文内容", { exact: true }).press("Enter");
  const editor = page.getByLabel("正文编辑器", { exact: true });
  const bounds = await editor.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await editor.press("Control+End");
  const caret = await characterBounds(editor, body.length);
  expect(caret.y + caret.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test("body editing preserves typography and fits narrow, landscape and tablet viewports", async ({ page, request }, info) => {
  test.setTimeout(90_000);
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await expect(page.getByLabel("正文内容", { exact: true })).toBeVisible();
  for (const [width, height, fontSize, lineHeight, font] of [
    [320, 568, 14, 1.4, "sans"], [390, 480, 24, 2.2, "serif"],
    [667, 375, 17, 1.8, "mono"], [820, 900, 14, 1.4, "kai"],
  ] as const) {
    await page.setViewportSize({ width, height });
    const current = await (await request.get("/api/state")).json();
    const data = fullStudioFixture() as unknown as StudioData;
    data.settings = { ...data.settings, fontSize, lineHeight, editorFont: font, contentWidth: 640 };
    await page.evaluate(settings => localStorage.setItem("writer-studio:device-ui-v1", JSON.stringify({ settings })), data.settings);
    data.articles[0].chapters[0].outlines[1].content = body;
    expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data, conflictResolution: "keep-local" } })).ok()).toBeTruthy();
    await page.goto("/articles/article-main/outlines/outline-current/write");
    const reader = page.getByLabel("正文内容", { exact: true });
    await expect(reader).toContainText("最终查找目标");
    const styles = await reader.evaluate(element => {
      const style = getComputedStyle(element);
      return { size: style.fontSize, line: style.lineHeight, family: style.fontFamily, width: element.clientWidth, padding: style.padding };
    });
    expect(parseFloat(styles.size)).toBe(width < 768 ? Math.max(16, fontSize) : fontSize);
    await reader.press("Enter");
    const editor = page.getByLabel("正文编辑器", { exact: true });
    await expect(editor).toBeFocused();
    await expect.poll(() => editor.evaluate(element => {
      const style = getComputedStyle(element);
      return { size: style.fontSize, line: style.lineHeight, family: style.fontFamily, width: element.clientWidth, padding: style.padding };
    })).toEqual(styles);
    const rect = (await editor.boundingBox())!;
    expect(rect.height).toBeGreaterThan(100);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(height);
    await openFind(page);
    const find = page.locator(".find-bar");
    const findRect = (await find.boundingBox())!;
    const editorRect = (await editor.boundingBox())!;
    expect(findRect.y + findRect.height).toBeLessThanOrEqual(editorRect.y);
    expect(await find.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const button of await find.getByRole("button").all()) {
      const buttonRect = (await button.boundingBox())!;
      expect(buttonRect.x).toBeGreaterThanOrEqual(findRect.x);
      expect(buttonRect.x + buttonRect.width).toBeLessThanOrEqual(findRect.x + findRect.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`editing-${width}-${height}.png`) });
    await page.getByRole("button", { name: "关闭查找", exact: true }).click();
    await page.getByRole("button", { name: "退出编辑", exact: true }).click();
  }
});

test("body editing retains the paragraph reached below an expanded review report", async ({ page, request }) => {
  const current = await (await request.get("/api/state")).json();
  const data = current.data as StudioData;
  const outline = data.articles[0].chapters[0].outlines[1];
  outline.versions[0] = { ...outline.versions[0], content: body, reviewReport: {
    maxRounds: 1, completedRounds: 1, stopReason: "limit", rules: "时间线", instruction: "", history: [],
    issues: Array.from({ length: 8 }, (_, index) => ({ id: `P${index}`, status: "open", rule: "时间线", description: "核对线索出现的时间。", evidence: "第二天清晨。", reason: "需要核对前后事件。", suggestion: "统一事件日期。" })),
  } };
  outline.currentVersionId = outline.versions[0].id;
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.locator(".generate-review-report > summary").click();
  const reader = page.getByLabel("正文内容", { exact: true });
  await reader.evaluate(element => {
    const scroll = element.closest(".writing-scroll")!;
    scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + 1200;
  });
  const point = await reader.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const container = element.closest(".writing-scroll")!.getBoundingClientRect();
    return { x: 70, y: container.top + 100 - rect.top };
  });
  const offset = await reader.evaluate((element, point) => {
    const rect = element.getBoundingClientRect();
    const caret = document.caretRangeFromPoint(rect.left + point.x, rect.top + point.y)!;
    const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(caret.startContainer, caret.startOffset);
    return prefix.toString().length;
  }, point);
  await reader.dblclick({ position: point });
  const editor = page.getByLabel("正文编辑器", { exact: true });
  await expect(editor).toBeFocused();
  await expect.poll(async () => {
    const caret = await characterBounds(editor, offset);
    const rect = (await editor.boundingBox())!;
    return caret.y >= rect.y && caret.y + caret.height <= rect.y + rect.height;
  }).toBe(true);
});
