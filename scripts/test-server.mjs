import { once } from "node:events";
import { rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export async function removeTestDirectory(workspace, testDirectory) {
  const directory = path.resolve(workspace, testDirectory);
  if (path.dirname(directory) !== path.resolve(workspace, ".test-data")) throw new Error("Unsafe test directory");
  await rm(directory, { recursive: true, force: true });
}

export async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

export async function waitForServer(baseUrl, child, output, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`隔离测试服务提前退出：\n${output.join("")}`);
    try { if ((await fetch(`${baseUrl}/api/database/status`)).ok) return; }
    catch { /* The isolated server is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`隔离测试服务启动超时：\n${output.join("")}`);
}

export async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill(process.platform === "win32" ? undefined : "SIGTERM");
  await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 3000))]);
}
