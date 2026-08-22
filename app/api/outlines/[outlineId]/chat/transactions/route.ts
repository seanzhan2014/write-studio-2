import type { AiTask, Message } from "@/app/studio-state";
import { findModel } from "@/db/ai";
import { ensureDatabase, getDatabase } from "@/db/runtime";
import { modelSelectionLabel } from "@/lib/model-label";
import type { SelectedAiContext } from "@/lib/ai-context";
import { currentTaskExecutionOrigin, normalizeTaskExecutionOrigin } from "@/db/task-execution";

type SubmittedMessage = Pick<Message, "id" | "role" | "text" | "createdAt" | "stopped">;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function validMessages(value: unknown): SubmittedMessage[] | null {
  if (!Array.isArray(value) || value.length > 500 || JSON.stringify(value).length > 200_000) return null;
  const messages = value.map((item) => item as Partial<SubmittedMessage>);
  if (messages.some((item) => !item.id || !["user", "assistant"].includes(String(item.role)) || typeof item.text !== "string" || !item.createdAt)) return null;
  return messages.map((item) => ({ id: String(item.id).slice(0, 200), role: item.role as Message["role"], text: String(item.text), createdAt: String(item.createdAt), stopped: item.stopped === true || undefined }));
}

async function revision() {
  return Number(await getDatabase().prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
}

export async function POST(request: Request, context: { params: Promise<{ outlineId: string }> }) {
  try {
    const { outlineId } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const taskId = String(body.taskId ?? "").trim().slice(0, 200);
    const sessionId = String(body.sessionId ?? "").trim().slice(0, 200);
    if (!taskId || !sessionId || !["submit", "finalize"].includes(action)) return json({ error: "聊天事务参数无效" }, 400);
    await ensureDatabase();
    const db = getDatabase();

    if (action === "submit") {
      const messages = validMessages(body.messages);
      const question = String(body.message ?? "").trim().slice(0, 20_000);
      if (!messages || !question) return json({ error: "聊天消息无效或过大" }, 400);
      const target = await db.prepare(`SELECT o.article_id,o.chapter_id,o.archived,c.archived AS chapter_archived,s.context_options_json,s.created_at AS session_created_at
        FROM outlines o JOIN chapters c ON c.id=o.chapter_id LEFT JOIN chat_sessions s ON s.id=? AND s.outline_id=o.id WHERE o.id=?`).bind(sessionId, outlineId).first<Record<string, unknown>>();
      if (!target || Number(target.archived) || Number(target.chapter_archived)) return json({ error: "聊天目标不存在或已归档" }, 422);
      const existing = await db.prepare("SELECT id FROM ai_tasks WHERE id=?").bind(taskId).first<string>("id");
      if (existing) return json({ error: "该消息已经提交" }, 409);
      const executionOrigin = currentTaskExecutionOrigin();
      const activeCount = Number(await db.prepare("SELECT COUNT(*) AS count FROM ai_tasks WHERE execution_origin=? AND status IN ('queued','running')").bind(executionOrigin).first<number>("count") ?? 0);
      if (activeCount >= 20) return json({ error: "已有 20 个等待或运行中的任务，请先取消一个任务" }, 409);
      const modelReference = String(body.model ?? "").trim();
      const model = modelReference ? await findModel(modelReference) : null;
      if (modelReference && !model) return json({ error: "所选聊天模型不存在，请重新选择" }, 422);
      const promptContext = body.promptContext && typeof body.promptContext === "object" ? structuredClone(body.promptContext) as SelectedAiContext : undefined;
      if (promptContext && (promptContext.kind !== "chat" || promptContext.currentOutline?.id !== outlineId || JSON.stringify(promptContext).length > 200_000)) return json({ error: "聊天上下文与目标不匹配或过大" }, 422);
      const createdAt = new Date().toISOString();
      const title = String(body.sessionTitle ?? "新对话").slice(0, 48) || "新对话";
      const sessionOptions = JSON.stringify({ title, includePrevious: body.includePrevious !== false, includeCharacters: body.includeCharacters !== false, active: true, lastReadMessageId: null });
      const estimate = Number(body.estimatedCharacters ?? 0);
      const task: AiTask = {
        id: taskId,
        articleId: String(target.article_id),
        chapterId: String(target.chapter_id),
        outlineId,
        target: "AI Chat",
        prompt: question,
        model: model ? modelSelectionLabel(model) : "",
        executionOrigin,
        state: "running",
        phase: "connecting",
        attempt: 1,
        createdAt,
        startedAt: createdAt,
        lastProgressAt: createdAt,
        receivedCharacters: 0,
        timeoutMs: model?.timeoutMs ?? Math.max(1_000, Math.min(900_000, Number(body.timeoutMs ?? 600_000))),
        runnerId: `chat-${taskId}`,
        contextOptions: {
          includePrevious: body.includePrevious !== false,
          includeCharacters: body.includeCharacters !== false,
          estimatedCharacters: Number.isFinite(estimate) ? Math.max(0, estimate) : 0,
          sessionId,
          configuredModelId: model?.id,
          modelId: model?.modelId,
          modelName: model ? modelSelectionLabel(model) : undefined,
          promptContext,
        },
      };
      const statements = [
        db.prepare("INSERT INTO chat_sessions(id,article_id,outline_id,draft,model_id,context_options_json,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET draft='',model_id=excluded.model_id,context_options_json=excluded.context_options_json,updated_at=excluded.updated_at,revision=chat_sessions.revision+1").bind(sessionId, task.articleId, outlineId, "", model?.id ?? null, sessionOptions, target.session_created_at ? String(target.session_created_at) : createdAt, createdAt),
        db.prepare("DELETE FROM chat_messages WHERE session_id=?").bind(sessionId),
        ...messages.map((message, index) => db.prepare("INSERT INTO chat_messages(id,session_id,role,content,status,order_index,created_at) VALUES(?,?,?,?,?,?,?)").bind(message.id, sessionId, message.role, message.text, message.stopped ? "stopped" : "complete", index, message.createdAt)),
        db.prepare("INSERT INTO ai_tasks(id,article_id,chapter_id,outline_id,target,instruction,model_id,execution_origin,context_options_json,idempotency_key,status,attempt,phase,last_progress_at,received_characters,timeout_ms,runner_id,created_at,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(task.id, task.articleId, task.chapterId, outlineId, "chat", question, task.model, executionOrigin, JSON.stringify(task.contextOptions), task.id, "running", 1, "connecting", createdAt, 0, task.timeoutMs, task.runnerId, createdAt, createdAt),
        db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key IN ('state_revision','database_version')").bind(createdAt),
      ];
      await db.batch(statements);
      return json({ task, messages, sessionTitle: title, sessionUpdatedAt: createdAt, revision: await revision() }, 201);
    }

    const taskRow = await db.prepare("SELECT * FROM ai_tasks WHERE id=? AND outline_id=? AND target='chat'").bind(taskId, outlineId).first<Record<string, unknown>>();
    if (!taskRow) return json({ error: "聊天任务不存在" }, 404);
    if (normalizeTaskExecutionOrigin(taskRow.execution_origin) !== currentTaskExecutionOrigin()) return json({ error: "聊天任务属于另一端，不能在当前运行端完成" }, 409);
    const result = String(body.result ?? "");
    const error = String(body.error ?? "").slice(0, 5_000);
    const requestedStatus = String(body.status ?? "success");
    const status = requestedStatus === "cancelled" ? "cancelled" : requestedStatus === "failed" ? "error" : "success";
    const completedAt = new Date().toISOString();
    const assistantText = result || (status === "error" && error ? `${String(body.chatbotName ?? "AI")} 错误：${error}` : "");
    const message: Message | undefined = assistantText ? {
      id: String(body.messageId ?? `message-${crypto.randomUUID()}`).slice(0, 200),
      role: "assistant",
      text: assistantText,
      createdAt: completedAt,
      stopped: body.stopped === true || undefined,
    } : undefined;
    const statements = [
      db.prepare("UPDATE ai_tasks SET status=?,phase=?,completed_at=?,last_progress_at=?,received_characters=?,result_text=?,error_message=?,runner_id=NULL,lease_until=NULL WHERE id=?").bind(status, status === "success" ? "completed" : status === "cancelled" ? "cancelled" : "failed", completedAt, completedAt, result.length, result || null, error || null, taskId),
      db.prepare("UPDATE chat_sessions SET updated_at=?,revision=revision+1 WHERE id=? AND outline_id=?").bind(completedAt, sessionId, outlineId),
      db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key IN ('state_revision','database_version')").bind(completedAt),
    ];
    if (message) statements.splice(1, 0, db.prepare("INSERT INTO chat_messages(id,session_id,role,content,status,order_index,created_at) VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(order_index),-1)+1 FROM chat_messages WHERE session_id=?),?)").bind(message.id, sessionId, message.role, message.text, message.stopped ? "stopped" : "complete", sessionId, completedAt));
    await db.batch(statements);
    const task: Partial<AiTask> = { state: status === "error" ? "failed" : status, phase: status === "error" ? "failed" : status === "success" ? "completed" : "cancelled", completedAt, lastProgressAt: completedAt, receivedCharacters: result.length, resultText: result || undefined, error: error || undefined, runnerId: undefined, leaseUntil: undefined };
    return json({ task, message, sessionUpdatedAt: completedAt, revision: await revision() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "聊天事务失败" }, 500);
  }
}
