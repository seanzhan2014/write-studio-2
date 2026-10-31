import { applyStudioChanges, StudioInputError } from "@/db/runtime";
import { isStudioChanges, isStudioChangesEmpty } from "@/lib/studio-changes";

export const dynamic = "force-dynamic";

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const revisionHeader = request.headers.get("if-match");
    const expectedRevision = Number(revisionHeader);
    if (!revisionHeader?.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return json({ error: "if_match_required" }, 428);
    const body = await request.json().catch(() => null) as { changes?: unknown } | null;
    if (!body || !isStudioChanges(body.changes)) return json({ error: "invalid_changes", message: "增量保存内容无效" }, 400);
    if (isStudioChangesEmpty(body.changes)) return json({ error: "empty_changes", message: "没有需要保存的修改" }, 400);
    const result = await applyStudioChanges(body.changes, expectedRevision);
    if (result.conflict) return json({ error: "revision_conflict", revision: result.revision, databaseVersion: result.databaseVersion }, 409);
    return json({ revision: result.revision, databaseVersion: result.databaseVersion });
  } catch (error) {
    return json({ error: error instanceof StudioInputError ? "invalid_changes" : "save_failed", message: error instanceof Error ? error.message : "保存失败" }, error instanceof StudioInputError ? 422 : 500);
  }
}
