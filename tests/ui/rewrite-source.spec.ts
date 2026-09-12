import { expect, test, type APIRequestContext } from "@playwright/test";
import type { StudioData, Version } from "../../app/studio-state";
import { fullStudioFixture } from "../fixtures.mjs";

async function installRewrite(request: APIRequestContext, sourceExists: boolean) {
  const current = await (await request.get("/api/state")).json() as { revision: number };
  const data = fullStudioFixture() as unknown as StudioData;
  const outline = data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  const original: Version = {
    id: "version-original",
    name: "原正文（后来改名）",
    content: "这是可以直接打开的原正文。",
    source: "手动",
    createdAt: "2026-09-12T01:00:00.000Z",
  };
  const rewrite: Version = {
    id: "version-rewrite",
    name: "改写正文",
    content: "这是改写完成的新正文。",
    source: "AI Generate",
    createdAt: "2026-09-12T02:00:00.000Z",
    rewriteSourceId: original.id,
    rewriteSourceName: "原正文",
  };
  outline.versions = sourceExists ? [rewrite, original] : [rewrite];
  outline.currentVersionId = rewrite.id;
  outline.defaultVersionId = null;
  data.tasks = [];
  const saved = await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
}

test("a rewrite opens its original body by id while keeping the recorded name", async ({ page, request }) => {
  await installRewrite(request, true);
  await page.goto("/articles/article-main/outlines/outline-current/write");
  const source = page.locator(".rewrite-source-row").getByRole("button", { name: "原正文", exact: true });
  await expect(source).toBeVisible();
  await source.click();
  await expect(page.getByLabel("正文内容", { exact: true })).toContainText("这是可以直接打开的原正文。");
  await expect(page.getByText("原正文（后来改名）", { exact: true })).toBeVisible();
});

test("a rewrite reports an error when its original body has been deleted", async ({ page, request }) => {
  await installRewrite(request, false);
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.locator(".rewrite-source-row").getByRole("button", { name: "原正文", exact: true }).click();
  await expect(page.getByText("原正文已删除，无法打开", { exact: true })).toBeVisible();
  await expect(page.getByLabel("正文内容", { exact: true })).toContainText("这是改写完成的新正文。");
});
