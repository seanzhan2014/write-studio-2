import type { AiTask } from "@/app/studio-state";
import { parseTaskHistory, taskPhaseLabels } from "@/lib/task-history";

function historyTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

export function TaskHistory({ task, collapsible = false }: { task: AiTask; collapsible?: boolean }) {
  const history = parseTaskHistory(task.history);
  const active = task.state === "running" || task.state === "waiting";
  const content = history.length ? <ol className="task-history-list" aria-label="运行历史">
    {history.map((entry, index) => {
      const current = active && index === history.length - 1 && entry.phase === task.phase;
      return <li key={`${index}:${entry.at}`} className={`${entry.phase} ${current ? "current" : ""}`} aria-current={current ? "step" : undefined}>
        <div className="task-history-heading"><span>{taskPhaseLabels[entry.phase]}{["revising", "verifying"].includes(entry.phase) && entry.reviewRound != null ? ` · 第 ${entry.reviewRound} 轮` : ""}</span>{current && <em>当前</em>}</div>
        <div className="task-history-meta"><time dateTime={entry.at}>{historyTime(entry.at)}</time><span>{entry.executionOrigin === "cloud" ? "云端" : "本地"}{entry.attempt > 0 ? ` · 第 ${entry.attempt} 次尝试` : ""}</span></div>
        {entry.error && <p className="task-history-error">{entry.error}</p>}
      </li>;
    })}
  </ol> : <p className="task-detail-empty">该任务尚无运行历史记录。后续步骤将自动保留。</p>;
  return collapsible ? <details className="task-history-disclosure" open={active || undefined}><summary>运行历史{history.length ? ` · ${history.length} 条` : ""}</summary>{content}</details>
    : <section className="task-detail-section task-history"><h3>运行历史</h3>{content}</section>;
}
