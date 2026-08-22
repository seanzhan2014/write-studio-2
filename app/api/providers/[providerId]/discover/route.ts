import { discoverProviderModelIds } from "@/db/ai";

export async function POST(_request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await context.params;
    return Response.json({ models: await discoverProviderModelIds(providerId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "获取模型列表失败" }, { status: 400 });
  }
}
