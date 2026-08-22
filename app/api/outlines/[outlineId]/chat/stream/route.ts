import { AiInputError, streamChat } from "@/db/ai";
import { claimChatRequest } from "@/db/runtime";
import type { SelectedAiContext } from "@/lib/ai-context";

async function requestHash(input: { outlineId: string; sessionId?: string; message: string; model?: string; includePrevious?: boolean; includeCharacters?: boolean }) {
  const encoded = new TextEncoder().encode(JSON.stringify([
    input.outlineId,
    input.sessionId ?? "",
    input.message,
    input.model ?? "",
    input.includePrevious !== false,
    input.includeCharacters !== false,
  ]));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request, context: { params: Promise<{ outlineId: string }> }) {
  try {
    const { outlineId } = await context.params;
    const body = await request.json() as { message?: string; model?: string; includePrevious?: boolean; includeCharacters?: boolean; sessionId?: string; requestId?: string; context?: SelectedAiContext };
    if (!body.message?.trim()) return Response.json({ error: "消息不能为空" }, { status: 400 });
    const headerRequestId = request.headers.get("idempotency-key")?.trim();
    const bodyRequestId = body.requestId?.trim();
    if (headerRequestId && bodyRequestId && headerRequestId !== bodyRequestId) return Response.json({ error: "请求 ID 不一致" }, { status: 400 });
    const requestId = headerRequestId || bodyRequestId;
    if (requestId) {
      if (requestId.length > 200) return Response.json({ error: "请求 ID 无效" }, { status: 400 });
      const fingerprint = await requestHash({ outlineId, sessionId: body.sessionId, message: body.message, model: body.model, includePrevious: body.includePrevious, includeCharacters: body.includeCharacters });
      const claim = await claimChatRequest(requestId, fingerprint);
      if (claim !== "claimed") {
        console.info(JSON.stringify({ event: "chat_request_rejected", requestId, outlineId, reason: claim }));
        return Response.json({ error: claim === "duplicate" ? "该消息已经提交，请等待现有任务完成" : "请求 ID 已用于其他消息" }, { status: 409, headers: { "Cache-Control": "no-store", "X-Writer-Studio-Request-Id": requestId } });
      }
      console.info(JSON.stringify({ event: "chat_request_claimed", requestId, outlineId }));
    }
    const stream = await streamChat({ outlineId, message: body.message.slice(0, 20000), model: body.model, includePrevious: body.includePrevious, includeCharacters: body.includeCharacters, sessionId: body.sessionId, context: body.context }, request.signal);
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
      ...(requestId ? { "X-Writer-Studio-Request-Id": requestId } : {}),
      ...(localBody ? { "Content-Length": String(localBody.byteLength), "X-Writer-Studio-Stream-Terminator": "record-separator" } : {}),
    } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "AI Chat 失败" }, { status: error instanceof AiInputError ? 422 : 502 }); }
}
