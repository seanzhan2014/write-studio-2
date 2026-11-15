import assert from "node:assert/strict";
import test from "node:test";
import { browserIsOffline, fetchFromServer, fetchServerAction, OFFLINE_OPERATION_MESSAGE, readServerJson } from "../lib/browser-network.ts";

test("server actions use the requested endpoint even when the connectivity probe is unavailable", async (t) => {
  const calls = [];
  const controller = new AbortController();
  const init = { method: "POST", body: "{}", signal: controller.signal };
  t.mock.method(globalThis, "fetch", async (input, options) => {
    calls.push({ input, options });
    if (input === "/api/connectivity") throw new TypeError("Failed to fetch");
    return Response.json({ task: "created" });
  });

  assert.deepEqual(await (await fetchServerAction("/api/ai/tasks", init)).json(), { task: "created" });
  assert.deepEqual(calls, [{ input: "/api/ai/tasks", options: init }]);
});

test("a transient request failure does not put other requests into offline mode", async (t) => {
  t.mock.getter(globalThis, "navigator", () => ({ onLine: true }));
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) throw new TypeError("Failed to fetch");
    return Response.json({ ok: true });
  });

  await assert.rejects(fetchFromServer("/api/state"), error => {
    assert.match(error.message, /无法连接服务端/);
    assert.notEqual(error.message, OFFLINE_OPERATION_MESSAGE);
    return true;
  });
  assert.equal(browserIsOffline(), false);
  assert.deepEqual(await (await fetchServerAction("/api/ai/tasks", { method: "POST" })).json(), { ok: true });
  assert.equal(calls, 2);
});

test("offline actions fail immediately and can be submitted once reconnected", async (t) => {
  let online = false;
  t.mock.getter(globalThis, "navigator", () => ({ onLine: online }));
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));

  await assert.rejects(fetchServerAction("/api/ai/tasks", { method: "POST" }), { message: OFFLINE_OPERATION_MESSAGE });
  assert.equal(fetch.mock.callCount(), 0);
  online = true;
  assert.equal((await fetchServerAction("/api/ai/tasks", { method: "POST" })).ok, true);
  assert.equal(fetch.mock.callCount(), 1);
});

test("server actions preserve HTTP failures and never retry a mutation", async (t) => {
  const response = Response.json({ error: "服务端维护中" }, { status: 503 });
  const fetch = t.mock.method(globalThis, "fetch", async () => response);
  assert.equal(await fetchServerAction("/api/ai/tasks", { method: "POST" }), response);
  assert.equal(fetch.mock.callCount(), 1);
  await assert.rejects(readServerJson(response, "创建失败"), /服务端维护中/);
  assert.equal(browserIsOffline(), false);
});

test("caller cancellation and timeouts keep their original reasons without marking the browser offline", async (t) => {
  for (const reason of [new DOMException("Cancelled", "AbortError"), new DOMException("Deadline exceeded", "TimeoutError"), new Error("custom abort reason")]) {
    const controller = new AbortController();
    controller.abort(reason);
    t.mock.method(globalThis, "fetch", async () => { throw reason; });
    await assert.rejects(fetchServerAction("/api/ai/tasks", { method: "POST", signal: controller.signal }), error => error === reason);
    assert.equal(browserIsOffline(), false);
    t.mock.restoreAll();
  }
});

test("task cancellation reports plain-text and HTML server failures without JSON syntax errors", async () => {
  for (const [body, status] of [["Internal Server Error", 500], ["<html>Bad Gateway</html>", 502], ["", 503]]) {
    await assert.rejects(readServerJson(new Response(body, { status }), "取消任务失败"), error => {
      assert.equal(error.message, `取消任务失败（HTTP ${status}），请稍后重试。`);
      assert.equal(error instanceof SyntaxError, false);
      return true;
    });
  }
});

test("task responses preserve structured errors and successful mutation metadata", async () => {
  const payload = { task: { state: "cancelled" }, revision: 42 };
  assert.deepEqual(await readServerJson(Response.json(payload), "取消任务失败"), payload);
  await assert.rejects(readServerJson(Response.json({ error: "只有等待或运行中的任务可以取消" }, { status: 409 }), "取消任务失败"), /只有等待或运行中的任务可以取消/);
  await assert.rejects(readServerJson(Response.json({ error: "unavailable", message: "服务暂时不可用" }, { status: 503 }), "取消任务失败"), /服务暂时不可用/);
  for (const body of ["null", "[]", "Internal Server Error"]) {
    await assert.rejects(readServerJson(new Response(body), "取消任务失败"), /服务端返回了无效响应/);
  }
});
