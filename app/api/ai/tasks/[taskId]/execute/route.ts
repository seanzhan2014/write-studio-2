import { executeTask } from "@/db/generate-task";

import { isIllustrationTarget } from "@/lib/task-target";
import { illustrationExecutionResponse } from "@/app/api/ai/illustrations/execute";

import { ensureDatabase, getDatabase } from "@/db/runtime";

import { isCloudDatabase } from "@/db/sqlite";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  await ensureDatabase();
  const target = await getDatabase().prepare("SELECT target FROM ai_tasks WHERE id=?").bind(taskId).first<string>("target");
  if (isIllustrationTarget(target)) {
    return illustrationExecutionResponse(taskId);
  }
  if (!isCloudDatabase() && process.env.WRITER_STUDIO_TEST_MODE !== "1") {
    // A browser navigation closes its HTTP response, but a local generation
    // must remain owned by the service. Detach the long-running work from the
    // request and let SQLite leases reject duplicate dispatches.
    void executeTask(taskId).catch((error) => console.error("Background Generate task failed", error));
    return Response.json({ accepted: true, scheduled: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  const result = await executeTask(taskId);
  return Response.json(result.data, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
