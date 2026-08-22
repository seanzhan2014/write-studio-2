import type { AiTask, Article, Chapter, Character, Outline, Relationship, StudioData, Version } from "@/app/studio-state";
import { findModel } from "@/db/ai";
import { clearBusinessData, readStudioState, searchDocuments, writeStudioState } from "@/db/runtime";
import { detectFirstAppearanceCharacters } from "@/lib/ai-context";
import { MAX_GENERATE_TARGET_WORDS, MIN_GENERATE_TARGET_WORDS, isContentGenerationMode, isRewriteRetentionLevel, normalizeContentGenerationMode, normalizeRewriteRetentionLevel } from "@/lib/generate-options";
import { resolvedOutlineContent, resolvedOutlineSnapshot } from "@/lib/outline-content";
import { normalizeOutlineTitle } from "@/lib/outline-title";
import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile } from "@/lib/naming-options";
import { modelSelectionLabel } from "@/lib/model-label";
import type { SelectedAiContext } from "@/lib/ai-context";

type RouteContext = { params: Promise<{ segments: string[] }> };
type Json = Record<string, unknown>;

const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

function findArticle(data: StudioData, articleId: string) { return data.articles.find((item) => item.id === articleId); }
function findChapter(data: StudioData, chapterId: string) {
  for (const article of data.articles) { const chapter = article.chapters.find((item) => item.id === chapterId); if (chapter) return { article, chapter }; }
  return null;
}
function findOutline(data: StudioData, outlineId: string) {
  for (const article of data.articles) for (const chapter of article.chapters) { const outline = chapter.outlines.find((item) => item.id === outlineId); if (outline) return { article, chapter, outline }; }
  return null;
}
function emptyChat(outlineId: string, createdAt: string): Outline["chat"] {
  const sessionId = `chat:${outlineId}`;
  return { sessions: [{ id: sessionId, title: "新对话", messages: [], draft: "", includePrevious: true, includeCharacters: true, createdAt, updatedAt: createdAt }], activeSessionId: sessionId };
}
function activeChat(outline: Outline) {
  return outline.chat.sessions.find((session) => session.id === outline.chat.activeSessionId) ?? outline.chat.sessions[0];
}
function notFound() { return reply({ error: "not_found" }, 404); }

function mutationError(error: unknown) {
  const message = error instanceof Error ? error.message : "请求无效";
  const status = /不存在|记录不存在/.test(message) ? 404 : /冲突/.test(message) ? 409 : 400;
  return reply({ error: status === 404 ? "not_found" : status === 409 ? "conflict" : "invalid_request", message }, status);
}

async function commit(request: Request, mutate: (data: StudioData) => unknown, allowMissingRevision = false) {
  const state = await readStudioState();
  if (!state.data) return reply({ error: "empty_database" }, 409);
  const header = request.headers.get("if-match");
  if (header === null && !allowMissingRevision) return reply({ error: "if_match_required" }, 428);
  const expected = header === null ? state.revision : Number(header);
  if (!Number.isInteger(expected) || expected < 0) return reply({ error: "if_match_required" }, 428);
  const next = structuredClone(state.data);
  try {
    const result = mutate(next);
    for (const task of next.tasks) {
      task.attempt ??= 0;
      if (task.state === "waiting") task.phase = task.phase === "retrying" ? "retrying" : "queued";
      else if (task.state === "success") { task.phase = "completed"; task.completedAt ??= now(); }
      else if (task.state === "failed") { task.phase = "failed"; task.completedAt ??= now(); }
      else if (task.state === "cancelled") { task.phase = "cancelled"; task.completedAt ??= now(); }
      else task.phase ??= "generating";
    }
    const saved = await writeStudioState(next, expected);
    if (saved.conflict) return reply({ error: "revision_conflict", ...saved.current }, 409);
    return reply({ data: result, revision: saved.revision });
  } catch (error) {
    return mutationError(error);
  }
}

function requireNonEmpty(value: unknown, label: string, maximum: number) {
  const text = String(value ?? "").trim().slice(0, maximum);
  if (!text) throw new Error(`${label}不能为空`);
  return text;
}

function trimTasks(tasks: StudioData["tasks"]) {
  while (tasks.length > 20) {
    let index = -1;
    for (let candidate = tasks.length - 1; candidate >= 0; candidate -= 1) {
      if (["success", "failed", "cancelled"].includes(tasks[candidate].state)) { index = candidate; break; }
    }
    if (index < 0) throw new Error("已有 20 个等待或运行中的任务，请先取消一个任务");
    tasks.splice(index, 1);
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { segments: s } = await context.params;
  const state = await readStudioState();
  const data = state.data;
  if (!data) return reply({ data: [], revision: state.revision });
  if (s[0] === "articles" && s.length === 1) return reply({ data: data.articles.map(({ chapters, characters, relationships, ...article }) => ({ ...article, chapterCount: chapters.length, characterCount: characters.length, relationshipCount: relationships.length })), revision: state.revision });
  if (s[0] === "articles" && s[2] === "tree") { const article = findArticle(data, s[1]); return article ? reply({ data: article.chapters, revision: state.revision }) : notFound(); }
  if (s[0] === "articles" && s[2] === "search") { const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""; return reply({ data: query ? await searchDocuments(s[1], query) : [], revision: state.revision }); }
  if (s[0] === "articles" && s[2] === "characters") { const article = findArticle(data, s[1]); return article ? reply({ data: article.characters, revision: state.revision }) : notFound(); }
  if (s[0] === "articles" && s[2] === "relationships") { const article = findArticle(data, s[1]); return article ? reply({ data: article.relationships, revision: state.revision }) : notFound(); }
  if (s[0] === "articles" && s.length === 2) { const article = findArticle(data, s[1]); return article ? reply({ data: article, revision: state.revision }) : notFound(); }
  if (s[0] === "outlines" && s[2] === "content") { const found = findOutline(data, s[1]); return found ? reply({ data: { outlineId: found.outline.id, text: resolvedOutlineContent(found.outline), workingText: found.outline.content, currentVersionId: found.outline.currentVersionId, defaultVersionId: found.outline.defaultVersionId }, revision: state.revision }) : notFound(); }
  if (s[0] === "outlines" && s[2] === "versions") { const found = findOutline(data, s[1]); return found ? reply({ data: found.outline.versions, revision: state.revision }) : notFound(); }
  if (s[0] === "outlines" && s[2] === "chat") { const found = findOutline(data, s[1]); return found ? reply({ data: found.outline.chat, revision: state.revision }) : notFound(); }
  if (s[0] === "ai" && s[1] === "tasks") { const articleId = new URL(request.url).searchParams.get("articleId"); return reply({ data: articleId ? data.tasks.filter((task) => task.articleId === articleId) : data.tasks, revision: state.revision }); }
  if (s[0] === "settings") return reply({ data: data.settings, revision: state.revision });
  return notFound();
}

export async function POST(request: Request, context: RouteContext) {
  const { segments: s } = await context.params;
  const body = await request.json().catch(() => ({})) as Json;
  if (s[0] === "ai" && s[1] === "tasks" && s.length === 2) {
    const key = request.headers.get("idempotency-key");
    if (!key) return reply({ error: "idempotency_key_required" }, 400);
    const state = await readStudioState();
    const existing = state.data?.tasks.find((task) => task.id === key);
    if (existing) return reply({ data: existing, revision: state.revision });
  }
  const requestedTaskModel = s[0] === "ai" && s[1] === "tasks" && s.length === 2 ? String(body.model ?? "").trim() : "";
  const configuredTaskModel = requestedTaskModel ? await findModel(requestedTaskModel) : null;
  if (s[0] === "articles" && s.length === 1) return commit(request, (data) => {
    const createdAt = now(), articleId = id("article"), chapterId = id("chapter"), outlineId = id("outline");
    const outline: Outline = { id: outlineId, title: "", titleGenerationPending: true, plan: "", generateInstruction: "", content: "", currentVersionId: null, defaultVersionId: null, contentOutlineSnapshot: { title: "", plan: "" }, archived: false, state: "saved", updatedAt: createdAt, versions: [], chat: emptyChat(outlineId, createdAt) };
    const article: Article = { id: articleId, title: requireNonEmpty(body.title, "标题", 120), summary: String(body.summary ?? "").slice(0, 10000), type: String(body.type ?? "").slice(0, 120), style: String(body.style ?? "").slice(0, 5000), chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE, outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE, createdAt, updatedAt: createdAt, lastOutlineId: outlineId, chapters: [{ id: chapterId, title: "第一章", archived: false, outlines: [outline] }], characters: [], relationships: [] };
    data.articles.unshift(article); data.currentArticleId = articleId; data.currentOutlineId = outlineId; return article;
  });
  if (s[0] === "articles" && s[2] === "chapters") return commit(request, (data) => { const article = findArticle(data, s[1]); if (!article) throw new Error("文章不存在"); const chapter: Chapter = { id: id("chapter"), title: requireNonEmpty(body.title ?? "未命名章节", "章节标题", 120), archived: false, outlines: [] }; article.chapters.push(chapter); return chapter; });
  if (s[0] === "chapters" && s[2] === "outlines") return commit(request, (data) => { const found = findChapter(data, s[1]); if (!found) throw new Error("章节不存在"); const outlineId = id("outline"), createdAt = now(); const created: Outline = { id: outlineId, title: "", titleGenerationPending: true, plan: "", generateInstruction: "", content: "", currentVersionId: null, defaultVersionId: null, contentOutlineSnapshot: { title: "", plan: "" }, archived: false, state: "saved", updatedAt: createdAt, versions: [], chat: emptyChat(outlineId, createdAt) }; found.chapter.outlines.push(created); return created; });
  if (s[0] === "chapters" && s[2] === "reorder") return commit(request, (data) => { const found = findChapter(data, s[1]); if (!found) throw new Error("章节不存在"); const index = found.article.chapters.findIndex((item) => item.id === s[1]); const requested = Number(body.position ?? index); if (!Number.isInteger(requested)) throw new Error("章节位置必须是整数"); const target = Math.max(0, Math.min(found.article.chapters.length - 1, requested)); const [chapter] = found.article.chapters.splice(index, 1); found.article.chapters.splice(target, 0, chapter); return chapter; });
  if (s[0] === "outlines" && s[2] === "move") return commit(request, (data) => { const found = findOutline(data, s[1]); const target = findChapter(data, String(body.chapterId ?? "")); if (!found || !target || found.article.id !== target.article.id) throw new Error("移动目标无效"); const requested = Number(body.position ?? target.chapter.outlines.length); if (!Number.isInteger(requested)) throw new Error("大纲位置必须是整数"); found.chapter.outlines = found.chapter.outlines.filter((item) => item.id !== found.outline.id); target.chapter.outlines.splice(Math.max(0, Math.min(target.chapter.outlines.length, requested)), 0, found.outline); return found.outline; });
  if (s[0] === "outlines" && s[2] === "versions") return commit(request, (data) => { const found = findOutline(data, s[1]); if (!found) throw new Error("大纲不存在"); const source = body.source === "AI Generate" ? "AI Generate" : body.source === "AI Chat" ? "AI Chat" : body.source === "未保存内容" ? "未保存内容" : "手动"; const model = String(body.model ?? "").trim().slice(0, 300) || undefined; const modelId = String(body.modelId ?? "").trim().slice(0, 300) || undefined; const version: Version = { id: id("version"), name: requireNonEmpty(body.name ?? "手动版本", "版本名称", 120), content: String(body.content ?? resolvedOutlineContent(found.outline)), source, createdAt: now(), model, modelId, outlineSnapshot: resolvedOutlineSnapshot(found.outline) }; found.outline.versions.unshift(version); return version; });
  if (s[0] === "versions" && s[2] === "apply") return commit(request, (data) => { for (const article of data.articles) for (const chapter of article.chapters) for (const outline of chapter.outlines) { const version = outline.versions.find((item) => item.id === s[1]); if (version) { outline.currentVersionId = version.id; outline.updatedAt = now(); return outline; } } throw new Error("版本不存在"); });
  if (s[0] === "versions" && s[2] === "default") return commit(request, (data) => { for (const article of data.articles) for (const chapter of article.chapters) for (const outline of chapter.outlines) { const version = outline.versions.find((item) => item.id === s[1]); if (version) { outline.defaultVersionId = version.id; outline.updatedAt = now(); return outline; } } throw new Error("版本不存在"); });
  if (s[0] === "articles" && s[2] === "characters") return commit(request, (data) => { const article = findArticle(data, s[1]); if (!article) throw new Error("文章不存在"); const name = requireNonEmpty(body.name, "人物名", 120); if (article.characters.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("同名人物已存在"); const character: Character = { id: id("character"), name, aliases: Array.isArray(body.aliases) ? [...new Set(body.aliases.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 50) : [], description: String(body.description ?? "").slice(0, 20000), archived: false }; article.characters.push(character); return character; });
  if (s[0] === "articles" && s[2] === "relationships") return commit(request, (data) => { const article = findArticle(data, s[1]); if (!article) throw new Error("文章不存在"); const [a, b] = [String(body.characterAId ?? ""), String(body.characterBId ?? "")].sort(); const ids = new Set(article.characters.map((item) => item.id)); if (!a || !b || a === b || !ids.has(a) || !ids.has(b) || article.relationships.some((item) => [item.characterAId, item.characterBId].sort().join(":") === `${a}:${b}`)) throw new Error("人物关系无效或已存在"); const relationship: Relationship = { id: id("relationship"), characterAId: a, characterBId: b, description: String(body.description ?? "").slice(0, 5000) }; article.relationships.push(relationship); return relationship; });
  if (s[0] === "ai" && s[1] === "tasks" && s.length === 2) return commit(request, (data) => {
    const key = request.headers.get("idempotency-key");
    if (!key || key.length > 200) throw new Error("Idempotency-Key 无效");
    const existing = data.tasks.find((task) => task.id === key);
    if (existing) return existing;
    const articleId = String(body.articleId ?? ""), chapterId = String(body.chapterId ?? ""), outlineId = String(body.outlineId ?? "");
    const found = findOutline(data, outlineId);
    if (!found || found.article.id !== articleId || found.chapter.id !== chapterId) throw new Error("任务目标不存在或归属不一致");
    const target = body.target === "outline" ? "大纲" : body.target === "chapter-title" ? "章节标题" : body.target === "all-names" ? "全部名称" : body.target === "content" ? "正文" : body.target === "chat" ? "AI Chat" : null;
    if (!target) throw new Error("任务目标无效");
    const instruction = String(body.instruction ?? "").trim().slice(0, 20000);
    if (target !== "正文" && target !== "全部名称" && !instruction) throw new Error("生成指令不能为空");
    if (target === "正文" && body.contentMode !== undefined && !isContentGenerationMode(body.contentMode)) throw new Error("正文生成模式无效");
    const contentMode = normalizeContentGenerationMode(body.contentMode);
    if (target === "正文" && body.rewriteRetention !== undefined && !isRewriteRetentionLevel(body.rewriteRetention)) throw new Error("原文保留度无效");
    const rewriteRetention = contentMode === "rewrite" ? normalizeRewriteRetentionLevel(body.rewriteRetention) : undefined;
    const targetWordsUnset = body.targetWords === undefined || body.targetWords === null || String(body.targetWords).trim() === "" || Number(body.targetWords) === 0;
    const targetWords = targetWordsUnset ? undefined : Number(body.targetWords);
    if (target === "正文" && targetWords !== undefined && (!Number.isInteger(targetWords) || targetWords < MIN_GENERATE_TARGET_WORDS || targetWords > MAX_GENERATE_TARGET_WORDS)) throw new Error(`目标字数必须为 ${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数，或留空表示不限字数`);
    const estimate = Number(body.estimatedCharacters ?? 0);
    const modelId = configuredTaskModel?.modelId ?? (String(body.modelId ?? "").trim().slice(0, 300) || undefined);
    const activeCharacterIds = new Set(found.article.characters.filter((character) => !character.archived).map((character) => character.id));
    const requestedFirstAppearanceIds = Array.isArray(body.firstAppearanceCharacterIds)
      ? [...new Set(body.firstAppearanceCharacterIds.map(String).filter((characterId) => activeCharacterIds.has(characterId)))].slice(0, 200)
      : undefined;
    const firstAppearanceCharacterIds = target === "正文"
      ? body.includeCharacters === false
        ? []
        : requestedFirstAppearanceIds ?? detectFirstAppearanceCharacters(data, outlineId, { instruction, currentPlan: found.outline.plan }).filter((item) => item.firstAppearance).map((item) => item.characterId)
      : undefined;
    const excellentFragmentIds = target === "正文" && body.includeExcellentFragments === true && Array.isArray(body.excellentFragmentIds)
      ? [...new Set(body.excellentFragmentIds.map(String))].slice(0, 200)
      : undefined;
    const promptContext = body.promptContext && typeof body.promptContext === "object"
      ? structuredClone(body.promptContext) as SelectedAiContext
      : undefined;
    const expectedContextKind = target === "正文" ? "content" : target === "大纲" ? "outline" : target === "章节标题" ? "chapter-title" : target === "AI Chat" ? "chat" : undefined;
    if (promptContext && (promptContext.currentOutline?.id !== outlineId || promptContext.kind !== expectedContextKind || JSON.stringify(promptContext).length > 200_000)) {
      throw new Error("AI 上下文与任务目标不匹配或过大");
    }
    const namingContext = target === "全部名称" && body.namingContext && typeof body.namingContext === "object"
      ? structuredClone(body.namingContext)
      : undefined;
    if (namingContext && (String(namingContext.id ?? "") !== articleId || JSON.stringify(namingContext).length > 200_000)) throw new Error("命名上下文与文章不匹配或过大");
    const createdAt = now();
    const submittedPlan = target === "正文" && body.currentPlan !== undefined ? String(body.currentPlan).slice(0, 10_000) : undefined;
    if (submittedPlan !== undefined && submittedPlan !== found.outline.plan) {
      found.outline.plan = submittedPlan;
      found.outline.titleGenerationPending = true;
      found.outline.updatedAt = createdAt;
      found.article.updatedAt = found.outline.updatedAt;
    }
    const task: AiTask = {
      id: key, articleId, chapterId, outlineId, target, prompt: instruction, model: configuredTaskModel ? modelSelectionLabel(configuredTaskModel) : requestedTaskModel, state: "waiting" as const, createdAt,
      contextOptions: {
        includePrevious: body.includePrevious !== false,
        includeCharacters: body.includeCharacters !== false,
        ...(target === "正文" && body.includeExcellentFragments === true ? { includeExcellentFragments: true, excellentFragmentIds } : {}),
        estimatedCharacters: Number.isFinite(estimate) ? Math.max(0, estimate) : 0,
        ...(target === "正文" && targetWords !== undefined ? { targetWords } : {}),
        contentMode: target === "正文" ? contentMode : undefined,
        ...(target === "正文" && rewriteRetention ? { rewriteRetention } : {}),
        ...(target === "正文" && body.includeOutlineTitle === true ? { includeOutlineTitle: true } : {}),
        outlinePlanSnapshot: promptContext?.currentOutline.plan ?? found.outline.plan,
        outlineTitleSnapshot: String(body.outlineTitleSnapshot ?? found.outline.title).slice(0, 80),
        ...(target === "全部名称" ? {
          chapterNamingSnapshot: normalizeNamingProfile(body.chapterNaming ?? found.article.chapterNaming, DEFAULT_CHAPTER_NAMING_PROFILE),
          outlineNamingSnapshot: normalizeNamingProfile(body.outlineNaming ?? found.article.outlineNaming, DEFAULT_OUTLINE_NAMING_PROFILE),
          nameChapterCount: found.article.chapters.filter((chapter) => !chapter.archived && chapter.outlines.some((outline) => !outline.archived && outline.plan.trim())).length,
          nameOutlineCount: found.article.chapters.reduce((total, chapter) => total + chapter.outlines.filter((outline) => !chapter.archived && !outline.archived && outline.plan.trim()).length, 0),
        } : {}),
        configuredModelId: configuredTaskModel?.id,
        modelId,
        modelName: configuredTaskModel ? modelSelectionLabel(configuredTaskModel) : undefined,
        firstAppearanceCharacterIds,
        sessionId: target === "AI Chat" ? String(body.sessionId ?? "") || undefined : undefined,
        promptContext,
        namingContext,
      },
    };
    if (target === "正文") {
      found.outline.generateInstruction = instruction;
      found.outline.updatedAt = task.createdAt;
    }
    data.tasks.unshift(task);
    trimTasks(data.tasks);
    return task;
  }, true);
  if (s[0] === "ai" && s[1] === "tasks" && s[3] === "cancel") return commit(request, (data) => { const task = data.tasks.find((item) => item.id === s[2]); if (!task) throw new Error("任务不存在"); if (task.state !== "waiting" && task.state !== "running") throw new Error("只有等待或运行中的任务可以取消"); task.state = "cancelled"; return task; }, true);
  if (s[0] === "ai" && s[1] === "tasks" && s[3] === "retry") return commit(request, (data) => { const task = data.tasks.find((item) => item.id === s[2]); if (!task) throw new Error("任务不存在"); if (task.state !== "failed" && task.state !== "cancelled") throw new Error("只有失败或已取消的任务可以重试"); task.state = "waiting"; task.error = undefined; return task; }, true);
  return notFound();
}

export async function PATCH(request: Request, context: RouteContext) {
  const { segments: s } = await context.params; const body = await request.json().catch(() => null) as Json | null;
  if (!body) return reply({ error: "invalid_json" }, 400);
  return commit(request, (data) => {
    if (s[0] === "articles") { const article = findArticle(data, s[1]); if (!article) throw new Error("文章不存在"); if (body.title !== undefined) article.title = requireNonEmpty(body.title, "标题", 120); if (body.summary !== undefined) article.summary = String(body.summary).slice(0, 10000); if (body.type !== undefined) article.type = String(body.type).slice(0, 120); if (body.style !== undefined) article.style = String(body.style).slice(0, 5000); if (body.chapterNaming !== undefined) article.chapterNaming = normalizeNamingProfile(body.chapterNaming, DEFAULT_CHAPTER_NAMING_PROFILE); if (body.outlineNaming !== undefined) article.outlineNaming = normalizeNamingProfile(body.outlineNaming, DEFAULT_OUTLINE_NAMING_PROFILE); article.updatedAt = now(); return article; }
    if (s[0] === "chapters") { const found = findChapter(data, s[1]); if (!found) throw new Error("章节不存在"); if (body.title !== undefined) found.chapter.title = requireNonEmpty(body.title, "章节标题", 120); if (body.archived !== undefined) found.chapter.archived = Boolean(body.archived); return found.chapter; }
    if (s[0] === "outlines") { const found = findOutline(data, s[1]); if (!found) throw new Error("大纲不存在"); const hasTitle = body.title !== undefined; const hasPlan = body.plan !== undefined; if (hasPlan) { const nextPlan = String(body.plan).slice(0, 10000); if (nextPlan !== found.outline.plan) found.outline.titleGenerationPending = true; found.outline.plan = nextPlan; } if (hasTitle) { found.outline.title = normalizeOutlineTitle(body.title); found.outline.titleGenerationPending = !found.outline.title; } if (body.archived !== undefined) found.outline.archived = Boolean(body.archived); if (body.state !== undefined && ["saved", "running", "failed"].includes(String(body.state))) found.outline.state = body.state as Outline["state"]; found.outline.updatedAt = now(); return found.outline; }
    if (s[0] === "versions") { for (const article of data.articles) for (const chapter of article.chapters) for (const outline of chapter.outlines) { const version = outline.versions.find((item) => item.id === s[1]); if (version) { version.name = requireNonEmpty(body.name ?? version.name, "版本名称", 120); return version; } } }
    if (s[0] === "characters") { for (const article of data.articles) { const character = article.characters.find((item) => item.id === s[1]); if (character) { if (body.name !== undefined) { const nextName = requireNonEmpty(body.name, "人物名", 120); if (article.characters.some((item) => item.id !== character.id && item.name.toLocaleLowerCase() === nextName.toLocaleLowerCase())) throw new Error("同名人物已存在"); character.name = nextName; } if (body.description !== undefined) character.description = String(body.description).slice(0, 20000); if (Array.isArray(body.aliases)) character.aliases = [...new Set(body.aliases.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 50); if (body.archived !== undefined) character.archived = Boolean(body.archived); return character; } } }
    if (s[0] === "relationships") { for (const article of data.articles) { const relationship = article.relationships.find((item) => item.id === s[1]); if (relationship) { const [a, b] = [String(body.characterAId ?? relationship.characterAId), String(body.characterBId ?? relationship.characterBId)].sort(); const ids = new Set(article.characters.map((item) => item.id)); if (a === b || !ids.has(a) || !ids.has(b) || article.relationships.some((item) => item.id !== relationship.id && [item.characterAId, item.characterBId].sort().join(":") === `${a}:${b}`)) throw new Error("人物关系无效或已存在"); relationship.characterAId = a; relationship.characterBId = b; if (body.description !== undefined) relationship.description = String(body.description).slice(0, 5000); return relationship; } } }
    if (s[0] === "chat" && s[1] === "messages") { for (const article of data.articles) for (const chapter of article.chapters) for (const outline of chapter.outlines) for (const session of outline.chat.sessions) { const index = session.messages.findIndex((item) => item.id === s[2]); if (index >= 0) { session.messages[index].text = String(body.text ?? session.messages[index].text); session.messages = session.messages.slice(0, index + 1); session.updatedAt = now(); return session.messages[index]; } } }
    throw new Error("记录不存在");
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const { segments: s } = await context.params; const body = await request.json().catch(() => null) as Json | null;
  if (!body) return reply({ error: "invalid_json" }, 400);
  if (s[0] === "database" && s[1] === "location") return reply({ fixed: true, location: "local-sqlite", message: "SQLite 数据位置由服务端 WRITER_STUDIO_DB_PATH 管理，运行时不可切换。" });
  if (s[0] === "settings") return commit(request, (data) => { const patch: Partial<StudioData["settings"]> = {}; if (["light", "dark", "system"].includes(String(body.theme))) patch.theme = body.theme as StudioData["settings"]["theme"]; if (["sans", "serif"].includes(String(body.editorFont))) patch.editorFont = body.editorFont as StudioData["settings"]["editorFont"]; if (body.fontSize !== undefined) patch.fontSize = Math.max(14, Math.min(24, Number(body.fontSize) || 17)); if (body.lineHeight !== undefined) patch.lineHeight = Math.max(1.4, Math.min(2.2, Number(body.lineHeight) || 1.8)); if (body.contentWidth !== undefined) patch.contentWidth = Math.max(640, Math.min(1200, Number(body.contentWidth) || 920)); if (body.outlineExpanded !== undefined) patch.outlineExpanded = Boolean(body.outlineExpanded); if (body.showArchived !== undefined) patch.showArchived = Boolean(body.showArchived); if (body.openLastArticle !== undefined) patch.openLastArticle = Boolean(body.openLastArticle); if (body.taskConcurrency !== undefined) patch.taskConcurrency = Math.max(1, Math.min(4, Math.round(Number(body.taskConcurrency) || 1))); if (body.chatModel !== undefined) patch.chatModel = String(body.chatModel); if (body.generateModel !== undefined) patch.generateModel = String(body.generateModel); if (body.namingModelMode !== undefined) patch.namingModelMode = body.namingModelMode === "fixed" ? "fixed" : "inherit"; if (body.namingModel !== undefined) patch.namingModel = String(body.namingModel); if (body.reviewModel !== undefined) patch.reviewModel = String(body.reviewModel); data.settings = { ...data.settings, ...patch }; return data.settings; });
  if (s[0] === "outlines" && s[2] === "content") return commit(request, (data) => { const found = findOutline(data, s[1]); if (!found) throw new Error("大纲不存在"); found.outline.contentOutlineSnapshot = resolvedOutlineSnapshot(found.outline); found.outline.content = String(body.text ?? ""); found.outline.currentVersionId = null; found.outline.updatedAt = now(); return found.outline; });
  return notFound();
}

export async function DELETE(request: Request, context: RouteContext) {
  const { segments: s } = await context.params;
  if (s[0] === "database" && s[1] === "business-data") return reply(await clearBusinessData());
  return commit(request, (data) => {
    if (s[0] === "ai" && s[1] === "tasks" && s[2] === "completed") { const before = data.tasks.length; data.tasks = data.tasks.filter((task) => task.state !== "success"); return { deleted: before - data.tasks.length }; }
    if (s[0] === "articles") { if (!findArticle(data, s[1])) throw new Error("文章不存在"); data.articles = data.articles.filter((item) => item.id !== s[1]); data.tasks = data.tasks.filter((item) => item.articleId !== s[1]); const next = data.articles[0]; if (data.currentArticleId === s[1]) { data.currentArticleId = next?.id ?? ""; data.currentOutlineId = next?.lastOutlineId ?? ""; } return { deleted: true }; }
    if (s[0] === "chapters") { const found = findChapter(data, s[1]); if (!found) throw new Error("章节不存在"); const removedOutlineIds = new Set(found.chapter.outlines.map((item) => item.id)); found.article.chapters = found.article.chapters.filter((item) => item.id !== s[1]); data.tasks = data.tasks.filter((task) => task.chapterId !== s[1]); if (removedOutlineIds.has(data.currentOutlineId)) { data.currentOutlineId = found.article.chapters.flatMap((item) => item.outlines)[0]?.id ?? ""; found.article.lastOutlineId = data.currentOutlineId; } return { deleted: true }; }
    if (s[0] === "outlines" && s[2] === "chat") { const found = findOutline(data, s[1]); if (!found) throw new Error("大纲不存在"); const session = activeChat(found.outline); if (session) { session.messages = []; session.draft = ""; session.updatedAt = now(); } return { deleted: true }; }
    if (s[0] === "outlines" && s[2] === "default-version") { const found = findOutline(data, s[1]); if (!found) throw new Error("大纲不存在"); found.outline.defaultVersionId = null; found.outline.updatedAt = now(); return found.outline; }
    if (s[0] === "outlines") { const found = findOutline(data, s[1]); if (!found) throw new Error("大纲不存在"); found.chapter.outlines = found.chapter.outlines.filter((item) => item.id !== s[1]); data.tasks = data.tasks.filter((item) => item.outlineId !== s[1]); if (data.currentOutlineId === s[1]) { data.currentOutlineId = found.article.chapters.flatMap((item) => item.outlines)[0]?.id ?? ""; found.article.lastOutlineId = data.currentOutlineId; } return { deleted: true }; }
    if (s[0] === "versions") { for (const article of data.articles) for (const chapter of article.chapters) for (const outline of chapter.outlines) { if (outline.versions.some((item) => item.id === s[1])) { if (outline.currentVersionId === s[1]) throw new Error("当前正文不能删除，请先切换当前正文"); if (outline.defaultVersionId === s[1]) throw new Error("默认正文不能删除，请先取消默认"); outline.versions = outline.versions.filter((item) => item.id !== s[1]); return { deleted: true }; } } }
    if (s[0] === "characters") { for (const article of data.articles) if (article.characters.some((item) => item.id === s[1])) { article.characters = article.characters.filter((item) => item.id !== s[1]); article.relationships = article.relationships.filter((item) => item.characterAId !== s[1] && item.characterBId !== s[1]); return { deleted: true }; } }
    if (s[0] === "relationships") { for (const article of data.articles) if (article.relationships.some((item) => item.id === s[1])) { article.relationships = article.relationships.filter((item) => item.id !== s[1]); return { deleted: true }; } }
    if (s[0] === "chat" && s[1] === "messages" && s[3] === "after") { for (const article of data.articles) for (const chapter of article.chapters) for (const outline of chapter.outlines) for (const session of outline.chat.sessions) { const index = session.messages.findIndex((item) => item.id === s[2]); if (index >= 0) { session.messages = session.messages.slice(0, index + 1); session.updatedAt = now(); return { deleted: true }; } } }
    if (s[0] === "ai" && s[1] === "tasks") { data.tasks = data.tasks.filter((item) => item.id !== s[2]); return { deleted: true }; }
    throw new Error("记录不存在");
  });
}
