const DEFAULT_MANAGER_PORT = 3003;
const DEFAULT_TIMEOUT_MS = 2500;

export class ServiceManagerRequestError extends Error {
  constructor(message, { code = "MANAGER_UNAVAILABLE", status = 503 } = {}) {
    super(message);
    this.name = "ServiceManagerRequestError";
    this.code = code;
    this.status = status;
  }
}

export function resolveServiceManagerUrl(env = process.env) {
  const configuredUrl = env.WRITER_STUDIO_MANAGER_API_URL?.trim();
  const rawPort = env.WRITER_STUDIO_MANAGER_PORT?.trim() || String(DEFAULT_MANAGER_PORT);
  const port = Number(rawPort);
  if (!configuredUrl && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new ServiceManagerRequestError("服务管理端口配置无效", { code: "MANAGER_CONFIG_INVALID", status: 500 });
  }

  let url;
  try {
    url = new URL(configuredUrl || `http://127.0.0.1:${port}/`);
  } catch {
    throw new ServiceManagerRequestError("服务管理地址配置无效", { code: "MANAGER_CONFIG_INVALID", status: 500 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ServiceManagerRequestError("服务管理地址只支持 HTTP 或 HTTPS", { code: "MANAGER_CONFIG_INVALID", status: 500 });
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    throw new ServiceManagerRequestError("服务管理器返回了无法识别的响应", { code: "MANAGER_RESPONSE_INVALID", status: 502 });
  }
}

async function callServiceManager(pathname, init, {
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL(pathname, resolveServiceManagerUrl(env)), {
      ...init,
      cache: "no-store",
      headers: { accept: "application/json", ...init?.headers },
      signal: controller.signal,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new ServiceManagerRequestError(payload.message || payload.error || "服务管理操作失败", {
        code: payload.code || "MANAGER_REQUEST_FAILED",
        status: response.status,
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof ServiceManagerRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ServiceManagerRequestError("连接服务管理器超时", { code: "MANAGER_TIMEOUT", status: 504 });
    }
    throw new ServiceManagerRequestError("无法连接 3003 服务管理器，请确认 Writer Studio 由服务管理器启动");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getManagedServiceStatus(options) {
  const payload = await callServiceManager("api/status", { method: "GET" }, options);
  if (!payload?.service || typeof payload.service.managed !== "boolean" || typeof payload.service.state !== "string") {
    throw new ServiceManagerRequestError("服务管理器状态响应不完整", { code: "MANAGER_RESPONSE_INVALID", status: 502 });
  }
  return payload;
}

export async function restartManagedService(options) {
  const payload = await callServiceManager("api/restart", { method: "POST" }, options);
  if (payload?.ok !== true) {
    throw new ServiceManagerRequestError(payload?.message || "服务端重启未被接受", {
      code: payload?.code || "RESTART_REJECTED",
      status: 409,
    });
  }
  return payload;
}
