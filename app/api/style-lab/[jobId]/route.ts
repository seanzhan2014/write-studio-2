import { AiInputError } from "@/db/ai-errors";
import { getStyleJob, styleJobAction } from "@/db/style-lab";
type Context = { params: Promise<{ jobId: string }> };
export async function GET(_request: Request, context: Context) {
  try { return Response.json({ job: await getStyleJob((await context.params).jobId, true) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "风格任务读取失败" }, { status: 404 }); }
}
export async function POST(request: Request, context: Context) {
  try { return Response.json({ job: await styleJobAction((await context.params).jobId, String((await request.json()).action)) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "风格任务操作失败" }, { status: error instanceof AiInputError ? 422 : 500 }); }
}
