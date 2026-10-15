import { testModel } from "@/db/ai";

export async function POST(request: Request, context: { params: Promise<{ modelId: string }> }) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.operation && !["text", "image"].includes(body.operation)) return Response.json({ error: "检测操作无效" }, { status: 400 });
    const { modelId } = await context.params;
    const result = await testModel(modelId, body.operation === "image" ? "image" : "text");
    return Response.json({ ...result, ...(!result.ok ? { error: result.message } : {}) }, { status: result.ok ? 200 : 502 });
  }
  catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "连接测试失败" }, { status: 502 }); }
}
