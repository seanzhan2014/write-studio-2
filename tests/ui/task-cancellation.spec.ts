import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

test("task cancellation explains a non-JSON server error and can be retried successfully", async ({ page, request }) => {
  const original = await (await request.get("/api/state")).json();
  const data = fullStudioFixture();
  data.tasks = [{
    id: "cancel-regression", articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current",
    target: "正文", model: "", prompt: "取消任务回归检查", state: "running", phase: "connecting",
    executionOrigin: "local", createdAt: new Date().toISOString(), runnerId: "test-runner",
    leaseUntil: new Date(Date.now() + 600000).toISOString(),
  }];
  expect((await request.put("/api/state", { headers: { "If-Match": String(original.revision) }, data: { data } })).ok()).toBeTruthy();
  const endpoint = "**/api/ai/tasks/cancel-regression/state";
  await page.route(endpoint, route => route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" }));
  const alerts: string[] = [];
  page.on("dialog", async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
  await page.goto("/articles/article-main/outlines");
  await page.getByRole("button", { name: "AI 任务", exact: true }).click();
  const card = page.locator(".task-card").filter({ hasText: "取消任务回归检查" });
  await card.getByRole("button", { name: "取消", exact: true }).click();
  await expect.poll(() => alerts).toEqual(["任务状态更新失败（HTTP 500），请稍后重试。"]);
  await expect(card.getByRole("button", { name: "取消", exact: true })).toBeVisible();
  await page.unroute(endpoint);
  await card.getByRole("button", { name: "取消", exact: true }).click();
  await expect(card.locator(".task-state")).toContainText("已取消");
  await expect(card.getByRole("button", { name: "取消", exact: true })).toHaveCount(0);
  const saved = await (await request.get("/api/state")).json();
  expect(saved.data.tasks.find((task: { id: string }) => task.id === "cancel-regression").state).toBe("cancelled");
});
