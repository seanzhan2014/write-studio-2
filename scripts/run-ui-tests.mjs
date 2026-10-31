import { removeTestDirectory, freePort, waitForServer, stopServer } from "./test-server.mjs";
import { once } from "node:events";

import path from "node:path";
import { spawn } from "node:child_process";

const workspace = process.cwd();
const viteCli = path.join(workspace, "node_modules", "vite", "bin", "vite.js");
const playwrightCli = path.join(workspace, "node_modules", "@playwright", "test", "cli.js");
const testDirectory = path.join(".test-data", `playwright-${process.pid}`);
const testDatabase = path.join(testDirectory, "studio.sqlite");
const production = process.env.WRITER_STUDIO_UI_SERVER === "production";

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const output = [];
await removeTestDirectory(workspace, testDirectory);
const server = spawn(process.execPath, production ? ["scripts/prod-server.mjs"] : [viteCli, "--host", "127.0.0.1", "--port", String(port)], {
  cwd: workspace,
  env: {
    ...process.env,
    WRITER_STUDIO_DB_PATH: testDatabase,
    WRITER_STUDIO_TEST_MODE: "1",
    VINEXT_NO_DEV_LOCK: "1",
    WRITER_STUDIO_HOST: "127.0.0.1",
    WRITER_STUDIO_PORT: String(port),
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
  if (Number(exitCode ?? 1) !== 0 && output.length) process.stderr.write(`\nUI test server output:\n${output.join("")}\n`);
} finally {
  await stopServer(server);
  await removeTestDirectory(workspace, testDirectory);
}

process.exitCode = Number(exitCode ?? 1);
