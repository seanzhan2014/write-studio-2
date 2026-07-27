import { databaseStatus } from "@/db/runtime";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await databaseStatus(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ connected: false, message: error instanceof Error ? error.message : "数据库不可用" }, { status: 503 }); }
}
