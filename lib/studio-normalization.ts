import { normalizeOutlineExpansion } from "./outline-expansion.ts";
import { normalizeChatMode } from "./chat-modes.ts";
import type { Message, Character, Article, AiTask, StudioSettings, StudioData } from "./studio-types.ts";

import { normalizeIllustrationOptions } from "./illustration-options.ts";

import { normalizeCharacterPhotos } from "./character-photos.ts";
import { normalizeCharacterVisual } from "./character-visual.ts";

import { parseTaskHistory } from "./task-history.ts";
import { taskChangesOutline } from "./task-target.ts";

import { DEFAULT_AI_GENERATE_OPTIONS, normalizeAiGenerateOptions, normalizeContentGenerationMode, normalizeProseControls, normalizeRewriteRetentionLevel } from "./generate-options.ts";
import { timestampContentName } from "./content-name.mjs";
import { normalizeExcellentFragments } from "./excellent-fragments.mjs";

import { normalizeOutlineTitle } from "./outline-title.ts";
import { articleReviewRules } from "./review-rules.mjs";

import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile } from "./naming-options.ts";

import { normalizeNameVersionState } from "./name-versions.ts";

import { durableStudioData, stableStudioStringify } from "../app/studio-conflict.mjs";

import { migrateArticleStoryDetails, migrateCharacterDetails, normalizeArticleStorySettings, normalizeChapterSettings } from "./story-settings.ts";
import { normalizeReviewRules } from "./generate-review.mjs";

import { emptyChat, makeId } from "./studio-entities.ts";
import { normalizeStudioSettings } from "./studio-settings.ts";

export function durableSnapshot(data: StudioData) {
  // Locally created records can still omit fields that hydration and SQLite
  // synthesize (notably nameVersions). Canonicalize every side of the save/merge
  // boundary so those defaults cannot look like local deletions during AI sync.
  return durableStudioData(normalizeStudioData(data));
}

export function serializeDurable(data: StudioData) {
  return stableStudioStringify(durableSnapshot(data));
}

export function normalizedArticleSummary(article: Article) {
  return migrateArticleStoryDetails(article.summary, article.type, article.storySettings).summary;
}

export function normalizeCharacter(source: unknown): Character {
  const item = source as Partial<Character> & Record<string, unknown>;
  const rawProfile = item.profile && typeof item.profile === "object" && !Array.isArray(item.profile) ? item.profile as Record<string, unknown> : {};
  const migrated = migrateCharacterDetails(item.description, {
    ...rawProfile,
    age: rawProfile.age ?? item.age,
    appearance: rawProfile.appearance ?? item.appearance,
    identity: rawProfile.identity ?? item.role,
    personality: rawProfile.personality ?? item.personality,
    speechStyle: rawProfile.speechStyle ?? item.speechStyle,
    abilities: rawProfile.abilities ?? item.abilities,
    mentalState: rawProfile.mentalState ?? item.mentalState,
    knownInformation: rawProfile.knownInformation ?? item.knownInformation,
    boundaries: rawProfile.boundaries ?? item.boundaries,
    immutableTraits: rawProfile.immutableTraits ?? item.immutableTraits,
  });
  const legacyBackground = String(item.background ?? "").trim();
  const description = legacyBackground && !migrated.description.includes(legacyBackground)
    ? [migrated.description, `背景：${legacyBackground}`].filter(Boolean).join("\n")
    : migrated.description;
  return {
    id: String(item.id ?? makeId("character")),
    name: String(item.name ?? ""),
    aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
    description,
    profile: migrated.profile,
    ...(normalizeCharacterPhotos(item.photos) ? { photos: normalizeCharacterPhotos(item.photos) } : {}),
    ...(normalizeCharacterVisual(item.visual) ? { visual: normalizeCharacterVisual(item.visual) } : {}),
    archived: Boolean(item.archived),
  };
}

export function normalizeAiTask(task: AiTask): AiTask {
  const phase = task.phase ?? (task.state === "waiting" ? "queued" : task.state === "success" ? "completed" : task.state === "failed" ? "failed" : task.state === "cancelled" ? "cancelled" : "generating");
  const contentMode = task.target === "正文" ? normalizeContentGenerationMode(task.contextOptions?.contentMode) : undefined;
  const proseControls = task.target === "正文" ? normalizeProseControls(task.contextOptions?.proseControls, task.contextOptions?.dialogueDensity) : undefined;
  return {
    ...task,
    history: parseTaskHistory(task.history),
    executionOrigin: task.executionOrigin === "cloud" ? "cloud" : "local",
    contextOptions: task.contextOptions ? {
      ...task.contextOptions,
      ...(task.target === "正文" ? { contentMode, proseControls, dialogueDensity: proseControls!.dialogueDensity, rewriteRetention: contentMode === "rewrite" ? normalizeRewriteRetentionLevel(task.contextOptions.rewriteRetention) : undefined } : {}),
      firstAppearanceCharacterIds: Array.isArray(task.contextOptions.firstAppearanceCharacterIds)
        ? [...new Set(task.contextOptions.firstAppearanceCharacterIds.map(String))].slice(0, 200)
        : undefined,
      includeExcellentFragments: task.contextOptions.includeExcellentFragments === true,
      excellentFragmentIds: Array.isArray(task.contextOptions.excellentFragmentIds)
        ? [...new Set(task.contextOptions.excellentFragmentIds.map(String))].slice(0, 200)
        : undefined,
    } : task.contextOptions,
    phase,
    attempt: Math.max(0, Number(task.attempt ?? 0)),
    receivedCharacters: Math.max(0, Number(task.receivedCharacters ?? task.resultText?.length ?? 0)),
  };
}

export function reconcileTaskPoll(current: StudioData, tasks: AiTask[], runningOutlineIds: string[]) {
  const running = new Set(runningOutlineIds);
  const terminalByOutline = new Map<string, AiTask["state"]>();
  for (const task of tasks) {
    if (!taskChangesOutline(task.target) || task.state === "waiting" || task.state === "running" || terminalByOutline.has(task.outlineId)) continue;
    terminalByOutline.set(task.outlineId, task.state);
  }
  return {
    ...current,
    tasks,
    articles: current.articles.map((article) => ({
      ...article,
      chapters: article.chapters.map((chapter) => ({
        ...chapter,
        outlines: chapter.outlines.map((outline) => {
          if (running.has(outline.id)) return outline.state === "running" ? outline : { ...outline, state: "running" as const };
          if (outline.state !== "running") return outline;
          return { ...outline, state: terminalByOutline.get(outline.id) === "failed" ? "failed" as const : "saved" as const };
        }),
      })),
    })),
  };
}

export function emptyStudioData(settings: StudioSettings): StudioData {
  return { version: 1, currentArticleId: "", currentOutlineId: "", articles: [], tasks: [], settings };
}

export function normalizeStudioData(source: StudioData): StudioData {
  const legacyGenerateSettings = normalizeAiGenerateOptions({
    model: source.settings?.generateModel,
    reasoningEffort: source.settings?.generateReasoningEffort,
    targetWords: source.settings?.generateTargetWords,
    reviewMaxRounds: source.settings?.generateReviewMaxRounds,
  });
  return {
    ...source,
    tasks: (source.tasks ?? []).map(normalizeAiTask),
    settings: normalizeStudioSettings(source.settings),
    articles: source.articles.map((article) => {
      const hasArticleGenerateSettings = Boolean(article.aiGenerateSettings && typeof article.aiGenerateSettings === "object" && Object.keys(article.aiGenerateSettings).length);
      const aiGenerateSettings = normalizeAiGenerateOptions(article.aiGenerateSettings, hasArticleGenerateSettings ? DEFAULT_AI_GENERATE_OPTIONS : legacyGenerateSettings);
      return {
      ...article,
      summary: normalizedArticleSummary(article),
      type: "",
      storySettings: normalizeArticleStorySettings(article.storySettings),
      reviewRules: normalizeReviewRules(article.reviewRules),
      reviewRuleItems: articleReviewRules(article),
      chapterNaming: normalizeNamingProfile(article.chapterNaming, DEFAULT_CHAPTER_NAMING_PROFILE),
      outlineNaming: normalizeNamingProfile(article.outlineNaming, DEFAULT_OUTLINE_NAMING_PROFILE),
      aiGenerateSettings,
      illustrationSettings: normalizeIllustrationOptions(article.illustrationSettings),
      characters: (article.characters ?? []).map(normalizeCharacter),
      chapters: article.chapters.map((chapter) => {
        const chapterNameState = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
        return {
        ...chapter,
        ...chapterNameState,
        settings: normalizeChapterSettings(chapter.settings),
        outlines: chapter.outlines.map((item) => {
          const normalizedTitle = normalizeOutlineTitle(item.title);
          const outlineNameState = normalizeNameVersionState(item.id, normalizedTitle, item.nameVersions, item.defaultNameVersionId, item.updatedAt, 80);
          const versions = (item.versions ?? []).map((version) => ({ ...version, manualExcellent: version.manualExcellent === true, excellentFragments: normalizeExcellentFragments(version.content, version.excellentFragments) }));
          const validVersionId = (value: unknown) => typeof value === "string" && versions.some((version) => version.id === value) ? value : null;
          const legacyDefaultVersionId = validVersionId(item.sourceVersionId);
          const defaultVersionId = Object.prototype.hasOwnProperty.call(item, "defaultVersionId")
            ? validVersionId(item.defaultVersionId)
            : legacyDefaultVersionId;
          const currentVersionId = Object.prototype.hasOwnProperty.call(item, "currentVersionId")
            ? validVersionId(item.currentVersionId)
            : item.contentOverride === false
              ? legacyDefaultVersionId
              : null;
          const legacySourceSnapshot = item.contentOverride === true && legacyDefaultVersionId
            ? versions.find((version) => version.id === legacyDefaultVersionId)?.outlineSnapshot
            : undefined;
          const currentItem = { ...item };
          Reflect.deleteProperty(currentItem, "contentOverride");
          Reflect.deleteProperty(currentItem, "sourceVersionId");
          const normalizedItem = {
            ...currentItem,
            ...outlineNameState,
            title: normalizedTitle,
            generateInstruction: String(item.generateInstruction ?? "").slice(0, 20000),
            illustrationOptions: item.illustrationOptions == null ? null : normalizeIllustrationOptions(item.illustrationOptions, normalizeIllustrationOptions(article.illustrationSettings)),
            generateOptions: item.generateOptions == null ? null : normalizeAiGenerateOptions(item.generateOptions, DEFAULT_AI_GENERATE_OPTIONS),
            ...(item.expansion ? { expansion: normalizeOutlineExpansion(item.plan, item.expansion) } : {}),
            settings: normalizeChapterSettings(item.settings),
            contentName: item.contentName?.trim() || timestampContentName(item.updatedAt),
            currentVersionId,
            defaultVersionId,
            contentOutlineSnapshot: item.contentOutlineSnapshot ?? legacySourceSnapshot ?? { title: normalizedTitle, plan: item.plan },
            manualExcellent: item.manualExcellent === true,
            titleGenerationPending: item.titleGenerationPending ?? !normalizedTitle,
            excellentFragments: normalizeExcellentFragments(item.content, item.excellentFragments),
            versions,
          };
          const legacy = item.chat as typeof item.chat & { messages?: Message[]; draft?: string; includePrevious?: boolean; includeCharacters?: boolean };
          if (Array.isArray(legacy.sessions) && legacy.sessions.length) {
            const sessions = legacy.sessions.map((session) => ({
              ...session,
              mode: normalizeChatMode(session.mode),
              lastReadMessageId: Object.prototype.hasOwnProperty.call(session, "lastReadMessageId")
                ? session.lastReadMessageId ?? null
                : session.messages.filter((message) => message.role === "assistant").at(-1)?.id ?? null,
            }));
            const activeSessionId = sessions.some((session) => session.id === legacy.activeSessionId) ? legacy.activeSessionId : sessions[0].id;
            return { ...normalizedItem, chat: { sessions, activeSessionId } };
          }
          const chat = emptyChat(item.id, legacy.messages ?? []);
          chat.sessions[0] = { ...chat.sessions[0], draft: legacy.draft ?? "", includePrevious: legacy.includePrevious !== false, includeCharacters: legacy.includeCharacters !== false };
          return { ...normalizedItem, chat };
        }),
      };
      }),
    };
    }),
  };
}
