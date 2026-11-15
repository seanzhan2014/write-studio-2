import { taskFromRow } from "@/lib/task-record";

import { taskReasoningEffort } from "@/lib/reasoning-options";
import type { AiTask, Message } from "@/lib/studio-types";
import { streamChat } from "@/db/ai-chat";
import { ensureDatabase, getDatabase } from "@/db/studio-state";
import { currentTaskExecutionOrigin } from "@/db/task-execution";

type Row = Record<string, unknown>;
type Completion = { status: "success" | "error" | "cancelled"; result: string; error?: string; runnerId?: string; leaseUntil?: string | null };
const leaseMs = 30_000;
const replyId = (id: string) => `chat-reply:${id}`;
export const chatLog = (event: string, taskId: string, detail: Record<string, unknown> = {}) => console.info(JSON.stringify({ event: `chat_${event}`, taskId, ...detail }));

export async function readChatTask(taskId: string) {
  await ensureDatabase();
  return getDatabase().prepare("SELECT * FROM ai_tasks WHERE id=? AND target='chat'").bind(taskId).first<Row>();
}

export function chatOptions(row: Row): NonNullable<AiTask["contextOptions"]> {
  return JSON.parse(String(row.context_options_json ?? "{}"));
}

export async function chatSnapshot(row: Row) {
  const db = getDatabase();
  const sessionId = chatOptions(row).sessionId ?? "";
  const messageRow = await db.prepare("SELECT * FROM chat_messages WHERE id=? AND session_id=?").bind(replyId(String(row.id)), sessionId).first<Row>();
  const message: Message | undefined = messageRow ? { id: String(messageRow.id), role: "assistant", text: String(messageRow.content), createdAt: String(messageRow.created_at), stopped: messageRow.status === "stopped" || undefined } : undefined;
  const task: AiTask = { ...taskFromRow(row), contextOptions: chatOptions(row) };
  return { task, message, sessionUpdatedAt: row.completed_at ? String(row.completed_at) : undefined, revision: Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0) };
}

// All effects use the same running-task predicate inside one database transaction.
// A competing cancellation, expiry or duplicate completion can never add a reply
// or overwrite a terminal state. The reply identity is stable across retries.
export async function completeChatTask(row: Row, completion: Completion) {
  const db = getDatabase();
  const id = String(row.id);
  const sessionId = chatOptions(row).sessionId ?? "";
  const now = new Date().toISOString();
  let predicate = "id=? AND target='chat' AND status IN ('queued','running') AND execution_origin=?";
  const args: unknown[] = [id, currentTaskExecutionOrigin()];
  if (completion.runnerId !== undefined) { predicate += " AND runner_id=?"; args.push(completion.runnerId); }
  if (completion.leaseUntil !== undefined) { predicate += " AND lease_until IS ?"; args.push(completion.leaseUntil); }
  const active = `EXISTS(SELECT 1 FROM ai_tasks WHERE ${predicate})`;
  const result = completion.result;
  const error = completion.error?.slice(0, 5000) ?? "";
  const text = result || (completion.status === "error" ? `AI 错误：${error || "聊天已中断，请重新发送"}` : "");
  const statements = [];
  if (text) statements.push(db.prepare(`INSERT INTO chat_messages(id,session_id,role,content,status,order_index,created_at)
    SELECT ?,?,'assistant',?,?,(SELECT COALESCE(MAX(order_index),-1)+1 FROM chat_messages WHERE session_id=?),?
    WHERE ${active} AND EXISTS(SELECT 1 FROM chat_sessions WHERE id=? AND outline_id=?) ON CONFLICT(id) DO NOTHING`)
    .bind(replyId(id), sessionId, text, completion.status === "success" ? "complete" : "stopped", sessionId, now, ...args, sessionId, row.outline_id));
  statements.push(db.prepare(`UPDATE chat_sessions SET updated_at=?,revision=revision+1 WHERE id=? AND ${active}`).bind(now, sessionId, ...args));
  statements.push(db.prepare(`UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key IN ('state_revision','database_version') AND ${active}`).bind(now, ...args));
  statements.push(db.prepare(`UPDATE ai_tasks SET status=?,phase=?,completed_at=?,last_progress_at=?,received_characters=?,result_text=?,error_message=?,runner_id=NULL,lease_until=NULL WHERE ${predicate}`)
    .bind(completion.status, completion.status === "success" ? "completed" : completion.status === "error" ? "failed" : "cancelled", now, now, result.length, result || null, error || null, ...args));
  const results = await db.batch(statements);
  if (Number(results.at(-1)?.meta?.changes ?? 0)) chatLog("finished", id, { status: completion.status, characters: result.length, reason: error.includes("超时") ? "timeout" : error.includes("中断") ? "interrupted" : completion.status === "error" ? "execution_error" : undefined });
  return (await readChatTask(id))!;
}

// Run before returning task/state snapshots, including the first read after a
// restart. A missing stream claim, expired worker lease and old pre-fix tasks
// all converge to a durable terminal state without a browser callback.
export async function recoverChatTasks() {
  await ensureDatabase();
  const rows = await getDatabase().prepare("SELECT * FROM ai_tasks WHERE target='chat' AND status IN ('queued','running') AND execution_origin=?")
    .bind(currentTaskExecutionOrigin()).all<Row>();
  for (const row of rows.results ?? []) {
    const deadline = Date.parse(String(row.started_at ?? row.created_at)) + Number(row.timeout_ms ?? 600_000);
    const expired = Date.now() > deadline + 15_000;
    const abandoned = row.lease_until && Date.parse(String(row.lease_until)) < Date.now();
    if (!expired && !abandoned) continue;
    await completeChatTask(row, { status: "error", result: String(row.result_text ?? ""), error: expired ? "聊天请求超时，请重新发送" : "聊天执行已中断，请重新发送", runnerId: row.runner_id ? String(row.runner_id) : undefined, leaseUntil: row.lease_until ? String(row.lease_until) : null });
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error(signal.reason === "timeout" ? "聊天请求超时，请重新发送" : "聊天已取消"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function managedChatStream(row: Row) {
  const id = String(row.id);
  const db = getDatabase();
  const runnerId = `server-chat-${crypto.randomUUID()}`;
  const options = { ...chatOptions(row), serverManaged: true };
  const claim = await db.prepare("UPDATE ai_tasks SET runner_id=?,lease_until=?,context_options_json=? WHERE id=? AND status='running' AND execution_origin=? AND runner_id=?")
    .bind(runnerId, new Date(Date.now() + leaseMs).toISOString(), JSON.stringify(options), id, currentTaskExecutionOrigin(), `chat-${id}`).run();
  if (!Number(claim.meta?.changes ?? 0)) throw new Error("聊天任务已开始或已结束，请刷新查看结果");
  chatLog("started", id, { model: row.model_id, timeoutMs: row.timeout_ms });
  const controller = new AbortController();
  let detached = false;
  let result = "";
  let phase: AiTask["phase"] = "connecting";
  let lastSaved = "";
  let lastPhase: AiTask["phase"] = phase;
  let persistChain: Promise<unknown> = Promise.resolve();
  const persist = () => {
    persistChain = persistChain.catch(() => undefined).then(async () => {
      const changed = result !== lastSaved || phase !== lastPhase;
      const now = new Date().toISOString();
      const savedResult = result;
      const savedPhase = phase;
      const updates = await db.batch([
        db.prepare("UPDATE ai_tasks SET lease_until=?,phase=?,result_text=?,received_characters=?,last_progress_at=CASE WHEN ? THEN ? ELSE last_progress_at END WHERE id=? AND status='running' AND runner_id=?")
          .bind(new Date(Date.now() + leaseMs).toISOString(), savedPhase, savedResult || null, savedResult.length, changed ? 1 : 0, now, id, runnerId),
        db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key IN ('state_revision','database_version') AND ? AND EXISTS(SELECT 1 FROM ai_tasks WHERE id=? AND status='running' AND runner_id=?)")
          .bind(now, changed ? 1 : 0, id, runnerId),
      ]);
      if (!Number(updates[0].meta?.changes ?? 0)) controller.abort("cancelled");
      else { lastSaved = savedResult; lastPhase = savedPhase; }
    });
    return persistChain;
  };
  return new ReadableStream<Uint8Array>({
    start(downstream) {
      // Own the reader independently of the HTTP subscriber. Refresh/connection
      // loss detaches the subscriber; only explicit cancellation stops the job.
      void (async () => {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const deadline = Date.parse(String(row.started_at ?? row.created_at)) + Number(row.timeout_ms ?? 600_000);
        const timer = setTimeout(() => controller.abort("timeout"), Math.max(1, deadline - Date.now()));
        let heartbeatBusy = false;
        const heartbeat = setInterval(() => {
          if (heartbeatBusy) return;
          heartbeatBusy = true;
          void persist().catch(() => chatLog("progress_save_failed", id)).finally(() => { heartbeatBusy = false; });
        }, 1_000);
        let failure = "";
        try {
          const source = await abortable(streamChat({ reasoningEffort: taskReasoningEffort(options), outlineId: String(row.outline_id), message: String(row.instruction), model: options.configuredModelId, sessionId: options.sessionId, mode: options.chatMode, modePrompt: options.chatModePrompt, includePrevious: options.includePrevious, includeCharacters: options.includeCharacters, context: options.promptContext }, controller.signal), controller.signal);
          phase = "generating";
          await persist();
          chatLog("upstream_ready", id, { elapsedMs: Date.now() - Date.parse(String(row.started_at)) });
          reader = source.getReader();
          while (true) {
            const { done, value } = await abortable(reader.read(), controller.signal);
            const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
            const end = chunk.indexOf("\u001e");
            const text = end >= 0 ? chunk.slice(0, end) : chunk;
            if (text) {
              const firstChunk = !result;
              if (firstChunk) chatLog("first_token", id, { elapsedMs: Date.now() - Date.parse(String(row.started_at)) });
              result += text;
              phase = "receiving";
              if (firstChunk) await persist();
              if (!detached) downstream.enqueue(encoder.encode(text));
            }
            if (done || end >= 0) break;
          }
          if (!result) throw new Error("模型返回了空结果");
        } catch (error) {
          failure = controller.signal.aborted ? (controller.signal.reason === "timeout" ? "聊天请求超时，请重新发送" : "聊天已取消") : error instanceof Error ? error.message : "聊天请求失败";
          chatLog("execution_failed", id, { reason: controller.signal.aborted ? controller.signal.reason : "upstream_error" });
        } finally {
          clearTimeout(timer);
          clearInterval(heartbeat);
          void reader?.cancel().catch(() => undefined);
          phase = "saving";
          // Save the generated text before completing, so recovery can retain it
          // even if the final transaction must be retried.
          let saved = false;
          for (let attempt = 0; attempt < 6; attempt++) {
            try {
              await persist();
              await completeChatTask(row, { status: controller.signal.reason === "cancelled" ? "cancelled" : failure ? "error" : "success", result, error: failure, runnerId });
              saved = true;
              break;
            } catch {
              chatLog("completion_save_retry", id, { attempt: attempt + 1 });
              await new Promise((resolve) => setTimeout(resolve, 1_000));
            }
          }
          if (!detached) {
            if (saved) { downstream.enqueue(encoder.encode("\u001e")); downstream.close(); }
            else downstream.error(new Error("聊天结果保存失败，请联网后刷新查看任务状态"));
          }
        }
      })().catch(() => { chatLog("worker_failed", id); if (!detached) downstream.error(new Error("聊天执行中断，请刷新查看任务状态")); });
    },
    cancel() { detached = true; chatLog("subscriber_disconnected", id); },
  });
}
