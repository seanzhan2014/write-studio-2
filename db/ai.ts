import { type ReasoningOptions } from "@/lib/reasoning-options";
import { readStudioState } from "@/db/studio-state";
import { type SelectedAiContext } from "@/lib/ai-context";

import { normalizeClosingSummaryLength, type ClosingSummaryLength, DEFAULT_GENERATE_TARGET_WORDS, normalizeContentGenerationMode, normalizeOptionalGenerateTargetWords, normalizeRewriteRetentionLevel, normalizeProseControls, generateExpressionSettings, type ContentGenerationMode, type RewriteRetentionLevel, type DialogueDensityLevel, type ProseControls } from "@/lib/generate-options";

import { DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile } from "@/lib/naming-options";

export { generateWritingPreparation } from "@/db/writing-preparation";
import { SCENE_WRITING_RULES } from "@/lib/narrative-craft";

import { GENERATE_FIELDS, normalizeAdvanced, type GenerateAdvanced } from "@/lib/advanced-writing";
import { compiledStyle, configurationOf, modelConfiguration, modelSettingsFingerprint } from "@/lib/style-learning";

import { type GenerateTarget, suppliedPromptContext, selectPromptContext, withOutlineTitleOutput, composeSystemPrompt, GENERATE_SYSTEM_PROMPTS, generatePrompt, normalizeGenerateResult } from "@/db/ai-prompts";

import { AiInputError } from "@/db/ai-errors";

import { findModel } from "@/db/ai-models";

import { localGenerate, appendContinuation } from "@/db/ai-local";

import { upstream, consumeUpstream, type ChatCompletionPayload, completionResult } from "@/db/ai-transport";

export async function generateText(input: { outlineId: string; instruction?: string; model?: string; target: GenerateTarget; includePrevious?: boolean; includeCharacters?: boolean; includeExcellentFragments?: boolean; excellentFragmentIds?: string[]; targetWords?: number; contentMode?: ContentGenerationMode; rewriteRetention?: RewriteRetentionLevel; advanced?: GenerateAdvanced; proseControls?: ProseControls; dialogueDensity?: DialogueDensityLevel; firstAppearanceCharacterIds?: string[]; includeOutlineTitle?: boolean; includeClosingSummary?: boolean; closingSummaryLength?: ClosingSummaryLength; context?: SelectedAiContext; writingBrief?: string } & ReasoningOptions, signal?: AbortSignal) {
  const contentMode = normalizeContentGenerationMode(input.contentMode);
  const rewriteRetention = normalizeRewriteRetentionLevel(input.rewriteRetention);
  const source = suppliedPromptContext(input.context, input.outlineId, input.target)
    ?? await selectPromptContext(input.outlineId, input.target, input);
  const instruction = String(input.instruction ?? "").trim();
  const targetWords = source.currentOutline.expansion ? undefined : normalizeOptionalGenerateTargetWords(input.targetWords);
  if (input.target === "content" && contentMode !== "fresh" && !source.currentOutline.content.trim()) {
    throw new AiInputError(contentMode === "rewrite" ? "当前正文为空，无法改写" : "当前正文为空，无法续写");
  }
  const includeOutlineTitle = input.target === "content" && input.includeOutlineTitle === true;
  const resolved = await resolveWritingSettings(source, input.model ?? "", input.advanced, input.proseControls, normalizeContentGenerationMode(input.contentMode));
  input = { ...input, advanced: resolved.advanced, proseControls: resolved.proseControls };
  const model = await findModel(input.model);
  if (input.model && !model) throw new AiInputError("所选模型不存在，请重新选择");
  const outlineNaming = normalizeNamingProfile(source.article.outlineNaming, DEFAULT_OUTLINE_NAMING_PROFILE);
  if (!model) return localGenerate(input.target, source.currentOutline.title, source.currentOutline.plan, source.currentOutline.content, instruction, source.currentOutline.expansion?.estimatedCharacters || targetWords || DEFAULT_GENERATE_TARGET_WORDS, includeOutlineTitle, contentMode, outlineNaming);
  const system = withOutlineTitleOutput(composeSystemPrompt(GENERATE_SYSTEM_PROMPTS[input.target], model.systemPrompt), includeOutlineTitle, outlineNaming);
  const prompt = generatePrompt(source, instruction, input.target, input.writingBrief ? `${system}\n正文遵循写作准备稿；原始资料中的事实与约束仍有效。未决项不得擅自写成事实。\n${SCENE_WRITING_RULES}` : system, targetWords, contentMode, rewriteRetention, model.maxInputCharacters, input.proseControls, input.dialogueDensity, input.writingBrief, input.advanced, "writing", normalizeClosingSummaryLength(input.closingSummaryLength, input.includeClosingSummary, normalizeContentGenerationMode(input.contentMode)));
  const handle = await upstream(model, prompt.messages, signal, false, { max_tokens: undefined }, input.reasoningEffort);
  const payload = await consumeUpstream(handle, (response) => response.json()) as ChatCompletionPayload;
  const completion = completionResult(payload, handle, "模型生成");
  const result = {
    ...normalizeGenerateResult(input.target, completion.content, includeOutlineTitle, outlineNaming),
    inputTokens: completion.diagnostics.promptTokens,
    outputTokens: completion.diagnostics.completionTokens,
    finishReason: completion.diagnostics.finishReason,
    upstreamRequestId: completion.diagnostics.requestId,
    upstreamProvider: completion.diagnostics.provider,
    upstreamResponseHeadersMs: completion.diagnostics.responseHeadersMs,
    upstreamTotalMs: completion.diagnostics.totalMs,
  };
  return input.target === "content" && contentMode === "continue"
    ? { ...result, text: appendContinuation(source.currentOutline.content, result.text) }
    : result;
}

export async function resolveWritingSettings(source: SelectedAiContext, modelId: string, advanced: GenerateAdvanced = {}, proseControls?: ProseControls, contentMode: ContentGenerationMode = "fresh") {
  advanced = normalizeAdvanced(advanced, GENERATE_FIELDS);
  if (source.article.calibrationHandled || source.article.id === "style-trial") return { source, advanced, proseControls };
  const state = (await readStudioState()).data;
  const article = state?.articles.find(a => a.id === source.article.id);
  if (!article) return { source, advanced, proseControls };
  const base = configurationOf(article, state?.settings); const selected = modelConfiguration(article, modelId, state?.settings);
  const model = selected.calibration ? await findModel(modelId) : null;
  const config = selected.calibration && (!model || selected.calibration.modelFingerprint !== modelSettingsFingerprint(model)) ? base : selected.configuration;
  // A chapter/outline's explicit style remains authoritative.
  if (source.article.style === compiledStyle(base)) source.article.style = compiledStyle(config);
  source.article.calibrationHandled = true;
  const baseExpression = generateExpressionSettings({ ...base.generate, contentMode });
  const expression = contentMode === "rewrite" ? baseExpression : config.generate;
  const controls = normalizeProseControls(proseControls ?? baseExpression.proseControls);
  for (const key of Object.keys(controls) as Array<keyof ProseControls>) {
    if (controls[key] === baseExpression.proseControls[key]) Object.assign(controls, { [key]: expression.proseControls[key] });
  }
  return { source, advanced: { ...expression.advanced, ...advanced }, proseControls: controls };
}

export async function styleLabCompletion(modelId: string, system: string, data: unknown, signal?: AbortSignal) {
  const model = await findModel(modelId);
  if (!model?.hasSecret) throw new AiInputError("请选择已配置密钥的文本模型");
  const content = JSON.stringify(data);
  if (system.length + content.length + 256 > model.maxInputCharacters) throw new AiInputError("参考材料超过此模型的输入上限，请减少材料或提高模型输入上限；材料不会静默截断");
  const handle = await upstream(model, [{ role: "system", content: system }, { role: "user", content }], signal, false, {}, model.reasoningEffort);
  const completion = completionResult(await consumeUpstream(handle, response => response.json()) as ChatCompletionPayload, handle, "风格学习与校准");
  let result: unknown;
  try { result = JSON.parse(completion.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new AiInputError("模型未返回有效 JSON，已保留进度，可重试本步骤"); }
  return { result, inputTokens: completion.diagnostics.promptTokens ?? 0, outputTokens: completion.diagnostics.completionTokens ?? 0 };
}

export { readProviderSecret, validateModelUrl, listModels, listProviders, findProvider, createProvider, updateProvider, deleteProvider, setProviderSecret, clearProviderSecret, exportModelsForSync, exportProvidersForSync, replaceModelsFromSync, findModel, createModels, createModel, updateModel, deleteModel, deleteModels, setModelSecret, clearModelSecret, readProviderCatalog, discoverProviderCatalog, discoverProviderModelIds, readProviderCatalogPage, testProvider, discoverModelIds } from "@/db/ai-models";
export type { AiProviderRecord, AiModelRecord, AiModelSyncRecord, AiProviderSyncRecord } from "@/db/ai-models";
export { isRetryableAiError } from "@/db/ai-transport";
export { AiUpstreamCompletionError, AiInputError, AiPromptTooLongError } from "@/db/ai-errors";
export { generateIllustrationPrompt, generateIllustrationImage, requestModelImage, testModel } from "@/db/ai-images";
export { assertAiTargetAvailable } from "@/db/ai-prompts";
export type { GenerateResult } from "@/db/ai-prompts";
export { generateNames, generateArticleNames } from "@/db/ai-naming";
export type { NameGenerationResult, NamingArticleContext, ArticleNameGenerationResult } from "@/db/ai-naming";
export { reviewGeneratedText, reviseGeneratedText, reviewChapter } from "@/db/ai-review";
export type { GeneratedTextReviewInput, AiReviewInput, AiReviewResult } from "@/db/ai-review";
export { streamChat } from "@/db/ai-chat";
