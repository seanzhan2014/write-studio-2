import { AiInputError, AiPromptTooLongError, generateIllustrationPrompt, generateIllustrationImage } from "@/db/ai";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AiInputError("插图请求无效");
    if (body.action === "prompt") return Response.json(await generateIllustrationPrompt(body, request.signal), { headers: { "Cache-Control": "no-store" } });
    if (body.action === "image") return Response.json(await generateIllustrationImage(body, request.signal), { headers: { "Cache-Control": "no-store" } });
    throw new AiInputError("插图操作无效");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "插图生成失败" }, {
      status: error instanceof AiPromptTooLongError ? 413 : error instanceof AiInputError || error instanceof SyntaxError ? 400 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
