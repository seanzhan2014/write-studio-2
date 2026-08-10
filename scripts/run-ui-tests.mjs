import { once } from "node:events";
import { rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const workspace = process.cwd();
const vinextCli = path.join(workspace, "node_modules", "vinext", "dist", "cli.js");
const playwrightCli = path.join(workspace, "node_modules", "@playwright", "test", "cli.js");
const testDatabase = path.join(".test-data", `playwright-${process.pid}.sqlite`);

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
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`隔离 UI 测试服务提前退出：\n${output.join("")}`);
    try {
      const response = await fetch(`${baseUrl}/api/database/status`);
      if (response.ok) return;
    } catch { /* The server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`隔离 UI 测试服务启动超时：\n${output.join("")}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill(process.platform === "win32" ? undefined : "SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = [];
await removeTestDatabase();
const server = spawn(process.execPath, [vinextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: workspace,
  env: {
    ...process.env,
    WRITER_STUDIO_DB_PATH: testDatabase,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const rememberOutput = (chunk) => {
  output.push(chunk.toString());
  if (output.length > 200) output.splice(0, output.length - 200);
};
server.stdout.on("data", rememberOutput);
server.stderr.on("data", rememberOutput);

let exitCode = 1;
try {
  await waitForServer(baseUrl, server, output);
  const runner = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
    cwd: workspace,
    env: { ...process.env, WRITER_STUDIO_UI_BASE_URL: baseUrl },
    stdio: "inherit",
  });
  [exitCode] = await once(runner, "exit");
} finally {
  await stopServer(server);
  await removeTestDatabase();
}

process.exitCode = Number(exitCode ?? 1);
