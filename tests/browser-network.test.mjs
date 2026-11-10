import assert from "node:assert/strict";
import test from "node:test";
import { readServerJson } from "../lib/browser-network.ts";

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
