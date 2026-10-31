import { clearModelSecret, setModelSecret } from "@/db/ai-models";

export async function PUT(request: Request, context: { params: Promise<{ modelId: string }> }) {
  try { const { modelId } = await context.params; const body = await request.json() as { secret?: string }; await setModelSecret(modelId, body.secret ?? ""); return Response.json({ ok: true }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "密钥保存失败" }, { status: 400 }); }
}
export async function DELETE(_request: Request, context: { params: Promise<{ modelId: string }> }) {
  const { modelId } = await context.params; await clearModelSecret(modelId); return new Response(null, { status: 204 });
}
