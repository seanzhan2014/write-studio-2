import type { AiTask } from "./studio-types";

export const generateModelUsageStorageKey = "writer-studio:generate-model-usage:v1";
export type GenerateModelUsage = Record<string, number>;

export function normalizeGenerateModelUsage(value: unknown): GenerateModelUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, time]) => typeof time === "number" && Number.isFinite(time) && time > 0));
}

export function rememberGenerateModelUsage(
  previous: GenerateModelUsage,
  tasks: readonly Pick<AiTask, "target" | "model" | "createdAt" | "contextOptions">[],
  resolveReference: (reference: string) => string | undefined,
): GenerateModelUsage {
  let usage = previous;
  for (const task of tasks) {
    if (task.target !== "正文") continue;
    const reference = task.contextOptions?.configuredModelId ?? (task.model.trim() ? resolveReference(task.model) : "");
    const time = Date.parse(task.createdAt);
    if (reference === undefined || !Number.isFinite(time) || time <= (usage[reference] ?? 0)) continue;
    if (usage === previous) usage = { ...previous };
    usage[reference] = time;
  }
  return usage;
}

export function sortGenerateModelOptions<T extends { value: string }>(options: readonly T[], usage: GenerateModelUsage): T[] {
  return [...options].sort((a, b) => (usage[b.value] ?? 0) - (usage[a.value] ?? 0));
}
