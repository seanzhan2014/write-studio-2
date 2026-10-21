import { AiInputError } from "@/db/ai";
import { createStyleJob, listStyleJobs, listStyleJobHistory } from "@/db/style-lab";
import { isCloudDatabase } from "@/db/sqlite";
import { getDatabase } from "@/db/runtime";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const articleId = params.get("articleId") || undefined;
    if (articleId || params.get("scope") === "history") return Response.json(await listStyleJobHistory({ articleId, filter: params.get("filter") ?? "all", page: Number(params.get("page")) }), { headers: { "Cache-Control": "no-store" } });
    const jobs = await listStyleJobs(articleId);
    const active = Number(await getDatabase().prepare("SELECT COUNT(*) AS count FROM style_lab_jobs WHERE status IN ('queued','running')").first<number>("count") ?? 0);
    return Response.json({ jobs: jobs.map(({ id, status }) => ({ id, status })), active, executionMode: isCloudDatabase() ? "browser" : "server" }, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "风格任务读取失败" }, { status: 500 }); }
}
export async function POST(request: Request) {
  try { return Response.json({ job: await createStyleJob(await request.json()) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "风格任务创建失败" }, { status: error instanceof AiInputError ? 422 : 500 }); }
}
