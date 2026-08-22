import { clearProviderSecret, setProviderSecret } from "@/db/ai";

export async function PUT(request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await context.params;
    const body = await request.json() as { secret?: string };
    await setProviderSecret(providerId, body.secret ?? "");
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "密钥保存失败" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await context.params;
    await clearProviderSecret(providerId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "密钥删除失败" }, { status: 400 });
  }
}
