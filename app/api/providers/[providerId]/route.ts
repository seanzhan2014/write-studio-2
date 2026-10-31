import { deleteProvider, updateProvider } from "@/db/ai-models";

export async function PATCH(request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await context.params;
    return Response.json(await updateProvider(providerId, await request.json()));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Provider 更新失败" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await context.params;
    await deleteProvider(providerId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Provider 删除失败" }, { status: 409 });
  }
}
