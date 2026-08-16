import { AiInputError, generateText } from "@/db/ai";
import { MAX_GENERATE_TARGET_WORDS, MIN_GENERATE_TARGET_WORDS, isContentGenerationMode, isRewriteRetentionLevel, normalizeContentGenerationMode, normalizeRewriteRetentionLevel } from "@/lib/generate-options";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Parameters<typeof generateText>[0];
    if (!["content", "outline", "chapter-title"].includes(body.target)) return Response.json({ error: "生成目标无效" }, { status: 400 });
    body.instruction = String(body.instruction ?? "").trim();
    if (body.instruction.length > 20000) return Response.json({ error: "补充指令不能超过 20,000 字符" }, { status: 400 });
    if (body.target !== "content" && !body.instruction) return Response.json({ error: "结构生成指令不能为空" }, { status: 400 });
    if (body.target === "content" && body.contentMode !== undefined && !isContentGenerationMode(body.contentMode)) return Response.json({ error: "正文生成模式无效" }, { status: 400 });
    if (body.target === "content") body.contentMode = normalizeContentGenerationMode(body.contentMode);
    if (body.target === "content" && body.rewriteRetention !== undefined && !isRewriteRetentionLevel(body.rewriteRetention)) return Response.json({ error: "原文保留度无效" }, { status: 400 });
    body.rewriteRetention = body.target === "content" && body.contentMode === "rewrite" ? normalizeRewriteRetentionLevel(body.rewriteRetention) : undefined;
    body.includeExcellentFragments = body.target === "content" && body.includeExcellentFragments === true;
    body.excellentFragmentIds = body.includeExcellentFragments && Array.isArray(body.excellentFragmentIds) ? [...new Set(body.excellentFragmentIds.map(String))].slice(0, 200) : undefined;
    const targetWordsUnset = body.targetWords === undefined || body.targetWords === null || String(body.targetWords).trim() === "" || Number(body.targetWords) === 0;
    const targetWords = targetWordsUnset ? undefined : Number(body.targetWords);
    if (body.target === "content" && targetWords !== undefined && (!Number.isInteger(targetWords) || targetWords < MIN_GENERATE_TARGET_WORDS || targetWords > MAX_GENERATE_TARGET_WORDS)) return Response.json({ error: `目标字数必须为 ${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数，或留空表示不限字数` }, { status: 400 });
    if (body.target === "content") body.targetWords = targetWords;
    return Response.json(await generateText(body, request.signal));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "生成失败" }, { status: error instanceof AiInputError ? 422 : 502 }); }
}
