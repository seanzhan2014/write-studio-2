import { expect, type Page } from "@playwright/test";

export async function showTotalWordMode(page: Page) {
  const mode = page.getByRole("combobox", { name: "篇幅控制", exact: true });
  await expect(mode).toBeVisible({ timeout: 20000 });
  if (await mode.inputValue() === "总目标字数") return;
  await mode.click();
  await page.getByRole("option", { name: "总目标字数", exact: true }).click();
}
