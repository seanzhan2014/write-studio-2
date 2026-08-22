import { readStudioRevision, readStudioState, writeStudioState } from "@/db/runtime";
import type { StudioData } from "@/app/studio-state";
import { diffStudioData, isStudioChangesEmpty } from "@/lib/studio-changes";
import { currentTaskExecutionOrigin } from "@/db/task-execution";

export const dynamic = "force-dynamic";

function stateEtag(revision: number) {
  return `"writer-studio-state-${revision}"`;
}

function stateHeaders(etag?: string) {
  return {
    "Cache-Control": "private, no-cache",
    ...(etag ? { ETag: etag } : {}),
  };
}

function json(value: unknown, status = 200, etag?: string) {
  return Response.json(value, { status, headers: stateHeaders(etag) });
}

function matchesEtag(request: Request, etag: string) {
  return request.headers.get("if-none-match")?.split(",").some((value) => value.trim() === etag || value.trim() === "*") === true;
}

export async function GET(request: Request) {
  try {
    if (request.headers.has("if-none-match")) {
      const revision = await readStudioRevision();
      const etag = stateEtag(revision);
      if (matchesEtag(request, etag)) return new Response(null, { status: 304, headers: stateHeaders(etag) });
    }
    const state = await readStudioState();
    return json({ ...state, executionOrigin: currentTaskExecutionOrigin() }, 200, stateEtag(state.revision));
  } catch (error) {
    return json({ error: "database_unavailable", message: error instanceof Error ? error.message : "数据库不可用" }, 503);
  }
}

export async function PUT(request: Request) {
  try {
    const expectedRevision = Number(request.headers.get("if-match"));
    if (!Number.isFinite(expectedRevision)) return json({ error: "if_match_required" }, 428);
    const body = await request.json() as { data?: StudioData };
    if (!body.data || body.data.version !== 1 || !Array.isArray(body.data.articles)) return json({ error: "invalid_state" }, 400);
    const current = await readStudioState();
    if (current.revision !== expectedRevision) return json({ error: "revision_conflict", ...current }, 409);
    if (current.data && isStudioChangesEmpty(diffStudioData(current.data, body.data))) {
      return json({ revision: current.revision, databaseVersion: current.databaseVersion, unchanged: true });
    }
    const result = await writeStudioState(body.data, expectedRevision);
    if (result.conflict) return json({ error: "revision_conflict", ...result.current }, 409);
    return json({ revision: result.revision, databaseVersion: result.databaseVersion });
  } catch (error) {
    return json({ error: "save_failed", message: error instanceof Error ? error.message : "保存失败" }, 500);
  }
}
