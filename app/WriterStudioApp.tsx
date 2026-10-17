"use client";

import { CharacterAvatar } from "./ui/character-visual";
import { CharacterPhotoWorkspace, CharacterPhotoRuntime, CharacterPhotoTasks } from "./ui/character-photos";
import type { CharacterVisual } from "@/lib/character-visual";
import { ArticleIllustrationSettings } from "./ui/article-illustration-settings";
import { AiPromptSettings } from "./ui/ai-prompt-settings";
import { STANDALONE_AI_REVIEW_ENABLED } from "@/lib/features.mjs";
import { ReasoningSettings } from "@/app/ui/reasoning-settings";
import { normalizeReasoningEffort, resolveReasoningEffort, type ReasoningEffort } from "@/lib/reasoning-options";

import { MAX_REVIEW_ROUNDS, MAX_REVIEW_RULE_CHARACTERS, normalizeReviewRounds, normalizeReviewRules, normalizeReviewStrategy, REVIEW_STRATEGY_LABELS } from "@/lib/generate-review.mjs";
import { ArticleReviewRulesPage, ReviewRuleSnapshotView } from "@/app/ui/review-rules";
import { createReviewRuleSnapshot, hasReviewRules, type ReviewRuleSnapshot } from "@/lib/review-rules.mjs";
import { GenerateReviewReportView } from "@/app/ui/generate-review-report";
import { TaskHistory } from "@/app/ui/task-history";
import { TaskInteraction, OutlineTaskIndicator } from "@/app/ui/task-interaction";
import { isTaskAwaitingAuthor, normalizePreparationRounds, normalizePreparationStrategy, PREPARATION_STRATEGY_LABELS, MAX_PREPARATION_ROUNDS, type PreparationStrategy } from "@/lib/writing-preparation";
import { StudioThemeProvider } from "@/app/ui/studio-theme";
import { AppearancePanel } from "@/app/ui/appearance-settings";
import { AiServices } from "@/app/ui/ai-services";
import { supportsText, type ModelMetadata } from "@/lib/ai-model-capabilities";
import { IllustrationGenerator } from "@/app/ui/illustration-generator";
import { IllustrationTaskResult } from "@/app/ui/illustration-task-result";
import { taskPhaseLabels } from "@/lib/task-history";
import { isIllustrationTarget, taskChangesOutline } from "@/lib/task-target";

import { sendChatCompletion } from "@/lib/chat-client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Menu,
  MultiSelect,
  NumberInput,
  PasswordInput,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  Textarea,
  TextInput,
  useMantineColorScheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import getCaretCoordinates from "textarea-caret";
import { detectFirstAppearanceCharacters, selectAiContext, summarizeAiContext, type AiContextSummary, type FirstAppearanceSuggestion, type SelectedAiContext } from "@/lib/ai-context";
import type { NamingArticleContext } from "@/db/ai";
import { resolvedOutlineContentName, timestampContentName } from "@/lib/content-name.mjs";
import { normalizeExcellentFragments } from "@/lib/excellent-fragments.mjs";
import { DEFAULT_AI_GENERATE_OPTIONS, DESCRIPTION_DETAIL_OPTIONS, DIALOGUE_DENSITY_OPTIONS, INTROSPECTION_DENSITY_OPTIONS, NARRATIVE_PACE_OPTIONS, PARAGRAPH_LENGTH_OPTIONS, descriptionDetailLabel, dialogueDensityLabel, hasActiveProseControls, introspectionDensityLabel, narrativePaceLabel, paragraphLengthLabel, normalizeAiGenerateOptions, normalizeProseControls, type AiGenerateOptions, type DialogueDensityLevel, type ProseControls, DEFAULT_REWRITE_RETENTION_LEVEL, MAX_GENERATE_PRESETS, MAX_GENERATE_PRESET_CHARACTERS, MAX_GENERATE_TARGET_WORDS, MIN_GENERATE_TARGET_WORDS, normalizeGeneratePresets, normalizeRewriteRetentionLevel, type ContentGenerationMode, type RewriteRetentionLevel } from "@/lib/generate-options";
import { currentOutlineVersion, resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";
import { DEFAULT_MAX_INPUT_CHARACTERS, MAX_MAX_INPUT_CHARACTERS, MIN_MAX_INPUT_CHARACTERS } from "@/lib/model-options";
import { modelSelectionLabel } from "@/lib/model-label";
import { CIPAI_OPTIONS, DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, NAMING_EXPRESSION_OPTIONS, NAMING_FORMAT_OPTIONS, NAMING_STYLE_OPTIONS, normalizeNamingProfile, type NamingProfile } from "@/lib/naming-options";
import { normalizeNameVersionState, type NameVersion } from "@/lib/name-versions";
import { DEFAULT_ARTICLE_COPY_OPTIONS, suggestArticleCopyTitle, type ArticleCopyOptions } from "@/lib/data-transfer";
import { browserIsOffline, fetchFromServer, fetchServerAction, OFFLINE_OPERATION_MESSAGE } from "@/lib/browser-network";
import { StudioProvider, chatSessionHasUnread, formatTime, useStudio, wordCount, type AiTask, type Message, type Article, type Character, type Chapter, type ExcellentFragment, type Outline, type Version } from "./studio-state";
import { DataTransferProvider, useDataTransfer } from "./data-transfer";
import { MobileActionSheet, ResponsiveModal, ScrollableDrawer, type ActionSheetItem } from "./ui/overlays";
import { ArticleSettingsInline, ArticleStoryFields, ChapterSettingsDrawer, OutlineSettingsDrawer, ScopedSettingsInline, CHARACTER_LABELS } from "./ui/story-settings-editor";
import { CHARACTER_PROFILE_KEYS, countChapterSettingChanges, countOutlineSettingChanges, normalizeCharacterProfile, resolveChapterSettings, resolveOutlineSettings, type ResolvedChapterSettings } from "@/lib/story-settings";

type View =
  | "outline-home"
  | "write"
  | "chat"
  | "generate"
  | "chapter"
  | "outline-edit"
  | "read"
  | "search"
  | "info-ai-tasks"
  | "info-basic"
  | "info-characters"
  | "info-relationships"
  | "settings-general"
  | "settings-appearance"
  | "settings-models"
  | "settings-prompts"
  | "settings-tasks"
  | "settings-database"
  | "settings-system";

type IconName =
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

const iconPaths: Record<Exclude<IconName, "stop">, string[]> = {
  menu: ["M4 4.5h16v15H4z", "M9 4.5v15"],
  chevron: ["m7 9 5 5 5-5"],
  plus: ["M12 5v14", "M5 12h14"],
  search: ["m21 21-4.35-4.35", "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"],
  read: ["M6 3h9l3 3v15H6z", "M15 3v4h4", "M9 11h6", "M9 15h6"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 10v6", "M12 7h.01"],
  settings: ["M4 7h10", "M18 7h2", "M4 17h2", "M10 17h10", "M14 4v6", "M6 14v6"],
  tasks: ["M12 22a9 9 0 1 0-9-9", "M3 4v5h5", "M12 7v5l3 2"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  versions: ["m12 2 9 5-9 5-9-5 9-5Z", "m3 12 9 5 9-5", "m3 17 9 5 9-5"],
  focus: ["M8 3H3v5", "M16 3h5v5", "M8 21H3v-5", "M16 21h5v-5"],
  send: ["M12 19V5", "m5 12 7-7 7 7"],
  close: ["m6 6 12 12", "M18 6 6 18"],
  check: ["m5 12 4 4L19 6"],
  edit: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"],
  spark: ["m12 3-1.35 3.65L7 8l3.65 1.35L12 13l1.35-3.65L17 8l-3.65-1.35Z", "m19 14-.75 2.25L16 17l2.25.75L19 20l.75-2.25L22 17l-2.25-.75Z"],
  review: ["M5 3h11l3 3v15H5z", "M16 3v4h4", "M8 11h8", "M8 15h5", "m15.5 16.5.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8Z"],
  person: ["M20 21a8 8 0 0 0-16 0", "M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"],
  link: ["M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1", "M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"],
  book: ["M3 5.5A2.5 2.5 0 0 1 5.5 3H11v17H5.5A2.5 2.5 0 0 0 3 22Z", "M21 5.5A2.5 2.5 0 0 0 18.5 3H13v17h5.5A2.5 2.5 0 0 1 21 22Z"],
  chat: ["M21 12a8 8 0 0 1-8 8H6l-3 2 1-5a9 9 0 1 1 17-5Z"],
  copy: ["M8 8h11v11H8z", "M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1"],
  paste: ["M9 4h6v4H9z", "M6 6H4v15h16V6h-2", "M8 13h8", "M8 17h5"],
  save: ["M5 3h12l3 3v15H5z", "M8 3v6h8V3", "M8 21v-7h8v7"],
  saveAs: ["M5 3h12l3 3v15H5z", "M8 3v6h8V3", "M12 13v6", "M9 16l3 3 3-3"],
  branch: ["M6 3v12a4 4 0 0 0 4 4h8", "m14 15 4 4-4 4", "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  refresh: ["M20 7v5h-5", "M4 17v-5h5", "M6.1 9a7 7 0 0 1 11.8-2L20 12", "M4 12l2.1 5a7 7 0 0 0 11.8-2"],
  insert: ["M19 3v12a4 4 0 0 1-4 4H5", "m9 15-4 4 4 4"],
  attachment: ["m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"],
  context: ["M4 6h16", "M4 12h16", "M4 18h16", "M8 3v6", "M16 9v6", "M10 15v6"],
  trash: ["M3 6h18", "M8 6V4h8v2", "m19 6-1 15H6L5 6", "M10 11v5", "M14 11v5"],
  archive: ["M4 7v14h16V7", "M3 3h18v4H3z", "M9 12h6"],
  move: ["M5 9h14", "m15 5 4 4-4 4", "M19 17H5", "m9 13-4 4 4 4"],
  back: ["m15 18-6-6 6-6"],
};

function Icon({ name }: { name: IconName }) {
  return <span className={`icon icon-${name}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{name === "stop" ? <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /> : name === "more" ? [5, 12, 19].map((cx) => <circle cx={cx} cy="12" r="1.45" fill="currentColor" stroke="none" key={cx} />) : iconPaths[name].map((path) => <path d={path} key={path} />)}</svg></span>;
}

function clientId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`}`;
}

function chapterIsEmpty(chapter: Chapter) {
  return chapter.outlines.length <= 1 && chapter.outlines.every((item) => (
    !normalizeOutlineTitle(item.title)
    && !item.plan.trim()
    && !resolvedOutlineContent(item).trim()
    && !item.versions.some((version) => version.content.trim())
    && !item.chat.sessions.some((session) => session.draft.trim() || session.messages.length > 0)
  ));
}

type ServerTaskInput = {
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
  estimatedCharacters?: number;
  targetWords?: number;
  contentMode?: ContentGenerationMode;
  rewriteRetention?: RewriteRetentionLevel;
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

async function createServerTask(studio: ReturnType<typeof useStudio>, input: ServerTaskInput) {
  const taskId = clientId("task");
  const response = await fetchServerAction("/api/ai/tasks", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "Idempotency-Key": taskId },
    body: JSON.stringify({ ...input, ...(input.target === "content" ? {
      reviewMaxRounds: normalizeReviewRounds(studio.data.settings.generateReviewMaxRounds),
      reviewInstruction: normalizeReviewRules(studio.data.settings.generateReviewInstruction),
      reviewStrategy: normalizeReviewStrategy(studio.data.settings.generateReviewStrategy),
      reviewModelMode: studio.data.settings.reviewModelMode === "fixed" ? "fixed" : "inherit",
      reviewModel: studio.data.settings.reviewModel,
    } : {}), ...(input.target === "content" && input.model.trim() ? {
      preparationRounds: input.preparationRounds ?? normalizePreparationRounds(studio.data.settings.preparationMaxRounds),
      preparationStrategy: input.preparationStrategy ?? normalizePreparationStrategy(studio.data.settings.preparationStrategy),
      preparationRequireConfirmation: input.preparationRequireConfirmation ?? studio.data.settings.preparationRequireConfirmation === true,
    } : { preparationRounds: undefined, preparationStrategy: undefined, preparationRequireConfirmation: undefined }) }),
  });
  const payload = await response.json() as { data?: AiTask; revision?: number; message?: string; error?: string };
  if (!response.ok || !payload.data || payload.revision === undefined) throw new Error(payload.message || payload.error || "AI 任务创建失败");
  const task = payload.data;
  studio.acceptServerMutation(payload.revision, (current) => ({
    ...current,
    articles: input.currentPlan === undefined ? current.articles : current.articles.map((article) => article.id !== input.articleId ? article : ({
      ...article,
      updatedAt: task.createdAt,
      chapters: article.chapters.map((chapter) => chapter.id !== input.chapterId ? chapter : ({
        ...chapter,
        outlines: chapter.outlines.map((outline) => outline.id !== input.outlineId ? outline : ({
          ...outline,
          plan: input.currentPlan!,
          generateInstruction: input.instruction,
          generateOptions: input.generateOptions === undefined ? outline.generateOptions : input.generateOptions,
          titleGenerationPending: input.currentPlan !== outline.plan ? true : outline.titleGenerationPending,
          updatedAt: task.createdAt,
        })),
      })),
    })),
    tasks: [task, ...current.tasks.filter((item) => item.id !== task.id)].slice(0, 20),
  }));
  return task;
}

function namingArticleContext(article: Article): NamingArticleContext {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    style: article.style,
    chapterNaming: article.chapterNaming,
    outlineNaming: article.outlineNaming,
    chapters: article.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      archived: chapter.archived,
      outlines: chapter.outlines.map((outline) => ({ id: outline.id, title: outline.title, plan: outline.plan, archived: outline.archived })),
    })),
  };
}

type ActiveChatStream = { controller: AbortController; cancel: () => void };
type ChatStreamState = { taskId: string; sessionId: string; submissionToken: string; controller: AbortController; result: string; finalized: boolean };
type ChatResponseStage = { taskId: string; stage: "requesting-model" | "waiting-first-token" | "recovering" };
const activeChatStreams = new Map<string, ActiveChatStream>();

function registerActiveChatStream(taskId: string, stream: ActiveChatStream) {
  activeChatStreams.set(taskId, stream);
}

function releaseActiveChatStream(taskId: string, controller: AbortController) {
  if (activeChatStreams.get(taskId)?.controller === controller) activeChatStreams.delete(taskId);
}

function cancelActiveChatStream(taskId: string) {
  const stream = activeChatStreams.get(taskId);
  if (!stream) return false;
  stream.cancel();
  return true;
}

function useDismissOnOutside(open: boolean, onClose: () => void, insideSelector: string) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(insideSelector)) return;
      onClose();
    };
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, onClose, insideSelector]);
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Insecure LAN origins can expose the Clipboard API but still reject writes.
    }
  }
  const textarea = document.createElement("textarea");
  try {
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

type ConfiguredModel = { metadata?: ModelMetadata; reasoningEffort?: ReasoningEffort | null; id: string; providerName: string; name: string; modelId: string; hasSecret: boolean; timeoutMs: number; maxInputCharacters: number };

function configuredModelForReference(models: ConfiguredModel[], reference: string) {
  const normalized = reference.trim();
  return models.find((model) => model.id === normalized || model.name === normalized || modelSelectionLabel(model) === normalized);
}

function modelMatchesReference(model: ConfiguredModel, reference: string) {
  const normalized = reference.trim();
  return model.id === normalized || model.name === normalized || modelSelectionLabel(model) === normalized;
}

function ExcellentText({ text, fragments }: { text: string; fragments?: ExcellentFragment[] }) {
  const normalized = normalizeExcellentFragments(text, fragments);
  if (!normalized.length) return <>{text}</>;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  normalized.forEach((fragment) => {
    if (fragment.start > cursor) nodes.push(text.slice(cursor, fragment.start));
    nodes.push(<mark className="excellent-fragment" key={fragment.id}>{text.slice(fragment.start, fragment.end)}</mark>);
    cursor = fragment.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

function resolvedExcellentFragments(outline: Outline) {
  const version = currentOutlineVersion(outline);
  return version
    ? normalizeExcellentFragments(version.content, version.excellentFragments)
    : normalizeExcellentFragments(outline.content, outline.excellentFragments);
}

function directContentId(outlineId: string) {
  return `content:${outlineId}`;
}

function directContentPreview(outline: Outline): Version {
  return {
    id: directContentId(outline.id),
    name: outline.contentName?.trim() || timestampContentName(outline.updatedAt),
    content: outline.content,
    source: "手动",
    createdAt: outline.updatedAt,
    outlineSnapshot: outline.contentOutlineSnapshot,
    manualExcellent: outline.manualExcellent,
    excellentFragments: outline.excellentFragments,
  };
}

function locateRewriteSource(articles: Article[], sourceId: string) {
  for (const article of articles) for (const chapter of article.chapters) for (const outline of chapter.outlines) {
    if (sourceId === directContentId(outline.id)) return { articleId: article.id, outlineId: outline.id, previewId: sourceId };
    if (outline.versions.some((version) => version.id === sourceId)) return { articleId: article.id, outlineId: outline.id, previewId: sourceId };
  }
  return null;
}

function textOffsetWithin(root: HTMLElement, node: Node, offset: number) {
  if (node !== root && !root.contains(node)) return null;
  const range = document.createRange();
  range.setStart(root, 0);
  try { range.setEnd(node, offset); } catch { return null; }
  return range.toString().length;
}

function selectedRangeWithin(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const start = textOffsetWithin(root, range.startContainer, range.startOffset);
  const end = textOffsetWithin(root, range.endContainer, range.endOffset);
  return start === null || end === null || end <= start ? null : { start, end };
}

function canonicalModelReference(models: ConfiguredModel[], reference: string) {
  return configuredModelForReference(models, reference)?.id ?? reference.trim();
}

function TaskReasoningSettings({ kind, model, disabled = false }: { kind: "generate" | "chat" | "naming" | "review"; model?: ConfiguredModel; disabled?: boolean }) {
  const studio = useStudio();
  const key = `${kind}ReasoningEffort` as const;
  return <ReasoningSettings value={studio.data.settings[key]} modelValue={model?.reasoningEffort} disabled={disabled} onChange={(value) => studio.updateSettings({ [key]: value })} />;
}

function modelDisplayLabel(models: ConfiguredModel[], selectedModel: string, fixedModelName?: string) {
  const reference = selectedModel.trim();
  if (!reference) return "本地演示引擎";
  const configured = configuredModelForReference(models, reference);
  return configured ? modelSelectionLabel(configured) : fixedModelName?.trim() || reference;
}

function chatbotDisplayName(models: ConfiguredModel[], selectedModel: string) {
  return modelDisplayLabel(models, selectedModel);
}

function useConfiguredModels() {
  const [models, setModels] = useState<ConfiguredModel[]>([]);
  useEffect(() => {
    let active = true;
    void fetchFromServer("/api/models", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ models?: ConfiguredModel[] }>)
      .then((payload) => { if (active) setModels((payload.models ?? []).filter(supportsText)); })
      .catch(() => { if (active) setModels([]); });
    return () => { active = false; };
  }, []);
  return models;
}

type GenerateContextSummary = AiContextSummary;

const contentGenerationModes: Array<{ value: ContentGenerationMode; label: string; description: string; mobileDescription: string }> = [
  { value: "fresh", label: "全新生成", description: "只依据当前大纲独立创作，不发送现有正文。", mobileDescription: "仅依据大纲，不发送现有正文" },
  { value: "rewrite", label: "改写正文", description: "以现有正文为原稿，返回完整的改写候选。", mobileDescription: "基于现有正文，返回完整候选" },
  { value: "continue", label: "续写正文", description: "模型只生成新增部分，保存时自动接到现有正文后。", mobileDescription: "只生成新增正文，保存时自动追加" },
];

const rewriteRetentionOptions: Array<{ value: RewriteRetentionLevel; label: string; shortLabel: string; description: string }> = [
  { value: "low", label: "低保留", shortLabel: "深度重写", description: "只保留核心情节、人物设定和必要事实，允许全面重构叙述、句段与对白措辞。" },
  { value: "balanced", label: "平衡", shortLabel: "平衡改写", description: "保留事实、因果、视角和关键对白意图，可以重组句段并调整节奏。" },
  { value: "high", label: "高保留", shortLabel: "轻度润色", description: "尽量保留事件顺序、段落结构和关键信息，主要润色措辞与局部句式。" },
];

function contentGenerationModeLabel(mode?: ContentGenerationMode) {
  return contentGenerationModes.find((item) => item.value === mode)?.label ?? "全新生成";
}

function rewriteRetentionLabel(level?: RewriteRetentionLevel) {
  const normalized = normalizeRewriteRetentionLevel(level);
  return rewriteRetentionOptions.find((item) => item.value === normalized)?.label ?? "平衡";
}

function resolvedProseControls(options?: AiTask["contextOptions"]) {
  return normalizeProseControls(options?.proseControls, options?.dialogueDensity);
}

function proseControlsSummary(options?: AiTask["contextOptions"]) {
  const controls = resolvedProseControls(options);
  return `对话 ${dialogueDensityLabel(controls.dialogueDensity)} · 心理 ${introspectionDensityLabel(controls.introspectionDensity)} · 描写 ${descriptionDetailLabel(controls.descriptionDetail)} · 节奏 ${narrativePaceLabel(controls.narrativePace)} · 段落 ${paragraphLengthLabel(controls.paragraphLength)}`;
}

function ProseControlRow<T extends string>({ id, label, value, options, onChange, className = "" }: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  const descriptionId = `${id}-description`;
  return <div className={`prose-control-row ${className}`}>
    <div className="prose-control-heading"><span id={`${id}-heading`}>{label}</span></div>
    <div className={`prose-control-options ${className === "dialogue-density-control" ? "dialogue-density-options" : ""}`} role="radiogroup" aria-label={label} aria-describedby={descriptionId}>
      {options.map((item) => <label className={value === item.value ? "selected" : ""} key={item.value} title={item.description}>
        <input type="radio" name={`generate-${id}`} value={item.value} checked={value === item.value} onChange={() => onChange(item.value)} />
        <span>{item.label}</span>
      </label>)}
    </div>
    <small id={descriptionId}>{options.find((item) => item.value === value)?.description}</small>
  </div>;
}

function generateTargetWordsLabel(targetWords?: number) {
  return targetWords && targetWords > 0 ? `${targetWords.toLocaleString("zh-CN")} 字` : "不限字数";
}

function activeChatSession(outline: Outline) {
  return outline.chat.sessions.find((session) => session.id === outline.chat.activeSessionId) ?? outline.chat.sessions[0];
}

function generateContextSummary(article: Article, outline: Outline, instruction: string, includePrevious: boolean, includeCharacters: boolean, target: "content" | "outline" | "chapter-title" = "content", contentMode: ContentGenerationMode = "fresh", firstAppearanceCharacterIds?: string[], includeExcellentFragments = false, excellentFragmentIds?: string[]): GenerateContextSummary {
  try {
    const selected = selectAiContext({ articles: [article] }, outline.id, target, { includePrevious, includeCharacters, includeExcellentFragments, excellentFragmentIds, contentMode, instruction, currentPlan: outline.plan, firstAppearanceCharacterIds });
    return summarizeAiContext({
      ...selected,
      currentOutline: { ...selected.currentOutline, title: outline.title, plan: outline.plan, content: target === "content" && contentMode !== "fresh" ? resolvedOutlineContent(outline) : selected.currentOutline.content },
      chapterOutlines: selected.chapterOutlines.map((item) => item.id === outline.id ? { ...item, title: outline.title, plan: outline.plan } : item),
    }, instruction);
  } catch {
    return { total: 0, article: 0, chapter: 0, chapterOutlines: 0, outline: 0, content: 0, previous: 0, previousCount: 0, chapterOutlineCount: 0, characters: 0, characterCount: 0, previousContent: 0, excellentFragments: 0, excellentFragmentCount: 0, instruction: instruction.length };
  }
}

function IconButton({
  name,
  label,
  variant = "ghost",
  size = "medium",
  badge,
  className = "",
  title,
  ...buttonProps
}: {
  name: IconName;
  label: string;
  variant?: "ghost" | "glass" | "solid";
  size?: "small" | "medium" | "large";
  badge?: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label">) {
  return (
    <button className={`icon-button icon-button-${variant} icon-button-${size} ${className}`.trim()} type="button" aria-label={label} title={title ?? label} {...buttonProps}>
      <Icon name={name} />
      {badge !== undefined && badge !== null && <span className="icon-button-badge" aria-hidden="true">{badge}</span>}
    </button>
  );
}

function VirtualList<T extends { id: string }>({ items, rowHeight, maxHeight, className, renderItem }: { items: T[]; rowHeight: number; maxHeight: number; className: string; renderItem: (item: T, index: number, style: CSSProperties) => ReactNode }) {
  const [scrollTop, setScrollTop] = useState(0);
  const viewportHeight = Math.min(maxHeight, items.length * rowHeight);
  const overscan = 5;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return <div className={`${className} virtual-list-viewport`} style={{ height: viewportHeight }} role="list" aria-label={`虚拟大纲列表，共 ${items.length} 条`} tabIndex={0} onKeyDown={(event) => {
    if (event.key === "Home") { event.preventDefault(); event.currentTarget.scrollTop = 0; }
    else if (event.key === "End") { event.preventDefault(); event.currentTarget.scrollTop = items.length * rowHeight; }
    else if (event.key === "PageDown") { event.preventDefault(); event.currentTarget.scrollTop += viewportHeight; }
    else if (event.key === "PageUp") { event.preventDefault(); event.currentTarget.scrollTop -= viewportHeight; }
  }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
    <div className="virtual-list-spacer" style={{ height: items.length * rowHeight }}>
      {items.slice(start, end).map((item, offset) => renderItem(item, start + offset, { position: "absolute", top: (start + offset) * rowHeight, left: 0, right: 0, height: rowHeight }))}
    </div>
  </div>;
}

function viewFromPath(pathname: string): View {
  if (pathname.endsWith("/chapters/edit-all")) return "outline-edit";
  if (pathname.endsWith("/outlines/edit-all")) return "outline-edit";
  if (pathname.endsWith("/outlines")) return "outline-home";
  if (pathname.includes("/chat")) return "chat";
  if (pathname.includes("/generate")) return "generate";
  if (pathname.includes("/chapters/")) return "chapter";
  if (pathname.endsWith("/edit") || pathname.endsWith("/read")) return "read";
  if (pathname.endsWith("/search")) return "search";
  if (pathname.includes("/info/ai-tasks")) return "info-ai-tasks";
  // Keep existing bookmarks working after the article settings are grouped
  // under the AI task settings tab.
  if (pathname.includes("/info/review-rules")) return "info-ai-tasks";
  if (pathname.includes("/info/chapters")) return "info-ai-tasks";
  if (pathname.includes("/info/characters")) return "info-characters";
  if (pathname.includes("/info/relationships")) return "info-relationships";
  if (pathname.includes("/info/")) return "info-basic";
  if (pathname.includes("/settings/appearance")) return "settings-appearance";
  if (pathname.includes("/settings/models")) return "settings-models";
  if (pathname.includes("/settings/prompts")) return "settings-prompts";
  if (pathname.includes("/settings/tasks")) return "settings-tasks";
  if (pathname.includes("/settings/database")) return "settings-database";
  if (pathname.includes("/settings/system")) return "settings-system";
  if (pathname.includes("/settings/")) return "settings-general";
  return "write";
}

function routeFor(view: View, articleId: string, outlineId: string, chapterId: string) {
  const base = `/articles/${articleId}`;
  const paths: Record<View, string> = {
    "outline-home": `${base}/outlines`,
    write: `${base}/outlines/${outlineId}/write`,
    chat: `${base}/outlines/${outlineId}/chat`,
    generate: `${base}/outlines/${outlineId}/generate`,
    chapter: `${base}/chapters/${chapterId}`,
    "outline-edit": `${base}/outlines/edit-all`,
    read: `${base}/edit`,
    search: `${base}/search`,
    "info-basic": `${base}/info/basic`,
    "info-ai-tasks": `${base}/info/ai-tasks`,
    "info-characters": `${base}/info/characters`,
    "info-relationships": `${base}/info/relationships`,
    "settings-general": "/settings/general",
    "settings-appearance": "/settings/appearance",
    "settings-models": "/settings/models",
    "settings-prompts": "/settings/prompts",
    "settings-tasks": "/settings/tasks",
    "settings-database": "/settings/database",
    "settings-system": "/settings/system",
  };
  return paths[view];
}

export default function WriterStudioApp() {
  return <StudioProvider><StudioThemeProvider><DataTransferProvider><CharacterPhotoRuntime /><WriterStudioInner /></DataTransferProvider></StudioThemeProvider></StudioProvider>;
}

function WriterStudioInner() {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const { setColorScheme } = useMantineColorScheme();
  const studioRef = useRef(studio);
  studioRef.current = studio;
  const activeOutline = studio.currentOutline;
  const activeArticle = studio.currentArticle;
  const [view, setView] = useState<View>("write");
  const currentOutline = activeOutline.id;
  const articleTitle = activeArticle.title;
  const hasOutlines = activeArticle.chapters.some((chapter) => chapter.outlines.length > 0);
  const [articleMenu, setArticleMenu] = useState(false);
  const [taskPanel, setTaskPanel] = useState(false);
  const [taskSelectionId, setTaskSelectionId] = useState("");
  const [taskIllustration, setTaskIllustration] = useState<{ outlineId: string; content: string; tab: string } | null>(null);
  useEffect(() => {
    const open = (event: Event) => { setTaskSelectionId((event as CustomEvent<string>).detail); setTaskPanel(true); };
    window.addEventListener("writer-studio-open-task", open);
    return () => window.removeEventListener("writer-studio-open-task", open);
  }, []);
  const [versions, setVersions] = useState(false);
  const [previewSelection, setPreviewSelection] = useState<{ outlineId: string; versionId: string } | null>(null);
  const [newArticle, setNewArticle] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [mobileWritingEditing, setMobileWritingEditing] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileLayout, setMobileLayout] = useState(false);
  const [taskLeaseTick, setTaskLeaseTick] = useState(0);
  const taskDispatches = useRef<Set<string>>(new Set());
  const continuousDocumentPositions = useRef<Record<string, ContinuousDocumentPosition>>({});

  useEffect(() => {
    setColorScheme(studio.data.settings.theme === "system" ? "auto" : studio.data.settings.theme);
  }, [setColorScheme, studio.data.settings.theme]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const syncLayout = () => setMobileLayout(query.matches);
    syncLayout();
    query.addEventListener("change", syncLayout);
    return () => query.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    if (!studio.hydrated) return;
    const sync = () => {
      const currentStudio = studioRef.current;
      const articleMatch = window.location.pathname.match(/\/articles\/([^/]+)/);
      const outlineMatch = window.location.pathname.match(/\/outlines\/([^/]+)/);
      const chapterMatch = window.location.pathname.match(/\/chapters\/([^/]+)/);
      if (articleMatch && currentStudio.data.articles.some((article) => article.id === articleMatch[1])) currentStudio.setCurrentArticle(articleMatch[1]);
      if (outlineMatch && currentStudio.data.articles.some((article) => article.chapters.some((chapter) => chapter.outlines.some((outline) => outline.id === outlineMatch[1])))) currentStudio.setCurrentOutline(outlineMatch[1]);
      else if (chapterMatch) {
        const chapter = currentStudio.data.articles.flatMap((article) => article.chapters).find((item) => item.id === chapterMatch[1]);
        if (chapter?.outlines[0]) currentStudio.setCurrentOutline(chapter.outlines[0].id);
      }
      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      const requested = isMobile && window.location.pathname === "/" ? "outline-home" : viewFromPath(window.location.pathname);
      setView(!isMobile && requested === "outline-home" ? "write" : requested);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [studio.hydrated]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!studio.data.tasks.some((task) => task.executionOrigin === studio.executionOrigin && (task.state === "waiting" || task.state === "running"))) return;
    const timer = window.setInterval(() => setTaskLeaseTick((value) => value + 1), 3000);
    return () => window.clearInterval(timer);
  }, [studio.data.tasks, studio.executionOrigin]);

  useEffect(() => {
    if (!studio.hydrated || browserIsOffline() || studio.saveStatus === "failed" || studio.saveStatus === "conflict" || studio.saveStatus === "local") return;
    const currentStudio = studioRef.current;
    const currentTime = Date.now();
    const leaseExpired = (task: AiTask) => task.state === "running" && (!task.leaseUntil || new Date(task.leaseUntil).getTime() <= currentTime);
    const runningTasks = currentStudio.data.tasks.filter((task) => task.executionOrigin === currentStudio.executionOrigin && task.target !== "AI Chat" && task.state === "running" && !leaseExpired(task));
    const available = Math.max(0, currentStudio.data.settings.taskConcurrency - runningTasks.length);
    const occupiedBodyOutlines = new Set([...runningTasks.filter((task) => task.target === "正文"), ...currentStudio.data.tasks.filter((task) => task.target === "正文" && isTaskAwaitingAuthor(task))].map((task) => task.outlineId));
    const dispatchableTasks: AiTask[] = [];
    for (const task of currentStudio.data.tasks
      .filter((task) => task.executionOrigin === currentStudio.executionOrigin && task.target !== "AI Chat" && !isTaskAwaitingAuthor(task) && (task.state === "waiting" || leaseExpired(task)))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
      if (dispatchableTasks.length >= available) break;
      if (task.target === "正文" && occupiedBodyOutlines.has(task.outlineId)) continue;
      dispatchableTasks.push(task);
      if (task.target === "正文") occupiedBodyOutlines.add(task.outlineId);
    }
    dispatchableTasks.forEach((task) => {
      if (taskDispatches.current.has(task.id)) return;
      taskDispatches.current.add(task.id);
      void (async () => {
        try {
          const response = await fetchFromServer(`/api/ai/tasks/${encodeURIComponent(task.id)}/execute`, { method: "POST", cache: "no-store" });
          await response.text();
        } catch {
          // A queued task remains available and will be retried after reconnecting.
        } finally {
          taskDispatches.current.delete(task.id);
          await studioRef.current.refreshFromServer();
          window.dispatchEvent(new Event("illustrations-updated"));
        }
      })();
    });
  }, [studio.executionOrigin, studio.hydrated, studio.saveStatus, studio.data.tasks, studio.data.settings.taskConcurrency, taskLeaseTick]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setArticleMenu(false);
        setTaskPanel(false);
        setVersions(false);
        setFocusMode(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        go("search");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void studio.saveNow().then((saved) => setToast(saved ? "内容已保存到本地数据库" : "保存未完成，请查看提示"));
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFocusMode((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function go(next: View, outlineId = currentOutline, skipSave = false) {
    const switchingWorkspaceMode = outlineId === currentOutline
      && next !== view
      && (view === "write" || view === "chat" || view === "generate")
      && (next === "write" || next === "chat" || next === "generate");
    if (!skipSave && requiresSaveBeforeNavigation && next !== view && !switchingWorkspaceMode && !await studio.saveNow()) return;
    const targetArticle = studio.data.articles.find((article) => article.chapters.some((chapter) => chapter.outlines.some((outline) => outline.id === outlineId))) ?? studio.currentArticle;
    const targetChapter = targetArticle.chapters.find((chapter) => chapter.outlines.some((outline) => outline.id === outlineId)) ?? studio.currentChapter;
    setView(next);
    window.history.pushState({}, "", routeFor(next, targetArticle.id, outlineId, targetChapter.id));
    setArticleMenu(false);
    setTaskPanel(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (!skipSave && switchingWorkspaceMode && studio.saveStatus === "unsaved") {
      window.setTimeout(() => { void studio.saveNow(); }, 0);
    }
  }

  async function openOutline(outlineId: string, next: "write" | "chat" = "write", previewVersionId?: string) {
    if (requiresSaveBeforeNavigation && outlineId !== currentOutline && !await studio.saveNow()) return;
    setPreviewSelection(previewVersionId ? { outlineId, versionId: previewVersionId } : null);
    studio.setCurrentOutline(outlineId);
    await go(next, outlineId, true);
  }

  async function openRewriteSource(sourceId: string) {
    const source = locateRewriteSource(studio.data.articles, sourceId);
    if (!source) {
      setToast("原正文已删除，无法打开");
      return;
    }
    setVersions(false);
    await openOutline(source.outlineId, "write", source.previewId);
  }

  const previewVersion = previewSelection?.outlineId === currentOutline
    ? activeOutline.versions.find((version) => version.id === previewSelection.versionId)
      ?? (previewSelection.versionId === directContentId(activeOutline.id) ? directContentPreview(activeOutline) : undefined)
    : undefined;
  const selectedOutline = { chapter: studio.currentChapter.title, title: activeOutline.title, plan: activeOutline.plan, content: previewVersion?.content ?? resolvedOutlineContent(activeOutline) };
  const isOutlineWorkspaceView = view === "write" || view === "chat" || view === "generate";
  const requiresSaveBeforeNavigation = isOutlineWorkspaceView || view === "outline-edit" || view === "read";
  const mobilePageTitle = view === "search"
    ? "搜索"
    : view === "outline-edit"
      ? "章节与大纲"
    : view === "read"
      ? "全文编辑"
      : view === "chapter"
        ? "章节阅读"
        : view.startsWith("info-")
          ? "文章资料"
          : view.startsWith("settings-")
            ? "设置"
            : outlineDisplayTitle(selectedOutline);

  if (!studio.hydrated) {
    return <div className="app-loading" role="status" aria-live="polite"><span className="loading-mark">W</span><span className="ui-title">正在打开 Writer Studio</span><p>正在加载文章树和正文…</p><div className="loading-bar"><i /></div></div>;
  }

  if (!studio.data.articles.length && view.startsWith("settings-")) {
    return <div className={`studio-shell theme-${studio.data.settings.theme}`}><PersistenceNotices /><main className="main-area"><header className="empty-library-settings-back"><button className="secondary-button" type="button" onClick={() => void go("write")}><Icon name="back" />返回工作台</button></header><SettingsPage view={view} onGo={go} /></main></div>;
  }

  if (!studio.data.articles.length) {
    return <div className={`studio-shell empty-library-shell theme-${studio.data.settings.theme}`}><PersistenceNotices /><main className="main-area"><div className="library-empty-state"><span className="empty-library-mark">W</span><h1>创建第一篇文章</h1><div className="empty-library-actions"><button className="primary-compact" type="button" onClick={() => setNewArticle(true)}><Icon name="plus" />新建文章</button><button className="secondary-button" type="button" onClick={() => void transfer.importAnyArticles()}><Icon name="paste" />导入文章</button><button className="secondary-button" type="button" onClick={() => void go("settings-appearance")}><Icon name="settings" />主题设置</button></div></div></main>{newArticle && <NewArticleDialog onClose={() => setNewArticle(false)} onCreate={(fields) => { studio.createArticle(fields); setNewArticle(false); setToast("文章已创建，并生成第一章"); setView(mobileLayout ? "outline-home" : "write"); window.history.pushState({}, "", "/"); }} />}{toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}</div>;
  }

  return (
    <div className={`studio-shell ${focusMode ? "focus-mode" : ""} ${mobileWritingEditing ? "mobile-writing-editing" : ""} theme-${studio.data.settings.theme}`}>
      <PersistenceNotices />
      {taskIllustration && <IllustrationGenerator outlineId={taskIllustration.outlineId} content={taskIllustration.content} selectedExcerpt="" initialTab={taskIllustration.tab} defaultModel={studio.data.settings.illustrationPromptModel || studio.data.settings.generateModel} defaultImageModel={studio.data.settings.illustrationImageModel} onClose={() => setTaskIllustration(null)} />}
      {!focusMode && !mobileLayout && (
        <Sidebar
          key={`sidebar:${activeArticle.id}`}
          view={view}
          articleTitle={articleTitle}
          currentOutline={currentOutline}
        mobileLayout={mobileLayout}
          articleMenu={articleMenu}
          onToggleArticle={() => setArticleMenu((value) => !value)}
          onOutline={openOutline}
          onGo={go}
          onNewArticle={() => setNewArticle(true)}
          onTask={() => setTaskPanel((value) => !value)}
          onNotice={setToast}
        />
      )}

      <main className={`main-area ${taskPanel ? "tasks-main-area" : ""}`}>
        {taskPanel ? <TaskPanel key={taskSelectionId} initialTaskId={taskSelectionId} onClose={() => { setTaskPanel(false); setTaskSelectionId(""); }} onOpen={openOutline} onOpenIllustration={task => {
          const source = studio.data.articles.flatMap(article => article.chapters).flatMap(chapter => chapter.outlines).find(outline => outline.id === task.outlineId);
          setTaskIllustration({ outlineId: task.outlineId, content: source ? resolvedOutlineContent(source) : "", tab: task.target === "插图" ? "images" : "prompts" });
        }} /> : <>
        {view !== "outline-home" && <MobileHeader
          title={mobilePageTitle}
          status={isOutlineWorkspaceView ? saveStatusLabel(studio.saveStatus) : articleTitle}
          onBack={() => go("outline-home")}
          onVersions={() => setVersions(true)}
          showVersions={isOutlineWorkspaceView}
          outlineId={isOutlineWorkspaceView ? studio.currentOutline.id : undefined}
        />}

        {view === "outline-home" && (hasOutlines ? <MobileOutlineHome key={`mobile-outline:${activeArticle.id}`} articleTitle={articleTitle} currentOutline={currentOutline} articleMenuOpen={articleMenu} onArticleMenu={() => setArticleMenu(true)} onOutline={openOutline} onChapter={() => go("chapter")} onTask={() => setTaskPanel(true)} onSettings={() => go("settings-general")} onNotice={setToast} /> : <StructureEmptyState articleTitle={articleTitle} onCreate={() => { const id = studio.createOutline(); setView("write"); window.history.pushState({}, "", `/articles/${activeArticle.id}/outlines/${id}/write`); }} />)}
        {(view === "write" || view === "chat" || view === "generate") && (
          hasOutlines ? <OutlineWorkspace
            key={currentOutline}
            mode={view}
            outline={selectedOutline}
            focusMode={focusMode}
            onMode={go}
            onVersions={() => setVersions(true)}
            onFocus={() => setFocusMode((value) => !value)}
            onTaskCreated={() => setToast("AI Generate 任务已加入队列")}
            onOpenTasks={() => setTaskPanel(true)}
            onNotice={setToast}
            previewVersion={previewVersion}
            onOpenRewriteSource={openRewriteSource}
            onClearPreview={() => setPreviewSelection(null)}
            onWritingEditingChange={setMobileWritingEditing}
          /> : <StructureEmptyState articleTitle={articleTitle} onCreate={() => { const id = studio.createOutline(); setView("write"); window.history.pushState({}, "", `/articles/${activeArticle.id}/outlines/${id}/write`); }} />
        )}
        {view === "chapter" && (studio.currentChapter.id ? <ChapterReader onOutline={openOutline} /> : <StructureEmptyState articleTitle={articleTitle} onCreate={() => { const id = studio.createOutline(); setView("write"); window.history.pushState({}, "", `/articles/${activeArticle.id}/outlines/${id}/write`); }} />)}
        {view === "outline-edit" && <ContinuousDocumentEditor key={`outline-edit:${activeArticle.id}`} mode="outline" positionMemory={continuousDocumentPositions} onNotice={setToast} onTaskCreated={() => setTaskPanel(true)} />}
        {view === "read" && <ContinuousDocumentEditor key={`content-edit:${activeArticle.id}`} mode="content" positionMemory={continuousDocumentPositions} onNotice={setToast} onTaskCreated={() => setTaskPanel(true)} />}
        {view === "search" && <SearchPage onOutline={openOutline} onCharacter={() => go("info-characters")} />}
        {view.startsWith("info-") && <ArticleInfoPage view={view} onGo={go} onNotice={setToast} />}
        {view.startsWith("settings-") && <SettingsPage view={view} onGo={go} />}
        </>}
      </main>

      {mobileLayout && articleMenu && <MobileArticleDrawer
        onClose={() => setArticleMenu(false)}
        onGo={(next) => void go(next)}
        onNewArticle={() => { setArticleMenu(false); setNewArticle(true); }}
        onSelect={async (articleId) => {
          if (articleId !== studio.currentArticle.id && !await studio.saveNow()) return;
          studio.setCurrentArticle(articleId);
          setPreviewSelection(null);
          setArticleMenu(false);
          setView("outline-home");
          window.history.pushState({}, "", "/");
        }}
      />}
      {versions && <VersionDrawer
        selectedVersionId={previewSelection?.outlineId === currentOutline ? previewSelection.versionId : undefined}
        onClose={() => setVersions(false)}
        onPreview={(versionId) => { setPreviewSelection({ outlineId: currentOutline, versionId }); void go("write", currentOutline, true); }}
        onClearPreview={() => { setPreviewSelection(null); void go("write", currentOutline, true); }}
        onOpenRewriteSource={openRewriteSource}
        onNotice={setToast}
      />}
      {newArticle && <NewArticleDialog onClose={() => setNewArticle(false)} onCreate={(fields) => {
        studio.createArticle(fields);
        setNewArticle(false);
        setToast("文章已创建，并生成第一章");
        setView(mobileLayout ? "outline-home" : "write");
        window.history.pushState({}, "", "/");
      }} />}
      {toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}
    </div>
  );
}

function saveStatusLabel(status: ReturnType<typeof useStudio>["saveStatus"]) {
  return status === "saving" ? "正在保存…" : status === "unsaved" ? "未保存" : status === "local" ? "已保存到本机" : status === "failed" ? "保存失败" : status === "conflict" ? "保存冲突" : "已保存";
}

function StructureEmptyState({ articleTitle, onCreate }: { articleTitle: string; onCreate: () => void }) {
  return <div className="structure-empty-state"><span>{articleTitle}</span><h1>开始规划这篇文章</h1><button className="primary-compact" type="button" onClick={onCreate}><Icon name="plus" />新建大纲</button></div>;
}

function PersistenceNotices() {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [copyFeedback, setCopyFeedback] = useState({ revision: -1, message: "" });
  const detail = studio.conflict?.details[0];
  const currentLocal = detail?.localText ?? "";
  const currentServer = detail?.serverText ?? "";
  const conflictRevision = studio.conflict?.serverRevision ?? -1;
  const copyState = copyFeedback.revision === conflictRevision ? copyFeedback.message : "";
  return <>
    {studio.saveStatus === "local" && <div className="persistence-banner local" role="status"><span><span className="ui-label">已保存到本设备</span>{studio.saveError || "重新连接 Writer Studio 服务后会自动同步。"}</span><button type="button" onClick={() => void studio.retrySave()}>立即同步</button></div>}
    {studio.saveStatus === "failed" && <div className="persistence-banner error" role="alert"><span><span className="ui-label">保存失败</span>{studio.saveError || "本地数据库暂时不可用，正文仍保留在本次会话中。"}</span><button type="button" onClick={() => void studio.retrySave()}>重试保存</button></div>}
    <ResponsiveModal opened={Boolean(studio.conflict)} onClose={() => undefined} withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false} centered={!compact} fullScreen={compact} size="lg" title="处理保存冲突" classNames={{ content: "conflict-modal", header: "conflict-modal-header", body: "conflict-modal-body" }} overlayProps={{ backgroundOpacity: 0.48, blur: 3 }}>
      {studio.conflict && <div className="conflict-card"><p><strong>{detail?.label ?? "同一项数据"}</strong>在其他窗口或设备上也被修改，请选择要保留的内容。{studio.conflict.details.length > 1 ? ` 另有 ${studio.conflict.details.length - 1} 项冲突将采用相同选择。` : ""}</p><div className="conflict-columns"><section><span className="ui-label">本设备待保存内容</span><pre tabIndex={0}>{currentLocal.slice(0, 10000) || "（空）"}</pre></section><section><span className="ui-label">数据库当前内容</span><pre tabIndex={0}>{currentServer.slice(0, 10000) || "（空）"}</pre></section></div>{copyState && <div className={`conflict-copy-state ${copyState === "已复制" ? "success" : "error"}`} role="status">{copyState}</div>}<div className="conflict-actions"><Button variant="default" type="button" leftSection={<Icon name="copy" />} onClick={() => void copyTextToClipboard(currentLocal).then((copied) => setCopyFeedback({ revision: conflictRevision, message: copied ? "已复制" : "复制失败，请长按上方文字进行选择" }))}>复制待保存内容</Button><Button variant="default" type="button" onClick={() => void studio.resolveConflict("use-server")}>使用数据库内容</Button><Button type="button" onClick={() => void studio.resolveConflict("keep-local")}>保留本设备修改</Button></div></div>}
    </ResponsiveModal>
  </>;
}

type OutlineDropPlacement = "before" | "after";
type OutlineDropIndicator = { targetId: string; placement: OutlineDropPlacement } | null;
type ContinuousDocumentPosition = { outlineId: string; offsetTop: number };
type ContinuousDocumentPositionMemory = { current: Record<string, ContinuousDocumentPosition> };
const CONTINUOUS_POSITION_SETTLE_MS = 1200;

function outlineDropPlacement(event: DragEndEvent | DragOverEvent, orderedIds: string[]): OutlineDropPlacement {
  if (event.over) {
    const sourceIndex = orderedIds.indexOf(String(event.active.id));
    const targetIndex = orderedIds.indexOf(String(event.over.id));
    if (event.activatorEvent.type === "keydown" && sourceIndex >= 0 && targetIndex >= 0) {
      return sourceIndex < targetIndex ? "after" : "before";
    }
    const translated = event.active.rect.current.translated;
    if (translated) {
      const activeCenter = translated.top + translated.height / 2;
      const targetCenter = event.over.rect.top + event.over.rect.height / 2;
      if (Math.abs(activeCenter - targetCenter) > 2) return activeCenter > targetCenter ? "after" : "before";
    }
    if (sourceIndex >= 0 && targetIndex >= 0) return sourceIndex < targetIndex ? "after" : "before";
  }
  return "after";
}

function DesktopChapterDropRow({ chapterId, className, children }: { chapterId: string; className: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: `desktop-chapter:${chapterId}`, data: { type: "chapter", chapterId } });
  return <div ref={setNodeRef} className={`${className} ${isOver ? "chapter-drop-active" : ""}`}>{children}</div>;
}

function MobileChapterDropHeader({ chapterId, children }: { chapterId: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: `mobile-chapter:${chapterId}`, data: { type: "chapter", chapterId } });
  return <header ref={setNodeRef} className={isOver ? "chapter-drop-active" : ""}>{children}</header>;
}

function EmptyChapterDropZone({ chapterId, mobile = false }: { chapterId: string; mobile?: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: `${mobile ? "mobile" : "desktop"}-chapter-empty:${chapterId}`, data: { type: "chapter", chapterId } });
  return <div ref={setNodeRef} className={`empty-chapter-drop ${mobile ? "mobile-empty-chapter-drop" : ""} ${isOver ? "chapter-drop-active" : ""}`} aria-label="将大纲移动到此章节" />;
}

function DesktopOutlineRow({ item, selected, style, dropPlacement, onOpen, onMore }: {
  item: Outline;
  selected: boolean;
  style?: CSSProperties;
  dropPlacement?: OutlineDropPlacement;
  onOpen: () => void;
  onMore: () => void;
}) {
  const displayTitle = outlineDisplayTitle(item);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, data: { type: "outline", outlineId: item.id } });
  const sortableStyle: CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 3 : style?.zIndex,
  };
  return <div
    ref={setNodeRef}
    style={sortableStyle}
    data-outline-id={item.id}
    className={`outline-row ${selected ? "selected" : ""} ${item.archived ? "archived" : ""} ${isDragging ? "dragging" : ""} ${dropPlacement ? `drop-${dropPlacement}` : ""}`}
  >
    <span className="outline-indent" />
    <button ref={setActivatorNodeRef} className="outline-drag-handle" type="button" {...attributes} {...listeners} aria-label={`拖动排序：${displayTitle}`} title="拖动调整顺序"><span aria-hidden="true" /></button>
    <button className="outline-title" type="button" onClick={onOpen}>{displayTitle}</button>
    <OutlineTaskIndicator outlineId={item.id} fallback={item.state} />
    <button className="row-more" type="button" aria-label={`${displayTitle}更多操作`} onClick={onMore}><Icon name="more" /></button>
  </div>;
}

function Sidebar({
  view,
  articleTitle,
  currentOutline,
  mobileLayout,
  articleMenu,
  onToggleArticle,
  onOutline,
  onGo,
  onNewArticle,
  onTask,
  onNotice,
}: {
  view: View;
  articleTitle: string;
  currentOutline: string;
  mobileLayout: boolean;
  articleMenu: boolean;
  onToggleArticle: () => void;
  onOutline: (id: string, next?: "write" | "chat") => void;
  onGo: (view: View) => void;
  onNewArticle: () => void;
  onTask: () => void;
  onNotice: (message: string) => void;
}) {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const groups = studio.currentArticle.chapters
    .filter((chapter) => studio.data.settings.showArchived || !chapter.archived)
    .map((chapter) => ({ ...chapter, items: chapter.outlines.filter((item) => studio.data.settings.showArchived || !item.archived) }));
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    if (typeof window !== "undefined") {
      try { const stored = window.localStorage.getItem(`writer-studio:expanded:${studio.currentArticle.id}`); if (stored) return JSON.parse(stored) as Record<string, boolean>; }
      catch { /* Use article defaults when saved UI state is invalid. */ }
    }
    return Object.fromEntries(studio.currentArticle.chapters.map((chapter) => [chapter.id, !chapter.archived]));
  });
  const [outlineMenu, setOutlineMenu] = useState<Outline | null>(null);
  const [outlineSettingsId, setOutlineSettingsId] = useState<string | null>(null);
  const [chapterMenu, setChapterMenu] = useState<Chapter | null>(null);
  const [chapterSettingsId, setChapterSettingsId] = useState<string | null>(null);
  const [structureGenerate, setStructureGenerate] = useState<{ kind: "outline" | "chapter"; id: string; title: string } | null>(null);
  const [articleQuery, setArticleQuery] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<OutlineDropIndicator>(null);
  const expandTimer = useRef<number | null>(null);
  const expandTarget = useRef<string | null>(null);
  const virtualizeTree = groups.reduce((total, group) => total + group.items.length, 0) > 200;
  const orderedOutlineIds = groups.flatMap((group) => group.items.map((item) => item.id));
  const draggingOutline = groups.flatMap((group) => group.items).find((item) => item.id === draggingId);
  const dragSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => { if (typeof window === "undefined") return 280; const value = Number(window.localStorage.getItem("writer-studio:sidebar-width")); return value >= 240 && value <= 360 ? value : 280; });
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("writer-studio:sidebar-collapsed") === "true");
  const sidebarCollapsed = collapsed || view.startsWith("settings-");
  useDismissOnOutside(articleMenu, onToggleArticle, ".article-switcher, .article-popover");

  useEffect(() => { window.localStorage.setItem(`writer-studio:expanded:${studio.currentArticle.id}`, JSON.stringify(expanded)); }, [expanded, studio.currentArticle.id]);
  useEffect(() => () => { if (expandTimer.current !== null) window.clearTimeout(expandTimer.current); }, []);

  useEffect(() => {
    const width = sidebarCollapsed ? 56 : sidebarWidth;
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    window.localStorage.setItem("writer-studio:sidebar-width", String(sidebarWidth));
    window.localStorage.setItem("writer-studio:sidebar-collapsed", String(collapsed));
  }, [sidebarWidth, collapsed, sidebarCollapsed]);

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    if (collapsed) return;
    event.preventDefault();
    const move = (pointer: PointerEvent) => setSidebarWidth(Math.max(240, Math.min(360, pointer.clientX)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  function clearDragState() {
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    expandTimer.current = null;
    expandTarget.current = null;
    setDraggingId(null);
    setDropIndicator(null);
  }

  function handleOutlineDragOver(event: DragOverEvent) {
    const targetId = event.over ? String(event.over.id) : "";
    const targetType = event.over?.data.current?.type;
    setDropIndicator(targetType === "outline" && targetId !== String(event.active.id) ? { targetId, placement: outlineDropPlacement(event, orderedOutlineIds) } : null);

    const chapterId = targetType === "chapter" ? String(event.over?.data.current?.chapterId ?? "") : "";
    if (!chapterId || expanded[chapterId]) {
      if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
      expandTimer.current = null;
      expandTarget.current = null;
      return;
    }
    if (expandTarget.current === chapterId) return;
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    expandTarget.current = chapterId;
    expandTimer.current = window.setTimeout(() => {
      setExpanded((state) => ({ ...state, [chapterId]: true }));
      expandTimer.current = null;
      expandTarget.current = null;
    }, 500);
  }

  function finishOutlineDrag(event: DragEndEvent) {
    const sourceId = String(event.active.id);
    const targetId = event.over ? String(event.over.id) : "";
    const source = groups.flatMap((group) => group.items).find((item) => item.id === sourceId);
    const targetType = event.over?.data.current?.type;
    const chapterId = targetType === "chapter" ? String(event.over?.data.current?.chapterId ?? "") : "";
    clearDragState();
    if (!source) return;
    if (chapterId) {
      studio.moveOutlineToChapter(sourceId, chapterId);
      const chapter = groups.find((group) => group.id === chapterId);
      onNotice(chapter ? `已将「${outlineDisplayTitle(source)}」移到「${chapter.title}」末尾` : `已移动「${outlineDisplayTitle(source)}」`);
      return;
    }
    if (!targetId || targetId === sourceId || targetType !== "outline") return;
    const placement = dropIndicator?.targetId === targetId ? dropIndicator.placement : outlineDropPlacement(event, orderedOutlineIds);
    studio.moveOutline(sourceId, targetId, placement);
    onNotice(`已移动「${outlineDisplayTitle(source)}」`);
  }

  return (
    <>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="文章导航" aria-hidden={mobileLayout ? true : undefined} inert={mobileLayout ? true : undefined}>
        <div className="sidebar-head">
          <button className="article-switcher" type="button" aria-label={articleTitle} onClick={onToggleArticle} aria-expanded={articleMenu}>
            <span className="article-mark">{articleTitle[0]}</span>
            <span className="article-name">{articleTitle}</span>
            <Icon name="chevron" />
          </button>
          <IconButton name="menu" label={view.startsWith("settings-") ? "返回写作" : sidebarCollapsed ? "展开侧栏" : "折叠侧栏"} className="sidebar-collapse" onClick={() => view.startsWith("settings-") ? onGo("write") : setCollapsed((value) => !value)} />
        </div>

        {articleMenu && !mobileLayout && (
          <div className="article-popover">
            <label className="mini-search">
              <Icon name="search" />
              <input autoFocus aria-label="搜索文章" placeholder="搜索文章…" value={articleQuery} onChange={(event) => setArticleQuery(event.target.value)} />
            </label>
            <p className="menu-label">最近打开</p>
            {studio.data.articles.filter((article) => `${article.title}${article.summary}`.toLocaleLowerCase().includes(articleQuery.toLocaleLowerCase())).map((article, index) => <button className={`article-option ${article.id === studio.currentArticle.id ? "selected" : ""}`} type="button" key={article.id} onClick={async () => { if (!await studio.saveNow()) return; studio.setCurrentArticle(article.id); onOutline(article.lastOutlineId); }}><span className={`article-dot ${["amber", "blue", "green"][index % 3]}`}>{article.title[0]}</span><span>{article.title}</span>{article.id === studio.currentArticle.id && <Icon name="check" />}</button>)}
            <div className="article-popover-actions">
              <button className="new-article-link" type="button" onClick={onNewArticle}><Icon name="plus" /> 新建文章</button>
              <button className="new-article-link" type="button" onClick={() => { onToggleArticle(); void transfer.importArticle(); }}><Icon name="paste" /> 导入文章</button>
            </div>
          </div>
        )}

        <div className="sidebar-primary">
          <nav className="quick-links" aria-label="文章功能">
            <button className={view === "outline-edit" ? "active" : ""} onClick={() => onGo("outline-edit")} type="button" aria-label="章节与大纲" title="章节与大纲"><Icon name="edit" /><span>章节与大纲</span></button>
            <button className={view === "read" ? "active" : ""} onClick={() => onGo("read")} type="button" aria-label="全文编辑" title="全文编辑"><Icon name="read" /><span>全文编辑</span></button>
            <button className={view.startsWith("info-") ? "active" : ""} onClick={() => onGo("info-basic")} type="button" aria-label="文章资料" title="文章资料"><Icon name="info" /><span>文章资料</span></button>
          </nav>
        </div>

        <DndContext
          sensors={dragSensors}
          collisionDetection={closestCenter}
          autoScroll={{ acceleration: 10, threshold: { x: 0.15, y: 0.15 } }}
          onDragStart={(event) => setDraggingId(String(event.active.id))}
          onDragOver={handleOutlineDragOver}
          onDragCancel={clearDragState}
          onDragEnd={finishOutlineDrag}
        >
          <div className={`chapter-scroll ${virtualizeTree ? "virtualized-tree" : ""}`}>
            <div className="tree-title"><span>章节</span><IconButton name="plus" label="新建章节" onClick={() => { const answer = window.prompt("章节标题", "未命名章节"); if (answer === null) return; const title = answer.trim().slice(0, 120) || "未命名章节"; const chapterId = studio.createChapter(title); const outlineId = studio.createOutline(chapterId); setExpanded((state) => ({ ...state, [chapterId]: true })); onOutline(outlineId); onNotice(`已创建章节「${title}」和第一条大纲`); }} /></div>
            {groups.map((group) => (
              <div className="chapter-group" key={group.id}>
                <DesktopChapterDropRow chapterId={group.id} className={`chapter-row ${view === "chapter" && group.id === studio.currentChapter.id ? "active" : ""}`}>
                  <button className={`disclosure ${expanded[group.id] ? "expanded" : ""}`} type="button" aria-label={`${expanded[group.id] ? "折叠" : "展开"}${group.title}`} onClick={() => setExpanded((state) => ({ ...state, [group.id]: !state[group.id] }))}><Icon name="chevron" /></button>
                  <button className="chapter-link" type="button" onDoubleClick={() => { const title = window.prompt("章节标题", group.title); if (title?.trim()) studio.updateChapter(group.id, { title: title.trim() }); }} onClick={() => { if (group.items[0]) studio.setCurrentOutline(group.items[0].id); onGo("chapter"); }}>{group.title}</button>
                  <IconButton name="plus" label={`在${group.title}中新建大纲`} className="chapter-outline-add" onClick={() => { const id = studio.createOutline(group.id); onOutline(id); }} />
                  <IconButton name="more" label={`${group.title}更多操作`} onClick={() => setChapterMenu(group)} />
                </DesktopChapterDropRow>
                {expanded[group.id] && <SortableContext items={group.items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                  {group.items.length === 0 ? <EmptyChapterDropZone chapterId={group.id} /> : virtualizeTree && group.items.length > 50 ? <VirtualList items={group.items} rowHeight={38} maxHeight={456} className="outline-list" renderItem={(item, _index, style) => (
                    <DesktopOutlineRow
                      key={item.id}
                      style={style}
                      item={item}
                      selected={currentOutline === item.id && (view === "write" || view === "chat" || view === "generate")}
                      dropPlacement={dropIndicator?.targetId === item.id ? dropIndicator.placement : undefined}
                      onOpen={() => onOutline(item.id)}
                      onMore={() => setOutlineMenu(item)}
                    />
                  )} /> : <div className="outline-list">{group.items.map((item) => (
                    <DesktopOutlineRow
                      key={item.id}
                      item={item}
                      selected={currentOutline === item.id && (view === "write" || view === "chat" || view === "generate")}
                      dropPlacement={dropIndicator?.targetId === item.id ? dropIndicator.placement : undefined}
                      onOpen={() => onOutline(item.id)}
                      onMore={() => setOutlineMenu(item)}
                    />
                  ))}</div>}
                </SortableContext>}
              </div>
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 140, easing: "ease" }}>
            {draggingOutline && <div className="desktop-outline-drag-overlay"><span className="outline-grip-dots" aria-hidden="true" /><span className="ui-title">{outlineDisplayTitle(draggingOutline)}</span></div>}
          </DragOverlay>
        </DndContext>

        <div className="sidebar-footer">
          <button className={view.startsWith("settings-") ? "active" : ""} type="button" aria-label="设置" title="设置" onClick={() => onGo("settings-general")}><Icon name="settings" /><span>设置</span></button>
          <button type="button" aria-label="AI 任务" title="AI 任务" onClick={onTask}><Icon name="tasks" /><span>AI 任务</span>{studio.data.tasks.some((task) => task.state === "waiting" || task.state === "running") && <span className="task-count-badge ui-emphasis">{studio.data.tasks.filter((task) => task.state === "waiting" || task.state === "running").length}</span>}</button>
        </div>
        <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" onPointerDown={startResize} />
      </aside>
      {outlineMenu && <DesktopOutlineMenu outline={outlineMenu} onClose={() => setOutlineMenu(null)} onSettings={() => { setOutlineSettingsId(outlineMenu.id); setOutlineMenu(null); }} onOpenChat={() => { studio.setCurrentOutline(outlineMenu.id); setOutlineMenu(null); onOutline(outlineMenu.id); onGo("chat"); }} onGenerate={() => { setStructureGenerate({ kind: "outline", id: outlineMenu.id, title: outlineDisplayTitle(outlineMenu) }); setOutlineMenu(null); }} onNotice={onNotice} />}
      {chapterMenu && <ChapterActionSheet chapter={chapterMenu} onClose={() => setChapterMenu(null)} onNotice={onNotice} onOpenOutline={onOutline} onSettings={() => setChapterSettingsId(chapterMenu.id)} />}
      {chapterSettingsId && <ChapterSettingsDrawer chapterId={chapterSettingsId} onClose={() => setChapterSettingsId(null)} />}
      {outlineSettingsId && <OutlineSettingsDrawer outlineId={outlineSettingsId} onClose={() => setOutlineSettingsId(null)} />}
      {structureGenerate && <StructureGenerateSheet target={structureGenerate} onClose={() => setStructureGenerate(null)} onApplied={(message, result, generatedTitle) => { studio.updateOutline(structureGenerate.id, { plan: result, ...(generatedTitle ? { title: generatedTitle, titleGenerationPending: false } : {}) }); onNotice(message); setStructureGenerate(null); }} />}
    </>
  );
}

function MobileArticleDrawer({ onClose, onGo, onNewArticle, onSelect }: {
  onClose: () => void;
  onGo: (view: "outline-edit" | "read" | "search" | "info-basic") => void;
  onNewArticle: () => void;
  onSelect: (articleId: string) => void | Promise<void>;
}) {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const articles = studio.data.articles.filter((article) => !normalizedQuery || `${article.title}${article.summary}`.toLocaleLowerCase().includes(normalizedQuery));

  return <ScrollableDrawer
    scrollMode="content"
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭文章菜单" }}
    title="文章"
    position="bottom"
    size="min(82dvh, 680px)"
    classNames={{ content: "ws-drawer-content mobile-article-drawer", header: "ws-drawer-header", body: "mobile-article-drawer-body" }}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
  >
    <nav className="mobile-article-shortcuts" aria-label="文章功能">
      <button type="button" onClick={() => onGo("outline-edit")}><Icon name="edit" /><span>章节与大纲</span></button>
      <button type="button" onClick={() => onGo("read")}><Icon name="read" /><span>全文编辑</span></button>
      <button type="button" onClick={() => onGo("info-basic")}><Icon name="info" /><span>文章资料</span></button>
    </nav>
    <TextInput className="mobile-article-search" aria-label="搜索文章" placeholder="搜索文章" leftSection={<Icon name="search" />} value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="mobile-article-list" data-ui-overlay-scroll role="list" aria-label="文章列表">
      {articles.map((article) => <button className={article.id === studio.currentArticle.id ? "selected" : ""} type="button" role="listitem" aria-current={article.id === studio.currentArticle.id ? "true" : undefined} key={article.id} onClick={() => void onSelect(article.id)}>
        <span className="article-mark">{article.title[0]}</span>
        <span className="ui-title">{article.title}</span>
        {article.id === studio.currentArticle.id && <Icon name="check" />}
      </button>)}
      {!articles.length && <div className="empty-inline">没有匹配的文章</div>}
    </div>
    <div className="mobile-article-import-actions"><Button className="mobile-new-article" variant="default" fullWidth leftSection={<Icon name="plus" />} onClick={onNewArticle}>新建文章</Button><Button variant="default" fullWidth leftSection={<Icon name="paste" />} onClick={() => { onClose(); void transfer.importArticle(); }}>导入文章</Button></div>
  </ScrollableDrawer>;
}

function MobileOutlineHome({
  articleTitle,
  currentOutline,
  articleMenuOpen,
  onArticleMenu,
  onOutline,
  onChapter,
  onTask,
  onSettings,
  onNotice,
}: {
  articleTitle: string;
  currentOutline: string;
  articleMenuOpen: boolean;
  onArticleMenu: () => void;
  onOutline: (id: string, next?: "write" | "chat") => void;
  onChapter: () => void;
  onTask: () => void;
  onSettings: () => void;
  onNotice: (message: string) => void;
}) {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const groups = studio.currentArticle.chapters
    .filter((chapter) => studio.data.settings.showArchived || !chapter.archived)
    .map((chapter) => ({ ...chapter, items: chapter.outlines.filter((item) => studio.data.settings.showArchived || !item.archived) }));
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    if (typeof window !== "undefined") {
      try { const stored = window.localStorage.getItem(`writer-studio:expanded-mobile:${studio.currentArticle.id}`); if (stored) return JSON.parse(stored) as Record<string, boolean>; }
      catch { /* Use mobile article defaults when saved UI state is invalid. */ }
    }
    return Object.fromEntries(studio.currentArticle.chapters.map((chapter) => [chapter.id, !chapter.archived]));
  });
  const [actionTarget, setActionTarget] = useState<Pick<Outline, "id" | "title" | "plan" | "archived"> | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string; title: string; plan: string } | null>(null);
  const [structureGenerate, setStructureGenerate] = useState<{ kind: "outline" | "chapter"; id: string; title: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<OutlineDropIndicator>(null);
  const [chapterMenu, setChapterMenu] = useState<Chapter | null>(null);
  const [chapterSettingsId, setChapterSettingsId] = useState<string | null>(null);
  const [outlineSettingsId, setOutlineSettingsId] = useState<string | null>(null);
  const expandTimer = useRef<number | null>(null);
  const expandTarget = useRef<string | null>(null);
  const virtualizeTree = groups.reduce((total, group) => total + group.items.length, 0) > 200;
  const totalWords = groups.reduce((total, group) => total + group.items.reduce((chapterTotal, item) => chapterTotal + wordCount(resolvedOutlineContent(item)), 0), 0);
  const draggingOutline = groups.flatMap((group) => group.items).find((item) => item.id === draggingId);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 420, tolerance: 10 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => { window.localStorage.setItem(`writer-studio:expanded-mobile:${studio.currentArticle.id}`, JSON.stringify(expanded)); }, [expanded, studio.currentArticle.id]);
  useEffect(() => () => { if (expandTimer.current !== null) window.clearTimeout(expandTimer.current); }, []);

  function act(message: string) {
    onNotice(message);
    setActionTarget(null);
  }

  function clearDragState() {
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    expandTimer.current = null;
    expandTarget.current = null;
    setDraggingId(null);
    setDropIndicator(null);
  }

  function handleOutlineDragOver(event: DragOverEvent) {
    const targetId = event.over ? String(event.over.id) : "";
    const targetType = event.over?.data.current?.type;
    const orderedIds = groups.flatMap((group) => group.items.map((item) => item.id));
    setDropIndicator(targetType === "outline" && targetId !== String(event.active.id) ? { targetId, placement: outlineDropPlacement(event, orderedIds) } : null);

    const chapterId = targetType === "chapter" ? String(event.over?.data.current?.chapterId ?? "") : "";
    if (!chapterId || expanded[chapterId]) {
      if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
      expandTimer.current = null;
      expandTarget.current = null;
      return;
    }
    if (expandTarget.current === chapterId) return;
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    expandTarget.current = chapterId;
    expandTimer.current = window.setTimeout(() => {
      setExpanded((state) => ({ ...state, [chapterId]: true }));
      expandTimer.current = null;
      expandTarget.current = null;
    }, 500);
  }

  function finishOutlineDrag(event: DragEndEvent) {
    const sourceId = String(event.active.id);
    const targetId = event.over ? String(event.over.id) : "";
    const targetType = event.over?.data.current?.type;
    const chapterId = targetType === "chapter" ? String(event.over?.data.current?.chapterId ?? "") : "";
    const source = groups.flatMap((group) => group.items).find((item) => item.id === sourceId);
    clearDragState();
    if (!source) return;
    if (chapterId) {
      studio.moveOutlineToChapter(sourceId, chapterId);
      const chapter = groups.find((group) => group.id === chapterId);
      onNotice(chapter ? `已将「${outlineDisplayTitle(source)}」移到「${chapter.title}」末尾` : `已移动「${outlineDisplayTitle(source)}」`);
      return;
    }
    if (!targetId || sourceId === targetId || targetType !== "outline") return;
    const orderedIds = groups.flatMap((group) => group.items.map((item) => item.id));
    const placement = dropIndicator?.targetId === targetId ? dropIndicator.placement : outlineDropPlacement(event, orderedIds);
    studio.moveOutline(sourceId, targetId, placement);
    onNotice(`已移动「${outlineDisplayTitle(source)}」`);
  }

  const actionGroup = actionTarget ? groups.find((group) => group.items.some((item) => item.id === actionTarget.id)) : undefined;
  const actionIndex = actionTarget && actionGroup ? actionGroup.items.findIndex((item) => item.id === actionTarget.id) : -1;
  const previousActionOutline = actionGroup && actionIndex > 0 ? actionGroup.items[actionIndex - 1] : undefined;
  const nextActionOutline = actionGroup && actionIndex >= 0 && actionIndex < actionGroup.items.length - 1 ? actionGroup.items[actionIndex + 1] : undefined;

  return (
    <div className="mobile-outline-home">
      <header className="mobile-outline-header">
        <button className="mobile-article-title" type="button" aria-label={`切换文章，当前 ${articleTitle}`} aria-haspopup="dialog" aria-expanded={articleMenuOpen} onClick={onArticleMenu}>
          <span className="article-mark">{articleTitle[0]}</span>
          <span><span className="ui-title">{articleTitle}</span></span>
          <Icon name="chevron" />
        </button>
        <IconButton name="tasks" label="AI 任务" variant="glass" size="large" className="mobile-header-action" badge={studio.data.tasks.filter((task) => task.state === "waiting" || task.state === "running").length || undefined} onClick={onTask} />
        <IconButton name="settings" label="设置" variant="glass" size="large" className="mobile-header-action" onClick={onSettings} />
      </header>

      <div className="mobile-outline-scroll">
        <section className="mobile-outline-intro">
          <div><h1>大纲</h1><p>{groups.length} 章 · {groups.reduce((total, group) => total + group.items.length, 0)} 条大纲 · {totalWords.toLocaleString("zh-CN")} 字</p></div>
          <div className="mobile-outline-intro-actions">
            <button
              className={`mobile-archive-switch ${studio.data.settings.showArchived ? "checked" : ""}`}
              type="button"
              role="switch"
              aria-label="显示归档大纲"
              aria-checked={studio.data.settings.showArchived}
              onClick={() => studio.updateSettings({ showArchived: !studio.data.settings.showArchived })}
            >
              <span>显示归档</span>
              <span className="mobile-archive-switch-track" aria-hidden="true"><span /></span>
            </button>
          </div>
        </section>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          autoScroll={{ acceleration: 10, threshold: { x: 0.15, y: 0.15 } }}
          onDragStart={(event) => setDraggingId(String(event.active.id))}
          onDragOver={handleOutlineDragOver}
          onDragCancel={clearDragState}
          onDragEnd={finishOutlineDrag}
        >
          <div className={`mobile-chapter-list ${virtualizeTree ? "virtualized-tree" : ""}`}>
            {groups.map((group, groupIndex) => (
              <section className="mobile-chapter-card" key={group.id}>
              <MobileChapterDropHeader chapterId={group.id}>
                <button className={`mobile-disclosure ${expanded[group.id] ? "expanded" : ""}`} type="button" aria-label={`${expanded[group.id] ? "折叠" : "展开"}${group.title}`} aria-expanded={expanded[group.id]} onClick={() => setExpanded((state) => ({ ...state, [group.id]: !state[group.id] }))}><Icon name="chevron" /></button>
                <button className="mobile-chapter-title" type="button" onClick={() => { if (group.items[0]) studio.setCurrentOutline(group.items[0].id); onChapter(); }}><span>第 {groupIndex + 1} 章</span><span className="ui-title">{group.title.replace(/^第.+?·\s*/, "")}</span></button>
                <span className="chapter-count">{group.items.length}</span>
                <IconButton name="plus" label={`在${group.title}中新建大纲`} className="chapter-outline-add" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); const id = studio.createOutline(group.id); onOutline(id); }} />
                <IconButton name="more" label={`${group.title}更多操作`} className="mobile-row-more" aria-haspopup="dialog" aria-expanded={chapterMenu?.id === group.id} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setChapterMenu(group); }} />
              </MobileChapterDropHeader>
                {expanded[group.id] && <SortableContext items={group.items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                  {group.items.length === 0 ? <EmptyChapterDropZone chapterId={group.id} mobile /> : virtualizeTree && group.items.length > 50 ? <VirtualList items={group.items} rowHeight={61} maxHeight={549} className="mobile-outline-items" renderItem={(item, index, style) => (
                    <MobileOutlineRow
                      key={item.id}
                      style={style}
                      item={item}
                      index={index}
                      selected={item.id === currentOutline}
                      menuOpen={actionTarget?.id === item.id}
                      dropPlacement={dropIndicator?.targetId === item.id ? dropIndicator.placement : undefined}
                      onOpen={() => onOutline(item.id)}
                      onAdd={() => { studio.createOutline(group.id, item.id); onNotice(`已在「${outlineDisplayTitle(item)}」下方新建大纲`); }}
                      onToggleArchive={() => { studio.updateOutline(item.id, { archived: !item.archived }); onNotice(item.archived ? `已恢复「${outlineDisplayTitle(item)}」` : `已归档「${outlineDisplayTitle(item)}」`); }}
                      onMore={() => setActionTarget(item)}
                    />
                  )} /> : <div className="mobile-outline-items">{group.items.map((item, index) => (
                    <MobileOutlineRow
                      key={item.id}
                      item={item}
                      index={index}
                      selected={item.id === currentOutline}
                      menuOpen={actionTarget?.id === item.id}
                      dropPlacement={dropIndicator?.targetId === item.id ? dropIndicator.placement : undefined}
                      onOpen={() => onOutline(item.id)}
                      onAdd={() => { studio.createOutline(group.id, item.id); onNotice(`已在「${outlineDisplayTitle(item)}」下方新建大纲`); }}
                      onToggleArchive={() => { studio.updateOutline(item.id, { archived: !item.archived }); onNotice(item.archived ? `已恢复「${outlineDisplayTitle(item)}」` : `已归档「${outlineDisplayTitle(item)}」`); }}
                      onMore={() => setActionTarget(item)}
                    />
                  ))}</div>}
                </SortableContext>}
              </section>
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 160, easing: "ease" }}>
            {draggingOutline && <div className="mobile-outline-drag-overlay"><span className="outline-number">↕</span><span className="ui-title">{outlineDisplayTitle(draggingOutline)}</span></div>}
          </DragOverlay>
        </DndContext>

      </div>

      {actionTarget && <OutlineActionSheet
        title={outlineDisplayTitle(actionTarget)}
        archived={actionTarget.archived}
        onClose={() => setActionTarget(null)}
        onSettings={() => { setOutlineSettingsId(actionTarget.id); setActionTarget(null); }}
        onEdit={() => {
          const selected = groups.flatMap((group) => group.items).find((item) => item.id === actionTarget.id);
          setEditTarget({ id: actionTarget.id, title: normalizeOutlineTitle(actionTarget.title), plan: selected?.plan ?? "" });
          setActionTarget(null);
        }}
        onGenerate={() => {
          setStructureGenerate({ kind: "outline", id: actionTarget.id, title: outlineDisplayTitle(actionTarget) });
          setActionTarget(null);
        }}
        onChat={() => {
          onOutline(actionTarget.id, "chat");
          setActionTarget(null);
        }}
        onMove={() => {
          const options = groups.map((group, index) => `${index + 1}. ${group.title}`).join("\n");
          const answer = window.prompt(`移动到哪个章节？\n${options}`, "1");
          const target = groups[Number(answer) - 1];
          if (target) { studio.moveOutlineToChapter(actionTarget.id, target.id); act(`已移动到「${target.title}」`); }
        }}
        onMoveUp={previousActionOutline ? () => { studio.moveOutline(actionTarget.id, previousActionOutline.id, "before"); act(`已上移「${outlineDisplayTitle(actionTarget)}」`); } : undefined}
        onMoveDown={nextActionOutline ? () => { studio.moveOutline(actionTarget.id, nextActionOutline.id, "after"); act(`已下移「${outlineDisplayTitle(actionTarget)}」`); } : undefined}
        onArchive={() => { studio.updateOutline(actionTarget.id, { archived: !actionTarget.archived }); act(actionTarget.archived ? `已恢复「${outlineDisplayTitle(actionTarget)}」` : `已归档「${outlineDisplayTitle(actionTarget)}」`); }}
        onDelete={() => {
          const displayTitle = outlineDisplayTitle(actionTarget);
          if (window.confirm(`删除大纲「${displayTitle}」？对应正文、版本和 AI Chat 也会删除。`)) { studio.deleteOutline(actionTarget.id); act(`已删除「${displayTitle}」`); }
        }}
        onCopy={() => {
          const source = actionTarget;
          studio.copyOutline(source.id);
          act(`已复制大纲标题与内容并放在当前大纲下方；正文和版本未复制`);
        }}
        onExport={() => {
          const selected = groups.flatMap((group) => group.items).find((item) => item.id === actionTarget.id);
          if (selected) transfer.exportOutline(selected);
          setActionTarget(null);
        }}
      />}
      {editTarget && <OutlineEditSheet target={editTarget} onClose={() => setEditTarget(null)} onSave={(title, plan) => {
        const normalizedTitle = normalizeOutlineTitle(title);
        studio.updateOutline(editTarget.id, { title: normalizedTitle, plan });
        onNotice(`已更新大纲「${outlineDisplayTitle({ title: normalizedTitle, plan })}」；正文和版本保持不变`);
        setEditTarget(null);
      }} />}
      {structureGenerate && <StructureGenerateSheet target={structureGenerate} onClose={() => setStructureGenerate(null)} onApplied={(message, result, generatedTitle) => {
        studio.updateOutline(structureGenerate.id, { plan: result, ...(generatedTitle ? { title: generatedTitle, titleGenerationPending: false } : {}) });
        onNotice(message);
        setStructureGenerate(null);
      }} />}
      {chapterMenu && <ChapterActionSheet chapter={chapterMenu} onClose={() => setChapterMenu(null)} onNotice={onNotice} onOpenOutline={onOutline} onSettings={() => setChapterSettingsId(chapterMenu.id)} />}
      {chapterSettingsId && <ChapterSettingsDrawer chapterId={chapterSettingsId} onClose={() => setChapterSettingsId(null)} />}
      {outlineSettingsId && <OutlineSettingsDrawer outlineId={outlineSettingsId} onClose={() => setOutlineSettingsId(null)} />}
    </div>
  );
}

function useHorizontalSwipe({
  disabled = false,
  ignoreSelector,
  threshold = 46,
  onSwipeLeft,
  onSwipeRight,
}: {
  disabled?: boolean;
  ignoreSelector?: string;
  threshold?: number;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}) {
  const trackedPointerId = useRef<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const horizontal = useRef(false);
  const suppressClick = useRef(false);
  const suppressionTimer = useRef<number | null>(null);
  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);

  useEffect(() => {
    onSwipeLeftRef.current = onSwipeLeft;
    onSwipeRightRef.current = onSwipeRight;
  }, [onSwipeLeft, onSwipeRight]);

  const clearSuppressionTimer = useCallback(() => {
    if (suppressionTimer.current === null) return;
    window.clearTimeout(suppressionTimer.current);
    suppressionTimer.current = null;
  }, []);

  const allowActionClick = useCallback(() => {
    clearSuppressionTimer();
    suppressClick.current = false;
  }, [clearSuppressionTimer]);

  const suppressClicksFor = useCallback((duration = 260) => {
    clearSuppressionTimer();
    suppressClick.current = true;
    suppressionTimer.current = window.setTimeout(() => {
      suppressClick.current = false;
      suppressionTimer.current = null;
    }, duration);
  }, [clearSuppressionTimer]);

  const cancelGesture = useCallback(() => {
    trackedPointerId.current = null;
    horizontal.current = false;
  }, []);

  useEffect(() => () => clearSuppressionTimer(), [clearSuppressionTimer]);
  useEffect(() => {
    if (disabled) cancelGesture();
  }, [cancelGesture, disabled]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as Element | null;
    if (disabled || !event.isPrimary || (event.pointerType !== "touch" && event.pointerType !== "pen") || (ignoreSelector && target?.closest(ignoreSelector))) {
      cancelGesture();
      allowActionClick();
      return;
    }
    trackedPointerId.current = event.pointerId;
    startX.current = event.clientX;
    startY.current = event.clientY;
    horizontal.current = false;
    allowActionClick();
  }, [allowActionClick, cancelGesture, disabled, ignoreSelector]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (trackedPointerId.current !== event.pointerId) return;
    const deltaX = event.clientX - startX.current;
    const deltaY = event.clientY - startY.current;
    if (Math.abs(deltaX) <= 12 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    horizontal.current = true;
    suppressClicksFor();
    event.preventDefault();
  }, [suppressClicksFor]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (trackedPointerId.current !== event.pointerId) return;
    const deltaX = event.clientX - startX.current;
    const deltaY = event.clientY - startY.current;
    const completedSwipe = horizontal.current && Math.abs(deltaX) > threshold && Math.abs(deltaX) > Math.abs(deltaY);
    cancelGesture();
    if (!completedSwipe) {
      allowActionClick();
      return;
    }
    suppressClicksFor();
    if (deltaX < 0) onSwipeLeftRef.current();
    else onSwipeRightRef.current();
  }, [allowActionClick, cancelGesture, suppressClicksFor, threshold]);

  const onPointerCancel = useCallback(() => {
    cancelGesture();
    allowActionClick();
  }, [allowActionClick, cancelGesture]);

  const onClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as Element | null;
    if (ignoreSelector && target?.closest(ignoreSelector)) {
      allowActionClick();
      return;
    }
    if (!suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, [allowActionClick, ignoreSelector]);

  const handlers = useMemo(() => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel }), [onPointerCancel, onPointerDown, onPointerMove, onPointerUp]);
  return useMemo(() => ({ handlers, onClickCapture, allowActionClick, suppressClicksFor, cancelGesture }), [allowActionClick, cancelGesture, handlers, onClickCapture, suppressClicksFor]);
}

function MobileOutlineRow({
  style,
  item,
  index,
  selected,
  menuOpen,
  dropPlacement,
  onOpen,
  onAdd,
  onToggleArchive,
  onMore,
}: {
  style?: CSSProperties;
  item: Pick<Outline, "id" | "title" | "plan" | "state" | "archived">;
  index: number;
  selected: boolean;
  menuOpen: boolean;
  dropPlacement?: OutlineDropPlacement;
  onOpen: () => void;
  onAdd: () => void;
  onToggleArchive: () => void;
  onMore: () => void;
}) {
  const displayTitle = outlineDisplayTitle(item);
  const [reveal, setReveal] = useState<"left" | "right" | null>(null);
  const wasDragging = useRef(false);
  const handledSwipePointer = useRef(false);
  const handledSwipePointerTimer = useRef<number | null>(null);
  const pendingSwipeActionTimer = useRef<number | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, data: { type: "outline", outlineId: item.id } });
  const swipe = useHorizontalSwipe({
    disabled: isDragging,
    ignoreSelector: ".icon-button, .swipe-action",
    onSwipeLeft: () => setReveal("left"),
    onSwipeRight: () => setReveal("right"),
  });

  useEffect(() => {
    if (isDragging) {
      wasDragging.current = true;
      swipe.cancelGesture();
      swipe.suppressClicksFor(400);
      navigator.vibrate?.(12);
      return;
    }
    if (!wasDragging.current) return;
    const timeout = window.setTimeout(() => {
      wasDragging.current = false;
      swipe.allowActionClick();
      setReveal(null);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [isDragging, swipe]);
  useEffect(() => () => {
    if (handledSwipePointerTimer.current !== null) window.clearTimeout(handledSwipePointerTimer.current);
    if (pendingSwipeActionTimer.current !== null) window.clearTimeout(pendingSwipeActionTimer.current);
  }, []);

  const sortableStyle: CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 3 : style?.zIndex,
  };

  function prepareSwipeAction() {
    swipe.allowActionClick();
  }

  function runSwipeAction(action: () => void) {
    swipe.allowActionClick();
    setReveal(null);
    action();
  }

  function runSwipeActionFromPointer(event: React.PointerEvent<HTMLButtonElement>, action: () => void) {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    event.preventDefault();
    event.stopPropagation();
    handledSwipePointer.current = true;
    if (handledSwipePointerTimer.current !== null) window.clearTimeout(handledSwipePointerTimer.current);
    handledSwipePointerTimer.current = window.setTimeout(() => {
      handledSwipePointer.current = false;
      handledSwipePointerTimer.current = null;
    }, 400);
    if (pendingSwipeActionTimer.current !== null) window.clearTimeout(pendingSwipeActionTimer.current);
    // Keep the touched button mounted until WebKit finishes its synthesized click;
    // removing the row during pointerup can retarget that click to the next row's menu.
    pendingSwipeActionTimer.current = window.setTimeout(() => {
      pendingSwipeActionTimer.current = null;
      runSwipeAction(action);
    }, 0);
  }

  function runSwipeActionFromClick(event: React.MouseEvent<HTMLButtonElement>, action: () => void) {
    event.stopPropagation();
    if (handledSwipePointer.current) {
      event.preventDefault();
      handledSwipePointer.current = false;
      return;
    }
    runSwipeAction(action);
  }

  return (
    <div ref={setNodeRef} style={sortableStyle} data-outline-id={item.id} aria-grabbed={isDragging} className={`mobile-outline-row-wrap ${reveal ? `reveal-${reveal}` : ""} ${selected ? "selected" : ""} ${item.archived ? "archived" : ""} ${isDragging ? "dragging" : ""} ${dropPlacement ? `drop-${dropPlacement}` : ""}`} {...swipe.handlers} onClickCapture={swipe.onClickCapture} onContextMenu={(event) => event.preventDefault()}>
      <div className="swipe-action swipe-add" aria-hidden={reveal !== "right"}><button type="button" tabIndex={reveal === "right" ? 0 : -1} aria-label={`在${displayTitle}下方新建大纲`} onPointerDown={prepareSwipeAction} onPointerUp={(event) => runSwipeActionFromPointer(event, onAdd)} onClick={(event) => runSwipeActionFromClick(event, onAdd)}><Icon name="plus" />下方新建</button></div>
      <div className={`swipe-action swipe-manage ${item.archived ? "restore" : ""}`} aria-hidden={reveal !== "left"}><button type="button" tabIndex={reveal === "left" ? 0 : -1} aria-label={`${item.archived ? "恢复" : "归档"}大纲：${displayTitle}`} onPointerDown={prepareSwipeAction} onPointerUp={(event) => runSwipeActionFromPointer(event, onToggleArchive)} onClick={(event) => runSwipeActionFromClick(event, onToggleArchive)}><Icon name={item.archived ? "refresh" : "archive"} />{item.archived ? "恢复" : "归档"}</button></div>
      <div className="mobile-outline-row">
        <span className="outline-number">{String(index + 1).padStart(2, "0")}</span>
        <button className="mobile-outline-main" type="button" {...attributes} {...listeners} onClick={() => {
          if (reveal) setReveal(null);
          else onOpen();
        }}>
          <span className="ui-title">{displayTitle}</span>
          {item.state !== "saved" && <span>{item.state === "running" ? "AI Generate 运行中" : "生成失败"}</span>}
        </button>
        <OutlineTaskIndicator outlineId={item.id} fallback={item.state} />
        <IconButton name="more" label={`${displayTitle}更多操作`} className="mobile-row-more" aria-haspopup="dialog" aria-expanded={menuOpen} onPointerDown={() => swipe.allowActionClick()} onClick={(event) => { event.stopPropagation(); onMore(); }} />
      </div>
    </div>
  );
}

function OutlineActionSheet({ title, archived, onClose, onSettings, onEdit, onGenerate, onChat, onCopy, onExport, onMove, onMoveUp, onMoveDown, onArchive, onDelete }: { title: string; archived: boolean; onClose: () => void; onSettings: () => void; onEdit: () => void; onGenerate: () => void; onChat: () => void; onCopy: () => void; onExport: () => void; onMove: () => void; onMoveUp?: () => void; onMoveDown?: () => void; onArchive: () => void; onDelete: () => void }) {
  const definitions: Array<{ key: string; icon: IconName; label: string; danger?: boolean }> = [
    { key: "settings", icon: "info", label: "大纲设定" },
    { key: "edit", icon: "edit", label: "编辑大纲" },
    { key: "chat", icon: "chat", label: "AI Chat 大纲" },
    { key: "generate", icon: "spark", label: "AI Generate 大纲" },
    { key: "copy", icon: "copy", label: "复制大纲内容" },
    { key: "export", icon: "saveAs", label: "导出大纲" },
    ...(onMoveUp ? [{ key: "move-up", icon: "move" as IconName, label: "上移一位" }] : []),
    ...(onMoveDown ? [{ key: "move-down", icon: "move" as IconName, label: "下移一位" }] : []),
    { key: "move", icon: "move", label: "移动到章节" },
    { key: "archive", icon: archived ? "refresh" : "archive", label: archived ? "恢复" : "归档" },
    { key: "delete", icon: "trash", label: "删除大纲", danger: true },
  ];
  function handle(key: string) {
    if (key === "settings") onSettings();
    else if (key === "edit") onEdit();
    else if (key === "chat") onChat();
    else if (key === "generate") onGenerate();
    else if (key === "copy") onCopy();
    else if (key === "export") onExport();
    else if (key === "move-up") onMoveUp?.();
    else if (key === "move-down") onMoveDown?.();
    else if (key === "move") onMove();
    else if (key === "archive") onArchive();
    else if (key === "delete") onDelete();
  }
  const actions: ActionSheetItem[] = definitions.map((action) => ({
    ...action,
    className: action.key === "generate" ? "ai-structure-action" : action.key === "chat" ? "ai-chat-action" : "",
    icon: <Icon name={action.icon} />,
    onSelect: () => handle(action.key),
  }));
  return <MobileActionSheet
    actions={actions}
    ariaLabel={`大纲操作：${title}`}
    closeAfterSelect={false}
    closeLabel="关闭大纲操作"
    eyebrow="大纲操作"
    onClose={onClose}
    title={title}
    classNames={{ content: "outline-action-drawer", body: "outline-action-drawer-body" }}
  />;
}

function DesktopOutlineMenu({ outline, onClose, onSettings, onOpenChat, onGenerate, onNotice }: { outline: Outline; onClose: () => void; onSettings: () => void; onOpenChat: () => void; onGenerate: () => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const chapter = studio.currentArticle.chapters.find((item) => item.outlines.some((candidate) => candidate.id === outline.id));
  const displayTitle = outlineDisplayTitle(outline);
  const outlineIndex = chapter?.outlines.findIndex((item) => item.id === outline.id) ?? -1;
  const previousOutline = outlineIndex > 0 ? chapter?.outlines[outlineIndex - 1] : undefined;
  const nextOutline = chapter && outlineIndex >= 0 && outlineIndex < chapter.outlines.length - 1 ? chapter.outlines[outlineIndex + 1] : undefined;
  const items: Array<[string, () => void]> = [
    [`大纲设定${countOutlineSettingChanges(outline.settings) ? ` · ${countOutlineSettingChanges(outline.settings)}` : ""}`, onSettings],
    ["编辑大纲", () => {
      const title = window.prompt("大纲标题", normalizeOutlineTitle(outline.title));
      if (title === null) return;
      const plan = window.prompt("大纲内容", outline.plan);
      if (plan === null) return;
      studio.updateOutline(outline.id, { title: normalizeOutlineTitle(title), plan });
      onNotice("大纲已更新");
    }],
    ["AI Chat 大纲", onOpenChat],
    ["AI Generate 大纲", onGenerate],
    ["在下方新建", () => { if (chapter) studio.createOutline(chapter.id, outline.id); onNotice("已新建大纲"); }],
    ["复制大纲内容", () => { studio.copyOutline(outline.id); onNotice("已在下方复制大纲内容"); }],
    ["导出大纲", () => transfer.exportOutline(outline)],
    ...(previousOutline ? [["上移一位", () => { studio.moveOutline(outline.id, previousOutline.id, "before"); onNotice(`已上移「${displayTitle}」`); }] as [string, () => void]] : []),
    ...(nextOutline ? [["下移一位", () => { studio.moveOutline(outline.id, nextOutline.id, "after"); onNotice(`已下移「${displayTitle}」`); }] as [string, () => void]] : []),
    ["移动到章节", () => {
      const answer = window.prompt(studio.currentArticle.chapters.map((item, index) => `${index + 1}. ${item.title}`).join("\n"), "1");
      const target = studio.currentArticle.chapters[Number(answer) - 1];
      if (target) { studio.moveOutlineToChapter(outline.id, target.id); onNotice(`已移动到「${target.title}」`); }
    }],
    [outline.archived ? "恢复" : "归档", () => { studio.updateOutline(outline.id, { archived: !outline.archived }); onNotice(outline.archived ? "大纲已恢复" : "大纲已归档"); }],
  ];
  const actions: ActionSheetItem[] = [
    ...items.map(([label, action]) => ({ key: label, label, onSelect: action })),
    { key: "delete", label: "删除大纲", danger: true, onSelect: () => { if (window.confirm(`删除「${displayTitle}」及其正文、版本和聊天？`)) { studio.deleteOutline(outline.id); onNotice("大纲已删除"); } } },
  ];
  return <MobileActionSheet actions={actions} ariaLabel={`大纲操作：${displayTitle}`} closeLabel="关闭大纲菜单" eyebrow="大纲操作" onClose={onClose} responsiveDesktopMenu title={displayTitle} />;
}

function ChapterActionSheet({ chapter, onClose, onNotice, onOpenOutline, onSettings }: { chapter: Chapter; onClose: () => void; onNotice: (message: string) => void; onOpenOutline: (id: string) => void; onSettings: () => void }) {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const models = useConfiguredModels();
  const items: Array<{ key: string; label: string; icon: IconName; className?: string; disabled?: boolean; onSelect: () => void }> = [
    { key: "rename", label: "重命名", icon: "edit", onSelect: () => { const title = window.prompt("章节标题", chapter.title); if (title?.trim()) { studio.updateChapter(chapter.id, { title: title.trim().slice(0, 120) }); onNotice("章节已重命名"); } } },
    { key: "settings", label: `章节设定${countChapterSettingChanges(chapter.settings) ? ` · ${countChapterSettingChanges(chapter.settings)}` : ""}`, icon: "info", onSelect: onSettings },
    { key: "generate-names", label: "生成整章名称（含大纲）", icon: "spark", disabled: chapter.archived || !chapter.outlines.some((item) => !item.archived && item.plan.trim()), onSelect: () => {
      onNotice(`正在生成「${chapter.title}」的名称候选…`);
      void generateWholeChapterNameCandidates(studio, models, chapter)
        .then((added) => onNotice(added ? `已添加本章 ${added} 个名称候选；点击章节或大纲三点菜单左侧的图标选择` : "生成名称与已有版本相同"))
        .catch((error) => onNotice(error instanceof Error ? error.message : "整章名称生成失败"));
    } },
    { key: "create", label: "新建大纲", icon: "plus", onSelect: () => { const id = studio.createOutline(chapter.id); onOpenOutline(id); } },
    { key: "import", label: "导入大纲", icon: "paste", onSelect: () => { onClose(); void transfer.importOutline(chapter.id); } },
    { key: "move-up", label: "上移", icon: "move", onSelect: () => { studio.moveChapter(chapter.id, -1); onNotice("章节已上移，后续章节的继承设定已按新顺序重算"); } },
    { key: "move-down", label: "下移", icon: "move", onSelect: () => { studio.moveChapter(chapter.id, 1); onNotice("章节已下移，后续章节的继承设定已按新顺序重算"); } },
    { key: "archive", label: chapter.archived ? "恢复章节" : "归档章节", icon: chapter.archived ? "refresh" : "archive", onSelect: () => { studio.updateChapter(chapter.id, { archived: !chapter.archived }); onNotice(chapter.archived ? "章节已恢复，继承链已重算" : "章节已归档，继承链已跳过本章并重算"); } },
  ];
  const actions: ActionSheetItem[] = [
    ...items.map((item) => ({ ...item, icon: <Icon name={item.icon} /> })),
    { key: "delete", label: "删除章节", icon: <Icon name="trash" />, danger: true, onSelect: () => { const settingCount = countChapterSettingChanges(chapter.settings); if (chapterIsEmpty(chapter) && settingCount === 0) { studio.deleteChapter(chapter.id); onNotice("章节已删除，继承链已重算"); return; } const typed = window.prompt(`章节包含 ${chapter.outlines.length} 条大纲和 ${settingCount} 项章节设定。删除后，后续章节的继承会重算。输入章节标题以确认删除：`, ""); if (typed === chapter.title) { studio.deleteChapter(chapter.id); onNotice("章节已删除，继承链已重算"); } } },
  ];
  return <MobileActionSheet actions={actions} ariaLabel={`章节操作：${chapter.title}`} classNames={{ content: "outline-action-drawer", body: "outline-action-drawer-body" }} closeLabel="关闭章节菜单" eyebrow="章节操作" onClose={onClose} responsiveDesktopMenu title={chapter.title} />;
}

function OutlineEditSheet({ target, onClose, onSave }: { target: { id: string; title: string; plan: string }; onClose: () => void; onSave: (title: string, plan: string) => void }) {
  const [title, setTitle] = useState(target.title);
  const [plan, setPlan] = useState(target.plan);
  const automaticTitle = outlineDisplayTitle({ title: "", plan });
  return <ScrollableDrawer
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭编辑大纲" }}
    title="编辑大纲"
    position="bottom"
    size="auto"
    classNames={{ content: "ws-drawer-content outline-edit-drawer", header: "ws-drawer-header", body: "outline-edit-drawer-body" }}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
  >
    <Stack gap="md">
      <TextInput label="大纲标题" placeholder={automaticTitle} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
      <Textarea label="大纲内容" autosize minRows={5} maxRows={12} value={plan} onChange={(event) => setPlan(event.target.value)} />
      <Group justify="flex-end"><Button variant="default" type="button" onClick={onClose}>取消</Button><Button type="button" onClick={() => onSave(title.trim(), plan.trim())}>保存大纲</Button></Group>
    </Stack>
  </ScrollableDrawer>;
}

function StructureGenerateSheet({ target, onClose, onApplied }: { target: { kind: "outline" | "chapter"; id: string; title: string }; onClose: () => void; onApplied: (message: string, result: string, generatedTitle?: string) => void }) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const [prompt, setPrompt] = useState("");
  const [generated, setGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isChapter = target.kind === "chapter";
  const [result, setResult] = useState("");
  const [generatedSourceText, setGeneratedSourceText] = useState("");
  const [generatedOutlineTitle, setGeneratedOutlineTitle] = useState("");
  const selectedModel = studio.data.settings.generateModel;
  const reasoningEffort = studio.data.settings.generateReasoningEffort;
  const selectedModelReference = canonicalModelReference(models, selectedModel);
  const targetChapter = studio.currentArticle.chapters.find((chapter) => isChapter ? chapter.id === target.id : chapter.outlines.some((outline) => outline.id === target.id));
  const targetOutline = isChapter ? targetChapter?.outlines.find((outline) => !outline.archived) : targetChapter?.outlines.find((outline) => outline.id === target.id);
  const currentValue = isChapter ? targetChapter?.title ?? target.title : targetOutline?.plan ?? "";
  const contextSummary = targetChapter && targetOutline ? generateContextSummary(studio.currentArticle, targetOutline, prompt, true, true, isChapter ? "chapter-title" : "outline") : null;
  function selectGenerateModel(model: string) {
    studio.updateSettings({ generateModel: model });
    void studio.saveNow();
  }
  async function generate() {
    const outlineId = targetOutline?.id;
    if (!outlineId) { setError("该章节还没有可用大纲"); return; }
    setLoading(true); setError("");
    try {
      const context = selectAiContext({ articles: [studio.currentArticle] }, outlineId, isChapter ? "chapter-title" : "outline", { includePrevious: true, includeCharacters: true, instruction: prompt });
      const response = await fetchServerAction("/api/ai/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outlineId, instruction: prompt.trim(), model: selectedModelReference, reasoningEffort, target: isChapter ? "chapter-title" : "outline", includePrevious: true, includeCharacters: true, context }) });
      const payload = await response.json() as { text?: string; outlineTitle?: string; error?: string };
      if (!response.ok || !payload.text) throw new Error(payload.error || "生成失败");
      setResult(payload.text);
      setGeneratedSourceText(payload.text.trim());
      setGeneratedOutlineTitle(normalizeOutlineTitle(payload.outlineTitle));
      setGenerated(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "生成失败"); }
    finally { setLoading(false); }
  }
  return <ScrollableDrawer
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭结构生成" }}
    title={<div className="structure-generate-drawer-title"><div className="structure-generate-icon"><Icon name="spark" /></div><div><span className="ui-title">{isChapter ? "AI Generate 章节名" : "AI Generate 大纲"}</span><small>{target.title}</small></div></div>}
    position="bottom"
    size="auto"
    classNames={{ content: "structure-generate-drawer", body: "structure-generate-sheet structure-generate-drawer-body" }}
  >
    <div className="structure-context"><Icon name="book" /><span className="ui-label">上下文 · {contextSummary?.total.toLocaleString("zh-CN") ?? "—"} 字符</span></div>
    <section className="structure-current"><span className="ui-label">{isChapter ? "当前章节标题" : "当前大纲内容"}</span><p>{currentValue || "（当前内容为空）"}</p></section>
    <div className="structure-request-grid">
      <label className="structure-requirement">生成要求<textarea maxLength={20000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入生成要求" /></label>
      <label className="structure-model">本次模型<select value={selectedModelReference} onChange={(event) => selectGenerateModel(event.target.value)}><option value="">本地演示引擎</option>{selectedModelReference && !configuredModelForReference(models, selectedModelReference) && <option value={selectedModelReference}>{selectedModelReference}</option>}{models.map((model) => <option value={model.id} key={model.id}>{modelDisplayLabel(models, model.id)}{model.hasSecret ? "" : "（需密钥）"}</option>)}</select></label>
      <div className="structure-reasoning"><TaskReasoningSettings kind="generate" model={configuredModelForReference(models, selectedModelReference)} disabled={loading} /></div>
    </div>
    {error && <p className="task-error" role="alert">{error}</p>}
    {generated && <div className="structure-compare"><section><span>当前内容</span><p>{currentValue || "（空）"}</p></section><section><span>生成预览</span>{isChapter ? <input value={result} onChange={(event) => setResult(event.target.value)} /> : <textarea value={result} onChange={(event) => setResult(event.target.value)} />}</section></div>}
    <footer><button className="secondary-button" type="button" onClick={onClose}>取消</button>{generated ? <><button className="secondary-button" type="button" onClick={() => void generate()}>重新生成</button><button className="primary-compact" type="button" disabled={!result.trim()} onClick={() => onApplied(isChapter ? "已应用新的章节标题" : `已应用「${target.title}」的大纲内容`, result.trim(), !isChapter && result.trim() === generatedSourceText ? generatedOutlineTitle : undefined)}>应用结果</button></> : <button className="primary-compact" type="button" disabled={!prompt.trim() || loading} onClick={() => void generate()}><Icon name="spark" />{loading ? "正在生成…" : "生成预览"}</button>}</footer>
  </ScrollableDrawer>;
}

type NameGeneratePreview = {
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

async function storeNameCandidates(studio: ReturnType<typeof useStudio>, articleId: string, chapterId: string, payload: NameGeneratePreview) {
  if (payload.revision === undefined || payload.added === undefined) throw new Error("名称已经生成，但服务端没有返回保存结果");
  const outlineStates = new Map((payload.outlineStates ?? []).map((item) => [item.id, item]));
  studio.acceptServerMutation(payload.revision, (current) => ({
    ...current,
    articles: current.articles.map((item) => item.id !== articleId ? item : ({
      ...item,
      updatedAt: payload.articleUpdatedAt ?? item.updatedAt,
      chapters: item.chapters.map((candidate) => candidate.id !== chapterId ? candidate : ({
        ...candidate,
        ...(payload.chapterState ?? {}),
        outlines: candidate.outlines.map((currentOutline) => {
          const state = outlineStates.get(currentOutline.id);
          return state ? { ...currentOutline, ...state } : currentOutline;
        }),
      })),
    })),
  }));
  return payload.added;
}

async function generateWholeChapterNameCandidates(studio: ReturnType<typeof useStudio>, models: ConfiguredModel[], chapter: Chapter) {
  const article = studio.currentArticle;
  const outlines = chapter.outlines.filter((item) => !item.archived && item.plan.trim());
  if (chapter.archived || !outlines.length) throw new Error(`「${chapter.title}」没有可供命名的大纲内容`);
  if (studio.data.tasks.some((task) => task.articleId === article.id && task.target === "全部名称" && (task.state === "waiting" || task.state === "running"))) throw new Error("整篇名称任务正在运行，请完成后再生成本章名称");
  const settings = studio.data.settings;
  const model = canonicalModelReference(models, settings.namingModelMode === "inherit" ? settings.generateModel : settings.namingModel);
  const selectedRecord = configuredModelForReference(models, model);
  if (selectedRecord && !selectedRecord.hasSecret) throw new Error("所选模型还没有载入 API 密钥");
  const response = await fetchServerAction("/api/ai/names", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      articleId: article.id,
      chapterId: chapter.id,
      target: "chapter",
      includeChapter: true,
      outlineIds: outlines.map((item) => item.id),
      chapterNaming: article.chapterNaming,
      outlineNaming: article.outlineNaming,
      model,
      reasoningEffort: settings.namingReasoningEffort,
      modelLabel: modelDisplayLabel(models, model),
      instruction: "",
      context: namingArticleContext(article),
      persist: true,
    }),
  });
  const payload = await response.json() as NameGeneratePreview & { error?: string };
  if (!response.ok) throw new Error(payload.error || "整章名称生成失败");
  return storeNameCandidates(studio, article.id, chapter.id, payload);
}

function MobileHeader({ title, status, onBack, onVersions, showVersions, outlineId }: { title: string; status: string; onBack: () => void; onVersions: () => void; showVersions: boolean; outlineId?: string }) {
  return (
    <div className="mobile-header">
      <IconButton name="back" label="返回大纲" variant="glass" size="large" className="mobile-back-button" onClick={onBack} />
      <div><div className="mobile-header-title-line"><span className="ui-title">{title}</span>{outlineId && <OutlineTaskIndicator outlineId={outlineId} />}</div><span>{status}</span></div>
      {showVersions ? <IconButton name="versions" label="选择正文版本" variant="glass" size="large" onClick={onVersions} /> : <span className="mobile-header-placeholder" />}
    </div>
  );
}

function OutlineWorkspace({
  mode,
  outline,
  focusMode,
  onMode,
  onVersions,
  onFocus,
  onTaskCreated,
  onOpenTasks,
  onNotice,
  previewVersion,
  onOpenRewriteSource,
  onClearPreview,
  onWritingEditingChange,
}: {
  mode: "write" | "chat" | "generate";
  outline: { chapter: string; title: string; plan: string; content: string };
  focusMode: boolean;
  onMode: (view: View) => void;
  onVersions: () => void;
  onFocus: () => void;
  onTaskCreated: () => void;
  onOpenTasks: () => void;
  onNotice: (message: string) => void;
  previewVersion?: Version;
  onOpenRewriteSource: (sourceId: string) => void;
  onClearPreview: () => void;
  onWritingEditingChange: (editing: boolean) => void;
}) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const [moreOpen, setMoreOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateSeed, setGenerateSeed] = useState("");
  const displayTitle = outlineDisplayTitle(outline);
  const chatResultReady = mode !== "chat" && studio.currentOutline.chat.sessions.some(chatSessionHasUnread);
  useDismissOnOutside(moreOpen, () => setMoreOpen(false), ".workspace-more-trigger, .workspace-more-menu");

  async function saveAsCurrentContent() {
    const defaultName = `${resolvedOutlineContentName(studio.currentOutline)}-复制`;
    const name = window.prompt("另存为正文版本", defaultName);
    if (name === null) { setMoreOpen(false); return; }
    const versionName = name.trim() || defaultName;
    studio.saveVersion(studio.currentOutline.id, versionName, "手动", resolvedOutlineContent(studio.currentOutline));
    setMoreOpen(false);
    const saved = await studio.saveNow();
    onNotice(saved ? `已另存为「${versionName}」` : "另存为未完成，请查看保存状态");
  }

  return (
    <div className="workspace">
      <header className="workspace-header">
        {!focusMode ? (
          <div className="breadcrumb"><button type="button" onClick={() => { window.history.pushState({}, "", `/articles/${studio.currentArticle.id}/chapters/${studio.currentChapter.id}`); window.dispatchEvent(new PopStateEvent("popstate")); }}>{outline.chapter}</button><span>/</span><input value={normalizeOutlineTitle(outline.title)} placeholder={displayTitle} onChange={(event) => studio.updateOutline(studio.currentOutline.id, { title: event.target.value.slice(0, 80) })} aria-label="大纲标题" /><OutlineTaskIndicator outlineId={studio.currentOutline.id} fallback={studio.currentOutline.state} /></div>
        ) : <span className="ui-title">专注写作</span>}
        <div className="workspace-meta">
          <span className={`save-state ${studio.saveStatus}`}><i /> {saveStatusLabel(studio.saveStatus)}</span>
          {!focusMode && <button className="text-button" type="button" onClick={onVersions}><Icon name="versions" />版本</button>}
          <IconButton name={focusMode ? "close" : "focus"} label={focusMode ? "退出专注写作" : "专注写作"} onClick={onFocus} />
          {!focusMode && <IconButton name="more" label="更多操作" className="workspace-more-trigger" onClick={() => setMoreOpen((open) => !open)} />}
        </div>
      </header>

      {!focusMode && (
        <div className="mode-bar" role="tablist" aria-label="工作模式">
          <button className={mode === "write" ? "active" : ""} role="tab" aria-selected={mode === "write"} type="button" onClick={() => onMode("write")}>写作</button>
          <button className={mode === "chat" ? "active" : ""} role="tab" aria-selected={mode === "chat"} type="button" onClick={() => onMode("chat")}><span>AI Chat</span>{chatResultReady && <i className="chat-result-ready" title="AI Chat 已生成新回复" aria-label="有新生成的聊天回复" />}</button>
          <button className={mode === "generate" ? "active" : ""} role="tab" aria-selected={mode === "generate"} type="button" onClick={() => onMode("generate")}>AI Generate</button>
        </div>
      )}

      {mode === "write" && <WritingView focusMode={focusMode} previewVersion={previewVersion} onOpenRewriteSource={onOpenRewriteSource} onClearPreview={onClearPreview} onNotice={onNotice} onEditingChange={onWritingEditingChange} />}
      {mode === "chat" && <ChatView models={models} outlineTitle={displayTitle} onNotice={onNotice} onUseAsGenerate={(text) => { setGenerateSeed(text); void onMode("generate"); }} />}
      {mode === "generate" && <GenerateView key={studio.currentOutline.id} models={models} outline={outline} initialPrompt={generateSeed} onTaskCreated={onTaskCreated} onOpenTasks={onOpenTasks} />}
      {moreOpen && <div className="workspace-more-menu"><button type="button" onClick={() => { setSettingsOpen(true); setMoreOpen(false); }}>大纲设定{countOutlineSettingChanges(studio.currentOutline.settings) ? ` · ${countOutlineSettingChanges(studio.currentOutline.settings)}` : ""}</button><button type="button" onClick={() => { studio.saveVersion(studio.currentOutline.id, timestampContentName(), "手动", resolvedOutlineContent(studio.currentOutline)); setMoreOpen(false); }}>保存正文版本</button><button type="button" onClick={() => void saveAsCurrentContent()}>另存为正文版本</button><button type="button" onClick={() => { studio.updateOutline(studio.currentOutline.id, { archived: true }); setMoreOpen(false); }}>归档大纲</button><button className="danger" type="button" onClick={() => { if (window.confirm(`删除「${displayTitle}」？`)) studio.deleteOutline(studio.currentOutline.id); setMoreOpen(false); }}>删除大纲</button></div>}
      {settingsOpen && <OutlineSettingsDrawer outlineId={studio.currentOutline.id} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function WritingView({ focusMode, previewVersion, onOpenRewriteSource, onClearPreview, onNotice, onEditingChange }: { focusMode: boolean; previewVersion?: Version; onOpenRewriteSource: (sourceId: string) => void; onClearPreview: () => void; onNotice: (message: string) => void; onEditingChange: (editing: boolean) => void }) {
  const studio = useStudio();
  const [planOpen, setPlanOpen] = useState(studio.data.settings.outlineExpanded);
  const [planPeek, setPlanPeek] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editToolsOpen, setEditToolsOpen] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [settingExcellent, setSettingExcellent] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<{ left: number; top: number; start: number; end: number } | null>(null);
  const [illustrationSource, setIllustrationSource] = useState<{ content: string; excerpt: string; tab?: string } | null>(null);
  const writingScrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const pendingContentScrollRef = useRef<{ top: number; max: number; ratio: number } | null>(null);
  const pendingEditorCaretRef = useRef<number | null>(null);
  const selectionPointerActiveRef = useRef(false);
  const selectionMenuTimerRef = useRef<number | null>(null);
  const lastReaderTouchRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const lastTitleTouchRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const settingDefaultRef = useRef(false);
  const settingExcellentRef = useRef(false);
  const editingRef = useRef(false);
  const draftRef = useRef("");
  const baselineRef = useRef("");
  const draftSavedAtRef = useRef("");
  const preservingRef = useRef(false);
  const studioRef = useRef(studio);
  studioRef.current = studio;
  const editingOutlineId = studio.currentOutline.id;
  const currentVersion = currentOutlineVersion(studio.currentOutline);
  const displayedVersion = previewVersion ?? currentVersion;
  const displayedIsDirectContent = displayedVersion?.id === directContentId(studio.currentOutline.id);
  const displayedIsCurrent = !previewVersion
    || (displayedIsDirectContent ? studio.currentOutline.currentVersionId === null : previewVersion.id === studio.currentOutline.currentVersionId);
  const displayedIsDefault = Boolean(displayedVersion && displayedVersion.id === studio.currentOutline.defaultVersionId);
  const planSnapshot = displayedVersion?.outlineSnapshot ?? studio.currentOutline.contentOutlineSnapshot;
  const plan = planSnapshot?.plan ?? "";
  const displayedContent = previewVersion?.content ?? resolvedOutlineContent(studio.currentOutline);
  const displayedContentName = displayedVersion?.name ?? resolvedOutlineContentName(studio.currentOutline);
  const content = editing ? draftContent : displayedContent;
  const displayedFragments = displayedVersion
    ? normalizeExcellentFragments(displayedVersion.content, displayedVersion.excellentFragments)
    : normalizeExcellentFragments(displayedContent, studio.currentOutline.excellentFragments);
  const displayedManuallyExcellent = displayedVersion ? displayedVersion.manualExcellent === true : studio.currentOutline.manualExcellent === true;
  const displayedAutomaticallyExcellent = displayedFragments.length > 0;
  const displayedIsExcellent = displayedManuallyExcellent || displayedAutomaticallyExcellent;
  const selectedFragmentIsExcellent = Boolean(selectionMenu && displayedFragments.some((fragment) => selectionMenu.start >= fragment.start && selectionMenu.end <= fragment.end));

  useDismissOnOutside(Boolean(selectionMenu), () => setSelectionMenu(null), ".content-selection-menu");
  useDismissOnOutside(editToolsOpen, () => setEditToolsOpen(false), ".mobile-edit-more, .mobile-edit-overflow-menu");
  useWritingEditorViewport(writingScrollRef, editorRef, editing);

  useEffect(() => () => onEditingChange(false), [onEditingChange]);

  const showSelectionMenu = useCallback((point?: { x: number; y: number }) => {
    const reader = readerRef.current;
    if (!reader) return false;
    const selected = selectedRangeWithin(reader);
    const selection = window.getSelection();
    if (!selected || !selection?.rangeCount) return false;
    const bounds = selection.getRangeAt(0).getBoundingClientRect();
    const menuWidth = 124;
    const menuHeight = 98;
    const desiredLeft = point?.x ?? bounds.left + bounds.width / 2 - menuWidth / 2;
    const below = (point?.y ?? bounds.bottom) + 8;
    const desiredTop = below + menuHeight <= window.innerHeight ? below : bounds.top - menuHeight - 8;
    setSelectionMenu({
      left: Math.max(8, Math.min(desiredLeft, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(desiredTop, window.innerHeight - menuHeight - 8)),
      ...selected,
    });
    return true;
  }, []);

  const queueSelectionMenu = useCallback(() => {
    if (selectionMenuTimerRef.current !== null) window.clearTimeout(selectionMenuTimerRef.current);
    selectionMenuTimerRef.current = window.setTimeout(() => {
      selectionMenuTimerRef.current = null;
      if (!selectionPointerActiveRef.current) showSelectionMenu();
    }, 60);
  }, [showSelectionMenu]);

  useEffect(() => {
    if (editing) return;
    const onSelectionChange = () => {
      if (!selectionPointerActiveRef.current && !window.getSelection()?.isCollapsed) queueSelectionMenu();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      if (selectionMenuTimerRef.current !== null) window.clearTimeout(selectionMenuTimerRef.current);
      selectionMenuTimerRef.current = null;
    };
  }, [editing, queueSelectionMenu]);

  useLayoutEffect(() => {
    const snapshot = pendingContentScrollRef.current;
    const target = editing ? editorRef.current : readerRef.current;
    if (!snapshot || !target) return;
    pendingContentScrollRef.current = null;
    if (editing) {
      const editor = editorRef.current;
      editor?.focus({ preventScroll: true });
      const caret = pendingEditorCaretRef.current;
      pendingEditorCaretRef.current = null;
      if (caret !== null) editor?.setSelectionRange(caret, caret);
    }
    const restore = () => {
      const max = Math.max(0, target.scrollHeight - target.clientHeight);
      const top = Math.abs(max - snapshot.max) <= 2 ? snapshot.top : snapshot.ratio * max;
      target.scrollTop = Math.max(0, Math.min(top, max));
    };
    restore();
    const frame = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  useEffect(() => () => {
    if (!editingRef.current || draftRef.current === baselineRef.current || preservingRef.current) return;
    preservingRef.current = true;
    void studioRef.current.preserveContentDraft(editingOutlineId, draftRef.current, draftSavedAtRef.current || new Date().toISOString());
  }, [editingOutlineId]);

  useEffect(() => {
    const onFind = (event: KeyboardEvent) => {
      if (editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onFind);
    return () => window.removeEventListener("keydown", onFind);
  }, [editing]);

  const matches = useMemo(() => {
    if (!findQuery) return [] as Array<{ start: number; end: number }>;
    const haystack = caseSensitive ? content : content.toLocaleLowerCase();
    const needle = caseSensitive ? findQuery : findQuery.toLocaleLowerCase();
    const result: Array<{ start: number; end: number }> = [];
    let from = 0;
    while (from <= haystack.length) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) break;
      result.push({ start: index, end: index + needle.length });
      from = index + Math.max(needle.length, 1);
    }
    return result;
  }, [content, findQuery, caseSensitive]);

  function selectMatch(index: number) {
    if (!matches.length) return;
    const normalized = (index + matches.length) % matches.length;
    setMatchIndex(normalized);
    const match = matches[normalized];
    editorRef.current?.focus();
    editorRef.current?.setSelectionRange(match.start, match.end);
  }

  function replaceCurrent() {
    if (!matches.length) return;
    const match = matches[Math.min(matchIndex, matches.length - 1)];
    changeDraft(content.slice(0, match.start) + replacement + content.slice(match.end));
  }

  function replaceAll() {
    if (!findQuery) return;
    const next = caseSensitive ? content.split(findQuery).join(replacement) : content.replace(new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), replacement);
    changeDraft(next);
  }

  function beginEditing() {
    if (editingRef.current) return;
    const reader = readerRef.current;
    if (reader) {
      const max = Math.max(0, reader.scrollHeight - reader.clientHeight);
      const ratio = max > 0 ? reader.scrollTop / max : 0;
      pendingContentScrollRef.current = { top: reader.scrollTop, max, ratio };
      pendingEditorCaretRef.current = selectedRangeWithin(reader)?.end ?? Math.round(displayedContent.length * ratio);
    }
    setSelectionMenu(null);
    baselineRef.current = displayedContent;
    draftRef.current = displayedContent;
    draftSavedAtRef.current = new Date().toISOString();
    preservingRef.current = false;
    editingRef.current = true;
    onEditingChange(true);
    setDraftContent(displayedContent);
    setEditing(true);
  }

  function changeDraft(next: string) {
    draftRef.current = next;
    setDraftContent(next);
    if (next === baselineRef.current) studio.clearContentDraft(studio.currentOutline.id);
    else {
      draftSavedAtRef.current = new Date().toISOString();
      studio.stageContentDraft(studio.currentOutline.id, next);
    }
  }

  function finishWithoutChanges() {
    const editor = editorRef.current;
    if (editor) {
      const max = Math.max(0, editor.scrollHeight - editor.clientHeight);
      pendingContentScrollRef.current = { top: editor.scrollTop, max, ratio: max > 0 ? editor.scrollTop / max : 0 };
    }
    editingRef.current = false;
    preservingRef.current = false;
    studio.clearContentDraft(studio.currentOutline.id);
    setFindOpen(false);
    setEditToolsOpen(false);
    setExitPromptOpen(false);
    onEditingChange(false);
    setEditing(false);
  }

  function requestExitEditing() {
    if (draftRef.current === baselineRef.current) finishWithoutChanges();
    else setExitPromptOpen(true);
  }

  function discardEditing() {
    finishWithoutChanges();
    setDraftContent(baselineRef.current);
    onNotice("已放弃正文修改");
  }

  async function saveEditing() {
    setSavingEdit(true);
    const saved = await studio.saveCurrentContent(studio.currentOutline.id, draftRef.current, displayedVersion?.id);
    setSavingEdit(false);
    if (!saved) return;
    const editor = editorRef.current;
    if (editor) {
      const max = Math.max(0, editor.scrollHeight - editor.clientHeight);
      pendingContentScrollRef.current = { top: editor.scrollTop, max, ratio: max > 0 ? editor.scrollTop / max : 0 };
    }
    editingRef.current = false;
    preservingRef.current = false;
    studio.clearContentDraft(studio.currentOutline.id);
    setFindOpen(false);
    setEditToolsOpen(false);
    setExitPromptOpen(false);
    onEditingChange(false);
    setEditing(false);
    onClearPreview();
    onNotice("正文已保存");
  }

  async function copyEditingContent() {
    const copied = await copyTextToClipboard(content);
    onNotice(copied ? "正文已复制" : "复制失败，请检查剪贴板权限");
  }

  async function pasteEditingContent() {
    if (!navigator.clipboard?.readText) {
      onNotice("当前浏览器不支持读取剪贴板");
      return;
    }
    try {
      const pasted = await navigator.clipboard.readText();
      const editor = editorRef.current;
      if (!editor || !pasted) return;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const next = `${content.slice(0, start)}${pasted}${content.slice(end)}`;
      changeDraft(next);
      window.requestAnimationFrame(() => {
        editor.focus();
        const caret = start + pasted.length;
        editor.setSelectionRange(caret, caret);
      });
    } catch {
      onNotice("粘贴失败，请检查剪贴板权限");
    }
  }

  async function saveAsEditingContent() {
    const defaultName = `${resolvedOutlineContentName(studio.currentOutline)}-复制`;
    const name = window.prompt("另存为正文", defaultName);
    if (name === null) return;
    const versionName = name.trim() || defaultName;
    studio.saveVersion(studio.currentOutline.id, versionName, "手动", content);
    const saved = await studio.saveNow();
    onNotice(saved ? `正文已另存为「${versionName}」` : "另存为未完成，请查看保存状态");
  }

  async function toggleDisplayedContentDefault() {
    if (!displayedContent.trim() || settingDefaultRef.current) return;
    settingDefaultRef.current = true;
    setSettingDefault(true);
    if (displayedIsDefault) {
      studio.setDefaultVersion(studio.currentOutline.id);
      const saved = await studio.saveNow();
      settingDefaultRef.current = false;
      setSettingDefault(false);
      onNotice(saved ? "已取消默认正文" : "取消默认正文未完成，请查看保存状态");
      return;
    }
    const existingVersionId = displayedIsDirectContent ? undefined : displayedVersion?.id;
    const versionId = existingVersionId ?? studio.saveVersion(
      studio.currentOutline.id,
      resolvedOutlineContentName(studio.currentOutline),
      "手动",
      displayedContent,
      { outlineSnapshot: studio.currentOutline.contentOutlineSnapshot },
    );
    if (!existingVersionId) studio.setCurrentVersion(studio.currentOutline.id, versionId);
    studio.setDefaultVersion(studio.currentOutline.id, versionId);
    const saved = await studio.saveNow();
    settingDefaultRef.current = false;
    setSettingDefault(false);
    onNotice(saved ? "已设为默认正文" : "设置默认正文未完成，请查看保存状态");
  }

  async function setDisplayedAsCurrent() {
    if (!previewVersion || displayedIsCurrent) return;
    studio.setCurrentVersion(studio.currentOutline.id, displayedIsDirectContent ? undefined : previewVersion.id);
    onClearPreview();
    const saved = await studio.saveNow();
    onNotice(saved ? "已设为当前正文" : "设置当前正文未完成，请查看保存状态");
  }

  async function toggleDisplayedBodyExcellent() {
    if (!displayedContent.trim() || settingExcellentRef.current) return;
    settingExcellentRef.current = true;
    setSettingExcellent(true);
    const next = !displayedManuallyExcellent;
    studio.setBodyExcellent(studio.currentOutline.id, displayedIsDirectContent ? undefined : displayedVersion?.id, next);
    const saved = await studio.saveNow();
    settingExcellentRef.current = false;
    setSettingExcellent(false);
    if (!saved) {
      onNotice("设置优秀正文未完成，请查看保存状态");
    } else if (next) {
      onNotice("已手动设为优秀正文");
    } else if (displayedAutomaticallyExcellent) {
      onNotice("已取消手动优秀；正文仍含优秀片段");
    } else {
      onNotice("已取消优秀正文");
    }
  }

  function applyAppreciationRange(range: { start: number; end: number }) {
    if (!displayedContent.trim()) return;
    const action = studio.toggleExcellentFragment(studio.currentOutline.id, displayedIsDirectContent ? undefined : displayedVersion?.id, range.start, range.end);
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    if (action === "added") onNotice("已标记优秀片段");
    if (action === "removed") onNotice("已取消优秀片段");
  }

  function openSelectionMenu(event: React.MouseEvent<HTMLDivElement>) {
    const opened = showSelectionMenu({ x: event.clientX, y: event.clientY });
    if (opened || window.matchMedia("(max-width: 767px)").matches) event.preventDefault();
  }

  function isTouchDoubleTap(event: React.PointerEvent<HTMLElement>, ref: typeof lastReaderTouchRef) {
    if (event.pointerType !== "touch") return false;
    const current = { at: performance.now(), x: event.clientX, y: event.clientY };
    const previous = ref.current;
    ref.current = current;
    if (!previous || current.at - previous.at > 380 || Math.hypot(current.x - previous.x, current.y - previous.y) > 28) return false;
    ref.current = null;
    event.preventDefault();
    return true;
  }

  return (
    <div ref={writingScrollRef} className={`writing-scroll ${editing ? "editing" : ""}`}>
      <div className="writing-canvas">
        {!focusMode && <button className="mobile-plan-peek" type="button" onClick={() => setPlanPeek(true)}>此正文大纲 <span><Icon name="chevron" /></span></button>}
        {!focusMode && (
          <section className="outline-editor-section">
            <button className="section-heading" type="button" onClick={() => { setPlanOpen((value) => !value); studio.updateSettings({ outlineExpanded: !planOpen }); }}><span>此正文大纲</span><span>{planOpen ? "收起" : "展开"} <Icon name="chevron" /></span></button>
            {planOpen && <div className="outline-snapshot-content" aria-label="此正文大纲内容">{plan || "此版本未保存生成时的大纲内容"}</div>}
          </section>
        )}

        {!editing && displayedVersion?.reviewReport && <GenerateReviewReportView report={displayedVersion.reviewReport} />}
        {!editing && displayedVersion?.reviewRuleSnapshot && <details className="generate-review-report"><summary>本次 Review 规则</summary><ReviewRuleSnapshotView snapshot={displayedVersion.reviewRuleSnapshot} /></details>}
        <section className="content-editor-section">
          <div className="editor-heading">
            <div className="body-title-cluster">
              <button className={`body-title-toggle ${displayedIsDefault ? "default" : ""}`} type="button" disabled={!displayedContent.trim() || settingDefault} aria-label={`正文标题，双击${displayedIsDefault ? "取消" : "设为"}默认正文`} title={`${displayedContentName} · 双击${displayedIsDefault ? "取消" : "设为"}默认正文`} onClick={(event) => { if (event.detail === 0) void toggleDisplayedContentDefault(); }} onDoubleClick={() => void toggleDisplayedContentDefault()} onPointerUp={(event) => { if (isTouchDoubleTap(event, lastTitleTouchRef)) void toggleDisplayedContentDefault(); }}><span>{displayedContentName}</span></button>
              <button className={`body-status-button default-status ${displayedIsDefault ? "active" : ""}`} type="button" disabled={!displayedContent.trim() || settingDefault} aria-label={displayedIsDefault ? "取消默认正文" : "设为默认正文"} aria-pressed={displayedIsDefault} title={displayedIsDefault ? "取消默认正文" : "设为默认正文"} onClick={() => void toggleDisplayedContentDefault()}><span aria-hidden="true">P</span></button>
              <button className={`body-status-button excellent-status ${displayedIsExcellent ? "active" : ""} ${displayedAutomaticallyExcellent && !displayedManuallyExcellent ? "automatic" : ""}`} type="button" disabled={!displayedContent.trim() || settingExcellent} aria-label={displayedManuallyExcellent ? "取消手动优秀正文" : displayedAutomaticallyExcellent ? "手动保留优秀正文" : "设为优秀正文"} aria-pressed={displayedIsExcellent} title={displayedManuallyExcellent ? "取消手动优秀正文" : displayedAutomaticallyExcellent ? "含优秀片段，已自动设为优秀；点击可手动保留" : "设为优秀正文"} onClick={() => void toggleDisplayedBodyExcellent()}><span aria-hidden="true">★</span></button>
              {displayedIsCurrent
                ? <span className="body-current-label">当前</span>
                : <button className="body-set-current-button" type="button" onClick={() => void setDisplayedAsCurrent()}>设为当前</button>}
              {editing && <span className={`mobile-edit-save-state ${draftContent === baselineRef.current ? "saved" : "unsaved"}`}>{savingEdit ? "正在保存…" : draftContent === baselineRef.current ? "未修改" : "未保存"}</span>}
            </div>
            <div className="editor-tools">{editing ? <>
              <div className="desktop-edit-tools"><IconButton name="search" label="查找正文" title="查找" size="small" onClick={() => setFindOpen((value) => !value)} /><IconButton name="copy" label="复制正文" title="复制" size="small" onClick={() => void copyEditingContent()} /><IconButton name="paste" label="粘贴正文" title="粘贴" size="small" onClick={() => void pasteEditingContent()} /><IconButton name="save" label="保存正文" title="保存" size="small" disabled={savingEdit} onClick={() => void saveEditing()} /><IconButton name="saveAs" label="另存为正文" title="另存为" size="small" onClick={() => void saveAsEditingContent()} /><button className="finish-edit-button" type="button" onClick={requestExitEditing}>退出编辑</button></div>
              <div className="mobile-edit-tools"><button className="finish-edit-button" type="button" aria-label="退出编辑" onClick={requestExitEditing}>完成</button><IconButton name="more" label="更多编辑操作" size="small" className="mobile-edit-more" aria-expanded={editToolsOpen} aria-haspopup="menu" onClick={() => setEditToolsOpen((open) => !open)} />{editToolsOpen && <div className="mobile-edit-overflow-menu" role="menu" aria-label="编辑操作"><button type="button" role="menuitem" onClick={() => { setFindOpen((value) => !value); setEditToolsOpen(false); }}><Icon name="search" />查找与替换</button><button type="button" role="menuitem" onClick={() => { setEditToolsOpen(false); void copyEditingContent(); }}><Icon name="copy" />复制全文</button><button type="button" role="menuitem" onClick={() => { setEditToolsOpen(false); void pasteEditingContent(); }}><Icon name="paste" />粘贴</button><button type="button" role="menuitem" disabled={savingEdit} onClick={() => { setEditToolsOpen(false); void saveEditing(); }}><Icon name="save" />保存并结束</button><button type="button" role="menuitem" onClick={() => { setEditToolsOpen(false); void saveAsEditingContent(); }}><Icon name="saveAs" />另存为正文</button></div>}</div>
            </> : <><Button variant="subtle" size="compact-sm" disabled={!displayedContent.trim()} onClick={() => setIllustrationSource({ content: displayedContent, excerpt: "" })}>生成插图</Button><Button variant="subtle" size="compact-sm" onClick={() => setIllustrationSource({ content: displayedContent, excerpt: "", tab: "images" })}>插图历史</Button><span className="content-word-count">{wordCount(displayedContent).toLocaleString("zh-CN")} 字</span></>}</div>
          </div>
          {!editing && displayedVersion?.rewriteSourceId && <div className="rewrite-source-row"><span>改写自</span><button type="button" onClick={() => onOpenRewriteSource(displayedVersion.rewriteSourceId!)}>{displayedVersion.rewriteSourceName || "原正文"}</button></div>}
          {findOpen && editing && <div className="find-bar"><input autoFocus value={findQuery} onChange={(event) => { setFindQuery(event.target.value); setMatchIndex(0); }} placeholder="查找…" aria-label="查找正文" /><input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="替换为…" aria-label="替换内容" /><label><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />Aa</label><span>{matches.length ? `${Math.min(matchIndex + 1, matches.length)} / ${matches.length}` : "0 / 0"}</span><button type="button" onClick={() => selectMatch(matchIndex - 1)}>上一个</button><button type="button" onClick={() => selectMatch(matchIndex + 1)}>下一个</button><button type="button" onClick={replaceCurrent}>替换</button><button type="button" onClick={replaceAll}>全部</button><IconButton name="close" label="关闭查找" onClick={() => setFindOpen(false)} /></div>}
          {editing ? <textarea ref={editorRef} className="content-editor" value={draftContent} onChange={(event) => changeDraft(event.target.value)} aria-label="正文编辑器" placeholder="从这里开始写作…" spellCheck={false} style={{ fontSize: studio.data.settings.fontSize, lineHeight: studio.data.settings.lineHeight, fontFamily: "var(--font-editor)", maxWidth: studio.data.settings.contentWidth }} /> : <><span id="content-reader-description" hidden>选中文字可欣赏；双击或按 Enter 进入编辑</span><div ref={readerRef} className="content-reader" role="region" tabIndex={0} aria-label="正文内容" aria-describedby="content-reader-description" aria-keyshortcuts="Enter" onContextMenu={openSelectionMenu} onDoubleClick={(event) => { event.preventDefault(); beginEditing(); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); beginEditing(); } }} onPointerDown={() => { selectionPointerActiveRef.current = true; }} onPointerCancel={() => { selectionPointerActiveRef.current = false; }} onPointerUp={(event) => { selectionPointerActiveRef.current = false; if (isTouchDoubleTap(event, lastReaderTouchRef)) beginEditing(); else queueSelectionMenu(); }} style={{ fontSize: studio.data.settings.fontSize, lineHeight: studio.data.settings.lineHeight, fontFamily: "var(--font-editor)", maxWidth: studio.data.settings.contentWidth }}>{content ? <ExcellentText text={content} fragments={displayedFragments} /> : "（正文为空）"}</div></>}
        </section>
      </div>
      {selectionMenu && <div className="content-selection-menu" role="menu" aria-label="正文选择菜单" style={{ left: selectionMenu.left, top: selectionMenu.top }}><button className={selectedFragmentIsExcellent ? "active" : ""} type="button" role="menuitemcheckbox" aria-checked={selectedFragmentIsExcellent} onClick={() => applyAppreciationRange(selectionMenu)}><span>欣赏</span>{selectedFragmentIsExcellent && <Icon name="check" />}</button><button type="button" role="menuitem" onClick={() => { setIllustrationSource({ content: displayedContent, excerpt: displayedContent.slice(selectionMenu.start, selectionMenu.end) }); setSelectionMenu(null); window.getSelection()?.removeAllRanges(); }}>生成插图</button></div>}
      {illustrationSource && <IllustrationGenerator outlineId={studio.currentOutline.id} content={illustrationSource.content} selectedExcerpt={illustrationSource.excerpt} initialTab={illustrationSource.tab} defaultModel={studio.data.settings.illustrationPromptModel || studio.data.settings.generateModel} defaultImageModel={studio.data.settings.illustrationImageModel} onClose={() => setIllustrationSource(null)} />}
      {planPeek && <ScrollableDrawer
        opened
        onClose={() => setPlanPeek(false)}
        closeButtonProps={{ "aria-label": "关闭此正文大纲" }}
        title={<div className="ws-overlay-title"><span>{planSnapshot?.title ? `生成时大纲 · ${planSnapshot.title}` : "正文版本"}</span><span className="ui-title">此正文大纲</span></div>}
        position="bottom"
        size="auto"
        classNames={{ content: "plan-peek-drawer", body: "plan-peek-drawer-body" }}
      >
        <p aria-label="此正文大纲内容">{plan || "此版本未保存生成时的大纲内容"}</p>
        <Button type="button" onClick={() => setPlanPeek(false)}>返回正文</Button>
      </ScrollableDrawer>}
      <ResponsiveModal opened={exitPromptOpen} onClose={() => setExitPromptOpen(false)} closeButtonProps={{ "aria-label": "继续编辑正文" }} title="保存正文修改？" size="sm">
        <Group justify="flex-end" gap="sm"><Button variant="default" type="button" onClick={() => setExitPromptOpen(false)}>继续编辑</Button><Button variant="default" color="red" type="button" onClick={discardEditing}>放弃修改</Button><Button type="button" loading={savingEdit} onClick={() => void saveEditing()}>保存修改</Button></Group>
      </ResponsiveModal>
    </div>
  );
}

const generateTextareaHeightStorageKey = "writer-studio:generate-textarea-heights:v1";
const maxRememberedGenerateTextareas = 500;
type GenerateTextareaHeightSlot = "outlinePlan" | "instruction";
type GenerateTextareaHeightRecord = Record<string, Partial<Record<GenerateTextareaHeightSlot, number>>>;

function readGenerateTextareaHeights(): GenerateTextareaHeightRecord {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(generateTextareaHeightStorageKey) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry && typeof entry === "object" && !Array.isArray(entry))) as GenerateTextareaHeightRecord;
  } catch {
    return {};
  }
}

function rememberedGenerateTextareaHeight(outlineId: string, slot: GenerateTextareaHeightSlot) {
  const value = Number(readGenerateTextareaHeights()[outlineId]?.[slot]);
  return Number.isFinite(value) && value >= 60 && value <= 3000 ? Math.round(value) : undefined;
}

function writeGenerateTextareaHeight(outlineId: string, slot: GenerateTextareaHeightSlot, height: number) {
  if (typeof window === "undefined" || !outlineId) return;
  const normalizedHeight = Math.max(60, Math.min(3000, Math.round(height)));
  try {
    const current = readGenerateTextareaHeights();
    const existing = current[outlineId] ?? {};
    const entries = Object.entries(current).filter(([id]) => id !== outlineId);
    entries.push([outlineId, { ...existing, [slot]: normalizedHeight }]);
    window.localStorage.setItem(generateTextareaHeightStorageKey, JSON.stringify(Object.fromEntries(entries.slice(-maxRememberedGenerateTextareas))));
  } catch {
    // A full or unavailable browser store must not block writing or generation.
  }
}

function useRememberedGenerateTextareaHeight(outlineId: string, slot: GenerateTextareaHeightSlot) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const remembered = rememberedGenerateTextareaHeight(outlineId, slot);
    // Older sessions also stored the untouched six-row mobile default as a custom height.
    let previousMobileDefault: number | undefined;
    if (slot === "outlinePlan" && window.matchMedia("(max-width: 767px)").matches) {
      const clone = textarea.cloneNode() as HTMLTextAreaElement;
      clone.removeAttribute("id");
      clone.style.height = "auto";
      clone.style.position = "absolute";
      clone.style.visibility = "hidden";
      textarea.parentElement?.append(clone);
      previousMobileDefault = Math.round(clone.getBoundingClientRect().height);
      clone.remove();
    }
    const wasDefault = remembered !== undefined && previousMobileDefault !== undefined && Math.abs(remembered - previousMobileDefault) <= 1;
    if (remembered !== undefined && !wasDefault) textarea.style.height = `${remembered}px`;
    else textarea.style.removeProperty("height");
    let pendingHeight: number | undefined;
    let saveTimer: number | undefined;
    let lastSavedHeight = wasDefault ? undefined : remembered;
    let lastObservedHeight = Math.round(textarea.getBoundingClientRect().height);
    const flush = () => {
      if (pendingHeight === undefined || pendingHeight === lastSavedHeight) return;
      writeGenerateTextareaHeight(outlineId, slot, pendingHeight);
      lastSavedHeight = pendingHeight;
      pendingHeight = undefined;
    };
    const capture = () => {
      const height = Math.round(textarea.getBoundingClientRect().height);
      if (height === lastObservedHeight) return;
      lastObservedHeight = height;
      if (!Number.isFinite(height) || height < 60 || height > 3000 || height === lastSavedHeight) return;
      pendingHeight = height;
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(flush, 120);
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(capture);
    observer?.observe(textarea);
    textarea.addEventListener("pointerup", capture);
    return () => {
      observer?.disconnect();
      textarea.removeEventListener("pointerup", capture);
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
      flush();
    };
  }, [outlineId, slot]);
  return textareaRef;
}

function GenerateView({ models, outline, initialPrompt = "", onTaskCreated, onOpenTasks }: { models: ConfiguredModel[]; outline: { title: string; plan: string; content: string }; initialPrompt?: string; onTaskCreated: () => void; onOpenTasks: () => void }) {
  const studio = useStudio();
  const displayTitle = outlineDisplayTitle(outline);
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const storedPromptAtOpen = studio.currentOutline.generateInstruction;
  const hasCurrentContent = Boolean(resolvedOutlineContent(studio.currentOutline).trim());
  const inheritedGenerateOptions = normalizeAiGenerateOptions(studio.currentArticle.aiGenerateSettings, DEFAULT_AI_GENERATE_OPTIONS);
  const initialGenerateOptions = normalizeAiGenerateOptions(studio.currentOutline.generateOptions ?? inheritedGenerateOptions, inheritedGenerateOptions);
  if (!hasCurrentContent && initialGenerateOptions.contentMode !== "fresh") initialGenerateOptions.contentMode = "fresh";
  const [generateOptions, setGenerateOptions] = useState<AiGenerateOptions>(initialGenerateOptions);
  const generateOptionsRef = useRef(initialGenerateOptions);
  const {
    includePrevious,
    includeCharacters,
    includeExcellentFragments,
    includeOutlineTitle,
    contentMode: generationMode,
    rewriteRetention,
    proseControls,
    model: selectedModel,
    reasoningEffort,
    firstAppearanceOverrides: appearanceOverrides,
  } = generateOptions;
  const reviewMaxRounds = normalizeReviewRounds(studio.data.settings.generateReviewMaxRounds);
  const reviewInstruction = normalizeReviewRules(studio.data.settings.generateReviewInstruction);
  const reviewStrategy = normalizeReviewStrategy(studio.data.settings.generateReviewStrategy);
  const [prompt, setPrompt] = useState(() => initialPrompt || storedPromptAtOpen);
  const [savedPrompt, setSavedPrompt] = useState(storedPromptAtOpen);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaveFailed, setPromptSaveFailed] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [appearanceEditorOpen, setAppearanceEditorOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [presetManagerOpen, setPresetManagerOpen] = useState(false);
  const [targetWordsInput, setTargetWordsInput] = useState(() => generateOptions.targetWords > 0 ? String(generateOptions.targetWords) : "");
  const [outlinePlanDraft, setOutlinePlanDraft] = useState(outline.plan);
  const outlinePlanDraftRef = useRef(outline.plan);
  const lastSyncedOutlineRef = useRef({ id: studio.currentOutline.id, plan: outline.plan });
  const [outlineSaving, setOutlineSaving] = useState(false);
  const outlinePlanHeightRef = useRememberedGenerateTextareaHeight(studio.currentOutline.id, "outlinePlan");
  const instructionHeightRef = useRememberedGenerateTextareaHeight(studio.currentOutline.id, "instruction");
  const outlineResizePointerRef = useRef<{ id: number; startY: number; startHeight: number } | null>(null);
  const resizeOutlinePlan = (height: number) => {
    const textarea = outlinePlanHeightRef.current;
    if (textarea) textarea.style.height = `${Math.max(88, Math.min(3000, Math.round(height)))}px`;
  };
  const startOutlineResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || !outlinePlanHeightRef.current) return;
    outlineResizePointerRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      startHeight: outlinePlanHeightRef.current.getBoundingClientRect().height,
    };
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer events may not support capture. */ }
  };
  const moveOutlineResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const pointer = outlineResizePointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    resizeOutlinePlan(pointer.startHeight + event.clientY - pointer.startY);
    event.preventDefault();
  };
  const stopOutlineResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (outlineResizePointerRef.current?.id === event.pointerId) outlineResizePointerRef.current = null;
  };
  const parsedTargetWords = Number(targetWordsInput);
  const targetWordsUnset = targetWordsInput.trim() === "" || parsedTargetWords === 0;
  const targetWordsValid = targetWordsUnset || (Number.isInteger(parsedTargetWords) && parsedTargetWords >= MIN_GENERATE_TARGET_WORDS && parsedTargetWords <= MAX_GENERATE_TARGET_WORDS);
  const targetWords = targetWordsValid && !targetWordsUnset ? parsedTargetWords : undefined;
  const rewriteRetentionIndex = rewriteRetentionOptions.findIndex((item) => item.value === rewriteRetention);
  const rewriteRetentionOption = rewriteRetentionOptions[rewriteRetentionIndex] ?? rewriteRetentionOptions[1];
  const outlinePlanDirty = outlinePlanDraft !== outline.plan;
  const normalizedPrompt = prompt.trim().slice(0, 20_000);
  const promptDirty = normalizedPrompt !== savedPrompt;

  const rememberGenerateOptions = useCallback((patch: Partial<AiGenerateOptions>) => {
    const next = normalizeAiGenerateOptions({ ...generateOptionsRef.current, ...patch }, studio.currentArticle.aiGenerateSettings);
    if (!hasCurrentContent && next.contentMode !== "fresh") next.contentMode = "fresh";
    generateOptionsRef.current = next;
    setGenerateOptions(next);
    studio.updateOutline(studio.currentOutline.id, { generateOptions: next });
  }, [hasCurrentContent, studio]);

  const resetGenerateOptions = useCallback(() => {
    const next = normalizeAiGenerateOptions(studio.currentArticle.aiGenerateSettings, DEFAULT_AI_GENERATE_OPTIONS);
    if (!hasCurrentContent && next.contentMode !== "fresh") next.contentMode = "fresh";
    generateOptionsRef.current = next;
    setGenerateOptions(next);
    setTargetWordsInput(next.targetWords > 0 ? String(next.targetWords) : "");
    studio.updateOutline(studio.currentOutline.id, { generateOptions: null });
    setNotice("已恢复使用文章 AI Generate 预设。");
  }, [hasCurrentContent, studio]);

  useEffect(() => {
    const previous = lastSyncedOutlineRef.current;
    if (previous.id !== studio.currentOutline.id || outlinePlanDraftRef.current === previous.plan) {
      outlinePlanDraftRef.current = outline.plan;
      setOutlinePlanDraft(outline.plan);
    }
    lastSyncedOutlineRef.current = { id: studio.currentOutline.id, plan: outline.plan };
  }, [studio.currentOutline.id, outline.plan]);
  const appearanceSuggestions = useMemo(() => detectFirstAppearanceCharacters(
    { articles: [studio.currentArticle] },
    studio.currentOutline.id,
    { instruction: prompt, currentPlan: outlinePlanDraft },
  ), [studio.currentArticle, studio.currentOutline.id, outlinePlanDraft, prompt]);
  const appearanceSuggestionMap = useMemo(() => new Map(appearanceSuggestions.map((item) => [item.characterId, item])), [appearanceSuggestions]);
  const activeCharacters = useMemo(() => studio.currentArticle.characters.filter((character) => !character.archived), [studio.currentArticle.characters]);
  const firstAppearanceCharacterIds = useMemo(() => activeCharacters.filter((character) => (
    Object.prototype.hasOwnProperty.call(appearanceOverrides, character.id)
      ? appearanceOverrides[character.id]
      : appearanceSuggestionMap.get(character.id)?.firstAppearance === true
  )).map((character) => character.id), [activeCharacters, appearanceOverrides, appearanceSuggestionMap]);
  const firstAppearanceCharacters = useMemo(() => activeCharacters.filter((character) => firstAppearanceCharacterIds.includes(character.id)), [activeCharacters, firstAppearanceCharacterIds]);
  const excellentFragmentIds = useMemo(() => {
    if (!includeExcellentFragments) return [];
    try {
      return selectAiContext({ articles: [studio.currentArticle] }, studio.currentOutline.id, "content", { includeExcellentFragments: true }).excellentFragments.map((fragment) => fragment.id);
    } catch { return []; }
  }, [includeExcellentFragments, studio.currentArticle, studio.currentOutline.id]);
  const availableExcellentFragmentCount = useMemo(() => {
    try {
      return selectAiContext({ articles: [studio.currentArticle] }, studio.currentOutline.id, "content", { includeExcellentFragments: true }).excellentFragments.length;
    } catch { return 0; }
  }, [studio.currentArticle, studio.currentOutline.id]);
  const summary = useMemo(() => generateContextSummary(studio.currentArticle, { ...studio.currentOutline, plan: outlinePlanDraft }, prompt, includePrevious, includeCharacters, "content", generationMode, firstAppearanceCharacterIds, includeExcellentFragments, excellentFragmentIds), [studio.currentArticle, studio.currentOutline, outlinePlanDraft, prompt, includePrevious, includeCharacters, generationMode, firstAppearanceCharacterIds, includeExcellentFragments, excellentFragmentIds]);
  const outlineTasks = studio.data.tasks.filter((task) => task.outlineId === studio.currentOutline.id && task.target === "正文");
  const activeTasks = outlineTasks.filter((task) => task.state === "waiting" || task.state === "running").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const latestFailed = outlineTasks.find((task) => task.state === "failed");
  const interactiveTask = outlineTasks.find(isTaskAwaitingAuthor) ?? [...outlineTasks].filter((task) => task.contextOptions?.writingPreparation).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const selectedRecord = configuredModelForReference(models, selectedModel);
  const selectedModelReference = selectedRecord?.id ?? selectedModel.trim();
  const modelOptions = [
    { value: "", label: "本地演示引擎" },
    ...(selectedModelReference && !selectedRecord ? [{ value: selectedModelReference, label: selectedModelReference }] : []),
    ...models.map((model) => ({ value: model.id, label: `${modelDisplayLabel(models, model.id)}${model.hasSecret ? "" : "（需密钥）"}` })),
  ];

  function selectGenerateModel(model: string) {
    rememberGenerateOptions({ model });
  }

  const saveOutlineDraft = useCallback(async () => {
    if (outlinePlanDraft === studio.currentOutline.plan) return true;
    setOutlineSaving(true);
    const saved = await studio.saveOutlinePlan(studio.currentOutline.id, outlinePlanDraft);
    if (saved) lastSyncedOutlineRef.current = { id: studio.currentOutline.id, plan: outlinePlanDraft };
    setOutlineSaving(false);
    return saved;
  }, [outlinePlanDraft, studio]);

  const saveGenerateInstruction = useCallback(async () => {
    if (!promptDirty) return true;
    setPromptSaving(true);
    setPromptSaveFailed(false);
    studio.updateOutline(studio.currentOutline.id, { generateInstruction: normalizedPrompt });
    const saved = await studio.saveNow();
    if (saved) {
      setPrompt(normalizedPrompt);
      setSavedPrompt(normalizedPrompt);
      setNotice("补充指令已保存。");
    } else {
      setPromptSaveFailed(true);
      setNotice("补充指令保存失败，请重试。");
    }
    setPromptSaving(false);
    return saved;
  }, [normalizedPrompt, promptDirty, studio]);

  async function changeGenerateTaskState(task: AiTask, action: "cancel" | "retry") {
    try {
      const response = await fetchServerAction(`/api/ai/tasks/${encodeURIComponent(task.id)}/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "任务状态更新失败");
      await studio.refreshFromServer();
    } catch (error) { setNotice(error instanceof Error ? error.message : "任务状态更新失败"); }
  }

  const submit = useCallback(async () => {
    if (generationMode !== "fresh" && !hasCurrentContent) { setNotice("当前正文为空，无法改写或续写。"); return; }
    if (!targetWordsValid) { setNotice(`目标字数请输入 ${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数，或留空表示不限字数。`); return; }
    if (reviewMaxRounds > 0 && reviewStrategy === "minimal" && !hasReviewRules(createReviewRuleSnapshot(studio.currentArticle, normalizeReviewRules(reviewInstruction))) && !hasActiveProseControls(proseControls)) { setNotice("请在文章 AI 任务设定中添加审校规则，或在设置 → AI 任务中添加审校指令、关闭审校。"); return; }
    const effectiveFirstAppearanceIds = includeCharacters ? firstAppearanceCharacterIds : [];
    const appearanceSnapshot = JSON.stringify([...effectiveFirstAppearanceIds].sort());
    const excellentSnapshot = JSON.stringify([...excellentFragmentIds].sort());
    const duplicate = studio.data.tasks.find((task) => task.outlineId === studio.currentOutline.id && task.target === "正文" && (task.contextOptions?.configuredModelId ?? "") === selectedModelReference && task.contextOptions?.resolvedReasoningEffort === resolveReasoningEffort(selectedRecord, reasoningEffort) && task.prompt === prompt.trim() && normalizeReviewRounds(task.contextOptions?.reviewMaxRounds) === reviewMaxRounds && normalizeReviewStrategy(task.contextOptions?.reviewStrategy) === reviewStrategy && (studio.data.settings.reviewModelMode !== "fixed" || task.contextOptions?.reviewConfiguredModelId === studio.data.settings.reviewModel) && (task.contextOptions?.reviewInstruction ?? "") === normalizeReviewRules(reviewInstruction) && (reviewMaxRounds === 0 || JSON.stringify(task.contextOptions?.reviewRuleSnapshot) === JSON.stringify(createReviewRuleSnapshot(studio.currentArticle, normalizeReviewRules(reviewInstruction)))) && JSON.stringify(resolvedProseControls(task.contextOptions)) === JSON.stringify(proseControls) && task.contextOptions?.targetWords === targetWords && (task.contextOptions?.contentMode ?? "fresh") === generationMode && (generationMode !== "rewrite" || normalizeRewriteRetentionLevel(task.contextOptions?.rewriteRetention) === rewriteRetention) && JSON.stringify([...(task.contextOptions?.firstAppearanceCharacterIds ?? [])].sort()) === appearanceSnapshot && (task.contextOptions?.includeExcellentFragments === true) === includeExcellentFragments && (task.contextOptions?.includeOutlineTitle === true) === includeOutlineTitle && JSON.stringify([...(task.contextOptions?.excellentFragmentIds ?? [])].sort()) === excellentSnapshot && Date.now() - new Date(task.createdAt).getTime() < 3000);
    if (duplicate) { setNotice("相同生成请求已在队列中。"); return; }
    try {
      const promptContext = selectAiContext({ articles: [studio.currentArticle] }, studio.currentOutline.id, "content", {
        includePrevious,
        includeCharacters,
        includeExcellentFragments,
        excellentFragmentIds,
        contentMode: generationMode,
        instruction: prompt,
        currentPlan: outlinePlanDraft,
        firstAppearanceCharacterIds: effectiveFirstAppearanceIds,
      });
      await createServerTask(studio, {
        articleId: studio.currentArticle.id,
        chapterId: studio.currentChapter.id,
        outlineId: studio.currentOutline.id,
        target: "content",
        instruction: prompt.trim().slice(0, 20_000),
        model: selectedModelReference,
        reasoningEffort,
        includePrevious,
        includeCharacters,
        includeExcellentFragments,
        includeOutlineTitle,
        excellentFragmentIds,
        estimatedCharacters: summary.total,
        targetWords,
        contentMode: generationMode,
        rewriteRetention: generationMode === "rewrite" ? rewriteRetention : undefined,
        proseControls,
        dialogueDensity: proseControls.dialogueDensity,
        reviewRuleSnapshot: createReviewRuleSnapshot(studio.currentArticle, normalizeReviewRules(reviewInstruction)),
        reviewMaxRounds,
        reviewInstruction: normalizeReviewRules(reviewInstruction),
        firstAppearanceCharacterIds: effectiveFirstAppearanceIds,
        timeoutMs: selectedRecord?.timeoutMs ?? 600_000,
        promptContext,
        currentPlan: outlinePlanDraft,
        outlineTitleSnapshot: studio.currentOutline.title,
        generateOptions: studio.currentOutline.generateOptions === null ? null : generateOptions,
      });
      lastSyncedOutlineRef.current = { id: studio.currentOutline.id, plan: outlinePlanDraft };
      setPrompt(normalizedPrompt);
      setSavedPrompt(normalizedPrompt);
      setPromptSaveFailed(false);
      setNotice("");
      onTaskCreated();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "AI 任务创建失败");
    }
  }, [prompt, normalizedPrompt, studio, reasoningEffort, selectedModelReference, selectedRecord, includePrevious, includeCharacters, includeExcellentFragments, includeOutlineTitle, excellentFragmentIds, firstAppearanceCharacterIds, summary.total, targetWords, targetWordsValid, generationMode, rewriteRetention, proseControls, reviewMaxRounds, reviewInstruction, reviewStrategy, hasCurrentContent, outlinePlanDraft, generateOptions, onTaskCreated]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "Enter") { event.preventDefault(); void submit(); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [submit]);

  return (
    <div className="generate-view">
      <div className="generate-page">
        <section className="generate-command-card">
          {studio.currentOutline.generateOptions && <div className="generate-settings-source" role="status">
            <span><Icon name="settings" /><span>正在使用此大纲最近的 Generate 设置</span></span>
            <Button variant="subtle" size="compact-sm" type="button" onClick={resetGenerateOptions}>恢复文章预设</Button>
          </div>}
          <section className="generate-outline-editor">
            <div className="generate-outline-editor-heading">
              <label htmlFor="generate-outline-plan">大纲内容</label>
              <span>{outlinePlanDraft.length.toLocaleString("zh-CN")} / 10,000</span>
            </div>
            <Textarea
              ref={outlinePlanHeightRef}
              id="generate-outline-plan"
              aria-label="生成使用的大纲内容"
              className="generate-outline-plan-control"
              classNames={{ input: "generate-outline-plan-input" }}
              maxLength={10000}
              rows={6}
              value={outlinePlanDraft}
              onChange={(event) => { outlinePlanDraftRef.current = event.target.value; setOutlinePlanDraft(event.target.value); }}
            />
            {(outlinePlanDirty || outlineSaving) && <div className="generate-outline-save-row">
              <span className={`generate-outline-save-state ${outlinePlanDirty ? "unsaved" : "saved"}`}>{outlineSaving ? "正在保存…" : outlinePlanDirty ? "有未保存修改" : "已保存"}</span>
              <Button className="generate-outline-save-button" variant={outlinePlanDirty ? "light" : "subtle"} size="compact-sm" type="button" leftSection={<Icon name="check" />} disabled={!outlinePlanDirty || outlineSaving} loading={outlineSaving} onClick={() => void saveOutlineDraft()}>保存大纲</Button>
            </div>}
            <div className="generate-outline-resize-divider">
              <button
                className="generate-outline-resize-handle"
                type="button"
                aria-label="拖动横线中段调整大纲输入框高度"
                title="拖动横线中段调整大纲输入框高度"
                onPointerDown={startOutlineResize}
                onPointerMove={moveOutlineResize}
                onPointerUp={stopOutlineResize}
                onPointerCancel={stopOutlineResize}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  const height = outlinePlanHeightRef.current?.getBoundingClientRect().height;
                  if (height !== undefined) resizeOutlinePlan(height + (event.key === "ArrowDown" ? 20 : -20));
                }}
              />
            </div>
          </section>
          <section className="generate-mode-section" aria-labelledby="generate-mode-heading">
            <div className="generate-mode-heading"><span id="generate-mode-heading">生成方式</span></div>
            <div className="generate-mode-options" role="radiogroup" aria-label="正文生成方式">
              {contentGenerationModes.map((item) => {
                const disabled = item.value !== "fresh" && !hasCurrentContent;
                return <button className={generationMode === item.value ? "selected" : ""} type="button" role="radio" aria-checked={generationMode === item.value} aria-label={`${item.label}：${item.mobileDescription}`} disabled={disabled} key={item.value} onClick={() => rememberGenerateOptions({ contentMode: item.value })}><span className="ui-title">{item.label}</span></button>;
              })}
            </div>
            <p className="generate-mode-description">{contentGenerationModes.find((item) => item.value === generationMode)?.mobileDescription}</p>
            {generationMode === "rewrite" && <p className="generate-mode-hint">原正文：{resolvedOutlineContentName(studio.currentOutline)}</p>}
            {!hasCurrentContent && <p className="generate-mode-hint">当前正文为空，只能使用全新生成。</p>}
          </section>
          {generationMode === "rewrite" && <section className="rewrite-retention-control" aria-labelledby="rewrite-retention-heading">
            <div className="rewrite-retention-heading">
              <div><span id="rewrite-retention-heading">原文保留度</span><small>控制改写幅度，不代表精确相似度</small></div>
              <strong>{rewriteRetentionOption.label} · {rewriteRetentionOption.shortLabel}</strong>
            </div>
            <Slider
              thumbLabel="原文保留度"
              thumbValueText={(value) => rewriteRetentionOptions[value]?.shortLabel ?? "平衡改写"}
              min={0}
              max={rewriteRetentionOptions.length - 1}
              step={1}
              marks={rewriteRetentionOptions.map((item, index) => ({ value: index, label: item.label }))}
              value={rewriteRetentionIndex}
              label={(value) => rewriteRetentionOptions[value]?.shortLabel ?? "平衡改写"}
              onChange={(value) => rememberGenerateOptions({ rewriteRetention: rewriteRetentionOptions[value]?.value ?? DEFAULT_REWRITE_RETENTION_LEVEL })}
            />
            <p>{rewriteRetentionOption.description}</p>
            {targetWords !== undefined && Math.abs(targetWords - resolvedOutlineContent(studio.currentOutline).length) > Math.max(500, resolvedOutlineContent(studio.currentOutline).length * .35) && <small className="rewrite-retention-warning">目标字数与原文长度差异较大，实际保留度可能降低。</small>}
          </section>}
          <section className="prose-controls-section" aria-labelledby="prose-controls-heading">
            <div className="generate-section-heading"><span id="prose-controls-heading">正文表达</span><strong>写作倾向</strong></div>
            <p>各项不代表精确比例；发生冲突时以大纲、人物事实和本次指令为先。</p>
            <div className="prose-controls-grid">
              <ProseControlRow id="dialogue-density" label="对话密度" value={proseControls.dialogueDensity} options={DIALOGUE_DENSITY_OPTIONS} onChange={(dialogueDensity) => rememberGenerateOptions({ proseControls: { ...proseControls, dialogueDensity } })} className="dialogue-density-control" />
              <ProseControlRow id="introspection-density" label="内心活动" value={proseControls.introspectionDensity} options={INTROSPECTION_DENSITY_OPTIONS} onChange={(introspectionDensity) => rememberGenerateOptions({ proseControls: { ...proseControls, introspectionDensity } })} />
              <ProseControlRow id="description-detail" label="描写细度" value={proseControls.descriptionDetail} options={DESCRIPTION_DETAIL_OPTIONS} onChange={(descriptionDetail) => rememberGenerateOptions({ proseControls: { ...proseControls, descriptionDetail } })} />
              <ProseControlRow id="narrative-pace" label="叙事节奏" value={proseControls.narrativePace} options={NARRATIVE_PACE_OPTIONS} onChange={(narrativePace) => rememberGenerateOptions({ proseControls: { ...proseControls, narrativePace } })} />
              <ProseControlRow id="paragraph-length" label="段落长度" value={proseControls.paragraphLength} options={PARAGRAPH_LENGTH_OPTIONS} onChange={(paragraphLength) => rememberGenerateOptions({ proseControls: { ...proseControls, paragraphLength } })} />
            </div>
            {generationMode === "continue" && <small>这些控制仅影响新增正文，已有正文保持原样。</small>}
            {generationMode === "rewrite" && rewriteRetention === "high" && hasActiveProseControls(proseControls) && <small>优先保留原文结构，正文表达控制只作有限调整。</small>}
            {!selectedModelReference && hasActiveProseControls(proseControls) && <small>本地演示引擎不执行正文表达控制，使用配置的模型后生效。</small>}
          </section>
          <div className="generate-option-bar">
            <NumberInput className="generate-word-count" label={generationMode === "continue" ? "新增目标字数" : "目标字数"} error={targetWordsValid ? undefined : `${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数`} aria-label={generationMode === "continue" ? "续写新增目标字数" : "正文目标字数"} min={0} max={MAX_GENERATE_TARGET_WORDS} step={100} thousandSeparator="," suffix=" 字" placeholder="不限" hideControls={compact} value={targetWordsInput} onChange={(value) => { const next = String(value); setTargetWordsInput(next); const parsed = Number(next); if (next.trim() === "" || parsed === 0) rememberGenerateOptions({ targetWords: 0 }); else if (Number.isInteger(parsed) && parsed >= MIN_GENERATE_TARGET_WORDS && parsed <= MAX_GENERATE_TARGET_WORDS) rememberGenerateOptions({ targetWords: parsed }); }} onBlur={() => { const parsed = Number(targetWordsInput); if (targetWordsInput.trim() === "" || parsed === 0) { setTargetWordsInput(""); rememberGenerateOptions({ targetWords: 0 }); } else if (!Number.isInteger(parsed) || parsed < MIN_GENERATE_TARGET_WORDS || parsed > MAX_GENERATE_TARGET_WORDS) setTargetWordsInput(generateOptionsRef.current.targetWords > 0 ? String(generateOptionsRef.current.targetWords) : ""); }} />
            <Button className="manage-generate-presets" variant="default" size="sm" onClick={() => setPresetManagerOpen(true)}>管理预设</Button>
          </div>
          {studio.data.settings.generatePresets.length > 0 && <div className="generate-quick-prompts" aria-label="自定义预设场景">{studio.data.settings.generatePresets.map((item) => <Button variant="light" size="compact-sm" type="button" key={item} onClick={() => setPrompt(item)}>{item}</Button>)}</div>}
          <div className="generate-reference-bar" aria-label="生成参考设置">
            <button className="generate-context-summary" type="button" onClick={() => setContextOpen(true)}><Icon name="book" /><span className="generate-context-copy"><span className="ui-title">上下文 {summary.total.toLocaleString("zh-CN")} 字符</span><small>{summary.previousCount} 条前序大纲 · {summary.characterCount} 位人物</small></span><Icon name="chevron" /></button>
            <Button className="generate-first-appearance-edit" variant="default" size="sm" type="button" onClick={() => setAppearanceEditorOpen(true)}>人物出场{firstAppearanceCharacters.length ? ` · ${firstAppearanceCharacters.length}` : ""}</Button>
          </div>
          <div className="generate-prompt-label">
            <span>补充指令（可选） <small>{prompt.length.toLocaleString("zh-CN")} / 20,000</small></span>
            <Textarea ref={instructionHeightRef} maxLength={20000} rows={4} value={prompt} onChange={(event) => { setPrompt(event.target.value); setPromptSaveFailed(false); }} placeholder={generationMode === "rewrite" ? "说明改写方向和需要保留的内容" : generationMode === "continue" ? "说明接下来要发生的情节或节奏" : "补充生成要求"} />
            {(promptDirty || promptSaving || promptSaveFailed) && <div className="generate-instruction-save-row">
              <span className={`generate-instruction-save-state ${promptSaveFailed ? "failed" : promptDirty ? "unsaved" : "saved"}`}>{promptSaving ? "正在保存…" : promptSaveFailed ? "保存失败，请重试" : promptDirty ? "有未保存修改" : "已保存"}</span>
              <Button className="generate-instruction-save-button" variant={promptDirty ? "light" : "subtle"} size="compact-sm" type="button" leftSection={<Icon name="check" />} disabled={!promptDirty || promptSaving} loading={promptSaving} onClick={() => void saveGenerateInstruction()}>保存指令</Button>
            </div>}
          </div>
          <section className="generate-advanced-options" aria-labelledby="generate-reference-heading">
            <div className="generate-section-heading"><span id="generate-reference-heading">参考与推理</span></div>
            <div className="generate-advanced-options-body">
              <label className="generate-excellent-fragments-toggle">
                <input aria-label="参考优秀片段" type="checkbox" checked={includeExcellentFragments} disabled={availableExcellentFragmentCount === 0} onChange={(event) => rememberGenerateOptions({ includeExcellentFragments: event.currentTarget.checked })} />
                <span><span className="ui-label">参考优秀片段</span><small>{availableExcellentFragmentCount > 0 ? `${availableExcellentFragmentCount} 个可用` : "暂无优秀片段"}</small></span>
              </label>
              <label className="generate-outline-title-toggle">
                <input aria-label="同时生成大纲名" type="checkbox" checked={includeOutlineTitle} onChange={(event) => rememberGenerateOptions({ includeOutlineTitle: event.currentTarget.checked })} />
                <span><span className="ui-label">同时生成大纲名</span><small>遵循大纲命名设置</small></span>
              </label>
              <div className="generate-reasoning-options"><ReasoningSettings value={reasoningEffort} modelValue={selectedRecord?.reasoningEffort} onChange={(value) => rememberGenerateOptions({ reasoningEffort: value })} /></div>
            </div>
          </section>
          <div className="generate-submit-zone">
            <div className="generate-submit-row">
              <div className="generate-model-control"><Select aria-label="本次模型" data={modelOptions} value={selectedModelReference} allowDeselect={false} onChange={(value) => selectGenerateModel(value ?? "")} />{selectedModelReference && !selectedRecord?.hasSecret && <small>需要载入密钥</small>}</div>
              <Button className="generate-submit-button" leftSection={<Icon name="spark" />} size="md" type="button" disabled={!targetWordsValid || generationMode !== "fresh" && !hasCurrentContent} onClick={() => void submit()}>开始生成</Button>
            </div>
            <p className="generate-auto-apply-note">{selectedModelReference ? studio.data.settings.preparationRequireConfirmation === true ? "先整理写作准备稿，确认后生成正文；完成后更新当前正文，旧版本保留。" : "先整理写作准备稿，无待答问题后自动写正文；完成后更新当前正文，旧版本保留。" : "演示生成完成后更新当前正文，旧版本保留。"}</p>
          </div>
        </section>

        <ScrollableDrawer
          scrollMode="content"
          opened={contextOpen}
          onClose={() => setContextOpen(false)}
          closeButtonProps={{ "aria-label": "关闭生成上下文" }}
          title="本次生成上下文"
          position={compact ? "bottom" : "right"}
          size={compact ? "80dvh" : 430}
          classNames={{ content: "ws-drawer-content", header: "ws-drawer-header", body: "ws-drawer-body" }}
          overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
        >
          <div className="generate-context-panel" data-ui-overlay-scroll aria-label="正文生成上下文">
            <Text size="xs" c="dimmed">预计发送 {summary.total.toLocaleString("zh-CN")} 字符</Text>
            <ContextCard summary={summary} contentMode={generationMode} includePrevious={includePrevious} includeCharacters={includeCharacters} includeExcellentFragments={includeExcellentFragments} onPrevious={(value) => rememberGenerateOptions({ includePrevious: value })} onCharacters={(value) => rememberGenerateOptions({ includeCharacters: value })} onExcellentFragments={(value) => rememberGenerateOptions({ includeExcellentFragments: value })} />
            <div className="context-preview"><span>当前大纲</span><span className="ui-title">{displayTitle}</span><p>{outlinePlanDraft || "尚未填写大纲内容"}</p></div>
          </div>
        </ScrollableDrawer>

        {interactiveTask && <TaskInteraction key={`${interactiveTask.id}:${interactiveTask.contextOptions!.writingPreparation!.revision}`} task={interactiveTask} />}
        {(activeTasks.length > 0 || latestFailed) && <section className="generate-task-section">
          <div className="generate-results-title"><div><span>任务</span><h3>进行中</h3></div><button type="button" onClick={onOpenTasks}>查看全部 AI 任务 →</button></div>
          {activeTasks.map((task, index) => <article className="generation-card running-card" key={task.id}><div className="generation-state"><span className={`state-dot ${isTaskAwaitingAuthor(task) ? "awaiting-author" : task.state}`} />{isTaskAwaitingAuthor(task) ? taskPhaseLabels[task.phase!] : task.state === "waiting" ? `等待中 · 队列第 ${index + 1} 位` : taskPhaseLabels[task.phase ?? "generating"]}</div><span className="ui-title">{task.prompt || "按大纲生成"}</span><p>{contentGenerationModeLabel(task.contextOptions?.contentMode)}{task.contextOptions?.contentMode === "rewrite" ? ` · 原文保留 ${rewriteRetentionLabel(task.contextOptions.rewriteRetention)}` : ""} · {modelDisplayLabel(models, task.model || "", task.contextOptions?.modelName)} · {proseControlsSummary(task.contextOptions)} · 目标 {generateTargetWordsLabel(task.contextOptions?.targetWords)} · 上下文约 {task.contextOptions?.estimatedCharacters?.toLocaleString("zh-CN") ?? "—"} 字符{task.contextOptions?.includeOutlineTitle ? " · 同时生成大纲名" : ""}</p><TaskHistory task={task} collapsible /><div className="generation-progress"><span /></div><button type="button" onClick={() => { void changeGenerateTaskState(task, "cancel"); }}>取消任务</button></article>)}
          {!activeTasks.length && latestFailed && <article className="generation-card failed-generation-card"><div className="generation-state"><span className="state-dot failed" />需要处理</div><span className="ui-title">{latestFailed.prompt || "按大纲生成"}</span><p>{latestFailed.error || "生成失败"}</p><div className="candidate-actions"><button type="button" onClick={() => setPrompt(latestFailed.prompt)}>编辑指令</button><button type="button" onClick={() => { void changeGenerateTaskState(latestFailed, "retry"); }}>原样重试</button></div></article>}
        </section>}

        {notice && <div className="generate-inline-notice" role="status"><Icon name="check" />{notice}</div>}
      </div>
      {presetManagerOpen && <GeneratePresetDialog presets={studio.data.settings.generatePresets} onClose={() => setPresetManagerOpen(false)} onSave={(presets) => { studio.updateSettings({ generatePresets: presets }); setPresetManagerOpen(false); }} />}
      {appearanceEditorOpen && <FirstAppearanceDialog
        characters={activeCharacters}
        suggestions={appearanceSuggestions}
        selectedIds={firstAppearanceCharacterIds}
        overrides={appearanceOverrides}
        onChange={(characterId, firstAppearance) => rememberGenerateOptions({ firstAppearanceOverrides: { ...appearanceOverrides, [characterId]: firstAppearance } })}
        onReset={() => rememberGenerateOptions({ firstAppearanceOverrides: {} })}
        onClose={() => setAppearanceEditorOpen(false)}
      />}
    </div>
  );
}

function FirstAppearanceDialog({ characters, suggestions, selectedIds, overrides, onChange, onReset, onClose }: {
  characters: Character[];
  suggestions: FirstAppearanceSuggestion[];
  selectedIds: string[];
  overrides: Record<string, boolean>;
  onChange: (characterId: string, firstAppearance: boolean) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [query, setQuery] = useState("");
  const suggestionMap = useMemo(() => new Map(suggestions.map((item) => [item.characterId, item])), [suggestions]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = characters.filter((character) => `${character.name}\n${character.aliases.join("\n")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const ordered = [...filtered].sort((left, right) => {
    const leftRelevant = suggestionMap.has(left.id) || Object.prototype.hasOwnProperty.call(overrides, left.id) ? 0 : 1;
    const rightRelevant = suggestionMap.has(right.id) || Object.prototype.hasOwnProperty.call(overrides, right.id) ? 0 : 1;
    return leftRelevant - rightRelevant || left.name.localeCompare(right.name, "zh-CN");
  });

  return <ResponsiveModal
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭首次出场人物编辑" }}
    title="首次出场人物"
    size="lg"
    fullScreen={compact}
    centered={!compact}
    classNames={{ content: "first-appearance-dialog ws-modal-content", header: "ws-modal-header", body: "first-appearance-dialog-body" }}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
  >
    <Text size="sm" c="dimmed">系统只搜索当前大纲之前的未归档大纲，不搜索正文。你的选择优先，并会随本次生成任务保存。</Text>
    <TextInput mt="md" label="搜索人物" placeholder="输入姓名或别名" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="first-appearance-list">
      {ordered.map((character) => {
        const suggestion = suggestionMap.get(character.id);
        const isOverridden = Object.prototype.hasOwnProperty.call(overrides, character.id);
        const checked = selected.has(character.id);
        const reason = suggestion?.previousMatch
          ? `此前在「${suggestion.previousMatch.outlineTitle}」匹配“${suggestion.previousMatch.matchedReference}”`
          : suggestion
            ? "当前大纲或补充指令提及；前序大纲未找到"
            : "当前大纲与补充指令未识别；可手动指定";
        const status = isOverridden ? checked ? "已改为首次" : "已改为非首次" : suggestion ? suggestion.firstAppearance ? "自动：首次" : "自动：非首次" : "未涉及";
        return <div className="first-appearance-row" key={character.id}>
          <Checkbox aria-label={`${character.name}首次出场`} checked={checked} onChange={(event) => onChange(character.id, event.target.checked)} />
          <div><span className="ui-title">{character.name}</span>{character.aliases.length > 0 && <span>{character.aliases.join("、")}</span>}<small>{reason}</small></div>
          <em className={checked ? "first" : "established"}>{status}</em>
        </div>;
      })}
      {!ordered.length && <p className="first-appearance-empty">没有匹配的人物。</p>}
    </div>
    <Group justify="space-between" mt="md">
      <Button variant="subtle" type="button" disabled={!Object.keys(overrides).length} onClick={onReset}>恢复自动判断</Button>
      <Button type="button" onClick={onClose}>完成</Button>
    </Group>
  </ResponsiveModal>;
}

function GeneratePresetDialog({ presets, onClose, onSave }: { presets: string[]; onClose: () => void; onSave: (presets: string[]) => void }) {
  const [items, setItems] = useState([...presets]);
  const listRef = useRef<HTMLDivElement>(null);
  const compact = useMediaQuery("(max-width: 767px)") ?? false;

  function addPreset() {
    setItems((current) => [...current, ""]);
    window.requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLTextAreaElement>("textarea").item(items.length)?.focus());
  }

  return <ResponsiveModal
    scrollMode="content"
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭预设管理" }}
    title="生成预设"
    size="lg"
    fullScreen={compact}
    centered={!compact}
    classNames={{ content: "generate-preset-dialog ws-modal-content", header: "ws-modal-header", body: "generate-preset-modal-body" }}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
  >
    <div className="generate-preset-list" data-ui-overlay-scroll ref={listRef}>
      {items.map((item, index) => <div className="generate-preset-row" key={index}>
        <Textarea autosize minRows={2} maxRows={5} aria-label={`预设 ${index + 1}`} maxLength={MAX_GENERATE_PRESET_CHARACTERS} value={item} onChange={(event) => setItems((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} />
        <Button variant="subtle" color="red" type="button" aria-label={`删除预设 ${index + 1}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>删除</Button>
      </div>)}
    </div>
    <Button className="add-generate-preset" variant="default" type="button" disabled={items.length >= MAX_GENERATE_PRESETS} onClick={addPreset}>新增预设</Button>
    <Group className="generate-preset-actions" justify="flex-end" mt="md">
      <Button variant="default" type="button" onClick={onClose}>取消</Button>
      <Button type="button" onClick={() => onSave(normalizeGeneratePresets(items))}>保存预设</Button>
    </Group>
  </ResponsiveModal>;
}

function ContextCard({ summary, contentMode, includePrevious, includeCharacters, includeExcellentFragments, onPrevious, onCharacters, onExcellentFragments }: { summary: GenerateContextSummary; contentMode: ContentGenerationMode; includePrevious: boolean; includeCharacters: boolean; includeExcellentFragments: boolean; onPrevious: (value: boolean) => void; onCharacters: (value: boolean) => void; onExcellentFragments: (value: boolean) => void }) {
  const fixed = [["文章信息", summary.article], ["当前章节", summary.chapter], ["当前大纲", summary.outline], ["前一条正文", summary.previousContent]] as const;
  return (
    <div className="context-card">
      <div><span className="ui-label">内容类别</span><span>发送前预计</span></div>
      {fixed.map(([label, characters]) => <label key={label}><input type="checkbox" checked readOnly disabled />{label}<span>{characters.toLocaleString("zh-CN")} 字符</span></label>)}
      <label><input type="checkbox" checked={contentMode !== "fresh"} readOnly disabled />当前正文<span>{contentMode === "fresh" ? "全新生成不发送" : `${summary.content.toLocaleString("zh-CN")} 字符`}</span></label>
      <label><input type="checkbox" checked={includePrevious} onChange={(event) => onPrevious(event.target.checked)} />前面大纲<span>{summary.previousCount} 条 · {summary.previous.toLocaleString("zh-CN")} 字符</span></label>
      <label><input type="checkbox" checked={includeCharacters} onChange={(event) => onCharacters(event.target.checked)} />相关人物<span>{summary.characterCount} 位 · {summary.characters.toLocaleString("zh-CN")} 字符</span></label>
      <label><input type="checkbox" checked={includeExcellentFragments} onChange={(event) => onExcellentFragments(event.target.checked)} />参考优秀片段<span>{summary.excellentFragmentCount} 个 · {summary.excellentFragments.toLocaleString("zh-CN")} 字符</span></label>
      <label><input type="checkbox" checked readOnly disabled />生成指令<span>{summary.instruction.toLocaleString("zh-CN")} 字符</span></label>
    </div>
  );
}

function chatInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}

function ChatMessageContent({ text }: { text: string }) {
  return <div className="message-content">{text.split("\n").map((line, index) => {
    if (!line.trim()) return <span className="message-break" key={index} />;
    if (/^#{1,3}\s/.test(line)) return <h4 key={index}>{chatInline(line.replace(/^#{1,3}\s/, ""))}</h4>;
    if (/^>\s?/.test(line)) return <blockquote key={index}>{chatInline(line.replace(/^>\s?/, ""))}</blockquote>;
    if (/^(?:[-*]|\d+\.)\s/.test(line)) return <div className="message-list-row" key={index}><span>•</span><p>{chatInline(line.replace(/^(?:[-*]|\d+\.)\s/, ""))}</p></div>;
    return <p key={index}>{chatInline(line)}</p>;
  })}</div>;
}

function ChatView({ models, outlineId, outlineTitle, onUseAsGenerate, onNotice }: { models: ConfiguredModel[]; outlineId?: string; outlineTitle: string; onUseAsGenerate: (text: string) => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const outline = studio.currentArticle.chapters.flatMap((chapter) => chapter.outlines).find((item) => item.id === outlineId) ?? studio.currentOutline;
  const chatModelRecord = configuredModelForReference(models, studio.data.settings.chatModel);
  const chatModelReference = chatModelRecord?.id ?? studio.data.settings.chatModel.trim();
  const chatbotName = chatbotDisplayName(models, chatModelReference);
  const session = activeChatSession(outline);
  const message = session?.draft ?? "";
  const activeChatTask = studio.data.tasks.find((task) => task.target === "AI Chat" && task.outlineId === outline.id && (task.state === "waiting" || task.state === "running"));
  const sessionChatTask = activeChatTask?.contextOptions?.sessionId === session?.id ? activeChatTask : undefined;
  const isStreaming = Boolean(activeChatTask);
  const [localStreaming, setLocalStreaming] = useState<{ taskId: string; text: string } | null>(null);
  const streaming = localStreaming && localStreaming.taskId === sessionChatTask?.id ? localStreaming.text : sessionChatTask?.resultText ?? "";
  const [contextOpen, setContextOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  useDismissOnOutside(sessionsOpen || sessionMenuOpen, () => { setSessionsOpen(false); setSessionMenuOpen(false); }, ".chat-session-switcher, .chat-session-actions, .chat-session-popover, .chat-session-menu");
  useDismissOnOutside(toolsOpen || contextOpen, () => { setToolsOpen(false); setContextOpen(false); }, ".composer-context-chip, .composer-icon-button, .chat-tools-popover, .chat-context-panel");
  const [messageMenuId, setMessageMenuId] = useState("");
  useDismissOnOutside(Boolean(messageMenuId), () => setMessageMenuId(""), ".message-action-trigger, .message-action-menu");
  const [editingMessage, setEditingMessage] = useState<{ sessionId: string; messageId: string; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatThreadRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const currentStream = useRef<ChatStreamState | null>(null);
  const submissionLock = useRef("");
  const [submittingTaskId, setSubmittingTaskId] = useState("");
  const [chatResponseStage, setChatResponseStage] = useState<ChatResponseStage | null>(null);
  const isSubmitting = Boolean(submittingTaskId);
  const chatBusy = isStreaming || isSubmitting;
  const currentResponseStage = chatResponseStage && chatResponseStage.taskId === sessionChatTask?.id ? chatResponseStage.stage : null;
  const restoringChat = Boolean(activeChatTask && !currentResponseStage && !activeChatStreams.has(activeChatTask.id));
  const waitingForFirstToken = currentResponseStage === "waiting-first-token" || sessionChatTask?.phase === "generating";
  const chatProgressLabel = isSubmitting
    ? "正在提交"
    : sessionChatTask?.phase === "saving"
      ? "正在保存回复"
      : currentResponseStage === "recovering" || restoringChat && !sessionChatTask?.contextOptions?.serverManaged
        ? "正在核对任务状态"
        : streaming
      ? "正在回复"
      : waitingForFirstToken
        ? "等待首字"
        : activeChatTask ? "正在请求模型" : "正在回复";
  const chatProgressText = streaming || (currentResponseStage === "recovering" || restoringChat && !sessionChatTask?.contextOptions?.serverManaged ? "正在恢复聊天状态，请稍候…" : isSubmitting
    ? "正在保存消息并创建任务…"
    : waitingForFirstToken
      ? "模型已响应，正在等待首字…"
      : activeChatTask ? "正在向模型发送请求…" : "正在思考…");
  let chatContext: ReturnType<typeof selectAiContext> | undefined;
  try {
    chatContext = selectAiContext({ articles: [studio.currentArticle] }, outline.id, "chat", { includePrevious: session?.includePrevious, includeCharacters: session?.includeCharacters, sessionId: session?.id });
  } catch { /* The active UI never intentionally opens an archived target. */ }
  const previous = chatContext?.previousOutlines ?? [];
  const matchedCharacters = chatContext?.characters ?? [];
  const contextCharacters = chatContext ? summarizeAiContext(chatContext, message).total : 0;
  const quickPrompts = ["分析当前冲突", "检查人物动机", "寻找逻辑漏洞", "建议下一步"];

  function resizeComposer(target = composerRef.current) {
    if (!target) return;
    target.style.height = "auto";
    target.style.height = `${Math.min(156, Math.max(30, target.scrollHeight))}px`;
  }

  useEffect(() => { resizeComposer(); }, [message]);
  useEffect(() => {
    const thread = chatThreadRef.current;
    if (!thread) return;
    const frame = window.requestAnimationFrame(() => {
      thread.scrollTop = thread.scrollHeight;
      threadEndRef.current?.scrollIntoView({ block: "end", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [session?.id, session?.messages.length, streaming]);
  useEffect(() => {
    if (session && chatSessionHasUnread(session)) studio.markChatSessionRead(outline.id, session.id);
  }, [outline.id, session, studio]);

  function applyChatTransaction(payload: { revision: number; task: AiTask | Partial<AiTask>; messages?: Message[]; message?: Message; sessionTitle?: string; sessionUpdatedAt?: string }, taskId: string, sessionId: string) {
    studio.acceptServerMutation(payload.revision, (current) => ({
      ...current,
      articles: current.articles.map((article) => ({
        ...article,
        chapters: article.chapters.map((chapter) => ({
          ...chapter,
          outlines: chapter.outlines.map((item) => item.id !== outline.id ? item : ({
            ...item,
            chat: {
              ...item.chat,
              sessions: item.chat.sessions.map((candidate) => candidate.id !== sessionId ? candidate : ({
                ...candidate,
                title: payload.sessionTitle ?? candidate.title,
                draft: "",
                updatedAt: payload.sessionUpdatedAt ?? candidate.updatedAt,
                messages: payload.messages ?? (payload.message && !candidate.messages.some((entry) => entry.id === payload.message!.id) ? [...candidate.messages, payload.message] : candidate.messages),
              })),
            },
          })),
        })),
      })),
      tasks: current.tasks.some((item) => item.id === taskId)
        ? current.tasks.map((item) => item.id === taskId ? { ...item, ...payload.task } as AiTask : item)
        : [payload.task as AiTask, ...current.tasks].slice(0, 20),
    }));
  }

  async function finalizeChat(stream: ChatStreamState, status: "success" | "failed" | "cancelled", error = "", stopped = false) {
    const response = await sendChatCompletion(`/api/outlines/${encodeURIComponent(outline.id)}/chat/transactions`, {
      action: "finalize", taskId: stream.taskId, sessionId: stream.sessionId, status, result: stream.result, error, stopped, chatbotName,
    });
    const payload = await response.json() as { revision?: number; task?: Partial<AiTask>; message?: Message; sessionUpdatedAt?: string; error?: string };
    if (!response.ok || payload.revision === undefined || !payload.task) throw new Error(payload.error || "聊天结果保存失败");
    applyChatTransaction({ revision: payload.revision, task: payload.task, message: payload.message, sessionUpdatedAt: payload.sessionUpdatedAt }, stream.taskId, stream.sessionId);
    setLocalStreaming((current) => current?.taskId === stream.taskId ? null : current);
    setChatResponseStage((current) => payload.task?.state === "running" ? { taskId: stream.taskId, stage: "recovering" } : current?.taskId === stream.taskId ? null : current);
  }

  function stopStream(stream: ChatStreamState, stopped = true) {
    if (stream.finalized) return;
    stream.finalized = true;
    stream.controller.abort();
    releaseActiveChatStream(stream.taskId, stream.controller);
    if (currentStream.current === stream) currentStream.current = null;
    setChatResponseStage((current) => current?.taskId === stream.taskId ? null : current);
    if (submissionLock.current === stream.submissionToken) {
      submissionLock.current = "";
      setSubmittingTaskId("");
    }
    void finalizeChat(stream, "cancelled", stopped ? "用户停止了聊天回复" : "", stopped).catch((reason) => onNotice(`停止请求尚未确认，联网后会自动重试：${reason instanceof Error ? reason.message : "连接失败"}`));
  }
  function cancelCurrentChatTask() {
    if (!activeChatTask || cancelActiveChatStream(activeChatTask.id)) return;
    const stream: ChatStreamState = { taskId: activeChatTask.id, sessionId: activeChatTask.contextOptions?.sessionId ?? session?.id ?? "", submissionToken: "", controller: new AbortController(), result: activeChatTask.resultText ?? "", finalized: true };
    void finalizeChat(stream, "cancelled", "用户停止了聊天回复", true).catch((reason) => onNotice(`停止请求尚未确认，联网后会自动重试：${reason instanceof Error ? reason.message : "连接失败"}`));
  }

  async function requestAnswer(question: string, addUser: boolean, targetSessionId = session?.id, targetSession = session) {
    if (!targetSessionId || !targetSession || isStreaming || submissionLock.current || currentStream.current) return;
    if (browserIsOffline()) { onNotice(OFFLINE_OPERATION_MESSAGE); return; }
    const submissionToken = clientId("chat-submit");
    submissionLock.current = submissionToken;
    setSubmittingTaskId("pending");
    const releaseSubmission = () => {
      if (submissionLock.current !== submissionToken) return;
      submissionLock.current = "";
      setSubmittingTaskId("");
    };
    try {
      const taskId = clientId("task");
      setSubmittingTaskId(taskId);
      const userMessage: Message = { id: clientId("message-user"), role: "user", text: question, createdAt: new Date().toISOString() };
      const submittedMessages = addUser ? [...targetSession.messages, userMessage] : targetSession.messages;
      const submittedTitle = addUser && targetSession.title === "新对话" ? question.slice(0, 24) : targetSession.title;
      let promptContext = selectAiContext({ articles: [studio.currentArticle] }, outline.id, "chat", { includePrevious: targetSession.includePrevious, includeCharacters: targetSession.includeCharacters, sessionId: targetSessionId });
      promptContext = { ...promptContext, recentMessages: submittedMessages.slice(-20).map((item) => ({ role: item.role, text: item.text })) };
      const submitResponse = await fetchServerAction(`/api/outlines/${encodeURIComponent(outline.id)}/chat/transactions`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": taskId },
        body: JSON.stringify({ action: "submit", taskId, sessionId: targetSessionId, sessionTitle: submittedTitle, message: question, messages: submittedMessages, model: chatModelReference, reasoningEffort: studio.data.settings.chatReasoningEffort, includePrevious: targetSession.includePrevious, includeCharacters: targetSession.includeCharacters, estimatedCharacters: summarizeAiContext(promptContext, question).total, timeoutMs: chatModelRecord?.timeoutMs ?? 600_000, promptContext }),
      });
      const submitted = await submitResponse.json() as { revision?: number; task?: AiTask; messages?: Message[]; sessionTitle?: string; sessionUpdatedAt?: string; error?: string };
      if (!submitResponse.ok || submitted.revision === undefined || !submitted.task || !submitted.messages) throw new Error(submitted.error || "消息提交失败");
      applyChatTransaction({ revision: submitted.revision, task: submitted.task, messages: submitted.messages, sessionTitle: submitted.sessionTitle, sessionUpdatedAt: submitted.sessionUpdatedAt }, taskId, targetSessionId);
      releaseSubmission();
      const controller = new AbortController();
      const responseDeadline = window.setTimeout(() => controller.abort("response-timeout"), Math.max(1_000, (submitted.task.timeoutMs ?? 600_000) + 15_000));
      const stream: ChatStreamState = { taskId, sessionId: targetSessionId, submissionToken, controller, result: "", finalized: false };
      currentStream.current = stream;
      registerActiveChatStream(taskId, { controller, cancel: () => stopStream(stream, true) });
      setChatResponseStage({ taskId, stage: "requesting-model" });
      try {
        if (controller.signal.aborted) return;
        const response = await fetchFromServer(`/api/outlines/${encodeURIComponent(outline.id)}/chat/stream`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "Idempotency-Key": taskId }, body: JSON.stringify({ requestId: taskId, message: question, sessionId: targetSessionId, model: chatModelReference, reasoningEffort: studio.data.settings.chatReasoningEffort, includePrevious: targetSession.includePrevious, includeCharacters: targetSession.includeCharacters, context: promptContext }) });
        if (!response.ok || !response.body) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error || `${chatbotName} 失败（${response.status}）`); }
        setChatResponseStage({ taskId, stage: "waiting-first-token" });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            stream.result += decoder.decode();
            break;
          }
          const decoded = decoder.decode(value, { stream: true });
          // The local stream uses a record separator so the UI can finish even when
          // a development proxy delays the response close or strips custom headers.
          const terminatorIndex = decoded.indexOf("\u001e");
          stream.result += terminatorIndex >= 0 ? decoded.slice(0, terminatorIndex) : decoded;
          if (stream.result) setChatResponseStage((current) => current?.taskId === taskId ? null : current);
          setLocalStreaming({ taskId, text: stream.result });
          if (terminatorIndex >= 0) {
            void reader.cancel();
            break;
          }
        }
        if (controller.signal.aborted) return;
        if (!stream.result) throw new Error(`${chatbotName} 返回了空结果`);
        stream.finalized = true;
        await finalizeChat(stream, "success");
      } catch (error) {
        if (!controller.signal.aborted || controller.signal.reason === "response-timeout") {
          stream.finalized = true;
          const errorMessage = controller.signal.reason === "response-timeout" ? "等待聊天响应超时，正在核对服务端结果" : error instanceof Error ? error.message : "请求失败";
          await finalizeChat(stream, "failed", errorMessage);
        }
      } finally {
        window.clearTimeout(responseDeadline);
        releaseActiveChatStream(taskId, controller);
        if (currentStream.current === stream) currentStream.current = null;
        setChatResponseStage((current) => current?.taskId === taskId && current.stage !== "recovering" ? null : current);
        stream.finalized = true;
      }
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : "聊天结果尚未确认，联网后会自动核对");
      void studio.refreshFromServer();
    } finally {
      releaseSubmission();
    }
  }

  async function send() {
    const question = message.trim();
    if (!question || chatBusy || editingMessage) return;
    await requestAnswer(question, true);
  }

  async function submitEditedMessage() {
    if (!editingMessage || chatBusy) return;
    const sourceSession = outline.chat.sessions.find((item) => item.id === editingMessage.sessionId);
    const messageIndex = sourceSession?.messages.findIndex((item) => item.id === editingMessage.messageId) ?? -1;
    const originalMessage = messageIndex >= 0 ? sourceSession?.messages[messageIndex] : undefined;
    const editedText = editingMessage.text.trim();
    if (!sourceSession || !originalMessage || originalMessage.role !== "user" || !editedText) return;
    const messages = [...sourceSession.messages.slice(0, messageIndex), { ...originalMessage, text: editedText }];
    studio.replaceChatMessages(outline.id, messages, sourceSession.id);
    setEditingMessage(null);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    await requestAnswer(editedText, false, sourceSession.id, { ...sourceSession, messages });
  }

  function cancelEditingMessage() {
    setEditingMessage(null);
  }

  async function copyMessage(id: string, text: string) {
    const copied = await copyTextToClipboard(text);
    if (copied) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(""), 1000);
    }
  }

  function branchFrom(messageId: string) {
    cancelEditingMessage();
    if (studio.branchChatSession(outline.id, messageId)) {
      setMessageMenuId("");
      onNotice("已从此消息创建新会话");
    }
  }

  function saveCandidate(text: string) {
    studio.saveVersion(outline.id, timestampContentName(), "AI Chat", text, { model: chatModelRecord ? modelSelectionLabel(chatModelRecord) : chatModelReference, modelId: chatModelRecord?.modelId, prompt: session?.title, manualExcellent: false });
    setMessageMenuId("");
    onNotice("已保存为候选版本");
  }

  async function appendToBody(text: string) {
    if (!window.confirm("把这条 AI 回复追加到当前正文？")) return;
    const currentContent = resolvedOutlineContent(outline);
    const nextContent = `${currentContent.trim()}${currentContent.trim() ? "\n\n" : ""}${text.trim()}`;
    if (!await studio.commitContentEdit(outline.id, nextContent)) return;
    setMessageMenuId("");
    onNotice("已追加并设为当前正文");
  }

  async function attachTextFile(file: File | undefined) {
    if (!file) return;
    const content = (await file.text()).slice(0, 12000);
    studio.setChatDraft(outline.id, `${message}${message.trim() ? "\n\n" : ""}[参考文件：${file.name}]\n${content}`.slice(0, 20000));
    setToolsOpen(false);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  if (!session) return null;

  return (
    <div className="chat-view">
      <header className="chat-header">
        <button className="chat-session-switcher" type="button" aria-haspopup="dialog" aria-expanded={sessionsOpen} onClick={() => { setSessionsOpen((value) => !value); setSessionMenuOpen(false); }}>
          <span className="chat-header-icon"><Icon name="chat" /></span><span><span className="ui-title">{session.title}</span><small>{session.messages.length} 条消息</small></span><Icon name="chevron" />
        </button>
        <div className="chat-header-actions">
          <IconButton name="plus" label="新建 AI Chat 会话" className="chat-new-session" disabled={chatBusy} onClick={() => { if (!chatBusy) { cancelEditingMessage(); studio.createChatSession(outline.id); setSessionsOpen(false); composerRef.current?.focus(); } }} />
          <IconButton name="more" label="会话操作" aria-haspopup="menu" aria-expanded={sessionMenuOpen} onClick={() => { setSessionMenuOpen((value) => !value); setSessionsOpen(false); }} />
        </div>
        {sessionsOpen && <div className="chat-session-popover" role="dialog" aria-label="AI Chat 会话"><div className="chat-session-popover-head"><span className="ui-title">AI Chat 会话</span></div>{outline.chat.sessions.map((item) => <button className={item.id === session.id ? "active" : ""} type="button" key={item.id} disabled={chatBusy} onClick={() => { cancelEditingMessage(); studio.setActiveChatSession(outline.id, item.id); setSessionsOpen(false); }}><span><span className="ui-title">{item.title}</span><small>{item.messages.length} 条 · {formatTime(item.updatedAt)}</small></span>{item.id === session.id && <Icon name="check" />}</button>)}</div>}
        {sessionMenuOpen && <div className="chat-session-menu" role="menu"><button role="menuitem" type="button" onClick={() => { const title = window.prompt("会话名称", session.title); if (title?.trim()) studio.renameChatSession(outline.id, session.id, title); setSessionMenuOpen(false); }}><Icon name="edit" />重命名</button><button role="menuitem" type="button" onClick={() => { if (window.confirm("清空当前会话的全部消息？")) studio.clearChat(outline.id); setSessionMenuOpen(false); }}><Icon name="refresh" />清空消息</button><button role="menuitem" className="danger" type="button" onClick={() => { if (window.confirm("删除当前会话？")) studio.deleteChatSession(outline.id, session.id); setSessionMenuOpen(false); }}><Icon name="trash" />删除会话</button></div>}
      </header>

      <div className="chat-thread" ref={chatThreadRef}>
        {!session.messages.length && !chatBusy && <div className="chat-empty"><span><Icon name="spark" /></span><h2>和 {chatbotName} 讨论「{outlineTitle}」</h2><div>{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => { studio.setChatDraft(outline.id, prompt); composerRef.current?.focus(); }}>{prompt}</button>)}</div></div>}
        {session.messages.map((item, index) => {
          const isError = item.role === "assistant" && item.text.includes("错误：");
          const previousUser = item.role === "assistant" ? [...session.messages.slice(0, index)].reverse().find((candidate) => candidate.role === "user") : null;
          return <article className={`message ${item.role} ${isError ? "error" : ""} ${editingMessage?.sessionId === session.id && editingMessage.messageId === item.id ? "editing" : ""}`} key={item.id}>
            {item.role === "assistant" && <div className="avatar"><Icon name="spark" /></div>}
            <div className="message-body"><div className="message-meta"><span className="ui-label">{item.role === "user" ? "你" : chatbotName}</span>{item.stopped && <span>已停止</span>}</div>
              {editingMessage?.sessionId === session.id && editingMessage.messageId === item.id ? <form className="inline-message-editor" onSubmit={(event) => { event.preventDefault(); void submitEditedMessage(); }}>
                <textarea autoFocus maxLength={20000} value={editingMessage.text} aria-label="编辑聊天消息" onChange={(event) => setEditingMessage({ ...editingMessage, text: event.currentTarget.value })} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelEditingMessage(); } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submitEditedMessage(); } }} />
                <div><span>Ctrl/⌘ + Enter 发送</span><button type="button" onClick={cancelEditingMessage}>取消</button><button className="primary" type="submit" disabled={!editingMessage.text.trim()}>发送</button></div>
              </form> : <><ChatMessageContent text={item.text} /><div className="message-actions">
                <IconButton name={copiedId === item.id ? "check" : "copy"} label="复制消息" title="复制" size="small" onClick={() => void copyMessage(item.id, item.text)} />
                {item.role === "user" && <IconButton name="edit" label="编辑并重发" size="small" disabled={chatBusy || Boolean(editingMessage)} onClick={() => setEditingMessage({ sessionId: session.id, messageId: item.id, text: item.text })} />}
                {item.role === "assistant" && previousUser && <IconButton name="refresh" label="重新生成" size="small" disabled={chatBusy || Boolean(editingMessage)} onClick={() => { studio.replaceChatMessages(outline.id, session.messages.slice(0, index)); void requestAnswer(previousUser.text, false); }} />}
                <IconButton name="branch" label="从这里分支" size="small" onClick={() => branchFrom(item.id)} />
                {item.role === "assistant" && <IconButton name="more" label="更多写作操作" title="更多" size="small" className="message-action-trigger" aria-haspopup="menu" aria-expanded={messageMenuId === item.id} onClick={() => setMessageMenuId((value) => value === item.id ? "" : item.id)} />}
              </div>
              {messageMenuId === item.id && <div className="message-action-menu"><button type="button" onClick={() => saveCandidate(item.text)}><Icon name="versions" />保存为候选版本</button><button type="button" onClick={() => void appendToBody(item.text)}><Icon name="insert" />追加到正文</button><button type="button" onClick={() => { setMessageMenuId(""); onUseAsGenerate(item.text); }}><Icon name="spark" />交给 AI Generate</button></div>}</>}
            </div>
          </article>;
        })}
        {chatBusy && <article className="message assistant streaming" aria-live="polite"><div className="avatar"><Icon name="spark" /></div><div className="message-body"><div className="message-meta"><span className="ui-label">{chatbotName}</span><span>{chatProgressLabel}</span></div><ChatMessageContent text={chatProgressText} /><button className="inline-stop" type="button" onClick={cancelCurrentChatTask}><Icon name="stop" />停止</button></div></article>}
        <div ref={threadEndRef} />
      </div>

      <div className="chat-composer-wrap">
        <details className="chat-reasoning-options"><summary>推理强度 · {studio.data.settings.chatReasoningEffort === undefined ? "沿用模型" : studio.data.settings.chatReasoningEffort ?? "不发送参数"}</summary><TaskReasoningSettings kind="chat" model={chatModelRecord} disabled={chatBusy} /></details>
        {contextOpen && <div className="chat-context-panel" role="dialog" aria-label="AI Chat 上下文"><header><div><span className="ui-title">本次上下文</span><span>{contextCharacters.toLocaleString("zh-CN")} 字符</span></div><IconButton name="close" label="关闭上下文" onClick={() => setContextOpen(false)} /></header><div className="chat-context-fixed"><p><Icon name="check" /><span>文章信息</span><small>{studio.currentArticle.title}</small></p><p><Icon name="check" /><span>当前章节</span><small>{studio.currentChapter.title}</small></p><p><Icon name="check" /><span>当前大纲与正文</span><small>{outlineTitle}</small></p><p><Icon name="check" /><span>最近消息</span><small>{Math.min(20, session.messages.length)} 条</small></p></div><label><input type="checkbox" checked={session.includePrevious} onChange={(event) => studio.setChatSetting(outline.id, "includePrevious", event.target.checked)} /><span>前面全部大纲</span><small>{previous.length} 条</small></label>{session.includePrevious && previous.length > 0 && <div className="chat-context-sources">{previous.map((item) => <span key={item.id}>{outlineDisplayTitle(item)}</span>)}</div>}<label><input type="checkbox" checked={session.includeCharacters} onChange={(event) => studio.setChatSetting(outline.id, "includeCharacters", event.target.checked)} /><span>相关人物</span><small>{matchedCharacters.length} 位</small></label>{session.includeCharacters && matchedCharacters.length > 0 && <div className="chat-context-sources">{matchedCharacters.map((item) => <span key={item.id}>{item.name}</span>)}</div>}</div>}
        <div className="chat-composer">
          <textarea ref={composerRef} rows={1} maxLength={20000} value={message} disabled={Boolean(editingMessage)} onChange={(event) => { studio.setChatDraft(outline.id, event.target.value); resizeComposer(event.currentTarget); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={editingMessage ? "正在编辑上方消息" : "输入消息"} aria-label="AI Chat 消息" />
          <div className="composer-actions"><div className="composer-left-actions"><IconButton name="plus" label="添加参考或快捷指令" title="添加" className="composer-icon-button" aria-haspopup="menu" aria-expanded={toolsOpen} disabled={Boolean(editingMessage)} onClick={() => { setToolsOpen((value) => !value); setContextOpen(false); }} /><button className={`composer-context-chip ${contextOpen ? "active" : ""}`} type="button" disabled={Boolean(editingMessage)} aria-expanded={contextOpen} onClick={() => { setContextOpen((value) => !value); setToolsOpen(false); }}><Icon name="context" /><span>上下文 {contextCharacters.toLocaleString("zh-CN")}</span></button><label className="composer-model-chip"><Icon name="spark" /><select aria-label="聊天模型" disabled={Boolean(editingMessage)} value={chatModelReference} onChange={(event) => { studio.updateSettings({ chatModel: event.target.value }); void studio.saveNow(); }}><option value="">本地演示引擎</option>{chatModelReference && !chatModelRecord && <option value={chatModelReference}>{chatModelReference}</option>}{models.map((model) => <option key={model.id} value={model.id}>{modelDisplayLabel(models, model.id)}</option>)}</select></label></div>{chatBusy ? <button className="composer-send stop" type="button" onClick={cancelCurrentChatTask} aria-label="停止回复"><Icon name="stop" /></button> : <button className="composer-send" type="button" onClick={() => void send()} disabled={!message.trim() || Boolean(editingMessage) || chatBusy} aria-label="发送消息"><Icon name="send" /></button>}</div>
          {toolsOpen && <div className="chat-tools-popover"><div>{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => { studio.setChatDraft(outline.id, message ? `${message}\n${prompt}` : prompt); setToolsOpen(false); composerRef.current?.focus(); }}>{prompt}</button>)}</div><button type="button" onClick={() => fileRef.current?.click()}><Icon name="attachment" />添加文本参考</button></div>}
          <input className="chat-file-input" ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => { void attachTextFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        </div>
      </div>
    </div>
  );
}

function FullOutlineChatDialog({ outlineId, onClose, onNotice }: { outlineId: string; onClose: () => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const outline = studio.currentArticle.chapters.flatMap((chapter) => chapter.outlines).find((item) => item.id === outlineId);
  if (!outline) return null;
  const displayTitle = outlineDisplayTitle(outline);
  return <ResponsiveModal
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭全文大纲 AI Chat" }}
    fullScreen={compact}
    size="xl"
    title={`AI Chat · ${displayTitle}`}
    classNames={{ content: "ws-modal-content full-outline-chat-modal", header: "ws-modal-header", body: "full-outline-chat-body" }}
    overlayProps={{ backgroundOpacity: 0.46, blur: 3 }}
  >
    <ChatView
      key={outline.id}
      models={models}
      outlineId={outline.id}
      outlineTitle={displayTitle}
      onUseAsGenerate={() => onNotice("请在正文视图中继续使用 AI Generate")}
      onNotice={onNotice}
    />
  </ResponsiveModal>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

function ChapterReader({ onOutline }: { onOutline: (id: string) => void }) {
  const studio = useStudio();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chapter = studio.currentChapter;
  const outlines = chapter.outlines.filter((item) => studio.data.settings.showArchived || !item.archived);
  const totalWords = outlines.reduce((total, item) => total + wordCount(resolvedOutlineContent(item)), 0);
  return <div className="page-scroll"><div className="reader-page">
      <PageHeader eyebrow={studio.currentArticle.title} title={chapter.title} description={`${outlines.length} 条大纲 · ${totalWords} 字`} actions={<Group gap="xs"><Button variant="default" onClick={() => setSettingsOpen(true)}>章节设定{countChapterSettingChanges(chapter.settings) ? ` · ${countChapterSettingChanges(chapter.settings)}` : ""}</Button><button className="primary-compact" type="button" onClick={() => { const id = studio.createOutline(chapter.id); onOutline(id); }}><Icon name="plus" />新建大纲</button></Group>} />
      <div className="reader-divider" />
      {outlines.map((item, index) => <ReaderSection key={item.id} number={String(index + 1).padStart(2, "0")} title={outlineDisplayTitle(item)} onClick={() => onOutline(item.id)}>{resolvedOutlineContent(item).split("\n\n").filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</ReaderSection>)}
      {!outlines.length && <div className="empty-inline">本章节还没有大纲。</div>}
      {settingsOpen && <ChapterSettingsDrawer chapterId={chapter.id} onClose={() => setSettingsOpen(false)} />}
    </div></div>;
}

function ReaderSection({ number, title, onClick, children }: { number: string; title: string; onClick: () => void; children: ReactNode }) {
  return <section className="reader-section"><header><span>{number}</span><button type="button" onClick={onClick}><h2>{title}</h2></button></header><div className="reader-content">{children}</div></section>;
}

function NameVersionOption({ label, version, selected, revealed, deleteDisabled, onSelect, onReveal, onDelete }: {
  label: string;
  version: NameVersion;
  selected: boolean;
  revealed: boolean;
  deleteDisabled: boolean;
  onSelect: () => void;
  onReveal: (revealed: boolean) => void;
  onDelete: () => void;
}) {
  const compact = useMediaQuery("(max-width: 767px)") === true;
  const swipe = useHorizontalSwipe({
    disabled: !compact,
    ignoreSelector: ".name-version-delete",
    onSwipeLeft: () => onReveal(true),
    onSwipeRight: () => onReveal(false),
  });

  return <div
    className={`name-version-item ${revealed ? "revealed" : ""} ${deleteDisabled ? "delete-disabled" : ""}`}
    {...swipe.handlers}
    onClickCapture={swipe.onClickCapture}
  >
    <div className="name-version-delete" aria-hidden={compact && !revealed}>
      <button
        type="button"
        disabled={deleteDisabled}
        tabIndex={compact && !revealed ? -1 : undefined}
        aria-label={`删除${label}「${version.title}」`}
        title={deleteDisabled ? "章节至少需要保留一个名称" : `删除${label}`}
        onPointerDown={() => swipe.allowActionClick()}
        onClick={(event) => { event.stopPropagation(); onReveal(false); onDelete(); }}
      ><Icon name="trash" /><span>删除</span></button>
    </div>
    <button className={`name-version-option ${selected ? "selected" : ""}`} type="button" role="radio" aria-checked={selected} onClick={() => { if (revealed) onReveal(false); else onSelect(); }}>
      <span className="name-version-radio" aria-hidden="true"><i /></span>
      <span className="name-version-copy"><span className="ui-title">{version.title}</span><small>{version.source === "ai" ? `AI 候选${version.model ? ` · ${version.model}` : ""}` : "手动名称"} · {formatTime(version.createdAt)}</small></span>
      {selected && <em>默认</em>}
    </button>
  </div>;
}

function NameVersionChooser({ kind, entityId, title, versions, defaultVersionId, onSelect, onAdd, onDelete }: {
  kind: "chapter" | "outline";
  entityId: string;
  title: string;
  versions: NameVersion[];
  defaultVersionId: string | null;
  onSelect: (versionId: string) => void;
  onAdd: (title: string) => void;
  onDelete: (versionId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [revealedVersionId, setRevealedVersionId] = useState<string | null>(null);
  const label = kind === "chapter" ? "章节名" : "大纲名";
  return <div className={`name-version-chooser ${kind}`}>
    <div className="name-version-list" role="radiogroup" aria-label={`选择默认${label}：${title || entityId}`}>
      {versions.map((version) => {
        const selected = version.id === defaultVersionId;
        return <NameVersionOption
          label={label}
          version={version}
          selected={selected}
          revealed={revealedVersionId === version.id}
          deleteDisabled={kind === "chapter" && versions.length === 1}
          onSelect={() => { setRevealedVersionId(null); onSelect(version.id); }}
          onReveal={(revealed) => setRevealedVersionId(revealed ? version.id : null)}
          onDelete={() => { setRevealedVersionId(null); onDelete(version.id); }}
          key={version.id}
        />;
      })}
      {!versions.length && <div className="name-version-empty">尚无名称版本</div>}
    </div>
    <form className="name-version-add" onSubmit={(event) => { event.preventDefault(); const value = draft.trim(); if (!value) return; onAdd(value); setDraft(""); }}>
      <input aria-label={`新增${label}版本：${title || entityId}`} maxLength={kind === "chapter" ? 120 : 80} value={draft} placeholder={`输入新的${label}`} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit" disabled={!draft.trim()}>添加并设为默认</button>
    </form>
  </div>;
}

function AutoGrowTextarea({ value, onChange, onFocus, onBlur, className, label, placeholder, maxLength, spellCheck = true, style }: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void | Promise<unknown>;
  className: string;
  label: string;
  placeholder: string;
  maxLength?: number;
  spellCheck?: boolean;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback((node: HTMLTextAreaElement | null) => {
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    const mirror = node.cloneNode(false) as HTMLTextAreaElement;
    mirror.setAttribute("aria-hidden", "true");
    mirror.tabIndex = -1;
    mirror.rows = 1;
    mirror.value = node.value || " ";
    mirror.style.position = "fixed";
    mirror.style.left = "-100000px";
    mirror.style.top = "0";
    mirror.style.visibility = "hidden";
    mirror.style.pointerEvents = "none";
    mirror.style.width = `${bounds.width}px`;
    mirror.style.height = "0px";
    mirror.style.minHeight = "0";
    mirror.style.maxHeight = "none";
    mirror.style.overflow = "hidden";
    mirror.style.setProperty("field-sizing", "fixed");
    document.body.append(mirror);
    const nextHeight = Math.max(mirror.scrollHeight, 34);
    mirror.remove();
    node.style.height = `${nextHeight}px`;
    node.scrollTop = 0;
  }, []);
  useLayoutEffect(() => { resize(ref.current); }, [value, resize]);
  return <textarea
    ref={(node) => { ref.current = node; resize(node); }}
    className={className}
    rows={1}
    value={value}
    maxLength={maxLength}
    placeholder={placeholder}
    aria-label={label}
    spellCheck={spellCheck}
    style={style}
    onFocus={onFocus}
    onBlur={() => { void onBlur?.(); }}
    onChange={(event) => { onChange(event.target.value); resize(event.currentTarget); }}
  />;
}

function textareaCaretBounds(textarea: HTMLTextAreaElement) {
  const computed = window.getComputedStyle(textarea);
  const textareaBounds = textarea.getBoundingClientRect();
  const caretOffset = textarea.selectionDirection === "backward" ? textarea.selectionStart : textarea.selectionEnd;
  const caret = getCaretCoordinates(textarea, caretOffset);
  const fallbackLineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.4 || 22;
  const caretHeight = Number.isFinite(caret.height) && caret.height > 0 ? caret.height : fallbackLineHeight;
  const top = textareaBounds.top + caret.top - textarea.scrollTop;
  return { top, bottom: top + caretHeight };
}

function useWritingEditorViewport(scrollRef: { current: HTMLDivElement | null }, editorRef: { current: HTMLTextAreaElement | null }, editing: boolean) {
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !editing) return;
    const mobile = window.matchMedia("(max-width: 767px)");
    const visualViewport = window.visualViewport;
    let layoutFrame = 0;
    let caretFrame = 0;
    let settleTimer = 0;

    const viewportMetrics = () => {
      const height = Math.max(0, visualViewport?.height ?? window.innerHeight);
      const top = Math.max(0, visualViewport?.offsetTop ?? 0);
      return { height, top, bottom: top + height };
    };

    const ensureCaretVisible = () => {
      caretFrame = 0;
      const editor = editorRef.current;
      if (!mobile.matches || !editor || document.activeElement !== editor) return;
      const viewport = viewportMetrics();
      const editorBounds = editor.getBoundingClientRect();
      const safeTop = Math.max(viewport.top, editorBounds.top) + 16;
      const safeBottom = Math.min(viewport.bottom, editorBounds.bottom) - 24;
      if (safeBottom <= safeTop) return;
      const caret = textareaCaretBounds(editor);
      if (caret.bottom > safeBottom) editor.scrollTop += caret.bottom - safeBottom;
      else if (caret.top < safeTop) editor.scrollTop += caret.top - safeTop;
    };

    const scheduleCaretVisibility = () => {
      if (caretFrame) window.cancelAnimationFrame(caretFrame);
      caretFrame = window.requestAnimationFrame(ensureCaretVisible);
    };

    const applyViewport = () => {
      layoutFrame = 0;
      if (!mobile.matches) {
        container.style.removeProperty("--writing-visible-height");
        delete container.dataset.visualViewportHeight;
        delete container.dataset.keyboardInset;
        return;
      }
      const viewport = viewportMetrics();
      const containerTopWithinViewport = Math.max(0, container.getBoundingClientRect().top - viewport.top);
      const visibleHeight = Math.max(180, viewport.height - containerTopWithinViewport);
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const keyboardInset = Math.max(0, layoutHeight - viewport.bottom);
      container.style.setProperty("--writing-visible-height", `${visibleHeight}px`);
      container.dataset.visualViewportHeight = `${Math.round(viewport.height)}`;
      container.dataset.keyboardInset = `${Math.round(keyboardInset)}`;
      scheduleCaretVisibility();
    };

    const scheduleViewport = () => {
      if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
      layoutFrame = window.requestAnimationFrame(applyViewport);
    };

    const settleEditor = () => {
      scheduleViewport();
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(scheduleViewport, 360);
    };

    scheduleViewport();
    settleTimer = window.setTimeout(scheduleViewport, 60);
    visualViewport?.addEventListener("resize", settleEditor);
    visualViewport?.addEventListener("scroll", scheduleViewport);
    window.addEventListener("resize", settleEditor);
    mobile.addEventListener("change", scheduleViewport);
    container.addEventListener("focusin", settleEditor);
    container.addEventListener("input", scheduleCaretVisibility);
    container.addEventListener("keyup", scheduleCaretVisibility);
    container.addEventListener("pointerup", scheduleCaretVisibility);
    document.addEventListener("selectionchange", scheduleCaretVisibility);
    return () => {
      visualViewport?.removeEventListener("resize", settleEditor);
      visualViewport?.removeEventListener("scroll", scheduleViewport);
      window.removeEventListener("resize", settleEditor);
      mobile.removeEventListener("change", scheduleViewport);
      container.removeEventListener("focusin", settleEditor);
      container.removeEventListener("input", scheduleCaretVisibility);
      container.removeEventListener("keyup", scheduleCaretVisibility);
      container.removeEventListener("pointerup", scheduleCaretVisibility);
      document.removeEventListener("selectionchange", scheduleCaretVisibility);
      window.clearTimeout(settleTimer);
      if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
      if (caretFrame) window.cancelAnimationFrame(caretFrame);
      container.style.removeProperty("--writing-visible-height");
      delete container.dataset.visualViewportHeight;
      delete container.dataset.keyboardInset;
    };
  }, [editing, editorRef, scrollRef]);
}

function useContinuousEditorViewport(scrollRef: { current: HTMLDivElement | null }) {
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const mobile = window.matchMedia("(max-width: 767px)");
    const visualViewport = window.visualViewport;
    let layoutFrame = 0;
    let caretFrame = 0;
    let settleTimer = 0;

    const viewportMetrics = () => {
      const height = Math.max(0, visualViewport?.height ?? window.innerHeight);
      const top = Math.max(0, visualViewport?.offsetTop ?? 0);
      return { height, top, bottom: top + height };
    };

    const ensureFocusedEditorVisible = () => {
      caretFrame = 0;
      if (!mobile.matches) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)
        || !container.contains(active)
        || !active.matches(".continuous-text-editor, .continuous-outline-title-input")) return;
      const viewport = viewportMetrics();
      const containerBounds = container.getBoundingClientRect();
      const safeTop = Math.max(viewport.top, containerBounds.top) + 24;
      const safeBottom = Math.min(viewport.bottom, containerBounds.bottom) - 28;
      if (safeBottom <= safeTop) return;
      const activeBounds = active instanceof HTMLTextAreaElement ? textareaCaretBounds(active) : active.getBoundingClientRect();
      if (activeBounds.bottom > safeBottom) container.scrollTop += activeBounds.bottom - safeBottom;
      else if (activeBounds.top < safeTop) container.scrollTop += activeBounds.top - safeTop;
    };

    const scheduleCaretVisibility = () => {
      if (caretFrame) window.cancelAnimationFrame(caretFrame);
      caretFrame = window.requestAnimationFrame(ensureFocusedEditorVisible);
    };

    const applyViewport = () => {
      layoutFrame = 0;
      if (!mobile.matches) {
        container.style.removeProperty("--continuous-visible-height");
        container.style.removeProperty("--continuous-keyboard-gap");
        delete container.dataset.visualViewportHeight;
        delete container.dataset.keyboardInset;
        return;
      }
      const viewport = viewportMetrics();
      const containerTopWithinViewport = Math.max(0, container.getBoundingClientRect().top - viewport.top);
      const visibleHeight = Math.max(120, viewport.height - containerTopWithinViewport);
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const keyboardInset = Math.max(0, layoutHeight - viewport.bottom);
      container.style.setProperty("--continuous-visible-height", `${visibleHeight}px`);
      container.style.setProperty("--continuous-keyboard-gap", keyboardInset > 80 ? "28px" : "0px");
      container.dataset.visualViewportHeight = `${Math.round(viewport.height)}`;
      container.dataset.keyboardInset = `${Math.round(keyboardInset)}`;
      scheduleCaretVisibility();
    };

    const scheduleViewport = () => {
      if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
      layoutFrame = window.requestAnimationFrame(applyViewport);
    };

    const settleFocusedEditor = () => {
      scheduleViewport();
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(scheduleViewport, 360);
    };

    scheduleViewport();
    visualViewport?.addEventListener("resize", scheduleViewport);
    visualViewport?.addEventListener("scroll", scheduleViewport);
    window.addEventListener("resize", scheduleViewport);
    mobile.addEventListener("change", scheduleViewport);
    container.addEventListener("focusin", settleFocusedEditor);
    container.addEventListener("input", scheduleCaretVisibility);
    container.addEventListener("keyup", scheduleCaretVisibility);
    container.addEventListener("pointerup", scheduleCaretVisibility);
    return () => {
      visualViewport?.removeEventListener("resize", scheduleViewport);
      visualViewport?.removeEventListener("scroll", scheduleViewport);
      window.removeEventListener("resize", scheduleViewport);
      mobile.removeEventListener("change", scheduleViewport);
      container.removeEventListener("focusin", settleFocusedEditor);
      container.removeEventListener("input", scheduleCaretVisibility);
      container.removeEventListener("keyup", scheduleCaretVisibility);
      container.removeEventListener("pointerup", scheduleCaretVisibility);
      window.clearTimeout(settleTimer);
      if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
      if (caretFrame) window.cancelAnimationFrame(caretFrame);
      container.style.removeProperty("--continuous-visible-height");
      container.style.removeProperty("--continuous-keyboard-gap");
      delete container.dataset.visualViewportHeight;
      delete container.dataset.keyboardInset;
    };
  }, [scrollRef]);
}

function ContinuousChapterHeading({ chapterId, index, title, settingCount, settingsOpen, namesOpen, onSettings, onNames, onMore, onTitle, onTitleCommit }: {
  chapterId: string;
  index: number;
  title: string;
  settingCount: number;
  settingsOpen: boolean;
  namesOpen: boolean;
  onSettings: () => void;
  onNames: () => void;
  onMore: () => void;
  onTitle: (value: string) => void;
  onTitleCommit: (value: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `continuous-chapter:${chapterId}`, data: { type: "chapter", chapterId } });
  return <header ref={setNodeRef} className={`continuous-chapter-heading ${isOver ? "chapter-drop-active" : ""}`}><div><span>第 {index + 1} 章</span><AutoGrowTextarea className="continuous-chapter-title-input" value={title} placeholder="章节标题" maxLength={120} label={`第 ${index + 1} 章标题`} onChange={onTitle} onBlur={() => onTitleCommit(title)} /></div><div className="continuous-heading-actions"><button className="chapter-setting-trigger" aria-expanded={settingsOpen} type="button" onClick={onSettings}>设定{settingCount ? ` · ${settingCount}` : ""}<Icon name="chevron" /></button><IconButton name="versions" label={`选择「${title}」的章节名称`} className="continuous-chapter-names" aria-expanded={namesOpen} onClick={onNames} /><IconButton name="more" label={`${title}更多操作`} className="continuous-chapter-more" onClick={onMore} /></div></header>;
}

function UnifiedNamingEditor({ target, chapter, outline, onNotice, onTaskCreated }: {
  target: "article" | "chapter" | "outline";
  chapter?: Chapter;
  outline?: Outline;
  onNotice: (message: string) => void;
  onTaskCreated: () => void;
}) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const article = studio.currentArticle;
  const settings = studio.data.settings;
  const visibleChapters = article.chapters.filter((item) => studio.data.settings.showArchived || !item.archived);
  const eligibleOutlines = (item: Chapter) => item.outlines.filter((candidate) => !candidate.archived && candidate.plan.trim());
  const eligibleChapters = visibleChapters.filter((item) => !item.archived && eligibleOutlines(item).length);
  const namingSelection = settings.namingModelMode === "inherit" ? "__inherit__" : settings.namingModel ? canonicalModelReference(models, settings.namingModel) : "__local__";
  const inheritedReference = canonicalModelReference(models, settings.generateModel);
  const fixedReference = canonicalModelReference(models, settings.namingModel);
  const selectedModelReference = settings.namingModelMode === "inherit" ? inheritedReference : fixedReference;
  const selectedRecord = configuredModelForReference(models, selectedModelReference);
  const missingSecret = Boolean(selectedRecord && !selectedRecord.hasSecret);
  const activeAllTask = studio.data.tasks.find((task) => task.articleId === article.id && task.target === "全部名称" && (task.state === "waiting" || task.state === "running"));
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const modelData = [
    { value: "__inherit__", label: `继承 AI Generate（${modelDisplayLabel(models, inheritedReference)}）` },
    { value: "__local__", label: "本地演示引擎" },
    ...(namingSelection !== "__inherit__" && namingSelection !== "__local__" && !configuredModelForReference(models, namingSelection) ? [{ value: namingSelection, label: namingSelection }] : []),
    ...models.map((model) => ({ value: model.id, label: `${modelDisplayLabel(models, model.id)}${model.hasSecret ? "" : "（需密钥）"}` })),
  ];

  function selectNamingModel(value: string | null) {
    if (!value || value === "__inherit__") studio.updateSettings({ namingModelMode: "inherit" });
    else if (value === "__local__") studio.updateSettings({ namingModelMode: "fixed", namingModel: "" });
    else studio.updateSettings({ namingModelMode: "fixed", namingModel: value });
    setError("");
    void studio.saveNow();
  }
  async function requestNames(targetChapter: Chapter, body: Record<string, unknown>) {
    const response = await fetchServerAction("/api/ai/names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articleId: article.id,
        chapterId: targetChapter.id,
        chapterNaming: article.chapterNaming,
        outlineNaming: article.outlineNaming,
        model: selectedModelReference,
        reasoningEffort: settings.namingReasoningEffort,
        modelLabel: modelDisplayLabel(models, selectedModelReference),
        instruction: instruction.trim(),
        context: namingArticleContext(article),
        persist: true,
        ...body,
      }),
    });
    const payload = await response.json() as NameGeneratePreview & { error?: string };
    if (!response.ok) throw new Error(payload.error || "名称生成失败");
    return payload;
  }
  async function storeCandidates(targetChapter: Chapter, payload: NameGeneratePreview) {
    return storeNameCandidates(studio, article.id, targetChapter.id, payload);
  }
  async function generateOne() {
    if (!chapter || (target === "outline" && !outline)) return;
    if (missingSecret) { setError("所选模型还没有载入 API 密钥"); return; }
    if (target === "chapter" && !eligibleOutlines(chapter).length) { setError(`「${chapter.title}」没有可供参考的大纲内容`); return; }
    if (target === "outline" && !outline!.plan.trim()) { setError(`「${outlineDisplayTitle(outline!)}」的大纲内容为空`); return; }
    setBusy(true); setError("");
    try {
      const payload = await requestNames(chapter, target === "chapter"
        ? { target: "chapter", includeChapter: true, outlineIds: [] }
        : { target: "outline", outlineId: outline!.id });
      const added = await storeCandidates(chapter, payload);
      onNotice(added ? `已添加${target === "chapter" ? "章节名" : "大纲名"}候选` : "生成名称与已有版本相同");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "名称生成失败"); }
    finally { setBusy(false); }
  }
  async function generateAll() {
    if (!eligibleChapters.length) { setError("没有可生成名称的章节；请先填写大纲内容"); return; }
    if (missingSecret) { setError("所选模型还没有载入 API 密钥"); return; }
    if (activeAllTask) { onTaskCreated(); return; }
    const anchorChapter = eligibleChapters[0];
    const anchorOutline = eligibleOutlines(anchorChapter)[0];
    const eligibleOutlineCount = eligibleChapters.reduce((total, item) => total + eligibleOutlines(item).length, 0);
    const estimatedCharacters = article.summary.length + article.style.length + eligibleChapters.reduce((total, item) => total + eligibleOutlines(item).reduce((sum, candidate) => sum + candidate.plan.length, 0), 0);
    try {
      await createServerTask(studio, {
        articleId: article.id,
        chapterId: anchorChapter.id,
        outlineId: anchorOutline.id,
        target: "all-names",
        instruction: instruction.trim(),
        model: selectedModelReference,
        reasoningEffort: settings.namingReasoningEffort,
        includePrevious: false,
        includeCharacters: false,
        estimatedCharacters,
        chapterNaming: article.chapterNaming,
        outlineNaming: article.outlineNaming,
        timeoutMs: selectedRecord?.timeoutMs ?? 600_000,
        namingContext: namingArticleContext(article),
      });
      onNotice(`已创建后台任务，将用一次模型请求生成 ${eligibleChapters.length} 个章节和 ${eligibleOutlineCount} 个大纲的名称`);
      onTaskCreated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "后台名称任务创建失败"); }
  }
  async function selectDefault(kind: "chapter" | "outline", entityId: string, versionId: string) {
    if (kind === "outline" && chapter) {
      const targetOutline = chapter.outlines.find((item) => item.id === entityId);
      const targetState = targetOutline ? normalizeNameVersionState(targetOutline.id, targetOutline.title, targetOutline.nameVersions, targetOutline.defaultNameVersionId, targetOutline.updatedAt, 80) : null;
      const selected = targetState?.nameVersions.find((version) => version.id === versionId);
      if (selected && chapter.outlines.some((item) => item.id !== entityId && normalizeOutlineTitle(item.title) === selected.title)) { setError(`同一章节内已经使用大纲名「${selected.title}」`); return; }
    }
    studio.setDefaultNameVersion(kind, entityId, versionId);
    setError("");
    const saved = await studio.saveNow();
    onNotice(saved ? "默认名称已更新" : "默认名称已更新，但保存尚未完成");
  }
  async function addManual(kind: "chapter" | "outline", entityId: string, title: string) {
    if (kind === "outline" && chapter && chapter.outlines.some((item) => item.id !== entityId && normalizeOutlineTitle(item.title) === title.trim())) { setError(`同一章节内已经使用大纲名「${title.trim()}」`); return; }
    const versionId = studio.addManualNameVersion(kind, entityId, title, true);
    if (!versionId) { setError("名称不能为空"); return; }
    setError("");
    const saved = await studio.saveNow();
    onNotice(saved ? "已添加名称并设为默认" : "名称已更新，但保存尚未完成");
  }
  async function deleteName(kind: "chapter" | "outline", entityId: string, versionId: string) {
    if (!studio.deleteNameVersion(kind, entityId, versionId)) { setError("章节至少需要保留一个名称；请先添加其他名称再删除"); return; }
    setError("");
    const saved = await studio.saveNow();
    onNotice(saved ? "名称已删除" : "名称已删除，但保存尚未完成");
  }

  if (target === "article") return <div className="unified-naming-editor article-naming-editor">
    <div className="full-chapter-generation-bar">
      <Select label="名称生成模型" data={modelData} value={namingSelection} allowDeselect={false} disabled={Boolean(activeAllTask)} onChange={selectNamingModel} />
      <Textarea label="补充命名要求（可选）" maxLength={20_000} autosize minRows={2} maxRows={5} value={instruction} disabled={Boolean(activeAllTask)} placeholder="例如：避免剧透，保持海洋意象" onChange={(event) => setInstruction(event.currentTarget.value)} />
      <div className="name-generation-reasoning"><TaskReasoningSettings kind="naming" model={selectedRecord} disabled={Boolean(activeAllTask)} /></div>
      <Button leftSection={<Icon name="spark" />} loading={activeAllTask?.state === "running"} disabled={Boolean(activeAllTask) || missingSecret || !eligibleChapters.length} onClick={() => void generateAll()}>{activeAllTask ? "全部名称生成中" : "生成全部名称"}</Button>
    </div>
    {activeAllTask && <Alert color="studio">全部名称正在后台{activeAllTask.state === "waiting" ? "排队" : "生成"}，可以收起本区域；完成后候选名称会自动出现。</Alert>}
    {error && <Alert color="red">{error}</Alert>}
  </div>;

  if (!chapter || (target === "outline" && !outline)) return null;
  const kind = target as "chapter" | "outline";
  const item = target === "chapter" ? chapter : outline!;
  const state = normalizeNameVersionState(item.id, item.title, item.nameVersions, item.defaultNameVersionId, target === "chapter" ? article.updatedAt : outline!.updatedAt, target === "chapter" ? 120 : 80);
  const canGenerate = target === "chapter" ? eligibleOutlines(chapter).length > 0 : Boolean(outline!.plan.trim());
  return <div className="unified-naming-editor">
    <div className="unified-naming-heading"><span>{target === "chapter" ? "章节名称" : "大纲名称"}</span><Button variant="light" size="xs" leftSection={<Icon name="spark" />} loading={busy} disabled={busy || Boolean(activeAllTask) || !canGenerate} onClick={() => void generateOne()}>AI 生成候选</Button></div>
    <NameVersionChooser kind={kind} entityId={item.id} title={item.title} versions={state.nameVersions} defaultVersionId={state.defaultNameVersionId} onSelect={(versionId) => void selectDefault(kind, item.id, versionId)} onAdd={(title) => void addManual(kind, item.id, title)} onDelete={(versionId) => void deleteName(kind, item.id, versionId)} />
    {error && <Alert color="red">{error}</Alert>}
  </div>;
}

function ContinuousEmptyChapter({ chapterId }: { chapterId: string }) {
  const { isOver, setNodeRef } = useDroppable({ id: `continuous-empty:${chapterId}`, data: { type: "chapter", chapterId } });
  return <div ref={setNodeRef} className={`continuous-empty-chapter ${isOver ? "chapter-drop-active" : ""}`} aria-label="将大纲移动到此章节" />;
}

function ContinuousOutlineBlock({ item, number, mode, text, selectedVersionId, dropPlacement, contentStyle, active, propertiesOpen, namesOpen, onActivate, onAdd, onDelete, onArchive, onProperties, onNames, onTitle, onTitleCommit, onText, onContentFocus, onContentBlur, onSelectVersion, onSetCurrentVersion, onSetDefaultVersion, onMoveUp, onMoveDown, onMoveChapter, onOpenChat }: {
  item: Outline;
  number: number;
  mode: "outline" | "content";
  text: string;
  selectedVersionId?: string;
  dropPlacement?: OutlineDropPlacement;
  contentStyle?: CSSProperties;
  active?: boolean;
  propertiesOpen?: boolean;
  namesOpen?: boolean;
  onActivate: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onProperties?: () => void;
  onNames?: () => void;
  onTitle: (value: string) => void;
  onTitleCommit?: (value: string) => void;
  onText: (value: string) => void;
  onContentFocus?: () => void;
  onContentBlur?: () => void | Promise<unknown>;
  onSelectVersion?: (versionId?: string) => void | Promise<void>;
  onSetCurrentVersion?: (versionId: string) => void;
  onSetDefaultVersion?: (versionId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveChapter?: () => void;
  onOpenChat?: () => void;
}) {
  const displayTitle = outlineDisplayTitle(item);
  const selectedVersion = item.versions.find((version) => version.id === selectedVersionId);
  const currentVersion = currentOutlineVersion(item);
  const showWorkingCurrent = !currentVersion;
  const currentContentName = resolvedOutlineContentName(item);
  const currentExcellentFragments = resolvedExcellentFragments(item);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, data: { type: "outline", outlineId: item.id } });
  return <article
    ref={setNodeRef}
    data-continuous-outline-id={item.id}
    className={`continuous-outline-block ${active ? "active" : ""} ${isDragging ? "dragging" : ""} ${dropPlacement ? `drop-${dropPlacement}` : ""}`}
    style={{ transform: CSS.Transform.toString(transform), transition }}
    onFocusCapture={onActivate}
    onPointerDownCapture={onActivate}
    onKeyDown={(event) => {
      if (mode !== "outline" || !event.altKey) return;
      if (event.key === "ArrowUp" && onMoveUp) { event.preventDefault(); onMoveUp(); }
      if (event.key === "ArrowDown" && onMoveDown) { event.preventDefault(); onMoveDown(); }
    }}
  >
    <div className="continuous-outline-gutter">
      <span>{String(number).padStart(2, "0")}</span>
      <button ref={setActivatorNodeRef} className="continuous-drag-handle" type="button" {...attributes} {...listeners} aria-label={`拖动排序：${displayTitle}`} title="拖动调整顺序"><i aria-hidden="true" /></button>
      {mode === "outline" && onAdd && <button className="continuous-outline-insert" type="button" aria-label={`在「${displayTitle}」下方新建大纲`} title="在下方新建" onClick={onAdd}><Icon name="plus" /></button>}
    </div>
    {mode === "outline" ? <div className="continuous-outline-title-row">
      <AutoGrowTextarea className="continuous-outline-title-input" value={normalizeOutlineTitle(item.title)} placeholder={displayTitle} maxLength={80} label={`大纲标题：${displayTitle}`} onChange={onTitle} onBlur={() => onTitleCommit?.(item.title)} />
      <div className="continuous-outline-primary-actions">
        {onOpenChat && <button className="continuous-outline-chat" type="button" aria-label="AI Chat" onClick={onOpenChat}><Icon name="chat" /><span>AI Chat</span></button>}
        {onProperties && <button className="continuous-outline-properties" type="button" aria-label={`打开「${displayTitle}」属性`} aria-expanded={propertiesOpen} onClick={onProperties}><Icon name="settings" /><span>属性</span>{countOutlineSettingChanges(item.settings) > 0 && <em>{countOutlineSettingChanges(item.settings)}</em>}</button>}
        {onNames && <button className="continuous-outline-names" type="button" aria-label={`选择「${displayTitle}」的大纲名称`} title="选择大纲候选名称" aria-expanded={namesOpen} onClick={onNames}><Icon name="versions" /></button>}
        <Menu position="bottom-end" shadow="md" width={224} withinPortal>
          <Menu.Target><button className="continuous-outline-more" type="button" aria-label={`${displayTitle}更多操作`}><Icon name="more" /></button></Menu.Target>
          <Menu.Dropdown className="continuous-outline-action-menu">
            <Menu.Label>结构</Menu.Label>
            {onAdd && <Menu.Item leftSection={<Icon name="plus" />} onClick={onAdd}>在下方新建</Menu.Item>}
            {onMoveChapter && <Menu.Item leftSection={<Icon name="move" />} onClick={onMoveChapter}>移动到章节…</Menu.Item>}
            {(onMoveUp || onMoveDown) && <Menu.Divider />}
            {onMoveUp && <Menu.Item leftSection={<Icon name="move" />} onClick={onMoveUp}><span className="continuous-outline-menu-item"><span>上移一位</span><kbd>Alt ↑</kbd></span></Menu.Item>}
            {onMoveDown && <Menu.Item leftSection={<Icon name="move" />} onClick={onMoveDown}><span className="continuous-outline-menu-item"><span>下移一位</span><kbd>Alt ↓</kbd></span></Menu.Item>}
            <Menu.Divider />
            {onArchive && <Menu.Item leftSection={<Icon name="archive" />} onClick={onArchive}>{item.archived ? "恢复" : "归档"}</Menu.Item>}
            {onDelete && <Menu.Item className="continuous-outline-delete" leftSection={<Icon name="trash" />} onClick={() => {
              const hasBody = Boolean(item.content.trim() || resolvedOutlineContent(item).trim() || item.versions.some((version) => version.content.trim()));
              const message = hasBody ? `「${displayTitle}」已有正文。删除后正文、正文版本和 AI Chat 都会一并删除，且无法撤销。确认删除？` : `删除大纲「${displayTitle}」？此操作无法撤销。`;
              if (window.confirm(message)) onDelete();
            }}>删除</Menu.Item>}
          </Menu.Dropdown>
        </Menu>
      </div>
    </div> : <div className="continuous-content-heading">
      <h3>{displayTitle}</h3>
      <div className="continuous-version-controls">
        <Menu position="bottom-end" shadow="md" width={320} withinPortal>
          <Menu.Target>
            <button className={`continuous-version-trigger ${selectedVersion ? "previewing" : ""}`} type="button" aria-label={`选择正文版本：${displayTitle}`}>
              <Icon name="versions" /><span>{selectedVersion?.name ?? currentContentName}</span><Icon name="chevron" />
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>正文版本</Menu.Label>
            {showWorkingCurrent && <Menu.Item onClick={() => void onSelectVersion?.()}>
              <span className="continuous-version-option"><span className="ui-title">{currentContentName}{currentExcellentFragments.length > 0 && <i className="excellent-fragment-dot" title="含优秀片段" />}<em>当前</em></span><small>已直接保存</small></span>
            </Menu.Item>}
            {item.versions.map((version) => <Menu.Item key={version.id} onClick={() => void onSelectVersion?.(version.id)}>
              <span className="continuous-version-option"><span className="ui-title">{version.name}{normalizeExcellentFragments(version.content, version.excellentFragments).length > 0 && <i className="excellent-fragment-dot" title="含优秀片段" />}{version.id === item.currentVersionId ? <em>当前</em> : null}{version.id === item.defaultVersionId ? <em>默认</em> : null}</span><small>{formatTime(version.createdAt)} · {wordCount(version.content)} 字 · {version.source}</small></span>
            </Menu.Item>)}
            {!item.versions.length && <Menu.Item disabled>尚无候选版本</Menu.Item>}
          </Menu.Dropdown>
        </Menu>
        {selectedVersion && selectedVersion.id !== item.currentVersionId && <button className="continuous-set-current" type="button" aria-label={`将“${selectedVersion.name}”设为当前正文`} onClick={() => onSetCurrentVersion?.(selectedVersion.id)}>设为当前</button>}
        {selectedVersion && selectedVersion.id !== item.defaultVersionId && <button className="continuous-set-default" type="button" aria-label={`将“${selectedVersion.name}”设为默认正文`} onClick={() => onSetDefaultVersion?.(selectedVersion.id)}>设为默认</button>}
      </div>
    </div>}
    <AutoGrowTextarea
      className={`continuous-text-editor ${mode === "content" ? "content" : "plan"}`}
      value={text}
      maxLength={mode === "outline" ? 10000 : undefined}
      placeholder={mode === "outline" ? "输入大纲内容" : "从这里开始写作"}
      label={`${mode === "outline" ? "大纲内容" : "正文"}：${displayTitle}`}
      spellCheck={mode === "content" ? false : true}
      style={contentStyle}
      onFocus={onContentFocus}
      onBlur={onContentBlur}
      onChange={onText}
    />
  </article>;
}

type ContinuousOutlinePanelView = "settings" | "names" | "move";

function ContinuousOutlinePropertiesDrawer({ outline, chapter, chapters, view, onView, onClose, onMove, onNotice, onTaskCreated }: {
  outline: Outline;
  chapter: Chapter;
  chapters: Chapter[];
  view: ContinuousOutlinePanelView;
  onView: (view: "settings" | "names") => void;
  onClose: () => void;
  onMove: (chapterId: string) => void;
  onNotice: (message: string) => void;
  onTaskCreated: () => void;
}) {
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const displayTitle = outlineDisplayTitle(outline);
  const settingCount = countOutlineSettingChanges(outline.settings);
  const moving = view === "move";
  return <ScrollableDrawer
    opened
    onClose={onClose}
    position={compact ? "bottom" : "right"}
    size={compact ? "92dvh" : moving ? 440 : 620}
    title={<div className="continuous-outline-properties-title"><span>{moving ? "移动大纲" : displayTitle}</span><small>{moving ? displayTitle : `大纲属性${settingCount ? ` · ${settingCount} 项设定修改` : ""}`}</small></div>}
    closeButtonProps={{ "aria-label": moving ? "关闭移动大纲" : "关闭大纲属性" }}
    classNames={{ content: "continuous-outline-properties-drawer", body: "continuous-outline-properties-body" }}
  >
    {moving ? <div className="continuous-outline-move-panel">
      <Text size="sm" c="dimmed">选择目标章节；大纲内容、正文版本和 AI Chat 会一起保留。</Text>
      <Stack gap="xs">
        {chapters.filter((item) => item.id !== chapter.id).map((item) => <Button variant="default" justify="space-between" key={item.id} onClick={() => onMove(item.id)}><span>{item.title}</span><Icon name="move" /></Button>)}
      </Stack>
    </div> : <>
      <div className="continuous-outline-properties-tabs" role="tablist" aria-label="大纲属性">
        <button className={view === "settings" ? "active" : ""} type="button" role="tab" aria-selected={view === "settings"} onClick={() => onView("settings")}>设定{settingCount ? ` · ${settingCount}` : ""}</button>
        <button className={view === "names" ? "active" : ""} type="button" role="tab" aria-selected={view === "names"} onClick={() => onView("names")}>名称</button>
      </div>
      <section className="continuous-outline-properties-panel" role="tabpanel" aria-label={view === "settings" ? "大纲设定" : "大纲名称"}>
        {view === "settings" ? <ScopedSettingsInline level="outline" targetId={outline.id} /> : <UnifiedNamingEditor target="outline" chapter={chapter} outline={outline} onNotice={onNotice} onTaskCreated={onTaskCreated} />}
      </section>
    </>}
  </ScrollableDrawer>;
}

function AiReviewDialog({ article, chapters, models, initialModel, onClose, onSetDefaultModel, onRun }: {
  article: Article;
  chapters: Chapter[];
  models: ConfiguredModel[];
  initialModel: string;
  onClose: () => void;
  onSetDefaultModel: (modelId: string) => void;
  onRun: (input: { chapterId: string; model: string; requirements: string[]; additionalRequirement: string; ruleSnapshot: ReviewRuleSnapshot; reasoningEffort?: ReasoningEffort | null }) => Promise<void>;
}) {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const availableChapters = chapters.filter((chapter) => !chapter.archived && chapter.outlines.some((outline) => !outline.archived && resolvedOutlineContent(outline).trim()));
  const [chapterId, setChapterId] = useState(availableChapters[0]?.id ?? "");
  const model = canonicalModelReference(models, initialModel) || models[0]?.id || "";
  const [additionalRequirement, setAdditionalRequirement] = useState("");
  const [runningSnapshot, setRunningSnapshot] = useState<ReviewRuleSnapshot | null>(null);
  const [error, setError] = useState("");
  const running = Boolean(runningSnapshot);
  const snapshot = runningSnapshot ?? createReviewRuleSnapshot(article, additionalRequirement);
  async function submit() {
    if (!chapterId || !model || running || !hasReviewRules(snapshot)) return;
    onSetDefaultModel(model); setRunningSnapshot(snapshot); setError("");
    try { await onRun({ chapterId, model, requirements: [], additionalRequirement: snapshot.instruction, ruleSnapshot: snapshot, reasoningEffort: studio.data.settings.reviewReasoningEffort }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "AI Review 失败"); }
    finally { setRunningSnapshot(null); }
  }
  return <ResponsiveModal scrollMode="content" opened onClose={running ? () => undefined : onClose} closeButtonProps={{ "aria-label": "关闭 AI Review" }} title="AI Review" centered fullScreen={compact} size="lg" classNames={{ content: "ai-review-dialog ws-modal-content", header: "ws-modal-header", body: "ai-review-dialog-body" }} overlayProps={{ backgroundOpacity: 0.46, blur: 3 }}>
    <div className="ai-review-layout">
      <div className="ai-review-scroll" data-ui-overlay-scroll>
        <div className="ai-review-basics"><Select label="Review 章节" value={chapterId} onChange={(value) => setChapterId(value ?? "")} data={availableChapters.map((chapter) => ({ value: chapter.id, label: chapter.title }))} disabled={running} /><Select label="模型" value={model} onChange={(value) => onSetDefaultModel(value ?? "")} data={models.map((item) => ({ value: item.id, label: modelDisplayLabel(models, item.id) }))} disabled={running} /></div>
        <Textarea className="ai-review-requirement" label="本次附加要求" minRows={3} maxRows={6} autosize maxLength={MAX_REVIEW_RULE_CHARACTERS} value={additionalRequirement} onChange={(event) => setAdditionalRequirement(event.currentTarget.value)} disabled={running} />
      <section className="ai-review-article-rules"><div className="ai-review-section-heading"><span>本次文章规则</span><small>{snapshot.rules.length} 条</small>{!running && <a href={`/articles/${article.id}/info/ai-tasks`}>管理规则</a>}</div><div className="ai-review-rules-body"><ReviewRuleSnapshotView snapshot={snapshot} showInstruction={false} /></div></section>
        <section className="ai-review-advanced"><TaskReasoningSettings kind="review" model={configuredModelForReference(models, model)} disabled={running} /></section>
        {!hasReviewRules(snapshot) && <Alert color="studio">请添加文章规则或填写本次附加要求。</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        {!models.length && <Alert color="yellow">请先配置一个可用模型。</Alert>}
      </div>
      <div className="ai-review-actions"><Button variant="default" disabled={running} onClick={onClose}>取消</Button><Button leftSection={<Icon name="review" />} loading={running} disabled={!chapterId || !model || !models.length || !hasReviewRules(snapshot)} onClick={() => void submit()}>开始 AI Review</Button></div>
    </div>
  </ResponsiveModal>;
}

function ContinuousDocumentEditor({ mode, positionMemory, onNotice, onTaskCreated }: { mode: "outline" | "content"; positionMemory: ContinuousDocumentPositionMemory; onNotice: (message: string) => void; onTaskCreated: () => void }) {
  const studio = useStudio();
  const reviewModels = useConfiguredModels();
  const groups = useMemo(() => studio.currentArticle.chapters
    .filter((chapter) => studio.data.settings.showArchived || !chapter.archived)
    .map((chapter) => ({ ...chapter, items: chapter.outlines.filter((item) => studio.data.settings.showArchived || !item.archived) })), [studio.currentArticle, studio.data.settings.showArchived]);
  const outlines = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const initialContents = () => Object.fromEntries(outlines.map((item) => [item.id, resolvedOutlineContent(item)]));
  const [contentDrafts, setContentDrafts] = useState<Record<string, string>>(initialContents);
  const [dirtyContentIds, setDirtyContentIds] = useState<Set<string>>(() => new Set());
  const [versionSelections, setVersionSelections] = useState<Record<string, string>>({});
  const [chatOutlineId, setChatOutlineId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [inlinePanels, setInlinePanels] = useState<Record<string, "settings" | "names">>({});
  const [chapterMenu, setChapterMenu] = useState<Chapter | null>(null);
  const [outlinePanel, setOutlinePanel] = useState<{ outlineId: string; view: ContinuousOutlinePanelView } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<OutlineDropIndicator>(null);
  const contentDraftsRef = useRef(contentDrafts);
  const contentBaselinesRef = useRef<Record<string, string>>(initialContents());
  const defaultContentsRef = useRef<Record<string, string>>(initialContents());
  const editSourceVersionIdsRef = useRef<Record<string, string>>({});
  const studioRef = useRef(studio);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeOutlineIdRef = useRef(studio.currentOutline.id);
  const positionKey = `${studio.currentArticle.id}:${mode}`;
  const initialOutlineIdRef = useRef(studio.currentOutline.id);
  const initialPositionRef = useRef(positionMemory.current[positionKey]);
  const orderedIds = outlines.map((item) => item.id);
  const draggingOutline = outlines.find((item) => item.id === draggingId);
  const outlinePanelChapter = outlinePanel ? studio.currentArticle.chapters.find((chapter) => chapter.outlines.some((item) => item.id === outlinePanel.outlineId)) : undefined;
  const outlinePanelOutline = outlinePanelChapter?.outlines.find((item) => item.id === outlinePanel?.outlineId);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useContinuousEditorViewport(scrollRef);

  function toggleInlinePanel(targetId: string, panel: "settings" | "names") {
    setInlinePanels((current) => {
      if (current[targetId] !== panel) return { ...current, [targetId]: panel };
      const next = { ...current };
      delete next[targetId];
      return next;
    });
  }

  function commitEditedName(kind: "chapter" | "outline", entityId: string, title: string, chapter?: Chapter) {
    const value = title.trim();
    const entity = kind === "chapter"
      ? studio.currentArticle.chapters.find((item) => item.id === entityId)
      : studio.currentArticle.chapters.flatMap((item) => item.outlines).find((item) => item.id === entityId);
    const fallbackTitle = entity?.nameVersions?.find((item) => item.id === entity.defaultNameVersionId)?.title
      ?? entity?.nameVersions?.[0]?.title
      ?? (kind === "chapter" ? "未命名章节" : "");
    if (!value) {
      if (kind === "chapter") studio.updateChapter(entityId, { title: fallbackTitle });
      else studio.updateOutline(entityId, { title: fallbackTitle });
      onNotice("名称不能为空，已恢复原名称");
      return;
    }
    if (kind === "outline" && chapter?.outlines.some((item) => item.id !== entityId && normalizeOutlineTitle(item.title) === value)) {
      studio.updateOutline(entityId, { title: fallbackTitle });
      onNotice(`同一章节内已经使用大纲名「${value}」`);
      return;
    }
    studio.addManualNameVersion(kind, entityId, value, true);
    void studio.saveNow();
  }

  useEffect(() => { contentDraftsRef.current = contentDrafts; }, [contentDrafts]);
  useEffect(() => { studioRef.current = studio; }, [studio]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const remembered = initialPositionRef.current;
    const outlineId = remembered?.outlineId === initialOutlineIdRef.current ? remembered.outlineId : initialOutlineIdRef.current;
    const defaultOffset = Math.min(160, Math.max(32, container.clientHeight * .18));
    const offsetTop = remembered?.outlineId === outlineId ? remembered.offsetTop : defaultOffset;
    let stopped = false;
    let restoreFrame = 0;
    let settlingFrames = 8;
    const restore = () => {
      if (stopped) return;
      const target = Array.from(container.querySelectorAll<HTMLElement>("[data-continuous-outline-id]"))
        .find((element) => element.dataset.continuousOutlineId === outlineId);
      if (!target) return;
      const currentOffset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop = Math.max(0, container.scrollTop + currentOffset - offsetTop);
    };
    const scheduleRestore = () => {
      if (stopped || restoreFrame) return;
      restoreFrame = window.requestAnimationFrame(() => {
        restoreFrame = 0;
        restore();
      });
    };
    const settle = () => {
      restoreFrame = 0;
      if (stopped) return;
      restore();
      settlingFrames -= 1;
      if (settlingFrames > 0) restoreFrame = window.requestAnimationFrame(settle);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleRestore);
    const documentBody = container.querySelector<HTMLElement>(".continuous-document-body");
    if (documentBody) resizeObserver?.observe(documentBody);
    const stopRestoring = () => {
      stopped = true;
      resizeObserver?.disconnect();
      if (restoreFrame) window.cancelAnimationFrame(restoreFrame);
      restoreFrame = 0;
    };
    const userEvents: (keyof HTMLElementEventMap)[] = ["pointerdown", "wheel", "touchstart", "keydown"];
    for (const eventName of userEvents) container.addEventListener(eventName, stopRestoring, { passive: true });
    restore();
    restoreFrame = window.requestAnimationFrame(settle);
    const settleTimer = window.setTimeout(stopRestoring, CONTINUOUS_POSITION_SETTLE_MS);
    void document.fonts?.ready.then(scheduleRestore);
    return () => {
      window.clearTimeout(settleTimer);
      for (const eventName of userEvents) container.removeEventListener(eventName, stopRestoring);
      stopRestoring();
    };
  }, [positionKey]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let rememberFrame = 0;
    const remember = () => {
      const outlineId = activeOutlineIdRef.current;
      const target = Array.from(container.querySelectorAll<HTMLElement>("[data-continuous-outline-id]"))
        .find((element) => element.dataset.continuousOutlineId === outlineId);
      if (!target) return;
      positionMemory.current[positionKey] = {
        outlineId,
        offsetTop: target.getBoundingClientRect().top - container.getBoundingClientRect().top,
      };
    };
    const rememberAfterScroll = () => {
      if (rememberFrame) window.cancelAnimationFrame(rememberFrame);
      rememberFrame = window.requestAnimationFrame(() => {
        rememberFrame = 0;
        remember();
      });
    };
    container.addEventListener("scroll", rememberAfterScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", rememberAfterScroll);
      if (rememberFrame) window.cancelAnimationFrame(rememberFrame);
      remember();
    };
  }, [positionKey, positionMemory]);

  useEffect(() => {
    if (mode !== "content") return;
    setContentDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const item of outlines) {
        const content = resolvedOutlineContent(item);
        const alreadyTracked = Object.prototype.hasOwnProperty.call(next, item.id);
        if (alreadyTracked && (dirtyContentIds.has(item.id) || versionSelections[item.id])) continue;
        if (alreadyTracked && contentBaselinesRef.current[item.id] === content) continue;
        next[item.id] = content;
        contentBaselinesRef.current[item.id] = content;
        defaultContentsRef.current[item.id] = content;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [mode, outlines, dirtyContentIds, versionSelections]);

  useEffect(() => () => {
    if (mode !== "content") return;
    for (const [outlineId, text] of Object.entries(contentDraftsRef.current)) {
      if (text !== contentBaselinesRef.current[outlineId]) void studioRef.current.preserveContentDraft(outlineId, text);
    }
  }, [mode]);

  function changeContent(outlineId: string, text: string, sourceVersionId?: string) {
    if (sourceVersionId) editSourceVersionIdsRef.current[outlineId] = sourceVersionId;
    setVersionSelections((current) => {
      if (!current[outlineId]) return current;
      const next = { ...current };
      delete next[outlineId];
      return next;
    });
    contentDraftsRef.current = { ...contentDraftsRef.current, [outlineId]: text };
    setContentDrafts(contentDraftsRef.current);
    if (text === contentBaselinesRef.current[outlineId]) {
      studio.clearContentDraft(outlineId);
      setDirtyContentIds((current) => { const next = new Set(current); next.delete(outlineId); return next; });
    } else {
      studio.stageContentDraft(outlineId, text);
      setDirtyContentIds((current) => new Set(current).add(outlineId));
    }
  }

  async function commitContent(outlineId: string) {
    const next = contentDraftsRef.current[outlineId] ?? "";
    if (next === contentBaselinesRef.current[outlineId]) return true;
    const saved = await studio.saveCurrentContent(outlineId, next, editSourceVersionIdsRef.current[outlineId]);
    if (!saved) return false;
    delete editSourceVersionIdsRef.current[outlineId];
    contentBaselinesRef.current[outlineId] = next;
    defaultContentsRef.current[outlineId] = next;
    if (contentDraftsRef.current[outlineId] === next) {
      studio.clearContentDraft(outlineId);
      setDirtyContentIds((current) => { const updated = new Set(current); updated.delete(outlineId); return updated; });
    }
    return true;
  }

  async function saveAllContent() {
    for (const outlineId of [...dirtyContentIds]) {
      if (!await commitContent(outlineId)) {
        onNotice("保存未完成，请查看页面提示");
        return;
      }
    }
    const saved = await studio.saveNow();
    onNotice(saved ? "正文已保存" : "保存未完成，请查看页面提示");
  }

  async function saveAllContentAsVersions() {
    for (const outlineId of [...dirtyContentIds]) {
      if (!await commitContent(outlineId)) {
        onNotice("保存未完成，请查看页面提示");
        return;
      }
    }
    const defaultName = timestampContentName();
    const name = window.prompt("另存为正文版本", defaultName);
    if (name === null) return;
    const baseName = name.trim() || defaultName;
    outlines.forEach((item) => studio.saveVersion(item.id, outlines.length > 1 ? `${baseName} · ${outlineDisplayTitle(item)}` : baseName, "手动", contentDraftsRef.current[item.id] ?? ""));
    onNotice(`已将 ${outlines.length} 条正文另存为版本`);
  }

  async function copyAllOutlines() {
    const text = groups.map((group, groupIndex) => {
      const chapterHeading = `第 ${groupIndex + 1} 章 ${group.title}`;
      const outlineSections = group.items.map((item, itemIndex) => {
        const title = `${itemIndex + 1}. ${outlineDisplayTitle(item)}`;
        const plan = item.plan.trim();
        return plan ? `${title}\n${plan}` : title;
      });
      return [chapterHeading, ...outlineSections].join("\n\n");
    }).join("\n\n");
    if (!text) {
      onNotice("没有可复制的章节和大纲");
      return;
    }
    const copied = await copyTextToClipboard(text);
    onNotice(copied ? `已复制 ${groups.length} 个章节和 ${outlines.length} 条大纲` : "复制失败，请检查剪贴板权限");
  }

  function showContentVersion(outlineId: string, text: string, versionId?: string) {
    contentBaselinesRef.current[outlineId] = text;
    contentDraftsRef.current = { ...contentDraftsRef.current, [outlineId]: text };
    setContentDrafts(contentDraftsRef.current);
    setVersionSelections((current) => {
      const next = { ...current };
      if (versionId) next[outlineId] = versionId;
      else delete next[outlineId];
      return next;
    });
    studio.clearContentDraft(outlineId);
    delete editSourceVersionIdsRef.current[outlineId];
    setDirtyContentIds((current) => { const next = new Set(current); next.delete(outlineId); return next; });
  }

  async function selectContentVersion(item: Outline, versionId?: string) {
    await commitContent(item.id);
    const version = versionId ? item.versions.find((candidate) => candidate.id === versionId) : undefined;
    if (versionId && !version) return;
    showContentVersion(item.id, version?.content ?? resolvedOutlineContent(item), version?.id);
  }

  function setContentCurrentVersion(item: Outline, versionId: string) {
    const version = item.versions.find((candidate) => candidate.id === versionId);
    if (!version) return;
    studio.setCurrentVersion(item.id, version.id);
    defaultContentsRef.current[item.id] = version.content;
    showContentVersion(item.id, version.content);
    onNotice(`已将“${version.name}”设为「${outlineDisplayTitle(item)}」的当前正文`);
  }

  function setContentDefaultVersion(item: Outline, versionId: string) {
    const version = item.versions.find((candidate) => candidate.id === versionId);
    if (!version) return;
    studio.setDefaultVersion(item.id, version.id);
    onNotice(`已将“${version.name}”设为「${outlineDisplayTitle(item)}」的默认正文`);
  }

  function openOutlineChat(item: Outline) {
    studio.setChatSetting(item.id, "includePrevious", true);
    setChatOutlineId(item.id);
  }

  function activateOutline(outlineId: string) {
    if (activeOutlineIdRef.current === outlineId) return;
    activeOutlineIdRef.current = outlineId;
    studio.setCurrentOutline(outlineId);
  }

  function selectAdjacentOutline(outlineId: string) {
    const index = orderedIds.indexOf(outlineId);
    const adjacentId = orderedIds[index + 1] ?? orderedIds[index - 1];
    activeOutlineIdRef.current = adjacentId ?? "";
    if (adjacentId) studio.setCurrentOutline(adjacentId);
  }

  function createOutlineBelow(item: Outline, chapterId: string) {
    const id = studio.createOutline(chapterId, item.id);
    activeOutlineIdRef.current = id;
    onNotice(`已在「${outlineDisplayTitle(item)}」下方新建大纲`);
    window.requestAnimationFrame(() => {
      const target = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-continuous-outline-id]") ?? [])
        .find((element) => element.dataset.continuousOutlineId === id);
      target?.scrollIntoView({ block: "nearest" });
      target?.querySelector<HTMLInputElement>(".continuous-outline-title-input")?.focus({ preventScroll: true });
    });
  }

  function deleteOutlineFromDocument(item: Outline) {
    setOutlinePanel((current) => current?.outlineId === item.id ? null : current);
    selectAdjacentOutline(item.id);
    studio.deleteOutline(item.id);
    onNotice(`已删除「${outlineDisplayTitle(item)}」`);
  }

  function toggleOutlineArchive(item: Outline) {
    if (!item.archived && !studio.data.settings.showArchived) setOutlinePanel((current) => current?.outlineId === item.id ? null : current);
    if (!item.archived && !studio.data.settings.showArchived) selectAdjacentOutline(item.id);
    studio.updateOutline(item.id, { archived: !item.archived });
    onNotice(item.archived ? `已恢复「${outlineDisplayTitle(item)}」` : `已归档「${outlineDisplayTitle(item)}」`);
  }

  async function runReview(input: { chapterId: string; model: string; requirements: string[]; additionalRequirement: string; ruleSnapshot: ReviewRuleSnapshot; reasoningEffort?: ReasoningEffort | null }) {
    const chapter = studio.currentArticle.chapters.find((item) => item.id === input.chapterId);
    if (!chapter) throw new Error("Review 章节不存在");
    const resolvedSettings = resolveChapterSettings(studio.currentArticle, chapter.id);
    const sourceOutlines = chapter.outlines.filter((item) => !item.archived).map((item) => ({
      id: item.id,
      title: item.title,
      plan: item.plan,
      name: resolvedOutlineContentName(item),
      text: contentDraftsRef.current[item.id] ?? resolvedOutlineContent(item),
      baseText: resolvedOutlineContent(item),
      sourceVersionId: editSourceVersionIdsRef.current[item.id],
      settings: resolveOutlineSettings(studio.currentArticle, item.id),
    })).filter((item) => item.text.trim());
    const response = await fetchServerAction("/api/ai/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId: studio.currentArticle.id, ...input, source: {
        article: {
          id: studio.currentArticle.id,
          title: studio.currentArticle.title,
          ...resolvedSettings.story,
          characters: resolvedSettings.characters.filter((person) => !person.archived && person.appears !== false).map((person) => ({ name: person.name, aliases: person.aliases, description: person.description, profile: person.profile, endingChanges: person.endingChanges })),
        },
        chapter: { id: chapter.id, title: chapter.title },
        outlines: sourceOutlines,
        requirements: input.requirements,
        additionalRequirement: input.additionalRequirement,
        model: input.model,
      } }),
    });
    const payload = await response.json() as {
      error?: string;
      updated?: Array<{ outlineId: string; versionId: string; name: string; text: string }>;
      patches?: Array<{ outlineId: string } & Partial<Outline>>;
      revision?: number;
      articleUpdatedAt?: string;
      editCount?: number;
      inputTokens?: number;
      outputTokens?: number;
    };
    if (!response.ok) throw new Error(payload.error || "AI Review 失败");
    const persistedTexts = new Map((payload.patches ?? []).map((patch) => {
      const version = patch.currentVersionId ? patch.versions?.find((item) => item.id === patch.currentVersionId) : undefined;
      return [patch.outlineId, version?.content ?? patch.content ?? ""];
    }));
    if (payload.revision !== undefined) {
      const patches = new Map((payload.patches ?? []).map((item) => [item.outlineId, item]));
      studio.acceptServerMutation(payload.revision, (current) => ({
        ...current,
        articles: current.articles.map((article) => article.id !== studio.currentArticle.id ? article : ({
          ...article,
          updatedAt: payload.articleUpdatedAt ?? article.updatedAt,
          chapters: article.chapters.map((item) => item.id !== chapter.id ? item : ({ ...item, outlines: item.outlines.map((outline) => {
            const patch = patches.get(outline.id);
            return patch ? { ...outline, ...patch } : outline;
          }) })),
        })),
      }));
    }
    const updated = payload.updated ?? [];
    if (updated.length || persistedTexts.size) {
      const nextDrafts = { ...contentDraftsRef.current };
      const nextSelections = { ...versionSelections };
      for (const [outlineId, text] of persistedTexts) {
        nextDrafts[outlineId] = text;
        contentBaselinesRef.current[outlineId] = text;
        defaultContentsRef.current[outlineId] = text;
        delete nextSelections[outlineId];
        delete editSourceVersionIdsRef.current[outlineId];
        studio.clearContentDraft(outlineId);
      }
      contentDraftsRef.current = nextDrafts;
      setContentDrafts(nextDrafts);
      setVersionSelections(nextSelections);
      setDirtyContentIds((current) => {
        const next = new Set(current);
        persistedTexts.forEach((_, outlineId) => next.delete(outlineId));
        return next;
      });
    }
    const usage = payload.inputTokens || payload.outputTokens ? ` · ${Number(payload.inputTokens ?? 0).toLocaleString("zh-CN")} 输入 / ${Number(payload.outputTokens ?? 0).toLocaleString("zh-CN")} 输出 tokens` : "";
    onNotice(updated.length ? `AI Review 已修改 ${updated.length} 条正文并设为当前正文${usage}` : `AI Review 完成，未发现需要修改的正文${usage}`);
  }

  function clearDragState() {
    setDraggingId(null);
    setDropIndicator(null);
  }

  function handleDragOver(event: DragOverEvent) {
    const targetId = event.over ? String(event.over.id) : "";
    setDropIndicator(event.over?.data.current?.type === "outline" && targetId !== String(event.active.id) ? { targetId, placement: outlineDropPlacement(event, orderedIds) } : null);
  }

  function finishDrag(event: DragEndEvent) {
    const sourceId = String(event.active.id);
    const targetId = event.over ? String(event.over.id) : "";
    const targetType = event.over?.data.current?.type;
    const chapterId = targetType === "chapter" ? String(event.over?.data.current?.chapterId ?? "") : "";
    const source = outlines.find((item) => item.id === sourceId);
    clearDragState();
    if (!source) return;
    if (chapterId) {
      studio.moveOutlineToChapter(sourceId, chapterId);
      const chapter = groups.find((item) => item.id === chapterId);
      onNotice(chapter ? `已将「${outlineDisplayTitle(source)}」移到「${chapter.title}」末尾` : `已移动「${outlineDisplayTitle(source)}」`);
      return;
    }
    if (!targetId || targetId === sourceId || targetType !== "outline") return;
    const placement = dropIndicator?.targetId === targetId ? dropIndicator.placement : outlineDropPlacement(event, orderedIds);
    studio.moveOutline(sourceId, targetId, placement);
    onNotice(`已移动「${outlineDisplayTitle(source)}」`);
  }

  const contentStyle: CSSProperties | undefined = mode === "content" ? {
    fontSize: studio.data.settings.fontSize,
    lineHeight: studio.data.settings.lineHeight,
    fontFamily: "var(--font-editor)",
  } : undefined;
  const contentWords = outlines.reduce((total, item) => total + wordCount(contentDrafts[item.id] ?? ""), 0);
  const status = mode === "content" && dirtyContentIds.size ? `${dirtyContentIds.size} 条编辑中` : saveStatusLabel(studio.saveStatus);

  return <div ref={scrollRef} className="page-scroll keyboard-aware-page-scroll"><div className={`continuous-document-editor mode-${mode}`}>
    <PageHeader eyebrow={mode === "outline" ? "章节与大纲" : "全文编辑"} title={studio.currentArticle.title} description={`${groups.length} 章 · ${outlines.length} 条大纲${mode === "content" ? ` · ${contentWords.toLocaleString("zh-CN")} 字` : ""} · ${status}`} actions={mode === "outline" ? <Group className="continuous-heading-actions article-heading-actions" gap="xs" wrap="nowrap"><Button className="article-setting-trigger" variant="subtle" size="sm" type="button" aria-expanded={inlinePanels[studio.currentArticle.id] === "settings"} onClick={() => toggleInlinePanel(studio.currentArticle.id, "settings")}>设定<Icon name="chevron" /></Button><Button className="article-setting-trigger" variant="subtle" size="sm" type="button" aria-expanded={inlinePanels[studio.currentArticle.id] === "names"} onClick={() => toggleInlinePanel(studio.currentArticle.id, "names")}>名称<Icon name="chevron" /></Button><Button className="copy-all-outlines-button" variant="default" size="sm" type="button" aria-label="复制" leftSection={<Icon name="copy" />} onClick={() => void copyAllOutlines()}>复制</Button></Group> : <><Button variant="default" type="button" onClick={() => void saveAllContentAsVersions()}>另存为</Button><Button type="button" loading={studio.saveStatus === "saving"} onClick={() => void saveAllContent()}>保存</Button>{STANDALONE_AI_REVIEW_ENABLED && <IconButton name="review" label="AI Review" variant="glass" size="large" className="full-content-review-button" onClick={() => setReviewOpen(true)} />}</>} />
    {mode === "outline" && inlinePanels[studio.currentArticle.id] && <section className="continuous-inline-panel article-inline-panel" aria-label={`${studio.currentArticle.title}${inlinePanels[studio.currentArticle.id] === "settings" ? "文章设定" : "名称"}`}>{inlinePanels[studio.currentArticle.id] === "settings" ? <ArticleSettingsInline /> : <UnifiedNamingEditor target="article" onNotice={onNotice} onTaskCreated={onTaskCreated} />}</section>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll={{ acceleration: 10, threshold: { x: 0.12, y: 0.12 } }} onDragStart={(event) => setDraggingId(String(event.active.id))} onDragOver={handleDragOver} onDragCancel={clearDragState} onDragEnd={finishDrag}>
      <div className="continuous-document-body">
        {groups.map((group, groupIndex) => <section className="continuous-chapter" key={group.id}>
          {mode === "outline" ? <><ContinuousChapterHeading chapterId={group.id} index={groupIndex} title={group.title} settingCount={countChapterSettingChanges(group.settings)} settingsOpen={inlinePanels[group.id] === "settings"} namesOpen={inlinePanels[group.id] === "names"} onSettings={() => toggleInlinePanel(group.id, "settings")} onNames={() => toggleInlinePanel(group.id, "names")} onMore={() => setChapterMenu(group)} onTitle={(value) => studio.updateChapter(group.id, { title: value.slice(0, 120) })} onTitleCommit={(value) => commitEditedName("chapter", group.id, value)} />{inlinePanels[group.id] && <section className="continuous-inline-panel chapter-inline-panel" aria-label={`${group.title}${inlinePanels[group.id] === "settings" ? "章节设定" : "名称"}`}>{inlinePanels[group.id] === "settings" ? <ScopedSettingsInline level="chapter" targetId={group.id} /> : <UnifiedNamingEditor target="chapter" chapter={group} onNotice={onNotice} onTaskCreated={onTaskCreated} />}</section>}</> : <header className="continuous-chapter-heading"><div><span>第 {groupIndex + 1} 章</span><h2>{group.title}</h2></div></header>}
          <SortableContext items={group.items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            {group.items.length ? group.items.map((item, itemIndex) => <ContinuousOutlineBlock
              key={item.id}
              item={item}
              number={itemIndex + 1}
              mode={mode}
              text={mode === "outline" ? item.plan : contentDrafts[item.id] ?? ""}
              selectedVersionId={mode === "content" ? versionSelections[item.id] : undefined}
              dropPlacement={dropIndicator?.targetId === item.id ? dropIndicator.placement : undefined}
              contentStyle={contentStyle}
              active={studio.currentOutline.id === item.id}
              propertiesOpen={mode === "outline" && outlinePanel?.outlineId === item.id && outlinePanel.view !== "move"}
              namesOpen={mode === "outline" && outlinePanel?.outlineId === item.id && outlinePanel.view === "names"}
              onActivate={() => activateOutline(item.id)}
              onAdd={mode === "outline" ? () => createOutlineBelow(item, group.id) : undefined}
              onDelete={mode === "outline" ? () => deleteOutlineFromDocument(item) : undefined}
              onArchive={mode === "outline" ? () => toggleOutlineArchive(item) : undefined}
              onProperties={mode === "outline" ? () => setOutlinePanel((current) => current?.outlineId === item.id && current.view !== "move" ? null : { outlineId: item.id, view: "settings" }) : undefined}
              onNames={mode === "outline" ? () => setOutlinePanel((current) => current?.outlineId === item.id && current.view === "names" ? null : { outlineId: item.id, view: "names" }) : undefined}
              onTitle={(value) => studio.updateOutline(item.id, { title: value.slice(0, 80) })}
              onTitleCommit={mode === "outline" ? (value) => commitEditedName("outline", item.id, value, group) : undefined}
              onText={(value) => mode === "outline" ? studio.updateOutline(item.id, { plan: value.slice(0, 10000) }) : changeContent(item.id, value, versionSelections[item.id])}
              onContentBlur={mode === "content" ? () => commitContent(item.id) : undefined}
              onSelectVersion={mode === "content" ? (versionId) => selectContentVersion(item, versionId) : undefined}
              onSetCurrentVersion={mode === "content" ? (versionId) => setContentCurrentVersion(item, versionId) : undefined}
              onSetDefaultVersion={mode === "content" ? (versionId) => setContentDefaultVersion(item, versionId) : undefined}
              onOpenChat={mode === "outline" ? () => openOutlineChat(item) : undefined}
              onMoveUp={itemIndex > 0 ? () => { studio.moveOutline(item.id, group.items[itemIndex - 1].id, "before"); onNotice(`已上移「${outlineDisplayTitle(item)}」`); } : undefined}
              onMoveDown={itemIndex < group.items.length - 1 ? () => { studio.moveOutline(item.id, group.items[itemIndex + 1].id, "after"); onNotice(`已下移「${outlineDisplayTitle(item)}」`); } : undefined}
              onMoveChapter={mode === "outline" && groups.length > 1 ? () => setOutlinePanel({ outlineId: item.id, view: "move" }) : undefined}
            />) : <ContinuousEmptyChapter chapterId={group.id} />}
          </SortableContext>
        </section>)}
      </div>
      <DragOverlay dropAnimation={{ duration: 140, easing: "ease" }}>
        {draggingOutline && <div className="continuous-drag-overlay"><span className="outline-grip-dots" aria-hidden="true" /><span className="ui-title">{outlineDisplayTitle(draggingOutline)}</span></div>}
      </DragOverlay>
    </DndContext>
    {mode === "outline" && chapterMenu && <ChapterActionSheet chapter={chapterMenu} onClose={() => setChapterMenu(null)} onNotice={onNotice} onOpenOutline={activateOutline} onSettings={() => toggleInlinePanel(chapterMenu.id, "settings")} />}
    {mode === "outline" && outlinePanel && outlinePanelChapter && outlinePanelOutline && <ContinuousOutlinePropertiesDrawer
      outline={outlinePanelOutline}
      chapter={outlinePanelChapter}
      chapters={groups}
      view={outlinePanel.view}
      onView={(view) => setOutlinePanel((current) => current ? { ...current, view } : current)}
      onClose={() => setOutlinePanel(null)}
      onMove={(chapterId) => {
        const target = groups.find((chapter) => chapter.id === chapterId);
        studio.moveOutlineToChapter(outlinePanelOutline.id, chapterId);
        setOutlinePanel(null);
        onNotice(target ? `已移动到「${target.title}」` : `已移动「${outlineDisplayTitle(outlinePanelOutline)}」`);
      }}
      onNotice={onNotice}
      onTaskCreated={onTaskCreated}
    />}
    {mode === "outline" && chatOutlineId && <FullOutlineChatDialog outlineId={chatOutlineId} onClose={() => setChatOutlineId(null)} onNotice={onNotice} />}
    {STANDALONE_AI_REVIEW_ENABLED && mode === "content" && reviewOpen && <AiReviewDialog article={studio.currentArticle} chapters={studio.currentArticle.chapters} models={reviewModels} initialModel={studio.data.settings.reviewModel} onClose={() => setReviewOpen(false)} onSetDefaultModel={(reviewModel) => { studio.updateSettings({ reviewModel }); void studio.saveNow(); }} onRun={runReview} />}
  </div></div>;
}

function SearchPage({ onOutline, onCharacter }: { onOutline: (id: string) => void; onCharacter: () => void }) {
  const studio = useStudio();
  const [query, setQuery] = useState("潮汐");
  const normalized = query.trim().toLocaleLowerCase();
  const outlineResults = normalized ? studio.currentArticle.chapters.flatMap((chapter) => chapter.outlines.map((item) => ({ chapter, item, content: resolvedOutlineContent(item) }))).filter(({ chapter, item, content }) => `${chapter.title}\n${outlineDisplayTitle(item)}\n${item.plan}\n${content}`.toLocaleLowerCase().includes(normalized)) : [];
  const characterResults = normalized ? studio.currentArticle.characters.filter((character) => `${character.name}\n${character.aliases.join(" ")}\n${character.description}`.toLocaleLowerCase().includes(normalized)) : [];
  return (
    <div className="page-scroll"><div className="standard-page search-page">
      <PageHeader eyebrow="当前文章" title={`搜索「${studio.currentArticle.title}」`} />
      <label className="large-search"><Icon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" /></label>
      <div className="search-summary"><span>找到 {outlineResults.length + characterResults.length} 个结果</span></div>
      {studio.currentArticle.chapters.map((chapter) => { const results = outlineResults.filter((result) => result.chapter.id === chapter.id); return results.length ? <SearchGroup title={chapter.title} key={chapter.id}>{results.map(({ item, content }) => { const displayTitle = outlineDisplayTitle(item); return <SearchResult key={item.id} type={displayTitle.toLocaleLowerCase().includes(normalized) || item.plan.toLocaleLowerCase().includes(normalized) ? "大纲" : "正文"} title={displayTitle} snippet={(item.plan.toLocaleLowerCase().includes(normalized) ? item.plan : content).slice(0, 100)} onClick={() => onOutline(item.id)} />; })}</SearchGroup> : null; })}
      {characterResults.length > 0 && <SearchGroup title="人物资料">{characterResults.map((character) => <SearchResult key={character.id} type="人物" title={character.name} snippet={character.description || character.aliases.join("、")} onClick={onCharacter} />)}</SearchGroup>}
      {normalized && outlineResults.length + characterResults.length === 0 && <div className="empty-inline">没有找到相关内容。</div>}
    </div></div>
  );
}

function SearchGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="search-group"><h2>{title}</h2>{children}</section>;
}

function SearchResult({ type, title, snippet, onClick }: { type: string; title: string; snippet: string; onClick: () => void }) {
  return <button className="search-result" type="button" onClick={onClick}><span className="result-type">{type}</span><div><span className="ui-title">{title}</span><p>{snippet}</p></div><span>打开 →</span></button>;
}

function ArticleInfoPage({ view, onGo, onNotice }: { view: View; onGo: (view: View) => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const [moreOpen, setMoreOpen] = useState(false);
  const [copySource, setCopySource] = useState<Article | null>(null);
  useDismissOnOutside(moreOpen, () => setMoreOpen(false), ".info-more-trigger, .info-more-menu");

  async function copyArticle(options: ArticleCopyOptions) {
    if (!copySource) return false;
    if (!await studio.saveNow()) {
      onNotice("请先完成当前文章的保存");
      return false;
    }
    const copied = studio.duplicateArticle(copySource.id, options);
    if (!copied) {
      onNotice("原文章不存在，无法创建副本");
      return false;
    }
    const saved = await studio.saveNow();
    setCopySource(null);
    window.history.pushState({}, "", `/articles/${copied.articleId}/info/basic`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    onNotice(saved ? "文章副本已创建" : "副本已创建，保存尚未完成");
    return true;
  }

  return (
    <div className="page-scroll"><div className="standard-page info-page">
      <PageHeader eyebrow={studio.currentArticle.title} title="文章资料" actions={<IconButton name="more" label="文章资料更多操作" className="info-more-trigger" onClick={() => setMoreOpen((open) => !open)} />} />
      {moreOpen && <div className="info-more-menu"><button type="button" onClick={() => { transfer.exportArticle(studio.currentArticle); setMoreOpen(false); }}>导出这篇文章</button><button type="button" onClick={() => { setCopySource(studio.currentArticle); setMoreOpen(false); }}>复制这篇文章</button><button type="button" onClick={() => { studio.updateSettings({ showArchived: !studio.data.settings.showArchived }); setMoreOpen(false); }}>{studio.data.settings.showArchived ? "隐藏" : "显示"}已归档内容</button><button className="danger" type="button" onClick={() => { const value = window.prompt(`输入文章标题「${studio.currentArticle.title}」以确认删除`); if (value === studio.currentArticle.title) studio.deleteArticle(studio.currentArticle.id); setMoreOpen(false); }}>删除文章</button></div>}
      <Tabs items={[
        ["info-basic", "基本信息"], ["info-ai-tasks", "AI 任务设定"], ["info-characters", "人物"], ["info-relationships", "人物关系"],
      ]} active={view} onGo={onGo} />
      {view === "info-basic" && <BasicInfo />}
      {view === "info-ai-tasks" && <div className="article-ai-task-settings">
        <ArticleGenerateSettings />
        <ArticleIllustrationSettings />
        <div className="form-card article-ai-task-section"><ArticleReviewRulesPage /></div>
        <ArticleChapterNames />
      </div>}
      {view === "info-characters" && <Characters />}
      {view === "info-relationships" && <Relationships />}
      {copySource && <ArticleCopyDialog article={copySource} existingTitles={studio.data.articles.map((article) => article.title)} onClose={() => setCopySource(null)} onCreate={copyArticle} />}
    </div></div>
  );
}

function Tabs({ items, active, onGo }: { items: [View, string][]; active: View; onGo: (view: View) => void }) {
  return <div className="tabs" role="tablist">{items.map(([key, label]) => <button key={key} className={active === key ? "active" : ""} type="button" role="tab" aria-selected={active === key} onClick={() => onGo(key)}>{label}</button>)}</div>;
}

function BasicInfo() {
  const studio = useStudio();
  const article = studio.currentArticle;
  return <div className="form-card article-story-settings"><div className="form-grid"><label className="full">文章标题<input value={article.title} maxLength={120} onChange={(event) => studio.updateArticle({ title: event.target.value })} /></label><label className="full">简介<small>故事类型、时代背景、世界规则等内容都可以写在这里。</small><textarea value={article.summary} maxLength={10000} onChange={(event) => studio.updateArticle({ summary: event.target.value })} /></label></div><ArticleStoryFields article={article} /><div className="form-foot"><span>创建于 {formatTime(article.createdAt)} · 修改于 {formatTime(article.updatedAt)}</span><span className="save-state"><i /> 已自动保存</span></div></div>;
}

function ArticleGenerateSettings() {
  const studio = useStudio();
  const models = useConfiguredModels();
  const article = studio.currentArticle;
  const settings = normalizeAiGenerateOptions(article.aiGenerateSettings, DEFAULT_AI_GENERATE_OPTIONS);
  const selectedRecord = configuredModelForReference(models, settings.model);
  const selectedModelReference = selectedRecord?.id ?? settings.model;
  const rewriteRetentionIndex = rewriteRetentionOptions.findIndex((item) => item.value === settings.rewriteRetention);
  const rewriteRetentionOption = rewriteRetentionOptions[rewriteRetentionIndex] ?? rewriteRetentionOptions[1];
  const overriddenOutlines = article.chapters.reduce((count, chapter) => count + chapter.outlines.filter((outline) => outline.generateOptions !== null).length, 0);
  const modelOptions = [
    { value: "", label: "本地演示引擎" },
    ...(selectedModelReference && !selectedRecord ? [{ value: selectedModelReference, label: `${selectedModelReference}（不可用）` }] : []),
    ...models.map((model) => ({ value: model.id, label: `${modelDisplayLabel(models, model.id)}${model.hasSecret ? "" : "（需密钥）"}` })),
  ];
  const patchSettings = (patch: Partial<AiGenerateOptions>) => studio.updateArticle({ aiGenerateSettings: normalizeAiGenerateOptions({ ...settings, ...patch }, DEFAULT_AI_GENERATE_OPTIONS) });

  return <section className="form-card article-ai-task-section article-generate-settings" aria-labelledby="article-generate-title">
    <header className="article-ai-task-section-heading"><h2 id="article-generate-title">AI Generate</h2><p>新大纲和尚未单独调整过的大纲会使用这些选项。</p></header>
    <div className="article-generate-basics">
      <Select label="默认模型" aria-label="文章 AI Generate 默认模型" data={modelOptions} value={selectedModelReference} allowDeselect={false} onChange={(value) => patchSettings({ model: value ?? "" })} />
      <NumberInput label="默认目标字数" aria-label="文章 AI Generate 默认目标字数" min={0} max={MAX_GENERATE_TARGET_WORDS} step={100} thousandSeparator="," suffix=" 字" placeholder="不限" value={settings.targetWords || ""} onChange={(value) => patchSettings({ targetWords: value === "" ? 0 : Number(value) })} />
    </div>
    <section className="article-generate-block" aria-labelledby="article-generate-mode-title">
      <div className="generate-section-heading"><span id="article-generate-mode-title">生成方式</span><strong>{contentGenerationModeLabel(settings.contentMode)}</strong></div>
      <div className="generate-mode-options" role="radiogroup" aria-label="文章默认正文生成方式">{contentGenerationModes.map((item) => <button className={settings.contentMode === item.value ? "selected" : ""} type="button" role="radio" aria-checked={settings.contentMode === item.value} key={item.value} onClick={() => patchSettings({ contentMode: item.value })}><span className="ui-title">{item.label}</span></button>)}</div>
      <p className="generate-mode-description">{contentGenerationModes.find((item) => item.value === settings.contentMode)?.mobileDescription}</p>
      {settings.contentMode === "rewrite" && <div className="rewrite-retention-control article-rewrite-retention"><div className="rewrite-retention-heading"><div><span>默认原文保留度</span></div><strong>{rewriteRetentionOption.label} · {rewriteRetentionOption.shortLabel}</strong></div><Slider thumbLabel="默认原文保留度" min={0} max={rewriteRetentionOptions.length - 1} step={1} marks={rewriteRetentionOptions.map((item, index) => ({ value: index, label: item.label }))} value={rewriteRetentionIndex} label={(value) => rewriteRetentionOptions[value]?.shortLabel ?? "平衡改写"} onChange={(value) => patchSettings({ rewriteRetention: rewriteRetentionOptions[value]?.value ?? DEFAULT_REWRITE_RETENTION_LEVEL })} /><p>{rewriteRetentionOption.description}</p></div>}
    </section>
    <section className="article-generate-block prose-controls-section" aria-labelledby="article-prose-controls-title">
      <div className="generate-section-heading"><span id="article-prose-controls-title">正文表达</span><strong>默认写作倾向</strong></div>
      <div className="prose-controls-grid">
        <ProseControlRow id="article-dialogue-density" label="对话密度" value={settings.proseControls.dialogueDensity} options={DIALOGUE_DENSITY_OPTIONS} onChange={(dialogueDensity) => patchSettings({ proseControls: { ...settings.proseControls, dialogueDensity } })} className="dialogue-density-control" />
        <ProseControlRow id="article-introspection-density" label="内心活动" value={settings.proseControls.introspectionDensity} options={INTROSPECTION_DENSITY_OPTIONS} onChange={(introspectionDensity) => patchSettings({ proseControls: { ...settings.proseControls, introspectionDensity } })} />
        <ProseControlRow id="article-description-detail" label="描写细度" value={settings.proseControls.descriptionDetail} options={DESCRIPTION_DETAIL_OPTIONS} onChange={(descriptionDetail) => patchSettings({ proseControls: { ...settings.proseControls, descriptionDetail } })} />
        <ProseControlRow id="article-narrative-pace" label="叙事节奏" value={settings.proseControls.narrativePace} options={NARRATIVE_PACE_OPTIONS} onChange={(narrativePace) => patchSettings({ proseControls: { ...settings.proseControls, narrativePace } })} />
        <ProseControlRow id="article-paragraph-length" label="段落长度" value={settings.proseControls.paragraphLength} options={PARAGRAPH_LENGTH_OPTIONS} onChange={(paragraphLength) => patchSettings({ proseControls: { ...settings.proseControls, paragraphLength } })} />
      </div>
    </section>
    <section className="article-generate-block article-generate-references" aria-labelledby="article-generate-reference-title">
      <div className="generate-section-heading"><span id="article-generate-reference-title">参考内容</span></div>
      <div className="article-generate-toggle-grid">
        <Checkbox label="包含前面大纲" checked={settings.includePrevious} onChange={(event) => patchSettings({ includePrevious: event.currentTarget.checked })} />
        <Checkbox label="包含相关人物" checked={settings.includeCharacters} onChange={(event) => patchSettings({ includeCharacters: event.currentTarget.checked })} />
        <Checkbox label="参考优秀片段" checked={settings.includeExcellentFragments} onChange={(event) => patchSettings({ includeExcellentFragments: event.currentTarget.checked })} />
        <Checkbox label="同时生成大纲名" checked={settings.includeOutlineTitle} onChange={(event) => patchSettings({ includeOutlineTitle: event.currentTarget.checked })} />
      </div>
    </section>
    <section className="article-generate-block article-generate-reasoning" aria-label="文章 AI Generate 推理设置"><ReasoningSettings value={settings.reasoningEffort} modelValue={selectedRecord?.reasoningEffort} onChange={(reasoningEffort) => patchSettings({ reasoningEffort })} /></section>
    <div className="form-foot"><span>{overriddenOutlines ? `${overriddenOutlines} 条大纲已保存自己的最近设置` : "全部大纲均跟随此预设"}</span><span className="save-state"><i /> 已自动保存</span></div>
  </section>;
}

function ArticleChapterNames() {
  const studio = useStudio();
  const article = studio.currentArticle;
  const activeChapters = article.chapters.filter((chapter) => !chapter.archived);
  const eligibleOutlineCount = activeChapters.reduce((total, chapter) => total + chapter.outlines.filter((outline) => !outline.archived && outline.plan.trim()).length, 0);
  return <section className="form-card article-ai-task-section article-naming-page" aria-labelledby="article-naming-title">
      <header className="article-ai-task-section-heading"><h2 id="article-naming-title">命名规则</h2><p>用于 AI 生成章节和大纲名称。</p></header>
      <section className="article-naming-settings">
        {!eligibleOutlineCount && <Alert color="studio" variant="light">当前没有包含内容的未归档大纲。填写大纲内容后即可生成全部名称。</Alert>}
        <div className="article-naming-grid"><NamingProfileEditor title="章节命名" profile={article.chapterNaming} fallback={DEFAULT_CHAPTER_NAMING_PROFILE} onChange={(chapterNaming) => studio.updateArticle({ chapterNaming })} /><NamingProfileEditor title="大纲命名" profile={article.outlineNaming} fallback={DEFAULT_OUTLINE_NAMING_PROFILE} onChange={(outlineNaming) => studio.updateArticle({ outlineNaming })} /></div>
      </section>
      <div className="form-foot"><span>{activeChapters.length} 个未归档章节 · {eligibleOutlineCount} 条可命名大纲</span><span className="save-state"><i /> 已自动保存</span></div>
    </section>;
}

function NamingProfileEditor({ title, profile, fallback, onChange }: { title: string; profile: NamingProfile; fallback: NamingProfile; onChange: (profile: NamingProfile) => void }) {
  const value = normalizeNamingProfile(profile, fallback);
  const patch = (next: Partial<NamingProfile>) => onChange(normalizeNamingProfile({ ...value, ...next }, fallback));
  const help = value.format === "five"
    ? `${value.lineCount} 句，每句严格 5 个汉字`
    : value.format === "seven"
      ? `${value.lineCount} 句，每句严格 7 个汉字`
      : value.format === "cipai"
        ? `${CIPAI_OPTIONS.find((item) => item.value === value.cipai)?.label ?? "如梦令"}风格 · ${value.lineCount} 句 · 结果不显示词牌名`
        : `忽略空格和标点后 ${value.minCharacters}–${value.maxCharacters} 字`;
  return <fieldset className="naming-profile-editor">
    <legend>{title}</legend>
    <label>语言风格<select value={value.style} onChange={(event) => patch({ style: event.target.value as NamingProfile["style"] })}>{NAMING_STYLE_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
    {value.style === "custom" && <label>自定义语言风格<textarea maxLength={500} value={value.customStyle} placeholder="例如：使用冷峻短句和海洋意象" onChange={(event) => patch({ customStyle: event.target.value })} /></label>}
    <label>表达内容<select value={value.expression} onChange={(event) => patch({ expression: event.target.value as NamingProfile["expression"] })}>{NAMING_EXPRESSION_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
    {value.expression === "custom" && <label>自定义表达要求<textarea maxLength={500} value={value.customExpression} placeholder="例如：只暗示人物关系变化，不直接写出事件结果" onChange={(event) => patch({ customExpression: event.target.value })} /></label>}
    <label>格式<select value={value.format} onChange={(event) => patch({ format: event.target.value as NamingProfile["format"] })}>{NAMING_FORMAT_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
    {value.format === "range" ? <div className="naming-length-range"><label>最少字数<input type="number" min="1" max="80" value={value.minCharacters} onChange={(event) => patch({ minCharacters: Number(event.target.value) })} /></label><label>最多字数<input type="number" min={value.minCharacters} max="80" value={value.maxCharacters} onChange={(event) => patch({ maxCharacters: Number(event.target.value) })} /></label></div> : <div className="naming-poetry-options">{value.format === "cipai" && <label>参考词牌<select value={value.cipai} onChange={(event) => patch({ cipai: event.target.value as NamingProfile["cipai"] })}>{CIPAI_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>}<label>生成句数<select value={String(value.lineCount)} onChange={(event) => patch({ lineCount: Number(event.target.value) })}>{[1, 2, 3, 4].map((count) => <option value={count} key={count}>{count} 句</option>)}</select></label></div>}
    <small>{help}；多句以中文逗号连接并保存为单行。</small>
  </fieldset>;
}

function Characters() {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [photoTab, setPhotoTab] = useState(false);
  const [form, setForm] = useState({ name: "", aliases: "", description: "", profile: normalizeCharacterProfile(undefined), visual: undefined as CharacterVisual | undefined });
  const visible = studio.currentArticle.characters.filter((person) => (studio.data.settings.showArchived || !person.archived) && `${person.name}${person.aliases.join("")}${person.description}${Object.values(normalizeCharacterProfile(person.profile)).join("")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function openCreate() { setPhotoTab(false); setEditingId(null); setForm({ name: "", aliases: "", description: "", profile: normalizeCharacterProfile(undefined), visual: undefined }); setFormOpen(true); }
  function openEdit(person: Character) { setPhotoTab(false); setEditingId(person.id); setForm({ name: person.name, aliases: person.aliases.join("，"), description: person.description, profile: normalizeCharacterProfile(person.profile), visual: person.visual }); setFormOpen(true); }
  function save() {
    const name = form.name.trim();
    if (!name) return;
    const aliases = [...new Set(form.aliases.split(/[，,;；\n]/).map((item) => item.trim()).filter(Boolean))];
    if (editingId) studio.updateCharacter(editingId, { name, aliases, description: form.description, profile: form.profile, visual: form.visual });
    else studio.addCharacter({ name, aliases, description: form.description, profile: form.profile, visual: form.visual, archived: false });
    setFormOpen(false);
  }
  function showPhotos() {
    const name = form.name.trim(); if (!name) return;
    const patch = { name, aliases: [...new Set(form.aliases.split(/[，,;；\n]/).map(s => s.trim()).filter(Boolean))], description: form.description, profile: form.profile, visual: form.visual };
    if (editingId) studio.updateCharacter(editingId, patch);
    else setEditingId(studio.addCharacter({ ...patch, archived: false }));
    setPhotoTab(true);
    window.setTimeout(() => void studio.saveNow(), 0);
  }
  return <>
    <div className="list-toolbar"><label><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索人物…" /></label><button className="primary-compact" type="button" onClick={openCreate}><Icon name="plus" />新建人物</button></div>
    <div className="character-grid">{visible.map((person, index) => { const profile = normalizeCharacterProfile(person.profile); return <article className={`character-card ${person.archived ? "archived" : ""}`} key={person.id}><div className={`character-avatar ${["coral", "blue", "green"][index % 3]}`}><CharacterAvatar visual={person.visual} photos={person.photos} name={person.name} /></div><div><h3>{person.name}</h3><span>{[profile.age, person.aliases.join("、")].filter(Boolean).join(" · ")}</span><p>{profile.immutableTraits || person.description || "暂无描述"}</p></div><div className="card-actions"><button type="button" onClick={() => openEdit(person)}>编辑</button><Menu position="bottom-end" shadow="md" width={160} withinPortal><Menu.Target><button type="button" aria-label={`${person.name}的更多操作`}>更多</button></Menu.Target><Menu.Dropdown><Menu.Item onClick={() => studio.updateCharacter(person.id, { archived: !person.archived })}>{person.archived ? "恢复" : "归档"}</Menu.Item><Menu.Item color="red" onClick={() => { if (window.confirm(`删除人物「${person.name}」及其关系？`)) studio.deleteCharacter(person.id); }}>删除</Menu.Item></Menu.Dropdown></Menu></div></article>; })}</div>
    {!visible.length && <div className="empty-inline">没有符合条件的人物。</div>}
    <ResponsiveModal
      opened={formOpen}
      onClose={() => setFormOpen(false)}
      closeButtonProps={{ "aria-label": "关闭人物编辑" }}
      title={editingId ? "编辑人物" : "新建人物"}
      size={photoTab ? 1120 : 720}
      fullScreen={compact}
      centered={!compact}
      scrollMode="content"
      classNames={{ content: "character-edit-dialog", body: "character-edit-dialog-body" }}
    >
      <div className="character-edit-tabs" role="tablist" aria-label="人物编辑页面"><button type="button" role="tab" aria-selected={!photoTab} onClick={() => setPhotoTab(false)}>资料</button><button type="button" role="tab" aria-selected={photoTab} disabled={!form.name.trim()} onClick={showPhotos}>照片</button></div>
      {photoTab && editingId ? <CharacterPhotoWorkspace key={editingId} characterId={editingId} /> : <div className="character-edit-scroll" data-ui-overlay-scroll><label>人名<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>别名<textarea value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} placeholder="使用逗号、分号或换行分隔" /></label><div className="character-profile-form">{CHARACTER_PROFILE_KEYS.map((key) => <label key={key} className={CHARACTER_LABELS[key].rows ? "full" : ""}>{CHARACTER_LABELS[key].label}{CHARACTER_LABELS[key].rows ? <textarea value={form.profile[key]} onChange={(event) => setForm({ ...form, profile: { ...form.profile, [key]: event.target.value } })} placeholder={CHARACTER_LABELS[key].placeholder} /> : <input value={form.profile[key]} onChange={(event) => setForm({ ...form, profile: { ...form.profile, [key]: event.target.value } })} placeholder={CHARACTER_LABELS[key].placeholder} />}</label>)}</div><label>人物说明<small>身份、性格、说话方式、能力、当前心理状态和当前已知信息都可以写在这里。</small><textarea className="character-description-input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>}
      {!photoTab && <footer className="character-edit-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>取消</button><button className="primary-compact" type="button" disabled={!form.name.trim()} onClick={save}>保存</button></footer>}
    </ResponsiveModal>
  </>;
}

function Relationships() {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const people = studio.currentArticle.characters.filter((person) => !person.archived);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ characterAId: "", characterBId: "", description: "" });
  const [error, setError] = useState("");
  const personOptions = people.map((person) => ({ value: person.id, label: person.name }));
  function openCreate() {
    if (people.length < 2) return;
    setEditingId(null);
    setForm({ characterAId: people[0].id, characterBId: people[1].id, description: "" });
    setError("");
    setFormOpen(true);
  }
  function openEdit(item: Article["relationships"][number]) {
    setEditingId(item.id);
    setForm({ characterAId: item.characterAId, characterBId: item.characterBId, description: item.description });
    setError("");
    setFormOpen(true);
  }
  function save() {
    if (!form.characterAId || !form.characterBId || form.characterAId === form.characterBId) { setError("请选择两个不同人物。"); return; }
    const description = form.description.trim();
    if (!description) { setError("请填写关系描述。"); return; }
    const duplicate = studio.currentArticle.relationships.some((item) => item.id !== editingId && [item.characterAId, item.characterBId].includes(form.characterAId) && [item.characterAId, item.characterBId].includes(form.characterBId));
    if (duplicate) { setError("这两个人物之间已经存在关系。"); return; }
    if (editingId) studio.updateRelationship(editingId, { ...form, description });
    else studio.addRelationship({ ...form, description });
    setFormOpen(false);
  }
  return <><div className="relationship-toolbar"><span className="ui-title">{studio.currentArticle.relationships.length} 条人物关系</span><button className="primary-compact" type="button" disabled={people.length < 2} onClick={openCreate}><Icon name="plus" />新建关系</button></div>{people.length < 2 && <div className="empty-inline">至少需要两个人物才能建立关系。</div>}<div className="relationship-list">{studio.currentArticle.relationships.map((item) => { const a = studio.currentArticle.characters.find((person) => person.id === item.characterAId); const b = studio.currentArticle.characters.find((person) => person.id === item.characterBId); if (!a || !b) return null; return <article className="relationship-card" key={item.id}><div className="mini-avatar blue">{a.name[0]}</div><span className="ui-title">{a.name}</span><span className="relationship-line"><Icon name="link" /><em>{item.description}</em></span><span className="ui-title">{b.name}</span><div className="mini-avatar blue">{b.name[0]}</div><div className="card-actions"><button type="button" onClick={() => openEdit(item)}>编辑</button><Menu position="bottom-end" shadow="md" width={140} withinPortal><Menu.Target><button type="button" aria-label={`${a.name}与${b.name}关系的更多操作`}>更多</button></Menu.Target><Menu.Dropdown><Menu.Item color="red" onClick={() => { if (window.confirm("删除这条人物关系？")) studio.deleteRelationship(item.id); }}>删除</Menu.Item></Menu.Dropdown></Menu></div></article>; })}</div>
    <ResponsiveModal opened={formOpen} onClose={() => setFormOpen(false)} closeButtonProps={{ "aria-label": "关闭人物关系编辑" }} title={editingId ? "编辑人物关系" : "新建人物关系"} size="md" fullScreen={compact} centered={!compact}>
      <Stack gap="md"><SimpleGrid cols={{ base: 1, sm: 2 }}><Select label="人物 A" data={personOptions} value={form.characterAId} allowDeselect={false} onChange={(value) => setForm({ ...form, characterAId: value ?? "" })} /><Select label="人物 B" data={personOptions} value={form.characterBId} allowDeselect={false} onChange={(value) => setForm({ ...form, characterBId: value ?? "" })} /></SimpleGrid><Textarea label="关系描述" value={form.description} maxLength={1000} minRows={3} maxRows={8} autosize onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} />{error && <Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" onClick={() => setFormOpen(false)}>取消</Button><Button disabled={!form.description.trim() || !form.characterAId || !form.characterBId} onClick={save}>保存关系</Button></Group></Stack>
    </ResponsiveModal>
  </>;
}

function SettingsPage({ view, onGo }: { view: View; onGo: (view: View) => void }) {
  const items: [View, string][] = [
    ["settings-general", "常规"],
    ["settings-appearance", "外观与编辑器"],
    ["settings-models", "AI 服务"],
    ["settings-prompts", "AI提示"],
    ["settings-tasks", "AI 任务"],
    ["settings-database", "数据管理"],
    ["settings-system", "系统与诊断"],
  ];
  const activeItem = items.find(([key]) => key === view) ?? items[0];
  return <div className="settings-layout"><nav className="settings-nav" aria-label="设置分类"><button className="settings-back-writing" type="button" onClick={() => onGo("write")}>← 返回写作</button><div><span>Writer Studio</span><span className="ui-title">设置</span></div>{items.map(([key, label]) => <button className={view === key ? "active" : ""} key={key} type="button" onClick={() => onGo(key)}><span className="ui-title">{label}</span></button>)}</nav><div className={`settings-content ${view === "settings-models" ? "ai-settings-content" : ""}`}><PageHeader title={activeItem[1]} />{view === "settings-general" && <GeneralSettings />}{view === "settings-appearance" && <AppearanceSettings />}{view === "settings-models" && <ModelSettings />}{view === "settings-prompts" && <AiPromptSettings />}{view === "settings-tasks" && <TaskSettings />}{view === "settings-database" && <DatabaseSettings />}{view === "settings-system" && <SystemSettings />}</div></div>;
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="setting-section"><div className="setting-title"><h2>{title}</h2></div><div className="setting-body">{children}</div></section>;
}

function SettingRow({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><span className="ui-label">{title}</span></div>{children}</div>;
}

function Toggle({ checked = true, disabled = false, onChange }: { checked?: boolean; disabled?: boolean; onChange?: (checked: boolean) => void }) { return <button type="button" disabled={disabled} className={`toggle ${checked ? "on" : ""}`} aria-label={checked ? "已开启" : "已关闭"} aria-pressed={checked} onClick={() => onChange?.(!checked)}><span /></button>; }

function GeneralSettings() {
  const studio = useStudio();
  return <SettingSection title="语言与启动"><SettingRow title="界面语言"><select><option>简体中文</option></select></SettingRow><SettingRow title="启动时打开上次文章"><Toggle checked={studio.data.settings.openLastArticle} onChange={(checked) => studio.updateSettings({ openLastArticle: checked })} /></SettingRow><SettingRow title="默认显示已归档内容"><Toggle checked={studio.data.settings.showArchived} onChange={(checked) => studio.updateSettings({ showArchived: checked })} /></SettingRow></SettingSection>;
}

function AppearanceSettings() {
  const studio = useStudio();
  return <><AppearancePanel /><SettingSection title="侧栏"><SettingRow title="大纲内容默认展开"><Toggle checked={studio.data.settings.outlineExpanded} onChange={(checked) => studio.updateSettings({ outlineExpanded: checked })} /></SettingRow></SettingSection></>;
}

function ModelSettings() { return <AiServices />; }

function TaskSettings() {
  const studio = useStudio();
  const models = useConfiguredModels();
  const strategy = normalizePreparationStrategy(studio.data.settings.preparationStrategy);
  const reviewStrategy = normalizeReviewStrategy(studio.data.settings.generateReviewStrategy);
  const reviewModelReference = studio.data.settings.reviewModelMode === "fixed" ? studio.data.settings.reviewModel : "__inherit__";
  return <>
    <SettingSection title="写作准备与讨论">
      <SettingRow title="讨论策略"><select aria-label="写作讨论策略" value={strategy} onChange={(event) => studio.updateSettings({ preparationStrategy: normalizePreparationStrategy(event.target.value) })}>{Object.entries(PREPARATION_STRATEGY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="readonly-value">{strategy === "minimal" ? "只讨论影响写作的必要条件，条件足够后结束。" : "探索人物、情节和表达的更多可能，没有有价值的新问题时结束。"}</span></SettingRow>
      <SettingRow title="写作前最多互动轮次"><select aria-label="写作前最多互动轮次" value={normalizePreparationRounds(studio.data.settings.preparationMaxRounds)} onChange={(event) => studio.updateSettings({ preparationMaxRounds: Number(event.target.value) })}>{Array.from({ length: MAX_PREPARATION_ROUNDS + 1 }, (_, value) => <option key={value} value={value}>{value} 轮</option>)}</select><span className="readonly-value">两种策略都可提前结束；0 轮仍整理准备稿。</span></SettingRow>
      <SettingRow title="准备稿无问题时仍需确认"><Checkbox aria-label="准备稿无问题时仍需确认" checked={studio.data.settings.preparationRequireConfirmation === true} onChange={(event) => studio.updateSettings({ preparationRequireConfirmation: event.currentTarget.checked })} /><span className="readonly-value">关闭后自动写正文；开启后等待作者确认。</span></SettingRow>
      <p className="form-foot">以上设置对新任务生效。主动选择“结束讨论，检查准备稿”时，仍会等待确认。</p>
    </SettingSection>
    <SettingSection title="生成后审校">
      <SettingRow title="最多修正次数"><NumberInput aria-label="审校最多修正次数" min={0} max={MAX_REVIEW_ROUNDS} allowDecimal={false} allowNegative={false} value={normalizeReviewRounds(studio.data.settings.generateReviewMaxRounds)} onChange={(value) => studio.updateSettings({ generateReviewMaxRounds: normalizeReviewRounds(value) })} /><span className="readonly-value">0 表示关闭；每次修正后仍会复检。</span></SettingRow>
      <SettingRow title="审校模型"><select aria-label="审校模型" value={reviewModelReference} onChange={(event) => studio.updateSettings(event.target.value === "__inherit__" ? { reviewModelMode: "inherit" } : { reviewModelMode: "fixed", reviewModel: event.target.value })}><option value="__inherit__">跟随本次 AI Generate 模型</option>{!reviewModelReference && <option value="" disabled>请选择审校模型</option>}{reviewModelReference && reviewModelReference !== "__inherit__" && !configuredModelForReference(models, reviewModelReference) && <option value={reviewModelReference}>原审校模型不可用</option>}{models.map((model) => <option key={model.id} value={model.id}>{modelDisplayLabel(models, model.id)}</option>)}</select></SettingRow>
      <SettingRow title="审校类型"><select aria-label="审校类型" value={reviewStrategy} onChange={(event) => studio.updateSettings({ generateReviewStrategy: normalizeReviewStrategy(event.target.value) })}>{Object.entries(REVIEW_STRATEGY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="readonly-value">{reviewStrategy === "minimal" ? "满足明确规则和必要条件后结束。" : "继续寻找人物、情节和表达中有依据的改进。"}</span></SettingRow>
      <SettingRow title="审校补充指令"><Textarea aria-label="审校补充指令" value={studio.data.settings.generateReviewInstruction ?? ""} maxLength={MAX_REVIEW_RULE_CHARACTERS} autosize minRows={2} maxRows={6} onChange={(event) => studio.updateSettings({ generateReviewInstruction: event.currentTarget.value })} placeholder="例如：重点检查人物对白，压缩重复描写" /></SettingRow>
      <p className="form-foot">新任务使用以上设置；两种类型都可提前结束。文章专用规则在“文章资料 → AI 任务设定”中管理。</p>
    </SettingSection>
    <SettingSection title="任务队列">
      <SettingRow title="并发任务数"><select value={studio.data.settings.taskConcurrency} onChange={(event) => studio.updateSettings({ taskConcurrency: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></SettingRow>
      <SettingRow title="自动重试"><span className="readonly-value">2 次</span></SettingRow>
      <SettingRow title="任务记录"><button className="secondary-button" type="button" onClick={() => studio.data.tasks.filter((task) => ["success", "failed", "cancelled"].includes(task.state)).forEach((task) => studio.removeTask(task.id))}>清除终态任务</button></SettingRow>
    </SettingSection>
  </>;
}

function DatabaseSettings() {
  const studio = useStudio();
  const transfer = useDataTransfer();
  type SyncStatus = { state?: "cloud" | "not_configured" | "unpaired" | "synced" | "pending" | "uploading" | "diverged" | "schema_mismatch" | "offline" | "error"; message?: string; autoUploadEnabled?: boolean; localDatabaseVersion?: number; remoteDatabaseVersion?: number; lastCloudVersion?: number | null; lastSyncAt?: string | null; cloudHost?: string | null };
  const [status, setStatus] = useState<{ connected?: boolean; engine?: string; revision?: number; databaseVersion?: number; articles?: number; searchMode?: string } | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncBusy, setSyncBusy] = useState<"pull" | "push" | "">("");
  const [syncToggleBusy, setSyncToggleBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [overwriteModels, setOverwriteModels] = useState(false);
  const [overwriteSecrets, setOverwriteSecrets] = useState(false);
  const [checking, setChecking] = useState(false);
  useEffect(() => { void fetchFromServer("/api/database/status", { cache: "no-store" }).then((response) => response.json()).then(setStatus).catch(() => setStatus({ connected: false })); }, [studio.saveStatus]);
  const loadSyncStatus = useCallback(async () => {
    try {
      const response = await fetchFromServer("/api/sync/status", { cache: "no-store" });
      setSyncStatus(await response.json() as SyncStatus);
    } catch (reason) {
      setSyncStatus({ state: "offline", message: reason instanceof Error ? reason.message : "同步状态读取失败" });
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => { void loadSyncStatus(); }, 0);
    const refresh = () => { void loadSyncStatus(); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("writer-studio-sync-status", refresh);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("writer-studio-sync-status", refresh); };
  }, [loadSyncStatus]);
  async function check() { setChecking(true); try { const response = await fetchServerAction("/api/database/integrity-check", { method: "POST" }); const result = await response.json() as { ok?: boolean; issues?: unknown[]; message?: string }; window.alert(result.ok ? "完整性检查通过：未发现孤立记录或外键错误。" : `检查发现问题：${result.message || JSON.stringify(result.issues)}`); } catch (reason) { window.alert(reason instanceof Error ? reason.message : "完整性检查失败"); } finally { setChecking(false); } }
  async function setAutoUpload(enabled: boolean) {
    setSyncToggleBusy(true); setSyncNotice("");
    try {
      const response = await fetchServerAction("/api/sync/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoUploadEnabled: enabled }) });
      const payload = await response.json() as SyncStatus & { message?: string };
      if (!response.ok) throw new Error(payload.message || "自动上传设置保存失败");
      setSyncStatus(payload);
      if (enabled) void fetchFromServer("/api/sync/upload", { method: "POST" }).catch(() => undefined).finally(() => void loadSyncStatus());
    } catch (reason) {
      setSyncNotice(reason instanceof Error ? reason.message : "自动上传设置保存失败");
    } finally {
      setSyncToggleBusy(false);
    }
  }
  async function replaceDatabase(direction: "pull" | "push") {
    if (browserIsOffline()) { setSyncNotice(OFFLINE_OPERATION_MESSAGE); return; }
    const phrase = direction === "pull" ? "从云端取回" : "复制到云端";
    const target = direction === "pull" ? "本地" : "云端";
    const scope = ["创作数据库", overwriteModels ? "大模型配置" : "", overwriteSecrets ? "API Key/Secret" : ""].filter(Boolean).join("、");
    const sensitiveNotice = overwriteModels ? "覆盖前备份将包含目标端现有 API Key，请妥善保管 data/recovery。" : "";
    const typed = window.prompt(`此操作会用${direction === "pull" ? "云端" : "本地"}的${scope}覆盖${target}。${sensitiveNotice}输入“${phrase}”确认：`, "");
    if (typed !== phrase) return;
    setSyncBusy(direction); setSyncNotice("");
    try {
      if (!await studio.saveNow()) throw new Error("本地内容尚未保存，已取消覆盖");
      const response = await fetchServerAction(`/api/sync/${direction}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ includeModels: overwriteModels, includeSecrets: overwriteSecrets }) });
      const payload = await response.json() as { message?: string; backupPath?: string; code?: string };
      if (!response.ok) throw new Error(payload.message || `覆盖失败（${response.status}）`);
      if (direction === "pull") {
        window.location.reload();
        return;
      }
      setSyncNotice(`${payload.message ?? "云端覆盖完成"}；覆盖前快照已保存。`);
      await loadSyncStatus();
    } catch (reason) {
      setSyncNotice(reason instanceof Error ? reason.message : "数据库覆盖失败");
    } finally {
      setSyncBusy("");
    }
  }
  const syncBlocked = syncStatus?.state === "cloud" || syncStatus?.state === "not_configured" || syncStatus?.state === "schema_mismatch";
  const syncHealthy = syncStatus?.state === "synced";
  return <>
    <SettingSection title="完整备份">
      <div className="transfer-hero"><div><span className="ui-title">导出全部 Writer Studio 数据</span><p>包含所有文章、正文、版本、聊天、任务、系统设置、Provider 和模型参数，不包含 API Key。</p></div><Button leftSection={<Icon name="saveAs" />} onClick={() => void transfer.exportComplete()}>导出全部</Button></div>
    </SettingSection>
    <SettingSection title="批量迁移">
      <div className="transfer-grid">
        <article className="transfer-card"><div><span className="ui-title">所有文章</span><p>{studio.data.articles.length} 篇文章，以及对应的章节、大纲、正文、版本、人物、聊天和任务记录。</p></div><Group gap="xs"><Button variant="default" size="xs" onClick={transfer.exportAllArticles}>导出</Button><Button variant="light" size="xs" onClick={() => void transfer.importAllArticles()}>导入</Button></Group></article>
        <article className="transfer-card"><div><span className="ui-title">系统配置</span><p>界面、编辑器、任务和生成设置，以及 Provider 与模型参数；API Key 需要在新环境重新输入。</p></div><Group gap="xs"><Button variant="default" size="xs" onClick={() => void transfer.exportSystemConfig()}>导出</Button><Button variant="light" size="xs" onClick={() => void transfer.importSystemConfig()}>导入</Button></Group></article>
      </div>
    </SettingSection>
    <SettingSection title="当前数据"><div className="database-card"><span className="db-icon">DB</span><div><span className="ui-title">{status?.engine ?? "SQLite"}</span><p>数据库版本 {status?.databaseVersion ?? "—"} · 保存修订 {status?.revision ?? "—"} · 搜索 {status?.searchMode ?? "检测中"}</p></div><span className={status?.connected === false ? "status-warning" : "status-online"}>{status?.connected === false ? "连接失败" : "已连接"}</span><button className="secondary-button" type="button" onClick={() => window.alert(status?.engine?.toLocaleLowerCase().includes("d1") ? "当前 Site 使用云端 D1 数据库。" : "当前使用本机 SQLite 数据库，默认文件位于 data/writer-studio.sqlite。")}>数据位置</button></div></SettingSection>
    <SettingSection title="云端同步">
      <div className="sync-card">
        <div className="sync-card-heading"><div><span className="ui-title">本地与云端数据库</span><p>{syncStatus?.autoUploadEnabled === false && syncStatus.state !== "cloud" ? "自动后台上传已关闭 · " : ""}{syncStatus?.message ?? "正在读取同步状态…"}{syncStatus?.cloudHost ? ` · ${syncStatus.cloudHost}` : ""}</p></div><span className={syncHealthy ? "status-online" : "status-warning"}>{syncStatus?.autoUploadEnabled === false && syncStatus.state !== "cloud" ? "自动上传关闭" : syncHealthy ? "已同步" : syncStatus?.state === "pending" || syncStatus?.state === "uploading" ? "同步中" : "需检查"}</span></div>
        <div className="sync-auto-row"><div><span className="ui-label">本地保存后自动异步复制到云端</span><p>关闭后只保存本地数据库，仍可随时手动选择覆盖方向。</p></div><Toggle checked={syncStatus?.autoUploadEnabled ?? true} disabled={syncToggleBusy || syncStatus?.state === "cloud"} onChange={(enabled) => void setAutoUpload(enabled)} /><span className="sync-toggle-busy">{syncToggleBusy ? "保存中…" : ""}</span></div>
        <div className="sync-version-grid"><span>本地版本 <strong>{syncStatus?.localDatabaseVersion ?? status?.databaseVersion ?? "—"}</strong></span><span>云端版本 <strong>{syncStatus?.remoteDatabaseVersion ?? "—"}</strong></span><span>同步基线 <strong>{syncStatus?.lastCloudVersion ?? "—"}</strong></span></div>
        <p className="sync-rule">只有“云端版本 = 同步基线”时才允许后台上传；版本不同会立即停止，必须手动选择覆盖方向。结构版本不同不能覆盖，需要先升级应用。</p>
        <div className="sync-overwrite-options"><span className="ui-label">手动覆盖范围</span><Checkbox checked={overwriteModels} onChange={(event) => { const checked = event.currentTarget.checked; setOverwriteModels(checked); if (!checked) setOverwriteSecrets(false); }} label="同时覆盖大模型配置" /><Checkbox checked={overwriteSecrets} disabled={!overwriteModels} onChange={(event) => setOverwriteSecrets(event.currentTarget.checked)} label="同时覆盖 API Key / Secret（敏感信息）" /><p>未选择 API Key 时，会保留目标端相同模型 ID 的密钥；目标端多余模型会随模型配置覆盖而删除。</p></div>
        {syncNotice && <div className={syncNotice.includes("完成") || syncNotice.includes("已用") ? "sync-notice success" : "sync-notice error"} role="status">{syncNotice}</div>}
        <Group gap="sm" className="sync-actions">
          <Button color="red" variant="light" disabled={Boolean(syncBlocked) || Boolean(syncBusy)} loading={syncBusy === "pull"} onClick={() => void replaceDatabase("pull")}>从云端取回</Button>
          <Button color="red" variant="light" disabled={Boolean(syncBlocked) || Boolean(syncBusy)} loading={syncBusy === "push"} onClick={() => void replaceDatabase("push")}>复制到云端</Button>
          <Button variant="default" disabled={Boolean(syncBusy)} onClick={() => void loadSyncStatus()}>刷新状态</Button>
        </Group>
        <p className="sync-footnote">覆盖前快照保存在本机 data/recovery。选择模型覆盖时，备份会包含目标端现有 API Key；同步密钥始终不会被复制。</p>
      </div>
    </SettingSection>
    <SettingSection title="维护"><SettingRow title="数据完整性检查"><button className="secondary-button" type="button" disabled={checking} onClick={() => void check()}>{checking ? "正在检查…" : "开始检查"}</button></SettingRow></SettingSection>
    <SettingSection title="危险操作"><SettingRow title="清除全部业务数据"><button className="danger-button" type="button" onClick={() => { const confirmText = window.prompt("输入 CLEAR 确认清除全部文章、正文、版本、人物、聊天和 AI 任务"); if (confirmText === "CLEAR") void studio.clearBusinessData(); }}>清除全部业务数据</button></SettingRow></SettingSection>
  </>;
}

type ManagedServiceStatus = {
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

type ManagedServiceStatusResponse = ManagedServiceStatus & {
  ok: true;
  message?: string;
};

async function fetchManagedServiceStatus() {
  const response = await fetchFromServer("/api/system/service", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as Partial<ManagedServiceStatusResponse> & { message?: string };
  if (!response.ok || payload.ok !== true || !payload.service) {
    throw new Error(payload.message || "无法读取服务管理状态");
  }
  return payload as ManagedServiceStatusResponse;
}

function SystemSettings() {
  const studio = useStudio();
  const [serviceStatus, setServiceStatus] = useState<ManagedServiceStatus | null>(null);
  const [serviceError, setServiceError] = useState("");
  const [statusLoading, setStatusLoading] = useState(true);
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [restartPhase, setRestartPhase] = useState<"idle" | "requesting" | "waiting" | "success" | "error">("idle");
  const [restartNotice, setRestartNotice] = useState("");
  const restartActive = restartPhase === "requesting" || restartPhase === "waiting";

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await fetchManagedServiceStatus();
        if (cancelled) return;
        setServiceStatus(status);
        setServiceError("");
      } catch (error) {
        if (cancelled) return;
        setServiceStatus(null);
        setServiceError(error instanceof Error ? error.message : "无法读取服务管理状态");
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const canRestart = Boolean(
    serviceStatus?.service.managed
    && serviceStatus.service.state === "running"
    && serviceStatus.operation === "idle"
    && !restartActive,
  );
  const serviceLabel = statusLoading
    ? "正在检测…"
    : serviceStatus?.service.state === "running"
      ? serviceStatus.service.managed ? "运行正常" : "运行正常 · 非托管"
      : serviceStatus?.service.state === "starting"
        ? "正在启动"
        : serviceStatus?.service.state === "external"
          ? "运行正常 · 非托管"
          : serviceStatus ? "服务异常" : "运行正常 · 管理器未连接";
  const serviceHealthy = serviceStatus?.service.state === "running" && serviceStatus.service.managed;
  const restartUnavailableReason = serviceError
    || (!serviceStatus?.service.managed ? "请使用服务管理器启动 Writer Studio 后再重启" : "服务端当前不可重启");

  async function restartService() {
    setRestartDialogOpen(false);
    setRestartPhase("requesting");
    setRestartNotice("正在提交重启请求…");
    try {
      const response = await fetchServerAction("/api/system/service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; previousStartedAt?: string | null };
      if (!response.ok || payload.ok !== true) throw new Error(payload.message || "服务端未接受重启请求");

      const previousStartedAt = payload.previousStartedAt ?? serviceStatus?.service.startedAt ?? null;
      const deadline = Date.now() + 5 * 60_000;
      setRestartPhase("waiting");
      setRestartNotice("服务端正在重新构建并重启，恢复后会自动更新状态…");
      while (Date.now() < deadline) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 900));
        let latest: ManagedServiceStatus;
        try {
          latest = await fetchManagedServiceStatus();
        } catch {
          // A short connection failure is expected while the managed process restarts.
          continue;
        }
        setServiceStatus(latest);
        setServiceError("");
        if (latest.operation === "idle" && latest.service.lastError) throw new Error(latest.service.lastError);
        const startedAgain = latest.service.startedAt && latest.service.startedAt !== previousStartedAt;
        if (latest.service.state === "running" && latest.service.managed && startedAgain) {
          setRestartPhase("success");
          setRestartNotice("服务端已完成重启，可以继续使用。");
          return;
        }
      }
      throw new Error("等待服务端恢复超时，请检查 3003 服务管理器状态");
    } catch (error) {
      setRestartPhase("error");
      setRestartNotice(error instanceof Error ? error.message : "服务端重启失败");
    }
  }

  return <>
    <SettingSection title="运行状态">
      <SettingRow title="应用版本"><span className="readonly-value">Writer Studio 2.1.0</span></SettingRow>
      <SettingRow title="本地服务"><span className={serviceHealthy ? "status-online" : "status-warning"}>{serviceLabel}</span></SettingRow>
      <SettingRow title="最近错误"><span className="readonly-value">{serviceStatus?.service.lastError || serviceError || "暂无错误"}</span></SettingRow>
    </SettingSection>
    <SettingSection title="服务控制">
      <SettingRow title="重启服务端">
        <div className="service-control-action">
          <button className="secondary-button" type="button" disabled={!canRestart} title={canRestart ? undefined : restartUnavailableReason} onClick={() => setRestartDialogOpen(true)}>{restartActive ? "正在重启…" : "重启服务端"}</button>
          {!canRestart && !restartActive && <small>{restartUnavailableReason}</small>}
          {restartNotice && <span className={`service-restart-notice ${restartPhase}`} role="status">{restartNotice}</span>}
        </div>
      </SettingRow>
    </SettingSection>
    <SettingSection title="诊断">
      <SettingRow title="脱敏诊断信息"><button className="secondary-button" type="button" onClick={() => void copyTextToClipboard(JSON.stringify({ version: "2.1.0-poc", articles: studio.data.articles.length, tasks: studio.data.tasks.map((task) => task.state), service: serviceStatus ? { managed: serviceStatus.service.managed, state: serviceStatus.service.state, startedAt: serviceStatus.service.startedAt } : { managed: false, state: "manager-unavailable" }, browser: navigator.userAgent }, null, 2))}>复制诊断信息</button></SettingRow>
      <SettingRow title="非业务缓存"><button className="secondary-button" type="button" onClick={() => window.alert("非业务缓存已清除，创作数据未受影响。")}>清除缓存</button></SettingRow>
    </SettingSection>
    <ResponsiveModal opened={restartDialogOpen} onClose={() => setRestartDialogOpen(false)} closeButtonProps={{ "aria-label": "取消重启服务端" }} title="重启服务端？" size="sm">
      <Stack gap="md">
        <Text size="sm">Writer Studio 会短暂断开连接并自动等待恢复。已保存的数据不会受影响。</Text>
        <Alert color="yellow">正在执行的 AI 生成、检查或同步请求可能会被中断。</Alert>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => setRestartDialogOpen(false)}>取消</Button>
          <Button color="red" onClick={() => void restartService()}>确认重启</Button>
        </Group>
      </Stack>
    </ResponsiveModal>
  </>;
}

function VersionSettingSnapshotView({ snapshot }: { snapshot: ResolvedChapterSettings }) {
  const storyLabels: Array<[keyof ResolvedChapterSettings["story"], string]> = [
    ["summary", "简介"], ["location", "地点"], ["style", "风格"], ["negativeConstraints", "负面约束"],
  ];
  const visibleCharacters = snapshot.characters.filter((person) => !person.archived && person.appears !== false);
  const names = new Map(snapshot.characters.map((person) => [person.id, person.name]));
  return <details className="version-setting-snapshot">
    <summary>生成时采用的设定</summary>
    <div className="version-setting-snapshot-body">
      <section><h4>故事</h4>{storyLabels.filter(([key]) => snapshot.story[key]?.trim()).map(([key, label]) => <p key={key}><strong>{label}</strong><span>{snapshot.story[key]}</span></p>)}</section>
      {visibleCharacters.length > 0 && <section><h4>人物</h4>{visibleCharacters.map((person) => <details key={person.id}><summary>{person.name}</summary>{CHARACTER_PROFILE_KEYS.filter((key) => person.profile[key]?.trim()).map((key) => <p key={key}><strong>{CHARACTER_LABELS[key].label}</strong><span>{person.profile[key]}</span></p>)}</details>)}</section>}
      {snapshot.relationships.filter((item) => item.active).length > 0 && <section><h4>关系</h4>{snapshot.relationships.filter((item) => item.active).map((item) => <p key={item.id}><strong>{names.get(item.characterAId) ?? "未知"} ↔ {names.get(item.characterBId) ?? "未知"}</strong><span>{item.description}</span></p>)}</section>}
    </div>
  </details>;
}

function VersionDrawer({ selectedVersionId, onClose, onPreview, onClearPreview, onOpenRewriteSource, onNotice }: { selectedVersionId?: string; onClose: () => void; onPreview: (versionId: string) => void; onClearPreview: () => void; onOpenRewriteSource: (sourceId: string) => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const versions = studio.currentOutline.versions;
  const compareVersion = versions.find((version) => version.id === compareVersionId);
  const currentContent = resolvedOutlineContent(studio.currentOutline);
  const currentContentName = resolvedOutlineContentName(studio.currentOutline);
  const currentExcellentFragments = resolvedExcellentFragments(studio.currentOutline);
  const currentVersion = currentOutlineVersion(studio.currentOutline);
  const directPreviewSelected = selectedVersionId === directContentId(studio.currentOutline.id);
  const standaloneContent = directPreviewSelected ? studio.currentOutline.content : currentContent;
  const standaloneContentName = directPreviewSelected ? (studio.currentOutline.contentName?.trim() || timestampContentName(studio.currentOutline.updatedAt)) : currentContentName;
  const standaloneExcellentFragments = directPreviewSelected ? normalizeExcellentFragments(studio.currentOutline.content, studio.currentOutline.excellentFragments) : currentExcellentFragments;
  const showStandaloneCurrent = !currentVersion || directPreviewSelected;
  async function createBlankContent() {
    const saved = await studio.createBlankContent(studio.currentOutline.id);
    if (!saved) {
      onNotice("新建正文未完成，请查看保存状态");
      return;
    }
    onClearPreview();
    onClose();
    onNotice("已新建空白正文");
  }
  async function saveVersionAs(version: Version) {
    const defaultName = `${version.name}-复制`;
    const name = window.prompt("另存为正文版本", defaultName);
    if (name === null) return;
    const versionName = name.trim() || defaultName;
    studio.saveVersion(studio.currentOutline.id, versionName, "手动", version.content, {
      outlineSnapshot: version.outlineSnapshot,
      settingSnapshot: version.settingSnapshot,
      manualExcellent: version.manualExcellent === true,
      excellentFragments: normalizeExcellentFragments(version.content, version.excellentFragments),
    });
    const saved = await studio.saveNow();
    onNotice(saved ? `已另存为「${versionName}」` : "另存为未完成，请查看保存状态");
  }
  return <ScrollableDrawer
    scrollMode="content"
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭正文版本" }}
    title={<div className="ws-drawer-title"><span>正文版本</span><span className="ui-title">{outlineDisplayTitle(studio.currentOutline)}</span></div>}
    position={compact ? "bottom" : "right"}
    size={compact ? "calc(100dvh - 10px)" : 920}
    classNames={{ content: "ws-drawer-content version-drawer-shell", header: "ws-drawer-header", body: "ws-drawer-body" }}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
  >
    <div className="version-drawer" aria-label="正文版本">
      {compareVersion ? <div className="diff-view" data-ui-overlay-scroll>
        <Button variant="subtle" size="xs" onClick={() => setCompareVersionId(null)}>← 返回版本</Button>
        <h3>与「{currentContentName}」对比</h3>
        <p><del>{currentContent.slice(0, 500) || "（当前正文为空）"}</del></p>
        <p><ins>{compareVersion.content.slice(0, 500) || "（版本正文为空）"}</ins></p>
        <div className="diff-legend"><span><i className="removed" />{currentContentName}</span><span><i className="added" />{compareVersion.name}</span></div>
      </div> : <div className="version-list" data-ui-overlay-scroll>
        <div className="version-drawer-tools">
          <Button leftSection={<Icon name="plus" />} onClick={() => void createBlankContent()}>新建</Button>
          {studio.currentOutline.defaultVersionId && <Button variant="default" onClick={() => { studio.setDefaultVersion(studio.currentOutline.id); onNotice("已取消默认正文"); }}>取消默认正文</Button>}
        </div>
        {showStandaloneCurrent && <article className={`${directPreviewSelected || !selectedVersionId ? "active" : ""} ${!currentVersion ? "current" : ""}`}>
          <button className="version-preview-main" type="button" onClick={onClearPreview}><div><span className="ui-title" title={standaloneContentName}>{standaloneContentName}</span>{(studio.currentOutline.manualExcellent || standaloneExcellentFragments.length > 0) && <i className="excellent-fragment-dot" title={studio.currentOutline.manualExcellent ? "优秀正文" : "含优秀片段，已自动设为优秀"} />}{!currentVersion && <em>当前 · 已直接保存</em>}</div><p>{formatTime(studio.currentOutline.updatedAt)} · {wordCount(standaloneContent)} 字</p><span>正文</span></button>
          {(directPreviewSelected || !selectedVersionId) && <div className="version-content-preview" aria-label="直接保存正文内容">{standaloneContent ? <ExcellentText text={standaloneContent} fragments={standaloneExcellentFragments} /> : "（正文为空）"}</div>}
        </article>}
        {versions.map((version) => {
          const isDefault = studio.currentOutline.defaultVersionId === version.id;
          const isCurrent = currentVersion?.id === version.id;
          const isActive = selectedVersionId ? selectedVersionId === version.id : isCurrent;
          const excellentFragments = normalizeExcellentFragments(version.content, version.excellentFragments);
          const isExcellent = version.manualExcellent === true || excellentFragments.length > 0;
          return <article className={`${isDefault ? "default" : ""} ${isCurrent ? "current" : ""} ${isActive ? "active" : ""}`} key={version.id}>
            <button className="version-preview-main" type="button" onClick={() => isCurrent ? onClearPreview() : onPreview(version.id)}><div><span className="ui-title">{version.name}</span>{isExcellent && <i className="excellent-fragment-dot" title={version.manualExcellent ? "优秀正文" : "含优秀片段，已自动设为优秀"} />}{isCurrent && <em>当前</em>}{isDefault && <em>默认</em>}</div><p>{formatTime(version.createdAt)} · {wordCount(version.content)} 字</p><span>{version.source}</span></button>
            {version.rewriteSourceId && <button className="version-rewrite-source" type="button" onClick={() => onOpenRewriteSource(version.rewriteSourceId!)}>改写自：{version.rewriteSourceName || "原正文"}</button>}
            {isActive && <div className="version-content-preview" aria-label={`${version.name}正文内容`}>{version.content ? <ExcellentText text={version.content} fragments={excellentFragments} /> : "（正文为空）"}</div>}
            {isActive && version.settingSnapshot && <VersionSettingSnapshotView snapshot={version.settingSnapshot} />}
            <div className="version-actions">
              <button type="button" onClick={() => setCompareVersionId(version.id)}>对比</button>
              <button type="button" disabled={isCurrent} onClick={() => { studio.setCurrentVersion(studio.currentOutline.id, version.id); onClearPreview(); onNotice("已设为当前正文"); }}>{isCurrent ? "已当前" : "设为当前"}</button>
              <button type="button" disabled={isDefault} onClick={() => { studio.setDefaultVersion(studio.currentOutline.id, version.id); onNotice("已设为默认正文"); }}>{isDefault ? "已默认" : "设为默认"}</button>
              <button type="button" onClick={() => void saveVersionAs(version)}>另存</button>
              <button type="button" onClick={() => { const name = window.prompt("重命名版本", version.name); if (name?.trim()) studio.renameVersion(studio.currentOutline.id, version.id, name.trim()); }}>重命名</button>
              <button className="danger-text" type="button" disabled={isCurrent || isDefault} title={isCurrent ? "请先切换当前正文" : isDefault ? "请先取消默认正文" : undefined} onClick={() => { if (window.confirm("删除这个版本？")) studio.deleteVersion(studio.currentOutline.id, version.id); }}>删除</button>
            </div>
          </article>;
        })}
        {!versions.length && <div className="empty-inline">尚未保存正文版本</div>}
      </div>}
    </div>
  </ScrollableDrawer>;
}

function TaskPanel({ onClose, onOpen, onOpenIllustration, initialTaskId = "" }: { initialTaskId?: string; onClose: () => void; onOpenIllustration: (task: AiTask) => void; onOpen: (id: string, next?: "write" | "chat", previewVersionId?: string) => void }) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const [selectedTaskId, setSelectedTaskId] = useState(() => initialTaskId || studio.data.tasks.find((task) => task.outlineId === studio.currentOutline.id && isTaskAwaitingAuthor(task))?.id || "");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 3000); return () => window.clearInterval(timer); }, []);
  const tasks = [...studio.data.tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const activeCount = tasks.filter((task) => task.state === "running" || task.state === "waiting").length;
  const completedCount = tasks.filter((task) => task.state === "success").length;
  const generateRunningCount = tasks.filter((task) => task.target !== "AI Chat" && task.state === "running").length;
  const chatRunningCount = tasks.filter((task) => task.target === "AI Chat" && task.state === "running").length;
  const selectedArticle = selectedTask ? studio.data.articles.find((item) => item.id === selectedTask.articleId) : undefined;
  const selectedChapter = selectedTask ? selectedArticle?.chapters.find((item) => item.id === selectedTask.chapterId) : undefined;
  const selectedOutline = selectedTask ? selectedChapter?.outlines.find((item) => item.id === selectedTask.outlineId) : undefined;
  const selectedVersion = selectedTask?.resultVersionId ? selectedOutline?.versions.find((item) => item.id === selectedTask.resultVersionId) : undefined;
  const selectedResult = selectedTask?.resultText ?? selectedVersion?.content ?? "";
  const selectedFirstAppearanceNames = selectedArticle?.characters
    .filter((character) => selectedTask?.contextOptions?.firstAppearanceCharacterIds?.includes(character.id))
    .map((character) => character.name) ?? [];
  function locate(task: AiTask) {
    if (isIllustrationTarget(task.target)) { onOpenIllustration(task); return; }
    studio.setCurrentArticle(task.articleId);
    if (task.target === "全部名称") {
      window.history.pushState({}, "", `/articles/${task.articleId}/outlines/edit-all`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      onClose();
      return;
    }
    studio.setCurrentOutline(task.outlineId);
    onOpen(task.outlineId, task.target === "AI Chat" ? "chat" : "write", task.target === "正文" ? task.resultVersionId : undefined);
    onClose();
  }
  async function updateTaskState(task: AiTask, action: "cancel" | "retry" | "transfer") {
    const response = await fetchServerAction(`/api/ai/tasks/${encodeURIComponent(task.id)}/state`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const payload = await response.json() as { task?: Partial<AiTask>; revision?: number; error?: string };
    if (!response.ok || !payload.task || payload.revision === undefined) throw new Error(payload.error || "任务状态更新失败");
    studio.acceptServerMutation(payload.revision, (current) => ({
      ...current,
      articles: action !== "cancel" || !taskChangesOutline(task.target) ? current.articles : current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((outline) => outline.id === task.outlineId ? { ...outline, state: "saved" } : outline) })) })),
      tasks: current.tasks.map((item) => item.id === task.id ? { ...item, ...payload.task } as AiTask : item),
    }));
  }
  function cancelTask(task: AiTask) {
    if (task.target === "AI Chat" && cancelActiveChatStream(task.id)) return;
    void updateTaskState(task, "cancel").catch((reason) => window.alert(reason instanceof Error ? reason.message : "取消任务失败"));
  }
  function retryTask(task: AiTask) {
    void updateTaskState(task, "retry").catch((reason) => window.alert(reason instanceof Error ? reason.message : "重试任务失败"));
  }
  function transferTask(task: AiTask) {
    void updateTaskState(task, "transfer").catch((reason) => window.alert(reason instanceof Error ? reason.message : "转移任务失败"));
  }
  function applyResult(task: AiTask) {
    if (task.target === "大纲" && task.resultText) {
      const outline = studio.data.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((item) => item.id === task.outlineId);
      const generatedTitle = normalizeOutlineTitle(task.contextOptions?.generatedOutlineTitle);
      const canApplyGeneratedTitle = Boolean(generatedTitle && outline && outline.plan === task.contextOptions?.outlinePlanSnapshot && outline.title === task.contextOptions?.outlineTitleSnapshot);
      studio.updateOutline(task.outlineId, { plan: task.resultText, ...(canApplyGeneratedTitle ? { title: generatedTitle, titleGenerationPending: false } : {}) });
    }
    else if (task.target === "章节标题" && task.resultText) studio.updateChapter(task.chapterId, { title: task.resultText });
  }
  const labels: Record<AiTask["state"], string> = { waiting: "等待中", running: "运行中", success: "已完成", failed: "失败", cancelled: "已取消" };
  const phaseLabels = taskPhaseLabels;
  const taskTime = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const duration = (milliseconds: number) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
  };
  const taskElapsed = (task: AiTask) => {
    if (!task.startedAt) return "—";
    const start = new Date(task.startedAt).getTime();
    const end = task.completedAt ? new Date(task.completedAt).getTime() : task.state === "waiting" || task.state === "running" ? clock : task.lastProgressAt ? new Date(task.lastProgressAt).getTime() : start;
    return duration(end - start);
  };
  const isStale = (task: AiTask) => task.state === "running" && (!task.leaseUntil || new Date(task.leaseUntil).getTime() <= clock);
  const isForeign = (task: AiTask) => task.executionOrigin !== studio.executionOrigin;
  const transferLabel = studio.executionOrigin === "cloud" ? "转移到云端执行" : "转移到本地执行";

  const taskDetails = selectedTask ? <>          <dl className="task-detail-metadata">
            <div><dt>生成目标</dt><dd>{selectedTask.target}{selectedTask.target === "正文" ? ` · ${generateTargetWordsLabel(selectedTask.contextOptions?.targetWords)}` : ""}</dd></div>
            {selectedTask.target === "正文" && <div className="wide"><dt>正文表达</dt><dd>{proseControlsSummary(selectedTask.contextOptions)}</dd></div>}
            {selectedTask.target === "正文" && <div><dt>生成方式</dt><dd>{contentGenerationModeLabel(selectedTask.contextOptions?.contentMode)}{selectedTask.contextOptions?.contentMode === "rewrite" ? ` · 原文保留 ${rewriteRetentionLabel(selectedTask.contextOptions.rewriteRetention)}` : ""}</dd></div>}
            {selectedTask.contextOptions?.contentMode === "rewrite" && <div><dt>改写原文</dt><dd>{selectedTask.contextOptions.rewriteSourceName || "原正文"}</dd></div>}
            <div><dt>模型</dt><dd>{modelDisplayLabel(models, selectedTask.model || "", selectedTask.contextOptions?.modelName)}</dd></div>
            {selectedTask.contextOptions?.resolvedReasoningEffort !== undefined && <div><dt>推理强度</dt><dd>{selectedTask.contextOptions.resolvedReasoningEffort ?? "不指定"}{selectedTask.contextOptions.reasoningEffort === undefined ? "（沿用模型）" : "（任务设置）"}</dd></div>}
            <div><dt>阶段</dt><dd>{phaseLabels[selectedTask.phase ?? "queued"]}</dd></div>
            <div><dt>尝试</dt><dd>{selectedTask.attempt ? `${selectedTask.attempt} / 3` : "—"}</dd></div>
            <div><dt>超时</dt><dd>{duration(selectedTask.timeoutMs ?? 600_000)}</dd></div>
            <div><dt>已接收</dt><dd>{(selectedTask.receivedCharacters ?? 0).toLocaleString("zh-CN")} 字符</dd></div>
            <div><dt>提交时间</dt><dd>{taskTime(selectedTask.createdAt)}</dd></div>
            <div><dt>最近更新</dt><dd>{selectedTask.lastProgressAt ? taskTime(selectedTask.lastProgressAt) : "—"}</dd></div>
            <div className="wide"><dt>位置</dt><dd>{selectedArticle?.title ?? "已删除的文章"}{selectedTask.target === "全部名称" ? " / 章节与大纲" : ` / ${selectedChapter?.title ?? "已删除的章节"} / ${selectedOutline ? outlineDisplayTitle(selectedOutline) : "已删除的大纲"}`}</dd></div>
          </dl>
          <section className="task-detail-section"><h3>任务指令</h3><div className="task-detail-copy">{selectedTask.prompt || (selectedTask.target === "全部名称" ? "使用文章命名设置，无补充要求" : "按大纲生成（无补充指令）")}</div></section>
          {selectedTask.contextOptions && <section className="task-detail-section"><h3>生成上下文</h3><div className="task-context-tags">{selectedTask.target === "全部名称" ? <><span>一次模型请求</span><span>{selectedTask.contextOptions.nameChapterCount ?? 0} 个章节名</span><span>{selectedTask.contextOptions.nameOutlineCount ?? 0} 个大纲名</span></> : <><span>{selectedTask.contextOptions.includePrevious ? "包含前面大纲" : "不包含前面大纲"}</span><span>{selectedTask.contextOptions.includeCharacters ? "包含相关人物" : "不包含相关人物"}</span></>}{selectedTask.target === "正文" && <span>{contentGenerationModeLabel(selectedTask.contextOptions.contentMode)}</span>}{selectedTask.target === "正文" && <><span>对话 {dialogueDensityLabel(resolvedProseControls(selectedTask.contextOptions).dialogueDensity)}</span><span>心理 {introspectionDensityLabel(resolvedProseControls(selectedTask.contextOptions).introspectionDensity)}</span><span>描写 {descriptionDetailLabel(resolvedProseControls(selectedTask.contextOptions).descriptionDetail)}</span><span>节奏 {narrativePaceLabel(resolvedProseControls(selectedTask.contextOptions).narrativePace)}</span><span>段落 {paragraphLengthLabel(resolvedProseControls(selectedTask.contextOptions).paragraphLength)}</span></>}{selectedTask.target === "正文" && selectedTask.contextOptions.contentMode === "rewrite" && <span>原文保留 {rewriteRetentionLabel(selectedTask.contextOptions.rewriteRetention)}</span>}{selectedTask.target === "正文" && <span>{selectedTask.contextOptions.includeExcellentFragments ? `参考优秀片段 ${selectedTask.contextOptions.excellentFragmentIds?.length ?? 0} 个` : "不参考优秀片段"}</span>}{selectedTask.target === "正文" && <span>{selectedTask.contextOptions.contentMode === "fresh" ? "不发送当前正文" : "包含当前正文"}</span>}{selectedTask.target === "正文" && <span>{selectedTask.contextOptions.includeOutlineTitle ? "同时生成大纲名" : "不生成大纲名"}</span>}{selectedTask.target === "正文" && selectedTask.contextOptions.firstAppearanceCharacterIds && <span>首次出场：{selectedFirstAppearanceNames.length ? selectedFirstAppearanceNames.join("、") : "无"}</span>}{typeof selectedTask.contextOptions.estimatedCharacters === "number" && <span>约 {selectedTask.contextOptions.estimatedCharacters.toLocaleString("zh-CN")} 字符</span>}{selectedTask.contextOptions.sessionId && <span>会话 {selectedTask.contextOptions.sessionId}</span>}</div></section>}
          {selectedTask.contextOptions?.generatedOutlineTitleError && <section className="task-detail-section task-detail-error"><h3>大纲名未应用</h3><div>{selectedTask.contextOptions.generatedOutlineTitleError}。正文已正常保存。</div></section>}
          {!!selectedTask.contextOptions?.reviewMaxRounds && <section className="task-detail-section"><h3>生成后审校</h3><p>已修正 {selectedTask.contextOptions.reviewRound ?? 0} / {selectedTask.contextOptions.reviewMaxRounds} 次</p><details><summary>本次审校规则</summary><div className="task-detail-copy">{selectedTask.contextOptions.reviewRuleSnapshot ? <ReviewRuleSnapshotView snapshot={selectedTask.contextOptions.reviewRuleSnapshot} /> : <>文章通用规则：{selectedTask.contextOptions.reviewRules || "无额外规则"}{"\n\n"}本次指令：{selectedTask.contextOptions.reviewInstruction || "无额外指令"}</>}</div></details></section>}
</> : null;

  return <section className="workspace task-workspace" aria-label="AI 任务工作区">
    <header className="workspace-header"><div className="task-drawer-title">{selectedTask && <IconButton name="back" label="返回任务列表" onClick={() => setSelectedTaskId("")} />}<div><strong>{selectedTask ? (selectedOutline ? outlineDisplayTitle(selectedOutline) : "任务详情") : "AI 任务"}</strong><span>{selectedTask ? taskPhaseLabels[selectedTask.phase ?? "queued"] : activeCount ? String(activeCount) + " 个待处理任务" : "没有进行中的任务"}</span></div></div><IconButton name="close" label="关闭 AI 任务" onClick={onClose} /></header>
    <div className="task-workspace-content">
      {selectedTask && <nav className="task-workspace-rail" aria-label="任务列表">{tasks.map((task) => <button type="button" key={task.id} aria-current={selectedTaskId === task.id ? "true" : undefined} onClick={() => setSelectedTaskId(task.id)}><span className={"state-dot " + (isTaskAwaitingAuthor(task) ? "awaiting-author" : task.state)} /><span><strong>{studio.data.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((outline) => outline.id === task.outlineId)?.title || task.target}</strong><small>{taskPhaseLabels[task.phase ?? "queued"]}</small></span></button>)}</nav>}
      <div className="task-panel" aria-label="AI 任务">
      {selectedTask?.contextOptions?.writingPreparation ? <section className="task-detail workflow-task-detail" aria-label="任务详情">
        <TaskInteraction key={selectedTask.id + ":" + selectedTask.contextOptions.writingPreparation.revision} task={selectedTask} full details={taskDetails} />
        <footer className="task-detail-actions"><button type="button" onClick={() => locate(selectedTask)}>{selectedTask.state === "success" ? "打开生成版本" : "打开对应内容"}</button>{(selectedTask.state === "waiting" || selectedTask.state === "running") && <button type="button" onClick={() => cancelTask(selectedTask)}>取消任务</button>}{isForeign(selectedTask) && (selectedTask.state === "waiting" || isStale(selectedTask)) && <button onClick={() => transferTask(selectedTask)}>{transferLabel}</button>}{(selectedTask.state === "failed" || selectedTask.state === "cancelled" || isStale(selectedTask)) && <button onClick={() => retryTask(selectedTask)}>重新执行</button>}{["success", "failed", "cancelled"].includes(selectedTask.state) && <button className="danger-text" type="button" onClick={() => { setSelectedTaskId(""); studio.removeTask(selectedTask.id); }}>移除</button>}</footer>
      </section> : selectedTask ? <section className="task-detail" aria-label="任务详情">
        <div className="task-detail-body" data-ui-overlay-scroll>
          <div className={`task-detail-status ${isStale(selectedTask) ? "stale" : ""}`}><span className={`state-dot ${selectedTask.state}`} /><span className="ui-label">{isStale(selectedTask) ? "执行心跳已中断" : labels[selectedTask.state]}</span><span>{phaseLabels[selectedTask.phase ?? "queued"]} · {selectedTask.executionOrigin === "cloud" ? "云端执行" : "本地执行"} · 已用时 {taskElapsed(selectedTask)}</span></div>
          <TaskHistory task={selectedTask} />
          {taskDetails}
          {selectedTask.contextOptions?.reviewReport && <GenerateReviewReportView report={selectedTask.contextOptions.reviewReport} />}
          {selectedTask.contextOptions?.reviewCandidateOnly && <Alert color="yellow">执行期间正文已变化，终稿已保存为候选版本，可通过“打开生成版本”查看。</Alert>}
          {!!selectedTask.contextOptions?.reviewMaxRounds && selectedTask.state === "failed" && !selectedTask.contextOptions.reviewReport && <Alert color="yellow">审校未完成。下方结果是最近保存的中间稿，重新执行会从保存的进度继续。</Alert>}
          {selectedTask.error && <section className="task-detail-section task-detail-error"><h3>错误</h3><div>{selectedTask.error}</div></section>}
          <section className="task-detail-section"><h3>任务结果</h3>{isIllustrationTarget(selectedTask.target) && selectedTask.state === "success" ? <IllustrationTaskResult id={selectedTask.contextOptions?.illustrationId || selectedTask.id} prompt={selectedResult} image={selectedTask.target === "插图"} /> : selectedResult ? <div className="task-detail-result" aria-label="任务结果">{selectedResult}</div> : <div className="task-detail-empty">{selectedTask.state === "waiting" || selectedTask.state === "running" ? "任务尚未产生结果" : "没有可用结果"}</div>}</section>
        </div>
        <footer className="task-detail-actions">
          <button type="button" onClick={() => locate(selectedTask)}>{isIllustrationTarget(selectedTask.target) ? "查看生成历史" : selectedTask.target === "全部名称" ? "查看名称候选" : selectedTask.state === "success" && selectedTask.target === "正文" ? "打开生成版本" : "打开对应内容"}</button>
          {(selectedTask.state === "waiting" || selectedTask.state === "running") && <button type="button" onClick={() => cancelTask(selectedTask)}>取消</button>}
          {isForeign(selectedTask) && !isIllustrationTarget(selectedTask.target) && selectedTask.target !== "AI Chat" && (selectedTask.state === "waiting" || isStale(selectedTask)) && <button type="button" onClick={() => transferTask(selectedTask)}>{transferLabel}</button>}
          {selectedTask.state === "success" && (selectedTask.target === "大纲" || selectedTask.target === "章节标题") && <button type="button" onClick={() => applyResult(selectedTask)}>应用结果</button>}
          {(selectedTask.state === "failed" || selectedTask.state === "cancelled" || isStale(selectedTask)) && (selectedTask.target === "AI Chat" ? <button type="button" onClick={() => { studio.setChatDraft(selectedTask.outlineId, selectedTask.prompt); locate(selectedTask); }}>再次发送</button> : <button type="button" onClick={() => retryTask(selectedTask)}>重新执行</button>)}
          {["success", "failed", "cancelled"].includes(selectedTask.state) && <button className="danger-text" type="button" onClick={() => { setSelectedTaskId(""); studio.removeTask(selectedTask.id); }}>移除</button>}
        </footer>
      </section> : <><div className="task-list" data-ui-overlay-scroll><CharacterPhotoTasks />{tasks.map((task) => {
        const article = studio.data.articles.find((item) => item.id === task.articleId);
        const chapter = article?.chapters.find((item) => item.id === task.chapterId);
        const outline = chapter?.outlines.find((item) => item.id === task.outlineId);
        return <article className="task-card" key={task.id}>
          <div className="task-state"><span className={`state-dot ${isTaskAwaitingAuthor(task) ? "awaiting-author" : task.state}`} />{isTaskAwaitingAuthor(task) ? "等待作者" : labels[task.state]} · {phaseLabels[task.phase ?? "queued"]} · {formatTime(task.createdAt)}</div>
          <button className="task-title" type="button" aria-label={`查看任务详情：${task.target === "全部名称" ? "整篇章节与大纲命名" : outline ? outlineDisplayTitle(outline) : "已删除的大纲"}`} onClick={() => setSelectedTaskId(task.id)}>{task.target === "全部名称" ? "整篇章节与大纲命名" : outline ? outlineDisplayTitle(outline) : "已删除的大纲"}</button>
          <p>{article?.title ?? "未知文章"}{task.target === "全部名称" ? ` · ${task.contextOptions?.nameChapterCount ?? 0} 章 · ${task.contextOptions?.nameOutlineCount ?? 0} 个大纲` : ` · ${chapter?.title ?? "未知章节"}`} · 目标：{task.target}{task.target === "正文" ? ` · ${contentGenerationModeLabel(task.contextOptions?.contentMode)}${task.contextOptions?.contentMode === "rewrite" ? ` · 原文保留 ${rewriteRetentionLabel(task.contextOptions.rewriteRetention)}` : ""} · ${proseControlsSummary(task.contextOptions)} · ${generateTargetWordsLabel(task.contextOptions?.targetWords)}` : ""}</p>
          <blockquote>{task.prompt || (task.target === "全部名称" ? "使用文章命名设置" : "按大纲生成")}</blockquote>
          {task.error && <p className="task-error">{task.error}</p>}
          <TaskHistory task={task} collapsible />
          <div><span>{modelDisplayLabel(models, task.model || "", task.contextOptions?.modelName)}</span><span className="task-buttons">
            <button type="button" onClick={() => setSelectedTaskId(task.id)}>打开</button>
            {(task.state === "waiting" || task.state === "running") && <button type="button" onClick={() => cancelTask(task)}>取消</button>}
            {isForeign(task) && !isIllustrationTarget(task.target) && task.target !== "AI Chat" && (task.state === "waiting" || isStale(task)) && <button type="button" onClick={() => transferTask(task)}>{transferLabel}</button>}
            {task.state === "success" && (task.target === "大纲" || task.target === "章节标题") && <button type="button" onClick={() => { applyResult(task); locate(task); }}>应用结果</button>}
            {(task.state === "failed" || task.state === "cancelled" || isStale(task)) && (task.target === "AI Chat" ? <button type="button" onClick={() => { studio.setChatDraft(task.outlineId, task.prompt); locate(task); }}>再次发送</button> : <button type="button" onClick={() => retryTask(task)}>重新执行</button>)}
            {["success", "failed", "cancelled"].includes(task.state) && <button type="button" onClick={() => studio.removeTask(task.id)}>移除</button>}
          </span></div>
        </article>;
      })}{!tasks.length && <div className="empty-inline">暂无 AI 任务</div>}</div>
      <footer><span>生成并发 {generateRunningCount} / {studio.data.settings.taskConcurrency}{chatRunningCount ? ` · Chat ${chatRunningCount}` : ""}</span><span className="task-footer-actions"><button type="button" disabled={!completedCount} onClick={() => studio.clearCompletedTasks()}>清空已完成{completedCount ? ` (${completedCount})` : ""}</button><button type="button" onClick={() => { onClose(); window.history.pushState({}, "", "/settings/tasks"); window.dispatchEvent(new PopStateEvent("popstate")); }}>任务设置 →</button></span></footer></>}
    </div>
    </div>
  </section>;
}

function ArticleCopyDialog({ article, existingTitles, onClose, onCreate }: {
  article: Article;
  existingTitles: string[];
  onClose: () => void;
  onCreate: (options: ArticleCopyOptions) => Promise<boolean>;
}) {
  const [options, setOptions] = useState<ArticleCopyOptions>(() => ({
    ...DEFAULT_ARTICLE_COPY_OPTIONS,
    title: suggestArticleCopyTitle(article.title, existingTitles),
  }));
  const [copying, setCopying] = useState(false);
  function setOption<K extends keyof ArticleCopyOptions>(key: K, value: ArticleCopyOptions[K]) {
    setOptions((current) => ({ ...current, [key]: value }));
  }
  const setStructure = (checked: boolean) => setOptions((current) => ({
    ...current,
    includeStructure: checked,
    ...(checked ? {} : { includeContent: false }),
  }));

  return <ResponsiveModal
    opened
    onClose={() => { if (!copying) onClose(); }}
    closeButtonProps={{ "aria-label": "关闭复制文章" }}
    title="复制文章"
    size="lg"
    classNames={{ body: "article-copy-dialog-body" }}
  >
    <form className="article-copy-form" onSubmit={(event) => {
      event.preventDefault();
      if (!options.title.trim() || copying) return;
      setCopying(true);
      void onCreate({ ...options, title: options.title.trim() }).finally(() => setCopying(false));
    }}>
      <label className="article-copy-title">副本标题 <em>必填</em><input autoFocus value={options.title} onChange={(event) => setOption("title", event.target.value)} required maxLength={120} /></label>
      <div className="article-copy-options">
        <section className="article-copy-option-card">
          <label className="article-copy-check"><input type="checkbox" checked={options.includeStructure} onChange={(event) => setStructure(event.target.checked)} /><span><strong>章节与大纲</strong><small>复制章节、大纲内容和归档状态</small></span></label>
          <fieldset disabled={!options.includeStructure}>
            <legend>章节与大纲名称</legend>
            <label><input type="radio" name="copy-name-versions" checked={options.nameVersions === "default"} onChange={() => setOption("nameVersions", "default")} />仅默认名称</label>
            <label><input type="radio" name="copy-name-versions" checked={options.nameVersions === "all"} onChange={() => setOption("nameVersions", "all")} />全部候选名称</label>
          </fieldset>
        </section>
        <section className={`article-copy-option-card ${options.includeStructure ? "" : "disabled"}`}>
          <label className="article-copy-check"><input type="checkbox" checked={options.includeContent} disabled={!options.includeStructure} onChange={(event) => setOption("includeContent", event.target.checked)} /><span><strong>正文</strong><small>正文依赖对应的章节与大纲</small></span></label>
          <fieldset disabled={!options.includeStructure || !options.includeContent}>
            <legend>正文版本</legend>
            <label><input type="radio" name="copy-content-versions" checked={options.contentVersions === "default"} onChange={() => setOption("contentVersions", "default")} />仅默认正文</label>
            <label><input type="radio" name="copy-content-versions" checked={options.contentVersions === "all"} onChange={() => setOption("contentVersions", "all")} />全部正文版本</label>
          </fieldset>
        </section>
        <label className="article-copy-option-card article-copy-check"><input type="checkbox" checked={options.includeCharacters} onChange={(event) => setOption("includeCharacters", event.target.checked)} /><span><strong>人物资料</strong><small>包含人物档案、章节人物变化和人物关系</small></span></label>
        <label className="article-copy-option-card article-copy-check"><input type="checkbox" checked={options.includeStyle} onChange={(event) => setOption("includeStyle", event.target.checked)} /><span><strong>写作风格</strong><small>保留文章的写作风格设置</small></span></label>
        <label className="article-copy-option-card article-copy-check"><input type="checkbox" checked={options.includeMetadata} onChange={(event) => setOption("includeMetadata", event.target.checked)} /><span><strong>文章资料</strong><small>包含简介、故事发生地点和负面约束</small></span></label>
        <label className="article-copy-option-card article-copy-check"><input type="checkbox" checked={options.includeChat} onChange={(event) => setOption("includeChat", event.target.checked)} /><span><strong>AI 对话记录</strong><small>复制历史消息，不复制未发送草稿</small></span></label>
      </div>
      <p className="article-copy-task-note">AI 任务、执行状态和任务历史不会复制。</p>
      <footer><button className="secondary-button" type="button" disabled={copying} onClick={onClose}>取消</button><button className="primary-compact" type="submit" disabled={!options.title.trim() || copying}>{copying ? "正在创建…" : "创建副本"}</button></footer>
    </form>
  </ResponsiveModal>;
}

function NewArticleDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (fields: Pick<Article, "title" | "summary" | "type" | "style">) => void }) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [style, setStyle] = useState("");
  return <ResponsiveModal
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭新建文章" }}
    title="新建文章"
    size="md"
    classNames={{ body: "new-article-dialog-body" }}
  >
    <form className="new-article-form" onSubmit={(event) => { event.preventDefault(); onCreate({ title: title.trim(), summary, type: "", style }); }}>
      <label>标题 <em>必填</em><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} /></label>
      <label>简介 <small>故事类型、时代背景、世界规则等内容都可以写在这里。</small><textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={10000} /></label>
      <label>写作风格<input value={style} onChange={(event) => setStyle(event.target.value)} maxLength={5000} /></label>
      <footer><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-compact" type="submit" disabled={!title.trim()}>创建文章</button></footer>
    </form>
  </ResponsiveModal>;
}
