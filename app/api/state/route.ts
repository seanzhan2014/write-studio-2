import { readStudioState, readStudioStateIdentity, writeStudioState, StudioInputError } from "@/db/runtime";
import type { StudioData } from "@/app/studio-state";
import { diffStudioData, isStudioChangesEmpty } from "@/lib/studio-changes";
import { currentTaskExecutionOrigin } from "@/db/task-execution";
import { studioStateEtag, type StudioStateIdentity } from "@/lib/state-version";
import { recoverChatTasks } from "@/db/chat-tasks";

export const dynamic = "force-dynamic";

function stateHeaders(identity?: StudioStateIdentity, etag?: string) {
  return {
    "Cache-Control": "private, no-cache",
    ...(etag ? { ETag: etag } : {}),
    ...(identity ? {
      "X-Writer-Studio-Database-Id": identity.databaseId,
      "X-Writer-Studio-Schema-Version": String(identity.schemaVersion),
      "X-Writer-Studio-Database-Version": String(identity.databaseVersion),
      "X-Writer-Studio-State-Revision": String(identity.revision),
    } : {}),
  };
}

function json(value: unknown, status = 200, identity?: StudioStateIdentity, etag?: string) {
  return Response.json(value, { status, headers: stateHeaders(identity, etag) });
}

function matchesEtag(request: Request, etag: string) {
  return request.headers.get("if-none-match")?.split(",").some((value) => value.trim() === etag || value.trim() === "*") === true;
}

export async function GET(request: Request) {
  try {
    await recoverChatTasks();
    if (request.headers.has("if-none-match")) {
      const identity = await readStudioStateIdentity();
      const etag = studioStateEtag(identity);
      if (matchesEtag(request, etag)) return new Response(null, { status: 304, headers: stateHeaders(identity, etag) });
    }
    const [state, storedIdentity] = await Promise.all([readStudioState(), readStudioStateIdentity()]);
    const identity = { ...storedIdentity, revision: state.revision, databaseVersion: state.databaseVersion };
    return json({ ...state, databaseId: identity.databaseId, schemaVersion: identity.schemaVersion, executionOrigin: currentTaskExecutionOrigin() }, 200, identity, studioStateEtag(identity));
  } catch (error) {
    return json({ error: "database_unavailable", message: error instanceof Error ? error.message : "数据库不可用" }, 503);
  }
}

export async function PUT(request: Request) {
  try {
    const revisionHeader = request.headers.get("if-match");
    const expectedRevision = Number(revisionHeader);
    if (!revisionHeader?.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return json({ error: "if_match_required" }, 428);
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
    return json({ error: error instanceof StudioInputError ? "invalid_state" : "save_failed", message: error instanceof Error ? error.message : "保存失败" }, error instanceof StudioInputError ? 422 : 500);
  }
}
