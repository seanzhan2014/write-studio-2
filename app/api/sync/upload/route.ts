import { authorizeLocalSyncMutation, SyncError, uploadLocalChanges } from "@/db/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    authorizeLocalSyncMutation(request);
    return Response.json(await uploadLocalChanges(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SyncError ? error.status : 500;
    return Response.json({ state: "error", code: error instanceof SyncError ? error.code : "upload_failed", message: error instanceof Error ? error.message : "后台上传失败" }, { status });
  }
}
