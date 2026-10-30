import { Fragment, type ReactNode } from "react";
import { newestTaskFirst } from "@/lib/task-order";

export type TaskTimelineEntry = { id: string; createdAt: string; content: ReactNode };

export function TaskTimeline({ entries }: { entries: TaskTimelineEntry[] }) {
  return <div className="task-timeline">{[...entries].sort(newestTaskFirst).map(entry =>
    <Fragment key={entry.id}>{entry.content}</Fragment>
  )}{!entries.length && <div className="empty-inline">暂无 AI 任务</div>}</div>;
}
