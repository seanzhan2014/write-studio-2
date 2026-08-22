import assert from "node:assert/strict";
import test from "node:test";
import {
  ServiceManagerRequestError,
  getManagedServiceStatus,
  resolveServiceManagerUrl,
  restartManagedService,
} from "../lib/service-manager-client.mjs";

const managedStatus = {
  manager: { host: "127.0.0.1", port: 3003 },
  service: { managed: true, state: "running", startedAt: "2026-08-22T00:00:00.000Z" },
  operation: "idle",
  checkedAt: "2026-08-22T00:00:01.000Z",
};

test("service manager client defaults to the loopback manager port", () => {
  assert.equal(resolveServiceManagerUrl({}).href, "http://127.0.0.1:3003/");
  assert.equal(resolveServiceManagerUrl({ WRITER_STUDIO_MANAGER_PORT: "4312" }).href, "http://127.0.0.1:4312/");
  assert.equal(resolveServiceManagerUrl({ WRITER_STUDIO_MANAGER_API_URL: "https://manager.example/control" }).href, "https://manager.example/control/");
});

test("service manager client reads status and requests restart", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    const body = init.method === "POST" ? { ok: true, changed: true, message: "已发送" } : managedStatus;
    return Response.json(body);
  };
  const options = { env: { WRITER_STUDIO_MANAGER_PORT: "4312" }, fetchImpl };

  assert.deepEqual(await getManagedServiceStatus(options), managedStatus);
  assert.equal((await restartManagedService(options)).ok, true);
  assert.deepEqual(calls, [
    { url: "http://127.0.0.1:4312/api/status", method: "GET" },
    { url: "http://127.0.0.1:4312/api/restart", method: "POST" },
  ]);
});

test("service manager client reports unavailable and invalid managers safely", async () => {
  await assert.rejects(
    getManagedServiceStatus({ fetchImpl: async () => { throw new Error("private socket detail"); } }),
    (error) => error instanceof ServiceManagerRequestError
      && error.code === "MANAGER_UNAVAILABLE"
      && !error.message.includes("private socket detail"),
  );
  assert.throws(
    () => resolveServiceManagerUrl({ WRITER_STUDIO_MANAGER_API_URL: "file:///tmp/manager" }),
    (error) => error instanceof ServiceManagerRequestError && error.code === "MANAGER_CONFIG_INVALID",
  );
});
