import { expect, test, type Locator } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

test.beforeEach(async ({ page, request }) => {
  const snapshot = await (await request.get("/api/state")).json();
  const data = fullStudioFixture();
  const outline = data.articles[0].chapters[0].outlines.find(item => item.id === "outline-current")!;
  outline.contentName = "直接保存的正文";
  expect((await request.put("/api/state", { headers: { "If-Match": String(snapshot.revision) }, data: { data } })).ok()).toBeTruthy();
  // Mobile embedded browsers can suppress native confirmation dialogs.
  await page.addInitScript(() => { window.confirm = () => false; });
});

test("body deletion works when native confirmation is unavailable", async ({ page, request }, info) => {
  await page.goto("/articles/article-main/outlines/outline-current/write");
  const touch = info.project.name === "mobile-chromium";
  const activate = (control: Locator) => touch ? control.tap() : control.click();
  const reader = page.getByLabel("正文内容", { exact: true });
  const content = await reader.innerText();
  const confirmation = page.getByRole("dialog", { name: "删除正文？", exact: true });
  const remove = page.getByRole("button", { name: "删除正文", exact: true });
  await activate(remove);
  await expect(confirmation).toContainText("直接保存的正文");
  await activate(confirmation.getByRole("button", { name: "取消", exact: true }));
  await expect(reader).toHaveText(content);
  await activate(remove);
  await activate(confirmation.getByRole("button", { name: "确认删除", exact: true }));
  await expect(confirmation).toBeHidden();
  await expect(reader).toHaveText("不可变版本正文");
  await expect.poll(async () => {
    const state = await (await request.get("/api/state")).json();
    const saved = state.data.articles[0].chapters[0].outlines.find((item: { id: string }) => item.id === "outline-current");
    return { content: saved.content, current: saved.currentVersionId };
  }).toEqual({ content: "", current: "version-manual" });
  await page.reload();
  await expect(reader).toHaveText("不可变版本正文");
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 667, height: 375 },
  { width: 390, height: 480 },
]) test(`mobile editing can cancel and confirm body deletion at ${viewport.width}x${viewport.height}`, async ({ page, request }, info) => {
  test.skip(info.project.name !== "mobile-chromium", "mobile editing menu");
  await page.setViewportSize(viewport);
  await page.goto("/articles/article-main/outlines/outline-current/write");
  await page.getByLabel("正文内容", { exact: true }).focus();
  await page.keyboard.press("Enter");
  const editor = page.getByLabel("正文编辑器");
  await editor.fill("尚未保存的正文修改");
  const menu = page.getByRole("menu", { name: "编辑操作", exact: true });
  const confirmation = page.getByRole("dialog", { name: "删除正文？", exact: true });
  await page.getByRole("button", { name: "更多编辑操作" }).tap();
  const remove = menu.getByRole("menuitem", { name: "删除正文", exact: true });
  await remove.scrollIntoViewIfNeeded();
  const bounds = await remove.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  await remove.tap();
  await expect(confirmation).toContainText("尚未保存的修改也会删除");
  await confirmation.getByRole("button", { name: "取消", exact: true }).tap();
  await expect(editor).toHaveValue("尚未保存的正文修改");
  await page.getByRole("button", { name: "更多编辑操作" }).tap();
  await remove.scrollIntoViewIfNeeded();
  await remove.tap();
  const confirm = confirmation.getByRole("button", { name: "确认删除", exact: true });
  await confirm.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`body-delete-${viewport.width}x${viewport.height}.png`) });
  await confirm.tap();
  await expect(confirmation).toBeHidden();
  await expect(editor).toHaveCount(0);
  await expect(page.getByLabel("正文内容", { exact: true })).toHaveText("不可变版本正文");
  await expect.poll(async () => {
    const state = await (await request.get("/api/state")).json();
    const saved = state.data.articles[0].chapters[0].outlines.find((item: { id: string }) => item.id === "outline-current");
    return { content: saved.content, versions: saved.versions.map((item: { id: string }) => item.id) };
  }).toEqual({ content: "", versions: ["version-manual"] });
  await page.reload();
  await expect(page.getByLabel("正文内容", { exact: true })).toHaveText("不可变版本正文");
});
