import { AiInputError } from "@/db/ai";
import { createStyleJob, listStyleJobs } from "@/db/style-lab";
export async function GET(request: Request) {
  try {
    const articleId = new URL(request.url).searchParams.get("articleId") || undefined;
    const jobs = await listStyleJobs(articleId);
    return Response.json({ jobs: articleId ? jobs.map(job => ({ ...job, payload: { ...job.payload, references: [], outlines: [], analyses: [] } })) : jobs.map(({ id, status }) => ({ id, status })) }, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "风格任务读取失败" }, { status: 500 }); }
}
export async function POST(request: Request) {
  try { return Response.json({ job: await createStyleJob(await request.json()) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "风格任务创建失败" }, { status: error instanceof AiInputError ? 422 : 500 }); }
}
