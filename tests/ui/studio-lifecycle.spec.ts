import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { StudioData } from "../../app/studio-state";
import { fullStudioFixture } from "../fixtures.mjs";

type Snapshot = { data: StudioData; revision: number; databaseVersion: number };
async function readState(request: APIRequestContext): Promise<Snapshot> {
  const response = await request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function reset(request: APIRequestContext, empty = false) {
  const current = await readState(request);
  const data = fullStudioFixture() as unknown as StudioData;
  if (empty) data.articles = [];
  data.tasks = [];
  data.settings.chatModel = "";
  data.settings.generateModel = "";
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
}
// Route changes within the mounted app retain the unsaved/local record shape.
// A page.goto here would hydrate from SQLite and hide the original regression.
async function navigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function noConflict(page: Page) {
  await expect(page.getByRole("dialog", { name: "处理保存冲突" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.unexpectedSaveConflict)).not.toBe("true");
}
async function stableAfterSave(page: Page, request: APIRequestContext) {
  await page.keyboard.press("Control+s");
  await expect(page.getByText("内容已保存到本地数据库", { exact: true })).toBeVisible();
  const before = await readState(request);
  let writes = 0;
  const track = (outgoing: { url(): string; method(): string }) => {
    if (outgoing.url().endsWith("/api/state/mutations") && outgoing.method() === "POST") writes++;
  };
  page.on("request", track);
  // Observe both the 800ms autosave and 2s reconnect loops, not just one frame
  // where the modal happens to be closed.
  await page.waitForTimeout(2400);
  page.off("request", track);
  const after = await readState(request);
  expect(writes).toBe(0);
  expect(after.revision).toBe(before.revision);
  expect(after.databaseVersion).toBe(before.databaseVersion);
  await noConflict(page);
}
async function chat(page: Page, request: APIRequestContext, outlineId: string, question: string) {
  await page.getByLabel("聊天消息").fill(question);
  const submission = page.waitForResponse((response) => response.url().endsWith(`/outlines/${outlineId}/chat/transactions`)
    && response.request().postDataJSON()?.action === "submit");
  await page.getByRole("button", { name: "发送消息" }).click();
  const submitted = await submission;
  expect(submitted.status(), await submitted.text()).toBe(201);
  await expect.poll(async () => {
    const state = await readState(request);
    return state.data.tasks.find((task) => task.outlineId === outlineId && task.prompt === question)?.state;
  }, { timeout: 20000 }).toBe("success");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeVisible();
  await expect(page.locator(".message.user").filter({ hasText: question })).toHaveCount(1);
  await noConflict(page);
}

test.beforeEach(async ({ page, request }) => {
  await reset(request);
  // Remember transient modals too, even if a later task poll dismisses them.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if ([...document.querySelectorAll('[role="dialog"]')].some((element) => element.textContent?.includes("处理保存冲突"))) {
        document.documentElement.dataset.unexpectedSaveConflict = "true";
      }
    }).observe(document, { childList: true, subtree: true });
  });
});

test("new article and outline can edit, chat repeatedly and generate without reloading", async ({ page, request }) => {
  test.setTimeout(60000);
  await reset(request, true);
  await page.goto("/");
  const pageInstance = await page.evaluate(() => {
    const token = crypto.randomUUID();
    document.documentElement.dataset.lifecycleInstance = token;
    return token;
  });
  await page.getByRole("button", { name: "新建文章", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建文章" });
  await dialog.getByRole("textbox", { name: /标题/ }).fill("从空库创建的文章");
  await dialog.getByRole("button", { name: "创建文章" }).click();
  await expect.poll(async () => (await readState(request)).data.articles.length).toBe(1);
  const article = (await readState(request)).data.articles[0];
  await navigate(page, `/articles/${article.id}/outlines/edit-all`);
  const first = page.locator(`[data-continuous-outline-id="${article.chapters[0].outlines[0].id}"]`);
  await first.getByRole("button", { name: /下方新建大纲/ }).click();
  const created = page.locator("[data-continuous-outline-id]").nth(1);
  const outlineId = (await created.getAttribute("data-continuous-outline-id"))!;
  await created.locator(".continuous-outline-title-input").fill("刚创建的大纲");
  await created.locator(".continuous-text-editor.plan").fill("林澈在码头找到线索。");
  await created.locator(".continuous-text-editor.plan").blur();
  await navigate(page, `/articles/${article.id}/outlines/${outlineId}/chat`);
  for (let turn = 1; turn <= 3; turn++) await chat(page, request, outlineId, `新建后第 ${turn} 次聊天`);
  const saved = (await readState(request)).data.articles[0].chapters[0].outlines.find((item) => item.id === outlineId)!;
  expect(saved.plan).toBe("林澈在码头找到线索。");
  expect(saved.chat.sessions.flatMap((session) => session.messages).filter((message) => message.role === "assistant")).toHaveLength(3);
  await navigate(page, `/articles/${article.id}/outlines/${outlineId}/generate`);
  await page.getByRole("button", { name: "开始生成", exact: true }).click();
  await expect.poll(async () => (await readState(request)).data.tasks.find((task) => task.outlineId === outlineId && task.target === "正文")?.state, { timeout: 20000 }).toBe("success");
  await stableAfterSave(page, request);
  expect(await page.evaluate(() => document.documentElement.dataset.lifecycleInstance)).toBe(pageInstance);
  await page.reload();
  const restored = (await readState(request)).data.articles[0].chapters[0].outlines.find((item) => item.id === outlineId)!;
  expect(restored.versions.some((version) => version.source === "AI Generate")).toBe(true);
  expect(restored.chat.sessions.flatMap((session) => session.messages).filter((message) => message.role === "assistant")).toHaveLength(3);
  await noConflict(page);
});

test("new chapter can chat immediately without hydrating from the database", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "The chapter creation control belongs to the desktop sidebar.");
  await page.goto("/articles/article-main/outlines/outline-current/write");
  page.once("dialog", (dialog) => dialog.accept(dialog.defaultValue()));
  await page.getByRole("button", { name: "新建章节", exact: true }).click();
  await expect(page).not.toHaveURL(/\/outlines\/outline-current\//);
  const match = /\/outlines\/([^/]+)/.exec(new URL(page.url()).pathname);
  expect(match).not.toBeNull();
  const outlineId = match![1];
  expect(outlineId).not.toBe("outline-current");
  await page.getByRole("tab", { name: "聊天", exact: true }).click();
  await chat(page, request, outlineId, "刚新建章节就聊天");
  await chat(page, request, outlineId, "继续第二轮");
  const chapter = (await readState(request)).data.articles[0].chapters.find((item) => item.outlines.some((outline) => outline.id === outlineId))!;
  expect(chapter.nameVersions?.[0].title).toBe("未命名章节");
  await stableAfterSave(page, request);
});

test("autosave rebases over an AI reply when the stale request reaches SQLite last", async ({ page, request }) => {
  await page.goto("/articles/article-main/info/basic");
  await expect(page.getByLabel("文章标题")).toHaveValue("严格测试文章");
  const held = deferred();
  let intercepted = false;
  const statuses: number[] = [];
  await page.route("**/api/state/mutations", async (route) => {
    if (!intercepted) { intercepted = true; await held.promise; }
    const response = await route.fetch();
    statuses.push(response.status());
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("textbox", { name: /^简介/ }).fill("聊天期间的本机修改");
    await expect.poll(() => intercepted).toBe(true);
    await navigate(page, "/articles/article-main/outlines/outline-current/chat");
    await chat(page, request, "outline-current", "和自动保存并行的回复");
    held.release();
    await expect.poll(() => statuses.includes(409)).toBe(true);
    await expect.poll(async () => (await readState(request)).data.articles[0].summary).toBe("聊天期间的本机修改");
    await stableAfterSave(page, request);
  } finally { held.release(); }
});

test("late successful save acknowledgement cannot roll back a newer AI baseline", async ({ page, request }) => {
  await page.goto("/articles/article-main/info/basic");
  await expect(page.getByLabel("文章标题")).toHaveValue("严格测试文章");
  const held = deferred();
  let committed = false;
  let intercepted = false;
  await page.route("**/api/state/mutations", async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed = true;
    await held.promise;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("textbox", { name: /^简介/ }).fill("先落库但响应迟到");
    await expect.poll(() => committed).toBe(true);
    await navigate(page, "/articles/article-main/outlines/outline-current/chat");
    await chat(page, request, "outline-current", "晚响应期间完成聊天");
    held.release();
    await stableAfterSave(page, request);
    await page.reload();
    await expect(page.locator(".message.user").filter({ hasText: "晚响应期间完成聊天" })).toHaveCount(1);
    expect((await readState(request)).data.articles[0].summary).toBe("先落库但响应迟到");
  } finally { held.release(); }
});

test("lost autosave response retries without duplicating records or reopening a conflict", async ({ page, request }) => {
  await page.goto("/articles/article-main/info/basic");
  await expect(page.getByLabel("文章标题")).toHaveValue("严格测试文章");
  let lost = false;
  await page.route("**/api/state/mutations", async (route) => {
    if (lost) return route.continue();
    lost = true;
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("failed");
  });
  await page.getByLabel("文章标题").fill("响应丢失后的标题");
  await expect.poll(() => lost).toBe(true);
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await readState(request)).data.articles[0].title).toBe("响应丢失后的标题");
  await stableAfterSave(page, request);
  await page.reload();
  await expect(page.getByLabel("文章标题")).toHaveValue("响应丢失后的标题");
});

for (const choice of ["保留本设备修改", "使用数据库内容"]) {
  test(`real conflict: ${choice} cancels queued saves and permits later edits`, async ({ page, request }) => {
    await page.goto("/articles/article-main/info/basic");
    await expect(page.getByLabel("文章标题")).toHaveValue("严格测试文章");
    const held = deferred();
    let intercepted = false;
    await page.route("**/api/state/mutations", async (route) => {
      if (!intercepted) { intercepted = true; await held.promise; }
      await route.continue();
    });
    try {
      await page.getByLabel("文章标题").fill("本机冲突标题");
      await expect.poll(() => intercepted).toBe(true);
      await page.getByLabel("写作风格").fill("本机独立文风");
      await page.keyboard.press("Control+s"); // Queue a second snapshot behind the held write.
      const remote = await readState(request);
      remote.data.articles[0].title = "数据库冲突标题";
      remote.data.articles[0].summary = "数据库独立简介";
      expect((await request.put("/api/state", { headers: { "If-Match": String(remote.revision) }, data: { data: remote.data } })).ok()).toBeTruthy();
      held.release();
      const dialog = page.getByRole("dialog", { name: "处理保存冲突" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("本机冲突标题");
      await expect(dialog).toContainText("数据库冲突标题");
      await dialog.getByRole("button", { name: choice, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.evaluate(() => { delete document.documentElement.dataset.unexpectedSaveConflict; });
      const title = choice === "保留本设备修改" ? "本机冲突标题" : "数据库冲突标题";
      await expect(page.getByLabel("文章标题")).toHaveValue(title);
      await expect(page.getByLabel("写作风格")).toHaveValue("本机独立文风");
      await expect(page.getByRole("textbox", { name: /^简介/ })).toHaveValue("数据库独立简介");
      await stableAfterSave(page, request);
      await page.getByLabel("文章标题").fill(`${title}之后再编辑`);
      await expect.poll(async () => (await readState(request)).data.articles[0].title).toBe(`${title}之后再编辑`);
      await stableAfterSave(page, request);
      await page.reload();
      await expect(page.getByLabel("文章标题")).toHaveValue(`${title}之后再编辑`);
      await noConflict(page);
    } finally { held.release(); }
  });
}
