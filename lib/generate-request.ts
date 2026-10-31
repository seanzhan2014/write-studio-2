import {
  isClosingSummaryLengthInput, isContentGenerationMode, isDialogueDensity, isProseControls,
  isRewriteRetentionLevel, MAX_GENERATE_TARGET_WORDS, MIN_GENERATE_TARGET_WORDS,
  normalizeClosingSummaryLength, normalizeContentGenerationMode, normalizeProseControls,
  normalizeRewriteRetentionLevel,
} from "./generate-options.ts";
import { reasoningEffortError } from "./reasoning-options.ts";
import { readJsonObject, RequestInputError } from "./request-input.ts";
import type { generateText } from "../db/ai";

/** Shared validation for direct generation and persisted task snapshots. */
export function parseGenerateFields(body: Record<string, unknown>, target: string) {
  const content = target === "content";
  const validate = (valid: boolean, message: string) => { if (!valid) throw new RequestInputError(message); };
  validate(!content || body.contentMode === undefined || isContentGenerationMode(body.contentMode), "正文生成模式无效");
  validate(!content || body.rewriteRetention === undefined || isRewriteRetentionLevel(body.rewriteRetention), "原文保留度无效");
  validate(!content || body.dialogueDensity === undefined || isDialogueDensity(body.dialogueDensity), "对话密度无效");
  validate(!content || body.proseControls === undefined || isProseControls(body.proseControls), "正文控制参数无效");
  validate(!content || body.closingSummaryLength === undefined || isClosingSummaryLengthInput(body.closingSummaryLength), "收尾长度无效");
  const contentMode = normalizeContentGenerationMode(body.contentMode);
  const targetWords = body.targetWords == null || String(body.targetWords).trim() === "" || Number(body.targetWords) === 0 ? undefined : Number(body.targetWords);
  validate(!content || targetWords === undefined || (Number.isInteger(targetWords) && targetWords >= MIN_GENERATE_TARGET_WORDS && targetWords <= MAX_GENERATE_TARGET_WORDS), `目标字数必须为 ${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数，或留空表示不限字数`);
  return {
    contentMode,
    rewriteRetention: content && contentMode === "rewrite" ? normalizeRewriteRetentionLevel(body.rewriteRetention) : undefined,
    proseControls: normalizeProseControls(body.proseControls, body.dialogueDensity),
    closingSummaryLength: normalizeClosingSummaryLength(body.closingSummaryLength, body.includeClosingSummary),
    targetWords,
  };
}

export async function readGenerateRequest(request: Request): Promise<Parameters<typeof generateText>[0]> {
  const body = await readJsonObject(request);
  const effortError = reasoningEffortError(body.reasoningEffort);
  if (effortError) throw new RequestInputError(effortError);
  const target = String(body.target ?? "");
  if (!["content", "outline", "chapter-title"].includes(target)) throw new RequestInputError("生成目标无效");
  const instruction = String(body.instruction ?? "").trim();
  if (instruction.length > 20000) throw new RequestInputError("补充指令不能超过 20,000 字符");
  if (target !== "content" && !instruction) throw new RequestInputError("结构生成指令不能为空");
  const fields = parseGenerateFields(body, target);
  const includeExcellentFragments = target === "content" && body.includeExcellentFragments === true;
  return {
    ...body, ...fields, target, instruction, includeExcellentFragments,
    contentMode: target === "content" ? fields.contentMode : undefined,
    proseControls: target === "content" ? fields.proseControls : undefined,
    dialogueDensity: target === "content" ? fields.proseControls.dialogueDensity : undefined,
    excellentFragmentIds: includeExcellentFragments && Array.isArray(body.excellentFragmentIds) ? [...new Set(body.excellentFragmentIds.map(String))].slice(0, 200) : undefined,
  } as Parameters<typeof generateText>[0];
}
