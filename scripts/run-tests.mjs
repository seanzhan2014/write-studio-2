import { once } from "node:events";
import { readdir, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const workspace = process.cwd();
const testDatabase = path.join(".test-data", `node-${process.pid}.sqlite`);

async function removeTestDatabase() {
  await Promise.all([testDatabase, `${testDatabase}-shm`, `${testDatabase}-wal`].map((file) => rm(path.join(workspace, file), { force: true })));
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForServer(baseUrl, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`隔离测试服务提前退出：\n${output.join("")}`);
    try {
      const response = await fetch(`${baseUrl}/api/database/status`);
      if (response.ok) return;
    } catch { /* The server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`隔离测试服务启动超时：\n${output.join("")}`);
}

async function stopTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    child.kill();
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
  } else {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = [];
await removeTestDatabase();
const child = spawn(process.execPath, [
  path.join(workspace, "node_modules", "vinext", "dist", "cli.js"),
  "dev", "--hostname", "127.0.0.1", "--port", String(port),
], {
  cwd: workspace,
  env: {
    ...process.env,
    WRITER_STUDIO_DB_PATH: testDatabase,
    WRITER_STUDIO_TEST_MODE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

let exitCode = 1;
try {
  await waitForServer(baseUrl, child, output);
  const files = (await readdir(path.join(workspace, "tests")))
    .filter((file) => file.endsWith(".test.mjs"))
    .map((file) => path.join("tests", file));
  const runner = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
    cwd: workspace,
    env: { ...process.env, WRITER_STUDIO_TEST_BASE_URL: baseUrl },
    stdio: "inherit",
  });
  [exitCode] = await once(runner, "exit");
} finally {
  await stopTree(child);
  await removeTestDatabase();
}
process.exitCode = Number(exitCode ?? 1);
