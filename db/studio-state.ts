import { normalizeOutlineExpansion } from "@/lib/outline-expansion";

import { serializeArticleSettings, serializeCharacterSettings } from "@/db/studio-serialization";
import { taskFromRow } from "@/lib/task-record";
import { normalizeStudioSettings } from "@/lib/studio-settings";
import { normalizeChatMode, type ChatMode } from "@/lib/chat-modes";
import { normalizeCharacterPhotos } from "@/lib/character-photos";

import { preserveStyleLabSql, restoreStyleLabSql, clearStyleLabBackupSql, importStyleLabStatements, type StyleLabSnapshot } from "@/db/style-lab-history";

import { articleReviewRules, normalizeReviewRuleItems, type ReviewRuleSnapshot } from "@/lib/review-rules.mjs";
import { parseTaskHistory } from "@/lib/task-history";
import { normalizeIllustrationOptions } from "@/lib/illustration-options";
import { normalizeCharacterVisual } from "@/lib/character-visual";

import { preserveIllustrationHistorySql, restoreIllustrationHistorySql, clearIllustrationHistoryBackupSql } from "@/db/illustration-schema";
import { registerIllustrationTasks } from "@/db/illustration-tasks";
import { taskTargetCode } from "@/lib/task-target";
import { normalizeReviewRules, type GenerateReviewReport } from "@/lib/generate-review.mjs";
import type { StudioData } from "@/lib/studio-types";
import { timestampContentName } from "@/lib/content-name.mjs";
import { DEFAULT_AI_GENERATE_OPTIONS, normalizeAiGenerateOptions } from "@/lib/generate-options";

import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile } from "@/lib/naming-options";
import { normalizeNameVersionState, type NameVersion } from "@/lib/name-versions";
import { normalizeExcellentFragments, type ExcellentFragment } from "@/lib/excellent-fragments.mjs";
import { resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";

import { diffStudioData, isStudioChangesEmpty, type StudioChanges } from "@/lib/studio-changes";
import { normalizeTaskExecutionOrigin } from "@/db/task-execution";
import { deleteIllustrationAsset, listIllustrationAssetKeys } from "@/db/illustration-assets";
import { migrateArticleStoryDetails, migrateCharacterDetails, normalizeCharacterProfile, normalizeChapterSettings } from "@/lib/story-settings";
import { databaseEngine, getDatabase, isCloudDatabase, type SqliteDatabase, type SqliteStatement } from "@/db/sqlite";

import { ensureDatabase } from "@/db/schema-runtime";

import { rows, safeJson, bool, insert, updateByKey } from "@/db/sql-helpers";

export class StudioInputError extends Error {}

export function validateOutlineVersionReferences(outlineId: string, versions: Array<{ id: string }>, currentVersionId: unknown, defaultVersionId: unknown) {
  const ids = new Set(versions.map(version => version.id));
  for (const value of [currentVersionId, defaultVersionId]) {
    if (value != null && (typeof value !== "string" || !ids.has(value))) {
      throw new StudioInputError(`正文版本不存在或不属于大纲 ${outlineId}`);
    }
  }
}

export async function readStudioRevision() {
  await ensureDatabase();
  const value = await getDatabase().prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json");
  return Number(value ?? 0);
}

export async function readStudioStateIdentity() {
  await ensureDatabase();
  const result = await getDatabase().prepare("SELECT key,value_json FROM app_settings WHERE key IN ('state_revision','database_version','sync_schema_version','sync_database_id')").all<Record<string, unknown>>();
  const values = new Map((result.results ?? []).map((row) => [String(row.key), String(row.value_json ?? "")]));
  const revision = Number(values.get("state_revision") ?? 0);
  return {
    databaseId: values.get("sync_database_id") ?? "",
    schemaVersion: Number(values.get("sync_schema_version") ?? 0),
    databaseVersion: Number(values.get("database_version") ?? revision),
    revision,
  };
}

export async function readStudioState(): Promise<{ data: StudioData | null; revision: number; databaseVersion: number }> {
  await ensureDatabase();
  await registerIllustrationTasks();
  const db = getDatabase();
  const [articleResult, chapterResult, outlineResult, contentResult, versionResult, excellentFragmentResult, characterResult, relationshipResult, sessionResult, messageResult, taskResult, settingResult] = await Promise.all([
    db.prepare("SELECT * FROM articles ORDER BY last_opened_at DESC, rowid").all(),
    db.prepare("SELECT * FROM chapters ORDER BY article_id, position, id").all(),
    db.prepare("SELECT * FROM outlines ORDER BY chapter_id, position, id").all(),
    db.prepare("SELECT * FROM contents").all(),
    db.prepare("SELECT * FROM versions ORDER BY created_at DESC, rowid").all(),
    db.prepare("SELECT * FROM excellent_fragments ORDER BY created_at, rowid").all(),
    db.prepare("SELECT * FROM characters ORDER BY created_at, rowid").all(),
    db.prepare("SELECT * FROM relationships ORDER BY created_at, rowid").all(),
    db.prepare("SELECT * FROM chat_sessions ORDER BY outline_id, created_at, rowid").all(),
    db.prepare("SELECT * FROM chat_messages ORDER BY session_id, order_index").all(),
    db.prepare("SELECT * FROM ai_tasks ORDER BY created_at DESC, rowid LIMIT 20").all(),
    db.prepare("SELECT * FROM app_settings").all(),
  ]);
  const articleRows = rows(articleResult);
  const settingsMap = new Map(rows(settingResult).map((row) => [String((row as Record<string, unknown>).key), (row as Record<string, unknown>).value_json]));
  const revision = Number(settingsMap.get("state_revision") ?? 0);
  const databaseVersion = Number(settingsMap.get("database_version") ?? revision);
  const ui = safeJson<Partial<StudioData>>(settingsMap.get("studio_ui"), {});
  const studioSettings = normalizeStudioSettings(ui.settings);
  if (!articleRows.length) {
    const ui = safeJson<Partial<StudioData>>(settingsMap.get("studio_ui"), {});
    return { revision, databaseVersion, data: { version: 1, currentArticleId: "", currentOutlineId: "", articles: [], tasks: [], settings: normalizeStudioSettings(ui.settings) } };
  }

  const chapters = rows(chapterResult) as Record<string, unknown>[];
  const outlines = rows(outlineResult) as Record<string, unknown>[];
  const contents = new Map((rows(contentResult) as Record<string, unknown>[]).map((row) => [String(row.outline_id), row]));
  const versions = rows(versionResult) as Record<string, unknown>[];
  const excellentFragments = rows(excellentFragmentResult) as Record<string, unknown>[];
  const characters = rows(characterResult) as Record<string, unknown>[];
  const relationships = rows(relationshipResult) as Record<string, unknown>[];
  const sessions = rows(sessionResult) as Record<string, unknown>[];
  const messages = rows(messageResult) as Record<string, unknown>[];
  const tasks = (rows(taskResult) as Record<string, unknown>[]).map(taskFromRow);

  const articles = (articleRows as Record<string, unknown>[]).map((articleRow) => {
    const articleId = String(articleRow.id);
    const legacyGenerateSettings = normalizeAiGenerateOptions({
      model: studioSettings.generateModel,
      reasoningEffort: studioSettings.generateReasoningEffort,
      targetWords: studioSettings.generateTargetWords,
      reviewMaxRounds: studioSettings.generateReviewMaxRounds,
    });
    const storedGenerateSettings = safeJson<Record<string, unknown>>(articleRow.ai_generate_settings_json, {});
    const aiGenerateSettings = normalizeAiGenerateOptions(storedGenerateSettings, Object.keys(storedGenerateSettings).length ? DEFAULT_AI_GENERATE_OPTIONS : legacyGenerateSettings);
    const articleChapters = chapters.filter((row) => row.article_id === articleId).map((chapterRow) => {
      const chapterId = String(chapterRow.id);
      const chapterOutlines = outlines.filter((row) => row.chapter_id === chapterId).map((outlineRow) => {
        const outlineId = String(outlineRow.id);
        const content = contents.get(outlineId);
        const outlineSessionRows = sessions.filter((row) => row.outline_id === outlineId);
        const sessionItems = outlineSessionRows.map((sessionRow) => {
          const options = safeJson<{ title?: string; mode?: ChatMode; includePrevious?: boolean; includeCharacters?: boolean; active?: boolean; lastReadMessageId?: string | null }>(sessionRow.context_options_json, {});
          const sessionMessages = messages.filter((row) => row.session_id === sessionRow.id).map((row) => ({
            id: String(row.id), role: String(row.role) as "user" | "assistant", text: String(row.content),
            createdAt: String(row.created_at), stopped: row.status === "stopped" || undefined,
          }));
          return {
            id: String(sessionRow.id),
            title: options.title?.trim() || "新对话",
            mode: normalizeChatMode(options.mode),
            messages: sessionMessages,
            draft: "",
            includePrevious: options.includePrevious !== false,
            includeCharacters: options.includeCharacters !== false,
            lastReadMessageId: null,
            createdAt: String(sessionRow.created_at),
            updatedAt: String(sessionRow.updated_at),
          };
        });
        const fallbackSession = {
          id: `chat:${outlineId}`, title: "新对话", messages: [], draft: "", includePrevious: true, includeCharacters: true,
          lastReadMessageId: null,
          createdAt: String(outlineRow.created_at), updatedAt: String(outlineRow.updated_at),
        };
        const activeSessionId = String(sessionItems[0]?.id ?? fallbackSession.id);
        const mapExcellentFragments = (sourceText: string, versionId?: string): ExcellentFragment[] => normalizeExcellentFragments(sourceText, excellentFragments
          .filter((row) => row.outline_id === outlineId && (versionId ? row.version_id === versionId : !row.version_id))
          .map((row) => ({
            id: String(row.id), start: Number(row.start_offset), end: Number(row.end_offset), text: String(row.selected_text),
            prefix: String(row.prefix_context ?? ""), suffix: String(row.suffix_context ?? ""), sourceHash: String(row.source_hash ?? ""),
            createdAt: String(row.created_at), updatedAt: String(row.updated_at),
          })));
        const outlineVersions = versions.filter((row) => row.outline_id === outlineId).map((row) => ({
          id: String(row.id), name: String(row.name), content: String(row.text),
          source: row.source === "ai-generate" ? "AI Generate" as const : row.source === "ai-chat" ? "AI Chat" as const : row.source === "ai-review" ? "AI Review" as const : row.source === "unsaved" ? "未保存内容" as const : "手动" as const,
          createdAt: String(row.created_at), model: row.model_name ? String(row.model_name) : row.model_id ? String(row.model_id) : undefined, modelId: row.model_name && row.model_id ? String(row.model_id) : undefined,
          reviewReport: row.review_report_json ? safeJson<GenerateReviewReport | undefined>(row.review_report_json, undefined) : undefined,
          reviewRuleSnapshot: row.review_rule_snapshot_json ? safeJson<ReviewRuleSnapshot | undefined>(row.review_rule_snapshot_json, undefined) : undefined,
          prompt: row.prompt ? String(row.prompt) : undefined, taskId: row.task_id ? String(row.task_id) : undefined,
          rewriteSourceId: row.rewrite_source_id ? String(row.rewrite_source_id) : undefined,
          rewriteSourceName: row.rewrite_source_name ? String(row.rewrite_source_name) : undefined,
          lastSelectedAt: row.last_selected_at ? String(row.last_selected_at) : undefined,
          outlineSnapshot: row.outline_snapshot_json ? safeJson<{ title: string; plan: string } | undefined>(row.outline_snapshot_json, undefined) : undefined,
          settingSnapshot: row.setting_snapshot_json ? safeJson(row.setting_snapshot_json, undefined) : undefined,
          manualExcellent: bool(row.manual_excellent),
          excellentFragments: mapExcellentFragments(String(row.text), String(row.id)),
        }));
        const currentVersionId = content?.current_version_id && outlineVersions.some((version) => version.id === String(content.current_version_id))
          ? String(content.current_version_id)
          : null;
        const defaultVersionId = content?.default_version_id && outlineVersions.some((version) => version.id === String(content.default_version_id))
          ? String(content.default_version_id)
          : null;
        const outlineTitle = normalizeOutlineTitle(outlineRow.title);
        const outlineNameState = normalizeNameVersionState(
          outlineId,
          outlineTitle,
          safeJson<NameVersion[]>(outlineRow.name_versions_json, []),
          outlineRow.default_name_version_id,
          String(outlineRow.created_at),
          80,
        );
        return {
          ...(outlineRow.expansion_json ? { expansion: normalizeOutlineExpansion(String(outlineRow.summary), safeJson(outlineRow.expansion_json, undefined)) } : {}),
          id: outlineId, title: outlineTitle, ...outlineNameState, plan: String(outlineRow.summary), generateInstruction: String(outlineRow.generate_instruction ?? ""),
          illustrationOptions: outlineRow.illustration_options_json == null ? null : normalizeIllustrationOptions(safeJson(outlineRow.illustration_options_json, {})),
          generateOptions: outlineRow.generate_options_json == null ? null : normalizeAiGenerateOptions(safeJson(outlineRow.generate_options_json, {}), DEFAULT_AI_GENERATE_OPTIONS),
          settings: normalizeChapterSettings(safeJson(outlineRow.settings_json, {})),
          titleGenerationPending: bool(outlineRow.title_generation_pending),
          content: String(content?.text ?? ""), contentName: String(content?.content_name ?? "").trim() || timestampContentName(String(outlineRow.updated_at)),
          currentVersionId, defaultVersionId,
          contentOutlineSnapshot: content?.outline_snapshot_json ? safeJson<{ title: string; plan: string } | undefined>(content.outline_snapshot_json, undefined) : undefined,
          manualExcellent: bool(content?.manual_excellent), archived: bool(outlineRow.archived),
          state: String(outlineRow.state) as "saved" | "running" | "failed", updatedAt: String(outlineRow.updated_at),
          excellentFragments: mapExcellentFragments(String(content?.text ?? "")),
          versions: outlineVersions,
          chat: { sessions: sessionItems.length ? sessionItems : [fallbackSession], activeSessionId },
        };
      });
      const chapterNameState = normalizeNameVersionState(
        chapterId,
        String(chapterRow.title),
        safeJson<NameVersion[]>(chapterRow.name_versions_json, []),
        chapterRow.default_name_version_id,
        String(chapterRow.created_at),
        120,
      );
      return { id: chapterId, title: String(chapterRow.title), ...chapterNameState, settings: normalizeChapterSettings(safeJson(chapterRow.settings_json, {})), archived: bool(chapterRow.archived), outlines: chapterOutlines };
    });
    const migratedArticle = migrateArticleStoryDetails(
      articleRow.summary,
      articleRow.article_type,
      safeJson(articleRow.story_settings_json, {}),
    );
    return {
      id: articleId, title: String(articleRow.title), summary: migratedArticle.summary, type: migratedArticle.type,
      storySettings: migratedArticle.storySettings,
      reviewRules: normalizeReviewRules(articleRow.review_rules),
      reviewRuleItems: normalizeReviewRuleItems(articleRow.review_rule_items_json == null ? undefined : JSON.parse(String(articleRow.review_rule_items_json)), String(articleRow.id), normalizeReviewRules(articleRow.review_rules), String(articleRow.created_at)),
      style: String(articleRow.style), createdAt: String(articleRow.created_at), updatedAt: String(articleRow.updated_at),
      chapterNaming: normalizeNamingProfile(safeJson(articleRow.chapter_naming_json, {}), DEFAULT_CHAPTER_NAMING_PROFILE),
      outlineNaming: normalizeNamingProfile(safeJson(articleRow.outline_naming_json, {}), DEFAULT_OUTLINE_NAMING_PROFILE),
      aiGenerateSettings,
      illustrationSettings: normalizeIllustrationOptions(safeJson(articleRow.illustration_settings_json, {})),
      lastOutlineId: "", chapters: articleChapters,
      characters: characters.filter((row) => row.article_id === articleId).map((row) => {
        const migratedCharacter = migrateCharacterDetails(row.description, safeJson(row.profile_json, {}));
        return {
          id: String(row.id), name: String(row.name), aliases: safeJson<string[]>(row.aliases_json, []),
          description: migratedCharacter.description, profile: migratedCharacter.profile, archived: bool(row.archived),
          ...(normalizeCharacterPhotos(safeJson(row.photos_json, null)) ? { photos: normalizeCharacterPhotos(safeJson(row.photos_json, null)) } : {}),
          ...(normalizeCharacterVisual(safeJson(row.visual_json, null)) ? { visual: normalizeCharacterVisual(safeJson(row.visual_json, null)) } : {}),
        };
      }),
      relationships: relationships.filter((row) => row.article_id === articleId).map((row) => ({
        id: String(row.id), characterAId: String(row.character_low_id), characterBId: String(row.character_high_id), description: String(row.description),
      })),
    };
  });
  const currentArticleId = articles[0].id;
  const selectedArticle = articles[0];
  const currentOutlineId = selectedArticle.chapters.flatMap((chapter) => chapter.outlines)[0]?.id ?? "";
  return {
    revision,
    databaseVersion,
    data: {
      version: 1,
      currentArticleId,
      currentOutlineId,
      articles,
      tasks,
      settings: studioSettings,
    },
  };
}

export function uniqueExcellentFragments(content: string, fragments: unknown, usedIds: Set<string>) {
  return normalizeExcellentFragments(content, fragments).map((fragment) => {
    let id = fragment.id;
    while (usedIds.has(id)) id = `excellent-${crypto.randomUUID()}`;
    usedIds.add(id);
    return id === fragment.id ? fragment : { ...fragment, id };
  });
}

export type StudioWriteOptions = { syncOperationId?: string; styleLab?: StyleLabSnapshot };

export function syncOperationReceiptStatements(db: SqliteDatabase, operationId: string | undefined, databaseVersion: number, now: string) {
  if (!operationId) return [];
  return [
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('sync_last_applied_operation_id',?,?)").bind(operationId, now),
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('sync_last_applied_operation_version',?,?)").bind(String(databaseVersion), now),
  ];
}

export async function writeStudioState(data: StudioData, expectedRevision: number, options?: StudioWriteOptions) {
  await ensureDatabase();
  const db = getDatabase();
  const currentState = await readStudioState();
  const current = currentState.revision;
  if (current !== expectedRevision) return { conflict: true as const, current: currentState };
  const currentDatabaseVersion = currentState.databaseVersion;

  for (const article of data.articles) for (const chapter of article.chapters) for (const outline of chapter.outlines) {
    validateOutlineVersionReferences(outline.id, outline.versions,
      Object.hasOwn(outline, "currentVersionId") ? outline.currentVersionId : outline.contentOverride === false ? outline.sourceVersionId : null,
      Object.hasOwn(outline, "defaultVersionId") ? outline.defaultVersionId : outline.sourceVersionId);
  }

  if (!options?.styleLab && currentState.data && isStudioChangesEmpty(diffStudioData(currentState.data, data))) {
    if (!options?.syncOperationId) return { conflict: false as const, revision: current, databaseVersion: currentDatabaseVersion, unchanged: true as const };
    const now = new Date().toISOString();
    try {
      await db.batch([
        db.prepare("UPDATE app_settings SET value_json=CASE WHEN CAST((SELECT value_json FROM app_settings WHERE key='state_revision') AS INTEGER)=? AND CAST((SELECT value_json FROM app_settings WHERE key='database_version') AS INTEGER)=? THEN ? ELSE NULL END, updated_at=? WHERE key='state_write_guard'").bind(current, currentDatabaseVersion, crypto.randomUUID(), now),
        ...syncOperationReceiptStatements(db, options.syncOperationId, currentDatabaseVersion, now),
      ]);
      return { conflict: false as const, revision: current, databaseVersion: currentDatabaseVersion, unchanged: true as const };
    } catch (error) {
      const actual = await readStudioState();
      if (actual.revision !== current || actual.databaseVersion !== currentDatabaseVersion) return { conflict: true as const, current: actual };
      throw error;
    }
  }

  const now = new Date().toISOString();
  const nextRevision = expectedRevision + 1;
  const nextDatabaseVersion = currentDatabaseVersion + 1;
  const statements: SqliteStatement[] = [
    db.prepare("UPDATE app_settings SET value_json=CASE WHEN CAST((SELECT value_json FROM app_settings WHERE key='state_revision') AS INTEGER)=? AND CAST((SELECT value_json FROM app_settings WHERE key='database_version') AS INTEGER)=? THEN ? ELSE NULL END, updated_at=? WHERE key='state_write_guard'").bind(expectedRevision, currentDatabaseVersion, crypto.randomUUID(), now),
    db.prepare(preserveIllustrationHistorySql),
    ...preserveStyleLabSql.map(sql => db.prepare(sql)),
    db.prepare("DELETE FROM character_photo_jobs"),
    db.prepare("DELETE FROM articles"),
    db.prepare("DELETE FROM search_documents"),
  ];
  const writtenExcellentFragmentIds = new Set<string>();
  for (const article of data.articles) {
    statements.push(insert(db, "INSERT INTO articles(id,title,summary,article_type,style,story_settings_json,chapter_naming_json,outline_naming_json,ai_generate_settings_json,illustration_settings_json,created_at,updated_at,last_opened_at,revision,review_rules,review_rule_items_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [article.id, article.title.slice(0, 120), article.summary, article.type, article.style, ...serializeArticleSettings(article), article.createdAt, article.updatedAt, article.updatedAt, nextRevision, normalizeReviewRules(article.reviewRules), JSON.stringify(articleReviewRules(article))]));
    article.chapters.forEach((chapter, chapterIndex) => {
      const chapterNameState = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
      statements.push(insert(db, "INSERT INTO chapters(id,article_id,title,name_versions_json,default_name_version_id,settings_json,position,archived,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [chapter.id, article.id, chapter.title, JSON.stringify(chapterNameState.nameVersions), chapterNameState.defaultNameVersionId, JSON.stringify(normalizeChapterSettings(chapter.settings)), (chapterIndex + 1) * 1024, chapter.archived ? 1 : 0, article.createdAt, article.updatedAt, nextRevision]));
      statements.push(insert(db, "INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)", [article.id, chapter.id, null, "chapter", chapter.id, chapter.title, ""]));
      chapter.outlines.forEach((outline, outlineIndex) => {
        const referenceContent = resolvedOutlineContent(outline);
        const normalizedTitle = normalizeOutlineTitle(outline.title);
        const outlineNameState = normalizeNameVersionState(outline.id, normalizedTitle, outline.nameVersions, outline.defaultNameVersionId, outline.updatedAt, 80);
        const defaultVersionId = Object.prototype.hasOwnProperty.call(outline, "defaultVersionId") ? outline.defaultVersionId : outline.sourceVersionId ?? null;
        const currentVersionId = Object.prototype.hasOwnProperty.call(outline, "currentVersionId") ? outline.currentVersionId : outline.contentOverride === false ? outline.sourceVersionId ?? null : null;
        const contentOutlineSnapshot = outline.contentOutlineSnapshot
          ?? (!currentVersionId && outline.sourceVersionId ? outline.versions.find((version) => version.id === outline.sourceVersionId)?.outlineSnapshot : undefined)
          ?? { title: normalizedTitle, plan: outline.plan };
        statements.push(insert(db, "INSERT INTO outlines(id,article_id,chapter_id,title,name_versions_json,default_name_version_id,summary,generate_instruction,generate_options_json,illustration_options_json,settings_json,position,archived,state,title_generation_pending,created_at,updated_at,revision,expansion_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [outline.id, article.id, chapter.id, normalizedTitle, JSON.stringify(outlineNameState.nameVersions), outlineNameState.defaultNameVersionId, outline.plan.slice(0, 10000), String(outline.generateInstruction ?? "").slice(0, 20000), outline.generateOptions == null ? null : JSON.stringify(normalizeAiGenerateOptions(outline.generateOptions)), outline.illustrationOptions == null ? null : JSON.stringify(normalizeIllustrationOptions(outline.illustrationOptions)), JSON.stringify(normalizeChapterSettings(outline.settings)), (outlineIndex + 1) * 1024, outline.archived ? 1 : 0, outline.state, outline.titleGenerationPending ? 1 : 0, outline.updatedAt, outline.updatedAt, nextRevision, outline.expansion ? JSON.stringify(normalizeOutlineExpansion(outline.plan, outline.expansion)) : null]));
        statements.push(insert(db, "INSERT INTO contents(id,outline_id,text,content_name,content_override,source_version_id,current_version_id,default_version_id,outline_snapshot_json,manual_excellent,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [`content:${outline.id}`, outline.id, outline.content, outline.contentName?.trim() || timestampContentName(outline.updatedAt), currentVersionId ? 0 : 1, defaultVersionId, currentVersionId, defaultVersionId, JSON.stringify(contentOutlineSnapshot), outline.manualExcellent ? 1 : 0, outline.updatedAt, nextRevision]));
        statements.push(insert(db, "INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)", [article.id, chapter.id, outline.id, "outline", outline.id, outlineDisplayTitle({ title: normalizedTitle, plan: outline.plan }), `${outline.plan}\n${referenceContent}`]));
        outline.versions.forEach((version) => {
          statements.push(insert(db, "INSERT INTO versions(id,outline_id,name,text,source,model_id,model_name,prompt,task_id,rewrite_source_id,rewrite_source_name,outline_snapshot_json,setting_snapshot_json,manual_excellent,created_at,review_report_json,review_rule_snapshot_json,last_selected_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [version.id, outline.id, version.name, version.content, version.source === "AI Generate" ? "ai-generate" : version.source === "AI Chat" ? "ai-chat" : version.source === "AI Review" ? "ai-review" : version.source === "未保存内容" ? "unsaved" : "manual", version.modelId ?? null, version.model ?? null, version.prompt ?? null, version.taskId ?? null, version.rewriteSourceId ?? null, version.rewriteSourceName ?? null, version.outlineSnapshot ? JSON.stringify(version.outlineSnapshot) : null, version.settingSnapshot ? JSON.stringify(version.settingSnapshot) : null, version.manualExcellent ? 1 : 0, version.createdAt, version.reviewReport ? JSON.stringify(version.reviewReport) : null, version.reviewRuleSnapshot ? JSON.stringify(version.reviewRuleSnapshot) : null, version.lastSelectedAt ?? null]));
          uniqueExcellentFragments(version.content, version.excellentFragments, writtenExcellentFragmentIds).forEach((fragment) => statements.push(insert(db, "INSERT INTO excellent_fragments(id,outline_id,version_id,start_offset,end_offset,selected_text,prefix_context,suffix_context,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [fragment.id, outline.id, version.id, fragment.start, fragment.end, fragment.text, fragment.prefix, fragment.suffix, fragment.sourceHash, fragment.createdAt, fragment.updatedAt])));
        });
        uniqueExcellentFragments(outline.content, outline.excellentFragments, writtenExcellentFragmentIds).forEach((fragment) => statements.push(insert(db, "INSERT INTO excellent_fragments(id,outline_id,version_id,start_offset,end_offset,selected_text,prefix_context,suffix_context,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [fragment.id, outline.id, null, fragment.start, fragment.end, fragment.text, fragment.prefix, fragment.suffix, fragment.sourceHash, fragment.createdAt, fragment.updatedAt])));
        outline.chat.sessions.forEach((session) => {
          statements.push(insert(db, "INSERT INTO chat_sessions(id,article_id,outline_id,draft,model_id,context_options_json,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?)", [session.id, article.id, outline.id, session.draft, null, JSON.stringify({ title: session.title, mode: normalizeChatMode(session.mode), includePrevious: session.includePrevious, includeCharacters: session.includeCharacters, active: session.id === outline.chat.activeSessionId, lastReadMessageId: session.lastReadMessageId ?? null }), session.createdAt, session.updatedAt, nextRevision]));
          session.messages.forEach((message, index) => statements.push(insert(db, "INSERT INTO chat_messages(id,session_id,role,content,status,order_index,created_at) VALUES(?,?,?,?,?,?,?)", [message.id, session.id, message.role, message.text, message.stopped ? "stopped" : "complete", index, message.createdAt])));
        });
      });
    });
    article.characters.forEach((character) => {
      statements.push(insert(db, "INSERT INTO characters(id,article_id,name,aliases_json,description,profile_json,visual_json,photos_json,archived,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [character.id, article.id, character.name, JSON.stringify(character.aliases), character.description, ...serializeCharacterSettings(character), character.archived ? 1 : 0, now, now, nextRevision]));
      statements.push(insert(db, "INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)", [article.id, null, null, "character", character.id, character.name, `${character.aliases.join(" ")}\n${character.description}`]));
    });
    article.relationships.forEach((relationship) => {
      const [low, high] = [relationship.characterAId, relationship.characterBId].sort();
      statements.push(insert(db, "INSERT INTO relationships(id,article_id,character_low_id,character_high_id,description,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?)", [relationship.id, article.id, low, high, relationship.description, now, now, nextRevision]));
    });
  }
  statements.push(db.prepare(restoreIllustrationHistorySql), db.prepare(clearIllustrationHistoryBackupSql));
  statements.push(...restoreStyleLabSql.map(sql => db.prepare(sql)), db.prepare(clearStyleLabBackupSql));
  if (options?.styleLab) statements.push(...importStyleLabStatements(db, options.styleLab));
  for (const task of data.tasks.slice(0, 20)) {
    statements.push(insert(db, "INSERT INTO ai_tasks(id,article_id,chapter_id,outline_id,target,instruction,model_id,execution_origin,context_options_json,idempotency_key,status,attempt,result_text,result_version_id,error_message,input_tokens,output_tokens,phase,last_progress_at,received_characters,timeout_ms,runner_id,lease_until,created_at,started_at,completed_at,history_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [task.id, task.articleId, task.chapterId, task.outlineId, taskTargetCode(task.target), task.prompt, task.model, normalizeTaskExecutionOrigin(task.executionOrigin), JSON.stringify(task.contextOptions ?? {}), task.id, task.state === "waiting" ? "queued" : task.state === "failed" ? "error" : task.state, task.attempt ?? 0, task.resultText ?? null, task.resultVersionId ?? null, task.error ?? null, task.inputTokens ?? null, task.outputTokens ?? null, task.phase ?? null, task.lastProgressAt ?? null, task.receivedCharacters ?? null, task.timeoutMs ?? null, task.runnerId ?? null, task.leaseUntil ?? null, task.createdAt, task.startedAt ?? null, task.completedAt ?? null, JSON.stringify(parseTaskHistory(task.history))]));
  }
  statements.push(insert(db, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('studio_ui',?,?)", [JSON.stringify({ settings: normalizeStudioSettings(data.settings) }), now]));
  statements.push(insert(db, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('state_revision',?,?)", [String(nextRevision), now]));
  statements.push(insert(db, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('database_version',?,?)", [String(nextDatabaseVersion), now]));
  statements.push(...syncOperationReceiptStatements(db, options?.syncOperationId, nextDatabaseVersion, now));
  try {
    await db.batch(statements);
  } catch (error) {
    const actual = await readStudioState();
    if (actual.revision !== expectedRevision || actual.databaseVersion !== currentDatabaseVersion) return { conflict: true as const, current: actual };
    throw error;
  }
  return { conflict: false as const, revision: nextRevision, databaseVersion: nextDatabaseVersion };
}

export function taskTargetValue(task: StudioData["tasks"][number]) {
  return taskTargetCode(task.target);
}

export function taskStatusValue(task: StudioData["tasks"][number]) {
  return task.state === "waiting" ? "queued" : task.state === "failed" ? "error" : task.state;
}

export function owns(value: object | undefined, key: string) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

export async function applyStudioChanges(changes: StudioChanges, expectedRevision: number, options?: { recordSyncChange?: boolean; expectedDatabaseVersion?: number; syncOperationId?: string; taskRunnerId?: string; taskInteractionId?: string; additionalStatements?: SqliteStatement[] }) {
  await ensureDatabase();
  const db = getDatabase();
  const currentRevision = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
  const currentDatabaseVersion = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='database_version'").first<string>("value_json") ?? currentRevision);
  if (currentRevision !== expectedRevision || (options?.expectedDatabaseVersion !== undefined && currentDatabaseVersion !== options.expectedDatabaseVersion)) {
    return { conflict: true as const, revision: currentRevision, databaseVersion: currentDatabaseVersion };
  }

  for (const { outline } of changes.outlines.upsert) {
    validateOutlineVersionReferences(outline.id, outline.versions,
      Object.hasOwn(outline, "currentVersionId") ? outline.currentVersionId : outline.contentOverride === false ? outline.sourceVersionId : null,
      Object.hasOwn(outline, "defaultVersionId") ? outline.defaultVersionId : outline.sourceVersionId);
  }
  for (const patch of changes.outlines.patch ?? []) {
    if (patch.versions === undefined && !owns(patch.content, "currentVersionId") && !owns(patch.content, "defaultVersionId")) continue;
    const upsert = changes.outlines.upsert.find(item => item.outline.id === patch.id)?.outline;
    const stored = upsert ? { current_version_id: upsert.currentVersionId, default_version_id: upsert.defaultVersionId }
      : await db.prepare("SELECT current_version_id,default_version_id FROM contents WHERE outline_id=?").bind(patch.id).first<{ current_version_id: string | null; default_version_id: string | null }>();
    if (!stored) throw new StudioInputError("正文不存在，不能设置版本");
    const versions = patch.versions ?? upsert?.versions ?? (await db.prepare("SELECT id FROM versions WHERE outline_id=?").bind(patch.id).all<{ id: string }>()).results ?? [];
    validateOutlineVersionReferences(patch.id, versions,
      owns(patch.content, "currentVersionId") ? patch.content?.currentVersionId : stored.current_version_id,
      owns(patch.content, "defaultVersionId") ? patch.content?.defaultVersionId : stored.default_version_id);
  }

  if (isStudioChangesEmpty(changes) && !options?.additionalStatements?.length) {
    if (!options?.syncOperationId) return { conflict: false as const, revision: currentRevision, databaseVersion: currentDatabaseVersion, unchanged: true as const };
    const now = new Date().toISOString();
    try {
      await db.batch([
        db.prepare("UPDATE app_settings SET value_json=CASE WHEN CAST((SELECT value_json FROM app_settings WHERE key='state_revision') AS INTEGER)=? AND CAST((SELECT value_json FROM app_settings WHERE key='database_version') AS INTEGER)=? THEN ? ELSE NULL END, updated_at=? WHERE key='state_write_guard'").bind(expectedRevision, currentDatabaseVersion, crypto.randomUUID(), now),
        ...syncOperationReceiptStatements(db, options.syncOperationId, currentDatabaseVersion, now),
      ]);
      return { conflict: false as const, revision: currentRevision, databaseVersion: currentDatabaseVersion, unchanged: true as const };
    } catch (error) {
      const actualRevision = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
      const actualDatabaseVersion = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='database_version'").first<string>("value_json") ?? actualRevision);
      if (actualRevision !== expectedRevision || actualDatabaseVersion !== currentDatabaseVersion) return { conflict: true as const, revision: actualRevision, databaseVersion: actualDatabaseVersion };
      throw error;
    }
  }

  const now = new Date().toISOString();
  const nextRevision = currentRevision + 1;
  const nextDatabaseVersion = currentDatabaseVersion + 1;
  const statements: SqliteStatement[] = [
    db.prepare("UPDATE app_settings SET value_json=CASE WHEN CAST((SELECT value_json FROM app_settings WHERE key='state_revision') AS INTEGER)=? AND CAST((SELECT value_json FROM app_settings WHERE key='database_version') AS INTEGER)=? THEN ? ELSE NULL END, updated_at=? WHERE key='state_write_guard'").bind(expectedRevision, currentDatabaseVersion, crypto.randomUUID(), now),
  ];

  for (const id of changes.tasks.delete) statements.push(db.prepare("DELETE FROM ai_tasks WHERE id=?").bind(id));
  for (const id of changes.relationships.delete) statements.push(db.prepare("DELETE FROM relationships WHERE id=?").bind(id));
  for (const id of changes.characters.delete) {
    statements.push(db.prepare("DELETE FROM character_photo_jobs WHERE character_id=?").bind(id));
    statements.push(db.prepare("DELETE FROM search_documents WHERE entity_type='character' AND entity_id=?").bind(id));
    statements.push(db.prepare("DELETE FROM characters WHERE id=?").bind(id));
  }
  for (const id of changes.outlines.delete) {
    statements.push(db.prepare("DELETE FROM search_documents WHERE outline_id=? OR (entity_type='outline' AND entity_id=?)").bind(id, id));
    statements.push(db.prepare("DELETE FROM outlines WHERE id=?").bind(id));
  }
  for (const id of changes.chapters.delete) {
    statements.push(db.prepare("DELETE FROM search_documents WHERE chapter_id=? OR (entity_type='chapter' AND entity_id=?)").bind(id, id));
    statements.push(db.prepare("DELETE FROM chapters WHERE id=?").bind(id));
  }
  for (const id of changes.articles.delete) {
    statements.push(db.prepare("DELETE FROM search_documents WHERE article_id=?").bind(id));
    statements.push(db.prepare("DELETE FROM articles WHERE id=?").bind(id));
  }

  changes.chapters.upsert.forEach((item, index) => statements.push(db.prepare("UPDATE chapters SET position=? WHERE id=?").bind(-1_000_000_000 - index, item.chapter.id)));
  changes.outlines.upsert.forEach((item, index) => statements.push(db.prepare("UPDATE outlines SET position=? WHERE id=?").bind(-1_000_000_000 - index, item.outline.id)));
  (changes.outlines.patch ?? []).filter((item) => item.location && (owns(item.location, "chapterId") || owns(item.location, "position"))).forEach((item, index) => {
    statements.push(db.prepare("UPDATE outlines SET position=? WHERE id=?").bind(-1_000_000_000 - changes.outlines.upsert.length - index, item.id));
  });

  for (const article of changes.articles.upsert) {
    statements.push(insert(db, `INSERT INTO articles(id,title,summary,article_type,style,story_settings_json,chapter_naming_json,outline_naming_json,ai_generate_settings_json,illustration_settings_json,created_at,updated_at,last_opened_at,revision,review_rules,review_rule_items_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET review_rule_items_json=excluded.review_rule_items_json,review_rules=excluded.review_rules,title=excluded.title,summary=excluded.summary,article_type=excluded.article_type,style=excluded.style,story_settings_json=excluded.story_settings_json,chapter_naming_json=excluded.chapter_naming_json,outline_naming_json=excluded.outline_naming_json,ai_generate_settings_json=excluded.ai_generate_settings_json,illustration_settings_json=excluded.illustration_settings_json,updated_at=excluded.updated_at,last_opened_at=excluded.last_opened_at,revision=excluded.revision`,
    [article.id, article.title.slice(0, 120), article.summary.slice(0, 10_000), article.type.slice(0, 120), article.style.slice(0, 5_000), ...serializeArticleSettings(article), article.createdAt, article.updatedAt, article.updatedAt, nextRevision, normalizeReviewRules(article.reviewRules), JSON.stringify(articleReviewRules(article))]));
  }

  for (const item of changes.chapters.upsert) {
    const chapter = item.chapter;
    const names = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, now, 120);
    statements.push(insert(db, `INSERT INTO chapters(id,article_id,title,name_versions_json,default_name_version_id,settings_json,position,archived,created_at,updated_at,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET article_id=excluded.article_id,title=excluded.title,name_versions_json=excluded.name_versions_json,default_name_version_id=excluded.default_name_version_id,settings_json=excluded.settings_json,position=excluded.position,archived=excluded.archived,updated_at=excluded.updated_at,revision=excluded.revision`,
    [chapter.id, item.articleId, chapter.title.slice(0, 120), JSON.stringify(names.nameVersions), names.defaultNameVersionId, JSON.stringify(normalizeChapterSettings(chapter.settings)), item.position, chapter.archived ? 1 : 0, now, now, nextRevision]));
    statements.push(db.prepare("DELETE FROM search_documents WHERE entity_type='chapter' AND entity_id=?").bind(chapter.id));
    statements.push(insert(db, "INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)", [item.articleId, chapter.id, null, "chapter", chapter.id, chapter.title, ""]));
  }

  for (const item of changes.outlines.upsert) {
    const outline = item.outline;
    const normalizedTitle = normalizeOutlineTitle(outline.title);
    const names = normalizeNameVersionState(outline.id, normalizedTitle, outline.nameVersions, outline.defaultNameVersionId, outline.updatedAt, 80);
    const defaultVersionId = Object.prototype.hasOwnProperty.call(outline, "defaultVersionId") ? outline.defaultVersionId : outline.sourceVersionId ?? null;
    const currentVersionId = Object.prototype.hasOwnProperty.call(outline, "currentVersionId") ? outline.currentVersionId : outline.contentOverride === false ? outline.sourceVersionId ?? null : null;
    const contentOutlineSnapshot = outline.contentOutlineSnapshot
      ?? (!currentVersionId && outline.sourceVersionId ? outline.versions.find((version) => version.id === outline.sourceVersionId)?.outlineSnapshot : undefined)
      ?? { title: normalizedTitle, plan: outline.plan };
    statements.push(insert(db, `INSERT INTO outlines(id,article_id,chapter_id,title,name_versions_json,default_name_version_id,summary,generate_instruction,generate_options_json,illustration_options_json,settings_json,position,archived,state,title_generation_pending,created_at,updated_at,revision,expansion_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET article_id=excluded.article_id,chapter_id=excluded.chapter_id,title=excluded.title,name_versions_json=excluded.name_versions_json,default_name_version_id=excluded.default_name_version_id,summary=excluded.summary,generate_instruction=excluded.generate_instruction,generate_options_json=excluded.generate_options_json,expansion_json=excluded.expansion_json,illustration_options_json=excluded.illustration_options_json,settings_json=excluded.settings_json,position=excluded.position,archived=excluded.archived,state=excluded.state,title_generation_pending=excluded.title_generation_pending,updated_at=excluded.updated_at,revision=excluded.revision`,
    [outline.id, item.articleId, item.chapterId, normalizedTitle, JSON.stringify(names.nameVersions), names.defaultNameVersionId, outline.plan.slice(0, 10_000), String(outline.generateInstruction ?? "").slice(0, 20_000), outline.generateOptions == null ? null : JSON.stringify(normalizeAiGenerateOptions(outline.generateOptions)), outline.illustrationOptions == null ? null : JSON.stringify(normalizeIllustrationOptions(outline.illustrationOptions)), JSON.stringify(normalizeChapterSettings(outline.settings)), item.position, outline.archived ? 1 : 0, outline.state, outline.titleGenerationPending ? 1 : 0, outline.updatedAt, outline.updatedAt, nextRevision, outline.expansion ? JSON.stringify(normalizeOutlineExpansion(outline.plan, outline.expansion)) : null]));
    statements.push(insert(db, `INSERT INTO contents(id,outline_id,text,content_name,content_override,source_version_id,current_version_id,default_version_id,outline_snapshot_json,manual_excellent,updated_at,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(outline_id) DO UPDATE SET text=excluded.text,content_name=excluded.content_name,content_override=excluded.content_override,source_version_id=excluded.source_version_id,current_version_id=excluded.current_version_id,default_version_id=excluded.default_version_id,outline_snapshot_json=excluded.outline_snapshot_json,manual_excellent=excluded.manual_excellent,updated_at=excluded.updated_at,revision=excluded.revision`,
    [`content:${outline.id}`, outline.id, outline.content, outline.contentName?.trim() || timestampContentName(outline.updatedAt), currentVersionId ? 0 : 1, defaultVersionId, currentVersionId, defaultVersionId, JSON.stringify(contentOutlineSnapshot), outline.manualExcellent ? 1 : 0, outline.updatedAt, nextRevision]));
    statements.push(db.prepare("DELETE FROM versions WHERE outline_id=?").bind(outline.id));
    statements.push(db.prepare("DELETE FROM excellent_fragments WHERE outline_id=?").bind(outline.id));
    const usedFragmentIds = new Set<string>();
    for (const version of outline.versions) {
      statements.push(insert(db, "INSERT INTO versions(id,outline_id,name,text,source,model_id,model_name,prompt,task_id,rewrite_source_id,rewrite_source_name,outline_snapshot_json,setting_snapshot_json,manual_excellent,created_at,review_report_json,review_rule_snapshot_json,last_selected_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [version.id, outline.id, version.name, version.content, version.source === "AI Generate" ? "ai-generate" : version.source === "AI Chat" ? "ai-chat" : version.source === "AI Review" ? "ai-review" : version.source === "未保存内容" ? "unsaved" : "manual", version.modelId ?? null, version.model ?? null, version.prompt ?? null, version.taskId ?? null, version.rewriteSourceId ?? null, version.rewriteSourceName ?? null, version.outlineSnapshot ? JSON.stringify(version.outlineSnapshot) : null, version.settingSnapshot ? JSON.stringify(version.settingSnapshot) : null, version.manualExcellent ? 1 : 0, version.createdAt, version.reviewReport ? JSON.stringify(version.reviewReport) : null, version.reviewRuleSnapshot ? JSON.stringify(version.reviewRuleSnapshot) : null, version.lastSelectedAt ?? null]));
      uniqueExcellentFragments(version.content, version.excellentFragments, usedFragmentIds).forEach((fragment) => statements.push(insert(db, "INSERT INTO excellent_fragments(id,outline_id,version_id,start_offset,end_offset,selected_text,prefix_context,suffix_context,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [fragment.id, outline.id, version.id, fragment.start, fragment.end, fragment.text, fragment.prefix, fragment.suffix, fragment.sourceHash, fragment.createdAt, fragment.updatedAt])));
    }
    uniqueExcellentFragments(outline.content, outline.excellentFragments, usedFragmentIds).forEach((fragment) => statements.push(insert(db, "INSERT INTO excellent_fragments(id,outline_id,version_id,start_offset,end_offset,selected_text,prefix_context,suffix_context,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [fragment.id, outline.id, null, fragment.start, fragment.end, fragment.text, fragment.prefix, fragment.suffix, fragment.sourceHash, fragment.createdAt, fragment.updatedAt])));
    statements.push(db.prepare("DELETE FROM chat_sessions WHERE outline_id=?").bind(outline.id));
    for (const session of outline.chat.sessions) {
      statements.push(insert(db, "INSERT INTO chat_sessions(id,article_id,outline_id,draft,model_id,context_options_json,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?)", [session.id, item.articleId, outline.id, session.draft, null, JSON.stringify({ title: session.title, mode: normalizeChatMode(session.mode), includePrevious: session.includePrevious, includeCharacters: session.includeCharacters, active: session.id === outline.chat.activeSessionId, lastReadMessageId: session.lastReadMessageId ?? null }), session.createdAt, session.updatedAt, nextRevision]));
      session.messages.forEach((message, index) => statements.push(insert(db, "INSERT INTO chat_messages(id,session_id,role,content,status,order_index,created_at) VALUES(?,?,?,?,?,?,?)", [message.id, session.id, message.role, message.text, message.stopped ? "stopped" : "complete", index, message.createdAt])));
    }
    statements.push(db.prepare("DELETE FROM search_documents WHERE entity_type='outline' AND entity_id=?").bind(outline.id));
    statements.push(insert(db, "INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)", [item.articleId, item.chapterId, outline.id, "outline", outline.id, outlineDisplayTitle({ title: normalizedTitle, plan: outline.plan }), `${outline.plan}\n${resolvedOutlineContent(outline)}`]));
  }

  for (const item of changes.outlines.patch ?? []) {
    const outlineFields = item.outline;
    const outlineAssignments: Array<[string, unknown]> = [];
    if (owns(item.location, "articleId")) outlineAssignments.push(["article_id", String(item.location?.articleId ?? item.articleId)]);
    if (owns(item.location, "chapterId")) outlineAssignments.push(["chapter_id", String(item.location?.chapterId ?? item.chapterId)]);
    if (owns(item.location, "position")) outlineAssignments.push(["position", Number(item.location?.position)]);
    if (owns(outlineFields, "title")) outlineAssignments.push(["title", normalizeOutlineTitle(outlineFields?.title)]);
    if (owns(outlineFields, "nameVersions")) outlineAssignments.push(["name_versions_json", JSON.stringify(outlineFields?.nameVersions ?? [])]);
    if (owns(outlineFields, "defaultNameVersionId")) outlineAssignments.push(["default_name_version_id", outlineFields?.defaultNameVersionId ?? null]);
    if (owns(outlineFields, "plan")) outlineAssignments.push(["summary", String(outlineFields?.plan ?? "").slice(0, 10_000)]);
    if (owns(outlineFields, "generateInstruction")) outlineAssignments.push(["generate_instruction", String(outlineFields?.generateInstruction ?? "").slice(0, 20_000)]);
    if (owns(outlineFields, "illustrationOptions")) outlineAssignments.push(["illustration_options_json", outlineFields?.illustrationOptions == null ? null : JSON.stringify(normalizeIllustrationOptions(outlineFields.illustrationOptions))]);
    if (owns(outlineFields, "expansion")) outlineAssignments.push(["expansion_json", outlineFields?.expansion == null ? null : JSON.stringify(outlineFields.expansion)]);
    if (owns(outlineFields, "generateOptions")) outlineAssignments.push(["generate_options_json", outlineFields?.generateOptions == null ? null : JSON.stringify(normalizeAiGenerateOptions(outlineFields.generateOptions))]);
    if (owns(outlineFields, "settings")) outlineAssignments.push(["settings_json", JSON.stringify(normalizeChapterSettings(outlineFields?.settings))]);
    if (owns(outlineFields, "archived")) outlineAssignments.push(["archived", outlineFields?.archived ? 1 : 0]);
    if (owns(outlineFields, "state")) outlineAssignments.push(["state", ["saved", "running", "failed"].includes(String(outlineFields?.state)) ? outlineFields?.state : "saved"]);
    if (owns(outlineFields, "titleGenerationPending")) outlineAssignments.push(["title_generation_pending", outlineFields?.titleGenerationPending ? 1 : 0]);
    if (owns(outlineFields, "updatedAt")) outlineAssignments.push(["updated_at", String(outlineFields?.updatedAt)]);
    outlineAssignments.push(["revision", nextRevision]);
    statements.push(updateByKey(db, "outlines", "id", item.id, outlineAssignments));

    const contentFields = item.content;
    const contentAssignments: Array<[string, unknown]> = [];
    if (owns(contentFields, "content")) contentAssignments.push(["text", String(contentFields?.content ?? "")]);
    if (owns(contentFields, "contentName")) contentAssignments.push(["content_name", String(contentFields?.contentName ?? "").trim() || timestampContentName(outlineFields?.updatedAt ?? now)]);
    if (owns(contentFields, "currentVersionId")) {
      contentAssignments.push(["current_version_id", contentFields?.currentVersionId ?? null]);
      contentAssignments.push(["content_override", contentFields?.currentVersionId ? 0 : 1]);
    }
    if (owns(contentFields, "defaultVersionId")) {
      contentAssignments.push(["default_version_id", contentFields?.defaultVersionId ?? null]);
      contentAssignments.push(["source_version_id", contentFields?.defaultVersionId ?? null]);
    }
    if (owns(contentFields, "contentOutlineSnapshot")) contentAssignments.push(["outline_snapshot_json", JSON.stringify(contentFields?.contentOutlineSnapshot ?? null)]);
    if (owns(contentFields, "manualExcellent")) contentAssignments.push(["manual_excellent", contentFields?.manualExcellent ? 1 : 0]);
    if (contentAssignments.length || Object.prototype.hasOwnProperty.call(item, "excellentFragments")) {
      contentAssignments.push(["updated_at", String(outlineFields?.updatedAt ?? now)]);
      contentAssignments.push(["revision", nextRevision]);
      statements.push(updateByKey(db, "contents", "outline_id", item.id, contentAssignments));
    }

    const versionsChanged = Object.prototype.hasOwnProperty.call(item, "versions");
    const bodyFragmentsChanged = Object.prototype.hasOwnProperty.call(item, "excellentFragments");
    const usedFragmentIds = new Set<string>();
    if (versionsChanged && !bodyFragmentsChanged) {
      const existing = await db.prepare("SELECT id FROM excellent_fragments WHERE outline_id=? AND version_id IS NULL").bind(item.id).all<Record<string, unknown>>();
      rows(existing).forEach((row) => usedFragmentIds.add(String(row.id)));
    } else if (!versionsChanged && bodyFragmentsChanged) {
      const existing = await db.prepare("SELECT id FROM excellent_fragments WHERE outline_id=? AND version_id IS NOT NULL").bind(item.id).all<Record<string, unknown>>();
      rows(existing).forEach((row) => usedFragmentIds.add(String(row.id)));
    }

    if (versionsChanged) {
      statements.push(db.prepare("DELETE FROM excellent_fragments WHERE outline_id=? AND version_id IS NOT NULL").bind(item.id));
      statements.push(db.prepare("DELETE FROM versions WHERE outline_id=?").bind(item.id));
      for (const version of item.versions ?? []) {
        statements.push(insert(db, "INSERT INTO versions(id,outline_id,name,text,source,model_id,model_name,prompt,task_id,rewrite_source_id,rewrite_source_name,outline_snapshot_json,setting_snapshot_json,manual_excellent,created_at,review_report_json,review_rule_snapshot_json,last_selected_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [version.id, item.id, version.name, version.content, version.source === "AI Generate" ? "ai-generate" : version.source === "AI Chat" ? "ai-chat" : version.source === "AI Review" ? "ai-review" : version.source === "未保存内容" ? "unsaved" : "manual", version.modelId ?? null, version.model ?? null, version.prompt ?? null, version.taskId ?? null, version.rewriteSourceId ?? null, version.rewriteSourceName ?? null, version.outlineSnapshot ? JSON.stringify(version.outlineSnapshot) : null, version.settingSnapshot ? JSON.stringify(version.settingSnapshot) : null, version.manualExcellent ? 1 : 0, version.createdAt, version.reviewReport ? JSON.stringify(version.reviewReport) : null, version.reviewRuleSnapshot ? JSON.stringify(version.reviewRuleSnapshot) : null, version.lastSelectedAt ?? null]));
        uniqueExcellentFragments(version.content, version.excellentFragments, usedFragmentIds).forEach((fragment) => statements.push(insert(db, "INSERT INTO excellent_fragments(id,outline_id,version_id,start_offset,end_offset,selected_text,prefix_context,suffix_context,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [fragment.id, item.id, version.id, fragment.start, fragment.end, fragment.text, fragment.prefix, fragment.suffix, fragment.sourceHash, fragment.createdAt, fragment.updatedAt])));
      }
    }

    if (bodyFragmentsChanged) {
      const fragmentContent = owns(contentFields, "content")
        ? String(contentFields?.content ?? "")
        : String(await db.prepare("SELECT text FROM contents WHERE outline_id=?").bind(item.id).first<string>("text") ?? "");
      statements.push(db.prepare("DELETE FROM excellent_fragments WHERE outline_id=? AND version_id IS NULL").bind(item.id));
      uniqueExcellentFragments(fragmentContent, item.excellentFragments, usedFragmentIds).forEach((fragment) => statements.push(insert(db, "INSERT INTO excellent_fragments(id,outline_id,version_id,start_offset,end_offset,selected_text,prefix_context,suffix_context,source_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [fragment.id, item.id, null, fragment.start, fragment.end, fragment.text, fragment.prefix, fragment.suffix, fragment.sourceHash, fragment.createdAt, fragment.updatedAt])));
    }

    if (item.chat) {
      statements.push(db.prepare("DELETE FROM chat_sessions WHERE outline_id=?").bind(item.id));
      for (const session of item.chat.sessions) {
        statements.push(insert(db, "INSERT INTO chat_sessions(id,article_id,outline_id,draft,model_id,context_options_json,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?)", [session.id, item.articleId, item.id, session.draft, null, JSON.stringify({ title: session.title, mode: normalizeChatMode(session.mode), includePrevious: session.includePrevious, includeCharacters: session.includeCharacters, active: session.id === item.chat.activeSessionId, lastReadMessageId: session.lastReadMessageId ?? null }), session.createdAt, session.updatedAt, nextRevision]));
        session.messages.forEach((message, index) => statements.push(insert(db, "INSERT INTO chat_messages(id,session_id,role,content,status,order_index,created_at) VALUES(?,?,?,?,?,?,?)", [message.id, session.id, message.role, message.text, message.stopped ? "stopped" : "complete", index, message.createdAt])));
      }
    }

    if (item.refreshSearch) {
      statements.push(db.prepare("DELETE FROM search_documents WHERE entity_type='outline' AND entity_id=?").bind(item.id));
      statements.push(db.prepare(`INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body)
        SELECT outlines.article_id,outlines.chapter_id,outlines.id,'outline',outlines.id,?,outlines.summary || CHAR(10) || COALESCE(versions.text,contents.text,'')
        FROM outlines JOIN contents ON contents.outline_id=outlines.id
        LEFT JOIN versions ON versions.id=contents.current_version_id AND versions.outline_id=outlines.id
        WHERE outlines.id=?`).bind(item.refreshSearch.title, item.id));
    }
  }

  for (const item of changes.characters.upsert) {
    const character = item.character;
    statements.push(insert(db, `INSERT INTO characters(id,article_id,name,aliases_json,description,profile_json,visual_json,photos_json,archived,created_at,updated_at,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET article_id=excluded.article_id,name=excluded.name,aliases_json=excluded.aliases_json,description=excluded.description,profile_json=excluded.profile_json,visual_json=excluded.visual_json,photos_json=excluded.photos_json,archived=excluded.archived,updated_at=excluded.updated_at,revision=excluded.revision`,
    [character.id, item.articleId, character.name.slice(0, 120), JSON.stringify([...new Set(character.aliases.map((value) => value.trim()).filter(Boolean))].slice(0, 50)), character.description.slice(0, 20_000), ...serializeCharacterSettings(character), character.archived ? 1 : 0, now, now, nextRevision]));
    statements.push(db.prepare("DELETE FROM search_documents WHERE entity_type='character' AND entity_id=?").bind(character.id));
    statements.push(insert(db, "INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)", [item.articleId, null, null, "character", character.id, character.name, `${character.aliases.join(" ")}\n${character.description}\n${Object.values(normalizeCharacterProfile(character.profile)).join("\n")}`]));
  }

  for (const item of changes.relationships.upsert) {
    const relationship = item.relationship;
    const [low, high] = [relationship.characterAId, relationship.characterBId].sort();
    statements.push(insert(db, `INSERT INTO relationships(id,article_id,character_low_id,character_high_id,description,created_at,updated_at,revision)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET article_id=excluded.article_id,character_low_id=excluded.character_low_id,character_high_id=excluded.character_high_id,description=excluded.description,updated_at=excluded.updated_at,revision=excluded.revision`,
    [relationship.id, item.articleId, low, high, relationship.description.slice(0, 5_000), now, now, nextRevision]));
  }

  // Browser autosaves may contain the pre-claim task snapshot. Server-managed
  // tasks accept task updates only from their current runner; cancellation,
  // retry and transfer use their dedicated state endpoint instead.
  for (const task of changes.tasks.upsert.slice(0, 20)) {
    statements.push(insert(db, `INSERT INTO ai_tasks(id,article_id,chapter_id,outline_id,target,instruction,model_id,execution_origin,context_options_json,idempotency_key,status,attempt,result_text,result_version_id,error_message,input_tokens,output_tokens,phase,last_progress_at,received_characters,timeout_ms,runner_id,lease_until,created_at,started_at,completed_at,history_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET article_id=excluded.article_id,chapter_id=excluded.chapter_id,outline_id=excluded.outline_id,target=excluded.target,instruction=excluded.instruction,model_id=excluded.model_id,execution_origin=excluded.execution_origin,context_options_json=excluded.context_options_json,status=excluded.status,attempt=excluded.attempt,result_text=excluded.result_text,result_version_id=excluded.result_version_id,error_message=excluded.error_message,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,phase=excluded.phase,last_progress_at=excluded.last_progress_at,received_characters=excluded.received_characters,timeout_ms=excluded.timeout_ms,runner_id=excluded.runner_id,lease_until=excluded.lease_until,started_at=excluded.started_at,completed_at=excluded.completed_at,history_json=CASE WHEN json_array_length(excluded.history_json)>=json_array_length(ai_tasks.history_json) THEN excluded.history_json ELSE ai_tasks.history_json END WHERE COALESCE(json_extract(ai_tasks.context_options_json,'$.serverManaged'),0)=0 OR ai_tasks.runner_id=? OR (ai_tasks.id=? AND ai_tasks.status IN ('queued','error') AND ai_tasks.runner_id IS NULL)`,
    [task.id, task.articleId, task.chapterId, task.outlineId, taskTargetValue(task), task.prompt.slice(0, 20_000), task.model, normalizeTaskExecutionOrigin(task.executionOrigin), JSON.stringify(task.contextOptions ?? {}), task.id, taskStatusValue(task), task.attempt ?? 0, task.resultText ?? null, task.resultVersionId ?? null, task.error ?? null, task.inputTokens ?? null, task.outputTokens ?? null, task.phase ?? null, task.lastProgressAt ?? null, task.receivedCharacters ?? null, task.timeoutMs ?? null, task.runnerId ?? null, task.leaseUntil ?? null, task.createdAt, task.startedAt ?? null, task.completedAt ?? null, JSON.stringify(parseTaskHistory(task.history)), options?.taskRunnerId ?? null, options?.taskInteractionId ?? null]));
  }

  if (options?.additionalStatements) statements.push(...options.additionalStatements);
  if (changes.settings) statements.push(insert(db, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('studio_ui',?,?)", [JSON.stringify({ settings: normalizeStudioSettings(changes.settings) }), now]));
  if ((options?.recordSyncChange ?? !isCloudDatabase())) {
    statements.push(db.prepare("DELETE FROM sync_change_log WHERE database_version<?").bind(Math.max(0, nextDatabaseVersion - 500)));
    statements.push(insert(db, "INSERT INTO sync_change_log(database_version,change_json,created_at) VALUES(?,?,?)", [nextDatabaseVersion, JSON.stringify(changes), now]));
  }
  statements.push(insert(db, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('state_revision',?,?)", [String(nextRevision), now]));
  statements.push(insert(db, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('database_version',?,?)", [String(nextDatabaseVersion), now]));
  statements.push(...syncOperationReceiptStatements(db, options?.syncOperationId, nextDatabaseVersion, now));

  try {
    await db.batch(statements);
  } catch (error) {
    const actualRevision = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
    const actualDatabaseVersion = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='database_version'").first<string>("value_json") ?? actualRevision);
    if (actualRevision !== expectedRevision || actualDatabaseVersion !== currentDatabaseVersion) return { conflict: true as const, revision: actualRevision, databaseVersion: actualDatabaseVersion };
    throw error;
  }
  return { conflict: false as const, revision: nextRevision, databaseVersion: nextDatabaseVersion };
}

export async function databaseStatus() {
  await ensureDatabase();
  const db = getDatabase();
  const searchMode = await db.prepare("SELECT value_json FROM app_settings WHERE key='search_mode'").first<string>("value_json");
  const [revision, databaseVersion, articles] = await Promise.all([
    db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json"),
    db.prepare("SELECT value_json FROM app_settings WHERE key='database_version'").first<string>("value_json"),
    db.prepare("SELECT COUNT(*) AS count FROM articles").first<number>("count"),
  ]);
  return { connected: true, engine: databaseEngine(), revision: Number(revision ?? 0), databaseVersion: Number(databaseVersion ?? revision ?? 0), articles: Number(articles ?? 0), searchMode: safeJson(searchMode, "substring") };
}

export async function claimChatRequest(requestId: string, requestHash: string) {
  await ensureDatabase();
  const db = getDatabase();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const results = await db.batch([
    db.prepare("DELETE FROM chat_request_claims WHERE expires_at <= ?").bind(createdAt),
    db.prepare("INSERT INTO chat_request_claims(request_id,request_hash,created_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(request_id) DO NOTHING").bind(requestId, requestHash, createdAt, expiresAt),
  ]);
  if (Number(results[1]?.meta?.changes ?? 0) > 0) return "claimed" as const;
  const existing = await db.prepare("SELECT request_hash FROM chat_request_claims WHERE request_id=?").bind(requestId).first<{ request_hash?: string }>();
  return existing?.request_hash === requestHash ? "duplicate" as const : "mismatch" as const;
}

export async function integrityCheck() {
  await ensureDatabase();
  const db = getDatabase();
  const result = await db.prepare("PRAGMA foreign_key_check").all();
  return { ok: rows(result).length === 0, issues: rows(result) };
}

export async function searchDocuments(articleId: string, query: string) {
  await ensureDatabase();
  const pattern = `%${query}%`;
  const result = await getDatabase().prepare("SELECT article_id,chapter_id,outline_id,entity_type,entity_id,title,body FROM search_documents WHERE article_id=? AND (title LIKE ? OR body LIKE ?) LIMIT 100").bind(articleId, pattern, pattern).all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function clearBusinessData() {
  await ensureDatabase();
  const db = getDatabase();
  const current = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
  const currentDatabaseVersion = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='database_version'").first<string>("value_json") ?? current);
  const pending = (await db.prepare("SELECT value_json FROM app_settings WHERE key LIKE 'business_asset_cleanup:%'").all<{ value_json: string }>()).results ?? [];
  const assetKeys = [...new Set([...(await listIllustrationAssetKeys()), ...pending.map(row => row.value_json)])].filter(key => /^illustrations\/[a-f0-9-]+$/.test(key));
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE app_settings SET value_json=CASE WHEN CAST((SELECT value_json FROM app_settings WHERE key='state_revision') AS INTEGER)=? AND CAST((SELECT value_json FROM app_settings WHERE key='database_version') AS INTEGER)=? THEN ? ELSE NULL END,updated_at=? WHERE key='state_write_guard'").bind(current, currentDatabaseVersion, crypto.randomUUID(), now),
    ...assetKeys.map(key => db.prepare("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)").bind(`business_asset_cleanup:${key}`, key, now)),
    db.prepare("DELETE FROM character_photo_jobs"),
    db.prepare("DELETE FROM articles"),
    db.prepare("DELETE FROM search_documents"),
    db.prepare("DELETE FROM sync_change_log"),
    db.prepare("DELETE FROM chat_request_claims"),
    db.prepare("DELETE FROM app_settings WHERE key LIKE 'last_outline:%'"),
    db.prepare(clearIllustrationHistoryBackupSql),
    db.prepare(clearStyleLabBackupSql),
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('state_revision',?,?)").bind(String(current + 1), now),
    db.prepare("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('database_version',?,?)").bind(String(currentDatabaseVersion + 1), now),
  ]);
  let cleanupPending = false;
  for (const key of assetKeys) {
    try {
      await deleteIllustrationAsset(key);
      await db.prepare("DELETE FROM app_settings WHERE key=?").bind(`business_asset_cleanup:${key}`).run();
    } catch {
      // Keep the cleared database authoritative, and retain a durable retry
      // receipt so a storage failure never restores the old browser snapshot.
      cleanupPending = true;
    }
  }
  return { revision: current + 1, databaseVersion: currentDatabaseVersion + 1, cleanupPending,
    ...(cleanupPending ? { message: "业务数据已清除，部分图片清理失败；请再次执行清除以重试。" } : {}) };
}

export { ensureDatabase } from "./schema-runtime";
export { getDatabase } from "./sqlite";
