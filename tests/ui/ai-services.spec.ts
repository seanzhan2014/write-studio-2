import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

const textMetadata = { source: "provider", inputModalities: ["text"], outputModalities: ["text"] };
const imageMetadata = { source: "provider", inputModalities: ["text", "image"], outputModalities: ["image"] };
test.beforeEach(async ({ request }) => {
  const state = await (await request.get("/api/state")).json();
  await request.put("/api/state", { headers: { "If-Match": String(state.revision) }, data: { data: fullStudioFixture() } });
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
