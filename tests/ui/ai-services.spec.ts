import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

const textMetadata = { source: "provider", inputModalities: ["text"], outputModalities: ["text"] };
const imageMetadata = { source: "provider", inputModalities: ["text", "image"], outputModalities: ["image"] };
test.beforeEach(async ({ request, page }) => {
  await page.route("**/api/connectivity", route => route.fulfill({ status: 204 }));
  const state = await (await request.get("/api/state")).json();
  await request.put("/api/state", { headers: { "If-Match": String(state.revision) }, data: { data: fullStudioFixture() } });
});

test("Civitai official search waits for the button and pages only the submitted keyword", async ({ page }, info) => {
  test.setTimeout(60000);
  const requests: Array<{ hint?: string; cursor?: string | null }> = [];
  await page.route("**/api/providers", route => route.fulfill({ json: { providers: [{ id: "civitai", name: "Civitai", baseUrl: "https://civitai.com/api/v1", adapterKind: "civitai", hasSecret: true, timeoutMs: 120000 }] } }));
  await page.route("**/api/models", route => route.fulfill({ json: { models: [] } }));
  await page.route("**/api/providers/civitai/discover", route => route.fulfill({ json: { catalog: [{ id: "popular", name: "Popular model", metadata: imageMetadata }], warnings: [] } }));
  await page.route("**/api/providers/civitai/catalog-pages", route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    expect(body.hint).toBe("Painter");
    return route.fulfill({ json: { catalog: [{ id: body.cursor ? "painter-old" : "recommended", name: body.cursor ? "Painter Old" : "Official recommended match", metadata: imageMetadata }], nextCursor: body.cursor ? null : "next", scanned: 1, warnings: [] } });
  });
  await page.goto("/settings/models");
  await page.locator(".ai-service-intro").getByRole("button", { name: "添加模型", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加模型", exact: true });
  const search = dialog.getByRole("textbox", { name: "搜索目录模型", exact: true });
  await expect(dialog.getByRole("combobox", { name: "搜索范围", exact: true })).toHaveValue("Civitai 官方搜索（较快）");
  await search.fill("P");
  await page.waitForTimeout(500);
  await search.fill("Painter");
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
  await expect(dialog.getByRole("checkbox", { name: "选择模型 popular", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "搜索完成" })).toContainText("2 个匹配版本");
  expect(requests).toEqual([{ cursor: null, hint: "Painter" }, { cursor: "next", hint: "Painter" }]);
  await expect(dialog.getByRole("checkbox", { name: "选择模型 recommended", exact: true })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "选择模型 painter-old", exact: true }).check();
  await search.fill("Painter*");
  await page.waitForTimeout(500);
  expect(requests).toHaveLength(2);
  await expect(dialog.getByRole("checkbox", { name: "选择模型 recommended", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "搜索完成" })).toContainText("1 个匹配版本");
  expect(requests).toHaveLength(4);
  await expect(dialog.getByRole("checkbox", { name: "选择模型 painter-old", exact: true })).toBeChecked();
  await page.screenshot({ path: info.outputPath("civitai-search-button.png"), fullPage: true });
  await search.fill("*");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("请选择全目录匹配");
  expect(requests).toHaveLength(4);
});

test("Civitai AIR lookup bypasses a completed scan and retains the canonical model when search is cleared", async ({ page }) => {
  test.setTimeout(60000);
  const id = "urn:air:sdxl:checkpoint:civitai:101055@128078";
  let scans = 0;
  const lookups: string[] = [];
  let enabled: Record<string, unknown> | undefined;
  await page.route("**/api/providers", route => route.fulfill({ json: { providers: [{ id: "civitai", name: "Civitai", baseUrl: "https://civitai.com/api/v1", adapterKind: "civitai", hasSecret: true, timeoutMs: 120000 }] } }));
  await page.route("**/api/models", route => route.fulfill({ json: { models: [] } }));
  await page.route("**/api/providers/civitai/discover", route => route.fulfill({ json: { catalog: [], warnings: [] } }));
  await page.route("**/api/providers/civitai/catalog-pages", route => {
    const body = route.request().postDataJSON();
    if (body.air) {
      lookups.push(body.air);
      if (body.air.endsWith("@999")) return route.fulfill({ status: 400, json: { error: "未找到此 AIR 对应的模型或版本" } });
      return route.fulfill({ json: { catalog: [{ id, name: "Exact AIR Painter", metadata: imageMetadata }], nextCursor: null, scanned: 1, warnings: [] } });
    }
    scans++;
    return route.fulfill({ json: { catalog: [], nextCursor: null, scanned: 0, warnings: [] } });
  });
  await page.route("**/api/models/bulk", route => { enabled = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { models: [{ id: "exact-model" }] } }); });
  await page.goto("/settings/models");
  await page.locator(".ai-service-intro").getByRole("button", { name: "添加模型", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加模型", exact: true });
  const search = dialog.getByRole("textbox", { name: "搜索目录模型", exact: true });
  await dialog.getByRole("combobox", { name: "搜索范围", exact: true }).click();
  await page.getByRole("option", { name: "全目录匹配（较慢）", exact: true }).click();
  await search.fill("*");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "搜索完成" })).toBeVisible();
  expect(scans).toBe(1);
  await search.fill(id.toUpperCase());
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "AIR 查询完成" })).toContainText("1 个匹配版本");
  await dialog.getByRole("checkbox", { name: `选择模型 ${id}`, exact: true }).check();
  await search.fill("civitai:101055@999");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("未找到此 AIR");
  await expect(dialog.getByRole("status").filter({ hasText: "AIR 查询完成" })).toHaveCount(0);
  expect(scans).toBe(1);
  expect(lookups).toEqual([id.toUpperCase(), "civitai:101055@999"]);
  await search.fill("");
  await expect(dialog.getByRole("checkbox", { name: `选择模型 ${id}`, exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "启用 1 个模型", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(enabled?.modelIds).toEqual([id]);
  expect(enabled?.metadataByModelId).toEqual({ [id]: imageMetadata });
});

test("Civitai AIR batches merge mixed separators and preserve matches when one lookup fails", async ({ page }, info) => {
  test.setTimeout(60000);
  const ids = Array.from({ length: 5 }, (_, index) => `urn:air:sdxl:checkpoint:civitai:${101055 + index}@${128078 + index}`);
  const missing = "civitai:999@999";
  const lookups: string[] = [];
  let enabled: Record<string, unknown> | undefined;
  await page.route("**/api/providers", route => route.fulfill({ json: { providers: [{ id: "civitai", name: "Civitai", baseUrl: "https://civitai.com/api/v1", adapterKind: "civitai", hasSecret: true, timeoutMs: 120000 }] } }));
  await page.route("**/api/models", route => route.fulfill({ json: { models: [] } }));
  await page.route("**/api/providers/civitai/discover", route => route.fulfill({ json: { catalog: [], warnings: [] } }));
  await page.route("**/api/providers/civitai/catalog-pages", route => {
    const { air } = route.request().postDataJSON();
    expect(typeof air).toBe("string");
    lookups.push(air);
    if (air === missing) return route.fulfill({ status: 400, json: { error: "未找到此 AIR 对应的模型或版本" } });
    return route.fulfill({ json: { catalog: [{ id: air, name: `Batch Painter ${ids.indexOf(air) + 1}`, metadata: imageMetadata }], nextCursor: null, scanned: 1, warnings: [] } });
  });
  await page.route("**/api/models/bulk", route => { enabled = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { models: [{ id: "batch-model" }] } }); });
  await page.goto("/settings/models");
  await page.locator(".ai-service-intro").getByRole("button", { name: "添加模型", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加模型", exact: true });
  const search = dialog.getByRole("textbox", { name: "搜索目录模型", exact: true });
  const input = `${ids[0]}, ${ids[1]};${missing} ${ids[2]}，${ids[3]}；${ids[4]}\n${ids[0].toUpperCase()}`;
  expect(input.length).toBeGreaterThan(200);
  await search.fill(input);
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search).toHaveValue(input);
  await expect(dialog.getByRole("status").filter({ hasText: "AIR 查询结束" })).toContainText("已查询 6/6 项，找到 5 个匹配版本，失败 1 项");
  await expect(dialog.getByRole("alert")).toContainText(missing);
  await expect(dialog.getByRole("alert")).toContainText("成功的结果已保留");
  expect(lookups).toHaveLength(6);
  expect(new Set(lookups)).toEqual(new Set([...ids, missing]));
  for (const id of ids) await expect(dialog.getByRole("checkbox", { name: `选择模型 ${id}`, exact: true })).toBeVisible();
  for (const id of ids.slice(0, 2)) await dialog.getByRole("checkbox", { name: `选择模型 ${id}`, exact: true }).check();
  await page.screenshot({ path: info.outputPath("civitai-multiple-air.png"), fullPage: true });
  await search.fill("");
  for (const id of ids.slice(0, 2)) await expect(dialog.getByRole("checkbox", { name: `选择模型 ${id}`, exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "启用 2 个模型", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(enabled?.modelIds).toEqual(ids.slice(0, 2));
  expect(enabled?.metadataByModelId).toEqual(Object.fromEntries(ids.slice(0, 2).map(id => [id, imageMetadata])));
});

test("Civitai wildcard search traverses every page and retains late-page selections across queries", async ({ page }, info) => {
  test.setTimeout(60_000);
  let requests = 0;
  let enabled: Record<string, unknown> | undefined;
  const provider = { id: "civitai", name: "Civitai", baseUrl: "https://civitai.com/api/v1", adapterKind: "civitai", hasSecret: true, timeoutMs: 120000 };
  const lateId = "urn:air:sdxl:checkpoint:civitai:719@7019";
  await page.route("**/api/providers", route => route.fulfill({ json: { providers: [provider] } }));
  await page.route("**/api/models", route => route.fulfill({ json: { models: [] } }));
  await page.route("**/api/providers/civitai/discover", route => route.fulfill({ json: { catalog: [{ id: "popular", name: "Popular model", metadata: imageMetadata }], syncedAt: new Date().toISOString(), warnings: [] } }));
  await page.route("**/api/providers/civitai/catalog-pages", route => {
    if (route.request().postDataJSON().hint) return route.fulfill({ json: { catalog: [], nextCursor: null, scanned: 0, warnings: [] } });
    requests++;
    const cursor = route.request().postDataJSON().cursor;
    const index = cursor == null ? 0 : Number(cursor);
    const catalog = Array.from({ length: 20 }, (_, item) => ({ id: `urn:air:sdxl:checkpoint:civitai:${(index + 1) * 100 + item}@${(index + 1) * 1000 + item}`, name: `WAI-${index}-${item} · v1`, searchTerms: [`WAI-${index}-${item}`], metadata: imageMetadata }));
    return route.fulfill({ json: { catalog, nextCursor: index < 6 ? String(index + 1) : null, scanned: 20, syncedAt: new Date().toISOString(), warnings: [] } });
  });
  await page.route("**/api/models/bulk", route => { enabled = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { models: [{ id: "late-model" }] } }); });
  await page.goto("/settings/models");
  await page.locator(".ai-service-intro").getByRole("button", { name: "添加模型", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加模型", exact: true });
  const search = dialog.getByRole("textbox", { name: "搜索目录模型", exact: true });
  await dialog.getByRole("combobox", { name: "搜索范围", exact: true }).click();
  await page.getByRole("option", { name: "全目录匹配（较慢）", exact: true }).click();
  await search.fill("*wai*");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "搜索完成" })).toContainText("140 个匹配版本");
  await expect(dialog.getByRole("checkbox", { name: /^选择模型 / })).toHaveCount(140);
  await dialog.getByRole("checkbox", { name: `选择模型 ${lateId}`, exact: true }).check();
  expect(requests).toBe(7);
  await search.fill("WAI-6-?");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: /^选择模型 / })).toHaveCount(10);
  await expect(dialog.getByRole("status").filter({ hasText: "搜索完成" })).toContainText("10 个匹配版本");
  expect(requests).toBe(7);
  await search.fill("urn:*@7019");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: /^选择模型 / })).toHaveCount(1);
  await expect(dialog.getByRole("checkbox", { name: `选择模型 ${lateId}`, exact: true })).toBeChecked();
  await page.screenshot({ path: info.outputPath("civitai-wildcard-search.png"), fullPage: true });
  await search.fill("");
  await expect(dialog.getByRole("checkbox", { name: `选择模型 ${lateId}`, exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "启用 1 个模型", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(enabled?.modelIds).toEqual([lateId]);
  expect(enabled?.metadataByModelId).toEqual({ [lateId]: imageMetadata });
});

test("Civitai search keeps partial results on failure and resumes from the failed page", async ({ page }) => {
  const cursors: Array<string | null> = [];
  let fail = true;
  await page.route("**/api/providers", route => route.fulfill({ json: { providers: [{ id: "civitai", name: "Civitai", baseUrl: "https://civitai.com/api/v1", adapterKind: "civitai", hasSecret: true, timeoutMs: 120000 }] } }));
  await page.route("**/api/models", route => route.fulfill({ json: { models: [] } }));
  await page.route("**/api/providers/civitai/discover", route => route.fulfill({ json: { catalog: [], warnings: [], syncedAt: new Date().toISOString() } }));
  await page.route("**/api/providers/civitai/catalog-pages", route => {
    if (route.request().postDataJSON().hint) return route.fulfill({ json: { catalog: [], nextCursor: null, scanned: 0, warnings: [] } });
    const cursor = route.request().postDataJSON().cursor;
    cursors.push(cursor);
    if (cursor === "next" && fail) { fail = false; return route.fulfill({ status: 503, json: { error: "Civitai 暂时限流" } }); }
    return route.fulfill({ json: { catalog: [{ id: cursor ? "painter-old" : "painter-new", name: cursor ? "Painter Old" : "Painter New", metadata: imageMetadata }], nextCursor: cursor ? null : "next", scanned: 1, warnings: [], syncedAt: new Date().toISOString() } });
  });
  await page.goto("/settings/models");
  await page.locator(".ai-service-intro").getByRole("button", { name: "添加模型", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加模型", exact: true });
  await dialog.getByRole("combobox", { name: "搜索范围", exact: true }).click();
  await page.getByRole("option", { name: "全目录匹配（较慢）", exact: true }).click();
  await dialog.getByRole("textbox", { name: "搜索目录模型", exact: true }).fill("Painter*");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("搜索尚未完成");
  await expect(dialog.getByRole("status").filter({ hasText: "搜索完成" })).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "选择模型 painter-new", exact: true }).check();
  await dialog.getByRole("button", { name: "继续搜索", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "搜索完成" })).toContainText("2 个匹配版本");
  await expect(dialog.getByRole("checkbox", { name: "选择模型 painter-new", exact: true })).toBeChecked();
  expect(cursors).toEqual([null, "next", "next"]);
});

test("Civitai connections automatically select the image adapter and enable native catalog models", async ({ page }, info) => {
  let provider: Record<string, unknown> | undefined;
  let enabled: Record<string, unknown> | undefined;
  const id = "urn:air:sdxl:checkpoint:civitai:101055@128078";
  await page.route("**/api/providers", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { providers: provider ? [provider] : [] } });
    const input = route.request().postDataJSON();
    expect(input.adapterKind).toBe("civitai");
    provider = { ...input, id: "civitai", hasSecret: true, modelCount: 0 };
    await route.fulfill({ status: 201, json: provider });
  });
  await page.route("**/api/models", route => route.fulfill({ json: { models: [] } }));
  await page.route("**/api/providers/civitai/discover", route => route.fulfill({ json: route.request().method() === "GET" ? null : { catalog: [{ id, name: "Civitai Painter", metadata: imageMetadata }], warnings: ["当前分批展示部分热门模型"], syncedAt: new Date().toISOString() } }));
  await page.route("**/api/models/bulk", route => { enabled = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { models: [{ id: "painter" }] } }); });
  await page.goto("/settings/models");
  await page.getByRole("button", { name: "服务连接", exact: false }).click();
  await page.getByRole("button", { name: "添加服务连接", exact: true }).click();
  const connection = page.getByRole("dialog", { name: "添加服务连接", exact: true });
  await connection.getByRole("textbox", { name: "连接名称", exact: true }).fill("Civitai");
  await connection.getByRole("textbox", { name: "接口地址", exact: true }).fill("https://civitai.com/api/v1");
  await expect(connection.getByRole("alert")).toContainText("生成插图");
  await connection.locator('input[autocomplete="new-password"]').fill("fake-civitai-key");
  await connection.getByText("高级设置", { exact: true }).click();
  await expect(connection.getByRole("combobox", { name: "接口适配", exact: true })).toHaveValue("Civitai（图像生成）");
  await connection.getByRole("button", { name: "保存连接", exact: true }).click();
  const catalog = page.getByRole("dialog", { name: "添加模型", exact: true });
  await expect(catalog.getByRole("alert")).toContainText("分批展示");
  await catalog.getByRole("checkbox", { name: `选择模型 ${id}`, exact: true }).check();
  await page.screenshot({ path: info.outputPath("civitai-catalog.png"), fullPage: true });
  await catalog.getByRole("button", { name: "启用 1 个模型", exact: true }).click();
  await expect(catalog).toBeHidden();
  expect(enabled?.modelIds).toEqual([id]);
  expect(enabled?.metadataByModelId).toEqual({ [id]: imageMetadata });
});

test("capability filters keep image models out of writing defaults and persist image assignment", async ({ page, request }, info) => {
  const models = [
    { id: "writer", providerId: "p", providerName: "创作服务", name: "Writer", modelId: "writer-pro", hasSecret: true, metadata: textMetadata },
    { id: "image", providerId: "p", providerName: "创作服务", name: "Painter", modelId: "painter-pro", hasSecret: true, metadata: imageMetadata },
  ];
  await page.route("**/api/providers", route => route.fulfill({ json: { providers: [{ id: "p", name: "创作服务", baseUrl: "https://example.com/v1", adapterKind: "openai-compatible", hasSecret: true, timeoutMs: 120000 }] } }));
  await page.route("**/api/models", route => route.fulfill({ json: { models } }));
  await page.route("**/api/providers/p/discover", route => route.fulfill({ json: null }));
  await page.goto("/settings/models");
  if (info.project.name === "desktop-chromium") {
    for (const label of ["章节与大纲", "全文编辑", "文章资料"]) await expect(page.locator(".sidebar .quick-links").getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await page.getByRole("combobox", { name: "正文生成", exact: true }).click();
  await expect(page.getByRole("option", { name: "创作服务-Painter", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "创作服务-Writer", exact: true }).click();
  await page.getByRole("combobox", { name: "插图生成", exact: true }).click();
  await expect(page.getByRole("option", { name: "创作服务-Writer", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "创作服务-Painter", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.illustrationImageModel).toBe("image");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "插图生成", exact: true })).toHaveValue("创作服务-Painter");
  await expect(page.getByRole("combobox", { name: "正文生成", exact: true })).toHaveValue("创作服务-Writer");
  await page.getByRole("group", { name: "模型筛选", exact: true }).getByRole("button", { name: "图像", exact: true }).click();
  await expect(page.locator('[data-provider-model-id="writer"]')).toHaveCount(0);
  await expect(page.locator('[data-provider-model-id="image"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: info.outputPath("ai-services.png"), fullPage: true });
});

test("catalog adds only selected new models and retains choices after refresh failure", async ({ page }) => {
  let refreshes = 0; let submitted: Record<string, unknown> | undefined;
  const models = [{ id: "writer", providerId: "p", providerName: "服务", name: "Writer", modelId: "writer-pro", hasSecret: true, metadata: textMetadata }];
  const catalog = [{ id: "writer-pro", name: "Writer", metadata: textMetadata }, { id: "painter-pro", name: "Painter", metadata: imageMetadata }];
  await page.route("**/api/providers", route => route.fulfill({ json: { providers: [{ id: "p", name: "服务", baseUrl: "https://example.com/v1", adapterKind: "openai-compatible", hasSecret: true, timeoutMs: 120000 }] } }));
  await page.route("**/api/models", route => route.fulfill({ json: { models } }));
  await page.route("**/api/providers/p/discover", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: null });
    refreshes++;
    return refreshes === 1 ? route.fulfill({ json: { catalog, syncedAt: "2026-10-15T01:00:00Z", warnings: [] } }) : route.fulfill({ status: 503, json: { error: "目录暂时无法访问" } });
  });
  await page.route("**/api/models/bulk", route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { models: [{ id: "new-image" }] } });
  });
  await page.goto("/settings/models");
  await page.locator(".ai-service-intro").getByRole("button", { name: "添加模型", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加模型", exact: true });
  const painter = dialog.getByRole("checkbox", { name: "选择模型 painter-pro", exact: true });
  await expect(painter).not.toBeChecked(); await painter.check();
  await dialog.getByRole("group", { name: "目录筛选", exact: true }).getByRole("button", { name: "全部", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "选择模型 writer-pro", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "刷新目录", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("目录暂时无法访问"); await expect(painter).toBeChecked();
  await dialog.getByRole("button", { name: "启用 1 个模型", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(submitted?.modelIds).toEqual(["painter-pro"]);
  expect(submitted?.metadataByModelId).toEqual({ "painter-pro": imageMetadata });
});

test("bulk text checks never test or delete image models", async ({ page }) => {
  const calls: string[] = [];
  const models = [{ id: "writer", providerId: "p", providerName: "服务", name: "Writer", modelId: "writer", hasSecret: true, metadata: textMetadata }, { id: "image", providerId: "p", providerName: "服务", name: "Painter", modelId: "image", hasSecret: true, metadata: imageMetadata }];
  await page.route("**/api/providers", route => route.fulfill({ json: { providers: [{ id: "p", name: "服务", baseUrl: "https://example.com/v1", hasSecret: true, timeoutMs: 120000 }] } }));
  await page.route("**/api/models", route => route.fulfill({ json: { models } }));
  await page.route("**/api/providers/p/discover", route => route.fulfill({ json: null }));
  await page.route("**/api/models/*/test", route => { calls.push(route.request().url()); return route.fulfill({ status: 502, json: { ok: false, message: "限流，请稍后重试" } }); });
  page.on("dialog", () => { throw new Error("Testing must not prompt for model deletion"); });
  await page.goto("/settings/models");
  await page.getByRole("button", { name: "检测文字模型", exact: true }).click();
  await expect(page.locator(".ai-services").getByRole("status")).toContainText("0 个通过，1 个未通过");
  expect(calls).toHaveLength(1); expect(calls[0]).toContain("/models/writer/test");
  await expect(page.locator('[data-provider-model-id="image"]')).toBeVisible();
});

test("model row deletion handles an empty response and resets its default assignment", async ({ page, request }) => {
  let models = [{ id: "writer", providerId: "p", providerName: "服务", name: "Writer", modelId: "writer", hasSecret: true, metadata: textMetadata }];
  let deleted = 0;
  const state = await (await request.get("/api/state")).json();
  state.data.settings.generateModel = "writer";
  await request.put("/api/state", { headers: { "If-Match": String(state.revision) }, data: { data: state.data } });
  await page.route("**/api/providers", route => route.fulfill({ json: { providers: [{ id: "p", name: "服务", baseUrl: "https://example.com/v1", hasSecret: true, timeoutMs: 120000 }] } }));
  await page.route("**/api/models", route => route.fulfill({ json: { models } }));
  await page.route("**/api/providers/p/discover", route => route.fulfill({ json: null }));
  await page.route("**/api/models/writer", route => { deleted++; models = []; return route.fulfill({ status: 204 }); });
  await page.goto("/settings/models");
  const row = page.locator('[data-provider-model-id="writer"]');
  await row.getByRole("button", { name: "删除", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "删除模型", exact: true });
  await expect(confirm).toContainText("所选模型正在用于默认用途");
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  expect(deleted).toBe(0); await expect(row).toBeVisible();
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await confirm.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(confirm).toBeHidden(); await expect(row).toHaveCount(0);
  await expect(page.locator(".ai-services").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "正文生成", exact: true })).toHaveValue("本地演示引擎");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.generateModel).toBe("");
  expect(deleted).toBe(1);
});

test("provider management preserves selections, retries deletion and clears all its models despite search", async ({ page, request }, info) => {
  let models = [
    { id: "a1", providerId: "p", providerName: "服务 A", name: "Writer One", modelId: "writer-one", hasSecret: true, metadata: textMetadata },
    { id: "a2", providerId: "p", providerName: "服务 A", name: "Writer Two", modelId: "writer-two", hasSecret: true, metadata: textMetadata },
    { id: "a3", providerId: "p", providerName: "服务 A", name: "Painter", modelId: "painter", hasSecret: true, metadata: imageMetadata },
    { id: "b1", providerId: "q", providerName: "服务 B", name: "Other Writer", modelId: "other-writer", hasSecret: true, metadata: textMetadata },
  ];
  const calls: { providerId: string; ids: string[] }[] = [];
  const state = await (await request.get("/api/state")).json();
  Object.assign(state.data.settings, { generateModel: "a1", namingModel: "a2", namingModelMode: "fixed", reviewModel: "a2", reviewModelMode: "fixed", chatModel: "b1", illustrationImageModel: "a3" });
  await request.put("/api/state", { headers: { "If-Match": String(state.revision) }, data: { data: state.data } });
  await page.route("**/api/providers", route => route.fulfill({ json: { providers: [{ id: "p", name: "服务 A", baseUrl: "https://example.com/v1", hasSecret: true, timeoutMs: 120000 }, { id: "q", name: "服务 B", baseUrl: "https://other.example.com/v1", hasSecret: true, timeoutMs: 120000 }] } }));
  await page.route("**/api/models", route => route.fulfill({ json: { models } }));
  await page.route("**/api/providers/*/discover", route => route.fulfill({ json: null }));
  await page.route("**/api/models/bulk", route => {
    const body = route.request().postDataJSON() as { providerId: string; ids: string[] }; calls.push(body);
    if (calls.length === 1) return route.fulfill({ status: 503, json: { error: "暂时无法删除，请重试" } });
    const deletedIds = models.filter((model) => model.providerId === body.providerId && body.ids.includes(model.id)).map((model) => model.id);
    models = models.filter((model) => !deletedIds.includes(model.id));
    return route.fulfill({ json: { deletedIds } });
  });
  await page.goto("/settings/models");
  const provider = page.locator(".ai-model-group").filter({ has: page.getByRole("heading", { name: "服务 A", exact: true }) });
  await provider.getByRole("button", { name: "管理模型", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "管理模型 · 服务 A", exact: true });
  await manager.getByRole("checkbox", { name: "选择已启用模型 writer-one", exact: true }).check();
  await manager.getByRole("textbox", { name: "搜索要管理的模型" }).fill("writer-two");
  await manager.getByRole("checkbox", { name: "全选当前结果", exact: true }).check();
  await expect(manager).toContainText("已选择 2 / 3 个模型");
  await page.screenshot({ path: info.outputPath("provider-model-manager.png") });
  await manager.getByRole("button", { name: "删除所选（2）", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "批量删除模型", exact: true });
  await confirm.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(confirm.getByRole("alert").filter({ hasText: "暂时无法删除" })).toBeVisible();
  await confirm.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(confirm).toBeHidden();
  expect(calls[1]).toEqual({ providerId: "p", ids: ["a1", "a2"] });
  await expect.poll(async () => {
    const settings = (await (await request.get("/api/state")).json()).data.settings;
    return [settings.generateModel, settings.namingModel, settings.namingModelMode, settings.reviewModel, settings.reviewModelMode, settings.chatModel];
  }).toEqual(["", "", "inherit", "", "inherit", "b1"]);
  await manager.getByRole("textbox", { name: "搜索要管理的模型" }).fill("no-match");
  await manager.getByRole("button", { name: "清空全部模型", exact: true }).click();
  const clear = page.getByRole("dialog", { name: "清空模型", exact: true });
  await expect(clear).toContainText("此操作包含搜索条件之外的模型");
  await clear.getByRole("button", { name: "取消", exact: true }).click();
  expect(calls).toHaveLength(2);
  await manager.getByRole("button", { name: "清空全部模型", exact: true }).click();
  await clear.getByRole("button", { name: "确认清空", exact: true }).click();
  await expect(clear).toBeHidden();
  await expect(manager).toContainText("此 Provider 暂无已启用模型");
  await expect(manager.getByRole("button", { name: "清空全部模型", exact: true })).toBeDisabled();
  await manager.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator('[data-provider-model-id="b1"]')).toBeVisible();
  await expect(provider).toContainText("0 个模型");
  expect(calls[2]).toEqual({ providerId: "p", ids: ["a3"] });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: info.outputPath("provider-model-management.png"), fullPage: true });
});
