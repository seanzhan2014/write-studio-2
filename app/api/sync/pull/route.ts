import { authorizeLocalSyncMutation, pullCloudOverLocal, SyncError } from "@/db/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    authorizeLocalSyncMutation(request);
    const body = await request.json().catch(() => ({})) as { includeModels?: boolean; includeSecrets?: boolean };
    return Response.json(await pullCloudOverLocal(body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SyncError ? error.status : 500;
    return Response.json({ code: error instanceof SyncError ? error.code : "pull_failed", message: error instanceof Error ? error.message : "从云端取回失败", details: error instanceof SyncError ? error.details : undefined }, { status });
  }
}
