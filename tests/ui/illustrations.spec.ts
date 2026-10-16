import { expect, test, type Page } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";
import type { IllustrationRecord } from "../../lib/illustration-history";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";
const excerpt = "林澈看向顾屿";

async function mockIllustrations(page: Page, promptText = "码头上两人相望，水彩插图，无文字。") {
  const records: IllustrationRecord[] = [];
  const bodies: Record<string, unknown>[] = [];
  const control = { failImage: false, holdPrompt: null as Promise<void> | null, holdImage: null as Promise<void> | null };
  await page.route("**/api/ai/illustrations**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/");
    const method = request.method();
    const body = method === "POST" || method === "PATCH" ? request.postDataJSON() as Record<string, unknown> | null : null;
    if (parts.at(-1) === "illustrations") {
      if (method === "GET") return route.fulfill({ json: { records: url.searchParams.has("outlineId") ? records : records.filter(record => ["queued", "running"].includes(record.status)), hasMore: false, backgroundMode: "app" } });
      bodies.push(body!);
      const record: IllustrationRecord = {
        id: `test-${records.length}`, kind: body!.action === "image" ? "image" : "prompt", outlineId: "outline-current", outlineTitle: "潮汐表",
        prompt: String(body!.prompt || ""), excerpt: String(body!.excerpt || ""), style: String(body!.style || ""),
        status: body!.action === "save-prompt" ? "success" : "queued", archived: false, model: String(body!.model || ""), modelName: "测试模型", createdAt: new Date().toISOString(),
      };
      records.unshift(record);
      return route.fulfill({ status: body!.action === "save-prompt" ? 201 : 202, json: { record } });
    }
    if (parts.at(-1) === "image") return route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") });
    const id = parts.at(-1) === "execute" ? parts.at(-2) : parts.at(-1);
    const record = records.find(record => record.id === id)!;
    if (parts.at(-1) === "execute") {
      if (record.status !== "queued") return route.fulfill({ body: "{}" });
      record.status = "running";
      await (record.kind === "prompt" ? control.holdPrompt : control.holdImage);
      if (record.status as string === "cancelled") return route.fulfill({ body: "{}" });
      if (record.kind === "image" && control.failImage) { record.status = "error"; record.error = "图片服务暂时不可用"; }
      else { record.status = "success"; if (record.kind === "prompt") { record.prompt = promptText; record.excerpt = excerpt; } else record.src = `/api/ai/illustrations/${record.id}/image`; }
      return route.fulfill({ body: "{}" });
    }
    if (method === "DELETE") { records.splice(records.indexOf(record), 1); return route.fulfill({ status: 204 }); }
    if (method === "PATCH") {
      if (body!.action === "archive") record.archived = true;
      if (body!.action === "restore") record.archived = false;
      if (body!.action === "cancel") record.status = "cancelled";
      return route.fulfill({ json: { record } });
    }
    return route.fulfill({ json: { record } });
  });
  return { records, bodies, control };
}

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
  const { bodies, control } = await mockIllustrations(page);
  control.failImage = true;
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
  control.failImage = false;
  await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(dialog.getByAltText("根据正文片段生成的插图")).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ action: "image", model: "image", prompt: "编辑后的水彩插图 prompt", aspectRatio: "16:9", resolution: "2K" });
  await expect(dialog.getByRole("link", { name: "下载图片" })).toHaveAttribute("href", /\/image\?download=1$/);
  await dialog.getByRole("button", { name: "返回正文", exact: true }).click();
  await expect(page.getByRole("region", { name: "正文内容", exact: true })).toContainText("林澈看向顾屿，确认潮汐表上的时间。");
  expect((await (await request.get("/api/state")).json()).data.articles[0].chapters[0].outlines[1].content).toBe("林澈看向顾屿，确认潮汐表上的时间。");
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }, { width: 390, height: 480 }]) {
  test(`illustration selection and result remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockIllustrations(page, "场景构图。".repeat(80));
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

test("background results survive modal dismissal and reload, and history manages prompts and images", async ({ page }) => {
  const { control } = await mockIllustrations(page);
  let completePrompt!: () => void, completeImage!: () => void;
  control.holdPrompt = new Promise(resolve => { completePrompt = resolve; });
  control.holdImage = new Promise(resolve => { completeImage = resolve; });
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "生成插图", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "从正文生成插图" });
  await dialog.getByRole("combobox", { name: "提示词模型", exact: true }).click();
  await page.getByRole("option", { name: /文本测试模型/ }).click();
  await dialog.getByRole("button", { name: "选景并生成图片 prompt" }).click();
  await dialog.getByRole("button", { name: "放到后台，继续写作" }).click();
  await expect(dialog).toBeHidden();
  completePrompt();
  await page.getByRole("button", { name: "插图历史", exact: true }).click();
  await dialog.getByRole("tab", { name: "Prompt 历史", exact: true }).click();
  await expect(dialog.getByText("码头上两人相望，水彩插图，无文字。", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "归档", exact: true }).click();
  await expect(dialog.getByText("暂无记录。生成结果会自动出现在这里。", { exact: true })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Prompt 状态", exact: true }).click();
  await page.getByRole("option", { name: "已归档", exact: true }).click();
  await dialog.getByRole("button", { name: "恢复", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Prompt 状态", exact: true }).click();
  await page.getByRole("option", { name: "未归档", exact: true }).click();
  await dialog.getByRole("button", { name: "使用此 prompt", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "图片 prompt", exact: true })).toHaveValue("码头上两人相望，水彩插图，无文字。");
  await dialog.getByRole("textbox", { name: "图片 prompt", exact: true }).fill("手动添加的历史 prompt");
  await dialog.getByRole("button", { name: "保存 prompt 到历史", exact: true }).click();
  await expect(dialog.getByText("Prompt 已添加到历史。", { exact: true })).toBeVisible();
  await dialog.getByRole("combobox", { name: "文生图模型", exact: true }).click();
  await page.getByRole("option", { name: /图片测试模型/ }).click();
  await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
  await dialog.getByRole("button", { name: "放到后台，继续写作" }).click();
  await expect(dialog).toBeHidden();
  completeImage();
  await page.reload();
  await page.getByRole("button", { name: "插图历史", exact: true }).click();
  await expect(dialog.getByAltText("历史插图")).toBeVisible();
  await expect(dialog.getByText("手动添加的历史 prompt", { exact: true })).toBeVisible();
  await page.screenshot({ path: `.test-data/illustration-history-${test.info().project.name}.png` });
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByAltText("历史插图")).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Prompt 历史", exact: true }).click();
  await dialog.getByRole("textbox", { name: "搜索历史", exact: true }).fill("手动添加");
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByText("没有匹配的历史记录。", { exact: true })).toBeVisible();
});
