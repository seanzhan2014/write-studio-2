export const OFFLINE_OPERATION_MESSAGE = "当前处于离线模式，此操作需要连接服务端。";

export function browserIsOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function requireBrowserOnline(message = OFFLINE_OPERATION_MESSAGE) {
  if (browserIsOffline()) throw new Error(message);
}

export async function fetchFromServer(input: RequestInfo | URL, init?: RequestInit) {
  requireBrowserOnline();
  try {
    return await globalThis.fetch(input, init);
  } catch (error) {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) throw error;
    if (browserIsOffline()) throw new Error(OFFLINE_OPERATION_MESSAGE);
    if (error instanceof TypeError) throw new Error("无法连接服务端，请稍后重试。", { cause: error });
    throw error;
  }
}

export async function fetchServerAction(input: RequestInfo | URL, init?: RequestInit) {
  // Submit once to the actual endpoint. A separate probe can time out while
  // this request would succeed, and must not prevent the user's operation.
  return fetchFromServer(input, init);
}

export async function readServerJson<T>(response: Response, failureMessage: string): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(response.ok
      ? `${failureMessage}：服务端返回了无效响应，请刷新后重试。`
      : `${failureMessage}（HTTP ${response.status}），请稍后重试。`);
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" ? payload as { message?: unknown; error?: unknown } : {};
    throw new Error(typeof detail.message === "string" && detail.message
      ? detail.message
      : typeof detail.error === "string" && detail.error ? detail.error : `${failureMessage}（HTTP ${response.status}）`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`${failureMessage}：服务端返回了无效响应，请刷新后重试。`);
  return payload as T;
}
