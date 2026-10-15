import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";
const excerpt = "林澈看向顾屿";

test.beforeEach(async ({ page, request }) => {
  await page.route("**/api/connectivity", route => route.fulfill({ status: 204 }));
  const current = await (await request.get("/api/state")).json();
  await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data: fullStudioFixture() } });
  await page.route("**/api/models", (route) => route.fulfill({ json: { models: [
    { id: "text", name: "文本测试模型", modelId: "text", providerName: "测试", hasSecret: true },
    { adapterKind: "openrouter", metadata: { source: "manual", inputModalities: ["text"], outputModalities: ["image"], supportedParameters: { aspect_ratio: { type: "enum", values: ["16:9"] }, resolution: { type: "enum", values: ["2K"] } } }, id: "image", name: "图片测试模型", modelId: "image", providerName: "测试", hasSecret: true },
  ] } }));
});

test("illustration workflow permits prompt edits, image retry and download without modifying prose", async ({ page, request }) => {
  const bodies: Record<string, unknown>[] = [];
  let fail = true;
  await page.route("**/api/ai/illustrations", (route) => {
    const body = route.request().postDataJSON(); bodies.push(body);
    return route.fulfill(body.action === "prompt"
      ? { json: { excerpt, prompt: "码头上两人相望，水彩插图，无文字。" } }
      : fail ? { status: 502, json: { error: "图片服务暂时不可用" } } : { json: { src: `data:image/png;base64,${png}` } });
  });
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "生成插图", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "从正文生成插图" });
  await dialog.getByRole("combobox", { name: "提示词模型", exact: true }).click();
  await page.getByRole("option", { name: /文本测试模型/ }).click();
  await dialog.getByRole("button", { name: "选景并生成图片 prompt" }).click();
  await expect(dialog.getByRole("textbox", { name: "正文片段", exact: true })).toHaveValue(excerpt);
  expect(bodies[0].excerpt).toBe("");
  await dialog.getByRole("textbox", { name: "图片 prompt", exact: true }).fill("编辑后的水彩插图 prompt");
  await dialog.getByRole("combobox", { name: "文生图模型", exact: true }).click();
  await page.getByRole("option", { name: /图片测试模型/ }).click();
  await dialog.getByRole("combobox", { name: "画面比例", exact: true }).click();
  await page.getByRole("option", { name: "16:9", exact: true }).click();
  await dialog.getByRole("combobox", { name: "图像分辨率", exact: true }).click();
  await page.getByRole("option", { name: "2K", exact: true }).click();
  await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("图片服务暂时不可用");
  await expect(dialog.getByRole("textbox", { name: "图片 prompt", exact: true })).toHaveValue("编辑后的水彩插图 prompt");
  fail = false;
  await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(dialog.getByAltText("根据正文片段生成的插图")).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ action: "image", model: "image", prompt: "编辑后的水彩插图 prompt", aspectRatio: "16:9", resolution: "2K" });
  await expect(dialog.getByRole("link", { name: "下载图片" })).toHaveAttribute("download", "writer-studio-illustration.png");
  await dialog.getByRole("button", { name: "返回正文", exact: true }).click();
  await expect(page.getByRole("region", { name: "正文内容", exact: true })).toContainText("林澈看向顾屿，确认潮汐表上的时间。");
  expect((await (await request.get("/api/state")).json()).data.articles[0].chapters[0].outlines[1].content).toBe("林澈看向顾屿，确认潮汐表上的时间。");
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }, { width: 390, height: 480 }]) {
  test(`illustration selection and result remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/ai/illustrations", (route) => route.fulfill({ json: route.request().postDataJSON().action === "prompt" ? { excerpt, prompt: "场景构图。".repeat(80) } : { src: `data:image/png;base64,${png}` } }));
    await page.goto("/articles/article-main/outlines/outline-current/write");
    const reader = page.getByRole("region", { name: "正文内容", exact: true });
    await reader.evaluate((element) => {
      const text = element.firstChild!;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 6);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 150 }));
    });
    await page.getByRole("menuitem", { name: "生成插图", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "从正文生成插图" });
    await expect(dialog.getByRole("textbox", { name: "正文片段", exact: true })).toHaveValue(excerpt);
    await dialog.getByRole("combobox", { name: "提示词模型", exact: true }).click();
    await page.getByRole("option", { name: /文本测试模型/ }).click();
    await dialog.getByRole("button", { name: "选景并生成图片 prompt" }).click();
    await dialog.getByRole("combobox", { name: "文生图模型", exact: true }).click();
    await page.getByRole("option", { name: /图片测试模型/ }).click();
    await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
    const download = dialog.getByRole("link", { name: "下载图片" });
    await download.scrollIntoViewIfNeeded(); await expect(download).toBeVisible();
    const bounds = await dialog.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(viewport.width); expect(bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await dialog.getByRole("button", { name: "返回正文", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
}
