import { reasoningEffortError, type ReasoningOptions } from "@/lib/reasoning-options";
import { AiInputError, streamChat } from "@/db/ai";
import { claimChatRequest } from "@/db/runtime";
import type { SelectedAiContext } from "@/lib/ai-context";
import { chatOptions, managedChatStream, readChatTask, recoverChatTasks } from "@/db/chat-tasks";
import { currentTaskExecutionOrigin } from "@/db/task-execution";

async function requestHash(input: ReasoningOptions & { outlineId: string; sessionId?: string; message: string; model?: string; includePrevious?: boolean; includeCharacters?: boolean }) {
  const encoded = new TextEncoder().encode(JSON.stringify([
    input.outlineId,
    input.sessionId ?? "",
    input.message,
    input.model ?? "",
    input.includePrevious !== false,
    input.includeCharacters !== false,
    input.reasoningEffort === undefined ? "inherit" : input.reasoningEffort,
  ]));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request, context: { params: Promise<{ outlineId: string }> }) {
  try {
    const { outlineId } = await context.params;
    const body = await request.json() as ReasoningOptions & { message?: string; model?: string; includePrevious?: boolean; includeCharacters?: boolean; sessionId?: string; requestId?: string; context?: SelectedAiContext };
    const effortError = reasoningEffortError(body.reasoningEffort);
    if (effortError) return Response.json({ error: effortError }, { status: 400 });
    if (!body.message?.trim()) return Response.json({ error: "消息不能为空" }, { status: 400 });
    const headerRequestId = request.headers.get("idempotency-key")?.trim();
    const bodyRequestId = body.requestId?.trim();
    if (headerRequestId && bodyRequestId && headerRequestId !== bodyRequestId) return Response.json({ error: "请求 ID 不一致" }, { status: 400 });
    const requestId = headerRequestId || bodyRequestId;
    await recoverChatTasks();
    const task = requestId ? await readChatTask(requestId) : null;
    if (task && (task.outline_id !== outlineId || chatOptions(task).sessionId !== body.sessionId || task.execution_origin !== currentTaskExecutionOrigin())) return Response.json({ error: "聊天任务与当前会话不匹配" }, { status: 409 });
    if (task && task.status !== "running") return Response.json({ error: "聊天任务已结束，请刷新查看结果" }, { status: 409 });
    if (requestId) {
      if (requestId.length > 200) return Response.json({ error: "请求 ID 无效" }, { status: 400 });
      const fingerprint = await requestHash({ outlineId, sessionId: body.sessionId, message: body.message, model: body.model, reasoningEffort: body.reasoningEffort, includePrevious: body.includePrevious, includeCharacters: body.includeCharacters });
      const claim = await claimChatRequest(requestId, fingerprint);
      if (claim !== "claimed") {
        console.info(JSON.stringify({ event: "chat_request_rejected", requestId, outlineId, reason: claim }));
        return Response.json({ error: claim === "duplicate" ? "该消息已经提交，请等待现有任务完成" : "请求 ID 已用于其他消息" }, { status: 409, headers: { "Cache-Control": "no-store", "X-Writer-Studio-Request-Id": requestId } });
      }
      console.info(JSON.stringify({ event: "chat_request_claimed", requestId, outlineId }));
    }
    const stream = task ? await managedChatStream(task) : await streamChat({ outlineId, message: body.message.slice(0, 20000), model: body.model, reasoningEffort: body.reasoningEffort, includePrevious: body.includePrevious, includeCharacters: body.includeCharacters, sessionId: body.sessionId, context: body.context }, request.signal);
    // Vinext's development response adapter can keep a locally produced
    // ReadableStream open after all chunks were sent. Buffer only the tiny local
    // PoC reply so the browser receives an immediate, definitively closed body;
    // configured model responses remain genuinely streamed.
    const localBody = body.model ? null : await new Response(stream).arrayBuffer();
    const responseBody = localBody ?? stream;
    return new Response(responseBody, { headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      ...(task ? { "X-Writer-Studio-Chat-Managed": "1" } : {}),
      ...(requestId ? { "X-Writer-Studio-Request-Id": requestId } : {}),
      ...(localBody ? { "Content-Length": String(localBody.byteLength), "X-Writer-Studio-Stream-Terminator": "record-separator" } : {}),
    } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "AI Chat 失败" }, { status: error instanceof AiInputError ? 422 : 502 }); }
}
