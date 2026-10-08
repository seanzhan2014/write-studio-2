import { taskReasoningEffort } from "@/lib/reasoning-options";
import { createReviewRuleSnapshot, normalizeReviewRuleSnapshot, reviewRulesText } from "@/lib/review-rules.mjs";
import type { AiTask } from "@/app/studio-state";
import { AiInputError, AiUpstreamCompletionError, reviewGeneratedText, reviseGeneratedText } from "@/db/ai";
import { getDatabase } from "@/db/runtime";
import { runGenerateReview, type GenerateReviewCheckpoint, type GenerateReviewDraft } from "@/lib/generate-review.mjs";

export async function generateWithReview(task: AiTask, runnerId: string, model: string, checkpointJson: unknown, generate: () => Promise<GenerateReviewDraft>, signal: AbortSignal) {
  const options = task.contextOptions!;
  if (!options.promptContext) throw new AiInputError("自动审校缺少生成上下文，请重新创建任务");
  const checkpoint = checkpointJson ? JSON.parse(String(checkpointJson)) as GenerateReviewCheckpoint : undefined;
  const preparationInputTokens = options.writingPreparation ? Math.max(0, (task.inputTokens ?? 0) - (checkpoint?.inputTokens ?? 0)) : 0;
  const preparationOutputTokens = options.writingPreparation ? Math.max(0, (task.outputTokens ?? 0) - (checkpoint?.outputTokens ?? 0)) : 0;
  const db = getDatabase();
  async function progress(phase: AiTask["phase"], round: number, error?: string) {
    if (signal.aborted) throw new Error("任务已取消");
    const now = new Date().toISOString();
    const result = await db.prepare("UPDATE ai_tasks SET phase=?,context_options_json=json_set(context_options_json,'$.reviewRound',?),last_progress_at=?,error_message=? WHERE id=? AND status='running' AND runner_id=?")
      .bind(phase, round, now, error ?? null, task.id, runnerId).run();
    if (!result.meta?.changes) throw new Error("任务已取消或执行权已转移");
    await db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key='state_revision'").bind(now).run();
  }
  async function attempt<T>(phase: AiTask["phase"], round: number, operation: () => Promise<T>): Promise<T> {
    for (let retry = 0; ; retry++) {
      await progress(phase, round);
      try { return await operation(); }
      catch (error) {
        if (signal.aborted || retry >= 2 || error instanceof AiInputError || (error instanceof AiUpstreamCompletionError && !error.retryable)) throw error;
        await progress("retrying", round, error instanceof Error ? error.message : "模型请求失败");
        await new Promise((resolve) => setTimeout(resolve, (retry + 1) * 1000));
      }
    }
  }
  const ruleSnapshot = options.reviewRuleSnapshot ? normalizeReviewRuleSnapshot(options.reviewRuleSnapshot) : createReviewRuleSnapshot({ id: task.articleId, reviewRules: options.reviewRules }, options.reviewInstruction);
  const common = {
    reasoningEffort: Object.hasOwn(options, "reviewResolvedReasoningEffort") ? options.reviewResolvedReasoningEffort : taskReasoningEffort(options),
    outlineId: task.outlineId, model: options.reviewConfiguredModelId ?? model, context: options.promptContext,
    reviewStrategy: options.reviewStrategy,
    instruction: task.prompt, targetWords: options.targetWords, contentMode: options.contentMode,
    proseControls: options.proseControls, dialogueDensity: options.dialogueDensity, rewriteRetention: options.rewriteRetention,
    writingBrief: options.writingPreparation?.stage === "writing" ? options.writingPreparation.brief : undefined,
    rules: reviewRulesText(ruleSnapshot), reviewInstruction: ruleSnapshot.instruction, ruleSnapshot,
  };
  const result = await runGenerateReview({
    maxRounds: options.reviewMaxRounds!, strategy: options.reviewStrategy, ruleSnapshot, rules: common.rules, instruction: common.reviewInstruction, checkpoint, signal,
    generate: () => attempt("generating", 0, generate),
    review: (text, issues, round) => attempt(round ? "verifying" : "reviewing", round, () => reviewGeneratedText({ ...common, text, issues }, signal)),
    revise: (text, issues, round) => attempt("revising", round, () => reviseGeneratedText({ ...common, text, issues }, signal)),
    save: async (state) => {
      const now = new Date().toISOString();
      const result = await db.prepare("UPDATE ai_tasks SET review_state_json=?,result_text=?,received_characters=?,input_tokens=?,output_tokens=?,last_progress_at=?,context_options_json=json_set(context_options_json,'$.reviewRound',?) WHERE id=? AND status='running' AND runner_id=?")
        .bind(JSON.stringify(state), state.draft.text, state.draft.text.length, preparationInputTokens + state.inputTokens, preparationOutputTokens + state.outputTokens, now, state.round, task.id, runnerId).run();
      if (!result.meta?.changes) throw new Error("任务已取消或执行权已转移");
      await db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key='state_revision'").bind(now).run();
    },
  });
  return { ...result, ...(result.report ? { report: { ...result.report, modelId: options.reviewModelId ?? options.modelId, modelName: options.reviewModelName ?? task.model } } : {}) };
}
