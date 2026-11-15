import { openGlobalAiSettings } from "./ai-task-settings-helper";
import { expect, test, type Page } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";
import type { IllustrationRecord } from "../../lib/illustration-history";
import type { AiTask } from "../../app/studio-state";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlp8AAAAASUVORK5CYII=";
const excerpt = "林澈看向顾屿";
const negativePrompt = "text, watermark, blurry, extra limbs, duplicate characters";

async function mockIllustrations(page: Page, promptText = "码头上两人相望，水彩插图，无文字。") {
  const records: IllustrationRecord[] = [];
  const bodies: Record<string, unknown>[] = [];
  const control = { failImage: false, holdPrompt: null as Promise<void> | null, holdImage: null as Promise<void> | null };
  const executions = new Map<string, number>();
  let revision = 0;
  const asTask = (record: IllustrationRecord): AiTask => ({
    id: record.id, articleId: "article-main", chapterId: "chapter-main", outlineId: record.outlineId,
    target: record.kind === "image" ? "插图" : "插图 Prompt", model: record.model, executionOrigin: "local",
    prompt: record.prompt || "从正文选景并编写插图 prompt", createdAt: record.createdAt,
    state: record.status === "queued" ? "waiting" : record.status === "error" ? "failed" : record.status,
    phase: record.status === "queued" ? "queued" : record.status === "running" ? "generating" : record.status === "success" ? "completed" : record.status === "error" ? "failed" : "cancelled",
    leaseUntil: new Date(Date.now() + 90_000).toISOString(), error: record.error,
    resultText: record.status === "success" ? record.prompt : undefined,
    contextOptions: { illustrationId: record.id, illustrationKind: record.kind, includePrevious: false, includeCharacters: record.kind === "prompt", estimatedCharacters: 100, modelName: "测试模型" },
  });
  const execute = async (record: IllustrationRecord) => {
    if (record.status !== "queued") return;
    const attempt = (executions.get(record.id) ?? 0) + 1; executions.set(record.id, attempt);
    record.status = "running";
    await (record.kind === "prompt" ? control.holdPrompt : control.holdImage);
    if (executions.get(record.id) !== attempt || record.status as string === "cancelled") return;
    if (record.kind === "image" && control.failImage) { record.status = "error"; record.error = "图片服务暂时不可用"; }
    else { record.status = "success"; if (record.kind === "prompt") { record.prompt = promptText; record.negativePrompt = negativePrompt; record.excerpt = excerpt; } else record.src = `/api/ai/illustrations/${record.id}/image`; }
  };
  await page.route("**/api/state", async route => {
    if (route.request().method() !== "GET") return route.continue();
    try {
      const headers = route.request().headers(); delete headers["if-none-match"];
      const response = await route.fetch({ headers });
      const payload = await response.json(); revision = payload.revision;
      payload.data.tasks = [...records.filter(record => record.model).map(asTask), ...payload.data.tasks];
      return await route.fulfill({ response, json: payload });
    } catch (error) {
      // A task poll may still be in flight when Playwright closes this page.
      if (page.isClosed() || /Response has been disposed|Target page, context or browser has been closed/.test(String(error))) return;
      throw error;
    }
  });
  await page.route("**/api/ai/tasks**", async route => {
    const parts = new URL(route.request().url()).pathname.split("/");
    if (parts.at(-1) === "tasks") return route.fulfill({ json: { tasks: records.filter(record => record.model).map(asTask), runningOutlineIds: [], revision } });
    const record = records.find(record => record.id === parts.at(-2));
    if (!record) return route.continue();
    if (parts.at(-1) === "execute") { await execute(record); return route.fulfill({ body: "{}" }); }
    const { action } = route.request().postDataJSON();
    if (action === "cancel") { record.status = "cancelled"; executions.set(record.id, (executions.get(record.id) ?? 0) + 1); }
    if (action === "retry") { record.status = "queued"; record.error = undefined; }
    return route.fulfill({ json: { task: asTask(record), revision } });
  });
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
        prompt: String(body!.prompt || ""), excerpt: String(body!.excerpt || ""), style: String(body!.style || ""), stylePreset: body!.stylePreset as IllustrationRecord["stylePreset"],
        promptLanguage: body!.promptLanguage as IllustrationRecord["promptLanguage"],
        additionalPrompt: body!.additionalPrompt as IllustrationRecord["additionalPrompt"],
        negativePrompt: body!.negativePrompt as string | undefined,
        status: body!.action === "save-prompt" ? "success" : "queued", archived: false, model: String(body!.model || ""), modelName: "测试模型", createdAt: new Date().toISOString(),
      };
      records.unshift(record);
      return route.fulfill({ status: body!.action === "save-prompt" ? 201 : 202, json: { record } });
    }
    if (parts.at(-1) === "image") return route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") });
    const id = parts.at(-1) === "execute" ? parts.at(-2) : parts.at(-1);
    const record = records.find(record => record.id === id)!;
    if (parts.at(-1) === "execute") {
      await execute(record);
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

test("illustration tab has its own route, preserves drafts between modes and links to history", async ({ page }) => {
  await mockIllustrations(page);
  await page.goto("/articles/article-main/outlines/outline-current/write");
  const modes = page.getByRole("tablist", { name: "工作模式" });
  await expect(modes.getByRole("tab")).toHaveText(["写作", "聊天", "生成", "插图"]);
  await expect(page.getByRole("button", { name: "生成插图", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "插图历史", exact: true })).toHaveCount(0);
  await modes.getByRole("tab", { name: "插图", exact: true }).click();
  await expect(page).toHaveURL(/\/outlines\/outline-current\/illustrations$/);
  const workspace = page.getByRole("region", { name: "插图工作区" });
  await workspace.getByRole("textbox", { name: "图片 prompt", exact: true }).fill("切换页签后保留的画面构图");
  await modes.getByRole("tab", { name: "聊天", exact: true }).click();
  await modes.getByRole("tab", { name: "生成", exact: true }).click();
  await modes.getByRole("tab", { name: "插图", exact: true }).click();
  await expect(workspace.getByRole("textbox", { name: "图片 prompt", exact: true })).toHaveValue("切换页签后保留的画面构图");
  await workspace.getByRole("button", { name: "查看历史", exact: true }).click();
  await expect(workspace.getByRole("textbox", { name: "搜索历史", exact: true })).toBeInViewport();
  await page.reload();
  await expect(modes.getByRole("tab", { name: "插图", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(workspace).toBeVisible();
});

test("illustration styles apply to both generation steps and restore from saved history", async ({ page }) => {
  const { bodies } = await mockIllustrations(page);
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("tab", { name: "插图", exact: true }).click();
  const dialog = page.getByRole("region", { name: "插图工作区" });
  const styles = dialog.getByRole("combobox", { name: "插图风格", exact: true });
  await expect(styles).toHaveValue("文学插图");
  await styles.click();
  for (const name of ["跟随 Prompt", "水彩插画", "国风水墨", "日系动漫", "电影写实", "油画质感", "铅笔素描", "扁平插画", "剪纸拼贴", "3D 绘本", "像素艺术"]) {
    await expect(page.getByRole("option", { name, exact: true })).toBeAttached();
  }
  await page.getByRole("option", { name: "水彩插画", exact: true }).click();
  await dialog.getByRole("textbox", { name: "画面要求（可选）", exact: true }).fill("冷色调，逆光");
  await dialog.getByRole("combobox", { name: "提示词模型", exact: true }).click();
  await page.getByRole("option", { name: /文本测试模型/ }).click();
  await dialog.getByRole("button", { name: "选景并生成图片 prompt" }).click();
  await expect(dialog.getByRole("textbox", { name: "图片 prompt", exact: true })).not.toHaveValue("");
  expect(bodies.at(-1)).toMatchObject({ action: "prompt", stylePreset: "watercolor", style: "冷色调，逆光" });
  await styles.click();
  await page.getByRole("option", { name: "国风水墨", exact: true }).click();
  await dialog.getByRole("combobox", { name: "文生图模型", exact: true }).click();
  await page.getByRole("option", { name: /图片测试模型/ }).click();
  await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(dialog.getByAltText("根据正文片段生成的插图")).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ action: "image", stylePreset: "ink", style: "冷色调，逆光" });
  await dialog.getByRole("tab", { name: "Prompt 历史", exact: true }).click();
  await expect(dialog.getByText("水彩插画", { exact: true })).toBeVisible();
  await dialog.getByRole("region", { name: "生成内容管理" }).getByRole("button", { name: "使用此 prompt", exact: true }).click();
  await expect(styles).toHaveValue("水彩插画");
  await expect(dialog.getByRole("textbox", { name: "画面要求（可选）", exact: true })).toHaveValue("冷色调，逆光");
  await styles.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.test-data/illustration-styles-${test.info().project.name}.png` });
  await dialog.getByRole("button", { name: "保存 prompt 到历史", exact: true }).click();
  await expect(dialog.getByText("Prompt 已添加到历史。", { exact: true })).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ action: "save-prompt", stylePreset: "watercolor" });
  await page.reload();
  await page.getByRole("tab", { name: "插图", exact: true }).click();
  await dialog.getByRole("region", { name: "生成内容管理" }).getByRole("button", { name: "使用此 prompt", exact: true }).click();
  await expect(styles).toHaveValue("国风水墨");
  await styles.click();
  await page.getByRole("option", { name: "跟随 Prompt", exact: true }).click();
  await expect(styles).toHaveValue("跟随 Prompt");
});

test("SpicyAPI image model exposes its native aspect ratio and resolution choices", async ({ page }) => {
  const { bodies } = await mockIllustrations(page);
  await page.route("**/api/models", route => route.fulfill({ json: { models: [
    { id: "wan", name: "Wan 2.7 Pro", modelId: "alibaba/wan-2.7-pro/text-to-image", providerName: "spicy", hasSecret: true, adapterKind: "spicyapi", baseUrl: "https://api.spicyapi.ai/api/v1", metadata: { source: "provider", inputModalities: ["text"], outputModalities: ["image"], supportedParameters: { aspect_ratio: { type: "string", values: ["1:1", "16:9"] }, resolution: { type: "string", values: ["1k", "2k"] } } } },
  ] } }));
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("tab", { name: "插图", exact: true }).click();
  const dialog = page.getByRole("region", { name: "插图工作区" });
  await dialog.getByRole("textbox", { name: "图片 prompt", exact: true }).fill("水彩画，一座海边的灯塔。");
  await dialog.getByRole("combobox", { name: "文生图模型", exact: true }).click();
  await page.getByRole("option", { name: "spicy-Wan 2.7 Pro", exact: true }).click();
  await expect(dialog.getByText(/提交后的远程任务无法取消/)).toBeVisible();
  await dialog.getByRole("combobox", { name: "画面比例", exact: true }).click();
  await page.getByRole("option", { name: "16:9", exact: true }).click();
  await dialog.getByRole("combobox", { name: "图像分辨率", exact: true }).click();
  await page.getByRole("option", { name: "2k", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "图片尺寸", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(dialog.getByAltText("根据正文片段生成的插图")).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ model: "wan", aspectRatio: "16:9", resolution: "2k" });
});

test("article image presets inherit, persist outline overrides and restore article defaults", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const { bodies } = await mockIllustrations(page);
  const articlePrompt = "保持人物一致，无文字和水印。";
  const outlinePrompt = "柔和光线，细腻的手绘笔触。\n".repeat(200);
  const choose = async (label: string, option: string) => {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  const storedArticle = async () => (await (await request.get("/api/state")).json()).data.articles[0];
  const storedOptions = async () => (await storedArticle()).chapters.flatMap((chapter: { outlines: { id: string; illustrationOptions: unknown }[] }) => chapter.outlines).find((outline: { id: string }) => outline.id === "outline-current").illustrationOptions;
  await openGlobalAiSettings(page, "图片");
  await expect(page.getByRole("heading", { name: "图片生成设置", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "文章图片 Prompt 默认语言", exact: true })).toHaveValue("English");
  await expect(page.getByRole("combobox", { name: "文章图片 Prompt 默认语言", exact: true })).toBeDisabled();
  await choose("文章图片默认风格", "国风水墨");
  await choose("文章图片默认分辨率", "2K");
  await page.getByRole("textbox", { name: "文章图片附加 Prompt", exact: true }).fill(articlePrompt);
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.illustrationSettings).toMatchObject({ promptLanguage: "en", stylePreset: "ink", resolution: "2k", additionalPrompt: articlePrompt });
  await page.getByRole("heading", { name: "图片生成设置", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.test-data/article-image-settings-${testInfo.project.name}.png` });

  const openGenerator = async (outlineId = "outline-current") => {
    await page.goto(`/articles/article-main/outlines/${outlineId}/write`);
    await page.getByRole("tab", { name: "插图", exact: true }).click();
    return page.getByRole("region", { name: "插图工作区" });
  };
  let dialog = await openGenerator();
  await expect(dialog.getByRole("textbox", { name: "附加 Prompt", exact: true })).toHaveValue(articlePrompt);
  await expect(dialog.getByRole("combobox", { name: "生成 Prompt 的语言", exact: true })).toHaveValue("English");
  await expect(dialog.getByRole("combobox", { name: "插图风格", exact: true })).toHaveValue("国风水墨");
  await choose("提示词模型", "测试-文本测试模型");
  await dialog.getByRole("button", { name: "选景并生成图片 prompt" }).click();
  await expect(dialog.getByRole("textbox", { name: "图片 prompt", exact: true })).not.toHaveValue("");
  expect(bodies.at(-1)).toMatchObject({ action: "prompt", promptLanguage: "en", stylePreset: "ink", additionalPrompt: articlePrompt });
  await choose("文生图模型", "测试-图片测试模型");
  await expect(dialog.getByRole("combobox", { name: "图像分辨率", exact: true })).toHaveValue("2K");
  await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(dialog.getByAltText("根据正文片段生成的插图")).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ action: "image", resolution: "2K", stylePreset: "ink", additionalPrompt: articlePrompt });
  expect(await storedOptions()).toBeNull();
  await choose("插图风格", "日系动漫");
  await dialog.getByRole("textbox", { name: "附加 Prompt", exact: true }).fill(outlinePrompt);
  await expect.poll(storedOptions).toMatchObject({ promptLanguage: "en", stylePreset: "anime", resolution: "2k", additionalPrompt: outlinePrompt });
  await dialog.getByRole("button", { name: "返回正文", exact: true }).click();

  await openGlobalAiSettings(page, "图片");
  await choose("文章图片默认风格", "水彩插画");
  await choose("文章图片默认分辨率", "4K");
  await page.getByRole("textbox", { name: "文章图片附加 Prompt", exact: true }).fill("保留水彩纸张纹理。");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.illustrationSettings).toMatchObject({ promptLanguage: "en", stylePreset: "watercolor", resolution: "4k", additionalPrompt: "保留水彩纸张纹理。" });
  dialog = await openGenerator();
  await expect(dialog.getByRole("textbox", { name: "附加 Prompt", exact: true })).toHaveValue(outlinePrompt);
  await expect(dialog.getByRole("combobox", { name: "生成 Prompt 的语言", exact: true })).toHaveValue("English");
  await expect(dialog.getByRole("combobox", { name: "插图风格", exact: true })).toHaveValue("日系动漫");
  await choose("文生图模型", "测试-图片测试模型");
  await expect(dialog.getByRole("combobox", { name: "图像分辨率", exact: true })).toHaveValue("模型默认");
  await expect.poll(async () => (await storedOptions())?.inheritance?.resolution).toBe("parent");
  await dialog.getByRole("textbox", { name: "图片 prompt", exact: true }).fill("水彩插画：两人在码头相望。");
  await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(dialog.getByAltText("根据正文片段生成的插图")).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ additionalPrompt: outlinePrompt });
  await dialog.getByRole("textbox", { name: "附加 Prompt", exact: true }).fill("");
  await expect.poll(storedOptions).toMatchObject({ additionalPrompt: "" });
  dialog = await openGenerator();
  await expect(dialog.getByRole("textbox", { name: "附加 Prompt", exact: true })).toHaveValue("");
  await choose("文生图模型", "测试-图片测试模型");
  expect(bodies.at(-1)).not.toHaveProperty("resolution");
  await dialog.getByRole("group", { name: "全部插图设置继承", exact: true }).getByRole("button", { name: "退回文章默认", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "附加 Prompt", exact: true })).toHaveValue("保留水彩纸张纹理。");
  await expect(dialog.getByRole("combobox", { name: "生成 Prompt 的语言", exact: true })).toHaveValue("English");
  await expect(dialog.getByRole("combobox", { name: "插图风格", exact: true })).toHaveValue("水彩插画");
  await expect(dialog.getByText(/当前模型不支持预设分辨率 4k/)).toBeVisible();
  await expect.poll(async () => (await storedOptions())?.inheritance?.additionalPrompt).toBe("article");
  await expect.poll(async () => (await storedOptions())?.inheritance?.resolution).toBe("article");
  await dialog.getByRole("textbox", { name: "图片 prompt", exact: true }).fill("水彩插画：两人在码头相望。");
  await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(dialog.getByAltText("根据正文片段生成的插图")).toBeVisible();
  expect(bodies.at(-1)).not.toHaveProperty("resolution");
  await dialog.getByRole("button", { name: "返回正文", exact: true }).click();
  dialog = await openGenerator("outline-previous");
  await expect(dialog.getByRole("textbox", { name: "附加 Prompt", exact: true })).toHaveValue("保留水彩纸张纹理。");
  await expect(dialog.getByRole("combobox", { name: "插图风格", exact: true })).toHaveValue("水彩插画");
  await expect(dialog.getByRole("combobox", { name: "生成 Prompt 的语言", exact: true })).toHaveValue("English");
});

test("illustration workflow permits prompt edits, image retry and download without modifying prose", async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
  });
  const requestKeys: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/ai/illustrations") {
      requestKeys.push(request.headers()["idempotency-key"]);
    }
  });
  const { bodies, control } = await mockIllustrations(page);
  control.failImage = true;
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("tab", { name: "插图", exact: true }).click();
  const dialog = page.getByRole("region", { name: "插图工作区" });
  await dialog.getByRole("combobox", { name: "提示词模型", exact: true }).click();
  await page.getByRole("option", { name: /文本测试模型/ }).click();
  await dialog.getByRole("button", { name: "选景并生成图片 prompt" }).click();
  await expect(dialog.getByRole("textbox", { name: "正文片段", exact: true })).toHaveValue(excerpt);
  await expect(dialog.getByRole("textbox", { name: "Negative Prompt（负向提示词）", exact: true })).toHaveValue(negativePrompt);
  expect(bodies[0].promptLanguage).toBe("en");
  expect(bodies[0].excerpt).toBe("");
  await dialog.getByRole("textbox", { name: "图片 prompt", exact: true }).fill("编辑后的水彩插图 prompt");
  await dialog.getByRole("textbox", { name: "Negative Prompt（负向提示词）", exact: true }).fill("watermark, text, blurry faces");
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
  expect(bodies.at(-1)).toMatchObject({ action: "image", model: "image", prompt: "编辑后的水彩插图 prompt", negativePrompt: "watermark, text, blurry faces", aspectRatio: "16:9", resolution: "2K" });
  expect(requestKeys).toHaveLength(3);
  expect(requestKeys.every(key => typeof key === "string" && key.length > 0)).toBeTruthy();
  expect(new Set(requestKeys).size).toBe(requestKeys.length);
  await expect(dialog.locator(".illustration-result").getByRole("link", { name: "下载图片" })).toHaveAttribute("href", /\/image\?download=1$/);
  await dialog.getByRole("button", { name: "返回正文", exact: true }).click();
  await expect(page.getByRole("region", { name: "正文内容", exact: true })).toContainText("林澈看向顾屿，确认潮汐表上的时间。");
  expect((await (await request.get("/api/state")).json()).data.articles[0].chapters[0].outlines[1].content).toBe("林澈看向顾屿，确认潮汐表上的时间。");
});

test("English prompt and negative prompt can be edited, saved and restored together", async ({ page }) => {
  const englishPrompt = "Two people on a pier, soft watercolor, cool colors, side lighting.";
  const { records, bodies } = await mockIllustrations(page, englishPrompt);
  await page.goto("/articles/article-main/outlines/outline-current/illustrations");
  const dialog = page.getByRole("region", { name: "插图工作区" });
  const negative = dialog.getByRole("textbox", { name: "Negative Prompt（负向提示词）", exact: true });
  await expect(dialog.getByRole("combobox", { name: "生成 Prompt 的语言", exact: true })).toHaveValue("English");
  await dialog.getByRole("combobox", { name: "提示词模型", exact: true }).click();
  await page.getByRole("option", { name: /文本测试模型/ }).click();
  await dialog.getByRole("button", { name: "选景并生成图片 prompt" }).click();
  await expect(dialog.getByRole("textbox", { name: "图片 prompt", exact: true })).toHaveValue(englishPrompt);
  await expect(negative).toHaveValue(negativePrompt);
  await negative.fill("watermark, extra fingers, comic panels");
  await dialog.getByRole("button", { name: "保存 prompt 到历史", exact: true }).click();
  await expect(dialog.getByText("Prompt 已添加到历史。", { exact: true })).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ action: "save-prompt", prompt: englishPrompt, negativePrompt: "watermark, extra fingers, comic panels" });
  await page.reload();
  await dialog.getByRole("tab", { name: "Prompt 历史", exact: true }).click();
  const saved = dialog.locator(".illustration-history-card").filter({ hasText: "watermark, extra fingers, comic panels" });
  await expect(saved).toHaveCount(1);
  await saved.getByRole("button", { name: "使用此 prompt", exact: true }).click();
  await expect(negative).toHaveValue("watermark, extra fingers, comic panels");
  // Older records have no negative prompt; loading one must clear the draft.
  delete records.find(record => record.model === "text")!.negativePrompt;
  await dialog.getByRole("button", { name: "刷新历史", exact: true }).click();
  await dialog.locator(".illustration-history-card").filter({ hasText: negativePrompt }).waitFor({ state: "detached" });
  await dialog.locator(".illustration-history-card").last().getByRole("button", { name: "使用此 prompt", exact: true }).click();
  await expect(negative).toHaveValue("");
  await page.screenshot({ path: `.test-data/illustration-negative-prompt-${test.info().project.name}.png` });
});

for (const selected of [true, false]) {
test(`illustration source follows saved body changes after ${selected ? "opening a selected excerpt" : "generating from the whole body"}`, async ({ page }) => {
  const { bodies } = await mockIllustrations(page);
  await page.goto("/articles/article-main/outlines/outline-current/write");
  const reader = page.getByRole("region", { name: "正文内容", exact: true });
  if (selected) {
    await reader.evaluate(element => {
    const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 6);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 150 }));
    });
    await page.getByRole("menuitem", { name: "生成插图", exact: true }).click();
  } else {
    await page.getByRole("tab", { name: "插图", exact: true }).click();
    const workspace = page.getByRole("region", { name: "插图工作区" });
    await workspace.getByRole("combobox", { name: "提示词模型", exact: true }).click();
    await page.getByRole("option", { name: /文本测试模型/ }).click();
    await workspace.getByRole("button", { name: "选景并生成图片 prompt" }).click();
  }
  const workspace = page.getByRole("region", { name: "插图工作区" });
  await expect(workspace.getByRole("textbox", { name: "正文片段", exact: true })).toHaveValue(excerpt);
  await workspace.getByRole("button", { name: "返回正文", exact: true }).click();
  await reader.dblclick();
  const latest = "夜晚，林澈独自走过雨中的旧桥，远处灯塔闪烁。";
  await page.getByLabel("正文编辑器").fill(latest);
  await page.getByRole("button", { name: "退出编辑", exact: true }).click();
  await page.getByRole("dialog", { name: "保存正文修改？" }).getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(reader).toContainText(latest);
  await page.getByRole("tab", { name: "插图", exact: true }).click();
  await expect(workspace.getByRole("textbox", { name: "正文片段", exact: true })).toHaveValue("");
  await workspace.getByRole("combobox", { name: "提示词模型", exact: true }).click();
  await page.getByRole("option", { name: /文本测试模型/ }).click();
  await workspace.getByRole("button", { name: /生成图片 prompt$/ }).click();
  await expect.poll(() => bodies.filter(body => body.action === "prompt").at(-1)).toMatchObject({ content: latest, excerpt: "" });
});
}

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
    const dialog = page.getByRole("region", { name: "插图工作区" });
    await expect(dialog.getByRole("textbox", { name: "正文片段", exact: true })).toHaveValue(excerpt);
    await dialog.getByRole("combobox", { name: "提示词模型", exact: true }).click();
    await page.getByRole("option", { name: /文本测试模型/ }).click();
    await dialog.getByRole("button", { name: "选景并生成图片 prompt" }).click();
    await dialog.getByRole("combobox", { name: "文生图模型", exact: true }).click();
    await page.getByRole("option", { name: /图片测试模型/ }).click();
    await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
    const download = dialog.locator(".illustration-result").getByRole("link", { name: "下载图片" });
    await download.scrollIntoViewIfNeeded(); await expect(download).toBeVisible();
    const bounds = await dialog.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(viewport.width); expect(bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await dialog.getByRole("button", { name: "返回正文", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
}

test("background results survive tab switches and reload, and history manages prompts and images", async ({ page }) => {
  const { control } = await mockIllustrations(page);
  let completePrompt!: () => void, completeImage!: () => void;
  control.holdPrompt = new Promise(resolve => { completePrompt = resolve; });
  control.holdImage = new Promise(resolve => { completeImage = resolve; });
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("tab", { name: "插图", exact: true }).click();
  const dialog = page.getByRole("region", { name: "插图工作区" });
  await dialog.getByRole("combobox", { name: "提示词模型", exact: true }).click();
  await page.getByRole("option", { name: /文本测试模型/ }).click();
  await dialog.getByRole("button", { name: "选景并生成图片 prompt" }).click();
  await dialog.getByRole("button", { name: "放到后台，继续写作" }).click();
  await expect(dialog).toBeHidden();
  completePrompt();
  await page.getByRole("tab", { name: "插图", exact: true }).click();
  await dialog.getByRole("tab", { name: "Prompt 历史", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "生成内容管理" }).getByText("码头上两人相望，水彩插图，无文字。", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "归档", exact: true }).click();
  await expect(dialog.getByText("暂无记录", { exact: true })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Prompt 状态", exact: true }).click();
  await page.getByRole("option", { name: "已归档", exact: true }).click();
  await dialog.getByRole("button", { name: "恢复", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Prompt 状态", exact: true }).click();
  await page.getByRole("option", { name: "未归档", exact: true }).click();
  await dialog.getByRole("region", { name: "生成内容管理" }).getByRole("button", { name: "使用此 prompt", exact: true }).click();
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
  await page.getByRole("tab", { name: "插图", exact: true }).click();
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

test("prompt and image generation share the AI task manager, cancellation, retry and saved results", async ({ page }) => {
  const { control } = await mockIllustrations(page);
  let finishPrompt!: () => void;
  control.holdPrompt = new Promise(resolve => { finishPrompt = resolve; });
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("tab", { name: "插图", exact: true }).click();
  const dialog = page.getByRole("region", { name: "插图工作区" });
  await expect(dialog.getByRole("tab", { name: "后台任务", exact: true })).toHaveCount(0);
  await dialog.getByRole("combobox", { name: "提示词模型", exact: true }).click();
  await page.getByRole("option", { name: /文本测试模型/ }).click();
  await dialog.getByRole("button", { name: "选景并生成图片 prompt" }).click();
  await dialog.getByRole("button", { name: "查看 AI 任务", exact: true }).click();
  const taskArea = page.getByRole("region", { name: "AI 任务工作区", exact: true });
  await expect(taskArea.getByText("生成目标", { exact: true })).toBeVisible();
  await expect(taskArea.getByText("插图 Prompt", { exact: true })).toBeVisible();
  await taskArea.getByRole("button", { name: "取消", exact: true }).click();
  await expect(taskArea.getByText("已取消", { exact: true }).first()).toBeVisible();
  finishPrompt(); control.holdPrompt = null;
  await taskArea.getByRole("button", { name: "重新执行", exact: true }).click();
  await expect(taskArea.getByLabel("任务结果", { exact: true })).toContainText("码头上两人相望");
  await taskArea.getByRole("button", { name: "查看生成历史", exact: true }).click();
  await expect(dialog.getByRole("tab", { name: "Prompt 历史", exact: true })).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("region", { name: "生成内容管理" }).getByRole("button", { name: "使用此 prompt", exact: true }).click();
  await dialog.getByRole("combobox", { name: "文生图模型", exact: true }).click();
  await page.getByRole("option", { name: /图片测试模型/ }).click();
  await dialog.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(dialog.getByAltText("根据正文片段生成的插图")).toBeVisible();
  await dialog.getByRole("button", { name: "查看 AI 任务", exact: true }).click();
  await taskArea.getByRole("button", { name: "返回任务列表", exact: true }).click();
  const cards = taskArea.locator(".task-card");
  const imageTask = cards.filter({ has: page.locator("p").filter({ hasText: /目标：插图$/ }) });
  await imageTask.getByRole("button", { name: "打开", exact: true }).click();
  await expect(taskArea.getByAltText("AI 任务生成的插图")).toBeVisible();
  await expect(taskArea.getByRole("link", { name: "下载图片", exact: true })).toHaveAttribute("href", /\/image\?download=1$/);
  await expect(taskArea.getByRole("button", { name: "应用结果", exact: true })).toHaveCount(0);
});
