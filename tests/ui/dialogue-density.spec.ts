import { expect, test } from "@playwright/test";
import type { AiTask } from "../../app/studio-state";
import { fullStudioFixture } from "../fixtures.mjs";

test.beforeEach(async ({ request }) => {
  const current = await (await request.get("/api/state")).json();
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data: fullStudioFixture() } })).ok()).toBeTruthy();
});

test("closing summary defaults off, inherits article settings and persists an explicit opt-out", async ({ page, request }, testInfo) => {
  await page.goto("/articles/article-main/info/ai-tasks");
  const summary = page.getByRole("radiogroup", { name: "收尾总结", exact: true });
  await expect(summary.getByRole("radio", { name: "无", exact: true })).toBeChecked();
  await summary.getByRole("radio", { name: "无", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(summary.getByRole("radio", { name: "短", exact: true })).toBeChecked();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].aiGenerateSettings.closingSummaryLength).toBe("short");
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  await expect(summary.getByRole("radio", { name: "短", exact: true })).toBeChecked();
  await summary.getByRole("radio", { name: "无", exact: true }).check();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles[0].chapters[0].outlines.find((item: { id: string }) => item.id === "outline-current").generateOptions?.closingSummaryLength).toBe("none");
  await page.reload();
  await expect(summary.getByRole("radio", { name: "无", exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("closing-summary.png"), fullPage: true });
});

test("changing only the closing summary choice creates a distinct generation request", async ({ page }) => {
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const summary = page.getByRole("radiogroup", { name: "收尾总结", exact: true });
  await expect(summary.getByRole("radio", { name: "无", exact: true })).toBeChecked();
  for (const [length, label] of [["none", "无"], ["short", "短"], ["medium", "中"], ["long", "长"]] as const) {
    await summary.getByRole("radio", { name: label, exact: true }).check();
    const pending = page.waitForResponse((response) => response.url().endsWith("/api/ai/tasks") && response.request().method() === "POST");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    const response = await pending;
    expect(response.ok()).toBeTruthy();
    const task = (await response.json()).data as AiTask;
    expect(task.contextOptions?.closingSummaryLength).toBe(length);
    expect(task.contextOptions?.includeClosingSummary).toBe(length !== "none");
    await page.clock.setFixedTime(new Date(task.createdAt));
  }
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(page.getByText("相同生成请求已在队列中。", { exact: true })).toBeVisible();
});

test("prose controls support keyboard selection, mode guidance and narrow touch targets", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const group = page.getByRole("radiogroup", { name: "对话密度", exact: true });
  const introspection = page.getByRole("radiogroup", { name: "内心活动", exact: true });
  const description = page.getByRole("radiogroup", { name: "描写细度", exact: true });
  const pace = page.getByRole("radiogroup", { name: "叙事节奏", exact: true });
  const paragraph = page.getByRole("radiogroup", { name: "段落长度", exact: true });
  const summary = page.getByRole("radiogroup", { name: "收尾总结", exact: true });
  await expect(group.getByRole("radio", { name: "自动", exact: true })).toBeChecked();
  await expect(introspection.getByRole("radio", { name: "自动", exact: true })).toBeChecked();
  await expect(description.getByRole("radio", { name: "自动", exact: true })).toBeChecked();
  await expect(pace.getByRole("radio", { name: "自动", exact: true })).toBeChecked();
  await expect(paragraph.getByRole("radio", { name: "自动", exact: true })).toBeChecked();
  await expect(summary.getByRole("radio", { name: "无", exact: true })).toBeChecked();
  await group.getByRole("radio", { name: "自动", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "低", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "适中", exact: true })).toBeChecked();
  await group.getByRole("radio", { name: "高", exact: true }).check();
  await expect(page.locator("#dialogue-density-description")).toContainText("更多通过人物交谈");
  await introspection.getByRole("radio", { name: "多", exact: true }).check();
  await description.getByRole("radio", { name: "细腻", exact: true }).check();
  await pace.getByRole("radio", { name: "紧凑", exact: true }).check();
  await paragraph.getByRole("radio", { name: "长", exact: true }).check();
  await expect(page.locator("#introspection-density-description")).toContainText("判断、犹豫、联想");
  await expect(page.locator("#description-detail-description")).toContainText("环境、感官和身体感受");
  await expect(page.locator("#narrative-pace-description")).toContainText("行动、信息或局势");
  await expect(page.locator("#paragraph-length-description")).toContainText("不把无关内容强行合并");
  for (const controls of [group, introspection, description, pace, paragraph, summary]) {
    for (const radio of await controls.getByRole("radio").all()) {
      const box = await radio.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.getByRole("radio", { name: /^改写正文/ }).click();
  await page.getByRole("slider", { name: "原文保留度" }).focus();
  await page.keyboard.press("End");
  await expect(page.locator(".prose-controls-section")).toContainText("优先保留原文结构");
  await page.getByRole("radio", { name: /^续写正文/ }).click();
  await expect(group.getByRole("radio", { name: "高", exact: true })).toBeChecked();
  await expect(introspection.getByRole("radio", { name: "多", exact: true })).toBeChecked();
  await expect(paragraph.getByRole("radio", { name: "长", exact: true })).toBeChecked();
  await expect(page.locator(".prose-controls-section")).toContainText("仅影响新增正文");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test("prose controls are submitted, distinguish recent requests and remain visible in task details", async ({ page, request }) => {
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const groups = {
    dialogue: page.getByRole("radiogroup", { name: "对话密度", exact: true }),
    introspection: page.getByRole("radiogroup", { name: "内心活动", exact: true }),
    description: page.getByRole("radiogroup", { name: "描写细度", exact: true }),
    pace: page.getByRole("radiogroup", { name: "叙事节奏", exact: true }),
    paragraph: page.getByRole("radiogroup", { name: "段落长度", exact: true }),
  };
  const createdTasks: AiTask[] = [];
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/ai/tasks") && response.request().method() === "POST" && response.ok()) createdTasks.push((await response.json()).data);
  });
  const requests = [
    { labels: ["低", "多", "适中", "舒缓", "短"], value: { dialogueDensity: "low", introspectionDensity: "high", descriptionDetail: "balanced", narrativePace: "slow", paragraphLength: "short" } },
    { labels: ["高", "少", "细腻", "紧凑", "长"], value: { dialogueDensity: "high", introspectionDensity: "low", descriptionDetail: "high", narrativePace: "fast", paragraphLength: "long" } },
  ] as const;
  for (const item of requests) {
    await groups.dialogue.getByRole("radio", { name: item.labels[0], exact: true }).check();
    await groups.introspection.getByRole("radio", { name: item.labels[1], exact: true }).check();
    await groups.description.getByRole("radio", { name: item.labels[2], exact: true }).check();
    await groups.pace.getByRole("radio", { name: item.labels[3], exact: true }).check();
    await groups.paragraph.getByRole("radio", { name: item.labels[4], exact: true }).check();
    const pending = page.waitForResponse((response) => response.url().endsWith("/api/ai/tasks") && response.request().method() === "POST");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    const response = await pending;
    expect(response.ok()).toBeTruthy();
    const created = (await response.json()).data as AiTask;
    expect(created.contextOptions?.proseControls).toEqual(item.value);
    expect(created.contextOptions?.dialogueDensity).toBe(item.value.dialogueDensity);
    await page.clock.setFixedTime(new Date(created.createdAt));
  }
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect(page.getByText("相同生成请求已在队列中。", { exact: true })).toBeVisible();
  expect(createdTasks).toHaveLength(2);
  await expect.poll(async () => {
    const tasks = (await (await request.get("/api/ai/tasks")).json()).tasks as AiTask[];
    return tasks.filter((task) => createdTasks.some((created) => created.id === task.id) && task.state === "success").length;
  }).toBe(2);
  await page.reload();
  if (test.info().project.name === "mobile-chromium") await page.getByRole("button", { name: "返回大纲", exact: true }).click();
  await page.getByRole("button", { name: "AI 任务", exact: true }).click();
  await page.getByRole("button", { name: "查看任务详情：当前码头", exact: true }).first().click();
  await expect(page.locator(".task-context-tags")).toContainText("对话 高");
  await expect(page.locator(".task-context-tags")).toContainText("心理 少");
  await expect(page.locator(".task-context-tags")).toContainText("描写 细腻");
  await expect(page.locator(".task-context-tags")).toContainText("节奏 紧凑");
  await expect(page.locator(".task-context-tags")).toContainText("段落 长");
});
