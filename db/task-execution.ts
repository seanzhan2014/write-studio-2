import type { TaskExecutionOrigin } from "@/app/studio-state";
import { isCloudDatabase } from "@/db/sqlite";

export function currentTaskExecutionOrigin(): TaskExecutionOrigin {
  return isCloudDatabase() ? "cloud" : "local";
}

export function normalizeTaskExecutionOrigin(value: unknown): TaskExecutionOrigin {
  return value === "cloud" ? "cloud" : "local";
}
