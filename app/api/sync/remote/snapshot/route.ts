import { authorizeRemoteSyncRequest, createCurrentSnapshot, SyncError } from "@/db/sync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    authorizeRemoteSyncRequest(request);
    const query = new URL(request.url).searchParams;
    return Response.json(await createCurrentSnapshot({ includeModels: query.get("models") === "1", includeSecrets: query.get("secrets") === "1" }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SyncError ? error.status : 500;
    return Response.json({ code: error instanceof SyncError ? error.code : "snapshot_failed", message: error instanceof Error ? error.message : "读取云端快照失败" }, { status });
  }
}
