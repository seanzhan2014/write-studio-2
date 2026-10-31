import { testProvider } from "@/db/ai-models";

export async function POST(_request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await context.params;
    return Response.json(await testProvider(providerId));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Provider 连接测试失败" }, { status: 502 });
  }
}
