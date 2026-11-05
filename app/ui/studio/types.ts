"use client";

import { type TaskParameters } from "@/lib/task-parameters";

import { type ReasoningEffort } from "@/lib/reasoning-options";

import { type ReviewRuleSnapshot } from "@/lib/review-rules.mjs";

import { type PreparationStrategy } from "@/lib/writing-preparation";

import { type ModelMetadata } from "@/lib/ai-model-capabilities";

import { type AiContextSummary, type SelectedAiContext } from "@/lib/ai-context";
import type { NamingArticleContext } from "@/db/ai-naming";

import { type AiGenerateOptions, type DialogueDensityLevel, type ProseControls, type ContentGenerationMode, type RewriteRetentionLevel } from "@/lib/generate-options";

import { type NamingProfile } from "@/lib/naming-options";
import { type NameVersion } from "@/lib/name-versions";

export type View =
  | "outline-home"
  | "write"
  | "chat"
  | "generate"
  | "illustrations"
  | "chapter"
  | "outline-edit"
  | "read"
  | "search"
  | "info-ai-tasks"
  | "info-basic"
  | "info-references"
  | "info-characters"
  | "info-relationships"
  | "settings-general"
  | "settings-appearance"
  | "settings-models"
  | "settings-prompts"
  | "settings-tasks"
  | "settings-database"
  | "settings-system";

export type IconName =
  | "menu"
  | "chevron"
  | "plus"
  | "search"
  | "read"
  | "info"
  | "settings"
  | "tasks"
  | "more"
  | "versions"
  | "focus"
  | "send"
  | "close"
  | "check"
  | "edit"
  | "spark"
  | "review"
  | "person"
  | "link"
  | "book"
  | "chat"
  | "copy"
  | "paste"
  | "save"
  | "saveAs"
  | "branch"
  | "refresh"
  | "insert"
  | "attachment"
  | "context"
  | "trash"
  | "archive"
  | "move"
  | "back"
  | "stop";

export type ServerTaskInput = {
  taskParameters?: TaskParameters;
  preparationEnabled?: boolean;
  preparationRounds?: number;
  preparationStrategy?: PreparationStrategy;
  preparationRequireConfirmation?: boolean;
  reasoningEffort?: ReasoningEffort | null;
  reviewRuleSnapshot?: ReviewRuleSnapshot;
  reviewMaxRounds?: number;
  reviewInstruction?: string;
  articleId: string;
  chapterId: string;
  outlineId: string;
  target: "content" | "outline" | "chapter-title" | "all-names";
  instruction: string;
  model: string;
  includePrevious?: boolean;
  includeCharacters?: boolean;
  includeExcellentFragments?: boolean;
  excellentFragmentIds?: string[];
  includeOutlineTitle?: boolean;
  includeClosingSummary?: boolean;
  closingSummaryLength?: import("@/lib/generate-options").ClosingSummaryLength;
  estimatedCharacters?: number;
  targetWords?: number;
  contentMode?: ContentGenerationMode;
  rewriteRetention?: RewriteRetentionLevel;
  advanced?: import("@/lib/advanced-writing").GenerateAdvanced;
  proseControls?: ProseControls;
  /** Compatibility mirror for older servers and task snapshots. */
  dialogueDensity?: DialogueDensityLevel;
  firstAppearanceCharacterIds?: string[];
  chapterNaming?: NamingProfile;
  outlineNaming?: NamingProfile;
  timeoutMs?: number;
  promptContext?: SelectedAiContext;
  currentPlan?: string;
  outlineTitleSnapshot?: string;
  /** undefined leaves the stored outline choice unchanged; null keeps article-level inheritance. */
  generateOptions?: AiGenerateOptions | null;
  namingContext?: NamingArticleContext;
};

export type ActiveChatStream = { controller: AbortController; cancel: () => void };

export type ChatStreamState = { taskId: string; sessionId: string; submissionToken: string; controller: AbortController; result: string; finalized: boolean };

export type ChatResponseStage = { taskId: string; stage: "requesting-model" | "waiting-first-token" | "recovering" };

export type ConfiguredModel = { metadata?: ModelMetadata; reasoningEffort?: ReasoningEffort | null; id: string; providerName: string; name: string; modelId: string; hasSecret: boolean; timeoutMs: number; maxInputCharacters: number };

export type GenerateContextSummary = AiContextSummary;

export type OutlineDropPlacement = "before" | "after";

export type OutlineDropIndicator = { targetId: string; placement: OutlineDropPlacement } | null;

export type ContinuousDocumentPosition = { outlineId: string; offsetTop: number };

export type ContinuousDocumentPositionMemory = { current: Record<string, ContinuousDocumentPosition> };

export type NameGeneratePreview = {
  chapterTitle?: string;
  outlineTitles: Array<{ id: string; title: string }>;
  inputCharacters: number;
  maxInputCharacters: number;
  revision?: number;
  added?: number;
  articleUpdatedAt?: string;
  chapterState?: { nameVersions: NameVersion[]; defaultNameVersionId: string | null };
  outlineStates?: Array<{ id: string; updatedAt: string; nameVersions: NameVersion[]; defaultNameVersionId: string | null }>;
};

export type GenerateTextareaHeightSlot = "outlinePlan" | "instruction";

export type GenerateTextareaHeightRecord = Record<string, Partial<Record<GenerateTextareaHeightSlot, number>>>;

export type ContinuousOutlinePanelView = "settings" | "names" | "move";

export type ManagedServiceStatus = {
  manager: { host: string; port: number };
  service: {
    managed: boolean;
    state: "running" | "starting" | "stopped" | "external" | string;
    startedAt: string | null;
    lastError: string | null;
  };
  operation: "idle" | "busy" | string;
  checkedAt: string;
};

export type ManagedServiceStatusResponse = ManagedServiceStatus & {
  ok: true;
  message?: string;
};
