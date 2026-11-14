import { type ReasoningOptions } from "@/lib/reasoning-options";
import { readStudioState } from "@/db/studio-state";
import { type SelectedAiContext } from "@/lib/ai-context";

import { normalizeClosingSummaryLength, type ClosingSummaryLength, DEFAULT_GENERATE_TARGET_WORDS, normalizeContentGenerationMode, normalizeOptionalGenerateTargetWords, normalizeRewriteRetentionLevel, normalizeProseControls, generateExpressionSettings, type ContentGenerationMode, type RewriteRetentionLevel, type DialogueDensityLevel, type ProseControls } from "@/lib/generate-options";

import { DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile } from "@/lib/naming-options";

import { PREPARATION_SECTIONS, PREPARATION_SECTION_GUIDANCE, PREPARATION_RESPONSE_FORMAT, PreparationResponseError, parsePreparationResponse, normalizePreparationStrategy, PREPARATION_STRATEGY_LABELS, type WritingPreparation, type PreparationResponseDiagnostic } from "@/lib/writing-preparation";
import { NARRATIVE_CRAFT_RULES, PREPARATION_NARRATIVE_RULES } from "@/lib/narrative-craft";

import { GENERATE_FIELDS, normalizeAdvanced, type GenerateAdvanced } from "@/lib/advanced-writing";
import { compiledStyle, configurationOf, modelConfiguration, modelSettingsFingerprint } from "@/lib/style-learning";

import { type GenerateTarget, suppliedPromptContext, selectPromptContext, withOutlineTitleOutput, composeSystemPrompt, GENERATE_SYSTEM_PROMPTS, generatePrompt, generateMaxTokens, normalizeGenerateResult, escapeXml } from "@/db/ai-prompts";

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
  const prompt = generatePrompt(source, instruction, input.target, input.writingBrief ? `${system}\n正文遵循作者已确认的写作准备稿；原始资料中的事实与约束仍有效。未決项不得擅自写成事实。` : system, targetWords, contentMode, rewriteRetention, model.maxInputCharacters, input.proseControls, input.dialogueDensity, input.writingBrief, input.advanced, "writing", normalizeClosingSummaryLength(input.closingSummaryLength, input.includeClosingSummary, normalizeContentGenerationMode(input.contentMode)));
  const handle = await upstream(model, prompt.messages, signal, false, { max_tokens: generateMaxTokens(model, input.target) }, input.reasoningEffort);
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

export async function generateWritingPreparation(input: Parameters<typeof generateText>[0], preparation: WritingPreparation, signal?: AbortSignal) {
  const model = await findModel(input.model);
  if (!model) throw new AiInputError("请选择可用模型后重新执行写作准备任务");
  const source = suppliedPromptContext(input.context, input.outlineId, "content") ?? await selectPromptContext(input.outlineId, "content", input);
  const resolved = await resolveWritingSettings(source, input.model ?? "", input.advanced, input.proseControls, normalizeContentGenerationMode(input.contentMode));
  input = { ...input, advanced: resolved.advanced, proseControls: resolved.proseControls };
  const strategy = normalizePreparationStrategy(preparation.strategy);
  const strategyRules = strategy === "minimal"
    ? "最少条件型讨论：只询问阻碍写出连贯正文的关键未知、事实矛盾或需要作者决定的重要情节。只要目标、行动因果、人物认知边界及必要约束足够明确，就必须返回空 questions。可由正常写作处理的措辞、动作细节和非必要偏好，不向作者提问。"
    : "最大探索型讨论：在轮次上限内主动探索人物动机、情节分支、关系、伏笔、视角和表达的有价值选择。每题必须说明新增选择如何改变本篇写作；没有有价值的新问题时必须返回空 questions。不要推翻作者已经明确的决定。";
  const schema = { brief: Object.fromEntries(PREPARATION_SECTIONS.map(([key, title]) => [key, `${title}：${PREPARATION_SECTION_GUIDANCE[key]}`])), questions: [] };
  const system = `${composeSystemPrompt("你是写作准备助手。只整理写作准备稿并向作者提问，此阶段禁止输出最终正文。", model.systemPrompt)}\n写作前准备任务：必须只返回有效 JSON，格式为 ${JSON.stringify(schema)}。brief 九项缺一不可，必须原样使用示例的英文键名，每项值均为非空字符串（不超过6000字符），不得改成数组或对象。不适用、未知或无需展开时也要用文字明确说明，不得省略或返回空值。target_characters、正文控制与文风设置用于安排后续正文，不要求准备稿本身写成小说或达到正文篇幅。需要提问时 questions 每项为 {id,title,reason,options:[{id,label,description}]}，最多三题，每题最多四个选项，自由回答题使用 options:[]。选项不要预先代作者决定。\n${strategyRules}\n两种策略都允许提前结束。最大轮次只是上限，不是目标；禁止为用满次数而提问，禁止重复已经回答的问题。达到上限或作者选择提前结束时，必须返回空 questions，并在准备稿中保留未决项，说明正文如何留白或避开未确认事实。\n从大纲、前文和人物资料区分事实、推测和未知项，明确人物目标、知道和不知道的事项、认知变化所需证据及行动顺序。未知事实不能编造，作者尚未决定的事项必须在准备稿中标明。整合之前准备稿及所有作者回答（包括自由文字与手动修改）。`;
  const instruction = `${input.instruction ?? "按大纲准备写作"}\n\n<preparation_progress>\n${escapeXml(JSON.stringify({ strategy: PREPARATION_STRATEGY_LABELS[strategy], maxRounds: preparation.maxRounds, answeredRounds: preparation.history.length, finishAfterReply: preparation.finishAfterReply === true, previousBrief: preparation.brief, history: preparation.history }))}\n</preparation_progress>`;
  const parameters = model.metadata?.supportedParameters;
  let responseFormat: typeof PREPARATION_RESPONSE_FORMAT | undefined = Array.isArray(parameters) && !parameters.includes("response_format") ? undefined : PREPARATION_RESPONSE_FORMAT;
  let feedback = "", inputTokens = 0, outputTokens = 0;
  const diagnostics: PreparationResponseDiagnostic[] = [];
  for (let attempt = 0; ; attempt++) {
    const prompt = generatePrompt(source, instruction + feedback, "content", `${system}\n${NARRATIVE_CRAFT_RULES}\n${PREPARATION_NARRATIVE_RULES}`, input.targetWords, normalizeContentGenerationMode(input.contentMode), input.rewriteRetention, model.maxInputCharacters, input.proseControls, input.dialogueDensity, undefined, input.advanced, "preparation", normalizeClosingSummaryLength(input.closingSummaryLength, input.includeClosingSummary, normalizeContentGenerationMode(input.contentMode)));
    const request = () => upstream(model, prompt.messages, signal, false, { max_tokens: model.maxOutput ?? 16384, ...(responseFormat ? { response_format: responseFormat } : {}) }, input.reasoningEffort);
    let handle;
    try { handle = await request(); }
    catch (error) {
      // Older compatible providers may reject structured output; do not retry other errors.
      const message = error instanceof Error ? error.message : "";
      if (!responseFormat || !/模型返回 (400|404|422)：/.test(message) || !/response_format|json_schema|structured.outputs/i.test(message) || !/unsupported|not supported|does not support|unrecognized|unknown|not allowed/i.test(message)) throw error;
      responseFormat = undefined;
      handle = await request();
    }
    const payload = await consumeUpstream(handle, (response) => response.json()) as ChatCompletionPayload;
    const completion = completionResult(payload, handle, "写作准备");
    inputTokens += completion.diagnostics.promptTokens ?? 0;
    outputTokens += completion.diagnostics.completionTokens ?? 0;
    try { return { ...parsePreparationResponse(completion.content), inputTokens, outputTokens }; }
    catch (error) {
      if (!(error instanceof PreparationResponseError)) throw error;
      diagnostics.push({ attempt: attempt + 1, error: error.message, requestId: completion.diagnostics.requestId, provider: completion.diagnostics.provider, finishReason: completion.diagnostics.finishReason, outputCharacters: completion.content.length, response: completion.content.slice(0, 8000), truncated: completion.content.length > 8000 });
      error.diagnostics = diagnostics; error.inputTokens = inputTokens; error.outputTokens = outputTokens;
      console.warn(JSON.stringify({ event: "ai_preparation_format_error", model: model.modelId, ...completion.diagnostics, attempt: attempt + 1, validationError: error.message, willRepair: attempt < 1 && !signal?.aborted }));
      if (attempt >= 1 || signal?.aborted) throw error;
      feedback = `\n\n<preparation_format_repair>\n上一次准备稿未通过格式校验：${escapeXml(error.message)}。请依据相同原始资料重新返回完整的准备稿 JSON，使用约定的九个英文键和非空字符串。不要返回解释或最终正文，不要为补齐格式编造事实，未知项明确保留为未知。\n</preparation_format_repair>`;
    }
  }
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
