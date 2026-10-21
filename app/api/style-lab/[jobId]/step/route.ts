import { executeStyleStep } from "@/db/style-lab";
export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try { return Response.json({ job: await executeStyleStep((await context.params).jobId) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "风格任务执行失败" }, { status: 500 }); }
}
