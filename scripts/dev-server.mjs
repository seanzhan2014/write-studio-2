import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { spawn } from "node:child_process";

const workspace = process.cwd();
const host = process.env.WRITER_STUDIO_HOST ?? "0.0.0.0";
const port = process.env.WRITER_STUDIO_PORT ?? "3002";
const logDirectory = path.join(workspace, "logs");
const vinextCli = path.join(workspace, "node_modules", "vinext", "dist", "cli.js");
const retentionMs = 30 * 24 * 60 * 60 * 1000;

await mkdir(logDirectory, { recursive: true });
const removedLogCount = await removeExpiredLogs();

function timestamp() {
  return new Date().toISOString();
}

async function removeExpiredLogs() {
  const entries = await readdir(logDirectory, { withFileTypes: true });
  let removed = 0;
  const logName = new RegExp(`^dev-${port}-(?:service|access)-\\d{4}-\\d{2}-\\d{2}\\.log$`);

  for (const entry of entries) {
    if (!entry.isFile() || !logName.test(entry.name)) continue;
    const filePath = path.join(logDirectory, entry.name);
    const details = await stat(filePath);
    if (Date.now() - details.mtimeMs > retentionMs) {
      await unlink(filePath);
      removed += 1;
    }
  }
  return removed;
}

class DailyLogger {
  constructor(prefix) {
    this.prefix = prefix;
    this.pending = Promise.resolve();
  }

  write(source, message) {
    const text = String(message).replace(/\r?\n$/, "");
    const line = `[${timestamp()}] [${source}] ${text}\n`;
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filePath = path.join(logDirectory, `${this.prefix}-${dateStamp}.log`);
    this.pending = this.pending
      .then(() => appendFile(filePath, line, "utf8"))
      .catch((error) => {
        process.stderr.write(`[${timestamp()}] [logging-error] ${error.stack ?? error.message}\n`);
      });
  }

  flush() {
    return this.pending;
  }
}

const serviceLogger = new DailyLogger(`dev-${port}-service`);
const accessLogger = new DailyLogger(`dev-${port}-access`);

const ansiEscape = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const accessLine = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+\S+\s+\d{3}(?:\s|$)/;

function writeOutput(source, line) {
  if (source === "stdout" && accessLine.test(line.replace(ansiEscape, "").trimStart())) {
    accessLogger.write("access", line);
    return;
  }
  serviceLogger.write(source, line);
}

function connectOutput(source, input, output) {
  let pending = "";

  return new Promise((resolve) => {
    input.on("data", (chunk) => {
      const text = pending + chunk.toString();
      const lines = text.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) writeOutput(source, line);
      output.write(chunk);
    });

    input.on("end", () => {
      if (pending) writeOutput(source, pending);
      resolve();
    });
  });
}

serviceLogger.write(
  "lifecycle",
  `START pid=${process.pid} host=${host} port=${port} retentionDays=30 removedLogs=${removedLogCount}`,
);
serviceLogger.write("lifecycle", `Launching Vinext cli=${vinextCli}`);

const cleanupTimer = setInterval(() => {
  removeExpiredLogs()
    .then((removed) => {
      if (removed > 0) serviceLogger.write("retention", `Removed expiredLogs=${removed}`);
    })
    .catch((error) => serviceLogger.write("error", `Log cleanup failed: ${error.stack ?? error.message}`));
}, 60 * 60 * 1000);

const child = spawn(process.execPath, [vinextCli, "dev", "--hostname", host, "--port", port], {
  cwd: workspace,
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

serviceLogger.write("lifecycle", `Child process started pid=${child.pid ?? "unknown"}`);
const outputDone = [
  connectOutput("stdout", child.stdout, process.stdout),
  connectOutput("stderr", child.stderr, process.stderr),
];

let stopping = false;
function forwardSignal(signal) {
  if (stopping) return;
  stopping = true;
  serviceLogger.write("lifecycle", `Received ${signal}; forwarding to child pid=${child.pid ?? "unknown"}`);
  child.kill(signal);
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("error", (error) => {
  serviceLogger.write("error", `Unable to start child: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});

const [code, signal] = await once(child, "exit");
await Promise.all(outputDone);
clearInterval(cleanupTimer);
serviceLogger.write("lifecycle", `Child exited code=${code ?? "null"} signal=${signal ?? "null"}`);
await Promise.all([serviceLogger.flush(), accessLogger.flush()]);
process.exitCode = typeof code === "number" ? code : 1;
