import type { AiTask } from "@/app/studio-state";
import { findModel } from "@/db/ai";
import { ensureDatabase, getDatabase, readStudioState } from "@/db/runtime";
import { isContentGenerationMode, isRewriteRetentionLevel, MAX_GENERATE_TARGET_WORDS, MIN_GENERATE_TARGET_WORDS, normalizeContentGenerationMode, normalizeRewriteRetentionLevel } from "@/lib/generate-options";
import { modelSelectionLabel } from "@/lib/model-label";
import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile } from "@/lib/naming-options";
import { detectFirstAppearanceCharacters, type SelectedAiContext } from "@/lib/ai-context";

type TaskTarget = "content" | "outline" | "chapter-title" | "all-names";
type TaskBody = Record<string, unknown> & {
  articleId?: string;
  chapterId?: string;
  outlineId?: string;
  target?: TaskTarget;
  instruction?: string;
  model?: string;
  promptContext?: SelectedAiContext;
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function uniqueStrings(value: unknown, maximum = 200) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))].slice(0, maximum) : undefined;
}

function taskFromRow(row: Record<string, unknown>): AiTask {
  let contextOptions: AiTask["contextOptions"];
  try { contextOptions = JSON.parse(String(row.context_options_json ?? "{}")) as AiTask["contextOptions"]; } catch { contextOptions = undefined; }
  return {
    id: String(row.id), articleId: String(row.article_id), chapterId: String(row.chapter_id), outlineId: String(row.outline_id),
    target: row.target === "content" ? "正文" : row.target === "outline" ? "大纲" : row.target === "all-names" ? "全部名称" : row.target === "chat" ? "AI Chat" : "章节标题",
    prompt: String(row.instruction ?? ""), model: String(row.model_id ?? ""),
    state: row.status === "queued" ? "waiting" : row.status === "error" ? "failed" : String(row.status) as AiTask["state"],
    attempt: Number(row.attempt ?? 0), phase: row.phase ? String(row.phase) as AiTask["phase"] : undefined,
    createdAt: String(row.created_at), startedAt: row.started_at ? String(row.started_at) : undefined, completedAt: row.completed_at ? String(row.completed_at) : undefined,
    lastProgressAt: row.last_progress_at ? String(row.last_progress_at) : undefined, receivedCharacters: row.received_characters == null ? undefined : Number(row.received_characters),
    timeoutMs: row.timeout_ms == null ? undefined : Number(row.timeout_ms), inputTokens: row.input_tokens == null ? undefined : Number(row.input_tokens), outputTokens: row.output_tokens == null ? undefined : Number(row.output_tokens),
    runnerId: row.runner_id ? String(row.runner_id) : undefined, leaseUntil: row.lease_until ? String(row.lease_until) : undefined,
    resultText: row.result_text ? String(row.result_text) : undefined, resultVersionId: row.result_version_id ? String(row.result_version_id) : undefined,
    error: row.error_message ? String(row.error_message) : undefined, contextOptions,
  };
}

export async function GET() {
  try {
    await ensureDatabase();
    const db = getDatabase();
    const [result, revision] = await Promise.all([
      db.prepare("SELECT * FROM ai_tasks ORDER BY created_at DESC,rowid LIMIT 20").all<Record<string, unknown>>(),
      db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json"),
    ]);
    const tasks = (result.results ?? []).map(taskFromRow);
    return json({ data: tasks, tasks, runningOutlineIds: tasks.filter((task) => task.state === "running" && task.target !== "AI Chat" && task.target !== "全部名称").map((task) => task.outlineId), revision: Number(revision ?? 0) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "任务读取失败" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const key = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!key || key.length > 200) return json({ error: "Idempotency-Key 无效" }, 400);
    const body = await request.json() as TaskBody;
    const articleId = String(body.articleId ?? "");
    const chapterId = String(body.chapterId ?? "");
    const outlineId = String(body.outlineId ?? "");
    const target = body.target;
    if (!articleId || !chapterId || !outlineId || !target || !["content", "outline", "chapter-title", "all-names"].includes(target)) return json({ error: "任务目标无效" }, 400);
    const instruction = String(body.instruction ?? "").trim().slice(0, 20_000);
    if (target !== "content" && target !== "all-names" && !instruction) return json({ error: "生成指令不能为空" }, 400);
    if (target === "content" && body.contentMode !== undefined && !isContentGenerationMode(body.contentMode)) return json({ error: "正文生成模式无效" }, 400);
    const contentMode = normalizeContentGenerationMode(body.contentMode);
    if (target === "content" && body.rewriteRetention !== undefined && !isRewriteRetentionLevel(body.rewriteRetention)) return json({ error: "原文保留度无效" }, 400);
    const rewriteRetention = target === "content" && contentMode === "rewrite" ? normalizeRewriteRetentionLevel(body.rewriteRetention) : undefined;
    const rawTargetWords = body.targetWords == null || String(body.targetWords).trim() === "" || Number(body.targetWords) === 0 ? undefined : Number(body.targetWords);
    if (target === "content" && rawTargetWords !== undefined && (!Number.isInteger(rawTargetWords) || rawTargetWords < MIN_GENERATE_TARGET_WORDS || rawTargetWords > MAX_GENERATE_TARGET_WORDS)) return json({ error: `目标字数必须为 ${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数，或留空表示不限字数` }, 400);

    await ensureDatabase();
    const db = getDatabase();
    const existing = await db.prepare("SELECT * FROM ai_tasks WHERE id=?").bind(key).first<Record<string, unknown>>();
    if (existing) {
      const revision = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
      return json({ data: taskFromRow(existing), revision });
    }
    const outlineRow = await db.prepare(`SELECT o.summary,o.title,o.title_generation_pending,o.archived,c.archived AS chapter_archived,a.chapter_naming_json,a.outline_naming_json
      FROM outlines o JOIN chapters c ON c.id=o.chapter_id JOIN articles a ON a.id=o.article_id
      WHERE o.id=? AND o.article_id=? AND o.chapter_id=?`).bind(outlineId, articleId, chapterId).first<Record<string, unknown>>();
    if (!outlineRow || Number(outlineRow.archived) || Number(outlineRow.chapter_archived)) return json({ error: "任务目标不存在或已归档" }, 422);
    const activeCount = Number(await db.prepare("SELECT COUNT(*) AS count FROM ai_tasks WHERE status IN ('queued','running')").first<number>("count") ?? 0);
    if (activeCount >= 20) return json({ error: "已有 20 个等待或运行中的任务，请先取消一个任务" }, 409);

    const requestedModel = String(body.model ?? "").trim();
    const configuredModel = requestedModel ? await findModel(requestedModel) : null;
    if (requestedModel && !configuredModel) return json({ error: "所选模型不存在，请重新选择" }, 422);
    const promptContext = body.promptContext && typeof body.promptContext === "object" ? structuredClone(body.promptContext) : undefined;
    const expectedKind = target === "content" ? "content" : target === "outline" ? "outline" : target === "chapter-title" ? "chapter-title" : undefined;
    if (promptContext && (promptContext.currentOutline?.id !== outlineId || promptContext.kind !== expectedKind || JSON.stringify(promptContext).length > 200_000)) return json({ error: "AI 上下文与任务目标不匹配或过大" }, 422);
    const namingContext = target === "all-names" && body.namingContext && typeof body.namingContext === "object" ? structuredClone(body.namingContext) : undefined;
    if (namingContext && (String((namingContext as { id?: unknown }).id ?? "") !== articleId || JSON.stringify(namingContext).length > 200_000)) return json({ error: "命名上下文与文章不匹配或过大" }, 422);

    const createdAt = new Date().toISOString();
    const submittedPlan = target === "content" && body.currentPlan !== undefined ? String(body.currentPlan).slice(0, 10_000) : undefined;
    const estimate = Number(body.estimatedCharacters ?? 0);
    const activeCharacterResult = target === "content" ? await db.prepare("SELECT id FROM characters WHERE article_id=? AND archived=0").bind(articleId).all<Record<string, unknown>>() : { results: [] };
    const activeCharacterIds = new Set((activeCharacterResult.results ?? []).map((row) => String(row.id)));
    const requestedFirstAppearanceIds = uniqueStrings(body.firstAppearanceCharacterIds)?.filter((characterId) => activeCharacterIds.has(characterId));
    let firstAppearanceCharacterIds = requestedFirstAppearanceIds;
    if (target === "content" && body.includeCharacters !== false && firstAppearanceCharacterIds === undefined) {
      const state = await readStudioState();
      firstAppearanceCharacterIds = state.data ? detectFirstAppearanceCharacters(state.data, outlineId, { instruction, currentPlan: submittedPlan ?? String(outlineRow.summary) }).filter((item) => item.firstAppearance).map((item) => item.characterId) : [];
    }
    const contextOptions: NonNullable<AiTask["contextOptions"]> = {
      includePrevious: body.includePrevious !== false,
      includeCharacters: body.includeCharacters !== false,
      estimatedCharacters: Number.isFinite(estimate) ? Math.max(0, estimate) : 0,
      ...(target === "content" ? {
        targetWords: rawTargetWords,
        contentMode,
        rewriteRetention,
        includeOutlineTitle: body.includeOutlineTitle === true || undefined,
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
      statements.push(db.prepare("UPDATE outlines SET summary=COALESCE(?,summary),generate_instruction=?,title_generation_pending=CASE WHEN ? IS NOT NULL AND ?<>summary THEN 1 ELSE title_generation_pending END,updated_at=?,revision=revision+1 WHERE id=?").bind(submittedPlan ?? null, instruction, submittedPlan ?? null, submittedPlan ?? null, createdAt, outlineId));
      statements.push(db.prepare("UPDATE articles SET updated_at=?,revision=revision+1 WHERE id=?").bind(createdAt, articleId));
    }
    statements.push(db.prepare("INSERT INTO ai_tasks(id,article_id,chapter_id,outline_id,target,instruction,model_id,context_options_json,idempotency_key,status,attempt,phase,received_characters,timeout_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(task.id, articleId, chapterId, outlineId, target, instruction, task.model, JSON.stringify(contextOptions), task.id, "queued", 0, "queued", 0, task.timeoutMs, createdAt));
    statements.push(db.prepare("DELETE FROM ai_tasks WHERE status NOT IN ('queued','running') AND id NOT IN (SELECT id FROM ai_tasks WHERE status NOT IN ('queued','running') ORDER BY created_at DESC,rowid DESC LIMIT MAX(0,20-(SELECT COUNT(*) FROM ai_tasks WHERE status IN ('queued','running'))))"));
    statements.push(db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key IN ('state_revision','database_version')").bind(createdAt));
    await db.batch(statements);
    const revision = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
    return json({ data: task, revision });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "AI 任务创建失败" }, 500);
  }
}
