export const OFFLINE_OPERATION_MESSAGE = "当前处于离线模式，此操作需要连接服务端。";
const connectivityTimeoutMs = 1_200;
const unavailableMemoryMs = 2_000;
let serverUnavailableUntil = 0;

export function browserIsOffline() {
  return (typeof navigator !== "undefined" && navigator.onLine === false) || Date.now() < serverUnavailableUntil;
}

export function requireBrowserOnline(message = OFFLINE_OPERATION_MESSAGE) {
  if (browserIsOffline()) throw new Error(message);
}

export async function fetchFromServer(input: RequestInfo | URL, init?: RequestInit) {
  requireBrowserOnline();
  try {
    const response = await globalThis.fetch(input, init);
    serverUnavailableUntil = 0;
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError" && init?.signal?.aborted) throw error;
    serverUnavailableUntil = Date.now() + unavailableMemoryMs;
    if (error instanceof TypeError || browserIsOffline()) throw new Error(OFFLINE_OPERATION_MESSAGE);
    throw error;
  }
}

export async function fetchServerAction(input: RequestInfo | URL, init?: RequestInit) {
  requireBrowserOnline();
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), connectivityTimeoutMs);
  try {
    const connectivity = await globalThis.fetch("/api/connectivity", {
      cache: "no-store",
      headers: { "X-Writer-Studio-Connectivity": "1" },
      signal: controller.signal,
    });
    if (!connectivity.ok) throw new Error("服务端连接检查失败");
    serverUnavailableUntil = 0;
  } catch {
    serverUnavailableUntil = Date.now() + unavailableMemoryMs;
    throw new Error(OFFLINE_OPERATION_MESSAGE);
  } finally {
    globalThis.clearTimeout(timeout);
  }
  return fetchFromServer(input, init);
}
