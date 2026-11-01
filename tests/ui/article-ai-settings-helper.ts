import type { Page } from "@playwright/test";

export async function openArticleAiSettings(page: Page) {
  await page.goto("/articles/article-main/outlines/edit-all");
  await page.locator(".article-heading-actions").getByRole("button", { name: "设定", exact: true }).click();
  await page.locator(".article-ai-settings > summary").click();
}
