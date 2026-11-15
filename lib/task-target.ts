export const taskTargetLabels = {
  content: "正文", outline: "大纲", "chapter-title": "章节标题", "chapter-names": "整章名称", "all-names": "全部名称", chat: "AI Chat",
  "illustration-prompt": "插图 Prompt", "illustration-image": "插图",
} as const;
export type TaskTargetLabel = typeof taskTargetLabels[keyof typeof taskTargetLabels];
export function taskTargetLabel(code: unknown): TaskTargetLabel {
  return taskTargetLabels[code as keyof typeof taskTargetLabels] ?? "章节标题";
}
export function taskTargetCode(label: TaskTargetLabel) {
  return Object.entries(taskTargetLabels).find(([, value]) => value === label)?.[0] ?? "chapter-title";
}
export function isIllustrationTarget(target: unknown) {
  return target === "illustration-prompt" || target === "illustration-image" || target === "插图 Prompt" || target === "插图";
}
export function taskChangesOutline(target: TaskTargetLabel) {
  return target === "正文" || target === "大纲" || target === "章节标题";
}

export function isNamingTarget(target: unknown) {
  return target === "all-names" || target === "chapter-names" || target === "全部名称" || target === "整章名称";
}
