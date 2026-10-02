import { reasoningEffortError } from "@/lib/reasoning-options";
import { AiInputError, assertAiTargetAvailable, generateText } from "@/db/ai";
import { ensureDatabase, getDatabase } from "@/db/runtime";
import { MAX_GENERATE_TARGET_WORDS, MIN_GENERATE_TARGET_WORDS, isDialogueDensity, isProseControls, normalizeProseControls, isContentGenerationMode, isRewriteRetentionLevel, normalizeContentGenerationMode, normalizeRewriteRetentionLevel } from "@/lib/generate-options";

export async function POST(request: Request) {
  let body: Parameters<typeof generateText>[0];
  try {
    body = await request.json() as Parameters<typeof generateText>[0];
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const effortError = reasoningEffortError(body.reasoningEffort);
  if (effortError) return Response.json({ error: effortError }, { status: 400 });
  if (!["content", "outline", "chapter-title"].includes(body.target)) return Response.json({ error: "生成目标无效" }, { status: 400 });
  body.instruction = String(body.instruction ?? "").trim();
  if (body.instruction.length > 20000) return Response.json({ error: "补充指令不能超过 20,000 字符" }, { status: 400 });
  if (body.target !== "content" && !body.instruction) return Response.json({ error: "结构生成指令不能为空" }, { status: 400 });
  if (body.target === "content" && body.contentMode !== undefined && !isContentGenerationMode(body.contentMode)) return Response.json({ error: "正文生成模式无效" }, { status: 400 });
  if (body.target === "content") body.contentMode = normalizeContentGenerationMode(body.contentMode);
  if (body.target === "content" && body.rewriteRetention !== undefined && !isRewriteRetentionLevel(body.rewriteRetention)) return Response.json({ error: "原文保留度无效" }, { status: 400 });
  body.rewriteRetention = body.target === "content" && body.contentMode === "rewrite" ? normalizeRewriteRetentionLevel(body.rewriteRetention) : undefined;
  if (body.target === "content" && body.dialogueDensity !== undefined && !isDialogueDensity(body.dialogueDensity)) return Response.json({ error: "对话密度无效" }, { status: 400 });
  if (body.target === "content" && body.proseControls !== undefined && !isProseControls(body.proseControls)) return Response.json({ error: "正文控制参数无效" }, { status: 400 });
  body.proseControls = body.target === "content" ? normalizeProseControls(body.proseControls, body.dialogueDensity) : undefined;
  body.dialogueDensity = body.proseControls?.dialogueDensity;
  body.includeExcellentFragments = body.target === "content" && body.includeExcellentFragments === true;
  body.excellentFragmentIds = body.includeExcellentFragments && Array.isArray(body.excellentFragmentIds) ? [...new Set(body.excellentFragmentIds.map(String))].slice(0, 200) : undefined;
  const targetWordsUnset = body.targetWords === undefined || body.targetWords === null || String(body.targetWords).trim() === "" || Number(body.targetWords) === 0;
  const targetWords = targetWordsUnset ? undefined : Number(body.targetWords);
  if (body.target === "content" && targetWords !== undefined && (!Number.isInteger(targetWords) || targetWords < MIN_GENERATE_TARGET_WORDS || targetWords > MAX_GENERATE_TARGET_WORDS)) return Response.json({ error: `目标字数必须为 ${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数，或留空表示不限字数` }, { status: 400 });
  if (body.target === "content") body.targetWords = targetWords;
  try {
    await assertAiTargetAvailable(body.outlineId);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "生成目标不可用" }, { status: error instanceof AiInputError ? 422 : 502 });
  }

  const encoder = new TextEncoder();
  const taskId = request.headers.get("Idempotency-Key")?.trim().slice(0, 200) ?? "";
  const upstreamController = new AbortController();
  let settled = false;
  const abortUpstream = () => upstreamController.abort("client-aborted");
  request.signal.addEventListener("abort", abortUpstream, { once: true });
  const cleanup = () => request.signal.removeEventListener("abort", abortUpstream);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // A JSON-leading space flushes the response immediately so the client can
      // cancel while the model is still running instead of waiting for buffering.
      controller.enqueue(encoder.encode(" "));
      if (taskId) void (async () => {
        await ensureDatabase();
        while (!settled && !upstreamController.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          const task = await getDatabase().prepare("SELECT status FROM ai_tasks WHERE id=?").bind(taskId).first<{ status: string }>();
          if (task?.status === "cancelled") abortUpstream();
        }
      })().catch(() => undefined);
      void generateText(body, upstreamController.signal)
        .then((result) => {
          if (!upstreamController.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(result)));
        })
        .catch((error) => {
          if (!upstreamController.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify({ error: error instanceof Error ? error.message : "生成失败" })));
        })
        .finally(() => {
          settled = true;
          cleanup();
          if (!upstreamController.signal.aborted) controller.close();
        });
    },
    cancel() {
      settled = true;
      abortUpstream();
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
