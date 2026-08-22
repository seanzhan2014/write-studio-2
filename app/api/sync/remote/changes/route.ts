import { applyRemoteChanges, authorizeRemoteSyncRequest, SyncError } from "@/db/sync";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    authorizeRemoteSyncRequest(request);
    const body = await request.json() as { envelope?: unknown; expectedDatabaseVersion?: number };
    return Response.json(await applyRemoteChanges(body.envelope, Number(body.expectedDatabaseVersion)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SyncError ? error.status : 500;
    return Response.json({ code: error instanceof SyncError ? error.code : "changes_failed", message: error instanceof Error ? error.message : "应用同步增量失败", details: error instanceof SyncError ? error.details : undefined }, { status });
  }
}
