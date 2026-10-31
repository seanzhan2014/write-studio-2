import type { AiTask } from "./studio-types.ts";
import { parseTaskHistory } from "./task-history.ts";
import { taskTargetLabel } from "./task-target.ts";
import { normalizeTaskExecutionOrigin } from "./task-execution.ts";

export function taskFromRow(row: Record<string, unknown>): AiTask {
  let contextOptions: AiTask["contextOptions"];
  try { contextOptions = JSON.parse(String(row.context_options_json ?? "{}")) as AiTask["contextOptions"]; } catch { contextOptions = undefined; }
  return {
    id: String(row.id), articleId: String(row.article_id), chapterId: String(row.chapter_id), outlineId: String(row.outline_id),
    target: taskTargetLabel(row.target),
    prompt: String(row.instruction ?? ""), model: String(row.model_id ?? ""),
    executionOrigin: normalizeTaskExecutionOrigin(row.execution_origin),
    state: row.status === "queued" ? "waiting" : row.status === "error" ? "failed" : String(row.status) as AiTask["state"],
    attempt: Number(row.attempt ?? 0), phase: row.phase ? String(row.phase) as AiTask["phase"] : undefined,
    createdAt: String(row.created_at), startedAt: row.started_at ? String(row.started_at) : undefined, completedAt: row.completed_at ? String(row.completed_at) : undefined,
    lastProgressAt: row.last_progress_at ? String(row.last_progress_at) : undefined, receivedCharacters: row.received_characters == null ? undefined : Number(row.received_characters),
    timeoutMs: row.timeout_ms == null ? undefined : Number(row.timeout_ms), inputTokens: row.input_tokens == null ? undefined : Number(row.input_tokens), outputTokens: row.output_tokens == null ? undefined : Number(row.output_tokens),
    runnerId: row.runner_id ? String(row.runner_id) : undefined, leaseUntil: row.lease_until ? String(row.lease_until) : undefined,
    resultText: row.result_text ? String(row.result_text) : undefined, resultVersionId: row.result_version_id ? String(row.result_version_id) : undefined,
    history: parseTaskHistory(row.history_json),
    error: row.error_message ? String(row.error_message) : undefined, contextOptions,
  };
}
