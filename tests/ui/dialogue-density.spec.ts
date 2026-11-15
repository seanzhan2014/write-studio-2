import { openGlobalAiSettings } from "./ai-task-settings-helper";
import { expect, test } from "@playwright/test";
import type { AiTask } from "../../app/studio-state";
import { fullStudioFixture } from "../fixtures.mjs";

test.beforeEach(async ({ request }) => {
  const current = await (await request.get("/api/state")).json();
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data: fullStudioFixture() } })).ok()).toBeTruthy();
});

test("closing summary defaults off, inherits global settings and persists an explicit opt-out", async ({ page, request }, testInfo) => {
  await openGlobalAiSettings(page);
  const summary = page.getByRole("radiogroup", { name: "收尾总结", exact: true });
  await expect(summary.getByRole("radio", { name: "无", exact: true })).toBeChecked();
  await summary.getByRole("radio", { name: "无", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(summary.getByRole("radio", { name: "1句", exact: true })).toBeChecked();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.aiGenerateSettings.closingSummaryLength).toBe("short");
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  await expect(summary.getByRole("radio", { name: "1句", exact: true })).toBeChecked();
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
  for (const [length, label] of [["none", "无"], ["short", "1句"], ["medium", "1段"], ["auto", "自动"]] as const) {
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

test("prose controls support keyboard selection, mode changes and narrow touch targets", async ({ page }, testInfo) => {
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
  await expect(group.getByRole("radio", { name: "高", exact: true })).toBeChecked();
  await introspection.getByRole("radio", { name: "多", exact: true }).check();
  await description.getByRole("radio", { name: "细腻", exact: true }).check();
  await pace.getByRole("radio", { name: "紧凑", exact: true }).check();
  await paragraph.getByRole("radio", { name: "长", exact: true }).check();
  for (const [controls, name] of [[introspection, "多"], [description, "细腻"], [pace, "紧凑"], [paragraph, "长"]] as const) {
    await expect(controls.getByRole("radio", { name, exact: true })).toBeChecked();
  }
  for (const controls of [group, introspection, description, pace, paragraph, summary]) {
    for (const radio of await controls.getByRole("radio").all()) {
      const box = await radio.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.getByRole("radio", { name: /^改写正文/ }).click();
  for (const controls of [group, introspection, description, pace, paragraph, summary]) {
    await expect(controls.getByRole("radio", { name: "自动", exact: true })).toBeChecked();
  }
  await page.getByRole("slider", { name: "原文保留度" }).focus();
  await page.keyboard.press("End");
  await expect(page.locator(".rewrite-retention-heading strong")).toContainText("高保留");
  await page.getByRole("radio", { name: /^续写正文/ }).click();
  await expect(group.getByRole("radio", { name: "高", exact: true })).toBeChecked();
  await expect(introspection.getByRole("radio", { name: "多", exact: true })).toBeChecked();
  await expect(paragraph.getByRole("radio", { name: "长", exact: true })).toBeChecked();
  await expect(page.getByRole("slider", { name: "原文保留度" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test("rewrite defaults and explicit edits persist independently from ordinary writing", async ({ page, request }) => {
  test.setTimeout(90_000);
  await openGlobalAiSettings(page);
  await page.getByRole("radiogroup", { name: "对话密度", exact: true }).getByRole("radio", { name: "高", exact: true }).check();
  const advanced = page.locator(".article-generate-settings .writing-advanced");
  await advanced.locator("summary").click();
  await advanced.getByLabel("心理展开方式", { exact: true }).fill("普通写作的心理要求");
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const dialogue = page.getByRole("radiogroup", { name: "对话密度", exact: true });
  const summary = page.getByRole("radiogroup", { name: "收尾总结", exact: true });
  await expect(dialogue.getByRole("radio", { name: "高", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: /^改写正文/ }).click();
  await expect(dialogue.getByRole("radio", { name: "自动", exact: true })).toBeChecked();
  await expect(summary.getByRole("radio", { name: "自动", exact: true })).toBeChecked();
  await page.locator(".writing-advanced > summary").click();
  await expect(page.getByLabel("心理展开方式", { exact: true })).toHaveValue("");
  const pending = page.waitForResponse(response => response.url().endsWith("/api/ai/tasks") && response.request().method() === "POST");
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  const response = await pending;
  expect(response.ok()).toBeTruthy();
  const task = (await response.json()).data as AiTask;
  expect(task.contextOptions?.advanced).toEqual({});
  expect(Object.values(task.contextOptions!.proseControls!)).toEqual(["auto", "auto", "auto", "auto", "auto"]);
  expect(task.contextOptions?.closingSummaryLength).toBe("auto");
  await dialogue.getByRole("radio", { name: "低", exact: true }).check();
  await summary.getByRole("radio", { name: "1句", exact: true }).check();
  await page.getByLabel("心理展开方式", { exact: true }).fill("改写专属心理要求");
  await expect.poll(async () => {
    const data = (await (await request.get("/api/state")).json()).data;
    return data.articles[0].chapters[0].outlines.find((outline: { id: string }) => outline.id === "outline-current").generateOptions?.rewriteExpression?.advanced?.psychology;
  }).toBe("改写专属心理要求");
  await page.reload();
  await expect(page.getByRole("radio", { name: /^改写正文/ })).toBeChecked({ timeout: 30_000 });
  await expect(dialogue.getByRole("radio", { name: "低", exact: true })).toBeChecked();
  await expect(summary.getByRole("radio", { name: "1句", exact: true })).toBeChecked();
  await page.locator(".writing-advanced > summary").click();
  await expect(page.getByLabel("心理展开方式", { exact: true })).toHaveValue("改写专属心理要求");
  await page.getByRole("radio", { name: /^全新生成/ }).click();
  await expect(dialogue.getByRole("radio", { name: "高", exact: true })).toBeChecked();
  await expect(page.getByLabel("心理展开方式", { exact: true })).toHaveValue("普通写作的心理要求");
  await page.getByRole("radio", { name: /^改写正文/ }).click();
  await expect(dialogue.getByRole("radio", { name: "低", exact: true })).toBeChecked();
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
