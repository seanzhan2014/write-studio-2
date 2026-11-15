import { selectDefaultCategory } from "./workspace-controls";
import type { Page } from "@playwright/test";

export async function openGlobalAiSettings(page: Page, category = "正文生成") {
  await page.goto("/settings/tasks");
  await selectDefaultCategory(page,category);
}
