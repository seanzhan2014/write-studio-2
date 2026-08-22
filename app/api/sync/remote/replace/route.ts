import { authorizeRemoteSyncRequest, replaceCurrentDatabase, SyncError } from "@/db/sync";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    authorizeRemoteSyncRequest(request);
    const body = await request.json() as { snapshot?: unknown; expectedDatabaseVersion?: number };
    return Response.json(await replaceCurrentDatabase(body.snapshot, Number(body.expectedDatabaseVersion)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SyncError ? error.status : 500;
    return Response.json({ code: error instanceof SyncError ? error.code : "replace_failed", message: error instanceof Error ? error.message : "覆盖云端数据库失败", details: error instanceof SyncError ? error.details : undefined }, { status });
  }
}
