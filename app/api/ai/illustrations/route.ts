import { AiInputError, AiPromptTooLongError } from "@/db/ai-errors";
import { generateIllustrationPrompt, generateIllustrationImage } from "@/db/ai-images";
import { createIllustration, listIllustrations, saveManualPrompt, saveCompletedIllustration, prepareIllustrationReference, type IllustrationInput } from "@/db/illustrations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const offset = Math.max(0, Math.floor(Number(query.get("offset")) || 0));
    return Response.json(await listIllustrations(query.get("outlineId"), offset), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "历史读取失败" }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AiInputError("插图请求无效");
    if (body.action === "save-prompt") return Response.json({ record: await saveManualPrompt(body) }, { status: 201 });
    if (body.background === true) return Response.json({ record: await createIllustration(body, request.headers.get("Idempotency-Key") || crypto.randomUUID()) }, { status: 202, headers: { "Cache-Control": "no-store" } });
    if (body.action === "prompt" || body.action === "image") {
      const prepared = await prepareIllustrationReference(body) as IllustrationInput;
      const result = prepared.action === "prompt" ? await generateIllustrationPrompt({ ...prepared, content: prepared.content! }, request.signal) : await generateIllustrationImage({ ...prepared, prompt: prepared.prompt! }, request.signal);
      await saveCompletedIllustration(prepared, result);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    throw new AiInputError("插图操作无效");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "插图生成失败" }, {
      status: error instanceof AiPromptTooLongError ? 413 : error instanceof AiInputError || error instanceof SyntaxError ? 400 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
