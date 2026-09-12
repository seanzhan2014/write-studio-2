import { parseTaskHistory } from "@/lib/task-history";
import { taskReasoningEffort } from "@/lib/reasoning-options";
import { generateWithReview } from "@/db/generate-review";
import { normalizeReviewRounds, type GenerateReviewDraft, type GenerateReviewReport } from "@/lib/generate-review.mjs";
import type { AiTask, StudioData, Version } from "@/app/studio-state";
import { AiInputError, AiUpstreamCompletionError, findModel, generateArticleNames, generateText, type ArticleNameGenerationResult } from "@/db/ai";
import { applyStudioChanges, ensureDatabase, getDatabase, readStudioState } from "@/db/runtime";
import { normalizeOutlineTitle } from "@/lib/outline-title";
import { aiGenerateContentName, localTimestampContentName } from "@/lib/content-name.mjs";
import { cloneExcellentFragments, normalizeExcellentFragments, reanchorExcellentFragments } from "@/lib/excellent-fragments.mjs";
import { currentOutlineVersion, resolvedOutlineContent, resolvedOutlineSnapshot } from "@/lib/outline-content";
import { appendNameVersion, normalizeNameVersionState } from "@/lib/name-versions";
import { modelSelectionLabel } from "@/lib/model-label";
import { diffStudioData } from "@/lib/studio-changes";
import { currentTaskExecutionOrigin, normalizeTaskExecutionOrigin } from "@/db/task-execution";
import { isCloudDatabase } from "@/db/sqlite";
import { resolveChapterSettings } from "@/lib/story-settings";

type RouteContext = { params: Promise<{ taskId: string }> };
type Mutation<T> = { changed: boolean; value: T };

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function findTask(data: StudioData, taskId: string) {
  return data.tasks.find((task) => task.id === taskId);
}

function taskFromRow(row: Record<string, unknown>): AiTask {
  let contextOptions: AiTask["contextOptions"];
  try { contextOptions = JSON.parse(String(row.context_options_json ?? "{}")) as AiTask["contextOptions"]; } catch { contextOptions = undefined; }
  return {
    id: String(row.id), articleId: String(row.article_id), chapterId: String(row.chapter_id), outlineId: String(row.outline_id),
    target: row.target === "content" ? "正文" : row.target === "outline" ? "大纲" : row.target === "all-names" ? "全部名称" : row.target === "chat" ? "AI Chat" : "章节标题",
    prompt: String(row.instruction ?? ""), model: String(row.model_id ?? ""),
    executionOrigin: normalizeTaskExecutionOrigin(row.execution_origin),
    state: row.status === "queued" ? "waiting" : row.status === "error" ? "failed" : String(row.status) as AiTask["state"],
    attempt: Number(row.attempt ?? 0), phase: row.phase ? String(row.phase) as AiTask["phase"] : undefined,
    createdAt: String(row.created_at), startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined, lastProgressAt: row.last_progress_at ? String(row.last_progress_at) : undefined,
    receivedCharacters: row.received_characters == null ? undefined : Number(row.received_characters), timeoutMs: row.timeout_ms == null ? undefined : Number(row.timeout_ms),
    runnerId: row.runner_id ? String(row.runner_id) : undefined, leaseUntil: row.lease_until ? String(row.lease_until) : undefined,
    resultText: row.result_text ? String(row.result_text) : undefined, resultVersionId: row.result_version_id ? String(row.result_version_id) : undefined,
    history: parseTaskHistory(row.history_json),
    error: row.error_message ? String(row.error_message) : undefined, contextOptions,
  };
}

function findOutline(data: StudioData, outlineId: string) {
  for (const article of data.articles) for (const chapter of article.chapters) {
    const outline = chapter.outlines.find((item) => item.id === outlineId);
    if (outline) return { article, chapter, outline };
  }
  return null;
}

function activeExcellentFragments(outline: StudioData["articles"][number]["chapters"][number]["outlines"][number]) {
  const version = currentOutlineVersion(outline);
  return version
    ? normalizeExcellentFragments(version.content, version.excellentFragments)
    : normalizeExcellentFragments(outline.content, outline.excellentFragments);
}

async function mutateState<T>(mutate: (data: StudioData) => Mutation<T>, runnerId?: string): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readStudioState();
    if (!current.data) throw new Error("任务数据库为空");
    const next = structuredClone(current.data);
    const outcome = mutate(next);
    if (!outcome.changed) return outcome.value;
    const saved = await applyStudioChanges(diffStudioData(current.data, next), current.revision, { taskRunnerId: runnerId });
    if (!saved.conflict) return outcome.value;
  }
  throw new Error("任务状态更新冲突，请稍后重试");
}

function taskTarget(task: AiTask) {
  return task.target === "正文" ? "content" as const : task.target === "大纲" ? "outline" as const : "chapter-title" as const;
}

function leaseTime() {
  return new Date(Date.now() + 20_000).toISOString();
}

async function updateOwnedTaskProgress(taskId: string, runnerId: string, patch: { phase?: AiTask["phase"]; attempt?: number; error?: string }, visible = true) {
  await ensureDatabase();
  const db = getDatabase();
  const progressedAt = new Date().toISOString();
  const assignments = ["last_progress_at=?", "lease_until=?"];
  const values: unknown[] = [progressedAt, leaseTime()];
  if (patch.phase) { assignments.push("phase=?"); values.push(patch.phase); }
  if (patch.phase) { assignments.push("error_message=?"); values.push(patch.error ?? null); }
  if (patch.attempt !== undefined) { assignments.push("attempt=?"); values.push(patch.attempt); }
  values.push(taskId, runnerId);
  const result = await db.prepare(`UPDATE ai_tasks SET ${assignments.join(",")} WHERE id=? AND status='running' AND runner_id=?`).bind(...values).run();
  const updated = Number(result.meta?.changes ?? 0) > 0;
  if (updated && visible) await db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key='state_revision'").bind(progressedAt).run();
  return updated;
}

async function executeTask(taskId: string) {
  const runnerId = `server-${crypto.randomUUID()}`;
  try {
    await ensureDatabase();
    const db = getDatabase();
    const initialRow = await db.prepare("SELECT * FROM ai_tasks WHERE id=?").bind(taskId).first<Record<string, unknown>>();
    const initialTask = initialRow ? taskFromRow(initialRow) : null;
    if (!initialTask) return json({ error: "任务不存在" }, 404);
    if (initialTask.target === "AI Chat") return json({ error: "AI Chat 由流式会话执行" }, 400);
    const executionOrigin = currentTaskExecutionOrigin();
    if (initialTask.executionOrigin !== executionOrigin) return json({ accepted: false, reason: "foreign_origin", executionOrigin: initialTask.executionOrigin }, 202);
    const model = await findModel(initialTask.contextOptions?.configuredModelId ?? initialTask.model);
    const executionModelReference = model?.id ?? initialTask.model;
    const timeoutMs = model?.timeoutMs ?? initialTask.timeoutMs ?? 600_000;
    const leaseExpired = initialTask.state === "running" && (!initialTask.leaseUntil || new Date(initialTask.leaseUntil).getTime() <= Date.now());
    if (initialTask.state !== "waiting" && !leaseExpired) return json({ accepted: false, reason: "already_claimed" }, 202);
    if (initialTask.target === "正文") {
      const hasEarlierBodyTask = await db.prepare("SELECT 1 AS found FROM ai_tasks WHERE id<>? AND outline_id=? AND execution_origin=? AND target='content' AND status IN ('queued','running') AND (created_at<? OR (created_at=? AND id<?)) LIMIT 1").bind(taskId, initialTask.outlineId, executionOrigin, initialTask.createdAt, initialTask.createdAt, taskId).first<number>("found");
      if (hasEarlierBodyTask) return json({ accepted: false, reason: "earlier_task" }, 202);
    }
    if (leaseExpired && (initialTask.attempt ?? 0) >= 3) {
      const failedAt = new Date().toISOString();
      await db.batch([
        db.prepare("UPDATE ai_tasks SET status='error',phase='failed',completed_at=?,last_progress_at=?,error_message=?,runner_id=NULL,lease_until=NULL WHERE id=?").bind(failedAt, failedAt, "任务执行中断，重试次数已用尽", taskId),
        db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key IN ('state_revision','database_version')").bind(failedAt),
      ]);
      return json({ accepted: false, reason: "retry_exhausted" }, 202);
    }
    const startedAt = new Date().toISOString();
    const claimResult = await db.prepare("UPDATE ai_tasks SET status='running',phase='preparing',attempt=?,started_at=?,completed_at=NULL,last_progress_at=?,received_characters=0,timeout_ms=?,runner_id=?,lease_until=?,error_message=NULL WHERE id=? AND execution_origin=? AND (status='queued' OR (status='running' AND (lease_until IS NULL OR lease_until<=?)))")
      .bind(Math.max(1, (initialTask.attempt ?? 0) + 1), startedAt, startedAt, timeoutMs, runnerId, leaseTime(), taskId, executionOrigin, startedAt).run();
    const claimed = Number(claimResult.meta?.changes ?? 0) > 0;
    if (claimed) {
      const statements = [db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key='state_revision'").bind(startedAt)];
      if (initialTask.target !== "全部名称") statements.unshift(db.prepare("UPDATE outlines SET state='running',updated_at=?,revision=revision+1 WHERE id=?").bind(startedAt, initialTask.outlineId));
      await db.batch(statements);
    }
    if (!claimed) return json({ accepted: false, reason: "already_claimed" }, 202);

    const upstreamController = new AbortController();
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy || upstreamController.signal.aborted) return;
      heartbeatBusy = true;
      void updateOwnedTaskProgress(taskId, runnerId, {}, false)
        .then((updated) => { if (!updated) upstreamController.abort("cancelled"); })
        .catch(() => undefined).finally(() => { heartbeatBusy = false; });
    }, 5_000);

    try {
      let result: GenerateReviewDraft | null = null;
      let reviewReport: GenerateReviewReport | undefined;
      let articleNameResult: ArticleNameGenerationResult | null = null;
      const reviewEnabled = initialTask.target === "正文" && normalizeReviewRounds(initialTask.contextOptions?.reviewMaxRounds) > 0;
      const generate = () => generateText({
              reasoningEffort: taskReasoningEffort(initialTask.contextOptions),
              outlineId: initialTask.outlineId, instruction: initialTask.prompt, model: executionModelReference,
              target: taskTarget(initialTask), includePrevious: initialTask.contextOptions?.includePrevious ?? true,
              includeCharacters: initialTask.contextOptions?.includeCharacters ?? true, targetWords: initialTask.contextOptions?.targetWords,
              includeExcellentFragments: initialTask.contextOptions?.includeExcellentFragments === true,
              excellentFragmentIds: initialTask.contextOptions?.excellentFragmentIds,
              contentMode: initialTask.contextOptions?.contentMode,
              rewriteRetention: initialTask.contextOptions?.rewriteRetention,
              dialogueDensity: initialTask.contextOptions?.dialogueDensity,
              firstAppearanceCharacterIds: initialTask.contextOptions?.firstAppearanceCharacterIds,
              includeOutlineTitle: initialTask.contextOptions?.includeOutlineTitle === true,
              context: initialTask.contextOptions?.promptContext,
            }, upstreamController.signal);
      if (reviewEnabled) {
        const reviewed = await generateWithReview(initialTask, runnerId, executionModelReference, initialRow?.review_state_json, generate, upstreamController.signal);
        result = reviewed.draft;
        reviewReport = reviewed.report;
      }
      let lastError: unknown;
      for (let requestAttempt = Math.max(1, (initialTask.attempt ?? 0) + 1); !reviewEnabled && requestAttempt <= 3; requestAttempt += 1) {
        if (upstreamController.signal.aborted) break;
        if (requestAttempt > 1) {
          if (!await updateOwnedTaskProgress(taskId, runnerId, { phase: "retrying", attempt: requestAttempt, error: lastError instanceof Error ? lastError.message : undefined })) break;
          await new Promise((resolve) => setTimeout(resolve, requestAttempt === 2 ? 1_000 : 2_000));
        }
        if (!await updateOwnedTaskProgress(taskId, runnerId, { phase: "connecting", attempt: requestAttempt })) break;
        try {
          if (!await updateOwnedTaskProgress(taskId, runnerId, { phase: "generating" })) break;
          if (initialTask.target === "全部名称") {
            articleNameResult = await generateArticleNames({
              reasoningEffort: taskReasoningEffort(initialTask.contextOptions),
              articleId: initialTask.articleId,
              chapterNaming: initialTask.contextOptions?.chapterNamingSnapshot,
              outlineNaming: initialTask.contextOptions?.outlineNamingSnapshot,
              model: executionModelReference,
              instruction: initialTask.prompt,
              context: initialTask.contextOptions?.namingContext,
            }, upstreamController.signal);
          } else {
            result = await generate();
          }
          break;
        } catch (error) {
          lastError = error;
          if (error instanceof AiInputError || (error instanceof AiUpstreamCompletionError && !error.retryable)) break;
        }
      }

      if (!result && !articleNameResult) {
        if (upstreamController.signal.aborted) return json({ accepted: true, cancelled: true }, 202);
        throw lastError instanceof Error ? lastError : new Error("生成失败");
      }

      if (!await updateOwnedTaskProgress(taskId, runnerId, { phase: "saving" })) return json({ accepted: true, cancelled: true }, 202);
      await mutateState((data) => {
        const task = findTask(data, taskId);
        if (!task || task.state !== "running" || task.runnerId !== runnerId) return { changed: false, value: false };
        const found = findOutline(data, task.outlineId);
        let completedAt = new Date().toISOString();
        let resultText = result?.text ?? "";
        let receivedCharacters = result?.text.length ?? 0;
        let inputTokens = result?.inputTokens;
        let outputTokens = result?.outputTokens;
        if (task.target === "全部名称" && articleNameResult) {
          const article = data.articles.find((item) => item.id === task.articleId);
          if (!article) return { changed: false, value: false };
          let added = 0;
          for (const generated of articleNameResult.chapterTitles) {
            const chapter = article.chapters.find((item) => item.id === generated.id && !item.archived);
            if (!chapter) continue;
            const current = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
            const next = appendNameVersion(current, {
              id: `name-ai-${crypto.randomUUID()}`, title: generated.title, source: "ai", createdAt: completedAt,
              model: model ? modelSelectionLabel(model) : task.contextOptions?.modelName ?? task.model, instruction: task.prompt,
            }, 120);
            chapter.nameVersions = next.state.nameVersions;
            chapter.defaultNameVersionId = next.state.defaultNameVersionId;
            if (next.added) added += 1;
          }
          for (const generated of articleNameResult.outlineTitles) {
            const chapter = article.chapters.find((item) => item.id === generated.chapterId && !item.archived);
            const outline = chapter?.outlines.find((item) => item.id === generated.id && !item.archived);
            if (!outline) continue;
            const current = normalizeNameVersionState(outline.id, outline.title, outline.nameVersions, outline.defaultNameVersionId, outline.updatedAt, 80);
            const next = appendNameVersion(current, {
              id: `name-ai-${crypto.randomUUID()}`, title: generated.title, source: "ai", createdAt: completedAt,
              model: model ? modelSelectionLabel(model) : task.contextOptions?.modelName ?? task.model, instruction: task.prompt,
            }, 80);
            outline.nameVersions = next.state.nameVersions;
            outline.defaultNameVersionId = next.state.defaultNameVersionId;
            outline.updatedAt = completedAt;
            if (next.added) added += 1;
          }
          article.updatedAt = completedAt;
          resultText = `已一次生成 ${articleNameResult.chapterTitles.length} 个章节名和 ${articleNameResult.outlineTitles.length} 个大纲名，新增 ${added} 个候选版本。`;
          receivedCharacters = [...articleNameResult.chapterTitles, ...articleNameResult.outlineTitles].reduce((total, item) => total + item.title.length, 0);
          inputTokens = articleNameResult.inputTokens;
          outputTokens = articleNameResult.outputTokens;
          task.contextOptions = {
            includePrevious: false,
            includeCharacters: false,
            estimatedCharacters: articleNameResult.inputCharacters,
            ...task.contextOptions,
            nameChapterCount: articleNameResult.chapterTitles.length,
            nameOutlineCount: articleNameResult.outlineTitles.length,
            generatedNameCount: added,
          };
        } else if (task.target === "正文" && found && result) {
          const completedAt = new Date().toISOString();
          const previousOutlineSnapshot = resolvedOutlineSnapshot(found.outline);
          const sourceChanged = reviewEnabled && (resolvedOutlineContent(found.outline) !== initialTask.contextOptions?.reviewSourceContent || found.outline.currentVersionId !== initialTask.contextOptions?.reviewSourceVersionId);
          const generatedTitle = normalizeOutlineTitle(result.outlineTitle);
          if (!sourceChanged && task.contextOptions?.includeOutlineTitle && generatedTitle && found.outline.plan === task.contextOptions?.outlinePlanSnapshot && found.outline.title === task.contextOptions?.outlineTitleSnapshot) {
            found.outline.title = generatedTitle;
            found.outline.titleGenerationPending = false;
          }
          const version: Version = {
            id: `version-${crypto.randomUUID()}`,
            name: aiGenerateContentName(model?.modelId ?? task.contextOptions?.modelId, completedAt),
            reviewReport,
            content: result.text, source: "AI Generate", createdAt: completedAt, model: model ? modelSelectionLabel(model) : task.contextOptions?.modelName ?? task.model, modelId: model?.modelId ?? task.contextOptions?.modelId, prompt: task.prompt, taskId: task.id,
            rewriteSourceId: task.contextOptions?.contentMode === "rewrite" ? task.contextOptions.rewriteSourceId : undefined,
            rewriteSourceName: task.contextOptions?.contentMode === "rewrite" ? task.contextOptions.rewriteSourceName : undefined,
            outlineSnapshot: {
              title: task.contextOptions?.outlineTitleSnapshot ?? found.outline.title,
              plan: task.contextOptions?.outlinePlanSnapshot ?? found.outline.plan,
            },
            settingSnapshot: resolveChapterSettings(found.article, found.chapter.id),
            excellentFragments: task.contextOptions?.contentMode && task.contextOptions.contentMode !== "fresh"
              ? cloneExcellentFragments(result.text, reanchorExcellentFragments(resolvedOutlineContent(found.outline), result.text, activeExcellentFragments(found.outline)))
              : [],
          };
          const directContentBackup: Version | undefined = !found.outline.currentVersionId && found.outline.content.trim()
            ? {
                id: `version-${crypto.randomUUID()}`,
                name: `AI Generate 前 · ${localTimestampContentName(completedAt)}`,
                content: found.outline.content,
                source: "手动",
                createdAt: completedAt,
                taskId: task.id,
                outlineSnapshot: previousOutlineSnapshot,
                manualExcellent: found.outline.manualExcellent === true,
                excellentFragments: cloneExcellentFragments(found.outline.content, normalizeExcellentFragments(found.outline.content, found.outline.excellentFragments)),
              }
            : undefined;
          found.outline.versions.unshift(version, ...(directContentBackup ? [directContentBackup] : []));
          if (!sourceChanged) found.outline.currentVersionId = version.id;
          found.outline.state = "saved";
          found.outline.updatedAt = completedAt;
          task.resultVersionId = version.id;
          task.contextOptions = {
            includePrevious: task.contextOptions?.includePrevious ?? true,
            includeCharacters: task.contextOptions?.includeCharacters ?? true,
            estimatedCharacters: task.contextOptions?.estimatedCharacters ?? 0,
            ...task.contextOptions,
            generatedOutlineTitle: result.outlineTitle,
            generatedOutlineTitleError: result.outlineTitleError,
            ...(reviewReport ? { reviewReport, reviewRound: reviewReport.completedRounds, reviewCandidateOnly: sourceChanged } : {}),
          };
        } else if (found && result) {
          found.outline.state = "saved";
          task.contextOptions = {
            includePrevious: task.contextOptions?.includePrevious ?? true,
            includeCharacters: task.contextOptions?.includeCharacters ?? true,
            estimatedCharacters: task.contextOptions?.estimatedCharacters ?? 0,
            ...task.contextOptions,
            generatedOutlineTitle: result.outlineTitle,
          };
        }
        completedAt = task.target === "正文" && found ? found.outline.updatedAt : completedAt;
        Object.assign(task, {
          state: "success", phase: "completed", completedAt, lastProgressAt: completedAt,
          receivedCharacters, resultText,
          inputTokens, outputTokens,
          runnerId: undefined, leaseUntil: undefined, error: undefined,
        } satisfies Partial<AiTask>);
        return { changed: true, value: true };
      }, runnerId);
      return json({ accepted: true, completed: true });
    } catch (error) {
      await mutateState((data) => {
        const task = findTask(data, taskId);
        if (!task || task.state === "cancelled" || task.runnerId !== runnerId) return { changed: false, value: false };
        const completedAt = new Date().toISOString();
        Object.assign(task, {
          state: "failed", phase: "failed", completedAt, lastProgressAt: completedAt,
          error: error instanceof Error ? error.message : "生成失败", runnerId: undefined, leaseUntil: undefined,
        } satisfies Partial<AiTask>);
        const found = findOutline(data, task.outlineId);
        if (found && task.target !== "全部名称") found.outline.state = "failed";
        return { changed: true, value: true };
      }, runnerId);
      return json({ accepted: true, completed: false, error: error instanceof Error ? error.message : "生成失败" }, 502);
    } finally {
      clearInterval(heartbeat);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "任务执行失败" }, 500);
  }
}

export async function POST(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  if (!isCloudDatabase() && process.env.WRITER_STUDIO_TEST_MODE !== "1") {
    // A browser navigation closes its HTTP response, but a local generation
    // must remain owned by the service. Detach the long-running work from the
    // request and let SQLite leases reject duplicate dispatches.
    void executeTask(taskId).catch((error) => console.error("Background Generate task failed", error));
    return json({ accepted: true, scheduled: true }, 202);
  }
  return executeTask(taskId);
}
