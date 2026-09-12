export const taskPhaseLabels = {
  queued: "等待调度", preparing: "准备上下文", connecting: "等待模型响应", generating: "模型生成中",
  receiving: "接收结果", reviewing: "初稿审校", revising: "按问题修正", verifying: "修正后复检",
  saving: "保存结果", retrying: "准备重试", completed: "已保存", failed: "执行失败", cancelled: "已取消",
};

export type TaskPhase = keyof typeof taskPhaseLabels;
export type TaskHistoryEntry = {
  at: string;
  phase: TaskPhase;
  attempt: number;
  reviewRound?: number | null;
  executionOrigin: "local" | "cloud";
  error?: string | null;
};

export function parseTaskHistory(value: unknown): TaskHistoryEntry[] {
  try {
    const entries = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(entries) ? entries.filter((entry): entry is TaskHistoryEntry => Boolean(
      entry && typeof entry.at === "string" && Object.hasOwn(taskPhaseLabels, entry.phase)
      && Number.isInteger(entry.attempt) && entry.attempt >= 0
      && (entry.executionOrigin === "local" || entry.executionOrigin === "cloud")
      && (entry.reviewRound == null || Number.isInteger(entry.reviewRound))
      && (entry.error == null || typeof entry.error === "string")
    )) : [];
  } catch { return []; }
}
