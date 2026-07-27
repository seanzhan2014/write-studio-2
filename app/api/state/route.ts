import { readStudioState, writeStudioState } from "@/db/runtime";
import type { StudioData } from "@/app/studio-state";

export const dynamic = "force-dynamic";

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    return json(await readStudioState());
  } catch (error) {
    return json({ error: "database_unavailable", message: error instanceof Error ? error.message : "数据库不可用" }, 503);
  }
}

export async function PUT(request: Request) {
  try {
    const expectedRevision = Number(request.headers.get("if-match"));
    if (!Number.isFinite(expectedRevision)) return json({ error: "if_match_required" }, 428);
    const body = await request.json() as { data?: StudioData; conflictResolution?: "keep-local" };
    if (!body.data || body.data.version !== 1 || !Array.isArray(body.data.articles)) return json({ error: "invalid_state" }, 400);
    const result = await writeStudioState(body.data, expectedRevision, body.conflictResolution === "keep-local");
    if (result.conflict) return json({ error: "revision_conflict", ...result.current }, 409);
    return json({ revision: result.revision });
  } catch (error) {
    return json({ error: "save_failed", message: error instanceof Error ? error.message : "保存失败" }, 500);
  }
}
