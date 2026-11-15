import { resolveWritingSettings, type generateText } from "@/db/ai";
import { findModel, type AiModelRecord } from "@/db/ai-models";
import { AiInputError } from "@/db/ai-errors";
import { composeSystemPrompt, escapeXml, generatePrompt, suppliedPromptContext, selectPromptContext } from "@/db/ai-prompts";
import { upstream, consumeUpstream, completionResult, type ChatCompletionPayload } from "@/db/ai-transport";
import { normalizeClosingSummaryLength, normalizeContentGenerationMode } from "@/lib/generate-options";
import type { SelectedAiContext } from "@/lib/ai-context";
import { PREPARATION_SECTIONS, PREPARATION_SECTION_GUIDANCE, PREPARATION_RESPONSE_FORMAT, PreparationResponseError, PreparationQualityError, parsePreparationResponse, normalizePreparationStrategy, PREPARATION_STRATEGY_LABELS, type WritingPreparation } from "@/lib/writing-preparation";
import { PLAN_CHECK_RESPONSE_FORMAT, parsePlanIssues, preparationBriefDigest } from "@/lib/scene-plan";
import { NARRATIVE_CRAFT_RULES, PREPARATION_NARRATIVE_RULES, SCENE_PLANNING_RULES, PREPARATION_CHECK_RULES } from "@/lib/narrative-craft";

type Input = Parameters<typeof generateText>[0];
type Format = typeof PREPARATION_RESPONSE_FORMAT | typeof PLAN_CHECK_RESPONSE_FORMAT;

async function preparationStep<T>(input: Input, source: SelectedAiContext, model: AiModelRecord, system: string, instruction: string, format: Format, parse: (text: string) => T, signal?: AbortSignal) {
  const parameters = model.metadata?.supportedParameters;
  let responseFormat: Format | undefined = Array.isArray(parameters) && !parameters.includes("response_format") ? undefined : format;
  let feedback = "", inputTokens = 0, outputTokens = 0;
  const diagnostics: PreparationResponseError["diagnostics"] = [];
  for (let attempt = 0; ; attempt++) {
    const prompt = generatePrompt(source, instruction + feedback, "content", system, input.targetWords, normalizeContentGenerationMode(input.contentMode), input.rewriteRetention, model.maxInputCharacters, input.proseControls, input.dialogueDensity, undefined, input.advanced, "preparation", normalizeClosingSummaryLength(input.closingSummaryLength, input.includeClosingSummary, normalizeContentGenerationMode(input.contentMode)));
    const request = () => upstream(model, prompt.messages, signal, false, { max_tokens: model.maxOutput ?? 16384, ...(responseFormat ? { response_format: responseFormat } : {}) }, input.reasoningEffort);
    let handle;
    try { handle = await request(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!responseFormat || !/模型返回 (400|404|422)：/.test(message) || !/response_format|json_schema|structured.outputs/i.test(message) || !/unsupported|not supported|does not support|unrecognized|unknown|not allowed/i.test(message)) throw error;
      responseFormat = undefined;
      handle = await request();
    }
    const payload = await consumeUpstream(handle, response => response.json()) as ChatCompletionPayload;
    const completion = completionResult(payload, handle, format === PLAN_CHECK_RESPONSE_FORMAT ? "准备稿检查" : "写作准备");
    inputTokens += completion.diagnostics.promptTokens ?? 0;
    outputTokens += completion.diagnostics.completionTokens ?? 0;
    try { return { value: parse(completion.content), inputTokens, outputTokens }; }
    catch (cause) {
      const error = cause instanceof PreparationResponseError ? cause : new PreparationResponseError(cause instanceof Error ? cause.message : "准备稿返回格式无效");
      diagnostics.push({ attempt: attempt + 1, error: error.message, requestId: completion.diagnostics.requestId, provider: completion.diagnostics.provider, finishReason: completion.diagnostics.finishReason, outputCharacters: completion.content.length, response: completion.content.slice(0, 8000), truncated: completion.content.length > 8000 });
      error.diagnostics = diagnostics; error.inputTokens = inputTokens; error.outputTokens = outputTokens;
      console.warn(JSON.stringify({ event: "ai_preparation_format_error", model: model.modelId, ...completion.diagnostics, attempt: attempt + 1, validationError: error.message, willRepair: attempt < 1 && !signal?.aborted }));
      if (attempt >= 1 || signal?.aborted) throw error;
      feedback = `\n<preparation_format_repair>上一次返回未通过格式校验：${escapeXml(error.message)}。请依据相同原始资料按约定 JSON 结构重新完整返回。不要输出解释、正文或为补齐格式编造事实。</preparation_format_repair>`;
    }
  }
}

async function preparationSettings(input: Input) {
  const model = await findModel(input.model);
  if (!model) throw new AiInputError("请选择可用模型后重新执行写作准备任务");
  const source = suppliedPromptContext(input.context, input.outlineId, "content") ?? await selectPromptContext(input.outlineId, "content", input);
  const resolved = await resolveWritingSettings(source, input.model ?? "", input.advanced, input.proseControls, normalizeContentGenerationMode(input.contentMode));
  return { model, source, input: { ...input, advanced: resolved.advanced, proseControls: resolved.proseControls } };
}

async function checkPlan(input: Input, source: SelectedAiContext, model: AiModelRecord, brief: string, signal?: AbortSignal, preparation?: WritingPreparation) {
  const system = composeSystemPrompt(PREPARATION_CHECK_RULES, model.systemPrompt);
  const authorDecisions = preparation ? `<author_decisions>${escapeXml(JSON.stringify({ previousBrief: preparation.brief, history: preparation.history.map(item => ({ questions: item.questions, reply: item.reply })) }))}</author_decisions>` : "";
  const instruction = `${input.instruction ?? "按大纲准备写作"}\n${authorDecisions}\n<preparation_to_check>\n${escapeXml(brief)}\n</preparation_to_check>`;
  const result = await preparationStep(input, source, model, system, instruction, PLAN_CHECK_RESPONSE_FORMAT, parsePlanIssues, signal);
  return { issues: result.value, inputTokens: result.inputTokens, outputTokens: result.outputTokens, planCheck: result.value.length ? undefined : { briefDigest: await preparationBriefDigest(brief), checkedAt: new Date().toISOString() } };
}

/** Recheck edited and legacy briefs against the same frozen source before prose. */
export async function checkWritingPreparation(input: Input, preparation: WritingPreparation, signal?: AbortSignal) {
  const settings = await preparationSettings(input);
  return checkPlan(settings.input, settings.source, settings.model, preparation.brief, signal, preparation);
}

export async function generateWritingPreparation(initialInput: Input, preparation: WritingPreparation, signal?: AbortSignal) {
  const { model, source, input } = await preparationSettings(initialInput);
  const strategy = normalizePreparationStrategy(preparation.strategy);
  const strategyRules = strategy === "minimal"
    ? "最少条件型讨论：只询问阻碍写出连贯正文的关键未知、事实矛盾或需要作者决定的重要情节。只要目标、行动因果、人物认知边界及必要约束足够明确，就必须返回空 questions。可由正常写作处理的措辞、动作细节和非必要偏好，不向作者提问。"
    : "最大探索型讨论：在轮次上限内主动探索人物动机、情节分支、关系、伏笔、视角和表达的有价值选择。每题必须说明新增选择如何改变本篇写作；没有有价值的新问题时必须返回空 questions。不要推翻作者已经明确的决定。";
  const schema = { brief: Object.fromEntries(PREPARATION_SECTIONS.map(([key, title]) => [key, `${title}：${PREPARATION_SECTION_GUIDANCE[key]}`])), plan: { anchors: [{ id: "A1", fact: "原资料中的固定情节", source: "原资料的具体依据" }], creativeSpace: "允许创作的过程与表达", unresolved: [], scenes: [{ id: "S1", anchors: ["A1"], purpose: "本场作用", entry: "开场状态", goal: "人物目标", obstacle: "阻力或无冲突", actions: "有因果的行动过程", outcome: "结果变化", knowledge: "知情边界与揭示依据", transition: "承接与收束", treatment: "展开或概述及篇幅" }] }, questions: [] };
  const system = `${composeSystemPrompt("你是写作准备助手。只整理写作准备稿并向作者提问，此阶段禁止输出最终正文。", model.systemPrompt)}\n写作前准备任务：必须只返回有效 JSON，格式为 ${JSON.stringify(schema)}。brief 九项缺一不可，使用原样英文键名，每项值为非空字符串（最多6000字符）。plan 必须为完整场景计划对象。不适用、未知或无需展开时明确说明。questions 最多三题，每项为 {id,title,reason,options:[{id,label,description}]}，自由回答题使用 options:[]。\n${strategyRules}\n两种策略都允许提前结束。最大轮次只是上限，不是目标；禁止重复已经回答的问题。达到上限或作者选择提前结束时，必须返回空 questions，保留未决项，说明正文如何留白或避开未确认事实。整合之前准备稿及所有作者回答，包括自由文字与手动修改。\n${NARRATIVE_CRAFT_RULES}\n${PREPARATION_NARRATIVE_RULES}\n${SCENE_PLANNING_RULES}`;
  const instruction = `${input.instruction ?? "按大纲准备写作"}\n<preparation_progress>\n${escapeXml(JSON.stringify({ strategy: PREPARATION_STRATEGY_LABELS[strategy], maxRounds: preparation.maxRounds, answeredRounds: preparation.history.length, finishAfterReply: preparation.finishAfterReply === true, previousBrief: preparation.brief, history: preparation.history }))}\n</preparation_progress>`;
  let inputTokens = 0, outputTokens = 0;
  const usage = () => ({ inputTokens, outputTokens });
  async function step(instruction: string) {
    const result = await preparationStep(input, source, model, system, instruction, PREPARATION_RESPONSE_FORMAT, text => parsePreparationResponse(text, true), signal);
    inputTokens += result.inputTokens; outputTokens += result.outputTokens;
    if (preparation.history.length >= preparation.maxRounds || preparation.finishAfterReply) result.value.questions = [];
    return result.value;
  }
  let prepared = await step(instruction);
  // Author decisions are resolved through the existing discussion before auditing execution.
  if (prepared.questions.length) return { ...prepared, ...usage(), planCheck: undefined };
  try {
    for (let revision = 0; revision <= 1; revision++) {
      const checked = await checkPlan(input, source, model, prepared.brief, signal, preparation);
      inputTokens += checked.inputTokens; outputTokens += checked.outputTokens;
      if (!checked.issues.length) return { ...prepared, ...usage(), planCheck: checked.planCheck };
      if (revision === 1) throw new PreparationQualityError(prepared, checked.issues.map(issue => `${issue.sceneId}：${issue.problem}`), usage());
      prepared = await step(`${instruction}\n<preparation_plan_repair>\n${escapeXml(JSON.stringify({ brief: prepared.brief, issues: checked.issues }))}\n修正这些有依据的执行问题，返回完整准备稿和场景计划。保留原始事实及作者决定；不得新增关键设定或扩大改写范围。需要作者决定的未知内容留白；普通修正自行完成。\n</preparation_plan_repair>`);
      if (prepared.questions.length) return { ...prepared, ...usage(), planCheck: undefined };
    }
  } catch (error) {
    if (error instanceof PreparationResponseError && !(error instanceof PreparationQualityError)) {
      error.inputTokens += inputTokens; error.outputTokens += outputTokens;
    }
    throw error;
  }
  throw new Error("写作准备稿检查未完成");
}
