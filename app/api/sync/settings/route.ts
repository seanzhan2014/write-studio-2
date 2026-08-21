import { authorizeLocalSyncMutation, setAutoUploadEnabled, SyncError } from "@/db/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    authorizeLocalSyncMutation(request);
    const body = await request.json() as { autoUploadEnabled?: unknown };
    if (typeof body.autoUploadEnabled !== "boolean") throw new SyncError("invalid_setting", "自动上传开关值无效", 400);
    return Response.json(await setAutoUploadEnabled(body.autoUploadEnabled), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SyncError ? error.status : 500;
    return Response.json({ code: error instanceof SyncError ? error.code : "sync_setting_failed", message: error instanceof Error ? error.message : "同步设置保存失败" }, { status });
  }
}
