import assert from "node:assert/strict";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sourceIdentity } from "../scripts/source-identity.mjs";

const workspace = fileURLToPath(new URL("..", import.meta.url));

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(check, child, output, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`服务管理器提前退出：\n${output.join("")}`);
    const result = await check().catch(() => null);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`等待服务重启超时：\n${output.join("")}`);
}

test("application restart endpoint rebuilds and restarts its managed production service", { timeout: 180_000 }, async () => {
  const servicePort = await freePort();
  const managerPort = await freePort();
  const databasePath = path.join(".test-data", `restart-${process.pid}.sqlite`);
  const logDirectory = path.join(".test-data", `restart-logs-${process.pid}`);
  const databaseFiles = [databasePath, `${databasePath}-shm`, `${databasePath}-wal`];
  const output = [];
  const manager = spawn(process.execPath, [path.join(workspace, "scripts", "service-manager.mjs")], {
    cwd: workspace,
    env: {
      ...process.env,
      WRITER_STUDIO_DB_PATH: databasePath,
      WRITER_STUDIO_HOST: "127.0.0.1",
      WRITER_STUDIO_LOG_DIR: logDirectory,
      WRITER_STUDIO_MANAGER_HOST: "127.0.0.1",
      WRITER_STUDIO_MANAGER_PORT: String(managerPort),
      WRITER_STUDIO_PORT: String(servicePort),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const remember = (chunk) => {
    output.push(chunk.toString());
    if (output.length > 100) output.splice(0, output.length - 100);
  };
  manager.stdout.on("data", remember);
  manager.stderr.on("data", remember);

  const appUrl = `http://127.0.0.1:${servicePort}`;
  const managerUrl = `http://127.0.0.1:${managerPort}`;
  try {
    const initial = await waitFor(async () => {
      const response = await fetch(`${appUrl}/api/system/service`, { cache: "no-store" });
      if (!response.ok) return null;
      const status = await response.json();
      return status.service?.state === "running" && status.service?.managed ? status : null;
    }, manager, output);

    const restartResponse = await fetch(`${appUrl}/api/system/service`, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    });
    assert.equal(restartResponse.status, 202);
    const accepted = await restartResponse.json();
    assert.equal(accepted.ok, true);
    assert.equal(accepted.previousStartedAt, initial.service.startedAt);

    const restarted = await waitFor(async () => {
      const response = await fetch(`${appUrl}/api/system/service`, { cache: "no-store" });
      if (!response.ok) return null;
      const status = await response.json();
      return status.service?.state === "running" && status.service?.startedAt !== initial.service.startedAt ? status : null;
    }, manager, output, 150_000);
    assert.equal(restarted.service.managed, true);
    const buildResponse = await fetch(`${appUrl}/api/system/build`, { cache: "no-store" });
    assert.equal(buildResponse.status, 200);
    assert.equal(buildResponse.headers.get("cache-control"), "no-store");
    const build = await buildResponse.json();
    assert.equal(build.target, "local");
    assert.equal(build.sourceHash, await sourceIdentity(workspace));
    assert.ok(Number.isFinite(Date.parse(build.builtAt)));
  } finally {
    await fetch(`${managerUrl}/api/stop`, { method: "POST" }).catch(() => null);
    if (manager.exitCode === null) {
      manager.kill();
      await Promise.race([once(manager, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    await Promise.all(databaseFiles.map((file) => rm(path.join(workspace, file), { force: true })));
    await rm(path.join(workspace, logDirectory), { force: true, recursive: true });
  }
});
