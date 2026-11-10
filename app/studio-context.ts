import type { Message, Version, Outline, Chapter, Character, Relationship, Article, TaskExecutionOrigin, AiTask, StudioSettings, StudioData } from "@/lib/studio-types";

import { type AppearanceSettings } from "@/lib/appearance.mjs";

import { type StudioStateIdentity } from "@/lib/state-version";
import { type StudioConflictDetail } from "@/app/studio-conflict.mjs";
import { type ArticleCopyOptions } from "@/lib/data-transfer";

export type OutlinePlacement = "before" | "after";

export type NameEntityKind = "chapter" | "outline";

export type StudioContextValue = {
  data: StudioData;
  executionOrigin: TaskExecutionOrigin;
  hydrated: boolean;
  saveStatus: "loading" | "saved" | "local" | "unsaved" | "saving" | "failed" | "conflict";
  saveError: string;
  conflict: { base: StudioData; local: StudioData; server: StudioData; serverRevision: number; details: StudioConflictDetail[] } | null;
  currentArticle: Article;
  currentChapter: Chapter;
  currentOutline: Outline;
  setCurrentArticle: (articleId: string) => void;
  setCurrentOutline: (outlineId: string) => void;
  createArticle: (fields: Pick<Article, "title" | "summary" | "type" | "style">) => string;
  duplicateArticle: (articleId: string, options: ArticleCopyOptions) => { articleId: string; outlineId: string } | null;
  updateArticle: (patch: Partial<Pick<Article, "title" | "summary" | "type" | "style" | "storySettings" | "reviewRules" | "reviewRuleItems" | "chapterNaming" | "outlineNaming" | "aiGenerateSettings" | "illustrationSettings">>) => void;
  deleteArticle: (articleId: string) => void;
  createChapter: (title?: string) => string;
  updateChapter: (chapterId: string, patch: Partial<Pick<Chapter, "title" | "archived" | "settings">>) => void;
  applyGeneratedNames: (chapterId: string, chapterTitle: string | undefined, outlineTitles: Array<{ id: string; title: string }>) => void;
  addGeneratedNameCandidates: (chapterId: string, chapterTitle: string | undefined, outlineTitles: Array<{ id: string; title: string }>, metadata?: { model?: string; instruction?: string }) => number;
  addManualNameVersion: (kind: NameEntityKind, entityId: string, title: string, makeDefault?: boolean) => string | null;
  setDefaultNameVersion: (kind: NameEntityKind, entityId: string, versionId: string) => void;
  deleteNameVersion: (kind: NameEntityKind, entityId: string, versionId: string) => boolean;
  moveChapter: (chapterId: string, direction: -1 | 1) => void;
  deleteChapter: (chapterId: string) => void;
  createOutline: (chapterId?: string, afterId?: string) => string;
  updateOutline: (outlineId: string, patch: Partial<Pick<Outline, "title" | "titleGenerationPending" | "plan" | "expansion" | "generateInstruction" | "generateOptions" | "illustrationOptions" | "settings" | "content" | "contentName" | "currentVersionId" | "defaultVersionId" | "contentOutlineSnapshot" | "archived" | "state">>) => void;
  saveOutlinePlan: (outlineId: string, plan: string, expansion?: import("@/lib/outline-expansion").OutlineExpansion) => Promise<boolean>;
  stageContentDraft: (outlineId: string, text: string) => void;
  clearContentDraft: (outlineId: string) => void;
  createBlankContent: (outlineId: string) => Promise<boolean>;
  saveCurrentContent: (outlineId: string, text: string, sourceVersionId?: string) => Promise<boolean>;
  commitContentEdit: (outlineId: string, text: string) => Promise<boolean>;
  preserveContentDraft: (outlineId: string, text: string, savedAt?: string) => Promise<boolean>;
  moveOutline: (sourceId: string, targetId: string, placement: OutlinePlacement) => void;
  moveOutlineToChapter: (outlineId: string, chapterId: string) => void;
  copyOutline: (outlineId: string) => string | null;
  importOutline: (chapterId: string, outline: Outline, afterId?: string) => string | null;
  importArticles: (articles: Article[], tasks?: AiTask[]) => string[];
  importSettings: (settings: StudioSettings) => void;
  deleteOutline: (outlineId: string) => void;
  saveVersion: (outlineId: string, name?: string, source?: Version["source"], content?: string, metadata?: Pick<Version, "model" | "modelId" | "prompt" | "taskId" | "outlineSnapshot" | "settingSnapshot" | "manualExcellent" | "excellentFragments">) => string;
  toggleExcellentFragment: (outlineId: string, versionId: string | undefined, start: number, end: number) => "added" | "removed" | "none";
  setBodyExcellent: (outlineId: string, versionId: string | undefined, excellent: boolean) => void;
  setCurrentVersion: (outlineId: string, versionId?: string) => void;
  setDefaultVersion: (outlineId: string, versionId?: string) => void;
  applyVersion: (outlineId: string, versionId: string) => void;
  applyVersionWithBackup: (outlineId: string, versionId: string) => string | null;
  renameVersion: (outlineId: string, versionId: string, name: string) => void;
  deleteVersion: (outlineId: string, versionId: string | null) => void;
  createChatSession: (outlineId: string, title?: string, messages?: Message[]) => string;
  setActiveChatSession: (outlineId: string, sessionId: string) => void;
  renameChatSession: (outlineId: string, sessionId: string, title: string) => void;
  deleteChatSession: (outlineId: string, sessionId: string) => void;
  branchChatSession: (outlineId: string, messageId: string) => string | null;
  setChatDraft: (outlineId: string, draft: string, sessionId?: string) => void;
  setChatSetting: (outlineId: string, key: "includePrevious" | "includeCharacters", value: boolean) => void;
  addChatMessage: (outlineId: string, message: Message, sessionId?: string) => void;
  replaceChatMessages: (outlineId: string, messages: Message[], sessionId?: string) => void;
  markChatSessionRead: (outlineId: string, sessionId: string) => void;
  clearChat: (outlineId: string) => void;
  addTask: (task: Omit<AiTask, "id" | "createdAt" | "state"> & { id?: string; createdAt?: string; state?: AiTask["state"] }) => string | null;
  updateTask: (taskId: string, patch: Partial<AiTask>) => void;
  removeTask: (taskId: string) => void;
  clearCompletedTasks: () => void;
  updateSettings: (patch: Partial<StudioSettings>) => void;
  addCharacter: (character: Omit<Character, "id">) => string;
  updateCharacter: (characterId: string, patch: Partial<Character>) => void;
  deleteCharacter: (characterId: string) => void;
  addRelationship: (relationship: Omit<Relationship, "id">) => string;
  updateRelationship: (relationshipId: string, patch: Partial<Relationship>) => void;
  deleteRelationship: (relationshipId: string) => void;
  clearBusinessData: () => Promise<boolean>;
  acceptServerMutation: (revision: number, update: (current: StudioData) => StudioData, coverage?: "complete" | "partial") => void;
  refreshFromServer: () => Promise<boolean>;
  saveNow: () => Promise<boolean>;
  retrySave: () => Promise<boolean>;
  resolveConflict: (choice: "keep-local" | "use-server") => Promise<void>;
};

export type DeviceUiState = {
  currentArticleId?: string;
  currentOutlineId?: string;
  lastOutlineByArticle?: Record<string, string>;
  activeSessionByOutline?: Record<string, string>;
  chatDraftBySession?: Record<string, string>;
  lastReadBySession?: Record<string, string | null>;
  chatOptionsBySession?: Record<string, { includePrevious: boolean; includeCharacters: boolean }>;
  settings?: AppearanceSettings & Pick<StudioSettings, "outlineExpanded" | "showArchived" | "openLastArticle">;
};

export type StudioStatePayload = StudioStateIdentity & {
  data: StudioData | null;
  executionOrigin?: TaskExecutionOrigin;
};
