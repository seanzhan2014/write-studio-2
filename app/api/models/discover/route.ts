import { discoverModelIds } from "@/db/ai";

export async function POST(request: Request) {
  try {
    return Response.json({ models: await discoverModelIds(await request.json()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "获取模型列表失败" }, { status: 400 });
  }
}
