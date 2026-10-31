import { AiInputError } from "@/db/ai-errors";
import { createStyleJob, listStyleJobs, listStyleJobHistory } from "@/db/style-lab";
import { isCloudDatabase } from "@/db/sqlite";
import { getDatabase } from "@/db/runtime";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const articleId = params.get("articleId") || undefined;
    if (articleId || params.get("scope") === "history") return Response.json(await listStyleJobHistory({ articleId, filter: params.get("filter") ?? "all", page: Number(params.get("page")), paginate: params.get("paginate") !== "false" }), { headers: { "Cache-Control": "no-store" } });
    const jobs = await listStyleJobs(articleId);
    const counts = await getDatabase().prepare("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END),0) AS active,COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed FROM style_lab_jobs WHERE COALESCE(json_extract(payload_json,'$.archived'),0)=0").first<{ total: number; active: number; failed: number }>();
    return Response.json({ jobs: jobs.map(({ id, status }) => ({ id, status })), active: Number(counts?.active ?? 0), total: Number(counts?.total ?? 0), failed: Number(counts?.failed ?? 0), executionMode: isCloudDatabase() ? "browser" : "server" }, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "风格任务读取失败" }, { status: 500 }); }
}
export async function POST(request: Request) {
  try { return Response.json({ job: await createStyleJob(await request.json()) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "风格任务创建失败" }, { status: error instanceof AiInputError ? 422 : 500 }); }
}
