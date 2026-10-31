import { createProvider, listProviders } from "@/db/ai-models";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ providers: await listProviders() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try { return Response.json(await createProvider(await request.json()), { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Provider 创建失败" }, { status: 400 }); }
}
