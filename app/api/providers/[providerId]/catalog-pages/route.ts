import { readProviderCatalogPage } from "@/db/ai-models";

export async function POST(request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input) || (input.cursor != null && typeof input.cursor !== "string") || (input.hint != null && typeof input.hint !== "string") || (input.air !== undefined && typeof input.air !== "string")) throw new Error("目录分页参数无效");
    return Response.json(await readProviderCatalogPage((await context.params).providerId, input.cursor, request.signal, input.hint, input.air), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "目录搜索失败" }, { status: 400 });
  }
}
