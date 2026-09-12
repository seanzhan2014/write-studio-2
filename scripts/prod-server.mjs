import "./load-service-config.mjs";
import path from "node:path";
import { access } from "node:fs/promises";
import { startProdServer, tryServeStatic } from "vinext/server/prod-server";

const workspace = process.cwd();
const host = process.env.WRITER_STUDIO_HOST ?? "0.0.0.0";
const rawPort = process.env.WRITER_STUDIO_PORT ?? process.env.PORT ?? "3002";
const port = Number(rawPort);
const outputDirectory = path.join(workspace, "dist");
const clientDirectory = path.join(outputDirectory, "client");
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
// Initialize durable review recovery even before a browser reconnects.
const recoveryHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "[::1]" : host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
void fetch(`http://${recoveryHost}:${port}/api/database/status`).catch((error) => console.error("Review recovery initialization failed", error));

// Vinext 0.0.50 builds its production static-file cache with Windows path
// separators, while HTTP asset paths always use forward slashes. Serve files
// directly from dist/client on Windows until the upstream cache is normalized.
if (process.platform === "win32") {
  const vinextRequestListeners = server.listeners("request");
  server.removeAllListeners("request");

  server.on("request", (request, response) => {
    const dispatchToVinext = () => {
      for (const listener of vinextRequestListeners) listener.call(server, request, response);
    };

    void (async () => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        dispatchToVinext();
        return;
      }

      let pathname;
      try {
        pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      } catch {
        dispatchToVinext();
        return;
      }

      if (await tryServeStatic(request, response, clientDirectory, pathname, true)) return;
      dispatchToVinext();
    })().catch((error) => {
      if (!response.headersSent) {
        response.writeHead(500);
        response.end("Internal Server Error");
      } else {
        response.destroy(error);
      }
    });
  });
}

server.on("request", (request, response) => {
  const startedAt = Date.now();
  response.once("finish", () => {
    process.stdout.write(`${request.method ?? "GET"} ${request.url ?? "/"} ${response.statusCode} ${Date.now() - startedAt}ms\n`);
  });
  response.once("close", () => {
    if (!response.writableFinished) process.stdout.write(JSON.stringify({ event: "http_disconnected", method: request.method, path: request.url?.split("?")[0], elapsedMs: Date.now() - startedAt }) + "\n");
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
