import { getLocalSyncStatus, SyncError } from "@/db/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getLocalSyncStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SyncError ? error.status : 500;
    return Response.json({ state: "error", code: error instanceof SyncError ? error.code : "sync_status_failed", message: error instanceof Error ? error.message : "读取同步状态失败" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
