import { expect, test, type Locator, type Page } from "@playwright/test";
import type { StudioData } from "../../app/studio-state";
import { fullStudioFixture } from "../fixtures.mjs";
import { reviewModelServer } from "../review-model.mjs";

async function swipeReviewUp(page: Page, surface: Locator) {
  const bounds = await surface.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize()!;
  const top = Math.max(0, bounds!.y);
  const bottom = Math.min(viewport.height, bounds!.y + bounds!.height);
  const x = bounds!.x + bounds!.width / 2;
  const startY = bottom - 28;
  const endY = top + 28;
  const session = await page.context().newCDPSession(page);
  const point = (y: number) => ({ x, y, radiusX: 2, radiusY: 2, force: .7, id: 21 });
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(startY)] });
    for (let step = 1; step <= 8; step += 1) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(startY + (endY - startY) * step / 8)] });
    }
    // Hold the final touch briefly so a fling does not consume the next tap.
    await page.waitForTimeout(150);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function swipeUntilVisible(page: Page, surface: Locator, target: Locator) {
  for (let swipe = 0; swipe < 45; swipe += 1) {
    const visible = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + Math.min(rect.width / 2, 80);
      const y = rect.top + rect.height / 2;
      return y > 0 && y < innerHeight && element.contains(document.elementFromPoint(x, y));
    });
    if (visible) return;
    await swipeReviewUp(page, surface);
  }
  await expect(target).toBeInViewport();
}

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }, { width: 390, height: 480 }]) {
  test(`mobile long review report scrolls to the end in writing and task views at ${viewport.width}x${viewport.height}`, async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "native mobile touch scrolling");
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const current = await (await request.get("/api/state")).json();
    const data = fullStudioFixture() as unknown as StudioData;
    const outline = data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
    const report = {
      maxRounds: 3, completedRounds: 3, stopReason: "limit" as const, rules: "报告末尾的历史审校规则", instruction: "检查全部时间线", history: [],
      issues: Array.from({ length: 12 }, (_, index) => ({
        id: `P${index + 1}`, status: "open" as const, rule: "时间线一致",
        description: `第 ${index + 1} 处事件的时间有冲突`, evidence: "第二天清晨，林澈已经来到码头。",
        reason: "另一处写为当天傍晚，缺少可判断的依据，需要保留上下文并核对前后事件。",
        suggestion: index === 11 ? "最后一项审校建议已到达" : "请核对时间后统一修改。",
      })),
    };
    outline.versions = [{ ...outline.versions[0], reviewReport: report, content: "长报告下方的正文仍可阅读。" }];
    outline.currentVersionId = outline.versions[0].id;
    data.tasks = [{ id: "task-long-review", articleId: "article-main", chapterId: "chapter-main", outlineId: outline.id, target: "正文", prompt: "检查时间线", model: "", executionOrigin: "local", state: "success", phase: "completed", createdAt: "2026-09-07T00:00:00.000Z", resultVersionId: outline.currentVersionId, contextOptions: { includePrevious: true, includeCharacters: true, estimatedCharacters: 0, reviewReport: report } }];
    expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
    await page.goto("/articles/article-main/outlines/outline-current/write");
    const writing = page.locator(".writing-scroll");
    const review = page.locator(".generate-review-report");
    await review.locator(":scope > summary").tap();
    await swipeReviewUp(page, writing);
    await expect.poll(() => writing.evaluate((element) => element.scrollTop), { message: "Swiping the expanded report must scroll the writing page", timeout: 2000 }).toBeGreaterThan(20);
    await swipeUntilVisible(page, writing, review.getByText("建议：最后一项审校建议已到达", { exact: true }));
    const rules = review.getByText("使用的规则", { exact: true });
    await swipeUntilVisible(page, writing, rules);
    await rules.tap();
    await expect(rules.locator("..")).toHaveAttribute("open", "");
    await swipeUntilVisible(page, writing, review.getByText("文章通用规则：报告末尾的历史审校规则", { exact: true }));
    const reader = page.getByLabel("正文内容", { exact: true });
    await swipeUntilVisible(page, writing, reader);
    await reader.tap();
    await reader.tap();
    await expect(page.getByLabel("正文编辑器", { exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "退出编辑", exact: true }).tap();
    await expect(reader).toBeInViewport();

    await page.goto("/");
    await page.getByRole("button", { name: "AI 任务", exact: true }).tap();
    await page.getByRole("button", { name: "查看任务详情：当前码头" }).tap();
    const detail = page.locator(".task-detail-body");
    const summary = review.locator(":scope > summary");
    await swipeUntilVisible(page, detail, summary);
    await summary.tap();
    await swipeUntilVisible(page, detail, review.getByText("建议：最后一项审校建议已到达", { exact: true }));
    await expect(page.getByRole("button", { name: "打开生成版本", exact: true })).toBeInViewport();
  });
}

test("Generate review settings, server loop and durable report work together", async ({ page, request }) => {
  test.setTimeout(60_000);
  const fake = await reviewModelServer();
  try {
    const current = await (await request.get("/api/state")).json();
    const provider = await (await request.post("/api/providers", { data: { name: "UI Review", baseUrl: fake.baseUrl, secret: "fake-review-key", timeoutMs: 20000 } })).json();
    const model = await (await request.post("/api/models", { data: { providerId: provider.id, name: "UI Review", modelId: "ui-review", maxInputCharacters: 120000 } })).json();
    const latest = await (await request.get("/api/state")).json();
    const data = fullStudioFixture() as unknown as StudioData;
    data.settings.generateModel = model.id;
    data.articles[0].aiGenerateSettings!.model = model.id;
    data.settings.preparationMaxRounds = 0;
    expect((await request.put("/api/state", { headers: { "If-Match": String(latest.revision ?? current.revision) }, data: { data } })).ok()).toBeTruthy();
    await page.goto("/articles/article-main/info/review-rules");
    await page.getByRole("button", { name: "新增规则", exact: true }).click();
    await page.getByLabel("规则名称", { exact: true }).fill("人物年龄");
    await page.getByLabel("规则内容", { exact: true }).fill("人物必须十八岁；保留环境描写。");
    await page.getByRole("button", { name: "保存规则", exact: true }).click();
    await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].reviewRuleItems.some((rule: { content: string }) => rule.content === "人物必须十八岁；保留环境描写。")).toBe(true);
    await page.reload();
    await expect(page.getByLabel("规则：人物年龄", { exact: true })).toContainText("人物必须十八岁");
    await page.goto("/articles/article-main/outlines/outline-current/generate");
    await expect(page.getByLabel("审校循环次数", { exact: true })).toHaveValue("0");
    await expect(page.getByLabel("本次 Review 指令", { exact: true })).toHaveCount(0);
    await page.getByLabel("审校循环次数", { exact: true }).fill("2");
    await page.getByLabel("本次 Review 指令", { exact: true }).fill("保持雨后场景");
    await expect(page.locator(".generate-review-rules")).toContainText("人物必须十八岁");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    await page.getByRole("button", { name: "确认准备稿并写正文", exact: true }).click();
    await expect.poll(async () => (await (await request.get("/api/ai/tasks")).json()).tasks[0]?.state, { timeout: 25000 }).toBe("success");
    expect(fake.control.calls.map((item) => item.kind)).toEqual(["prepare", "generate", "review", "revise", "review"]);
    await page.goto("/");
    await page.getByRole("button", { name: "AI 任务", exact: true }).click();
    await page.getByRole("button", { name: "查看任务详情：当前码头" }).click();
    await page.getByText("审校报告 · 未发现剩余问题", { exact: true }).click();
    await expect(page.locator(".generate-review-report")).toContainText("已修正 1 / 2 次");
    await page.getByRole("button", { name: "打开生成版本", exact: true }).click();
    await expect(page.locator(".content-reader")).toContainText("她十八岁");
    await expect(page.locator(".generate-review-report")).toContainText("审校报告");
    await page.reload();
    await expect(page.locator(".generate-review-report")).toContainText("审校报告");
  } finally { fake.close(); }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }, { width: 390, height: 480 }]) {
  test(`review report remains reachable at ${viewport.width}x${viewport.height}`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    const current = await (await request.get("/api/state")).json();
    const data = fullStudioFixture() as unknown as StudioData;
    data.articles[0].reviewRules = "保留人物设定与有意呼应。";
    data.settings.generateReviewMaxRounds = 3;
    const report = {
      maxRounds: 3, completedRounds: 3, stopReason: "limit" as const, rules: "保留人物设定", instruction: "检查时间线", history: [],
      issues: [{ id: "P001", status: "open" as const, rule: "时间线一致", description: "两处事件时间仍有冲突", evidence: "第二天清晨", reason: "另一处写为当天傍晚，缺少可判断的依据。", suggestion: "请确认时间后统一修改。" }],
    };
    data.tasks = [{ id: "task-review-ui", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "正文", prompt: "检查时间线", model: "", executionOrigin: "local", state: "success", phase: "completed", createdAt: "2026-09-07T00:00:00.000Z", resultText: "终稿正文", contextOptions: { includePrevious: true, includeCharacters: true, estimatedCharacters: 0, reviewMaxRounds: 3, reviewRound: 3, reviewReport: report } }];
    expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
    await page.goto("/");
    await page.getByRole("button", { name: "AI 任务", exact: true }).click();
    await page.getByRole("button", { name: "查看任务详情：当前码头" }).click();
    await page.getByText("审校报告 · 剩余 1 项问题", { exact: true }).click();
    const reportView = page.locator(".generate-review-report");
    await page.getByText("请确认时间后统一修改。", { exact: false }).scrollIntoViewIfNeeded();
    await expect(reportView).toContainText("达到循环上限");
    await expect(reportView).toHaveCSS("touch-action", "pan-y");
    await expect(page.locator(".task-detail-body")).toHaveCSS("touch-action", "pan-y");
    await page.getByText("使用的规则", { exact: true }).click();
    await page.getByRole("button", { name: "打开生成版本", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "打开生成版本", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.getByRole("button", { name: "关闭 AI 任务", exact: true }).click();
    await expect(page.locator(".task-workspace")).toHaveCount(0);
  });
}
