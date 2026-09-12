import type { AiTask } from "@/app/studio-state";
import { parseTaskHistory } from "@/lib/task-history";
import { ensureDatabase, getDatabase } from "@/db/runtime";
import { currentTaskExecutionOrigin, normalizeTaskExecutionOrigin } from "@/db/task-execution";
import { chatSnapshot, completeChatTask, readChatTask } from "@/db/chat-tasks";

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const body = await request.json() as { action?: string };
    if (body.action !== "cancel" && body.action !== "retry" && body.action !== "transfer") return json({ error: "任务状态操作无效" }, 400);
    await ensureDatabase();
    const db = getDatabase();
    const row = await db.prepare("SELECT status,target,outline_id,lease_until,execution_origin FROM ai_tasks WHERE id=?").bind(taskId).first<Record<string, unknown>>();
    if (!row) return json({ error: "任务不存在" }, 404);
    if (row.target === "chat") {
      if (body.action !== "cancel") return json({ error: "聊天任务请返回会话再次发送" }, 409);
      if (normalizeTaskExecutionOrigin(row.execution_origin) !== currentTaskExecutionOrigin()) return json({ error: "请在任务所属运行端停止聊天" }, 409);
      const chat = (await readChatTask(taskId))!;
      const completed = await completeChatTask(chat, { status: "cancelled", result: String(chat.result_text ?? ""), error: "用户停止了聊天回复" });
      return json(await chatSnapshot(completed));
    }
    const now = new Date().toISOString();
    let patch: Partial<AiTask>;
    const statements = [];
    const executionOrigin = currentTaskExecutionOrigin();
    if (body.action === "cancel") {
      if (!["queued", "running"].includes(String(row.status))) return json({ error: "只有等待或运行中的任务可以取消" }, 409);
      patch = { state: "cancelled", phase: "cancelled", completedAt: now, lastProgressAt: now, runnerId: undefined, leaseUntil: undefined };
      statements.push(db.prepare("UPDATE ai_tasks SET status='cancelled',phase='cancelled',completed_at=?,last_progress_at=?,runner_id=NULL,lease_until=NULL WHERE id=? AND status IN ('queued','running')").bind(now, now, taskId));
      if (!['chat', 'all-names'].includes(String(row.target))) statements.push(db.prepare("UPDATE outlines SET state='saved',updated_at=?,revision=revision+1 WHERE id=?").bind(now, String(row.outline_id)));
    } else if (body.action === "retry") {
      const stale = String(row.status) === "running" && (!row.lease_until || String(row.lease_until) <= now);
      if (!["error", "cancelled"].includes(String(row.status)) && !stale) return json({ error: "只有失败、已取消或中断的任务可以重试" }, 409);
      patch = { state: "waiting", phase: "queued", executionOrigin, attempt: 0, startedAt: undefined, completedAt: undefined, lastProgressAt: undefined, receivedCharacters: 0, runnerId: undefined, leaseUntil: undefined, error: undefined };
      statements.push(db.prepare("UPDATE ai_tasks SET status='queued',phase='queued',execution_origin=?,attempt=0,started_at=NULL,completed_at=NULL,last_progress_at=NULL,received_characters=0,runner_id=NULL,lease_until=NULL,error_message=NULL WHERE id=?").bind(executionOrigin, taskId));
    } else {
      const stale = String(row.status) === "running" && (!row.lease_until || String(row.lease_until) <= now);
      if (normalizeTaskExecutionOrigin(row.execution_origin) === executionOrigin) return json({ error: "任务已经属于当前运行端" }, 409);
      if (String(row.target) === "chat" || (!stale && !["queued", "error", "cancelled"].includes(String(row.status)))) return json({ error: "只有等待、失败、已取消或中断的生成任务可以转移" }, 409);
      patch = { state: "waiting", phase: "queued", executionOrigin, attempt: 0, startedAt: undefined, completedAt: undefined, lastProgressAt: undefined, receivedCharacters: 0, runnerId: undefined, leaseUntil: undefined, error: undefined };
      statements.push(db.prepare("UPDATE ai_tasks SET status='queued',phase='queued',execution_origin=?,attempt=0,started_at=NULL,completed_at=NULL,last_progress_at=NULL,received_characters=0,runner_id=NULL,lease_until=NULL,error_message=NULL WHERE id=?").bind(executionOrigin, taskId));
    }
    statements.push(db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key IN ('state_revision','database_version')").bind(now));
    await db.batch(statements);
    patch.history = parseTaskHistory(await db.prepare("SELECT history_json FROM ai_tasks WHERE id=?").bind(taskId).first<string>("history_json"));
    const revision = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
    return json({ task: patch, revision });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "任务状态更新失败" }, 500);
  }
}
