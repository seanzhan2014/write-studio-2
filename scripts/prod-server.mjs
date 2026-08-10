import path from "node:path";
import { access } from "node:fs/promises";
import { startProdServer } from "vinext/server/prod-server";

const workspace = process.cwd();
const host = process.env.WRITER_STUDIO_HOST ?? "0.0.0.0";
const rawPort = process.env.WRITER_STUDIO_PORT ?? process.env.PORT ?? "3002";
const port = Number(rawPort);
const outputDirectory = path.join(workspace, "dist");
const serverEntry = path.join(outputDirectory, "server", "index.js");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid WRITER_STUDIO_PORT=${rawPort}`);
}

try {
  await access(serverEntry);
} catch {
  throw new Error("Production build is missing. Run `npm run build` before `npm start` or `npm run service`.");
}

const { server } = await startProdServer({ host, port, outDir: outputDirectory });

server.on("request", (request, response) => {
  const startedAt = Date.now();
  response.once("finish", () => {
    process.stdout.write(`${request.method ?? "GET"} ${request.url ?? "/"} ${response.statusCode} ${Date.now() - startedAt}ms\n`);
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`Received ${signal}; closing production server\n`);
  const forceTimer = setTimeout(() => process.exit(1), 10_000);
  forceTimer.unref();
  await new Promise((resolve) => server.close(resolve));
  clearTimeout(forceTimer);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
