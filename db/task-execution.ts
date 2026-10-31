import type { TaskExecutionOrigin } from "@/lib/studio-types";
import { isCloudDatabase } from "@/db/sqlite";

export function currentTaskExecutionOrigin(): TaskExecutionOrigin {
  return isCloudDatabase() ? "cloud" : "local";
}

export { normalizeTaskExecutionOrigin } from "@/lib/task-execution";
