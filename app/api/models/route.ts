import { createModel, listModels } from "@/db/ai";

export const dynamic = "force-dynamic";
export async function GET() { return Response.json({ models: await listModels() }, { headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request) {
  try { return Response.json(await createModel(await request.json()), { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "模型创建失败" }, { status: 400 }); }
}
