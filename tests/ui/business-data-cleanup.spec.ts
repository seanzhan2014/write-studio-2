import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

test("business cleanup also removes browser drafts without losing system preferences", async ({ page, request }) => {
  test.setTimeout(60_000);
  const current = await (await request.get("/api/state")).json();
  const data = fullStudioFixture(); data.settings.fontSize = 21;
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
  await page.goto("/settings/database");
  await expect(page.locator(".main-area")).toBeVisible({ timeout: 30_000 });
  const clear = page.getByRole("button", { name: "清除全部业务数据", exact: true });
  await expect(clear).toBeVisible();
  await page.evaluate(async () => {
    sessionStorage.setItem("writer-studio:draft:outline-current", "synthetic draft");
    localStorage.setItem("writer-studio:photo-draft:character-lin", "synthetic photo draft");
    localStorage.setItem("writer-studio-poc-v2", "synthetic legacy snapshot");
    localStorage.setItem("writer-studio.pending-chat-completions.v1", "[]");
    localStorage.setItem("cleanup-test-preference", "keep");
    const open = indexedDB.open("writer-studio-offline-v1", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("snapshots", "readwrite");
      transaction.objectStore("snapshots").put({ version: 1, key: "draft:outline-current", outlineId: "outline-current", text: "synthetic offline draft", savedAt: new Date().toISOString() });
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  page.once("dialog", dialog => dialog.accept("CLEAR"));
  await clear.click();
  await expect.poll(async () => (await (await request.get("/api/state")).json()).data.articles.length).toBe(0);
  await expect.poll(() => page.evaluate(() => ({
    draft: sessionStorage.getItem("writer-studio:draft:outline-current"),
    photo: localStorage.getItem("writer-studio:photo-draft:character-lin"),
    legacy: localStorage.getItem("writer-studio-poc-v2"),
    chat: localStorage.getItem("writer-studio.pending-chat-completions.v1"),
    preference: localStorage.getItem("cleanup-test-preference"),
  }))).toEqual({ draft: null, photo: null, legacy: null, chat: null, preference: "keep" });
  const cache = await page.evaluate(async () => {
    const open = indexedDB.open("writer-studio-offline-v1", 1);
    const db = await new Promise<IDBDatabase>(resolve => { open.onsuccess = () => resolve(open.result); });
    const records = await new Promise<Array<{ key: string; localData?: { articles: unknown[] } }>>(resolve => {
      const query = db.transaction("snapshots", "readonly").objectStore("snapshots").getAll(); query.onsuccess = () => resolve(query.result);
    }); db.close(); return records;
  });
  expect(cache.some(record => record.key.startsWith("draft:"))).toBe(false);
  expect(cache.find(record => record.key === "primary")?.localData?.articles).toEqual([]);
  expect((await (await request.get("/api/state")).json()).data.settings.fontSize).toBe(21);
  await page.reload();
  await expect(clear).toBeVisible();
  expect((await (await request.get("/api/state")).json()).data.articles).toEqual([]);
});
