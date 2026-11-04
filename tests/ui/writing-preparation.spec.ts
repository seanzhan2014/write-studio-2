import { expect, test, type Page, type Locator } from "@playwright/test";
import type { StudioData } from "../../app/studio-state";
import { fullStudioFixture } from "../fixtures.mjs";
import { preparationModelServer } from "../writing-preparation-model.mjs";
import { createWritingPreparation } from "../../lib/writing-preparation";

async function fitsViewport(page: Page, target: Locator) {
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test("real preparation, synchronized author draft, confirmation and prose work in the main app", async ({ page, request }, info) => {
  test.setTimeout(60_000);
  const fake = await preparationModelServer();
  try {
    const provider = await (await request.post("/api/providers", { data: { name: "UI preparation", baseUrl: fake.baseUrl, secret: "fake-key" } })).json();
    const model = await (await request.post("/api/models", { data: { providerId: provider.id, name: "UI preparation", modelId: "prep-ui", maxInputCharacters: 120000 } })).json();
    const current = await (await request.get("/api/state")).json();
    const data = fullStudioFixture() as unknown as StudioData;
    data.settings.generateModel = model.id;
    data.articles[0].aiGenerateSettings!.model = model.id;
    expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
    await page.goto("/settings/tasks");
    await page.getByRole("tab", { name: "写作准备与讨论", exact: true }).click();
    await expect(page.getByLabel("写作前最多互动轮次")).toHaveValue("3");
    await expect(page.getByRole("combobox", { name: "讨论策略", exact: true })).toHaveValue("最少条件型");
    await expect(page.getByLabel("准备稿无问题时仍需确认")).not.toBeChecked();
    await page.getByRole("combobox", { name: "讨论策略", exact: true }).click();
    await page.getByRole("option", { name: "最大探索型", exact: true }).click();
    await page.getByLabel("准备稿无问题时仍需确认").check();
    await page.getByLabel("写作前最多互动轮次").fill("1");
    await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.preparationMaxRounds).toBe(1);
    await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.preparationRequireConfirmation).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.goto("/articles/article-main/outlines/outline-current/generate");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    const inline = page.locator(".task-interaction.inline");
    await expect(inline).toContainText("最大探索型讨论");
    await expect(inline.getByText("人物在此处了解到哪一步？", { exact: false })).toBeVisible();
    expect(fake.control.calls.map((call: { kind: string }) => call.kind)).toEqual(["prepare"]);
    await expect(page.getByLabel("AI 任务需要作者处理").filter({ visible: true }).first()).toBeVisible();
    await inline.getByRole("radio", { name: /只发现异常/ }).check();
    await inline.getByLabel("作者回复", { exact: true }).fill("只保留怀疑，不揭示动机。");
    await inline.getByRole("button", { name: "打开完整任务 →" }).click();
    const full = page.locator(".task-interaction.full");
    await expect(full.getByLabel("作者回复", { exact: true })).toHaveValue("只保留怀疑，不揭示动机。");
    await expect(full.getByRole("radio", { name: /只发现异常/ })).toBeChecked();
    await fitsViewport(page, page.locator(".task-workspace"));
    await fitsViewport(page, full.locator(".writing-reply-composer"));
    const workspaceSize = await page.locator(".task-workspace").boundingBox();
    const mainSize = await page.locator(".main-area").boundingBox();
    expect(workspaceSize!.width).toBeCloseTo(mainSize!.width, 0);
    const peer = await page.context().newPage();
    await peer.goto("/articles/article-main/outlines/outline-current/generate");
    await expect(peer.getByLabel("作者回复", { exact: true })).toHaveValue("只保留怀疑，不揭示动机。");
    await full.getByLabel("作者回复", { exact: true }).fill("只保留怀疑，不揭示动机。结尾留下线索。");
    await expect.poll(async () => (await (await request.get("/api/ai/tasks")).json()).tasks[0]?.contextOptions.writingPreparation.draft.note).toContain("结尾留下线索");
    await expect(peer.getByLabel("作者回复", { exact: true })).toHaveValue("只保留怀疑，不揭示动机。结尾留下线索。");
    await peer.close();
    await page.getByRole("button", { name: "关闭 AI 任务", exact: true }).click();
    await expect(inline.getByLabel("作者回复", { exact: true })).toHaveValue("只保留怀疑，不揭示动机。结尾留下线索。");
    await page.reload();
    await expect(inline.getByLabel("作者回复", { exact: true })).toHaveValue("只保留怀疑，不揭示动机。结尾留下线索。");
    await inline.getByRole("button", { name: "提交回答，完善准备稿", exact: true }).click();
    await expect(inline.getByRole("button", { name: "确认准备稿并写正文", exact: true })).toBeVisible();
    expect(fake.control.calls.map((call: { kind: string }) => call.kind)).toEqual(["prepare", "prepare"]);
    await inline.getByRole("button", { name: "检查 / 编辑准备稿", exact: true }).click();
    const brief = inline.getByLabel("修改写作准备稿", { exact: true });
    await brief.fill(await brief.inputValue() + "\n作者确定：结尾不要解释档案被修改的原因。");
    await inline.getByRole("button", { name: "保存准备稿", exact: true }).click();
    await inline.getByRole("tab", { name: "讨论", exact: true }).click();
    await inline.getByRole("button", { name: "打开完整任务 →" }).click();
    await full.getByRole("tab", { name: "准备稿", exact: true }).click();
    await expect(full).toContainText("结尾不要解释档案被修改的原因");
    await full.getByRole("tab", { name: "讨论", exact: true }).click();
    await page.screenshot({ path: info.outputPath("preparation-confirmation.png") });
    await full.getByRole("button", { name: "确认准备稿并写正文", exact: true }).click();
    await expect.poll(async () => (await (await request.get("/api/ai/tasks")).json()).tasks[0]?.state, { timeout: 20000 }).toBe("success");
    await expect(full).toContainText("正文已完成");
    await expect(full.getByRole("tab", { name: "生成结果", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(full.getByLabel("任务结果", { exact: true })).toContainText("作者确认后的正文");
    await full.getByRole("tab", { name: "运行历史", exact: true }).click();
    await expect(full).toContainText("生成目标");
    await page.getByRole("button", { name: "打开生成版本", exact: true }).click();
    await expect(page.locator(".content-reader")).toContainText("作者确认后的正文");
    await expect(page.getByLabel("AI 任务已完成").filter({ visible: true }).first().locator(".state-dot")).toHaveCSS("background-color", "rgb(88, 137, 202)");
    expect(fake.control.calls.map((call: { kind: string }) => call.kind)).toEqual(["prepare", "prepare", "write"]);
    expect(fake.control.calls.at(-1)!.body.messages.at(-1)!.content).toContain("结尾不要解释档案被修改的原因");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  } finally { await fake.close(); }
});

test("default preparation automatically writes without spending discussion rounds or asking for final confirmation", async ({ page, request }) => {
  const fake = await preparationModelServer();
  fake.control.ask = false;
  try {
    const provider = await (await request.post("/api/providers", { data: { name: "UI automatic preparation", baseUrl: fake.baseUrl, secret: "fake-key" } })).json();
    const model = await (await request.post("/api/models", { data: { providerId: provider.id, name: "UI automatic preparation", modelId: "prep-auto-ui", maxInputCharacters: 120000 } })).json();
    const current = await (await request.get("/api/state")).json();
    const data = fullStudioFixture() as unknown as StudioData;
    data.settings.generateModel = model.id;
    data.articles[0].aiGenerateSettings!.model = model.id;
    expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
    await page.goto("/articles/article-main/outlines/outline-current/generate");
    await expect(page.locator(".generate-auto-apply-note")).toContainText("无待答问题后自动写正文");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    const inline = page.locator(".task-interaction.inline");
    await expect(inline).toContainText("正文已完成", { timeout: 25_000 });
    await expect(inline.getByRole("tab", { name: "生成结果", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(inline.getByLabel("任务结果", { exact: true })).toContainText("作者确认后的正文");
    await expect(inline).toContainText("最少条件型讨论");
    await expect(page.getByRole("button", { name: "确认准备稿并写正文", exact: true })).toHaveCount(0);
    expect(fake.control.calls.map((call: { kind: string }) => call.kind)).toEqual(["prepare", "write"]);
    const task = (await (await request.get("/api/ai/tasks")).json()).tasks[0];
    expect(task.contextOptions.writingPreparation.round).toBe(0);
    expect(task.contextOptions.writingPreparation.autoApprovedAt).toBeTruthy();
    await inline.getByRole("button", { name: "打开完整任务 →" }).click();
    await expect(page.locator(".task-interaction.full")).toContainText("正文已完成");
    await expect(page.locator(".task-interaction.full").getByLabel("任务结果", { exact: true })).toContainText("作者确认后的正文");
    await fitsViewport(page, page.locator(".task-workspace"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  } finally { await fake.close(); }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }, { width: 390, height: 480 }]) {
  test(`full preparation keeps questions and reply accessible at ${viewport.width}x${viewport.height}`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "mobile-chromium", "mobile workspace geometry");
    await page.setViewportSize(viewport);
    if (viewport.height === 844) await page.addInitScript(() => {
      class TestViewport extends EventTarget { width = 390; height = 844; offsetTop = 0; offsetLeft = 0; scale = 1; }
      const visual = new TestViewport();
      Object.defineProperty(window, "visualViewport", { configurable: true, value: visual });
      (window as unknown as Window & { resizeTaskViewport: (height: number) => void }).resizeTaskViewport = (height) => { visual.height = height; visual.dispatchEvent(new Event("resize")); };
    });
    const current = await (await request.get("/api/state")).json();
    const data = fullStudioFixture() as unknown as StudioData;
    const preparation = createWritingPreparation(3);
    preparation.revision = 1; preparation.stage = "awaiting_author";
    preparation.brief = "已知事实与人物认知明确；未知动机等待作者决定。".repeat(100);
    preparation.questions = Array.from({ length: 3 }, (_, index) => ({ id: `q${index}`, title: `第 ${index + 1} 项未知信息如何处理？`, reason: "需要决定人物所知边界。".repeat(12), options: [{ id: "first", label: "保留悬念", description: "继续核实，不先揭示原因。" }, { id: "second", label: "给出证据", description: "说明已确认的事实。" }] }));
    data.tasks = [{ id: "prep-mobile", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "正文", prompt: "把未知项留给作者决定。", model: "", executionOrigin: "local", state: "waiting", phase: "awaiting_author", createdAt: "2026-09-07T00:00:00.000Z", contextOptions: { includePrevious: true, includeCharacters: true, estimatedCharacters: 0, writingPreparation: preparation } }];
    expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
    await page.goto("/articles/article-main/outlines/outline-current/write");
    await page.getByLabel("AI 任务需要作者处理").filter({ visible: true }).first().click();
    const full = page.locator(".task-interaction.full");
    await expect(full).toBeVisible();
    await fitsViewport(page, page.locator(".task-workspace"));
    await fitsViewport(page, full.locator(".writing-reply-composer"));
    const scroll = full.locator(".task-interaction-scroll");
    const option = full.getByRole("radio", { name: /给出证据/ }).last();
    await option.scrollIntoViewIfNeeded();
    await option.check();
    expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(20);
    await full.getByLabel("作者回复", { exact: true }).fill("手机输入也保留草稿。");
    await fitsViewport(page, full.getByLabel("作者回复", { exact: true }));
    if (viewport.height === 844) {
      await page.evaluate(() => (window as unknown as Window & { resizeTaskViewport: (height: number) => void }).resizeTaskViewport(430));
      await expect.poll(async () => (await full.getByLabel("作者回复", { exact: true }).boundingBox())!.y + (await full.getByLabel("作者回复", { exact: true }).boundingBox())!.height).toBeLessThan(400);
      await expect.poll(() => scroll.evaluate((element) => element.clientHeight)).toBeGreaterThan(80);
      await page.screenshot({ path: info.outputPath("mobile-keyboard.png") });
      await page.evaluate(() => (window as unknown as Window & { resizeTaskViewport: (height: number) => void }).resizeTaskViewport(844));
    }
    await page.screenshot({ path: info.outputPath("mobile-preparation.png") });
    await page.getByRole("button", { name: "关闭 AI 任务", exact: true }).click();
    await expect(page.locator(".task-workspace")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  });
}
