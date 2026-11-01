import type { GenerateAdvanced } from "./advanced-writing.ts";
import { type IllustrationOptions } from "./illustration-options.ts";
import { type IllustrationStyle } from "./illustration-styles.ts";

import { type AppearanceSettings } from "./appearance.mjs";

import type { ReasoningEffort } from "./reasoning-options.ts";

import { type AiGenerateOptions, type DialogueDensityLevel, type ProseControls, type ContentGenerationMode, type RewriteRetentionLevel } from "./generate-options.ts";

import { type ExcellentFragment } from "./excellent-fragments.mjs";

import { type ReviewRule, type ReviewRuleSnapshot } from "./review-rules.mjs";

import { type NamingProfile } from "./naming-options.ts";
import type { SelectedAiContext } from "./ai-context.ts";
import type { NamingArticleContext } from "@/db/ai-naming";
import { type NameVersion } from "./name-versions.ts";

import { type ArticleStorySettings, type CharacterProfile, type ChapterSettings, type OutlineSettings, type ResolvedChapterSettings } from "./story-settings.ts";
import { type GenerateReviewReport } from "./generate-review.mjs";

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  stopped?: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  draft: string;
  includePrevious: boolean;
  includeCharacters: boolean;
  lastReadMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Version = {
  id: string;
  name: string;
  content: string;
  source: "手动" | "AI Generate" | "AI Chat" | "AI Review" | "未保存内容";
  createdAt: string;
  /** Most recent selection as current body, retained across saves and reloads. */
  lastSelectedAt?: string;
  model?: string;
  modelId?: string;
  prompt?: string;
  taskId?: string;
  /** Direct link to the body that an AI rewrite used as its source. */
  rewriteSourceId?: string;
  /** Source body name as shown when the rewrite was submitted. */
  rewriteSourceName?: string;
  reviewReport?: GenerateReviewReport;
  reviewRuleSnapshot?: ReviewRuleSnapshot;
  outlineSnapshot?: {
    title: string;
    plan: string;
  };
  settingSnapshot?: ResolvedChapterSettings;
  manualExcellent?: boolean;
  excellentFragments?: ExcellentFragment[];
};

export type Outline = {
  id: string;
  title: string;
  titleGenerationPending: boolean;
  plan: string;
  generateInstruction: string;
  generateOptions: AiGenerateOptions | null;
  illustrationOptions?: IllustrationOptions | null;
  settings?: OutlineSettings;
  content: string;
  contentName?: string;
  currentVersionId: string | null;
  defaultVersionId: string | null;
  contentOutlineSnapshot?: {
    title: string;
    plan: string;
  };
  /** Legacy import-only fields. */
  contentOverride?: boolean;
  archived: boolean;
  state: "saved" | "running" | "failed";
  updatedAt: string;
  nameVersions?: NameVersion[];
  defaultNameVersionId?: string | null;
  sourceVersionId?: string;
  manualExcellent?: boolean;
  excellentFragments?: ExcellentFragment[];
  versions: Version[];
  chat: {
    sessions: ChatSession[];
    activeSessionId: string;
  };
};

export type Chapter = {
  id: string;
  title: string;
  nameVersions?: NameVersion[];
  defaultNameVersionId?: string | null;
  archived: boolean;
  settings?: ChapterSettings;
  outlines: Outline[];
};

export type Character = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  profile?: CharacterProfile;
  archived: boolean;
  photos?: import("./character-photos").CharacterPhotoGallery;
  visual?: import("./character-visual").CharacterVisual;
};

export type Relationship = {
  id: string;
  characterAId: string;
  characterBId: string;
  description: string;
};

export type Article = {
  id: string;
  title: string;
  summary: string;
  type: string;
  style: string;
  storySettings?: ArticleStorySettings;
  reviewRules?: string;
  reviewRuleItems?: ReviewRule[];
  chapterNaming: NamingProfile;
  outlineNaming: NamingProfile;
  aiGenerateSettings: AiGenerateOptions;
  illustrationSettings?: IllustrationOptions;
  createdAt: string;
  updatedAt: string;
  lastOutlineId: string;
  chapters: Chapter[];
  characters: Character[];
  relationships: Relationship[];
};

export type TaskExecutionOrigin = "local" | "cloud";

export type AiTask = {
  id: string;
  articleId: string;
  chapterId: string;
  outlineId: string;
  target: import("./task-target").TaskTargetLabel;
  prompt: string;
  model: string;
  executionOrigin: TaskExecutionOrigin;
  state: "waiting" | "running" | "success" | "failed" | "cancelled";
  phase?: import("./task-history").TaskPhase;
  history?: import("./task-history").TaskHistoryEntry[];
  attempt?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastProgressAt?: string;
  receivedCharacters?: number;
  timeoutMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  runnerId?: string;
  leaseUntil?: string;
  resultVersionId?: string;
  resultText?: string;
  error?: string;
  contextOptions?: {
    illustrationId?: string;
    illustrationKind?: "prompt" | "image";
    illustrationInput?: import("@/db/illustrations").IllustrationInput;
    writingPreparation?: import("./writing-preparation").WritingPreparation;
    taskConcurrency?: number;
    reasoningEffort?: ReasoningEffort | null;
    resolvedReasoningEffort?: ReasoningEffort | null;
    includePrevious: boolean;
    includeCharacters: boolean;
    estimatedCharacters: number;
    targetWords?: number;
    contentMode?: ContentGenerationMode;
    rewriteRetention?: RewriteRetentionLevel;
    advanced?: GenerateAdvanced;
    proseControls?: ProseControls;
    /** @deprecated Legacy task snapshot; use proseControls.dialogueDensity. */
    dialogueDensity?: DialogueDensityLevel;
    reviewMaxRounds?: number;
    reviewStrategy?: import("./generate-review.mjs").ReviewStrategy;
    reviewConfiguredModelId?: string;
    reviewModelId?: string;
    reviewModelName?: string;
    reviewResolvedReasoningEffort?: ReasoningEffort | null;
    reviewRules?: string;
    reviewRuleSnapshot?: ReviewRuleSnapshot;
    reviewInstruction?: string;
    reviewRound?: number;
    reviewReport?: GenerateReviewReport;
    reviewSourceContent?: string;
    reviewSourceVersionId?: string | null;
    reviewCandidateOnly?: boolean;
    rewriteSourceId?: string;
    rewriteSourceName?: string;
    outlinePlanSnapshot?: string;
    outlineTitleSnapshot?: string;
    configuredModelId?: string;
    modelId?: string;
    modelName?: string;
    generatedOutlineTitle?: string;
    generatedOutlineTitleError?: string;
    includeOutlineTitle?: boolean;
    includeClosingSummary?: boolean;
    closingSummaryLength?: import("./generate-options").ClosingSummaryLength;
    chapterNamingSnapshot?: NamingProfile;
    outlineNamingSnapshot?: NamingProfile;
    nameChapterCount?: number;
    nameOutlineCount?: number;
    generatedNameCount?: number;
    sessionId?: string;
    serverManaged?: boolean;
    firstAppearanceCharacterIds?: string[];
    includeExcellentFragments?: boolean;
    excellentFragmentIds?: string[];
    promptContext?: SelectedAiContext;
    namingContext?: NamingArticleContext;
  };
};

export type StudioSettings = AppearanceSettings & {
  styleLearningSettings?: import("./style-learning-settings").StyleLearningSettings;
  aiGenerateSettings?: AiGenerateOptions;
  illustrationSettings?: IllustrationOptions;
  reviewRuleItems?: ReviewRule[];
  outlineExpanded: boolean;
  showArchived: boolean;
  openLastArticle: boolean;
  taskConcurrency: number;
  preparationMaxRounds?: number;
  preparationStrategy?: import("./writing-preparation").PreparationStrategy;
  preparationRequireConfirmation?: boolean;
  chatModel: string;
  generateModel: string;
  illustrationPromptModel?: string;
  illustrationImageModel?: string;
  illustrationStyles?: IllustrationStyle[];
  generateReasoningEffort?: ReasoningEffort | null;
  chatReasoningEffort?: ReasoningEffort | null;
  namingReasoningEffort?: ReasoningEffort | null;
  reviewReasoningEffort?: ReasoningEffort | null;
  namingModelMode: "inherit" | "fixed";
  namingModel: string;
  reviewModel: string;
  generateReviewMaxRounds?: number;
  generateReviewStrategy?: import("./generate-review.mjs").ReviewStrategy;
  generateReviewInstruction?: string;
  reviewModelMode?: "inherit" | "fixed";
  generateTargetWords: number;
  generatePresets: string[];
  reviewPresets: string[];
};

export type StudioData = {
  version: 1;
  currentArticleId: string;
  currentOutlineId: string;
  articles: Article[];
  tasks: AiTask[];
  settings: StudioSettings;
};
export type { ExcellentFragment };
