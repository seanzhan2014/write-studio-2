import { expect, test } from "@playwright/test";
import { fullStudioFixture } from "../fixtures.mjs";

test.beforeEach(async ({ request }) => {
  const current = await request.get("/api/state");
  expect(current.ok()).toBeTruthy();
  const payload = await current.json() as { revision: number };
  const fixture = fullStudioFixture();
  fixture.tasks = [];
  const saved = await request.put("/api/state", {
    headers: { "If-Match": String(payload.revision) },
    data: { data: fixture, conflictResolution: "keep-local" },
  });
  expect(saved.ok()).toBeTruthy();
});

test("mobile reopens the cached library offline and syncs its local edit after reconnecting", async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile offline workflow");
  test.setTimeout(60_000);

  const route = "/articles/article-main/info/basic?offline-test=1";
  await page.goto(route);
  const title = page.getByLabel("文章标题");
  await expect(title).toHaveValue("严格测试文章");

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  });
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open("writer-studio-offline-v1", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<boolean>((resolve) => {
      const value = database.transaction("snapshots", "readonly").objectStore("snapshots").get("primary");
      value.onsuccess = () => resolve(Boolean(value.result?.localData));
      value.onerror = () => resolve(false);
    });
  })).toBe(true);

  const conditionalResponse = page.waitForResponse((response) => response.url().endsWith("/api/state") && Boolean(response.request().headers()["if-none-match"]));
  await page.reload();
  expect((await conditionalResponse).status()).toBe(304);
  await expect(page.getByLabel("文章标题")).toHaveValue("严格测试文章");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.offlineReady)).toBe("true");

  await context.setOffline(true);
  let offlineAiRequests = 0;
  page.on("request", (requested) => { if (requested.url().includes("/api/ai/")) offlineAiRequests += 1; });
  await page.evaluate(() => {
    window.history.pushState({}, "", "/articles/article-main/outlines/outline-current/generate?offline-test=1");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const offlineClickStartedAt = Date.now();
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByText("当前处于离线模式，此操作需要连接服务端。", { exact: true })).toBeVisible();
  expect(Date.now() - offlineClickStartedAt).toBeLessThan(1_000);
  expect(offlineAiRequests).toBe(0);
  await page.evaluate(() => {
    window.history.pushState({}, "", "/articles/article-main/info/basic?offline-test=1");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByLabel("文章标题").fill("手机离线标题");
  await expect(page.getByText("已保存到本设备", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open("writer-studio-offline-v1", 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<string>((resolve) => {
      const value = database.transaction("snapshots", "readonly").objectStore("snapshots").get("primary");
      value.onsuccess = () => resolve(value.result?.localData?.articles?.[0]?.title ?? "");
      value.onerror = () => resolve("");
    });
  })).toBe("手机离线标题");

  const concurrentResponse = await request.get("/api/state");
  const concurrentPayload = await concurrentResponse.json() as {
    revision: number;
    data: ReturnType<typeof fullStudioFixture>;
  };
  concurrentPayload.data.articles[0].summary = "服务端并行更新的简介";
  const concurrentSave = await request.put("/api/state", {
    headers: { "If-Match": String(concurrentPayload.revision) },
    data: { data: concurrentPayload.data, conflictResolution: "keep-local" },
  });
  expect(concurrentSave.ok()).toBeTruthy();

  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(route);
  await expect(reopened.getByLabel("文章标题")).toHaveValue("手机离线标题");
  await expect(reopened.getByText("已保存到本设备", { exact: true })).toBeVisible();

  await context.setOffline(false);
  await expect.poll(async () => {
    const response = await request.get("/api/state");
    const state = await response.json() as { data: { articles: Array<{ id: string; title: string; summary: string }> } };
    return state.data.articles.find((article) => article.id === "article-main")?.title;
  }, { timeout: 15_000 }).toBe("手机离线标题");
  const mergedResponse = await request.get("/api/state");
  const mergedState = await mergedResponse.json() as { data: { articles: Array<{ id: string; summary: string }> } };
  expect(mergedState.data.articles.find((article) => article.id === "article-main")?.summary).toBe("服务端并行更新的简介");
  await expect(reopened.getByText("处理保存冲突", { exact: true })).toHaveCount(0);
  await expect(reopened.getByText("已保存到本设备", { exact: true })).toHaveCount(0);
});
