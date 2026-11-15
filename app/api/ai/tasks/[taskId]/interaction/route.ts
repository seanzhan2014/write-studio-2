import { readStudioState, applyStudioChanges, getDatabase } from "@/db/runtime";
import { currentTaskExecutionOrigin } from "@/db/task-execution";
import { diffStudioData } from "@/lib/studio-changes";
import { parseTaskHistory } from "@/lib/task-history";
import { isTaskAwaitingAuthor, validatePreparationReply } from "@/lib/writing-preparation";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const body = await request.json().catch(() => null) as { action: string; revision: number; draft?: unknown; brief?: string } | null;
  if (!body || !["draft", "reply", "edit_brief", "finish", "confirm"].includes(body.action) || !Number.isInteger(body.revision)) return Response.json({ error: "互动操作无效" }, { status: 400 });
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await readStudioState();
      const next = structuredClone(current.data);
      const task = next?.tasks.find((item) => item.id === taskId);
      const preparation = task?.contextOptions?.writingPreparation;
      if (!task || !preparation) return Response.json({ error: "写作准备任务不存在" }, { status: 404 });
      if (task.executionOrigin !== currentTaskExecutionOrigin()) return Response.json({ error: "请先将任务转移到当前运行端，再继续讨论" }, { status: 409 });
      const repairingPlan = task.state === "failed" && task.error?.startsWith("写作准备稿检查未通过") && body.action === "edit_brief";
      if ((!isTaskAwaitingAuthor(task) && !repairingPlan) || preparation.revision !== body.revision) return Response.json({ error: "任务已继续或准备稿已更新，请检查最新状态后再操作" }, { status: 409 });
      const now = new Date().toISOString();
      if (body.action === "draft" || body.action === "reply") {
        if (preparation.stage !== "awaiting_author") return Response.json({ error: "当前没有待回答的问题" }, { status: 409 });
        const reply = validatePreparationReply(body.draft, preparation.questions, body.action === "reply");
        if (body.action === "draft") preparation.draft = reply;
        else {
          preparation.history.push({ round: preparation.round + 1, brief: preparation.brief, questions: preparation.questions, reply, at: now });
          preparation.stage = "preparing";
          preparation.draft = { answers: {}, note: "" };
          preparation.revision += 1;
          task.phase = "queued";
          task.attempt = 0;
        }
      } else if (body.action === "edit_brief") {
        if (typeof body.brief !== "string" || !body.brief.trim() || body.brief.length > 60000) return Response.json({ error: "准备稿不能为空或超过 60,000 字符" }, { status: 400 });
        preparation.brief = body.brief.trim();
        delete preparation.scenePlan;
        delete preparation.planCheck;
        if (repairingPlan) {
          preparation.stage = "awaiting_confirmation";
          preparation.questions = [];
          delete preparation.confirmedAt;
          delete preparation.autoApprovedAt;
          task.state = "waiting";
          task.phase = "awaiting_confirmation";
          task.attempt = 0;
          task.error = undefined;
          task.completedAt = undefined;
        }
        if (body.draft !== undefined && preparation.stage === "awaiting_author") preparation.draft = validatePreparationReply(body.draft, preparation.questions);
        preparation.revision += 1;
      } else if (body.action === "finish") {
        const reply = body.draft === undefined ? preparation.draft : validatePreparationReply(body.draft, preparation.questions);
        if (preparation.stage === "awaiting_author" && (reply.note.trim() || Object.keys(reply.answers).length)) {
          preparation.history.push({ round: preparation.round + 1, brief: preparation.brief, questions: preparation.questions, reply, at: now });
          preparation.finishAfterReply = true;
          preparation.stage = "preparing";
          preparation.draft = { answers: {}, note: "" };
          task.phase = "queued";
          task.attempt = 0;
        } else {
          preparation.stage = "awaiting_confirmation";
          task.phase = "awaiting_confirmation";
        }
        preparation.revision += 1;
      } else {
        if (preparation.stage !== "awaiting_confirmation" || !preparation.brief.trim()) return Response.json({ error: "请先完成讨论并确认准备稿" }, { status: 409 });
        preparation.stage = "writing";
        preparation.confirmedAt = now;
        preparation.revision += 1;
        task.phase = "queued";
        task.attempt = 0;
      }
      task.lastProgressAt = now;
      const saved = await applyStudioChanges(diffStudioData(current.data!, next!), current.revision, { taskInteractionId: taskId });
      if (saved.conflict) continue;
      task.history = parseTaskHistory(await getDatabase().prepare("SELECT history_json FROM ai_tasks WHERE id=?").bind(taskId).first<string>("history_json"));
      return Response.json({ task, revision: saved.revision }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "任务正在更新，请稍后再试" }, { status: 409 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "互动保存失败" }, { status: 400 });
  }
}
