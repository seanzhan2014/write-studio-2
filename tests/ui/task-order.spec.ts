import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";
import { normalizeConfiguration } from "../../lib/style-learning";

test("all tasks and task categories keep submission order across generation, learning and photos", async ({ page, request }) => {
  const original = await (await request.get("/api/state")).json();
  const data = fullStudioFixture();
  const timestamp = (hour: number) => `2026-10-22T${String(hour).padStart(2, "0")}:00:00.000Z`;
  const task = { articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "正文", model: "", executionOrigin: "local" };
  data.tasks = [
    { ...task, id: "old", prompt: "最早生成", state: "failed", phase: "failed", createdAt: timestamp(6) },
    { ...task, id: "new", prompt: "最新生成", state: "cancelled", phase: "cancelled", createdAt: timestamp(12) },
    { ...task, id: "middle", prompt: "中间生成", state: "success", phase: "completed", createdAt: timestamp(9) },
  ];
  expect((await request.put("/api/state", { headers: { "If-Match": String(original.revision) }, data: { data } })).ok()).toBeTruthy();
  const configuration = normalizeConfiguration({ style: "测试" });
  const style = { articleId: "article-main", model: "model", updatedAt: timestamp(13), payload: { base: configuration, best: configuration, references: [], outlines: [], analyses: [], applications: [], inputTokens: 0, outputTokens: 0, bestRound: 0, bestScore: -1, round: 0 }, rounds: [] };
  const jobs = [
    { ...style, id: "style-old", kind: "tune", status: "failed", phase: "generate", createdAt: timestamp(7), payload: { ...style.payload, modelName: "最早学习" } },
    { ...style, id: "style-new", kind: "learn", status: "completed", phase: "completed", createdAt: timestamp(11), payload: { ...style.payload, modelName: "最新学习" } },
  ];
  let timelineQuery = false;
  await page.route(/\/api\/style-lab(?:\?.*)?$/, route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("scope") !== "history") return route.fulfill({ json: { jobs: [], active: 0, failed: 1, total: 2 } });
    timelineQuery ||= query.get("paginate") === "false";
    return route.fulfill({ json: { jobs, active: 0, failed: 1, total: 2, page: 1, pages: 1 } });
  });
  const photo = { characterId: data.articles[0].characters[0].id, snapshot: { model: { name: "照片模型" } }, error: "", updatedAt: timestamp(14) };
  await page.route("**/api/ai/character-photos", route => route.fulfill({ json: { jobs: [
    { ...photo, id: "photo-old", characterName: "较早照片", state: "success", createdAt: timestamp(8) },
    { ...photo, id: "photo-new", characterName: "较新照片", state: "error", createdAt: timestamp(10) },
  ] } }));
  await page.goto("/articles/article-main/outlines");
  await page.getByRole("button", { name: "AI 任务", exact: true }).click();
  const workspace = page.getByRole("region", { name: "AI 任务工作区", exact: true });
  const allOrder = [/最新生成/, /最新学习/, /较新照片/, /中间生成/, /较早照片/, /最早学习/, /最早生成/];
  await expect(workspace.locator(".task-timeline > *")).toContainText(allOrder);
  expect(timelineQuery).toBeTruthy();

  // Progress updates must not replace the original submission order.
  jobs[0].status = "cancelled";
  jobs[0].updatedAt = timestamp(23);
  await page.evaluate(() => window.dispatchEvent(new Event("style-lab-progress")));
  await expect(workspace.locator(".style-job").filter({ hasText: "最早学习" })).toContainText("已停止");
  await expect(workspace.locator(".task-timeline > *")).toContainText(allOrder);

  await workspace.getByRole("button", { name: "生成与对话", exact: true }).click();
  await expect(workspace.locator(".task-timeline > *")).toContainText([/最新生成/, /较新照片/, /中间生成/, /较早照片/, /最早生成/]);
  await expect(workspace.locator(".style-job")).toHaveCount(0);
  await workspace.getByRole("button", { name: "学习与微调", exact: true }).click();
  await expect(workspace.locator(".style-job-list > .style-job")).toContainText([/最新学习/, /最早学习/]);
  await workspace.getByRole("button", { name: "全部任务", exact: true }).click();
  await expect(workspace.locator(".task-timeline > *")).toContainText(allOrder);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
