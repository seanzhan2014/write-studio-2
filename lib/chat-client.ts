import { fetchFromServer } from "@/lib/browser-network";

type PendingChat = { id: string; url: string; body: Record<string, unknown>; queuedAt: number };
const key = "writer-studio.pending-chat-completions.v1";
let draining = false;

function pending(): PendingChat[] {
  try {
    const entries = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry.id === "string" && typeof entry.url === "string" && entry.body?.taskId) : [];
  } catch { return []; }
}

function forget(id: string) {
  try { localStorage.setItem(key, JSON.stringify(pending().filter((entry) => entry.id !== id))); } catch { /* Server idempotency still prevents duplicate replies. */ }
}

async function deliver(entry: PendingChat) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchFromServer(entry.url, { method: "POST", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry.body) });
    const body = await response.arrayBuffer();
    // A restored/replaced database may no longer contain this task. Never turn
    // an acknowledgement retry into another generation request.
    if (response.ok || response.status >= 400 && response.status < 500 && response.status !== 429) forget(entry.id);
    return new Response(body, { status: response.status, headers: response.headers });
  } finally { clearTimeout(timer); }
}

export async function sendChatCompletion(url: string, body: Record<string, unknown>) {
  const entry = { id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, url, body, queuedAt: Date.now() };
  // Persist before sending: a committed transaction whose response was lost is
  // safe to replay because the server uses one immutable reply ID per task.
  try { localStorage.setItem(key, JSON.stringify([...pending().filter((item) => item.body.taskId !== body.taskId), entry])); } catch { /* A full browser cache must not block an online stop/save. */ }
  return deliver(entry);
}

export async function drainChatCompletions() {
  if (draining || typeof localStorage === "undefined") return false;
  draining = true;
  let changed = false;
  try {
    for (const entry of pending()) {
      try { if ((await deliver(entry)).ok) changed = true; } catch { break; }
    }
  } finally { draining = false; }
  return changed;
}
