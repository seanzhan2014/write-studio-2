import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";
import { ServiceController } from "../scripts/service-manager-core.mjs";

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
