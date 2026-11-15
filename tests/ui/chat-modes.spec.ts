import { selectDefaultCategory, selectChatMode, expectChatMode, newChatSession } from "./workspace-controls";
import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

test("chat modes and all three editable presets survive reload", async ({ page, request }, testInfo) => {
  test.setTimeout(90000);
  await page.route("**/api/connectivity", route => route.fulfill({ status: 204 }));
  const current = await (await request.get("/api/state")).json();
  const data = fullStudioFixture();
  data.tasks = [];
  for (const article of data.articles) for (const chapter of article.chapters) for (const outline of chapter.outlines) for (const session of outline.chat.sessions) {
    session.messages = [];
    session.lastReadMessageId = null;
  }
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
  await page.goto("/settings/tasks");
  await selectDefaultCategory(page,"聊天");
  const presets = page.getByRole("region", { name: "聊天预定义" });
  for (const [label, mode] of [["普通", "normal"], ["大纲", "outline"], ["文章写作", "writing"]]) {
    await presets.getByText(label, { exact: true }).click();
    await presets.getByLabel(`${label}预定义指令`, { exact: true }).fill(`${label}专属测试指令`);
    await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.chatModePrompts?.[mode]).toBe(`${label}专属测试指令`);
  }
  await page.reload();
  await selectDefaultCategory(page,"聊天");
  await presets.getByText("大纲", { exact: true }).click();
  await expect(presets.getByLabel("大纲预定义指令", { exact: true })).toHaveValue("大纲专属测试指令");
  await presets.getByRole("button", { name: "恢复当前模式默认" }).click();
  await expect(presets.getByLabel("大纲预定义指令", { exact: true })).toHaveValue(/因果连贯的情节概要/);
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.settings.chatModePrompts?.outline).toContain("因果连贯的情节概要");
  await page.screenshot({ path: testInfo.outputPath("chat-presets.png"), fullPage: true });
  await page.goto("/articles/article-main/outlines/outline-current/chat");
  const modes = page.locator(".chat-mode-switch");
  await selectChatMode(page,"outline");
  const savedMode = async () => {
    const state = await (await request.get("/api/state")).json();
    const outline = state.data.articles.flatMap((a: { chapters: unknown[] }) => a.chapters).flatMap((c: { outlines: unknown[] }) => c.outlines).find((o: { id: string }) => o.id === "outline-current");
    return outline.chat.sessions.find((s: { id: string }) => s.id === outline.chat.activeSessionId)?.mode;
  };
  await expect.poll(savedMode).toBe("outline");
  await page.reload();
  await expectChatMode(page,"outline");
  await expect(page.getByRole("button", { name: "整理当前情节概要", exact: true })).toBeVisible();
  await selectChatMode(page,"writing");
  await expect.poll(savedMode).toBe("writing");
  await expect(page.getByRole("button", { name: "按当前大纲创作正文", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("chat-modes.png"), fullPage: true });
  await newChatSession(page);
  await expectChatMode(page,"normal");
});
