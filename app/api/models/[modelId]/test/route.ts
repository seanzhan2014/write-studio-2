import { testModel } from "@/db/ai";

export async function POST(_request: Request, context: { params: Promise<{ modelId: string }> }) {
  try { const { modelId } = await context.params; return Response.json(await testModel(modelId)); }
  catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "连接测试失败" }, { status: 502 }); }
}
