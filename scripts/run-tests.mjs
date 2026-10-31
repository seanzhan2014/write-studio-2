import { removeTestDirectory, freePort, waitForServer, stopServer } from "./test-server.mjs";
import { once } from "node:events";
import { readdir } from "node:fs/promises";

import path from "node:path";
import { spawn } from "node:child_process";

const workspace = process.cwd();
const testDirectory = path.join(".test-data", `node-${process.pid}`);
const testDatabase = path.join(testDirectory, "studio.sqlite");

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = [];
await removeTestDirectory(workspace, testDirectory);
const child = spawn(process.execPath, [
  path.join(workspace, "node_modules", "vite", "bin", "vite.js"),
  "--host", "127.0.0.1", "--port", String(port),
], {
  cwd: workspace,
  env: {
    ...process.env,
    WRITER_STUDIO_DB_PATH: testDatabase,
    WRITER_STUDIO_TEST_MODE: "1",
    VINEXT_NO_DEV_LOCK: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

let exitCode = 1;
try {
  await waitForServer(baseUrl, child, output, 30_000);
  const requestedFiles = process.argv.slice(2);
  const availableFiles = (await readdir(path.join(workspace, "tests"))).filter((file) => file.endsWith(".test.mjs"));
  for (const file of requestedFiles) {
    if (!availableFiles.includes(file)) throw new Error(`Unknown test file: ${file}`);
  }
  const files = availableFiles
    .filter((file) => !requestedFiles.length || requestedFiles.includes(file))
    .map((file) => path.join("tests", file));
  const runner = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
    cwd: workspace,
    env: { ...process.env, WRITER_STUDIO_TEST_BASE_URL: baseUrl, WRITER_STUDIO_TEST_DB_PATH: path.join(workspace, testDatabase) },
    stdio: "inherit",
  });
  [exitCode] = await once(runner, "exit");
} finally {
  if (Number(exitCode ?? 1) !== 0 && output.length) process.stderr.write(`\nAPI test server output:\n${output.join("")}\n`);
  await stopServer(child);
  await removeTestDirectory(workspace, testDirectory);
}
process.exitCode = Number(exitCode ?? 1);
