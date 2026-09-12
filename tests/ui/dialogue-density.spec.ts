import { expect, test } from "@playwright/test";
import type { AiTask } from "../../app/studio-state";
import { fullStudioFixture } from "../fixtures.mjs";

test.beforeEach(async ({ request }) => {
  const current = await (await request.get("/api/state")).json();
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data: fullStudioFixture() } })).ok()).toBeTruthy();
});

test("dialogue density supports keyboard selection, mode guidance and narrow touch targets", async ({ page }, testInfo) => {
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const group = page.getByRole("radiogroup", { name: "对话密度", exact: true });
  await expect(group.getByRole("radio", { name: "自动", exact: true })).toBeChecked();
  await group.getByRole("radio", { name: "自动", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "低", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "适中", exact: true })).toBeChecked();
  await group.getByRole("radio", { name: "高", exact: true }).check();
  await expect(page.locator("#dialogue-density-description")).toContainText("更多通过人物交谈");
  for (const label of ["自动", "低", "适中", "高"]) {
    const box = await group.getByRole("radio", { name: label, exact: true }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("radio", { name: /^改写正文/ }).click();
  await page.getByRole("slider", { name: "原文保留度" }).focus();
  await page.keyboard.press("End");
  await expect(page.locator(".dialogue-density-control")).toContainText("优先保留原文结构");
  await page.getByRole("radio", { name: /^续写正文/ }).click();
  await expect(group.getByRole("radio", { name: "高", exact: true })).toBeChecked();
  await expect(page.locator(".dialogue-density-control")).toContainText("仅影响新增正文");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test("dialogue density is submitted, distinguishes recent requests and remains visible in task details", async ({ page, request }) => {
  await page.goto("/articles/article-main/outlines/outline-current/generate");
  const group = page.getByRole("radiogroup", { name: "对话密度", exact: true });
  const createdTasks: AiTask[] = [];
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/ai/tasks") && response.request().method() === "POST" && response.ok()) createdTasks.push((await response.json()).data);
  });
  for (const label of ["低", "高"]) {
    await group.getByRole("radio", { name: label, exact: true }).check();
    const pending = page.waitForResponse((response) => response.url().endsWith("/api/ai/tasks") && response.request().method() === "POST");
    await page.getByRole("button", { name: "开始生成", exact: true }).click();
    const response = await pending;
    expect(response.ok()).toBeTruthy();
    const created = (await response.json()).data as AiTask;
    expect(created.contextOptions?.dialogueDensity).toBe(label === "低" ? "low" : "high");
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
  await page.getByRole("button", { name: "查看全部 AI 任务 →", exact: true }).click();
  await page.getByRole("button", { name: "查看任务详情：当前码头", exact: true }).first().click();
  await expect(page.locator(".task-context-tags")).toContainText("对话密度 高");
});
