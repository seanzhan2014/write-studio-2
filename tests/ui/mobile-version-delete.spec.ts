import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

test("mobile version deletion accepts touch confirmation after scrolling the drawer", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "touch interaction");
  test.setTimeout(60_000);
  const fixture = fullStudioFixture();
  const outline = fixture.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current")!;
  const base = outline.versions[0];
  Object.assign(outline, {
    currentVersionId: "touch-current",
    defaultVersionId: "touch-current",
    versions: [
      ...Array.from({ length: 8 }, (_, index) => ({ ...base, id: `touch-${index}`, name: `触屏版本 ${index}`, content: `保留正文 ${index}` })),
      { ...base, id: "touch-current", name: "待删除正文", content: "待删除正文内容" },
    ],
  });
  const current = await (await request.get("/api/state")).json();
  expect((await request.put("/api/state", {
    headers: { "If-Match": String(current.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  })).ok()).toBeTruthy();
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByRole("button", { name: "更多操作", exact: true }).tap();
  await page.getByRole("button", {name:"管理正文版本",exact:true}).tap();
  const drawer = page.locator(".version-drawer-shell");
  const version = drawer.locator("article").filter({ hasText: "待删除正文" });
  const remove = async()=>{const trigger=version.getByRole("button",{name:"待删除正文的更多操作",exact:true});await trigger.scrollIntoViewIfNeeded();await trigger.tap();await page.getByRole("menuitem",{name:"删除",exact:true}).tap();};
  await remove();
  const confirmation = page.getByRole("dialog", { name: "删除正文？", exact: true });
  await expect(confirmation).toBeVisible();
  expect((await confirmation.boundingBox())!.height).toBeLessThan(400);
  const cancel = confirmation.getByRole("button", { name: "取消", exact: true });
  await expect(cancel).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("delete-confirmation.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(drawer).toBeVisible();
  await remove();
  await cancel.tap();
  await expect(confirmation).toBeHidden();
  await expect(version).toHaveCount(1);
  await remove();
  await confirmation.getByRole("button", { name: "确认删除", exact: true }).tap();
  await expect(confirmation).toBeHidden();
  await expect(version).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await page.getByRole("button", { name: "关闭正文版本", exact: true }).tap();
  await page.reload();
  await expect(page.getByLabel("正文内容", { exact: true })).toHaveText("保留正文 0");
  const saved = await (await request.get("/api/state")).json();
  const result = saved.data.articles[0].chapters[0].outlines.find((item: { id: string }) => item.id === outline.id);
  expect(result.defaultVersionId).toBeNull();
  expect(result.versions).toHaveLength(8);
});
