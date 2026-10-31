import { deleteModel, updateModel } from "@/db/ai-models";

export async function PATCH(request: Request, context: { params: Promise<{ modelId: string }> }) {
  try { const { modelId } = await context.params; return Response.json(await updateModel(modelId, await request.json())); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "模型更新失败" }, { status: 400 }); }
}
export async function DELETE(_request: Request, context: { params: Promise<{ modelId: string }> }) {
  const { modelId } = await context.params; await deleteModel(modelId); return new Response(null, { status: 204 });
}
