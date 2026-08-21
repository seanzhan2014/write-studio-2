import { authorizeLocalSyncMutation, pushLocalOverCloud, SyncError } from "@/db/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    authorizeLocalSyncMutation(request);
    return Response.json(await pushLocalOverCloud(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SyncError ? error.status : 500;
    return Response.json({ code: error instanceof SyncError ? error.code : "push_failed", message: error instanceof Error ? error.message : "复制到云端失败", details: error instanceof SyncError ? error.details : undefined }, { status });
  }
}
