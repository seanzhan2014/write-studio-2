import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ServiceController } from "../scripts/service-manager-core.mjs";

const workspace = fileURLToPath(new URL("..", import.meta.url));

test("Vite keeps the application on its requested port", async () => {
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  const launcher = await readFile(new URL("../scripts/dev-server.mjs", import.meta.url), "utf8");
  assert.match(config, /strictPort:\s*true/);
  assert.match(launcher, /portIsAvailable/);
  assert.match(launcher, /PORT_DRIFT_BLOCKED/);
  assert.match(launcher, /will not move to another port/);
});

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(predicate, timeoutMs = 6000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for service-manager state");
}

test("service controller starts, monitors, stops, and restarts its child", async () => {
  const servicePort = await freePort();
  const fakeService = "import http from 'node:http'; const server = http.createServer((request, response) => response.end('ok')); server.listen(Number(process.env.WRITER_STUDIO_PORT), '127.0.0.1'); setInterval(() => {}, 1000);";
  const controller = new ServiceController({
    servicePort,
    serviceHost: "127.0.0.1",
    probeHost: "127.0.0.1",
    managerPort: 0,
    managerHost: "127.0.0.1",
    command: process.execPath,
    args: ["--input-type=module", "-e", fakeService],
    stdio: "ignore",
  });

  const start = await controller.start();
  assert.equal(start.ok, true);
  await waitFor(async () => (await controller.status()).service.state === "running");

  const firstPid = (await controller.status()).service.pid;
  const stop = await controller.stop();
  assert.equal(stop.ok, true);
  await waitFor(async () => (await controller.status()).service.state === "stopped");

  const restart = await controller.restart();
  assert.equal(restart.ok, true);
  await waitFor(async () => (await controller.status()).service.state === "running");
  const secondPid = (await controller.status()).service.pid;
  assert.notEqual(secondPid, firstPid);

  await controller.stop();
  await waitFor(async () => (await controller.status()).service.state === "stopped");
});

test("service controller runs the production build with local SQLite", async () => {
  const servicePort = await freePort();
  const databasePath = path.join(".test-data", `service-manager-${process.pid}.sqlite`);
  const databaseFiles = [databasePath, `${databasePath}-shm`, `${databasePath}-wal`];
  const removeDatabase = () => Promise.all(databaseFiles.map((file) => rm(path.join(workspace, file), { force: true })));
  await removeDatabase();

  const controller = new ServiceController({
    workspace,
    servicePort,
    serviceHost: "127.0.0.1",
    probeHost: "127.0.0.1",
    managerPort: 0,
    managerHost: "127.0.0.1",
    env: {
      WRITER_STUDIO_RUNTIME_MODE: "production",
      WRITER_STUDIO_DB_PATH: databasePath,
    },
    stdio: "ignore",
  });

  try {
    const start = await controller.start();
    assert.equal(start.ok, true);
    await waitFor(async () => (await controller.status()).service.state === "running", 15_000);
    const response = await fetch(`http://127.0.0.1:${servicePort}/api/database/status`);
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.engine, "SQLite");
  } finally {
    await controller.stop();
    await removeDatabase();
  }
});
