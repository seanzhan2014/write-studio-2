export type TaskExecutionOrigin = "local" | "cloud";

export function normalizeTaskExecutionOrigin(value: unknown): TaskExecutionOrigin {
  return value === "cloud" ? "cloud" : "local";
}
