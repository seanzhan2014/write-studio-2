import { integrityCheck } from "@/db/runtime";

export async function POST() {
  try { return Response.json(await integrityCheck()); }
  catch (error) { return Response.json({ ok: false, message: error instanceof Error ? error.message : "检查失败" }, { status: 500 }); }
}
