import "./load-service-config.mjs";
import { appendFile, mkdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { ServiceController, DEFAULT_MANAGER_PORT, DEFAULT_SERVICE_PORT } from "./service-manager-core.mjs";
import { managerPage } from "./service-manager-ui.mjs";

const workspace = process.cwd();
const managerHost = process.env.WRITER_STUDIO_MANAGER_HOST ?? "0.0.0.0";
const managerPort = Number(process.env.WRITER_STUDIO_MANAGER_PORT ?? DEFAULT_MANAGER_PORT);
const serviceHost = process.env.WRITER_STUDIO_HOST ?? "0.0.0.0";
const servicePort = Number(process.env.WRITER_STUDIO_PORT ?? DEFAULT_SERVICE_PORT);
const serviceMode = process.env.WRITER_STUDIO_SERVICE_MODE === "development" ? "development" : "production";
const logDirectory = path.resolve(workspace, process.env.WRITER_STUDIO_LOG_DIR ?? "logs");
const managerLog = path.join(logDirectory, "service-manager.log");

for (const [name, port] of [["WRITER_STUDIO_MANAGER_PORT", managerPort], ["WRITER_STUDIO_PORT", servicePort]]) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${name}=${port}`);
  }
}

if (managerPort === servicePort) {
  throw new Error(`管理端口 ${managerPort} 不能与主服务端口相同`);
}

await mkdir(logDirectory, { recursive: true });

function timestamp() {
  return new Date().toISOString();
}

async function log(message) {
  const line = `[${timestamp()}] ${message}\n`;
  process.stdout.write(line);
  await appendFile(managerLog, line, "utf8").catch(() => {});
}

const controller = new ServiceController({
  workspace,
  serviceHost,
  servicePort,
  managerHost,
  managerPort,
  env: { WRITER_STUDIO_RUNTIME_MODE: serviceMode },
  onLog: (message) => void log(message),
});

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function isAllowedMethod(request, method) {
  return request.method === method;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${managerHost}:${managerPort}`}`);

  if (url.pathname === "/" && isAllowedMethod(request, "GET")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(managerPage());
    return;
  }

  if (url.pathname === "/healthz" && isAllowedMethod(request, "GET")) {
    json(response, 200, { ok: true, service: "writer-studio-manager" });
    return;
  }

  if (url.pathname === "/api/status" && isAllowedMethod(request, "GET")) {
    json(response, 200, await controller.status());
    return;
  }

  const action = url.pathname.match(/^\/api\/(start|stop|restart)$/)?.[1];
  if (action && isAllowedMethod(request, "POST")) {
    const result = await controller[action]();
    json(response, result.ok ? 200 : 409, result);
    return;
  }

  json(response, 404, { ok: false, error: "Not found" });
});

server.on("error", (error) => {
  void log(`manager error: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});

server.listen(managerPort, managerHost, async () => {
  await log(`START manager pid=${process.pid} host=${managerHost} port=${managerPort} service=${serviceHost}:${servicePort} mode=${serviceMode}`);
  if (process.env.WRITER_STUDIO_MANAGER_AUTOSTART !== "0") {
    await controller.start();
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  await log(`Received ${signal}; stopping managed ${servicePort} service`);
  await controller.stop();
  await new Promise((resolve) => server.close(resolve));
  await log("STOP manager");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
