import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { freePort, waitForServer, stopServer, removeTestDirectory } from "../scripts/test-server.mjs";

test("a running production server can lazily load cancellation after dist is replaced", { timeout: 30000 }, async () => {
  const workspace = process.cwd();
  await mkdir(path.join(workspace, ".test-data"), { recursive: true });
  const fixture = await mkdtemp(path.join(workspace, ".test-data", "production-runtime-"));
  const outputDirectory = path.join(fixture, "dist");
  await mkdir(path.join(outputDirectory, "server"), { recursive: true });
  await mkdir(path.join(outputDirectory, "client"), { recursive: true });
  await writeFile(path.join(outputDirectory, "server", "index.js"), `export default { async fetch(request) {
    if (new URL(request.url).pathname.endsWith('/state')) return (await import('./cancel.js')).cancel();
    return Response.json({ ok: true });
  } };`);
  await writeFile(path.join(outputDirectory, "server", "cancel.js"), "export const cancel = () => Response.json({ task: { state: 'cancelled' }, revision: 42 });");
  await writeFile(path.join(outputDirectory, "client", "build.txt"), "original build");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, [path.join(workspace, "scripts", "prod-server.mjs")], {
    cwd: fixture,
    env: { ...process.env, WRITER_STUDIO_PORT: String(port), WRITER_STUDIO_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child.stdout.on("data", chunk => logs.push(String(chunk)));
  child.stderr.on("data", chunk => logs.push(String(chunk)));
  try {
    await waitForServer(base, child, logs, 10000);
    // Simulate both the empty-build window and the new build's different chunks.
    assert.equal(path.dirname(outputDirectory), fixture);
    await rm(outputDirectory, { recursive: true, force: true });
    const cancel = async () => {
      const response = await fetch(`${base}/api/ai/tasks/test/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      assert.equal(response.status, 200, logs.join(""));
      assert.deepEqual(await response.json(), { task: { state: "cancelled" }, revision: 42 });
      assert.equal(await (await fetch(`${base}/build.txt`)).text(), "original build");
    };
    await cancel();
    await mkdir(path.join(outputDirectory, "client"), { recursive: true });
    await writeFile(path.join(outputDirectory, "client", "build.txt"), "replacement build");
    await cancel();
  } finally {
    await stopServer(child);
    await removeTestDirectory(workspace, path.relative(workspace, fixture));
  }
});
