import { AiInputError, AiPromptTooLongError, generateNames } from "@/db/ai";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Parameters<typeof generateNames>[0];
    if (body.target !== "outline" && body.target !== "chapter") return Response.json({ error: "命名目标无效" }, { status: 400 });
    body.articleId = String(body.articleId ?? "");
    body.chapterId = String(body.chapterId ?? "");
    body.outlineId = body.outlineId ? String(body.outlineId) : undefined;
    body.model = String(body.model ?? "");
    body.instruction = String(body.instruction ?? "").trim();
    body.includeChapter = body.includeChapter !== false;
    body.outlineIds = Array.isArray(body.outlineIds) ? [...new Set(body.outlineIds.map(String))].slice(0, 500) : undefined;
    body.reservedTitles = Array.isArray(body.reservedTitles) ? body.reservedTitles.map(String).slice(0, 500) : undefined;
    if (!body.articleId || !body.chapterId || (body.target === "outline" && !body.outlineId)) return Response.json({ error: "命名目标不完整" }, { status: 400 });
    if (body.instruction.length > 20000) return Response.json({ error: "补充要求不能超过 20,000 字符" }, { status: 400 });
    return Response.json(await generateNames(body, request.signal));
  } catch (error) {
    const status = error instanceof AiPromptTooLongError ? 413 : error instanceof AiInputError ? 422 : 502;
    return Response.json({
      error: error instanceof Error ? error.message : "名称生成失败",
      ...(error instanceof AiPromptTooLongError ? { inputCharacters: error.inputCharacters, maxInputCharacters: error.maxInputCharacters } : {}),
    }, { status });
  }
}
