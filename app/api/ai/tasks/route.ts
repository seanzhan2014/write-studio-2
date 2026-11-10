import { normalizeOutlineExpansion, rebaseOutlineExpansion, resolveOutlineExpansion, validOutlineExpansion } from "@/lib/outline-expansion";
import { taskFromRow } from "@/lib/task-record";
import { parseGenerateFields } from "@/lib/generate-request";
import { readJsonObject, RequestInputError } from "@/lib/request-input";
import { normalizeTaskConcurrency } from "@/lib/task-concurrency";
import { GENERATE_FIELDS, normalizeAdvanced, advancedText } from "@/lib/advanced-writing";
import { parseTaskHistory } from "@/lib/task-history";
import { taskChangesOutline } from "@/lib/task-target";
import { registerIllustrationTasks } from "@/db/illustration-tasks";
import { createWritingPreparation, MAX_PREPARATION_ROUNDS, normalizePreparationStrategy, type WritingPreparation } from "@/lib/writing-preparation";
import { reasoningEffortError, resolveReasoningEffort, type ReasoningOptions } from "@/lib/reasoning-options";
import { normalizeReviewRuleItems, normalizeReviewRuleSnapshot, hasReviewRules, reviewRulesText } from "@/lib/review-rules.mjs";
import type { AiTask } from "@/lib/studio-types";
import { MAX_REVIEW_ROUNDS, normalizeReviewRules, normalizeReviewStrategy } from "@/lib/generate-review.mjs";
import { resolvedOutlineContent } from "@/lib/outline-content";
import { selectAiContext } from "@/lib/ai-context";
import { resolveWritingSettings } from "@/db/ai";
import { findModel } from "@/db/ai-models";
import { ensureDatabase, getDatabase, readStudioState } from "@/db/runtime";
import { hasActiveProseControls, normalizeAiGenerateOptions } from "@/lib/generate-options";
import { modelSelectionLabel } from "@/lib/model-label";
import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile } from "@/lib/naming-options";
import { resolveAiSettings } from "@/lib/ai-settings-inheritance";
import { normalizeTaskParameters, taskReviewSnapshot } from "@/lib/task-parameters";
import { detectFirstAppearanceCharacters, type SelectedAiContext } from "@/lib/ai-context";
import { currentTaskExecutionOrigin } from "@/db/task-execution";
import { recoverChatTasks } from "@/db/chat-tasks";
import type { NamingArticleContext } from "@/db/ai-naming";

type TaskTarget = "content" | "outline" | "chapter-title" | "all-names";
type TaskBody = Record<string, unknown> & ReasoningOptions & {
  articleId?: string;
  chapterId?: string;
  outlineId?: string;
  target?: TaskTarget;
  instruction?: string;
  model?: string;
  promptContext?: SelectedAiContext;
  namingContext?: NamingArticleContext;
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function uniqueStrings(value: unknown, maximum = 200) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))].slice(0, maximum) : undefined;
}

export async function GET() {
  try {
    await ensureDatabase();
    await registerIllustrationTasks();
    await recoverChatTasks();
    const db = getDatabase();
    const [result, revision] = await Promise.all([
      db.prepare("SELECT * FROM ai_tasks ORDER BY created_at DESC,rowid LIMIT 20").all<Record<string, unknown>>(),
      db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json"),
    ]);
    const tasks = (result.results ?? []).map(taskFromRow);
    return json({ data: tasks, tasks, runningOutlineIds: tasks.filter((task) => task.state === "running" && taskChangesOutline(task.target)).map((task) => task.outlineId), revision: Number(revision ?? 0) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "任务读取失败" }, error instanceof RequestInputError ? 400 : 500);
  }
}

export async function POST(request: Request) {
  try {
    const key = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!key || key.length > 200) return json({ error: "Idempotency-Key 无效" }, 400);
    const body = await readJsonObject(request) as TaskBody;
    const effortError = reasoningEffortError(body.reasoningEffort);
    if (effortError) return json({ error: effortError }, 400);
    const reviewEffortError = reasoningEffortError(body.reviewReasoningEffort);
    if (reviewEffortError) return json({ error: reviewEffortError }, 400);
    const articleId = String(body.articleId ?? "");
    const chapterId = String(body.chapterId ?? "");
    const outlineId = String(body.outlineId ?? "");
    const target = body.target;
    if (!articleId || !chapterId || !outlineId || !target || !["content", "outline", "chapter-title", "all-names"].includes(target)) return json({ error: "任务目标无效" }, 400);
    const instruction = String(body.instruction ?? "").trim().slice(0, 20_000);
    const preparationRounds = body.preparationRounds;
    if (body.preparationEnabled !== undefined && (target !== "content" || typeof body.preparationEnabled !== "boolean")) return json({ error: "写作准备开关必须为布尔值，仅支持正文生成" }, 400);
    if (preparationRounds !== undefined && (target !== "content" || typeof preparationRounds !== "number" || !Number.isInteger(preparationRounds) || preparationRounds < 0 || preparationRounds > MAX_PREPARATION_ROUNDS)) return json({ error: `写作互动轮次必须为 0–${MAX_PREPARATION_ROUNDS}` }, 400);
    if (body.preparationStrategy !== undefined && (preparationRounds === undefined || (body.preparationStrategy !== "minimal" && body.preparationStrategy !== "explore"))) return json({ error: "写作讨论策略无效" }, 400);
    if (body.preparationRequireConfirmation !== undefined && (preparationRounds === undefined || typeof body.preparationRequireConfirmation !== "boolean")) return json({ error: "准备稿确认设置必须为布尔值" }, 400);
    if (target !== "content" && target !== "all-names" && !instruction) return json({ error: "生成指令不能为空" }, 400);
    const { contentMode, rewriteRetention, closingSummaryLength, targetWords: rawTargetWords, proseControls: requestedProseControls } = parseGenerateFields(body, target);
    const reviewMaxRounds = Number(body.reviewMaxRounds ?? 0);
    if (!Number.isInteger(reviewMaxRounds) || reviewMaxRounds < 0 || reviewMaxRounds > MAX_REVIEW_ROUNDS || (target !== "content" && reviewMaxRounds !== 0)) return json({ error: `审校循环次数必须是 0–${MAX_REVIEW_ROUNDS} 的整数，仅支持正文生成` }, 400);
    let reviewInstruction = normalizeReviewRules(body.reviewInstruction);
    if (body.reviewStrategy !== undefined && body.reviewStrategy !== "minimal" && body.reviewStrategy !== "explore") return json({ error: "审校类型无效" }, 400);
    if (body.reviewModelMode !== undefined && body.reviewModelMode !== "inherit" && body.reviewModelMode !== "fixed") return json({ error: "审校模型设置无效" }, 400);
    if (body.reviewModel !== undefined && typeof body.reviewModel !== "string") return json({ error: "审校模型无效" }, 400);
    let proseControls = requestedProseControls;
    const dialogueDensity = proseControls.dialogueDensity;

    await ensureDatabase();
    const db = getDatabase();
    const existing = await db.prepare("SELECT * FROM ai_tasks WHERE id=?").bind(key).first<Record<string, unknown>>();
    if (existing) {
      const revision = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
      return json({ data: taskFromRow(existing), revision });
    }
    const snapshot = await readStudioState();
    const reviewStrategy = normalizeReviewStrategy(body.reviewStrategy ?? snapshot.data?.settings.generateReviewStrategy);
    if (body.reviewInstruction === undefined) reviewInstruction = normalizeReviewRules(snapshot.data?.settings.generateReviewInstruction);
    const outlineRow = await db.prepare(`SELECT o.summary,o.title,o.title_generation_pending,o.archived,c.archived AS chapter_archived,a.chapter_naming_json,a.outline_naming_json,a.review_rules,a.review_rule_items_json,a.created_at AS article_created_at
      FROM outlines o JOIN chapters c ON c.id=o.chapter_id JOIN articles a ON a.id=o.article_id
      WHERE o.id=? AND o.article_id=? AND o.chapter_id=?`).bind(outlineId, articleId, chapterId).first<Record<string, unknown>>();
    if (!outlineRow || Number(outlineRow.archived) || Number(outlineRow.chapter_archived)) return json({ error: "任务目标不存在或已归档" }, 422);
    const sourceArticle = snapshot.data?.articles.find(article => article.id === articleId);
    const scopedParameters = sourceArticle ? resolveAiSettings(sourceArticle, outlineId, "generate", "outline", snapshot.data!.settings).value.tasks! : {};
    const executionParameters = { ...scopedParameters, ...normalizeTaskParameters(body.taskParameters) };
    const preparationEnabled = preparationRounds !== undefined && (body.preparationEnabled ?? executionParameters.preparationEnabled) !== false;
    const reviewRuleSnapshot = taskReviewSnapshot({ id: articleId, createdAt: String(outlineRow.article_created_at), reviewRules: normalizeReviewRules(outlineRow.review_rules), reviewRuleItems: normalizeReviewRuleItems(outlineRow.review_rule_items_json == null ? undefined : JSON.parse(String(outlineRow.review_rule_items_json)), articleId, normalizeReviewRules(outlineRow.review_rules), String(outlineRow.article_created_at)) }, executionParameters, reviewInstruction, snapshot.data?.settings);
    if (reviewMaxRounds > 0 && body.reviewRuleSnapshot !== undefined && JSON.stringify(normalizeReviewRuleSnapshot(body.reviewRuleSnapshot)) !== JSON.stringify(reviewRuleSnapshot)) return json({ error: "文章 Review 规则已变更，请刷新后重新创建任务" }, 409);

    const executionOrigin = currentTaskExecutionOrigin();
    const activeCount = Number(await db.prepare("SELECT COUNT(*) AS count FROM ai_tasks WHERE execution_origin=? AND status IN ('queued','running')").bind(executionOrigin).first<number>("count") ?? 0);
    if (activeCount >= 20) return json({ error: "已有 20 个等待或运行中的任务，请先取消一个任务" }, 409);

    const requestedModel = String(body.model ?? "").trim();
    const configuredModel = requestedModel ? await findModel(requestedModel) : null;
    if (requestedModel && !configuredModel) return json({ error: "所选模型不存在，请重新选择" }, 422);
    if (preparationEnabled && (!configuredModel || !configuredModel.hasSecret)) return json({ error: "写作准备需要配置可用模型，请先选择模型" }, 422);
    if (reviewMaxRounds > 0 && (!configuredModel || !configuredModel.hasSecret)) return json({ error: "自动审校需要配置可用模型；循环次数为 0 时可使用本地引擎" }, 422);
    const reviewModelMode = (body.reviewModelMode ?? snapshot.data?.settings.reviewModelMode) === "fixed" ? "fixed" : "inherit";
    const reviewModelReference = String(body.reviewModel ?? snapshot.data?.settings.reviewModel ?? "").trim();
    const reviewModel = reviewMaxRounds > 0 ? reviewModelMode === "fixed" ? reviewModelReference ? await findModel(reviewModelReference) : null : configuredModel : null;
    if (reviewMaxRounds > 0 && (!reviewModel || !reviewModel.hasSecret)) return json({ error: "审校模型不可用，请在设置 → AI 任务中重新选择，或跟随 AI Generate 模型" }, 422);
    let promptContext = body.promptContext && typeof body.promptContext === "object" ? structuredClone(body.promptContext) : undefined;
    const expectedKind = target === "content" ? "content" : target === "outline" ? "outline" : target === "chapter-title" ? "chapter-title" : undefined;
    if (promptContext && (promptContext.currentOutline?.id !== outlineId || promptContext.kind !== expectedKind || JSON.stringify(promptContext).length > 200_000)) return json({ error: "AI 上下文与任务目标不匹配或过大" }, 422);
    const namingContext = target === "all-names" && body.namingContext && typeof body.namingContext === "object" ? structuredClone(body.namingContext) : undefined;
    if (namingContext && (String((namingContext as { id?: unknown }).id ?? "") !== articleId || JSON.stringify(namingContext).length > 200_000)) return json({ error: "命名上下文与文章不匹配或过大" }, 422);

    const createdAt = new Date().toISOString();
    const submittedPlan = target === "content" && body.currentPlan !== undefined ? String(body.currentPlan).slice(0, 10_000) : undefined;
    const sourceOutline = sourceArticle?.chapters.flatMap(chapter => chapter.outlines).find(outline => outline.id === outlineId);
    const expansionPlan = submittedPlan ?? String(outlineRow.summary);
    if (target === "content" && !validOutlineExpansion(expansionPlan, body.currentExpansion)) return json({ error: "大纲倍率必须应用于完整句子，倍率范围为 0.1–1000，最多一位小数" }, 400);
    const submittedExpansion = body.currentExpansion !== undefined ? normalizeOutlineExpansion(expansionPlan, body.currentExpansion) : rebaseOutlineExpansion(String(outlineRow.summary), expansionPlan, sourceOutline?.expansion);
    const hasSubmittedGenerateOptions = target === "content" && Object.prototype.hasOwnProperty.call(body, "generateOptions");
    const submittedGenerateOptions = hasSubmittedGenerateOptions && body.generateOptions && typeof body.generateOptions === "object"
      ? normalizeAiGenerateOptions(body.generateOptions)
      : null;
    const estimate = Number(body.estimatedCharacters ?? 0);
    const activeCharacterResult = target === "content" ? await db.prepare("SELECT id FROM characters WHERE article_id=? AND archived=0").bind(articleId).all<Record<string, unknown>>() : { results: [] };
    const activeCharacterIds = new Set((activeCharacterResult.results ?? []).map((row) => String(row.id)));
    const requestedFirstAppearanceIds = uniqueStrings(body.firstAppearanceCharacterIds)?.filter((characterId) => activeCharacterIds.has(characterId));
    let firstAppearanceCharacterIds = requestedFirstAppearanceIds;
    if (target === "content" && body.includeCharacters !== false && firstAppearanceCharacterIds === undefined) {
      const state = snapshot;
      firstAppearanceCharacterIds = state.data ? detectFirstAppearanceCharacters(state.data, outlineId, { instruction, currentPlan: submittedPlan ?? String(outlineRow.summary) }).filter((item) => item.firstAppearance).map((item) => item.characterId) : [];
    }
    let reviewSourceContent: string | undefined;
    let reviewSourceVersionId: string | null | undefined;
    let writingPreparation: WritingPreparation | undefined;
    if (reviewMaxRounds > 0 || preparationEnabled) {
      const sourceOutline = snapshot.data?.articles.find((article) => article.id === articleId)?.chapters.find((chapter) => chapter.id === chapterId)?.outlines.find((outline) => outline.id === outlineId);
      if (!snapshot.data || !sourceOutline) return json({ error: "生成正文已不存在" }, 409);
      if (preparationEnabled) writingPreparation = createWritingPreparation(preparationRounds as number, {
        strategy: normalizePreparationStrategy(body.preparationStrategy ?? snapshot.data.settings.preparationStrategy),
        requireConfirmation: (body.preparationRequireConfirmation ?? snapshot.data.settings.preparationRequireConfirmation) === true,
      });
      reviewSourceContent = resolvedOutlineContent(sourceOutline);
      reviewSourceVersionId = sourceOutline.currentVersionId;
      promptContext ??= selectAiContext(snapshot.data, outlineId, "content", { includePrevious: body.includePrevious !== false, includeCharacters: body.includeCharacters !== false, includeExcellentFragments: body.includeExcellentFragments === true, excellentFragmentIds: uniqueStrings(body.excellentFragmentIds), contentMode, instruction, currentPlan: submittedPlan, firstAppearanceCharacterIds });
    }
    if (target === "content" && snapshot.data) {
      promptContext ??= selectAiContext(snapshot.data, outlineId, "content", { includePrevious: body.includePrevious !== false, includeCharacters: body.includeCharacters !== false, includeExcellentFragments: body.includeExcellentFragments === true, excellentFragmentIds: uniqueStrings(body.excellentFragmentIds), contentMode, instruction, currentPlan: submittedPlan, firstAppearanceCharacterIds });
      promptContext.currentOutline.plan = expansionPlan;
      promptContext.currentOutline.expansion = resolveOutlineExpansion(expansionPlan, submittedExpansion, snapshot.data.settings.outlineExpansionMultiplier);
      const resolved = await resolveWritingSettings(promptContext, configuredModel?.id ?? "", normalizeAdvanced(body.advanced, GENERATE_FIELDS), proseControls);
      body.advanced = resolved.advanced; proseControls = resolved.proseControls ?? proseControls;
    }
    if (reviewMaxRounds > 0 && reviewStrategy === "minimal" && !hasReviewRules(reviewRuleSnapshot) && !hasActiveProseControls(proseControls) && !advancedText(body.advanced, GENERATE_FIELDS)) return json({ error: "没有有效审校规则或表达要求" }, 422);
    let rewriteSourceId: string | undefined;
    let rewriteSourceName: string | undefined;
    if (target === "content" && contentMode === "rewrite") {
      const source = await db.prepare(`SELECT c.id AS content_id,c.content_name,v.id AS version_id,v.name AS version_name
        FROM contents c LEFT JOIN versions v ON v.id=c.current_version_id AND v.outline_id=c.outline_id
        WHERE c.outline_id=?`).bind(outlineId).first<Record<string, unknown>>();
      if (!source) return json({ error: "原正文不存在，无法改写" }, 409);
      rewriteSourceId = source.version_id ? String(source.version_id) : String(source.content_id);
      rewriteSourceName = String(source.version_name ?? source.content_name ?? "").trim() || "未命名正文";
    }
    const contextOptions: NonNullable<AiTask["contextOptions"]> = {
      // Generate execution is owned by the server once the task is created.
      // Browser snapshots may still contain an older queued/running copy and
      // must never be allowed to replace the lease or terminal result.
      serverManaged: true,
      taskConcurrency: normalizeTaskConcurrency(scopedParameters.taskConcurrency),
      reasoningEffort: body.reasoningEffort,
      resolvedReasoningEffort: resolveReasoningEffort(configuredModel, body.reasoningEffort),
      includePrevious: body.includePrevious !== false,
      includeCharacters: body.includeCharacters !== false,
      estimatedCharacters: Number.isFinite(estimate) ? Math.max(0, estimate) : 0,
      ...(target === "content" ? {
        ...(writingPreparation ? { writingPreparation, reviewSourceContent, reviewSourceVersionId } : {}),
        targetWords: promptContext?.currentOutline.expansion ? undefined : rawTargetWords,
        contentMode,
        rewriteRetention,
        rewriteSourceId,
        rewriteSourceName,
        advanced: normalizeAdvanced(body.advanced, GENERATE_FIELDS),
        ...(body.proseControls !== undefined ? { proseControls } : {}),
        dialogueDensity,
        ...(reviewMaxRounds > 0 && reviewModel ? { reviewMaxRounds, reviewInstruction, reviewStrategy, reviewConfiguredModelId: reviewModel.id, reviewModelId: reviewModel.modelId, reviewModelName: modelSelectionLabel(reviewModel), reviewResolvedReasoningEffort: resolveReasoningEffort(reviewModel, body.reviewReasoningEffortInheritModel === true ? undefined : body.reviewReasoningEffort === undefined ? reviewModelMode === "inherit" ? body.reasoningEffort : snapshot.data?.settings.reviewReasoningEffort : body.reviewReasoningEffort as ReasoningOptions["reasoningEffort"]), reviewRules: reviewRulesText(reviewRuleSnapshot), reviewRuleSnapshot, reviewSourceContent, reviewSourceVersionId } : {}),
        includeOutlineTitle: body.includeOutlineTitle === true || undefined,
        includeClosingSummary: closingSummaryLength !== "none",
        closingSummaryLength,
        includeExcellentFragments: body.includeExcellentFragments === true || undefined,
        excellentFragmentIds: body.includeExcellentFragments === true ? uniqueStrings(body.excellentFragmentIds) : undefined,
        firstAppearanceCharacterIds: body.includeCharacters === false ? [] : firstAppearanceCharacterIds,
        outlinePlanSnapshot: promptContext?.currentOutline.plan ?? submittedPlan ?? String(outlineRow.summary),
        outlineTitleSnapshot: String(body.outlineTitleSnapshot ?? outlineRow.title).slice(0, 80),
      } : {}),
      ...(target === "all-names" ? {
        chapterNamingSnapshot: normalizeNamingProfile(body.chapterNaming ?? JSON.parse(String(outlineRow.chapter_naming_json ?? "{}")), DEFAULT_CHAPTER_NAMING_PROFILE),
        outlineNamingSnapshot: normalizeNamingProfile(body.outlineNaming ?? JSON.parse(String(outlineRow.outline_naming_json ?? "{}")), DEFAULT_OUTLINE_NAMING_PROFILE),
        nameChapterCount: Array.isArray((namingContext as { chapters?: unknown[] } | undefined)?.chapters) ? (namingContext as { chapters: unknown[] }).chapters.length : 0,
        nameOutlineCount: Array.isArray((namingContext as { chapters?: Array<{ outlines?: unknown[] }> } | undefined)?.chapters) ? (namingContext as { chapters: Array<{ outlines?: unknown[] }> }).chapters.reduce((sum, chapter) => sum + (chapter.outlines?.length ?? 0), 0) : 0,
        namingContext,
      } : {}),
      configuredModelId: configuredModel?.id,
      modelId: configuredModel?.modelId,
      modelName: configuredModel ? modelSelectionLabel(configuredModel) : undefined,
      promptContext,
    };
    const task: AiTask = {
      id: key,
      articleId,
      chapterId,
      outlineId,
      target: target === "content" ? "正文" : target === "outline" ? "大纲" : target === "chapter-title" ? "章节标题" : "全部名称",
      prompt: instruction,
      model: configuredModel ? modelSelectionLabel(configuredModel) : "",
      executionOrigin,
      state: "waiting",
      phase: "queued",
      attempt: 0,
      receivedCharacters: 0,
      timeoutMs: configuredModel?.timeoutMs ?? Math.max(1_000, Math.min(900_000, Number(body.timeoutMs ?? 600_000))),
      createdAt,
      contextOptions,
    };
    const statements = [];
    if (target === "content") {
      statements.push(db.prepare("UPDATE outlines SET summary=COALESCE(?,summary),generate_instruction=?,expansion_json=?,generate_options_json=CASE WHEN ?=1 THEN ? ELSE generate_options_json END,title_generation_pending=CASE WHEN ? IS NOT NULL AND ?<>summary THEN 1 ELSE title_generation_pending END,updated_at=?,revision=revision+1 WHERE id=?").bind(submittedPlan ?? null, instruction, submittedExpansion ? JSON.stringify(submittedExpansion) : null, hasSubmittedGenerateOptions ? 1 : 0, submittedGenerateOptions ? JSON.stringify(submittedGenerateOptions) : null, submittedPlan ?? null, submittedPlan ?? null, createdAt, outlineId));
      statements.push(db.prepare("UPDATE articles SET updated_at=?,revision=revision+1 WHERE id=?").bind(createdAt, articleId));
    }
    statements.push(db.prepare("INSERT INTO ai_tasks(id,article_id,chapter_id,outline_id,target,instruction,model_id,execution_origin,context_options_json,idempotency_key,status,attempt,phase,received_characters,timeout_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(task.id, articleId, chapterId, outlineId, target, instruction, task.model, executionOrigin, JSON.stringify(contextOptions), task.id, "queued", 0, "queued", 0, task.timeoutMs, createdAt));
    statements.push(db.prepare("DELETE FROM ai_tasks WHERE status NOT IN ('queued','running') AND id NOT IN (SELECT id FROM ai_tasks WHERE status NOT IN ('queued','running') ORDER BY created_at DESC,rowid DESC LIMIT MAX(0,20-(SELECT COUNT(*) FROM ai_tasks WHERE status IN ('queued','running'))))"));
    statements.push(db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key IN ('state_revision','database_version')").bind(createdAt));
    await db.batch(statements);
    task.history = parseTaskHistory(await db.prepare("SELECT history_json FROM ai_tasks WHERE id=?").bind(task.id).first<string>("history_json"));
    const revision = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
    return json({ data: task, revision });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "AI 任务创建失败" }, error instanceof RequestInputError ? 400 : 500);
  }
}
