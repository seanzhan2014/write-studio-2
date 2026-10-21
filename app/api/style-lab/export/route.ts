import { createCurrentSnapshot, SyncError } from "@/db/sync";
export async function GET() {
  try {
    const snapshot = await createCurrentSnapshot();
    return Response.json({ data: snapshot.data, styleLab: snapshot.styleLab }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取完整学习历史失败" }, { status: error instanceof SyncError ? error.status : 500 });
  }
}
