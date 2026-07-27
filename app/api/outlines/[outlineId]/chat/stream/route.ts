import { AiInputError, streamChat } from "@/db/ai";

export async function POST(request: Request, context: { params: Promise<{ outlineId: string }> }) {
  try {
    const { outlineId } = await context.params;
    const body = await request.json() as { message?: string; model?: string; includePrevious?: boolean; includeCharacters?: boolean; sessionId?: string };
    if (!body.message?.trim()) return Response.json({ error: "消息不能为空" }, { status: 400 });
    const stream = await streamChat({ outlineId, message: body.message.slice(0, 20000), model: body.model, includePrevious: body.includePrevious, includeCharacters: body.includeCharacters, sessionId: body.sessionId }, request.signal);
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "AI Chat 失败" }, { status: error instanceof AiInputError ? 422 : 502 }); }
}
