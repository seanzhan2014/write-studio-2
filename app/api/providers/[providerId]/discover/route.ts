import { discoverProviderCatalog, readProviderCatalog } from "@/db/ai";

export async function GET(_request: Request, context: { params: Promise<{ providerId: string }> }) {
  try { return Response.json(await readProviderCatalog((await context.params).providerId), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "目录读取失败" }, { status: 400 }); }
}

export async function POST(_request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await context.params;
    const result = await discoverProviderCatalog(providerId);
    return Response.json({ ...result, models: result.catalog.map((entry) => entry.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "获取模型列表失败" }, { status: 400 });
  }
}
