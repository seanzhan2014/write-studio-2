import { deviceUiStorageKey, draftPrefix } from "@/app/studio-storage-keys";

import { now, emptyChat, makeId, firstOutline, activeExcellentFragments, activeManualExcellent } from "@/lib/studio-entities";

import type { Version, Outline, Chapter, Article, StudioData } from "@/lib/studio-types";

import { normalizeAppearance } from "@/lib/appearance.mjs";

import { DEFAULT_AI_GENERATE_OPTIONS } from "@/lib/generate-options";
import { timestampContentName } from "@/lib/content-name.mjs";
import { cloneExcellentFragments, reanchorExcellentFragments } from "@/lib/excellent-fragments.mjs";
import { resolvedOutlineContent } from "@/lib/outline-content";
import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE } from "@/lib/naming-options";

import { deleteOfflineContentDraft, type OfflineContentDraft } from "@/lib/offline-store";
import { type StudioStateIdentity } from "@/lib/state-version";

import { EMPTY_ARTICLE_STORY_SETTINGS, EMPTY_CHAPTER_SETTINGS } from "@/lib/story-settings";

import { type DeviceUiState, type StudioStatePayload } from "@/app/studio-context";

export function deviceUiFromData(data: StudioData): DeviceUiState {
  const result: DeviceUiState = {
    currentArticleId: data.currentArticleId,
    currentOutlineId: data.currentOutlineId,
    lastOutlineByArticle: {},
    activeSessionByOutline: {},
    chatDraftBySession: {},
    lastReadBySession: {},
    chatOptionsBySession: {},
    settings: {
      theme: data.settings.theme,
      accentColor: data.settings.accentColor,
      uiFont: data.settings.uiFont,
      editorFont: data.settings.editorFont,
      fontSize: data.settings.fontSize,
      lineHeight: data.settings.lineHeight,
      contentWidth: data.settings.contentWidth,
      outlineExpanded: data.settings.outlineExpanded,
      showArchived: data.settings.showArchived,
      openLastArticle: data.settings.openLastArticle,
    },
  };
  for (const article of data.articles) {
    result.lastOutlineByArticle![article.id] = article.lastOutlineId;
    for (const chapter of article.chapters) for (const outline of chapter.outlines) {
      result.activeSessionByOutline![outline.id] = outline.chat.activeSessionId;
      for (const session of outline.chat.sessions) {
        if (session.draft) result.chatDraftBySession![session.id] = session.draft;
        result.lastReadBySession![session.id] = session.lastReadMessageId ?? null;
        result.chatOptionsBySession![session.id] = { includePrevious: session.includePrevious, includeCharacters: session.includeCharacters };
      }
    }
  }
  return result;
}

export function readDeviceUi(): DeviceUiState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(deviceUiStorageKey) ?? "{}") as DeviceUiState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function deviceUiForCurrentPath(source: DeviceUiState, data: StudioData): DeviceUiState {
  const ui = structuredClone(source);
  const articleId = window.location.pathname.match(/\/articles\/([^/]+)/)?.[1];
  const outlineId = window.location.pathname.match(/\/outlines\/([^/]+)/)?.[1];
  const chapterId = window.location.pathname.match(/\/chapters\/([^/]+)/)?.[1];
  const outlineOwner = outlineId
    ? data.articles.find((article) => article.chapters.some((chapter) => chapter.outlines.some((outline) => outline.id === outlineId)))
    : undefined;
  const chapterOwner = !outlineOwner && chapterId
    ? data.articles.find((article) => article.chapters.some((chapter) => chapter.id === chapterId))
    : undefined;
  const article = outlineOwner ?? chapterOwner ?? data.articles.find((item) => item.id === articleId);
  const requestedOutlineId = outlineOwner
    ? outlineId
    : chapterOwner?.chapters.find((chapter) => chapter.id === chapterId)?.outlines[0]?.id;
  if (article) ui.currentArticleId = article.id;
  if (article && requestedOutlineId) {
    ui.currentOutlineId = requestedOutlineId;
    ui.lastOutlineByArticle = { ...(ui.lastOutlineByArticle ?? {}), [article.id]: requestedOutlineId };
  }
  return ui;
}

export function applyDeviceUi(source: StudioData, ui: DeviceUiState): StudioData {
  const data = structuredClone(source);
  if (ui.settings) {
    const settings = { ...data.settings, ...ui.settings };
    data.settings = { ...settings, ...normalizeAppearance(settings) };
  }
  for (const article of data.articles) {
    const outlineIds = new Set(article.chapters.flatMap((chapter) => chapter.outlines.map((outline) => outline.id)));
    const requested = ui.lastOutlineByArticle?.[article.id];
    article.lastOutlineId = requested && outlineIds.has(requested) ? requested : firstOutline(article);
    for (const chapter of article.chapters) for (const outline of chapter.outlines) {
      const sessionIds = new Set(outline.chat.sessions.map((session) => session.id));
      const activeSessionId = ui.activeSessionByOutline?.[outline.id];
      outline.chat.activeSessionId = activeSessionId && sessionIds.has(activeSessionId) ? activeSessionId : outline.chat.sessions[0]?.id ?? "";
      for (const session of outline.chat.sessions) {
        session.draft = ui.chatDraftBySession?.[session.id] ?? "";
        session.lastReadMessageId = Object.prototype.hasOwnProperty.call(ui.lastReadBySession ?? {}, session.id)
          ? ui.lastReadBySession?.[session.id] ?? null
          : null;
        const options = ui.chatOptionsBySession?.[session.id];
        if (options) {
          session.includePrevious = options.includePrevious;
          session.includeCharacters = options.includeCharacters;
        }
      }
    }
  }
  const requestedArticle = data.articles.find((article) => article.id === ui.currentArticleId);
  const requestedOutlineOwner = data.articles.find((article) => article.chapters.some((chapter) => chapter.outlines.some((outline) => outline.id === ui.currentOutlineId)));
  const article = requestedArticle ?? requestedOutlineOwner ?? data.articles[0];
  data.currentArticleId = article?.id ?? "";
  const articleOutlineIds = new Set(article?.chapters.flatMap((chapter) => chapter.outlines.map((outline) => outline.id)) ?? []);
  data.currentOutlineId = ui.currentOutlineId && articleOutlineIds.has(ui.currentOutlineId)
    ? ui.currentOutlineId
    : article?.lastOutlineId ?? "";
  return data;
}

export function stateIdentityFromPayload(payload: Partial<StudioStatePayload>): StudioStateIdentity | null {
  if (
    typeof payload.databaseId !== "string" || !payload.databaseId ||
    !Number.isSafeInteger(payload.schemaVersion) || Number(payload.schemaVersion) < 0 ||
    !Number.isSafeInteger(payload.databaseVersion) || Number(payload.databaseVersion) < 0 ||
    !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0
  ) return null;
  return {
    databaseId: payload.databaseId,
    schemaVersion: Number(payload.schemaVersion),
    databaseVersion: Number(payload.databaseVersion),
    revision: Number(payload.revision),
  };
}

export function recoverStoredDrafts(source: StudioData, indexedDrafts: OfflineContentDraft[] = []) {
  let loaded = source;
  const recoveredDraftKeys: string[] = [];
  const recoveredOfflineDraftIds: string[] = [];
  const candidates = new Map<string, { outlineId: string; text: string; savedAt: string; sessionKeys: string[]; storedOffline: boolean }>();
  for (const draft of indexedDrafts) candidates.set(draft.outlineId, { outlineId: draft.outlineId, text: draft.text, savedAt: draft.savedAt, sessionKeys: [], storedOffline: true });
  const storedDraftKeys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index)).filter((key): key is string => Boolean(key?.startsWith(draftPrefix)));
  for (const key of storedDraftKeys) {
    try {
      const draft = JSON.parse(window.sessionStorage.getItem(key) ?? "") as { outlineId: string; text: string; savedAt?: string };
      if (typeof draft.outlineId !== "string" || typeof draft.text !== "string") throw new Error("invalid editor draft");
      const savedAt = draft.savedAt && !Number.isNaN(new Date(draft.savedAt).getTime()) ? draft.savedAt : new Date().toISOString();
      const existing = candidates.get(draft.outlineId);
      const sessionKeys = [...(existing?.sessionKeys ?? []), key];
      candidates.set(draft.outlineId, !existing || new Date(savedAt).getTime() >= new Date(existing.savedAt).getTime()
        ? { outlineId: draft.outlineId, text: draft.text, savedAt, sessionKeys, storedOffline: existing?.storedOffline === true }
        : { ...existing, sessionKeys });
    } catch {
      window.sessionStorage.removeItem(key);
    }
  }
  for (const draft of candidates.values()) {
    let recovered = false;
    loaded = { ...loaded, articles: loaded.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((outline) => {
      if (outline.id !== draft.outlineId || outline.content === draft.text || outline.versions.some((version) => version.source === "未保存内容" && version.content === draft.text)) return outline;
      recovered = true;
      const version: Version = { id: makeId("version"), name: `未保存内容 · ${new Date(draft.savedAt).toLocaleString("zh-CN")}`, content: draft.text, source: "未保存内容", createdAt: draft.savedAt, outlineSnapshot: { title: outline.title, plan: outline.plan }, manualExcellent: activeManualExcellent(outline), excellentFragments: cloneExcellentFragments(draft.text, reanchorExcellentFragments(resolvedOutlineContent(outline), draft.text, activeExcellentFragments(outline))) };
      return { ...outline, versions: [version, ...outline.versions] };
    }) })) })) };
    if (recovered) {
      recoveredDraftKeys.push(...draft.sessionKeys);
      if (draft.storedOffline) recoveredOfflineDraftIds.push(draft.outlineId);
    } else {
      draft.sessionKeys.forEach((key) => window.sessionStorage.removeItem(key));
      if (draft.storedOffline) void deleteOfflineContentDraft(draft.outlineId);
    }
  }
  return { loaded, recoveredDraftKeys, recoveredOfflineDraftIds };
}

export const emptyChapter: Chapter = { id: "", title: "", archived: false, settings: EMPTY_CHAPTER_SETTINGS, outlines: [] };

export const emptyOutline: Outline = { id: "", title: "", titleGenerationPending: false, plan: "", generateInstruction: "", generateOptions: null, content: "", contentName: timestampContentName(now), currentVersionId: null, defaultVersionId: null, contentOutlineSnapshot: { title: "", plan: "" }, archived: false, state: "saved", updatedAt: now, excellentFragments: [], versions: [], chat: emptyChat("empty") };

export const emptyArticle: Article = { id: "", title: "", summary: "", type: "", style: "", storySettings: EMPTY_ARTICLE_STORY_SETTINGS, chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE, outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE, aiGenerateSettings: DEFAULT_AI_GENERATE_OPTIONS, createdAt: now, updatedAt: now, lastOutlineId: "", chapters: [], characters: [], relationships: [] };
