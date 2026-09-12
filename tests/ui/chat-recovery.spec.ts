import { expect, test } from "@playwright/test";
import http from "node:http";
import { once } from "node:events";
import { fullStudioFixture } from "../fixtures.mjs";

test.beforeEach(async ({ request }) => {
  const current = await (await request.get("/api/state")).json();
  const data = fullStudioFixture();
  data.tasks = [];
  expect((await request.put("/api/state", { headers: { "If-Match": String(current.revision) }, data: { data } })).ok()).toBeTruthy();
});

test("Chat reload restores server progress and receives exactly one durable reply", async ({ page, request }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const server = http.createServer(async (incoming, response) => {
    incoming.resume();
    calls++;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "刷新前的片段" } }] })}\n\n`);
    await gate;
    if (!response.destroyed) response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "，刷新后的完整结果" } }] })}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as { port: number };
    const provider = await (await request.post("/api/providers", { data: { name: "Reload test", baseUrl: `http://127.0.0.1:${address.port}/v1`, secret: "fake-key", timeoutMs: 60_000 } })).json();
    const model = await (await request.post("/api/models", { data: { providerId: provider.id, name: "Reload test", modelId: "reload-test" } })).json();
    await page.goto("/articles/article-main/outlines/outline-current/chat");
    await page.getByLabel("聊天模型", { exact: true }).selectOption(model.id);
    await page.getByLabel("AI Chat 消息").fill("刷新时继续保存回复");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect.poll(async () => (await (await request.get("/api/ai/tasks")).json()).tasks[0]?.receivedCharacters).toBeGreaterThan(0);
    await page.reload();
    await expect(page.locator(".message.assistant.streaming")).toContainText("刷新前的片段");
    release();
    await expect(page.getByRole("button", { name: "发送消息" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".message.assistant").filter({ hasText: "刷新前的片段，刷新后的完整结果" })).toHaveCount(1);
    expect(calls).toBe(1);
  } finally { release(); server.closeAllConnections(); server.close(); }
});

test("Chat replays a lost completion acknowledgement after reload without duplicate messages", async ({ page, request }) => {
  let lostTask = "";
  await page.route("**/chat/transactions", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "finalize") {
      lostTask = body.taskId;
      await route.fetch(); // Commit at the server, then lose the response.
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto("/articles/article-main/outlines/outline-current/chat");
  await page.getByLabel("AI Chat 消息").fill("完成响应丢失后恢复");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect.poll(() => lostTask).not.toBe("");
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("writer-studio.pending-chat-completions.v1") ?? "[]").length)).toBe(1);
  await page.unroute("**/chat/transactions");
  await page.reload();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("writer-studio.pending-chat-completions.v1") ?? "[]").length)).toBe(0);
  const tasks = await (await request.get("/api/ai/tasks")).json();
  expect(tasks.tasks.find((task: { id: string }) => task.id === lostTask).state).toBe("success");
  await expect(page.locator(".message.assistant").filter({ hasText: "我参考了" })).toHaveCount(1);
});

test("Chat queues an unconfirmed stop and confirms cancellation after reconnection", async ({ page, request }) => {
  await page.route("**/chat/stream", (route) => route.abort("failed"));
  let failCompletion = true;
  await page.route("**/chat/transactions", async (route) => {
    if (route.request().postDataJSON().action === "finalize" && failCompletion) await route.abort("failed");
    else await route.continue();
  });
  await page.goto("/articles/article-main/outlines/outline-current/chat");
  await page.getByLabel("AI Chat 消息").fill("停止请求暂时无法送达");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("writer-studio.pending-chat-completions.v1") ?? "[]").length)).toBe(1);
  await page.getByRole("button", { name: "停止回复" }).click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("writer-studio.pending-chat-completions.v1") ?? "[]")[0]?.body.status)).toBe("cancelled");
  failCompletion = false;
  await page.reload();
  await expect(page.getByRole("button", { name: "发送消息" })).toBeVisible();
  expect((await (await request.get("/api/ai/tasks")).json()).tasks[0].state).toBe("cancelled");
});
