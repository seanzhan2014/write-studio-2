import { readGenerateRequest } from "@/lib/generate-request";
import { RequestInputError } from "@/lib/request-input";
import { AiInputError } from "@/db/ai-errors";
import { assertAiTargetAvailable } from "@/db/ai-prompts";
import { generateText } from "@/db/ai";
import { ensureDatabase, getDatabase } from "@/db/runtime";

export async function POST(request: Request) {
  let body: Parameters<typeof generateText>[0];
  try {
    body = await readGenerateRequest(request);
  } catch (error) {
    if (!(error instanceof RequestInputError)) throw error;
    return Response.json({ error: error.message }, { status: 400 });
  }
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
