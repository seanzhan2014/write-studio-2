"use client";

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
import { detectFirstAppearanceCharacters, selectAiContext, summarizeAiContext, type AiContextSummary, type FirstAppearanceSuggestion, type SelectedAiContext } from "@/lib/ai-context";
import type { NamingArticleContext } from "@/db/ai";
import { resolvedOutlineContentName, timestampContentName } from "@/lib/content-name.mjs";
import { normalizeExcellentFragments } from "@/lib/excellent-fragments.mjs";
import { DEFAULT_REWRITE_RETENTION_LEVEL, MAX_GENERATE_PRESETS, MAX_GENERATE_PRESET_CHARACTERS, MAX_GENERATE_TARGET_WORDS, MIN_GENERATE_TARGET_WORDS, normalizeGeneratePresets, normalizeRewriteRetentionLevel, type ContentGenerationMode, type RewriteRetentionLevel } from "@/lib/generate-options";
import { currentOutlineVersion, resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";
import { BUILTIN_REVIEW_REQUIREMENTS, MAX_REVIEW_PRESETS, MAX_REVIEW_PRESET_CHARACTERS, normalizeReviewPresets } from "@/lib/review-options";
import { DEFAULT_MAX_INPUT_CHARACTERS, MAX_MAX_INPUT_CHARACTERS, MIN_MAX_INPUT_CHARACTERS } from "@/lib/model-options";
import { modelSelectionLabel } from "@/lib/model-label";
import { CIPAI_OPTIONS, DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, NAMING_EXPRESSION_OPTIONS, NAMING_FORMAT_OPTIONS, NAMING_STYLE_OPTIONS, normalizeNamingProfile, type NamingProfile } from "@/lib/naming-options";
import { normalizeNameVersionState, type NameVersion } from "@/lib/name-versions";
import { StudioProvider, chatSessionHasUnread, formatTime, useStudio, wordCount, type AiTask, type Article, type Character, type Chapter, type ExcellentFragment, type Outline, type Version } from "./studio-state";
import { DataTransferProvider, useDataTransfer } from "./data-transfer";
import { MobileActionSheet, ResponsiveModal, ScrollableDrawer, type ActionSheetItem } from "./ui/overlays";

type View =
  | "outline-home"
  | "write"
  | "chat"
  | "generate"
  | "chapter"
  | "chapter-edit"
  | "outline-edit"
  | "read"
  | "search"
  | "info-basic"
  | "info-chapters"
  | "info-characters"
  | "info-relationships"
  | "settings-general"
  | "settings-appearance"
  | "settings-models"
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

type ServerTaskInput = {
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
  firstAppearanceCharacterIds?: string[];
  chapterNaming?: NamingProfile;
  outlineNaming?: NamingProfile;
  timeoutMs?: number;
  promptContext?: SelectedAiContext;
  currentPlan?: string;
  outlineTitleSnapshot?: string;
  namingContext?: NamingArticleContext;
};

async function createServerTask(studio: ReturnType<typeof useStudio>, input: ServerTaskInput) {
  const taskId = clientId("task");
  const response = await fetch("/api/ai/tasks", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "Idempotency-Key": taskId },
    body: JSON.stringify(input),
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
    type: article.type,
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

type ConfiguredModel = { id: string; providerName: string; name: string; modelId: string; hasSecret: boolean; timeoutMs: number; maxInputCharacters: number };

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

function modelDisplayLabel(models: ConfiguredModel[], selectedModel: string, fixedModelName?: string) {
  const reference = selectedModel.trim();
  if (!reference) return "本地 PoC 引擎";
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
    void fetch("/api/models", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ models?: ConfiguredModel[] }>)
      .then((payload) => { if (active) setModels(payload.models ?? []); })
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

function generateTargetWordsLabel(targetWords?: number) {
  return targetWords && targetWords > 0 ? `${targetWords.toLocaleString("zh-CN")} 字` : "不限字数";
}

function latestGeneratePromptForOutline(tasks: AiTask[], outlineId: string) {
  return tasks
    .filter((task) => task.outlineId === outlineId && task.target === "正文")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]?.prompt ?? "";
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
  if (pathname.endsWith("/chapters/edit-all")) return "chapter-edit";
  if (pathname.endsWith("/outlines/edit-all")) return "outline-edit";
  if (pathname.endsWith("/outlines")) return "outline-home";
  if (pathname.includes("/chat")) return "chat";
  if (pathname.includes("/generate")) return "generate";
  if (pathname.includes("/chapters/")) return "chapter";
  if (pathname.endsWith("/edit") || pathname.endsWith("/read")) return "read";
  if (pathname.endsWith("/search")) return "search";
  if (pathname.includes("/info/chapters")) return "info-chapters";
  if (pathname.includes("/info/characters")) return "info-characters";
  if (pathname.includes("/info/relationships")) return "info-relationships";
  if (pathname.includes("/info/")) return "info-basic";
  if (pathname.includes("/settings/appearance")) return "settings-appearance";
  if (pathname.includes("/settings/models")) return "settings-models";
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
    "chapter-edit": `${base}/chapters/edit-all`,
    "outline-edit": `${base}/outlines/edit-all`,
    read: `${base}/edit`,
    search: `${base}/search`,
    "info-basic": `${base}/info/basic`,
    "info-chapters": `${base}/info/chapters`,
    "info-characters": `${base}/info/characters`,
    "info-relationships": `${base}/info/relationships`,
    "settings-general": "/settings/general",
    "settings-appearance": "/settings/appearance",
    "settings-models": "/settings/models",
    "settings-tasks": "/settings/tasks",
    "settings-database": "/settings/database",
    "settings-system": "/settings/system",
  };
  return paths[view];
}

export default function WriterStudioApp() {
  return <StudioProvider><DataTransferProvider><WriterStudioInner /></DataTransferProvider></StudioProvider>;
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
  const [versions, setVersions] = useState(false);
  const [previewSelection, setPreviewSelection] = useState<{ outlineId: string; versionId: string } | null>(null);
  const [newArticle, setNewArticle] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
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
    if (!studio.hydrated || studio.saveStatus === "failed" || studio.saveStatus === "conflict") return;
    const currentStudio = studioRef.current;
    const currentTime = Date.now();
    const leaseExpired = (task: AiTask) => task.state === "running" && (!task.leaseUntil || new Date(task.leaseUntil).getTime() <= currentTime);
    const runningTasks = currentStudio.data.tasks.filter((task) => task.executionOrigin === currentStudio.executionOrigin && task.target !== "AI Chat" && task.state === "running" && !leaseExpired(task));
    const available = Math.max(0, currentStudio.data.settings.taskConcurrency - runningTasks.length);
    const occupiedBodyOutlines = new Set(runningTasks.filter((task) => task.target === "正文").map((task) => task.outlineId));
    const dispatchableTasks: AiTask[] = [];
    for (const task of currentStudio.data.tasks
      .filter((task) => task.executionOrigin === currentStudio.executionOrigin && task.target !== "AI Chat" && (task.state === "waiting" || leaseExpired(task)))
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
          await fetch(`/api/ai/tasks/${encodeURIComponent(task.id)}/execute`, { method: "POST", cache: "no-store" });
        } finally {
          taskDispatches.current.delete(task.id);
          await studioRef.current.refreshFromServer();
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

  const previewVersion = previewSelection?.outlineId === currentOutline ? activeOutline.versions.find((version) => version.id === previewSelection.versionId) : undefined;
  const selectedOutline = { chapter: studio.currentChapter.title, title: activeOutline.title, plan: activeOutline.plan, content: previewVersion?.content ?? resolvedOutlineContent(activeOutline) };
  const isOutlineWorkspaceView = view === "write" || view === "chat" || view === "generate";
  const requiresSaveBeforeNavigation = isOutlineWorkspaceView || view === "chapter-edit" || view === "outline-edit" || view === "read";
  const mobilePageTitle = view === "search"
    ? "搜索"
    : view === "chapter-edit"
      ? "全章节编辑"
    : view === "outline-edit"
      ? "全大纲编辑"
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

  if (!studio.data.articles.length) {
    return <div className={`studio-shell empty-library-shell theme-${studio.data.settings.theme}`}><PersistenceNotices /><main className="main-area"><div className="library-empty-state"><span className="empty-library-mark">W</span><h1>创建第一篇文章</h1><div className="empty-library-actions"><button className="primary-compact" type="button" onClick={() => setNewArticle(true)}><Icon name="plus" />新建文章</button><button className="secondary-button" type="button" onClick={() => void transfer.importAnyArticles()}><Icon name="paste" />导入文章</button></div></div></main>{newArticle && <NewArticleDialog onClose={() => setNewArticle(false)} onCreate={(fields) => { studio.createArticle(fields); setNewArticle(false); setToast("文章已创建，并生成第一章"); setView(mobileLayout ? "outline-home" : "write"); window.history.pushState({}, "", "/"); }} />}{toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}</div>;
  }

  return (
    <div className={`studio-shell ${focusMode ? "focus-mode" : ""} theme-${studio.data.settings.theme}`}>
      <PersistenceNotices />
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

      <main className="main-area">
        {view !== "outline-home" && <MobileHeader
          title={mobilePageTitle}
          status={isOutlineWorkspaceView ? saveStatusLabel(studio.saveStatus) : articleTitle}
          onBack={() => go("outline-home")}
          onVersions={() => setVersions(true)}
          showVersions={isOutlineWorkspaceView}
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
            onClearPreview={() => setPreviewSelection(null)}
          /> : <StructureEmptyState articleTitle={articleTitle} onCreate={() => { const id = studio.createOutline(); setView("write"); window.history.pushState({}, "", `/articles/${activeArticle.id}/outlines/${id}/write`); }} />
        )}
        {view === "chapter" && (studio.currentChapter.id ? <ChapterReader onOutline={openOutline} /> : <StructureEmptyState articleTitle={articleTitle} onCreate={() => { const id = studio.createOutline(); setView("write"); window.history.pushState({}, "", `/articles/${activeArticle.id}/outlines/${id}/write`); }} />)}
        {view === "chapter-edit" && <FullChapterEditor key={`chapter-edit:${activeArticle.id}`} onNotice={setToast} onTaskCreated={() => setTaskPanel(true)} />}
        {view === "outline-edit" && <ContinuousDocumentEditor key={`outline-edit:${activeArticle.id}`} mode="outline" positionMemory={continuousDocumentPositions} onNotice={setToast} />}
        {view === "read" && <ContinuousDocumentEditor key={`content-edit:${activeArticle.id}`} mode="content" positionMemory={continuousDocumentPositions} onNotice={setToast} />}
        {view === "search" && <SearchPage onOutline={openOutline} onCharacter={() => go("info-characters")} />}
        {view.startsWith("info-") && <ArticleInfoPage view={view} onGo={go} />}
        {view.startsWith("settings-") && <SettingsPage view={view} onGo={go} />}
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
        onNotice={setToast}
      />}
      {taskPanel && <TaskPanel onClose={() => setTaskPanel(false)} onOpen={openOutline} />}
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
  return status === "saving" ? "正在保存…" : status === "unsaved" ? "未保存" : status === "failed" ? "保存失败" : status === "conflict" ? "保存冲突" : "已保存";
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
    {item.state !== "saved" && <span className={`state-dot ${item.state}`} title={item.state === "running" ? "AI Generate 正在运行" : "AI Generate 失败"} />}
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
  const [chapterMenu, setChapterMenu] = useState<Chapter | null>(null);
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
  useDismissOnOutside(articleMenu, onToggleArticle, ".article-switcher, .article-popover");

  useEffect(() => { window.localStorage.setItem(`writer-studio:expanded:${studio.currentArticle.id}`, JSON.stringify(expanded)); }, [expanded, studio.currentArticle.id]);
  useEffect(() => () => { if (expandTimer.current !== null) window.clearTimeout(expandTimer.current); }, []);

  useEffect(() => {
    const width = collapsed ? 56 : sidebarWidth;
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    window.localStorage.setItem("writer-studio:sidebar-width", String(sidebarWidth));
    window.localStorage.setItem("writer-studio:sidebar-collapsed", String(collapsed));
  }, [sidebarWidth, collapsed]);

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
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="文章导航" aria-hidden={mobileLayout ? true : undefined} inert={mobileLayout ? true : undefined}>
        <div className="sidebar-head">
          <button className="article-switcher" type="button" onClick={onToggleArticle} aria-expanded={articleMenu}>
            <span className="article-mark">{articleTitle[0]}</span>
            <span className="article-name">{articleTitle}</span>
            <Icon name="chevron" />
          </button>
          <IconButton name="menu" label={collapsed ? "展开侧栏" : "折叠侧栏"} className="sidebar-collapse" onClick={() => setCollapsed((value) => !value)} />
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
            <button className={view === "chapter-edit" ? "active" : ""} onClick={() => onGo("chapter-edit")} type="button"><Icon name="versions" />全章节编辑</button>
            <button className={view === "outline-edit" ? "active" : ""} onClick={() => onGo("outline-edit")} type="button"><Icon name="edit" />全大纲编辑</button>
            <button className={view === "read" ? "active" : ""} onClick={() => onGo("read")} type="button"><Icon name="read" />全文编辑</button>
            <button className={view.startsWith("info-") ? "active" : ""} onClick={() => onGo("info-basic")} type="button"><Icon name="info" />文章资料</button>
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
            <div className="tree-title"><span>章节</span><IconButton name="plus" label="新建章节" onClick={() => { const chapterId = studio.createChapter(); const outlineId = studio.createOutline(chapterId); setExpanded((state) => ({ ...state, [chapterId]: true })); onOutline(outlineId); onNotice("已创建章节和第一条大纲"); }} /></div>
            {groups.map((group) => (
              <div className="chapter-group" key={group.id}>
                <DesktopChapterDropRow chapterId={group.id} className={`chapter-row ${view === "chapter" && group.id === studio.currentChapter.id ? "active" : ""}`}>
                  <button className={`disclosure ${expanded[group.id] ? "expanded" : ""}`} type="button" aria-label={`${expanded[group.id] ? "折叠" : "展开"}${group.title}`} onClick={() => setExpanded((state) => ({ ...state, [group.id]: !state[group.id] }))}><Icon name="chevron" /></button>
                  <button className="chapter-link" type="button" onDoubleClick={() => { const title = window.prompt("章节标题", group.title); if (title?.trim()) studio.updateChapter(group.id, { title: title.trim() }); }} onClick={() => { if (group.items[0]) studio.setCurrentOutline(group.items[0].id); onGo("chapter"); }}>{group.title}</button>
                  <IconButton name="plus" label={`在${group.title}中新建大纲`} onClick={() => { const id = studio.createOutline(group.id); onOutline(id); }} />
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
          <button className={view.startsWith("settings-") ? "active" : ""} type="button" onClick={() => onGo("settings-general")}><Icon name="settings" /><span>设置</span></button>
          <button type="button" onClick={onTask}><Icon name="tasks" /><span>AI 任务</span>{studio.data.tasks.some((task) => task.state === "waiting" || task.state === "running") && <span className="task-count-badge ui-emphasis">{studio.data.tasks.filter((task) => task.state === "waiting" || task.state === "running").length}</span>}</button>
        </div>
        <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" onPointerDown={startResize} />
      </aside>
      {outlineMenu && <DesktopOutlineMenu outline={outlineMenu} onClose={() => setOutlineMenu(null)} onOpenChat={() => { studio.setCurrentOutline(outlineMenu.id); setOutlineMenu(null); onOutline(outlineMenu.id); onGo("chat"); }} onGenerate={() => { setStructureGenerate({ kind: "outline", id: outlineMenu.id, title: outlineDisplayTitle(outlineMenu) }); setOutlineMenu(null); }} onNotice={onNotice} />}
      {chapterMenu && <ChapterActionSheet chapter={chapterMenu} onClose={() => setChapterMenu(null)} onNotice={onNotice} onOpenOutline={onOutline} />}
      {structureGenerate && <StructureGenerateSheet target={structureGenerate} onClose={() => setStructureGenerate(null)} onApplied={(message, result, generatedTitle) => { studio.updateOutline(structureGenerate.id, { plan: result, ...(generatedTitle ? { title: generatedTitle, titleGenerationPending: false } : {}) }); onNotice(message); setStructureGenerate(null); }} />}
    </>
  );
}

function MobileArticleDrawer({ onClose, onGo, onNewArticle, onSelect }: {
  onClose: () => void;
  onGo: (view: "chapter-edit" | "outline-edit" | "read" | "search" | "info-basic") => void;
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
      <button type="button" onClick={() => onGo("chapter-edit")}><Icon name="versions" /><span>全章节编辑</span></button>
      <button type="button" onClick={() => onGo("outline-edit")}><Icon name="edit" /><span>全大纲编辑</span></button>
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
      {chapterMenu && <ChapterActionSheet chapter={chapterMenu} onClose={() => setChapterMenu(null)} onNotice={onNotice} onOpenOutline={onOutline} />}
    </div>
  );
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
  const rowRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const suppressClick = useRef(false);
  const wasDragging = useRef(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, data: { type: "outline", outlineId: item.id } });

  useEffect(() => {
    if (isDragging) {
      wasDragging.current = true;
      suppressClick.current = true;
      navigator.vibrate?.(12);
      return;
    }
    if (!wasDragging.current) return;
    const timeout = window.setTimeout(() => {
      wasDragging.current = false;
      suppressClick.current = false;
      setReveal(null);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [isDragging]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || (event.target as Element | null)?.closest(".icon-button, .swipe-action")) return;
      const touch = event.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      suppressClick.current = false;
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1 || isDragging) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - startX.current;
      const deltaY = touch.clientY - startY.current;
      if (Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY)) event.preventDefault();
    };
    const touchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch || isDragging || wasDragging.current) return;
      const deltaX = touch.clientX - startX.current;
      const deltaY = touch.clientY - startY.current;
      if (Math.abs(deltaX) > 46 && Math.abs(deltaX) > Math.abs(deltaY)) {
        suppressClick.current = true;
        setReveal(deltaX < 0 ? "left" : "right");
        window.setTimeout(() => { suppressClick.current = false; }, 180);
      }
    };
    row.addEventListener("touchstart", touchStart, { passive: true });
    row.addEventListener("touchmove", touchMove, { passive: false });
    row.addEventListener("touchend", touchEnd, { passive: true });
    return () => {
      row.removeEventListener("touchstart", touchStart);
      row.removeEventListener("touchmove", touchMove);
      row.removeEventListener("touchend", touchEnd);
    };
  }, [isDragging]);

  const sortableStyle: CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 3 : style?.zIndex,
  };

  function prepareSwipeAction(event: React.PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    suppressClick.current = false;
  }

  function runSwipeAction(action: () => void) {
    suppressClick.current = false;
    setReveal(null);
    action();
  }

  return (
    <div ref={(node) => { rowRef.current = node; setNodeRef(node); }} style={sortableStyle} data-outline-id={item.id} aria-grabbed={isDragging} className={`mobile-outline-row-wrap ${reveal ? `reveal-${reveal}` : ""} ${selected ? "selected" : ""} ${item.archived ? "archived" : ""} ${isDragging ? "dragging" : ""} ${dropPlacement ? `drop-${dropPlacement}` : ""}`} onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }} onContextMenu={(event) => event.preventDefault()}>
      <div className="swipe-action swipe-add" aria-hidden={reveal !== "right"}><button type="button" tabIndex={reveal === "right" ? 0 : -1} aria-label={`在${displayTitle}下方新建大纲`} onPointerDown={prepareSwipeAction} onClick={(event) => { event.stopPropagation(); runSwipeAction(onAdd); }}><Icon name="plus" />下方新建</button></div>
      <div className={`swipe-action swipe-manage ${item.archived ? "restore" : ""}`} aria-hidden={reveal !== "left"}><button type="button" tabIndex={reveal === "left" ? 0 : -1} aria-label={`${item.archived ? "恢复" : "归档"}大纲：${displayTitle}`} onPointerDown={prepareSwipeAction} onClick={(event) => { event.stopPropagation(); runSwipeAction(onToggleArchive); }}><Icon name={item.archived ? "refresh" : "archive"} />{item.archived ? "恢复" : "归档"}</button></div>
      <div className="mobile-outline-row">
        <span className="outline-number">{String(index + 1).padStart(2, "0")}</span>
        <button className="mobile-outline-main" type="button" {...attributes} {...listeners} onClick={() => {
          if (suppressClick.current) return;
          if (reveal) setReveal(null);
          else onOpen();
        }}>
          <span className="ui-title">{displayTitle}</span>
          {item.state !== "saved" && <span>{item.state === "running" ? "AI Generate 运行中" : "生成失败"}</span>}
        </button>
        {item.state !== "saved" && <span className={`state-dot ${item.state}`} />}
        <IconButton name="more" label={`${displayTitle}更多操作`} className="mobile-row-more" aria-haspopup="dialog" aria-expanded={menuOpen} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onMore(); }} />
      </div>
    </div>
  );
}

function OutlineActionSheet({ title, archived, onClose, onEdit, onGenerate, onChat, onCopy, onExport, onMove, onMoveUp, onMoveDown, onArchive, onDelete }: { title: string; archived: boolean; onClose: () => void; onEdit: () => void; onGenerate: () => void; onChat: () => void; onCopy: () => void; onExport: () => void; onMove: () => void; onMoveUp?: () => void; onMoveDown?: () => void; onArchive: () => void; onDelete: () => void }) {
  const definitions: Array<{ key: string; icon: IconName; label: string; danger?: boolean }> = [
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
    if (key === "edit") onEdit();
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

function DesktopOutlineMenu({ outline, onClose, onOpenChat, onGenerate, onNotice }: { outline: Outline; onClose: () => void; onOpenChat: () => void; onGenerate: () => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const chapter = studio.currentArticle.chapters.find((item) => item.outlines.some((candidate) => candidate.id === outline.id));
  const displayTitle = outlineDisplayTitle(outline);
  const outlineIndex = chapter?.outlines.findIndex((item) => item.id === outline.id) ?? -1;
  const previousOutline = outlineIndex > 0 ? chapter?.outlines[outlineIndex - 1] : undefined;
  const nextOutline = chapter && outlineIndex >= 0 && outlineIndex < chapter.outlines.length - 1 ? chapter.outlines[outlineIndex + 1] : undefined;
  const items: Array<[string, () => void]> = [
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

function ChapterActionSheet({ chapter, onClose, onNotice, onOpenOutline }: { chapter: Chapter; onClose: () => void; onNotice: (message: string) => void; onOpenOutline: (id: string) => void }) {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const items: Array<{ key: string; label: string; icon: IconName; className?: string; onSelect: () => void }> = [
    { key: "rename", label: "重命名", icon: "edit", onSelect: () => { const title = window.prompt("章节标题", chapter.title); if (title?.trim()) { studio.updateChapter(chapter.id, { title: title.trim().slice(0, 120) }); onNotice("章节已重命名"); } } },
    { key: "create", label: "新建大纲", icon: "plus", onSelect: () => { const id = studio.createOutline(chapter.id); onOpenOutline(id); } },
    { key: "import", label: "导入大纲", icon: "paste", onSelect: () => { onClose(); void transfer.importOutline(chapter.id); } },
    { key: "move-up", label: "上移", icon: "move", onSelect: () => studio.moveChapter(chapter.id, -1) },
    { key: "move-down", label: "下移", icon: "move", onSelect: () => studio.moveChapter(chapter.id, 1) },
    { key: "archive", label: chapter.archived ? "恢复章节" : "归档章节", icon: chapter.archived ? "refresh" : "archive", onSelect: () => studio.updateChapter(chapter.id, { archived: !chapter.archived }) },
  ];
  const actions: ActionSheetItem[] = [
    ...items.map((item) => ({ ...item, icon: <Icon name={item.icon} /> })),
    { key: "delete", label: "删除章节", icon: <Icon name="trash" />, danger: true, onSelect: () => { const typed = window.prompt(`章节包含 ${chapter.outlines.length} 条大纲。输入章节标题以确认删除：`, ""); if (typed === chapter.title) { studio.deleteChapter(chapter.id); onNotice("章节已删除"); } } },
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
      const response = await fetch("/api/ai/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outlineId, instruction: prompt.trim(), model: selectedModelReference, target: isChapter ? "chapter-title" : "outline", includePrevious: true, includeCharacters: true, context }) });
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
    title={<div className="structure-generate-drawer-title"><div className="structure-generate-icon"><Icon name="spark" /></div><div><span>AI Generate · 文章结构</span><span className="ui-title">{isChapter ? "生成章节标题" : "生成大纲内容"}</span><small>{target.title}</small></div></div>}
    position="bottom"
    size="auto"
    classNames={{ content: "structure-generate-drawer", body: "structure-generate-sheet structure-generate-drawer-body" }}
  >
    <div className="structure-context"><Icon name="book" /><span className="ui-label">上下文 · {contextSummary?.total.toLocaleString("zh-CN") ?? "—"} 字符</span></div>
    <details className="structure-current"><summary>{isChapter ? "当前章节标题" : "当前大纲内容"}</summary><p>{currentValue || "（当前内容为空）"}</p></details>
    <label>生成要求<textarea maxLength={20000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入生成要求" /></label>
    <label className="structure-model">本次模型<select value={selectedModelReference} onChange={(event) => selectGenerateModel(event.target.value)}><option value="">本地 PoC 引擎</option>{selectedModelReference && !configuredModelForReference(models, selectedModelReference) && <option value={selectedModelReference}>{selectedModelReference}</option>}{models.map((model) => <option value={model.id} key={model.id}>{modelDisplayLabel(models, model.id)}{model.hasSecret ? "" : "（需密钥）"}</option>)}</select></label>
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

function MobileHeader({ title, status, onBack, onVersions, showVersions }: { title: string; status: string; onBack: () => void; onVersions: () => void; showVersions: boolean }) {
  return (
    <div className="mobile-header">
      <IconButton name="back" label="返回大纲" variant="glass" size="large" className="mobile-back-button" onClick={onBack} />
      <div><span className="ui-title">{title}</span><span>{status}</span></div>
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
  onClearPreview,
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
  onClearPreview: () => void;
}) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const [moreOpen, setMoreOpen] = useState(false);
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
          <div className="breadcrumb"><button type="button" onClick={() => { window.history.pushState({}, "", `/articles/${studio.currentArticle.id}/chapters/${studio.currentChapter.id}`); window.dispatchEvent(new PopStateEvent("popstate")); }}>{outline.chapter}</button><span>/</span><input value={normalizeOutlineTitle(outline.title)} placeholder={displayTitle} onChange={(event) => studio.updateOutline(studio.currentOutline.id, { title: event.target.value.slice(0, 80) })} aria-label="大纲标题" /></div>
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

      {mode === "write" && <WritingView focusMode={focusMode} previewVersion={previewVersion} onClearPreview={onClearPreview} onNotice={onNotice} />}
      {mode === "chat" && <ChatView models={models} outlineTitle={displayTitle} onNotice={onNotice} onUseAsGenerate={(text) => { setGenerateSeed(text); void onMode("generate"); }} />}
      {mode === "generate" && <GenerateView models={models} outline={outline} initialPrompt={generateSeed} onTaskCreated={onTaskCreated} onOpenTasks={onOpenTasks} />}
      {moreOpen && <div className="workspace-more-menu"><button type="button" onClick={() => { studio.saveVersion(studio.currentOutline.id, timestampContentName(), "手动", resolvedOutlineContent(studio.currentOutline)); setMoreOpen(false); }}>保存正文版本</button><button type="button" onClick={() => void saveAsCurrentContent()}>另存为正文版本</button><button type="button" onClick={() => { studio.updateOutline(studio.currentOutline.id, { archived: true }); setMoreOpen(false); }}>归档大纲</button><button className="danger" type="button" onClick={() => { if (window.confirm(`删除「${displayTitle}」？`)) studio.deleteOutline(studio.currentOutline.id); setMoreOpen(false); }}>删除大纲</button></div>}
    </div>
  );
}

function WritingView({ focusMode, previewVersion, onClearPreview, onNotice }: { focusMode: boolean; previewVersion?: Version; onClearPreview: () => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const [planOpen, setPlanOpen] = useState(studio.data.settings.outlineExpanded);
  const [planPeek, setPlanPeek] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const [settingExcellent, setSettingExcellent] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<{ left: number; top: number; start: number; end: number } | null>(null);
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
  const displayedIsCurrent = !previewVersion || previewVersion.id === studio.currentOutline.currentVersionId;
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

  const showSelectionMenu = useCallback((point?: { x: number; y: number }) => {
    const reader = readerRef.current;
    if (!reader) return false;
    const selected = selectedRangeWithin(reader);
    const selection = window.getSelection();
    if (!selected || !selection?.rangeCount) return false;
    const bounds = selection.getRangeAt(0).getBoundingClientRect();
    const menuWidth = 124;
    const menuHeight = 48;
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
    setExitPromptOpen(false);
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
    setExitPromptOpen(false);
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
    const existingVersionId = displayedVersion?.id;
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
    if (!previewVersion || previewVersion.id === studio.currentOutline.currentVersionId) return;
    studio.setCurrentVersion(studio.currentOutline.id, previewVersion.id);
    onClearPreview();
    const saved = await studio.saveNow();
    onNotice(saved ? "已设为当前正文" : "设置当前正文未完成，请查看保存状态");
  }

  async function toggleDisplayedBodyExcellent() {
    if (!displayedContent.trim() || settingExcellentRef.current) return;
    settingExcellentRef.current = true;
    setSettingExcellent(true);
    const next = !displayedManuallyExcellent;
    studio.setBodyExcellent(studio.currentOutline.id, displayedVersion?.id, next);
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
    const action = studio.toggleExcellentFragment(studio.currentOutline.id, displayedVersion?.id, range.start, range.end);
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    if (action === "added") onNotice("已标记优秀片段");
    if (action === "removed") onNotice("已取消优秀片段");
  }

  function openSelectionMenu(event: React.MouseEvent<HTMLDivElement>) {
    if (showSelectionMenu({ x: event.clientX, y: event.clientY })) event.preventDefault();
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
    <div className="writing-scroll">
      <div className="writing-canvas">
        {!focusMode && <button className="mobile-plan-peek" type="button" onClick={() => setPlanPeek(true)}>此正文大纲 <span><Icon name="chevron" /></span></button>}
        {!focusMode && (
          <section className="outline-editor-section">
            <button className="section-heading" type="button" onClick={() => { setPlanOpen((value) => !value); studio.updateSettings({ outlineExpanded: !planOpen }); }}><span>此正文大纲</span><span>{planOpen ? "收起" : "展开"} <Icon name="chevron" /></span></button>
            {planOpen && <div className="outline-snapshot-content" aria-label="此正文大纲内容">{plan || "此版本未保存生成时的大纲内容"}</div>}
          </section>
        )}

        <section className="content-editor-section">
          <div className="editor-heading">
            <div className="body-title-cluster">
              <button className={`body-title-toggle ${displayedIsDefault ? "default" : ""}`} type="button" disabled={!displayedContent.trim() || settingDefault} aria-label={`正文标题，双击${displayedIsDefault ? "取消" : "设为"}默认正文`} title={`${displayedContentName} · 双击${displayedIsDefault ? "取消" : "设为"}默认正文`} onClick={(event) => { if (event.detail === 0) void toggleDisplayedContentDefault(); }} onDoubleClick={() => void toggleDisplayedContentDefault()} onPointerUp={(event) => { if (isTouchDoubleTap(event, lastTitleTouchRef)) void toggleDisplayedContentDefault(); }}><span>{displayedContentName}</span></button>
              <button className={`body-status-button default-status ${displayedIsDefault ? "active" : ""}`} type="button" disabled={!displayedContent.trim() || settingDefault} aria-label={displayedIsDefault ? "取消默认正文" : "设为默认正文"} aria-pressed={displayedIsDefault} title={displayedIsDefault ? "取消默认正文" : "设为默认正文"} onClick={() => void toggleDisplayedContentDefault()}><span aria-hidden="true">P</span></button>
              <button className={`body-status-button excellent-status ${displayedIsExcellent ? "active" : ""} ${displayedAutomaticallyExcellent && !displayedManuallyExcellent ? "automatic" : ""}`} type="button" disabled={!displayedContent.trim() || settingExcellent} aria-label={displayedManuallyExcellent ? "取消手动优秀正文" : displayedAutomaticallyExcellent ? "手动保留优秀正文" : "设为优秀正文"} aria-pressed={displayedIsExcellent} title={displayedManuallyExcellent ? "取消手动优秀正文" : displayedAutomaticallyExcellent ? "含优秀片段，已自动设为优秀；点击可手动保留" : "设为优秀正文"} onClick={() => void toggleDisplayedBodyExcellent()}><span aria-hidden="true">★</span></button>
              {displayedIsCurrent
                ? <span className="body-current-label">当前</span>
                : <button className="body-set-current-button" type="button" onClick={() => void setDisplayedAsCurrent()}>设为当前</button>}
            </div>
            <div className="editor-tools">{editing ? <><IconButton name="search" label="查找正文" title="查找" size="small" onClick={() => setFindOpen((value) => !value)} /><IconButton name="copy" label="复制正文" title="复制" size="small" onClick={() => void copyEditingContent()} /><IconButton name="paste" label="粘贴正文" title="粘贴" size="small" onClick={() => void pasteEditingContent()} /><IconButton name="save" label="保存正文" title="保存" size="small" disabled={savingEdit} onClick={() => void saveEditing()} /><IconButton name="saveAs" label="另存为正文" title="另存为" size="small" onClick={() => void saveAsEditingContent()} /><button className="finish-edit-button" type="button" onClick={requestExitEditing}>退出编辑</button></> : <span className="content-word-count">{wordCount(displayedContent).toLocaleString("zh-CN")} 字</span>}</div>
          </div>
          {findOpen && editing && <div className="find-bar"><input autoFocus value={findQuery} onChange={(event) => { setFindQuery(event.target.value); setMatchIndex(0); }} placeholder="查找…" aria-label="查找正文" /><input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="替换为…" aria-label="替换内容" /><label><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />Aa</label><span>{matches.length ? `${Math.min(matchIndex + 1, matches.length)} / ${matches.length}` : "0 / 0"}</span><button type="button" onClick={() => selectMatch(matchIndex - 1)}>上一个</button><button type="button" onClick={() => selectMatch(matchIndex + 1)}>下一个</button><button type="button" onClick={replaceCurrent}>替换</button><button type="button" onClick={replaceAll}>全部</button><IconButton name="close" label="关闭查找" onClick={() => setFindOpen(false)} /></div>}
          {editing ? <textarea ref={editorRef} className="content-editor" value={draftContent} onChange={(event) => changeDraft(event.target.value)} aria-label="正文编辑器" placeholder="从这里开始写作…" spellCheck={false} style={{ fontSize: studio.data.settings.fontSize, lineHeight: studio.data.settings.lineHeight, fontFamily: studio.data.settings.editorFont === "serif" ? "Georgia, 'Noto Serif SC', serif" : undefined, maxWidth: studio.data.settings.contentWidth }} /> : <div ref={readerRef} className="content-reader" role="region" tabIndex={0} aria-label="正文内容" aria-description="选中文字可欣赏；双击或按 Enter 进入编辑" aria-keyshortcuts="Enter" onContextMenu={openSelectionMenu} onDoubleClick={(event) => { event.preventDefault(); beginEditing(); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); beginEditing(); } }} onPointerDown={() => { selectionPointerActiveRef.current = true; }} onPointerCancel={() => { selectionPointerActiveRef.current = false; }} onPointerUp={(event) => { selectionPointerActiveRef.current = false; if (isTouchDoubleTap(event, lastReaderTouchRef)) beginEditing(); else queueSelectionMenu(); }} style={{ fontSize: studio.data.settings.fontSize, lineHeight: studio.data.settings.lineHeight, fontFamily: studio.data.settings.editorFont === "serif" ? "Georgia, 'Noto Serif SC', serif" : undefined, maxWidth: studio.data.settings.contentWidth }}>{content ? <ExcellentText text={content} fragments={displayedFragments} /> : "（正文为空）"}</div>}
        </section>
      </div>
      {selectionMenu && <div className="content-selection-menu" role="menu" aria-label="正文选择菜单" style={{ left: selectionMenu.left, top: selectionMenu.top }}><button className={selectedFragmentIsExcellent ? "active" : ""} type="button" role="menuitemcheckbox" aria-checked={selectedFragmentIsExcellent} onClick={() => applyAppreciationRange(selectionMenu)}><span>欣赏</span>{selectedFragmentIsExcellent && <Icon name="check" />}</button></div>}
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

function GenerateView({ models, outline, initialPrompt = "", onTaskCreated, onOpenTasks }: { models: ConfiguredModel[]; outline: { title: string; plan: string; content: string }; initialPrompt?: string; onTaskCreated: () => void; onOpenTasks: () => void }) {
  const studio = useStudio();
  const displayTitle = outlineDisplayTitle(outline);
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [prompt, setPrompt] = useState(() => initialPrompt || studio.currentOutline.generateInstruction || latestGeneratePromptForOutline(studio.data.tasks, studio.currentOutline.id));
  const [contextOpen, setContextOpen] = useState(false);
  const [appearanceEditorOpen, setAppearanceEditorOpen] = useState(false);
  const [appearanceOverrides, setAppearanceOverrides] = useState<Record<string, boolean>>({});
  const [includePrevious, setIncludePrevious] = useState(true);
  const [includeCharacters, setIncludeCharacters] = useState(true);
  const [includeExcellentFragments, setIncludeExcellentFragments] = useState(false);
  const [includeOutlineTitle, setIncludeOutlineTitle] = useState(false);
  const [generationMode, setGenerationMode] = useState<ContentGenerationMode>("fresh");
  const [rewriteRetention, setRewriteRetention] = useState<RewriteRetentionLevel>(DEFAULT_REWRITE_RETENTION_LEVEL);
  const selectedModel = studio.data.settings.generateModel;
  const [notice, setNotice] = useState("");
  const [presetManagerOpen, setPresetManagerOpen] = useState(false);
  const [targetWordsInput, setTargetWordsInput] = useState(() => studio.data.settings.generateTargetWords > 0 ? String(studio.data.settings.generateTargetWords) : "");
  const [outlinePlanDraft, setOutlinePlanDraft] = useState(outline.plan);
  const outlinePlanDraftRef = useRef(outline.plan);
  const lastSyncedOutlineRef = useRef({ id: studio.currentOutline.id, plan: outline.plan });
  const [outlineSaving, setOutlineSaving] = useState(false);
  const parsedTargetWords = Number(targetWordsInput);
  const targetWordsUnset = targetWordsInput.trim() === "" || parsedTargetWords === 0;
  const targetWordsValid = targetWordsUnset || (Number.isInteger(parsedTargetWords) && parsedTargetWords >= MIN_GENERATE_TARGET_WORDS && parsedTargetWords <= MAX_GENERATE_TARGET_WORDS);
  const targetWords = targetWordsValid && !targetWordsUnset ? parsedTargetWords : undefined;
  const rewriteRetentionIndex = rewriteRetentionOptions.findIndex((item) => item.value === rewriteRetention);
  const rewriteRetentionOption = rewriteRetentionOptions[rewriteRetentionIndex] ?? rewriteRetentionOptions[1];
  const hasCurrentContent = Boolean(resolvedOutlineContent(studio.currentOutline).trim());
  const outlinePlanDirty = outlinePlanDraft !== outline.plan;
  useEffect(() => {
    const previous = lastSyncedOutlineRef.current;
    if (previous.id !== studio.currentOutline.id || outlinePlanDraftRef.current === previous.plan) {
      outlinePlanDraftRef.current = outline.plan;
      setOutlinePlanDraft(outline.plan);
      if (previous.id !== studio.currentOutline.id) { setAppearanceOverrides({}); setIncludeOutlineTitle(false); }
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
  const selectedRecord = configuredModelForReference(models, selectedModel);
  const selectedModelReference = selectedRecord?.id ?? selectedModel.trim();
  const modelOptions = [
    { value: "", label: "本地 PoC 引擎" },
    ...(selectedModelReference && !selectedRecord ? [{ value: selectedModelReference, label: selectedModelReference }] : []),
    ...models.map((model) => ({ value: model.id, label: `${modelDisplayLabel(models, model.id)}${model.hasSecret ? "" : "（需密钥）"}` })),
  ];

  function selectGenerateModel(model: string) {
    studio.updateSettings({ generateModel: model });
    void studio.saveNow();
  }

  const saveOutlineDraft = useCallback(async () => {
    if (outlinePlanDraft === studio.currentOutline.plan) return true;
    setOutlineSaving(true);
    const saved = await studio.saveOutlinePlan(studio.currentOutline.id, outlinePlanDraft);
    if (saved) lastSyncedOutlineRef.current = { id: studio.currentOutline.id, plan: outlinePlanDraft };
    setOutlineSaving(false);
    return saved;
  }, [outlinePlanDraft, studio]);

  const submit = useCallback(async () => {
    if (generationMode !== "fresh" && !hasCurrentContent) { setNotice("当前正文为空，无法改写或续写。"); return; }
    if (!targetWordsValid) { setNotice(`目标字数请输入 ${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数，或留空表示不限字数。`); return; }
    const effectiveFirstAppearanceIds = includeCharacters ? firstAppearanceCharacterIds : [];
    const appearanceSnapshot = JSON.stringify([...effectiveFirstAppearanceIds].sort());
    const excellentSnapshot = JSON.stringify([...excellentFragmentIds].sort());
    const duplicate = studio.data.tasks.find((task) => task.outlineId === studio.currentOutline.id && task.target === "正文" && task.prompt === prompt.trim() && task.contextOptions?.targetWords === targetWords && (task.contextOptions?.contentMode ?? "fresh") === generationMode && (generationMode !== "rewrite" || normalizeRewriteRetentionLevel(task.contextOptions?.rewriteRetention) === rewriteRetention) && JSON.stringify([...(task.contextOptions?.firstAppearanceCharacterIds ?? [])].sort()) === appearanceSnapshot && task.contextOptions?.includeExcellentFragments === includeExcellentFragments && task.contextOptions?.includeOutlineTitle === includeOutlineTitle && JSON.stringify([...(task.contextOptions?.excellentFragmentIds ?? [])].sort()) === excellentSnapshot && Date.now() - new Date(task.createdAt).getTime() < 3000);
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
        includePrevious,
        includeCharacters,
        includeExcellentFragments,
        includeOutlineTitle,
        excellentFragmentIds,
        estimatedCharacters: summary.total,
        targetWords,
        contentMode: generationMode,
        rewriteRetention: generationMode === "rewrite" ? rewriteRetention : undefined,
        firstAppearanceCharacterIds: effectiveFirstAppearanceIds,
        timeoutMs: selectedRecord?.timeoutMs ?? 600_000,
        promptContext,
        currentPlan: outlinePlanDraft,
        outlineTitleSnapshot: studio.currentOutline.title,
      });
      lastSyncedOutlineRef.current = { id: studio.currentOutline.id, plan: outlinePlanDraft };
      setIncludeOutlineTitle(false);
      setNotice("");
      onTaskCreated();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "AI 任务创建失败");
    }
  }, [prompt, studio, selectedModelReference, selectedRecord, includePrevious, includeCharacters, includeExcellentFragments, includeOutlineTitle, excellentFragmentIds, firstAppearanceCharacterIds, summary.total, targetWords, targetWordsValid, generationMode, rewriteRetention, hasCurrentContent, outlinePlanDraft, onTaskCreated]);

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
        <header className="generate-compact-header">
          <div><span>正文生成</span><h2>{displayTitle}</h2></div>
          <em>正文</em>
        </header>

        <section className="generate-command-card">
          <section className="generate-outline-editor">
            <div className="generate-outline-editor-heading">
              <label htmlFor="generate-outline-plan">大纲内容</label>
              <span>{outlinePlanDraft.length.toLocaleString("zh-CN")} / 10,000</span>
            </div>
            <Textarea
              id="generate-outline-plan"
              aria-label="生成使用的大纲内容"
              className="generate-outline-plan-control"
              classNames={{ input: "generate-outline-plan-input" }}
              maxLength={10000}
              autosize
              minRows={5}
              maxRows={12}
              value={outlinePlanDraft}
              onChange={(event) => { outlinePlanDraftRef.current = event.target.value; setOutlinePlanDraft(event.target.value); }}
            />
            <div className="generate-outline-save-row">
              <span className={`generate-outline-save-state ${outlinePlanDirty ? "unsaved" : "saved"}`}>{outlineSaving ? "正在保存…" : outlinePlanDirty ? "有未保存修改" : "已保存"}</span>
              <Button className="generate-outline-save-button" variant={outlinePlanDirty ? "light" : "subtle"} size="compact-sm" type="button" leftSection={<Icon name="check" />} disabled={!outlinePlanDirty || outlineSaving} loading={outlineSaving} onClick={() => void saveOutlineDraft()}>保存大纲</Button>
            </div>
          </section>
          <section className="generate-mode-section" aria-labelledby="generate-mode-heading">
            <div className="generate-mode-heading"><span id="generate-mode-heading">生成方式</span><small>{contentGenerationModeLabel(generationMode)}</small></div>
            <div className="generate-mode-options" role="radiogroup" aria-label="正文生成方式">
              {contentGenerationModes.map((item) => {
                const disabled = item.value !== "fresh" && !hasCurrentContent;
                return <button className={generationMode === item.value ? "selected" : ""} type="button" role="radio" aria-checked={generationMode === item.value} disabled={disabled} key={item.value} onClick={() => setGenerationMode(item.value)}><span className="ui-title">{item.label}</span><span>{compact ? item.mobileDescription : item.description}</span></button>;
              })}
            </div>
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
              onChange={(value) => setRewriteRetention(rewriteRetentionOptions[value]?.value ?? DEFAULT_REWRITE_RETENTION_LEVEL)}
            />
            <p>{rewriteRetentionOption.description}</p>
            {targetWords !== undefined && Math.abs(targetWords - resolvedOutlineContent(studio.currentOutline).length) > Math.max(500, resolvedOutlineContent(studio.currentOutline).length * .35) && <small className="rewrite-retention-warning">目标字数与原文长度差异较大，实际保留度可能降低。</small>}
          </section>}
          <div className="generate-option-bar">
            <NumberInput className="generate-word-count" label={generationMode === "continue" ? "新增目标字数（可选）" : "目标字数（可选）"} description={compact ? undefined : "留空或 0 表示不限字数"} error={targetWordsValid ? undefined : `${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数`} aria-label={generationMode === "continue" ? "续写新增目标字数" : "正文目标字数"} min={0} max={MAX_GENERATE_TARGET_WORDS} step={100} thousandSeparator="," suffix=" 字" placeholder="不限字数" hideControls={compact} value={targetWordsInput} onChange={(value) => { const next = String(value); setTargetWordsInput(next); const parsed = Number(next); if (next.trim() === "" || parsed === 0) studio.updateSettings({ generateTargetWords: 0 }); else if (Number.isInteger(parsed) && parsed >= MIN_GENERATE_TARGET_WORDS && parsed <= MAX_GENERATE_TARGET_WORDS) studio.updateSettings({ generateTargetWords: parsed }); }} onBlur={() => { const parsed = Number(targetWordsInput); if (targetWordsInput.trim() === "" || parsed === 0) { setTargetWordsInput(""); studio.updateSettings({ generateTargetWords: 0 }); } else if (!Number.isInteger(parsed) || parsed < MIN_GENERATE_TARGET_WORDS || parsed > MAX_GENERATE_TARGET_WORDS) setTargetWordsInput(studio.data.settings.generateTargetWords > 0 ? String(studio.data.settings.generateTargetWords) : ""); }} />
            <Button className="manage-generate-presets" variant="default" size="sm" onClick={() => setPresetManagerOpen(true)}>管理预设</Button>
            <label className="generate-excellent-fragments-toggle">
              <input aria-label="参考优秀片段" type="checkbox" checked={includeExcellentFragments} disabled={availableExcellentFragmentCount === 0} onChange={(event) => setIncludeExcellentFragments(event.currentTarget.checked)} />
              <span><span className="ui-label">参考优秀片段</span><small>{availableExcellentFragmentCount > 0 ? `${availableExcellentFragmentCount} 个可用` : "暂无优秀片段"}</small></span>
            </label>
            <label className="generate-outline-title-toggle">
              <input aria-label="同时生成大纲名" type="checkbox" checked={includeOutlineTitle} onChange={(event) => setIncludeOutlineTitle(event.currentTarget.checked)} />
              <span><span className="ui-label">同时生成大纲名</span><small>{compact ? "按大纲命名设置" : "遵循文章的大纲命名设置"}</small></span>
            </label>
          </div>
          {studio.data.settings.generatePresets.length > 0 && <div className="generate-quick-prompts" aria-label="自定义预设场景">{studio.data.settings.generatePresets.map((item) => <Button variant="light" size="compact-sm" type="button" key={item} onClick={() => setPrompt(item)}>{item}</Button>)}</div>}
          <section className="generate-first-appearance" aria-label="首次出场人物">
            <div className="generate-first-appearance-heading">
              <div><span>人物出场</span><span className="ui-title">首次出场人物</span><small>{compact ? "自动识别，可手动调整" : "根据当前及前序大纲中的姓名、别名推测"}</small></div>
              <Button className="generate-first-appearance-edit" variant="default" size="compact-sm" type="button" onClick={() => setAppearanceEditorOpen(true)}>编辑</Button>
            </div>
            {includeCharacters ? firstAppearanceCharacters.length > 0
              ? <div className="generate-first-appearance-tags">{firstAppearanceCharacters.map((character) => <span key={character.id}>{character.name}</span>)}</div>
              : <p>未推测到首次出场人物，可点击“编辑”手动指定。</p>
              : <p>人物上下文已关闭，本次生成不会发送首次出场信息。</p>}
          </section>
          <div className="generate-prompt-label"><span>补充指令（可选） <small>{prompt.length.toLocaleString("zh-CN")} / 20,000</small></span><Textarea maxLength={20000} autosize minRows={4} maxRows={10} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={generationMode === "rewrite" ? "说明改写方向和需要保留的内容" : generationMode === "continue" ? "说明接下来要发生的情节或节奏" : "补充生成要求"} /></div>
          <div className="generate-submit-row">
            <button className="generate-context-summary" type="button" onClick={() => setContextOpen(true)}><Icon name="book" /><span className="generate-context-copy"><span className="ui-title">{contentGenerationModeLabel(generationMode)} · 上下文 {summary.total.toLocaleString("zh-CN")} 字符</span><small>前面大纲 {summary.previousCount} 条 · 当前正文 {generationMode === "fresh" ? "不发送" : `${summary.content.toLocaleString("zh-CN")} 字符`} · 优秀片段 {summary.excellentFragmentCount} 个 · 人物 {summary.characterCount} 位</small></span><Icon name="chevron" /></button>
            <div className="generate-model-control"><Select label="本次模型" description={compact ? `输入上限 ${(selectedRecord?.maxInputCharacters ?? DEFAULT_MAX_INPUT_CHARACTERS).toLocaleString("zh-CN")} 字符` : `输入上限 ${(selectedRecord?.maxInputCharacters ?? DEFAULT_MAX_INPUT_CHARACTERS).toLocaleString("zh-CN")} 字符；选择后保存为默认模型`} data={modelOptions} value={selectedModelReference} allowDeselect={false} onChange={(value) => selectGenerateModel(value ?? "")} /><small>{selectedModelReference ? selectedRecord?.hasSecret ? "● 可用" : "需要载入密钥" : "● 本地可用"}</small></div>
            <Button className="generate-submit-button" leftSection={<Icon name="spark" />} size="md" type="button" disabled={!targetWordsValid || generationMode !== "fresh" && !hasCurrentContent} onClick={() => void submit()}>开始生成</Button>
          </div>
          <p className="generate-auto-apply-note">{compact ? "成功后自动设为当前正文，并保留为版本。" : "任务成功后会自动设为该大纲的当前正文，并保留在正文版本中。"}</p>
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
            <ContextCard summary={summary} contentMode={generationMode} includePrevious={includePrevious} includeCharacters={includeCharacters} includeExcellentFragments={includeExcellentFragments} onPrevious={setIncludePrevious} onCharacters={setIncludeCharacters} onExcellentFragments={setIncludeExcellentFragments} />
            <div className="context-preview"><span>当前大纲</span><span className="ui-title">{displayTitle}</span><p>{outlinePlanDraft || "尚未填写大纲内容"}</p></div>
          </div>
        </ScrollableDrawer>

        <section className="generate-task-section">
          <div className="generate-results-title"><div><span>任务</span><h3>进行中</h3></div><button type="button" onClick={onOpenTasks}>查看全部 AI 任务 →</button></div>
          {activeTasks.map((task, index) => <article className="generation-card running-card" key={task.id}><div className="generation-state"><span className={`state-dot ${task.state}`} />{task.state === "waiting" ? `等待中 · 队列第 ${index + 1} 位` : "正在生成"}</div><span className="ui-title">{task.prompt || "按大纲生成"}</span><p>{contentGenerationModeLabel(task.contextOptions?.contentMode)}{task.contextOptions?.contentMode === "rewrite" ? ` · 原文保留 ${rewriteRetentionLabel(task.contextOptions.rewriteRetention)}` : ""} · {modelDisplayLabel(models, task.model || "", task.contextOptions?.modelName)} · 目标 {generateTargetWordsLabel(task.contextOptions?.targetWords)} · 上下文约 {task.contextOptions?.estimatedCharacters?.toLocaleString("zh-CN") ?? "—"} 字符{task.contextOptions?.includeOutlineTitle ? " · 同时生成大纲名" : ""}</p><div className="generation-progress"><span /></div><button type="button" onClick={() => { studio.updateTask(task.id, { state: "cancelled" }); studio.updateOutline(task.outlineId, { state: "saved" }); }}>取消任务</button></article>)}
          {!activeTasks.length && latestFailed && <article className="generation-card failed-generation-card"><div className="generation-state"><span className="state-dot failed" />需要处理</div><span className="ui-title">{latestFailed.prompt || "按大纲生成"}</span><p>{latestFailed.error || "生成失败"}</p><div className="candidate-actions"><button type="button" onClick={() => setPrompt(latestFailed.prompt)}>编辑指令</button><button type="button" onClick={() => studio.updateTask(latestFailed.id, { state: "waiting", error: undefined })}>原样重试</button></div></article>}
          {!activeTasks.length && !latestFailed && <div className="generate-empty-row">没有进行中的正文生成任务。</div>}
        </section>

        {notice && <div className="generate-inline-notice" role="status"><Icon name="check" />{notice}</div>}
      </div>
      {presetManagerOpen && <GeneratePresetDialog presets={studio.data.settings.generatePresets} onClose={() => setPresetManagerOpen(false)} onSave={(presets) => { studio.updateSettings({ generatePresets: presets }); setPresetManagerOpen(false); }} />}
      {appearanceEditorOpen && <FirstAppearanceDialog
        characters={activeCharacters}
        suggestions={appearanceSuggestions}
        selectedIds={firstAppearanceCharacterIds}
        overrides={appearanceOverrides}
        onChange={(characterId, firstAppearance) => setAppearanceOverrides((current) => ({ ...current, [characterId]: firstAppearance }))}
        onReset={() => setAppearanceOverrides({})}
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
  const isSubmitting = Boolean(submittingTaskId);
  const chatBusy = isStreaming || isSubmitting;
  const chatProgressLabel = isSubmitting ? "正在提交" : streaming ? "正在回复" : activeChatTask?.phase === "connecting" ? "正在连接" : "正在回复";
  const chatProgressText = streaming || (isSubmitting ? "正在保存消息并创建任务…" : activeChatTask?.phase === "connecting" ? "正在连接模型…" : "正在思考…");
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
    const response = await fetch(`/api/outlines/${encodeURIComponent(outline.id)}/chat/transactions`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finalize", taskId: stream.taskId, sessionId: stream.sessionId, status, result: stream.result, error, stopped, chatbotName, messageId: clientId("message-assistant") }),
    });
    const payload = await response.json() as { revision?: number; task?: Partial<AiTask>; message?: Message; sessionUpdatedAt?: string; error?: string };
    if (!response.ok || payload.revision === undefined || !payload.task) throw new Error(payload.error || "聊天结果保存失败");
    applyChatTransaction({ revision: payload.revision, task: payload.task, message: payload.message, sessionUpdatedAt: payload.sessionUpdatedAt }, stream.taskId, stream.sessionId);
    setLocalStreaming((current) => current?.taskId === stream.taskId ? null : current);
  }

  function stopStream(stream: ChatStreamState, stopped = true) {
    if (stream.finalized) return;
    stream.finalized = true;
    stream.controller.abort();
    releaseActiveChatStream(stream.taskId, stream.controller);
    if (currentStream.current === stream) currentStream.current = null;
    if (submissionLock.current === stream.submissionToken) {
      submissionLock.current = "";
      setSubmittingTaskId("");
    }
    void finalizeChat(stream, "cancelled", stopped ? "用户停止了聊天回复" : "", stopped).catch((reason) => onNotice(reason instanceof Error ? reason.message : "聊天停止状态保存失败"));
  }
  function cancelCurrentChatTask() {
    if (!activeChatTask || cancelActiveChatStream(activeChatTask.id)) return;
    const stream: ChatStreamState = { taskId: activeChatTask.id, sessionId: activeChatTask.contextOptions?.sessionId ?? session?.id ?? "", submissionToken: "", controller: new AbortController(), result: activeChatTask.resultText ?? "", finalized: true };
    void finalizeChat(stream, "cancelled", "用户停止了聊天回复", true).catch((reason) => onNotice(reason instanceof Error ? reason.message : "聊天停止状态保存失败"));
  }

  async function requestAnswer(question: string, addUser: boolean, targetSessionId = session?.id, targetSession = session) {
    if (!targetSessionId || !targetSession || isStreaming || submissionLock.current || currentStream.current) return;
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
      const submitResponse = await fetch(`/api/outlines/${encodeURIComponent(outline.id)}/chat/transactions`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": taskId },
        body: JSON.stringify({ action: "submit", taskId, sessionId: targetSessionId, sessionTitle: submittedTitle, message: question, messages: submittedMessages, model: chatModelReference, includePrevious: targetSession.includePrevious, includeCharacters: targetSession.includeCharacters, estimatedCharacters: summarizeAiContext(promptContext, question).total, timeoutMs: chatModelRecord?.timeoutMs ?? 600_000, promptContext }),
      });
      const submitted = await submitResponse.json() as { revision?: number; task?: AiTask; messages?: Message[]; sessionTitle?: string; sessionUpdatedAt?: string; error?: string };
      if (!submitResponse.ok || submitted.revision === undefined || !submitted.task || !submitted.messages) throw new Error(submitted.error || "消息提交失败");
      applyChatTransaction({ revision: submitted.revision, task: submitted.task, messages: submitted.messages, sessionTitle: submitted.sessionTitle, sessionUpdatedAt: submitted.sessionUpdatedAt }, taskId, targetSessionId);
      releaseSubmission();
      const controller = new AbortController();
      const stream: ChatStreamState = { taskId, sessionId: targetSessionId, submissionToken, controller, result: "", finalized: false };
      currentStream.current = stream;
      registerActiveChatStream(taskId, { controller, cancel: () => stopStream(stream, true) });
      try {
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/outlines/${encodeURIComponent(outline.id)}/chat/stream`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "Idempotency-Key": taskId }, body: JSON.stringify({ requestId: taskId, message: question, sessionId: targetSessionId, model: chatModelReference, includePrevious: targetSession.includePrevious, includeCharacters: targetSession.includeCharacters, context: promptContext }) });
        if (!response.ok || !response.body) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error || `${chatbotName} 失败（${response.status}）`); }
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
        if (!controller.signal.aborted) {
          stream.finalized = true;
          const errorMessage = error instanceof Error ? error.message : "请求失败";
          await finalizeChat(stream, "failed", errorMessage);
        }
      } finally {
        releaseActiveChatStream(taskId, controller);
        if (currentStream.current === stream) currentStream.current = null;
        stream.finalized = true;
      }
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : "AI Chat 提交失败");
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
        {contextOpen && <div className="chat-context-panel" role="dialog" aria-label="AI Chat 上下文"><header><div><span className="ui-title">本次上下文</span><span>{contextCharacters.toLocaleString("zh-CN")} 字符</span></div><IconButton name="close" label="关闭上下文" onClick={() => setContextOpen(false)} /></header><div className="chat-context-fixed"><p><Icon name="check" /><span>文章信息</span><small>{studio.currentArticle.title}</small></p><p><Icon name="check" /><span>当前章节</span><small>{studio.currentChapter.title}</small></p><p><Icon name="check" /><span>当前大纲与正文</span><small>{outlineTitle}</small></p><p><Icon name="check" /><span>最近消息</span><small>{Math.min(20, session.messages.length)} 条</small></p></div><label><input type="checkbox" checked={session.includePrevious} onChange={(event) => studio.setChatSetting(outline.id, "includePrevious", event.target.checked)} /><span>前面全部大纲</span><small>{previous.length} 条</small></label>{session.includePrevious && previous.length > 0 && <div className="chat-context-sources">{previous.map((item) => <span key={item.id}>{outlineDisplayTitle(item)}</span>)}</div>}<label><input type="checkbox" checked={session.includeCharacters} onChange={(event) => studio.setChatSetting(outline.id, "includeCharacters", event.target.checked)} /><span>相关人物</span><small>{matchedCharacters.length} 位</small></label>{session.includeCharacters && matchedCharacters.length > 0 && <div className="chat-context-sources">{matchedCharacters.map((item) => <span key={item.id}>{item.name}</span>)}</div>}</div>}
        <div className="chat-composer">
          <textarea ref={composerRef} rows={1} maxLength={20000} value={message} disabled={Boolean(editingMessage)} onChange={(event) => { studio.setChatDraft(outline.id, event.target.value); resizeComposer(event.currentTarget); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={editingMessage ? "正在编辑上方消息" : "输入消息"} aria-label="AI Chat 消息" />
          <div className="composer-actions"><div className="composer-left-actions"><IconButton name="plus" label="添加参考或快捷指令" title="添加" className="composer-icon-button" aria-haspopup="menu" aria-expanded={toolsOpen} disabled={Boolean(editingMessage)} onClick={() => { setToolsOpen((value) => !value); setContextOpen(false); }} /><button className={`composer-context-chip ${contextOpen ? "active" : ""}`} type="button" disabled={Boolean(editingMessage)} aria-expanded={contextOpen} onClick={() => { setContextOpen((value) => !value); setToolsOpen(false); }}><Icon name="context" /><span>上下文 {contextCharacters.toLocaleString("zh-CN")}</span></button><label className="composer-model-chip"><Icon name="spark" /><select aria-label="聊天模型" disabled={Boolean(editingMessage)} value={chatModelReference} onChange={(event) => { studio.updateSettings({ chatModel: event.target.value }); void studio.saveNow(); }}><option value="">本地 PoC 引擎</option>{chatModelReference && !chatModelRecord && <option value={chatModelReference}>{chatModelReference}</option>}{models.map((model) => <option key={model.id} value={model.id}>{modelDisplayLabel(models, model.id)}</option>)}</select></label></div>{chatBusy ? <button className="composer-send stop" type="button" onClick={cancelCurrentChatTask} aria-label="停止回复"><Icon name="stop" /></button> : <button className="composer-send" type="button" onClick={() => void send()} disabled={!message.trim() || Boolean(editingMessage) || chatBusy} aria-label="发送消息"><Icon name="send" /></button>}</div>
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
  const chapter = studio.currentChapter;
  const outlines = chapter.outlines.filter((item) => studio.data.settings.showArchived || !item.archived);
  const totalWords = outlines.reduce((total, item) => total + wordCount(resolvedOutlineContent(item)), 0);
  return <div className="page-scroll"><div className="reader-page">
      <PageHeader eyebrow={studio.currentArticle.title} title={chapter.title} description={`${outlines.length} 条大纲 · ${totalWords} 字`} actions={<button className="primary-compact" type="button" onClick={() => { const id = studio.createOutline(chapter.id); onOutline(id); }}><Icon name="plus" />新建大纲</button>} />
      <div className="reader-divider" />
      {outlines.map((item, index) => <ReaderSection key={item.id} number={String(index + 1).padStart(2, "0")} title={outlineDisplayTitle(item)} onClick={() => onOutline(item.id)}>{resolvedOutlineContent(item).split("\n\n").filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</ReaderSection>)}
      {!outlines.length && <div className="empty-inline">本章节还没有大纲。</div>}
    </div></div>;
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
  const itemRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);
  const suppressClick = useRef(false);

  useEffect(() => {
    const item = itemRef.current;
    if (!item) return;
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || (event.target as Element | null)?.closest(".name-version-delete")) return;
      const touch = event.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      tracking.current = true;
      suppressClick.current = false;
    };
    const touchMove = (event: TouchEvent) => {
      if (!tracking.current || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - startX.current;
      const deltaY = touch.clientY - startY.current;
      if (Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY)) event.preventDefault();
    };
    const touchEnd = (event: TouchEvent) => {
      if (!tracking.current) return;
      tracking.current = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - startX.current;
      const deltaY = touch.clientY - startY.current;
      if (Math.abs(deltaX) > 46 && Math.abs(deltaX) > Math.abs(deltaY)) {
        suppressClick.current = true;
        onReveal(deltaX < 0);
        window.setTimeout(() => { suppressClick.current = false; }, 180);
      }
    };
    const touchCancel = () => { tracking.current = false; };
    item.addEventListener("touchstart", touchStart, { passive: true });
    item.addEventListener("touchmove", touchMove, { passive: false });
    item.addEventListener("touchend", touchEnd, { passive: true });
    item.addEventListener("touchcancel", touchCancel, { passive: true });
    return () => {
      item.removeEventListener("touchstart", touchStart);
      item.removeEventListener("touchmove", touchMove);
      item.removeEventListener("touchend", touchEnd);
      item.removeEventListener("touchcancel", touchCancel);
    };
  }, [onReveal]);

  return <div
    ref={itemRef}
    className={`name-version-item ${revealed ? "revealed" : ""} ${deleteDisabled ? "delete-disabled" : ""}`}
    onClickCapture={(event) => {
      if (!suppressClick.current) return;
      event.preventDefault();
      event.stopPropagation();
    }}
  >
    <div className="name-version-delete" aria-hidden={compact && !revealed}>
      <button
        type="button"
        disabled={deleteDisabled}
        tabIndex={compact && !revealed ? -1 : undefined}
        aria-label={`删除${label}「${version.title}」`}
        title={deleteDisabled ? "章节至少需要保留一个名称" : `删除${label}`}
        onPointerDown={(event) => { event.stopPropagation(); suppressClick.current = false; }}
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

function FullChapterEditor({ onNotice, onTaskCreated }: { onNotice: (message: string) => void; onTaskCreated: () => void }) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const article = studio.currentArticle;
  const chapters = article.chapters.filter((chapter) => studio.data.settings.showArchived || !chapter.archived);
  const visibleOutlines = (chapter: Chapter) => chapter.outlines.filter((outline) => studio.data.settings.showArchived || !outline.archived);
  const eligibleOutlines = (chapter: Chapter) => chapter.outlines.filter((outline) => !outline.archived && outline.plan.trim());
  const eligibleChapters = chapters.filter((chapter) => !chapter.archived && eligibleOutlines(chapter).length);
  const outlineCount = chapters.reduce((total, chapter) => total + visibleOutlines(chapter).length, 0);
  const candidateCount = chapters.reduce((total, chapter) => {
    const chapterState = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
    return total + chapterState.nameVersions.filter((version) => version.source === "ai" && version.id !== chapterState.defaultNameVersionId).length
      + visibleOutlines(chapter).reduce((outlineTotal, outline) => {
        const state = normalizeNameVersionState(outline.id, outline.title, outline.nameVersions, outline.defaultNameVersionId, outline.updatedAt, 80);
        return outlineTotal + state.nameVersions.filter((version) => version.source === "ai" && version.id !== state.defaultNameVersionId).length;
      }, 0);
  }, 0);
  const settings = studio.data.settings;
  const namingSelection = settings.namingModelMode === "inherit" ? "__inherit__" : settings.namingModel ? canonicalModelReference(models, settings.namingModel) : "__local__";
  const inheritedReference = canonicalModelReference(models, settings.generateModel);
  const fixedReference = canonicalModelReference(models, settings.namingModel);
  const selectedModelReference = settings.namingModelMode === "inherit" ? inheritedReference : fixedReference;
  const selectedRecord = configuredModelForReference(models, selectedModelReference);
  const missingSecret = Boolean(selectedRecord && !selectedRecord.hasSecret);
  const activeAllTask = studio.data.tasks.find((task) => task.articleId === article.id && task.target === "全部名称" && (task.state === "waiting" || task.state === "running"));
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const modelData = [
    { value: "__inherit__", label: `继承 AI Generate（${modelDisplayLabel(models, inheritedReference)}）` },
    { value: "__local__", label: "本地 PoC 引擎" },
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

  async function requestNames(chapter: Chapter, body: Record<string, unknown>) {
    const response = await fetch("/api/ai/names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articleId: article.id,
        chapterId: chapter.id,
        chapterNaming: article.chapterNaming,
        outlineNaming: article.outlineNaming,
        model: selectedModelReference,
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

  async function storeCandidates(chapter: Chapter, payload: NameGeneratePreview) {
    if (payload.revision === undefined || payload.added === undefined) throw new Error("名称已经生成，但服务端没有返回保存结果");
    const outlineStates = new Map((payload.outlineStates ?? []).map((item) => [item.id, item]));
    studio.acceptServerMutation(payload.revision, (current) => ({
      ...current,
      articles: current.articles.map((item) => item.id !== article.id ? item : ({
        ...item,
        updatedAt: payload.articleUpdatedAt ?? item.updatedAt,
        chapters: item.chapters.map((candidate) => candidate.id !== chapter.id ? candidate : ({
          ...candidate,
          ...(payload.chapterState ?? {}),
          outlines: candidate.outlines.map((outline) => {
            const state = outlineStates.get(outline.id);
            return state ? { ...outline, ...state } : outline;
          }),
        })),
      })),
    }));
    return payload.added;
  }

  async function generateChapterName(chapter: Chapter) {
    if (!eligibleOutlines(chapter).length) { setError(`「${chapter.title}」没有可供参考的大纲内容`); return; }
    if (missingSecret) { setError("所选模型还没有载入 API 密钥"); return; }
    setBusy(`chapter:${chapter.id}`); setError("");
    try {
      const payload = await requestNames(chapter, { target: "chapter", includeChapter: true, outlineIds: [] });
      const added = await storeCandidates(chapter, payload);
      onNotice(added ? `已为「${chapter.title}」添加章节名候选` : "生成名称与已有版本相同");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "章节名生成失败"); }
    finally { setBusy(""); }
  }

  async function generateOutlineName(chapter: Chapter, outline: Outline) {
    if (!outline.plan.trim()) { setError(`「${outlineDisplayTitle(outline)}」的大纲内容为空`); return; }
    if (missingSecret) { setError("所选模型还没有载入 API 密钥"); return; }
    setBusy(`outline:${outline.id}`); setError("");
    try {
      const payload = await requestNames(chapter, { target: "outline", outlineId: outline.id });
      const added = await storeCandidates(chapter, payload);
      onNotice(added ? `已为「${outlineDisplayTitle(outline)}」添加大纲名候选` : "生成名称与已有版本相同");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "大纲名生成失败"); }
    finally { setBusy(""); }
  }

  async function generateAll() {
    if (!eligibleChapters.length) { setError("没有可生成名称的章节；请先填写大纲内容"); return; }
    if (missingSecret) { setError("所选模型还没有载入 API 密钥"); return; }
    if (activeAllTask) { onTaskCreated(); return; }
    const anchorChapter = eligibleChapters[0];
    const anchorOutline = eligibleOutlines(anchorChapter)[0];
    const eligibleOutlineCount = eligibleChapters.reduce((total, chapter) => total + eligibleOutlines(chapter).length, 0);
    const estimatedCharacters = article.summary.length + article.type.length + article.style.length + eligibleChapters.reduce((total, chapter) => total + eligibleOutlines(chapter).reduce((sum, outline) => sum + outline.plan.length, 0), 0);
    try {
      await createServerTask(studio, {
        articleId: article.id,
        chapterId: anchorChapter.id,
        outlineId: anchorOutline.id,
        target: "all-names",
        instruction: instruction.trim(),
        model: selectedModelReference,
        includePrevious: false,
        includeCharacters: false,
        estimatedCharacters,
        chapterNaming: article.chapterNaming,
        outlineNaming: article.outlineNaming,
        timeoutMs: selectedRecord?.timeoutMs ?? 600_000,
        namingContext: namingArticleContext(article),
      });
      setError("");
      onNotice(`已创建后台任务，将用一次模型请求生成 ${eligibleChapters.length} 个章节和 ${eligibleOutlineCount} 个大纲的名称`);
      onTaskCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "后台名称任务创建失败");
    }
  }

  async function selectDefault(kind: "chapter" | "outline", entityId: string, versionId: string, chapter?: Chapter) {
    if (kind === "outline" && chapter) {
      const target = chapter.outlines.find((outline) => outline.id === entityId);
      const targetState = target ? normalizeNameVersionState(target.id, target.title, target.nameVersions, target.defaultNameVersionId, target.updatedAt, 80) : null;
      const selected = targetState?.nameVersions.find((version) => version.id === versionId);
      const duplicate = selected && chapter.outlines.some((outline) => outline.id !== entityId && normalizeOutlineTitle(outline.title) === selected.title);
      if (duplicate) { setError(`同一章节内已经使用大纲名「${selected.title}」`); return; }
    }
    studio.setDefaultNameVersion(kind, entityId, versionId);
    setError("");
    const saved = await studio.saveNow();
    onNotice(saved ? `已更新默认${kind === "chapter" ? "章节名" : "大纲名"}` : "默认名称已更新，但保存尚未完成");
  }

  async function addManual(kind: "chapter" | "outline", entityId: string, title: string, chapter?: Chapter) {
    if (kind === "outline" && chapter && chapter.outlines.some((outline) => outline.id !== entityId && normalizeOutlineTitle(outline.title) === title.trim())) {
      setError(`同一章节内已经使用大纲名「${title.trim()}」`);
      return;
    }
    const versionId = studio.addManualNameVersion(kind, entityId, title, true);
    if (!versionId) { setError("名称不能为空"); return; }
    setError("");
    const saved = await studio.saveNow();
    onNotice(saved ? `已添加手动名称并设为默认` : "名称已更新，但保存尚未完成");
  }

  async function deleteName(kind: "chapter" | "outline", entityId: string, versionId: string) {
    const deleted = studio.deleteNameVersion(kind, entityId, versionId);
    if (!deleted) { setError("章节至少需要保留一个名称；请先添加其他名称再删除"); return; }
    setError("");
    const saved = await studio.saveNow();
    onNotice(saved ? `已删除${kind === "chapter" ? "章节名" : "大纲名"}` : "名称已删除，但保存尚未完成");
  }

  return <div className="page-scroll"><div className="full-chapter-editor">
    <PageHeader eyebrow="全章节编辑" title={article.title} description={`${chapters.length} 章 · ${outlineCount} 条大纲 · ${candidateCount} 个待选 AI 名称`} actions={<Button leftSection={<Icon name="spark" />} loading={activeAllTask?.state === "running"} disabled={Boolean(busy) || Boolean(activeAllTask) || missingSecret || !eligibleChapters.length} onClick={() => void generateAll()}>{activeAllTask ? "全部名称后台生成中" : "生成全部章节名和大纲名"}</Button>} />
    <section className="full-chapter-generation-bar" aria-label="名称生成设置">
      <Select label="名称生成模型" data={modelData} value={namingSelection} allowDeselect={false} disabled={Boolean(busy) || Boolean(activeAllTask)} onChange={selectNamingModel} />
      <Textarea label="补充命名要求（可选）" maxLength={20_000} autosize minRows={2} maxRows={5} value={instruction} disabled={Boolean(busy) || Boolean(activeAllTask)} placeholder="例如：避免剧透，保持海洋意象" onChange={(event) => setInstruction(event.currentTarget.value)} />
      <p>生成全部会创建一个后台任务，并在一次模型请求中返回整篇名称；AI 结果只会添加为候选版本。</p>
    </section>
    {activeAllTask && <Alert color="studio" role="status">全部名称正在后台{activeAllTask.state === "waiting" ? "排队" : "生成"}，可以离开本页面；完成后候选名称会自动出现在这里。</Alert>}
    {error && <Alert color="red" role="alert">{error}</Alert>}
    <div className="full-chapter-list">
      {chapters.map((chapter, chapterIndex) => {
        const chapterState = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
        const outlines = visibleOutlines(chapter);
        return <section className="full-chapter-card" key={chapter.id}>
          <header className="full-chapter-name-row">
            <span className="full-chapter-index">{String(chapterIndex + 1).padStart(2, "0")}</span>
            <div className="full-chapter-name-main"><span className="name-kind-label">章节名</span><NameVersionChooser kind="chapter" entityId={chapter.id} title={chapter.title} versions={chapterState.nameVersions} defaultVersionId={chapterState.defaultNameVersionId} onSelect={(versionId) => void selectDefault("chapter", chapter.id, versionId)} onAdd={(title) => void addManual("chapter", chapter.id, title)} onDelete={(versionId) => void deleteName("chapter", chapter.id, versionId)} /></div>
            <Button variant="light" size="xs" leftSection={<Icon name="spark" />} loading={busy === `chapter:${chapter.id}`} disabled={Boolean(busy) || Boolean(activeAllTask) || !eligibleOutlines(chapter).length} onClick={() => void generateChapterName(chapter)}>生成章节名</Button>
          </header>
          <div className="full-outline-name-list">
            {outlines.map((outline, outlineIndex) => {
              const state = normalizeNameVersionState(outline.id, outline.title, outline.nameVersions, outline.defaultNameVersionId, outline.updatedAt, 80);
              return <article className="full-outline-name-row" key={outline.id}>
                <span className="full-outline-index">{String(outlineIndex + 1).padStart(2, "0")}</span>
                <div className="full-outline-name-main"><span className="name-kind-label">大纲名</span><NameVersionChooser kind="outline" entityId={outline.id} title={outlineDisplayTitle(outline)} versions={state.nameVersions} defaultVersionId={state.defaultNameVersionId} onSelect={(versionId) => void selectDefault("outline", outline.id, versionId, chapter)} onAdd={(title) => void addManual("outline", outline.id, title, chapter)} onDelete={(versionId) => void deleteName("outline", outline.id, versionId)} /></div>
                <Button variant="default" size="xs" leftSection={<Icon name="spark" />} loading={busy === `outline:${outline.id}`} disabled={Boolean(busy) || Boolean(activeAllTask) || !outline.plan.trim()} onClick={() => void generateOutlineName(chapter, outline)}>生成大纲名</Button>
              </article>;
            })}
            {!outlines.length && <div className="name-version-empty">本章节还没有大纲。</div>}
          </div>
        </section>;
      })}
    </div>
  </div></div>;
}

function ReaderSection({ number, title, children, onClick }: { number: string; title: string; children: React.ReactNode; onClick: () => void }) {
  return <section className="reader-section"><button className="reader-title" type="button" onClick={onClick}><span>{number}</span><h2>{title}</h2><span>打开大纲 →</span></button><div className="reader-copy">{children}</div></section>;
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
    node.style.height = "0px";
    node.style.height = `${Math.max(node.scrollHeight, 34)}px`;
  }, []);
  useEffect(() => { resize(ref.current); }, [value, resize]);
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

function ContinuousChapterHeading({ chapterId, index, title }: { chapterId: string; index: number; title: string }) {
  const { isOver, setNodeRef } = useDroppable({ id: `continuous-chapter:${chapterId}`, data: { type: "chapter", chapterId } });
  return <header ref={setNodeRef} className={`continuous-chapter-heading ${isOver ? "chapter-drop-active" : ""}`}><span>第 {index + 1} 章</span><h2>{title}</h2></header>;
}

function ContinuousEmptyChapter({ chapterId }: { chapterId: string }) {
  const { isOver, setNodeRef } = useDroppable({ id: `continuous-empty:${chapterId}`, data: { type: "chapter", chapterId } });
  return <div ref={setNodeRef} className={`continuous-empty-chapter ${isOver ? "chapter-drop-active" : ""}`} aria-label="将大纲移动到此章节" />;
}

function ContinuousOutlineBlock({ item, number, mode, text, selectedVersionId, dropPlacement, contentStyle, onActivate, onAdd, onDelete, onArchive, onTitle, onText, onContentFocus, onContentBlur, onSelectVersion, onSetCurrentVersion, onSetDefaultVersion, onMoveUp, onMoveDown, onMoveChapter, onOpenChat }: {
  item: Outline;
  number: number;
  mode: "outline" | "content";
  text: string;
  selectedVersionId?: string;
  dropPlacement?: OutlineDropPlacement;
  contentStyle?: CSSProperties;
  onActivate: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onTitle: (value: string) => void;
  onText: (value: string) => void;
  onContentFocus?: () => void;
  onContentBlur?: () => void | Promise<unknown>;
  onSelectVersion?: (versionId?: string) => void | Promise<void>;
  onSetCurrentVersion?: (versionId: string) => void;
  onSetDefaultVersion?: (versionId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveChapter: () => void;
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
    className={`continuous-outline-block ${mode === "outline" ? "has-outline-actions" : ""} ${isDragging ? "dragging" : ""} ${dropPlacement ? `drop-${dropPlacement}` : ""}`}
    style={{ transform: CSS.Transform.toString(transform), transition }}
    onFocusCapture={onActivate}
    onPointerDownCapture={onActivate}
  >
    <div className="continuous-outline-gutter">
      <span>{String(number).padStart(2, "0")}</span>
      <button ref={setActivatorNodeRef} className="continuous-drag-handle" type="button" {...attributes} {...listeners} aria-label={`拖动排序：${displayTitle}`} title="拖动调整顺序"><i aria-hidden="true" /></button>
      {mode === "outline" && <div className="continuous-outline-inline-actions">
        <button type="button" aria-label={`在“${displayTitle}”下方新建大纲`} title="在下方新建空白大纲" onClick={onAdd}>+</button>
        <button className="delete" type="button" aria-label={`删除大纲：${displayTitle}`} title="删除大纲" onClick={() => {
          const hasBody = Boolean(item.content.trim() || resolvedOutlineContent(item).trim() || item.versions.some((version) => version.content.trim()));
          const message = hasBody
            ? `「${displayTitle}」已有正文。删除后正文、正文版本和 AI Chat 都会一并删除，且无法撤销。确认删除？`
            : `删除大纲「${displayTitle}」？此操作无法撤销。`;
          if (window.confirm(message)) onDelete?.();
        }}>-</button>
        <button type="button" aria-label={`${item.archived ? "恢复" : "归档"}大纲：${displayTitle}`} title={item.archived ? "恢复大纲" : "归档大纲"} onClick={onArchive}>=</button>
      </div>}
    </div>
    <Menu position="bottom-end" shadow="md" width={150}>
      <Menu.Target><IconButton name="more" label={`${displayTitle}排序操作`} className="continuous-outline-more" /></Menu.Target>
      <Menu.Dropdown>
        {mode === "outline" && onOpenChat && <Menu.Item leftSection={<Icon name="chat" />} onClick={onOpenChat}>AI Chat</Menu.Item>}
        <Menu.Item disabled={!onMoveUp} onClick={onMoveUp}>上移一位</Menu.Item>
        <Menu.Item disabled={!onMoveDown} onClick={onMoveDown}>下移一位</Menu.Item>
        <Menu.Item onClick={onMoveChapter}>移动到章节</Menu.Item>
      </Menu.Dropdown>
    </Menu>
    {mode === "outline" ? <input className="continuous-outline-title-input" value={normalizeOutlineTitle(item.title)} placeholder={displayTitle} maxLength={80} aria-label={`大纲标题：${displayTitle}`} onChange={(event) => onTitle(event.target.value)} /> : <div className="continuous-content-heading">
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

function AiReviewDialog({ chapters, models, presets, initialModel, onClose, onSavePresets, onSetDefaultModel, onRun }: {
  chapters: Chapter[];
  models: ConfiguredModel[];
  presets: string[];
  initialModel: string;
  onClose: () => void;
  onSavePresets: (presets: string[]) => void;
  onSetDefaultModel: (modelId: string) => void;
  onRun: (input: { chapterId: string; model: string; requirements: string[]; additionalRequirement: string }) => Promise<void>;
}) {
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const availableChapters = chapters.filter((chapter) => !chapter.archived && chapter.outlines.some((outline) => !outline.archived && resolvedOutlineContent(outline).trim()));
  const preferredModel = canonicalModelReference(models, initialModel) || models[0]?.id || "";
  const [chapterId, setChapterId] = useState(availableChapters[0]?.id ?? "");
  const model = preferredModel;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [additionalRequirement, setAdditionalRequirement] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  function togglePreset(value: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(value); else next.delete(value);
      return next;
    });
  }

  function saveAdditionalAsPreset() {
    const value = additionalRequirement.trim().slice(0, MAX_REVIEW_PRESET_CHARACTERS);
    if (!value) return;
    onSavePresets(normalizeReviewPresets([...presets, value]));
    setSelected((current) => new Set(current).add(value));
    setAdditionalRequirement("");
  }

  async function submit() {
    if (!chapterId || !model || running) return;
    onSetDefaultModel(model);
    setRunning(true);
    setError("");
    try {
      await onRun({ chapterId, model, requirements: presets.filter((item) => selected.has(item)), additionalRequirement: additionalRequirement.trim() });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI Review 失败");
    } finally {
      setRunning(false);
    }
  }

  return <ResponsiveModal
    opened
    onClose={running ? () => undefined : onClose}
    closeButtonProps={{ "aria-label": "关闭 AI Review" }}
    title="AI Review"
    centered
    fullScreen={compact}
    size="lg"
    classNames={{ content: "ai-review-dialog ws-modal-content", header: "ws-modal-header", body: "ai-review-dialog-body" }}
    overlayProps={{ backgroundOpacity: 0.46, blur: 3 }}
  >
    <Stack gap="md">
      <div className="ai-review-basics">
        <Select label="Review 章节" value={chapterId} onChange={(value) => setChapterId(value ?? "")} data={availableChapters.map((chapter) => ({ value: chapter.id, label: chapter.title }))} disabled={running} />
        <Select label="模型" description="选择后自动保存为 AI Review 默认模型" value={model} onChange={(value) => onSetDefaultModel(value ?? "")} data={models.map((item) => ({ value: item.id, label: `${modelDisplayLabel(models, item.id)}${item.hasSecret ? "" : "（需密钥）"}` }))} disabled={running} />
      </div>
      <section className="ai-review-builtins">
        <Text fw={650} size="sm">固定检查</Text>
        {BUILTIN_REVIEW_REQUIREMENTS.map((item) => <div key={item}><Icon name="check" /><span>{item}</span></div>)}
      </section>
      <section className="ai-review-presets">
        <Group justify="space-between"><Text fw={650} size="sm">预定义 Review 要求</Text><Text c="dimmed" size="xs">可多选</Text></Group>
        {presets.length ? <Stack gap={6}>{presets.map((item) => <div className="ai-review-preset-row" key={item}>
          <Checkbox checked={selected.has(item)} onChange={(event) => togglePreset(item, event.currentTarget.checked)} label={item} disabled={running} />
          <Button variant="subtle" color="red" size="compact-xs" type="button" disabled={running} onClick={() => { togglePreset(item, false); onSavePresets(presets.filter((preset) => preset !== item)); }}>删除</Button>
        </div>)}</Stack> : <Text c="dimmed" size="sm">尚未保存预定义要求。</Text>}
      </section>
      <div>
        <Textarea label="本次附加要求" description="只用于本次 Review；也可以保存后供以后多选。" minRows={4} maxRows={8} autosize maxLength={20_000} value={additionalRequirement} onChange={(event) => setAdditionalRequirement(event.currentTarget.value)} disabled={running} />
        <Button mt="xs" variant="default" size="sm" type="button" disabled={!additionalRequirement.trim() || presets.length >= MAX_REVIEW_PRESETS || running} onClick={saveAdditionalAsPreset}>保存为预定义要求</Button>
      </div>
      {error && <Alert color="red">{error}</Alert>}
      {!models.length && <Alert color="yellow">请先在模型设置中添加并配置一个支持结构化 JSON 输出的模型。</Alert>}
      <Group justify="flex-end">
        <Button variant="default" type="button" disabled={running} onClick={onClose}>取消</Button>
        <Button leftSection={<Icon name="review" />} loading={running} disabled={!chapterId || !model || !models.length} onClick={() => void submit()}>开始 AI Review</Button>
      </Group>
    </Stack>
  </ResponsiveModal>;
}

function ContinuousDocumentEditor({ mode, positionMemory, onNotice }: { mode: "outline" | "content"; positionMemory: ContinuousDocumentPositionMemory; onNotice: (message: string) => void }) {
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
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => { contentDraftsRef.current = contentDrafts; }, [contentDrafts]);
  useEffect(() => { studioRef.current = studio; }, [studio]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const remembered = initialPositionRef.current;
    const outlineId = remembered?.outlineId === initialOutlineIdRef.current ? remembered.outlineId : initialOutlineIdRef.current;
    const defaultOffset = Math.min(160, Math.max(32, container.clientHeight * .18));
    const offsetTop = remembered?.outlineId === outlineId ? remembered.offsetTop : defaultOffset;
    const restore = () => {
      const target = Array.from(container.querySelectorAll<HTMLElement>("[data-continuous-outline-id]"))
        .find((element) => element.dataset.continuousOutlineId === outlineId);
      if (!target) return;
      const currentOffset = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop = Math.max(0, container.scrollTop + currentOffset - offsetTop);
    };
    restore();
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      restore();
      secondFrame = window.requestAnimationFrame(restore);
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [positionKey]);

  useLayoutEffect(() => () => {
    const container = scrollRef.current;
    if (!container) return;
    const outlineId = activeOutlineIdRef.current;
    const target = Array.from(container.querySelectorAll<HTMLElement>("[data-continuous-outline-id]"))
      .find((element) => element.dataset.continuousOutlineId === outlineId);
    if (!target) return;
    positionMemory.current[positionKey] = {
      outlineId,
      offsetTop: target.getBoundingClientRect().top - container.getBoundingClientRect().top,
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
    selectAdjacentOutline(item.id);
    studio.deleteOutline(item.id);
    onNotice(`已删除「${outlineDisplayTitle(item)}」`);
  }

  function toggleOutlineArchive(item: Outline) {
    if (!item.archived && !studio.data.settings.showArchived) selectAdjacentOutline(item.id);
    studio.updateOutline(item.id, { archived: !item.archived });
    onNotice(item.archived ? `已恢复「${outlineDisplayTitle(item)}」` : `已归档「${outlineDisplayTitle(item)}」`);
  }

  async function runReview(input: { chapterId: string; model: string; requirements: string[]; additionalRequirement: string }) {
    const chapter = studio.currentArticle.chapters.find((item) => item.id === input.chapterId);
    if (!chapter) throw new Error("Review 章节不存在");
    const sourceOutlines = chapter.outlines.filter((item) => !item.archived).map((item) => ({
      id: item.id,
      title: item.title,
      plan: item.plan,
      name: resolvedOutlineContentName(item),
      text: contentDraftsRef.current[item.id] ?? resolvedOutlineContent(item),
      baseText: resolvedOutlineContent(item),
      sourceVersionId: editSourceVersionIdsRef.current[item.id],
    })).filter((item) => item.text.trim());
    const response = await fetch("/api/ai/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId: studio.currentArticle.id, ...input, source: {
        article: {
          id: studio.currentArticle.id,
          title: studio.currentArticle.title,
          summary: studio.currentArticle.summary,
          type: studio.currentArticle.type,
          style: studio.currentArticle.style,
          characters: studio.currentArticle.characters.filter((person) => !person.archived).map((person) => ({ name: person.name, aliases: person.aliases, description: person.description })),
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
    fontFamily: studio.data.settings.editorFont === "serif" ? "Georgia, 'Noto Serif SC', serif" : undefined,
  } : undefined;
  const contentWords = outlines.reduce((total, item) => total + wordCount(contentDrafts[item.id] ?? ""), 0);
  const status = mode === "content" && dirtyContentIds.size ? `${dirtyContentIds.size} 条编辑中` : saveStatusLabel(studio.saveStatus);

  return <div ref={scrollRef} className="page-scroll"><div className={`continuous-document-editor ${mode}`}>
    <PageHeader eyebrow={mode === "outline" ? "全大纲编辑" : "全文编辑"} title={studio.currentArticle.title} description={`${groups.length} 章 · ${outlines.length} 条大纲${mode === "content" ? ` · ${contentWords.toLocaleString("zh-CN")} 字` : ""} · ${status}`} actions={mode === "outline" ? <Button className="copy-all-outlines-button" variant="default" size="sm" type="button" leftSection={<Icon name="copy" />} onClick={() => void copyAllOutlines()}>复制</Button> : <><Button variant="default" type="button" onClick={() => void saveAllContentAsVersions()}>另存为</Button><Button type="button" loading={studio.saveStatus === "saving"} onClick={() => void saveAllContent()}>保存</Button><IconButton name="review" label="AI Review" variant="glass" size="large" className="full-content-review-button" onClick={() => setReviewOpen(true)} /></>} />
    <DndContext sensors={sensors} collisionDetection={closestCenter} autoScroll={{ acceleration: 10, threshold: { x: 0.12, y: 0.12 } }} onDragStart={(event) => setDraggingId(String(event.active.id))} onDragOver={handleDragOver} onDragCancel={clearDragState} onDragEnd={finishDrag}>
      <div className="continuous-document-body">
        {groups.map((group, groupIndex) => <section className="continuous-chapter" key={group.id}>
          <ContinuousChapterHeading chapterId={group.id} index={groupIndex} title={group.title} />
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
              onActivate={() => activateOutline(item.id)}
              onAdd={mode === "outline" ? () => createOutlineBelow(item, group.id) : undefined}
              onDelete={mode === "outline" ? () => deleteOutlineFromDocument(item) : undefined}
              onArchive={mode === "outline" ? () => toggleOutlineArchive(item) : undefined}
              onTitle={(value) => studio.updateOutline(item.id, { title: value.slice(0, 80) })}
              onText={(value) => mode === "outline" ? studio.updateOutline(item.id, { plan: value.slice(0, 10000) }) : changeContent(item.id, value, versionSelections[item.id])}
              onContentBlur={mode === "content" ? () => commitContent(item.id) : undefined}
              onSelectVersion={mode === "content" ? (versionId) => selectContentVersion(item, versionId) : undefined}
              onSetCurrentVersion={mode === "content" ? (versionId) => setContentCurrentVersion(item, versionId) : undefined}
              onSetDefaultVersion={mode === "content" ? (versionId) => setContentDefaultVersion(item, versionId) : undefined}
              onOpenChat={mode === "outline" ? () => openOutlineChat(item) : undefined}
              onMoveUp={itemIndex > 0 ? () => { studio.moveOutline(item.id, group.items[itemIndex - 1].id, "before"); onNotice(`已上移「${outlineDisplayTitle(item)}」`); } : undefined}
              onMoveDown={itemIndex < group.items.length - 1 ? () => { studio.moveOutline(item.id, group.items[itemIndex + 1].id, "after"); onNotice(`已下移「${outlineDisplayTitle(item)}」`); } : undefined}
              onMoveChapter={() => {
                const options = groups.map((chapter, index) => `${index + 1}. ${chapter.title}`).join("\n");
                const answer = window.prompt(`移动到哪个章节？\n${options}`, "1");
                const target = groups[Number(answer) - 1];
                if (target) { studio.moveOutlineToChapter(item.id, target.id); onNotice(`已移动到「${target.title}」`); }
              }}
            />) : <ContinuousEmptyChapter chapterId={group.id} />}
          </SortableContext>
        </section>)}
      </div>
      <DragOverlay dropAnimation={{ duration: 140, easing: "ease" }}>
        {draggingOutline && <div className="continuous-drag-overlay"><span className="outline-grip-dots" aria-hidden="true" /><span className="ui-title">{outlineDisplayTitle(draggingOutline)}</span></div>}
      </DragOverlay>
    </DndContext>
    {mode === "outline" && chatOutlineId && <FullOutlineChatDialog outlineId={chatOutlineId} onClose={() => setChatOutlineId(null)} onNotice={onNotice} />}
    {mode === "content" && reviewOpen && <AiReviewDialog chapters={studio.currentArticle.chapters} models={reviewModels} presets={studio.data.settings.reviewPresets} initialModel={studio.data.settings.reviewModel} onClose={() => setReviewOpen(false)} onSavePresets={(presets) => studio.updateSettings({ reviewPresets: presets })} onSetDefaultModel={(reviewModel) => { studio.updateSettings({ reviewModel }); void studio.saveNow(); }} onRun={runReview} />}
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

function ArticleInfoPage({ view, onGo }: { view: View; onGo: (view: View) => void }) {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const [moreOpen, setMoreOpen] = useState(false);
  useDismissOnOutside(moreOpen, () => setMoreOpen(false), ".info-more-trigger, .info-more-menu");
  return (
    <div className="page-scroll"><div className="standard-page info-page">
      <PageHeader eyebrow={studio.currentArticle.title} title="文章资料" actions={<IconButton name="more" label="文章资料更多操作" className="info-more-trigger" onClick={() => setMoreOpen((open) => !open)} />} />
      {moreOpen && <div className="info-more-menu"><button type="button" onClick={() => { transfer.exportArticle(studio.currentArticle); setMoreOpen(false); }}>导出这篇文章</button><button type="button" onClick={() => { studio.updateSettings({ showArchived: !studio.data.settings.showArchived }); setMoreOpen(false); }}>{studio.data.settings.showArchived ? "隐藏" : "显示"}已归档内容</button><button className="danger" type="button" onClick={() => { const value = window.prompt(`输入文章标题「${studio.currentArticle.title}」以确认删除`); if (value === studio.currentArticle.title) studio.deleteArticle(studio.currentArticle.id); setMoreOpen(false); }}>删除文章</button></div>}
      <Tabs items={[
        ["info-basic", "基本信息"], ["info-chapters", "章节"], ["info-characters", "人物"], ["info-relationships", "人物关系"],
      ]} active={view} onGo={onGo} />
      {view === "info-basic" && <BasicInfo />}
      {view === "info-chapters" && <ArticleChapterNames />}
      {view === "info-characters" && <Characters />}
      {view === "info-relationships" && <Relationships />}
    </div></div>
  );
}

function Tabs({ items, active, onGo }: { items: [View, string][]; active: View; onGo: (view: View) => void }) {
  return <div className="tabs" role="tablist">{items.map(([key, label]) => <button key={key} className={active === key ? "active" : ""} type="button" role="tab" aria-selected={active === key} onClick={() => onGo(key)}>{label}</button>)}</div>;
}

function BasicInfo() {
  const studio = useStudio();
  const article = studio.currentArticle;
  return <div className="form-card"><div className="form-grid"><label className="full">文章标题<input value={article.title} maxLength={120} onChange={(event) => studio.updateArticle({ title: event.target.value })} /></label><label>文章类型<input value={article.type} maxLength={120} onChange={(event) => studio.updateArticle({ type: event.target.value })} /></label><label className="full">写作风格<textarea value={article.style} maxLength={5000} onChange={(event) => studio.updateArticle({ style: event.target.value })} /></label><label className="full">简介<textarea value={article.summary} maxLength={10000} onChange={(event) => studio.updateArticle({ summary: event.target.value })} /></label></div><div className="form-foot"><span>创建于 {formatTime(article.createdAt)} · 修改于 {formatTime(article.updatedAt)}</span><span className="save-state"><i /> 已自动保存</span></div></div>;
}

function ArticleChapterNames() {
  const studio = useStudio();
  const article = studio.currentArticle;
  const activeChapters = article.chapters.filter((chapter) => !chapter.archived);
  const eligibleOutlineCount = activeChapters.reduce((total, chapter) => total + chapter.outlines.filter((outline) => !outline.archived && outline.plan.trim()).length, 0);
  return <div className="form-card article-naming-page">
      <section className="article-naming-settings">
        <div className="article-naming-heading"><div><span>AI 命名</span><h2>章节与大纲名称</h2><p>这里只设置名称生成规则。生成、候选版本和默认名称统一在“全章节编辑”中管理。</p></div></div>
        {!eligibleOutlineCount && <Alert color="studio" variant="light">当前没有包含内容的未归档大纲。填写大纲内容后即可生成全部名称。</Alert>}
        <div className="article-naming-grid"><NamingProfileEditor title="章节命名" profile={article.chapterNaming} fallback={DEFAULT_CHAPTER_NAMING_PROFILE} onChange={(chapterNaming) => studio.updateArticle({ chapterNaming })} /><NamingProfileEditor title="大纲命名" profile={article.outlineNaming} fallback={DEFAULT_OUTLINE_NAMING_PROFILE} onChange={(outlineNaming) => studio.updateArticle({ outlineNaming })} /></div>
      </section>
      <div className="form-foot"><span>{activeChapters.length} 个未归档章节 · {eligibleOutlineCount} 条可命名大纲</span><span className="save-state"><i /> 已自动保存</span></div>
    </div>;
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
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: "", aliases: "", description: "" });
  const visible = studio.currentArticle.characters.filter((person) => (studio.data.settings.showArchived || !person.archived) && `${person.name}${person.aliases.join("")}${person.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function openCreate() { setEditingId(null); setForm({ name: "", aliases: "", description: "" }); setFormOpen(true); }
  function openEdit(person: Character) { setEditingId(person.id); setForm({ name: person.name, aliases: person.aliases.join("，"), description: person.description }); setFormOpen(true); }
  function save() {
    const name = form.name.trim();
    if (!name) return;
    const aliases = [...new Set(form.aliases.split(/[，,;；\n]/).map((item) => item.trim()).filter(Boolean))];
    if (editingId) studio.updateCharacter(editingId, { name, aliases, description: form.description });
    else studio.addCharacter({ name, aliases, description: form.description, archived: false });
    setFormOpen(false);
  }
  return <>
    <div className="list-toolbar"><label><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索人物…" /></label><button className="primary-compact" type="button" onClick={openCreate}><Icon name="plus" />新建人物</button></div>
    <div className="character-grid">{visible.map((person, index) => <article className={`character-card ${person.archived ? "archived" : ""}`} key={person.id}><div className={`character-avatar ${["coral", "blue", "green"][index % 3]}`}>{person.name[0]}</div><div><h3>{person.name}</h3>{person.aliases.length > 0 && <span>{person.aliases.join("、")}</span>}<p>{person.description || "暂无描述"}</p></div><div className="card-actions"><button type="button" onClick={() => openEdit(person)}>编辑</button><button type="button" onClick={() => studio.updateCharacter(person.id, { archived: !person.archived })}>{person.archived ? "恢复" : "归档"}</button><button className="danger-text" type="button" onClick={() => { if (window.confirm(`删除人物「${person.name}」及其关系？`)) studio.deleteCharacter(person.id); }}>删除</button></div></article>)}</div>
    {!visible.length && <div className="empty-inline">没有符合条件的人物。</div>}
    {formOpen && <div className="character-edit-layer"><button className="modal-scrim" type="button" aria-label="关闭人物编辑" onClick={() => setFormOpen(false)} /><div className="dialog-card character-edit-dialog" role="dialog" aria-modal="true" aria-label={editingId ? "编辑人物" : "新建人物"}><header><h2>{editingId ? "编辑人物" : "新建人物"}</h2><IconButton name="close" label="关闭人物编辑" onClick={() => setFormOpen(false)} /></header><label>人名<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>别名<textarea value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} placeholder="使用逗号、分号或换行分隔" /></label><label>描述<textarea className="character-description-input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><footer><button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>取消</button><button className="primary-compact" type="button" disabled={!form.name.trim()} onClick={save}>保存</button></footer></div></div>}
  </>;
}

function Relationships() {
  const studio = useStudio();
  const people = studio.currentArticle.characters.filter((person) => !person.archived);
  function create() {
    if (people.length < 2) { window.alert("至少需要两个人物才能建立关系。"); return; }
    const options = people.map((person, index) => `${index + 1}. ${person.name}`).join("\n");
    const first = people[Number(window.prompt(`选择人物 A：\n${options}`, "1")) - 1];
    const second = people[Number(window.prompt(`选择人物 B：\n${options}`, "2")) - 1];
    if (!first || !second || first.id === second.id) { window.alert("请选择两个不同人物。"); return; }
    if (studio.currentArticle.relationships.some((item) => [item.characterAId, item.characterBId].includes(first.id) && [item.characterAId, item.characterBId].includes(second.id))) { window.alert("这两个人物之间已经存在关系。"); return; }
    const description = window.prompt("关系描述");
    if (description?.trim()) studio.addRelationship({ characterAId: first.id, characterBId: second.id, description: description.trim() });
  }
  return <><div className="relationship-toolbar"><span className="ui-title">{studio.currentArticle.relationships.length} 条人物关系</span><button className="primary-compact" type="button" onClick={create}><Icon name="plus" />新建关系</button></div><div className="relationship-list">{studio.currentArticle.relationships.map((item) => { const a = studio.currentArticle.characters.find((person) => person.id === item.characterAId); const b = studio.currentArticle.characters.find((person) => person.id === item.characterBId); if (!a || !b) return null; return <article className="relationship-card" key={item.id}><div className="mini-avatar blue">{a.name[0]}</div><span className="ui-title">{a.name}</span><span className="relationship-line"><Icon name="link" /><em>{item.description}</em></span><span className="ui-title">{b.name}</span><div className="mini-avatar blue">{b.name[0]}</div><div className="card-actions"><button type="button" onClick={() => { const description = window.prompt("关系描述", item.description); if (description?.trim()) studio.updateRelationship(item.id, { description: description.trim() }); }}>编辑</button><button className="danger-text" type="button" onClick={() => { if (window.confirm("删除这条人物关系？")) studio.deleteRelationship(item.id); }}>删除</button></div></article>; })}</div></>;
}

function SettingsPage({ view, onGo }: { view: View; onGo: (view: View) => void }) {
  const items: [View, string][] = [
    ["settings-general", "常规"],
    ["settings-appearance", "外观与编辑器"],
    ["settings-models", "AI 服务"],
    ["settings-tasks", "AI 任务"],
    ["settings-database", "数据管理"],
    ["settings-system", "系统与诊断"],
  ];
  const activeItem = items.find(([key]) => key === view) ?? items[0];
  return <div className="settings-layout"><nav className="settings-nav" aria-label="设置分类"><div><span>Writer Studio</span><span className="ui-title">设置</span></div>{items.map(([key, label]) => <button className={view === key ? "active" : ""} key={key} type="button" onClick={() => onGo(key)}><span className="ui-title">{label}</span></button>)}</nav><div className="settings-content"><PageHeader title={activeItem[1]} />{view === "settings-general" && <GeneralSettings />}{view === "settings-appearance" && <AppearanceSettings />}{view === "settings-models" && <ModelSettings />}{view === "settings-tasks" && <TaskSettings />}{view === "settings-database" && <DatabaseSettings />}{view === "settings-system" && <SystemSettings />}</div></div>;
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
  const settings = studio.data.settings;
  return <><SettingSection title="外观"><SettingRow title="主题"><div className="segmented">{[["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]].map(([value, label]) => <button className={settings.theme === value ? "active" : ""} type="button" key={value} onClick={() => studio.updateSettings({ theme: value as "light" | "dark" | "system" })}>{label}</button>)}</div></SettingRow></SettingSection><SettingSection title="编辑器排版"><SettingRow title="编辑器字体"><select value={settings.editorFont} onChange={(event) => studio.updateSettings({ editorFont: event.target.value as "sans" | "serif" })}><option value="sans">系统无衬线</option><option value="serif">系统衬线</option></select></SettingRow><SettingRow title="字号"><input type="range" min="14" max="24" value={settings.fontSize} onChange={(event) => studio.updateSettings({ fontSize: Number(event.target.value) })} /><output>{settings.fontSize}px</output></SettingRow><SettingRow title="行高"><input type="range" min="14" max="22" value={Math.round(settings.lineHeight * 10)} onChange={(event) => studio.updateSettings({ lineHeight: Number(event.target.value) / 10 })} /><output>{settings.lineHeight.toFixed(1)}</output></SettingRow><SettingRow title="正文宽度"><input type="range" min="640" max="1200" value={settings.contentWidth} onChange={(event) => studio.updateSettings({ contentWidth: Number(event.target.value) })} /><output>{settings.contentWidth}px</output></SettingRow></SettingSection><SettingSection title="侧栏"><SettingRow title="大纲内容默认展开"><Toggle checked={settings.outlineExpanded} onChange={(checked) => studio.updateSettings({ outlineExpanded: checked })} /></SettingRow><SettingRow title="记住设置"><span className="readonly-value">已开启</span></SettingRow></SettingSection></>;
}

function ModelSettings() {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  type Provider = { id: string; name: string; adapterKind: "openai-compatible"; baseUrl: string; timeoutMs: number; hasSecret: boolean; modelCount: number };
  type Model = ConfiguredModel & { providerId: string; providerName: string; systemPrompt: string; temperature: number | null; maxOutput: number | null; maxInputCharacters: number; timeoutOverrideMs: number | null };
  const parseModelIds = (value: string) => [...new Set(value.split(",").map((modelId) => modelId.trim()).filter(Boolean))];
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [providerFormOpen, setProviderFormOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState({ name: "", adapterKind: "openai-compatible", baseUrl: "https://api.openai.com/v1", secret: "", timeoutMinutes: "2" });
  const [modelFormOpen, setModelFormOpen] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState({ providerId: "", name: "", modelId: "", systemPrompt: "", maxInputCharacters: String(DEFAULT_MAX_INPUT_CHARACTERS) });
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [collapsedProviderIds, setCollapsedProviderIds] = useState<string[]>([]);
  const providerTimeoutMinutes = Number(providerForm.timeoutMinutes);
  const providerTimeoutValid = Number.isFinite(providerTimeoutMinutes) && providerTimeoutMinutes >= 0.1 && providerTimeoutMinutes <= 10;
  const maxInputCharacters = Number(modelForm.maxInputCharacters);
  const maxInputValid = Number.isInteger(maxInputCharacters) && maxInputCharacters >= MIN_MAX_INPUT_CHARACTERS && maxInputCharacters <= MAX_MAX_INPUT_CHARACTERS;
  const requestedModelIds = selectedModelIds.length ? selectedModelIds : parseModelIds(modelForm.modelId);

  const load = useCallback(async () => {
    const [providerResponse, modelResponse] = await Promise.all([fetch("/api/providers", { cache: "no-store" }), fetch("/api/models", { cache: "no-store" })]);
    const providerPayload = await providerResponse.json() as { providers?: Provider[]; error?: string };
    const modelPayload = await modelResponse.json() as { models?: Model[]; error?: string };
    if (!providerResponse.ok || !providerPayload.providers) throw new Error(providerPayload.error || "Provider 加载失败");
    if (!modelResponse.ok || !modelPayload.models) throw new Error(modelPayload.error || "模型加载失败");
    setProviders(providerPayload.providers);
    setModels(modelPayload.models);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "AI 服务加载失败")); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function closeProviderForm() { setProviderFormOpen(false); setEditingProviderId(null); setProviderForm({ name: "", adapterKind: "openai-compatible", baseUrl: "https://api.openai.com/v1", secret: "", timeoutMinutes: "2" }); }
  function openCreateProvider() { setError(""); setEditingProviderId(null); setProviderForm({ name: "", adapterKind: "openai-compatible", baseUrl: "https://api.openai.com/v1", secret: "", timeoutMinutes: "2" }); setProviderFormOpen(true); }
  function openEditProvider(provider: Provider) { setError(""); setEditingProviderId(provider.id); setProviderForm({ name: provider.name, adapterKind: provider.adapterKind, baseUrl: provider.baseUrl, secret: "", timeoutMinutes: String(Math.max(0.1, Number((provider.timeoutMs / 60_000).toFixed(2)))) }); setProviderFormOpen(true); }
  async function saveProvider() {
    setBusy("save-provider"); setError("");
    try {
      const response = await fetch(editingProviderId ? `/api/providers/${editingProviderId}` : "/api/providers", {
        method: editingProviderId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: providerForm.name, adapterKind: providerForm.adapterKind, baseUrl: providerForm.baseUrl, timeoutMs: Math.round(providerTimeoutMinutes * 60_000), ...(!editingProviderId ? { secret: providerForm.secret } : {}) }),
      });
      const provider = await response.json() as Provider & { error?: string };
      if (!response.ok) throw new Error(provider.error || "Provider 保存失败");
      if (editingProviderId && providerForm.secret.trim()) {
        const secretResponse = await fetch(`/api/providers/${editingProviderId}/secret`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: providerForm.secret }) });
        if (!secretResponse.ok) throw new Error("Provider 已保存，但 API Key 更新失败");
      }
      closeProviderForm(); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Provider 保存失败"); }
    finally { setBusy(""); }
  }
  async function testProviderConnection(provider: Provider) {
    setBusy(`test-${provider.id}`); setError("");
    try {
      const response = await fetch(`/api/providers/${provider.id}/test`, { method: "POST" });
      const payload = await response.json() as { latencyMs?: number; modelCount?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "连接失败");
      window.alert(`连接正常，耗时 ${payload.latencyMs}ms，发现 ${payload.modelCount ?? 0} 个模型`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Provider 连接失败"); }
    finally { setBusy(""); }
  }
  async function removeProvider(provider: Provider) {
    if (!window.confirm(`删除 Provider「${provider.name}」？`)) return;
    const response = await fetch(`/api/providers/${provider.id}`, { method: "DELETE" });
    if (!response.ok) { const payload = await response.json() as { error?: string }; setError(payload.error || "Provider 删除失败"); return; }
    await load();
  }
  async function clearProviderKey(provider: Provider) {
    if (!window.confirm(`移除 Provider「${provider.name}」的 API Key？其下所有模型将不可用。`)) return;
    const response = await fetch(`/api/providers/${provider.id}/secret`, { method: "DELETE" });
    if (!response.ok) { const payload = await response.json() as { error?: string }; setError(payload.error || "API Key 移除失败"); return; }
    await load();
  }

  function closeModelForm() { setModelFormOpen(false); setEditingModelId(null); setDiscoveredModels([]); setSelectedModelIds([]); setModelForm({ providerId: "", name: "", modelId: "", systemPrompt: "", maxInputCharacters: String(DEFAULT_MAX_INPUT_CHARACTERS) }); }
  function openCreateModel(providerId = providers[0]?.id ?? "", candidates: string[] = []) {
    setError(""); setEditingModelId(null); setDiscoveredModels(candidates);
    const saved = new Set(models.filter((model) => model.providerId === providerId).map((model) => model.modelId));
    const initial = candidates.filter((modelId) => !saved.has(modelId)).slice(0, 1);
    setSelectedModelIds(initial); setModelForm({ providerId, name: "", modelId: initial.join(", "), systemPrompt: "", maxInputCharacters: String(DEFAULT_MAX_INPUT_CHARACTERS) }); setModelFormOpen(true);
  }
  function openEditModel(model: Model) { setError(""); setEditingModelId(model.id); setDiscoveredModels([]); setSelectedModelIds([]); setModelForm({ providerId: model.providerId, name: model.name, modelId: model.modelId, systemPrompt: model.systemPrompt, maxInputCharacters: String(model.maxInputCharacters ?? DEFAULT_MAX_INPUT_CHARACTERS) }); setModelFormOpen(true); }
  async function fetchProviderModels(provider: Provider) {
    setBusy(`discover-${provider.id}`); setError("");
    try {
      const response = await fetch(`/api/providers/${provider.id}/discover`, { method: "POST" });
      const payload = await response.json() as { models?: string[]; error?: string };
      if (!response.ok || !payload.models?.length) throw new Error(payload.error || "没有获取到模型");
      openCreateModel(provider.id, payload.models);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "获取模型列表失败"); }
    finally { setBusy(""); }
  }
  async function saveModel() {
    setBusy("save-model"); setError("");
    const previous = editingModelId ? models.find((model) => model.id === editingModelId) : null;
    try {
      if (!editingModelId) {
        const response = await fetch("/api/models/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId: modelForm.providerId, name: modelForm.name, modelIds: requestedModelIds, systemPrompt: modelForm.systemPrompt, maxInputCharacters }) });
        const payload = await response.json() as { models?: Model[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "模型创建失败");
        if (!payload.models?.length) throw new Error("所选模型已存在，无需重复保存");
      } else {
        const response = await fetch(`/api/models/${editingModelId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId: modelForm.providerId, name: modelForm.name, modelId: requestedModelIds[0] ?? "", systemPrompt: modelForm.systemPrompt, maxInputCharacters }) });
        const model = await response.json() as Model & { error?: string };
        if (!response.ok) throw new Error(model.error || "模型更新失败");
        if (previous && (previous.name !== model.name || previous.providerName !== model.providerName)) {
          if (modelMatchesReference(previous, studio.data.settings.chatModel)) studio.updateSettings({ chatModel: model.id });
          if (modelMatchesReference(previous, studio.data.settings.generateModel)) studio.updateSettings({ generateModel: model.id });
          if (studio.data.settings.namingModelMode === "fixed" && modelMatchesReference(previous, studio.data.settings.namingModel)) studio.updateSettings({ namingModel: model.id });
          if (modelMatchesReference(previous, studio.data.settings.reviewModel)) studio.updateSettings({ reviewModel: model.id });
        }
      }
      closeModelForm(); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "模型保存失败"); }
    finally { setBusy(""); }
  }
  async function removeModel(model: Model) {
    if (!window.confirm(`删除模型「${model.name}」？`)) return;
    await fetch(`/api/models/${model.id}`, { method: "DELETE" });
    if (modelMatchesReference(model, studio.data.settings.chatModel)) studio.updateSettings({ chatModel: "" });
    if (modelMatchesReference(model, studio.data.settings.generateModel)) studio.updateSettings({ generateModel: "" });
    if (studio.data.settings.namingModelMode === "fixed" && modelMatchesReference(model, studio.data.settings.namingModel)) studio.updateSettings({ namingModelMode: "inherit", namingModel: "" });
    if (modelMatchesReference(model, studio.data.settings.reviewModel)) studio.updateSettings({ reviewModel: "" });
    await load();
  }

  const namingSelection = studio.data.settings.namingModelMode === "inherit" ? "__inherit__" : studio.data.settings.namingModel || "__local__";
  const inheritedNamingLabel = `继承 AI Generate（${modelDisplayLabel(models, studio.data.settings.generateModel)}）`;
  function selectNamingModel(value: string) { studio.updateSettings(value === "__inherit__" ? { namingModelMode: "inherit", namingModel: "" } : { namingModelMode: "fixed", namingModel: value === "__local__" ? "" : value }); void studio.saveNow(); }
  function toggleProvider(providerId: string) { setCollapsedProviderIds((current) => current.includes(providerId) ? current.filter((id) => id !== providerId) : [...current, providerId]); }

  return <>
    <Group className="settings-actionbar" justify="space-between" align="center">
      <Text c="dimmed" size="sm">{providers.length} 个 Provider · {models.length} 个模型</Text>
      <Button size="sm" leftSection={<Icon name="plus" />} onClick={openCreateProvider}>新建 Provider</Button>
    </Group>
    {!providerFormOpen && !modelFormOpen && error && <Alert className="settings-error" color="red" role="alert">{error}</Alert>}
    <SettingSection title="名称生成"><SettingRow title="默认模型"><select aria-label="名称生成默认模型" value={namingSelection} onChange={(event) => selectNamingModel(event.target.value)}><option value="__inherit__">{inheritedNamingLabel}</option><option value="__local__">本地 PoC 引擎（固定）</option>{studio.data.settings.namingModelMode === "fixed" && studio.data.settings.namingModel && !configuredModelForReference(models, studio.data.settings.namingModel) && <option value={studio.data.settings.namingModel}>{studio.data.settings.namingModel}（不可用）</option>}{models.map((model) => <option value={model.id} key={model.id}>{modelDisplayLabel(models, model.id)}{model.hasSecret ? "" : "（Provider 需密钥）"}</option>)}</select></SettingRow></SettingSection>
    <SettingSection title="Providers">
      <Stack gap="sm" className="provider-list provider-groups">
        {providers.map((provider) => {
          const providerModels = models.filter((model) => model.providerId === provider.id);
          const collapsed = collapsedProviderIds.includes(provider.id);
          return <Card p={0} withBorder radius="md" className={`provider-group provider-card ${collapsed ? "is-collapsed" : ""}`} key={provider.id}>
            <div className="provider-group-header">
              <div className="provider-group-summary">
                <button className="provider-group-toggle" type="button" aria-expanded={!collapsed} aria-label={`${collapsed ? "展开" : "折叠"} Provider：${provider.name}`} onClick={() => toggleProvider(provider.id)}><Icon name="chevron" /></button>
                <div className="provider-group-copy"><div className="provider-group-title"><h3>{provider.name}</h3><Badge color={provider.hasSecret ? "green" : "yellow"} variant="light">{provider.hasSecret ? "已连接" : "缺少密钥"}</Badge><span>{providerModels.length} 个模型</span></div><p>{provider.baseUrl} · OpenAI Compatible · {Math.max(0.1, Number((provider.timeoutMs / 60_000).toFixed(2)))} 分钟</p></div>
              </div>
              <div className="provider-group-actions">
                <Button variant="default" size="xs" loading={busy === `test-${provider.id}`} onClick={() => void testProviderConnection(provider)}>测试连接</Button>
                <Button variant="light" size="xs" loading={busy === `discover-${provider.id}`} onClick={() => void fetchProviderModels(provider)}>Fetch 模型</Button>
                <Button variant="default" size="xs" onClick={() => openEditProvider(provider)}>编辑</Button>
                <Menu position="bottom-end" withinPortal><Menu.Target><Button variant="default" size="xs">更多</Button></Menu.Target><Menu.Dropdown><Menu.Item disabled={!provider.hasSecret} onClick={() => void clearProviderKey(provider)}>移除 API Key</Menu.Item><Menu.Divider /><Menu.Item color="red" disabled={providerModels.length > 0 || provider.modelCount > 0} onClick={() => void removeProvider(provider)}>删除 Provider</Menu.Item></Menu.Dropdown></Menu>
              </div>
            </div>
            {!collapsed && <div className="provider-group-body">
              {providerModels.length > 0 && <div className="provider-model-header" aria-hidden="true"><span>模型</span><span>默认用途</span><span>最大输入</span><span>操作</span></div>}
              {providerModels.map((model) => {
                const isGenerateDefault = modelMatchesReference(model, studio.data.settings.generateModel);
                const isNamingDefault = studio.data.settings.namingModelMode === "fixed" && modelMatchesReference(model, studio.data.settings.namingModel);
                const isChatDefault = modelMatchesReference(model, studio.data.settings.chatModel);
                const isReviewDefault = modelMatchesReference(model, studio.data.settings.reviewModel);
                const hasDefault = isGenerateDefault || isNamingDefault || isChatDefault || isReviewDefault;
                return <article className="provider-model-row" data-provider-model-id={model.id} key={model.id}>
                  <div className="provider-model-main"><h4>{model.name}</h4><p>{model.modelId}</p></div>
                  <div className="model-default-tags provider-model-defaults">{isGenerateDefault && <em>默认 AI Generate</em>}{isNamingDefault && <em>默认名称生成</em>}{isChatDefault && <em>默认 AI Chat</em>}{isReviewDefault && <em>默认 AI Review</em>}{!hasDefault && <span className="provider-model-no-default">—</span>}</div>
                  <span className="provider-model-limit">{model.maxInputCharacters.toLocaleString("zh-CN")} 字符</span>
                  <div className="model-card-actions provider-model-actions"><Button variant="subtle" size="xs" onClick={() => openEditModel(model)}>编辑</Button><Menu position="bottom-end" withinPortal><Menu.Target><Button variant="default" size="xs">更多</Button></Menu.Target><Menu.Dropdown><Menu.Item disabled={isGenerateDefault} onClick={() => studio.updateSettings({ generateModel: model.id })}>设为 Generate 默认</Menu.Item><Menu.Item disabled={isNamingDefault} onClick={() => studio.updateSettings({ namingModelMode: "fixed", namingModel: model.id })}>设为名称生成默认</Menu.Item><Menu.Item disabled={isChatDefault} onClick={() => studio.updateSettings({ chatModel: model.id })}>设为 Chat 默认</Menu.Item><Menu.Item disabled={isReviewDefault} onClick={() => studio.updateSettings({ reviewModel: model.id })}>设为 Review 默认</Menu.Item><Menu.Divider /><Menu.Item color="red" onClick={() => void removeModel(model)}>删除模型</Menu.Item></Menu.Dropdown></Menu></div>
                </article>;
              })}
              {!providerModels.length && <div className="provider-model-empty">这个 Provider 还没有模型</div>}
              <div className="provider-group-footer"><Button variant="subtle" size="xs" leftSection={<Icon name="plus" />} aria-label={`添加模型到 ${provider.name}`} onClick={() => openCreateModel(provider.id)}>手动添加模型</Button></div>
            </div>}
          </Card>;
        })}
        {!providers.length && <div className="empty-inline">请先新建 Provider，再添加模型</div>}
      </Stack>
    </SettingSection>
    <ResponsiveModal opened={providerFormOpen} onClose={closeProviderForm} closeButtonProps={{ "aria-label": "关闭 Provider 编辑" }} title={editingProviderId ? "编辑 Provider" : "新建 Provider"} size="lg" fullScreen={compact} centered={!compact} classNames={{ content: "ws-modal-content", header: "ws-modal-header", body: "model-form-modal" }} overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}>
      <Stack className="model-editor-stack" gap="md">{error && <Alert className="model-form-error" color="red" role="alert">{error}</Alert>}<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md"><TextInput label="Provider 名称" value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} /><Select label="协议" value={providerForm.adapterKind} data={[{ value: "openai-compatible", label: "OpenAI Compatible" }]} disabled /><TextInput label="接口地址" value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })} /><NumberInput label="请求超时" aria-label="Provider 超时（分钟）" min={0.1} max={10} step={0.1} decimalScale={2} suffix=" 分钟" value={providerForm.timeoutMinutes} error={!providerTimeoutValid ? "请输入 0.1–10 分钟" : undefined} onChange={(value) => setProviderForm({ ...providerForm, timeoutMinutes: String(value) })} /><PasswordInput label="API Key" description={editingProviderId ? "留空会保留现有 API Key" : undefined} autoComplete="new-password" value={providerForm.secret} onChange={(event) => setProviderForm({ ...providerForm, secret: event.target.value })} /></SimpleGrid><Group className="model-form-actions" justify="flex-end"><Button variant="default" onClick={closeProviderForm}>取消</Button><Button disabled={!providerForm.name.trim() || !providerForm.baseUrl.trim() || !providerTimeoutValid} loading={busy === "save-provider"} onClick={() => void saveProvider()}>保存 Provider</Button></Group></Stack>
    </ResponsiveModal>
    <ResponsiveModal opened={modelFormOpen} onClose={closeModelForm} closeButtonProps={{ "aria-label": "关闭模型编辑" }} title={editingModelId ? "编辑模型" : "新建模型"} size="lg" fullScreen={compact} centered={!compact} classNames={{ content: "ws-modal-content", header: "ws-modal-header", body: "model-form-modal" }} overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}>
      <Stack className="model-editor-stack" gap="md">{error && <Alert className="model-form-error" color="red" role="alert">{error}</Alert>}<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md"><Select label="Provider" value={modelForm.providerId} data={providers.map((provider) => ({ value: provider.id, label: provider.name }))} onChange={(value) => { const providerId = value ?? ""; const providerChanged = providerId !== modelForm.providerId; setModelForm({ ...modelForm, providerId, modelId: providerChanged && discoveredModels.length > 0 ? "" : modelForm.modelId }); if (providerChanged) { setDiscoveredModels([]); setSelectedModelIds([]); } }} /><TextInput label={selectedModelIds.length > 1 ? "显示名称前缀" : "显示名称"} description={selectedModelIds.length > 1 ? "新增模型会自动附加自己的模型 ID" : undefined} value={modelForm.name} onChange={(event) => setModelForm({ ...modelForm, name: event.target.value })} /><NumberInput label="最大输入字符数" description="名称生成和正文生成会参考此上限" min={MIN_MAX_INPUT_CHARACTERS} max={MAX_MAX_INPUT_CHARACTERS} step={1000} thousandSeparator="," value={modelForm.maxInputCharacters} error={!maxInputValid ? `请输入 ${MIN_MAX_INPUT_CHARACTERS.toLocaleString("zh-CN")}–${MAX_MAX_INPUT_CHARACTERS.toLocaleString("zh-CN")}` : undefined} onChange={(value) => setModelForm({ ...modelForm, maxInputCharacters: String(value) })} /></SimpleGrid><div className="model-id-field"><TextInput id="model-id-input" label="模型 ID" aria-label="模型 ID" placeholder={editingModelId ? "输入模型 ID" : "多个模型 ID 使用逗号分隔"} value={modelForm.modelId} onChange={(event) => { const modelId = event.target.value; setModelForm({ ...modelForm, modelId }); setSelectedModelIds(parseModelIds(modelId).filter((value) => discoveredModels.includes(value))); }} />{discoveredModels.length > 0 && <MultiSelect className="discovered-model-select" label={`Provider 返回 ${discoveredModels.length} 个模型`} description="勾选并保存的模型才会加入 Writer Studio。" aria-label="选择获取到的大模型" placeholder="选择一个或多个模型" searchable withCheckIcon checkIconPosition="right" data={discoveredModels} value={selectedModelIds} onChange={(values) => { setSelectedModelIds(values); setModelForm((current) => ({ ...current, modelId: values.join(", ") })); }} />}</div><Textarea label="附加提示词" autosize minRows={3} maxRows={8} value={modelForm.systemPrompt} onChange={(event) => setModelForm({ ...modelForm, systemPrompt: event.target.value })} /><Group className="model-form-actions" justify="flex-end"><Button variant="default" onClick={closeModelForm}>取消</Button><Button disabled={!modelForm.providerId || !requestedModelIds.length || (Boolean(editingModelId) && !modelForm.name.trim()) || !maxInputValid} loading={busy === "save-model"} onClick={() => void saveModel()}>{!editingModelId && requestedModelIds.length > 1 ? `保存 ${requestedModelIds.length} 个模型` : "保存模型"}</Button></Group></Stack>
    </ResponsiveModal>
  </>;
}

function TaskSettings() { const studio = useStudio(); return <SettingSection title="任务队列"><SettingRow title="并发任务数"><select value={studio.data.settings.taskConcurrency} onChange={(event) => studio.updateSettings({ taskConcurrency: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></SettingRow><SettingRow title="自动重试"><span className="readonly-value">2 次</span></SettingRow><SettingRow title="任务记录"><button className="secondary-button" type="button" onClick={() => studio.data.tasks.filter((task) => ["success", "failed", "cancelled"].includes(task.state)).forEach((task) => studio.removeTask(task.id))}>清除终态任务</button></SettingRow></SettingSection>; }

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
  useEffect(() => { void fetch("/api/database/status", { cache: "no-store" }).then((response) => response.json()).then(setStatus); }, [studio.saveStatus]);
  const loadSyncStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/status", { cache: "no-store" });
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
  async function check() { setChecking(true); const response = await fetch("/api/database/integrity-check", { method: "POST" }); const result = await response.json() as { ok?: boolean; issues?: unknown[]; message?: string }; setChecking(false); window.alert(result.ok ? "完整性检查通过：未发现孤立记录或外键错误。" : `检查发现问题：${result.message || JSON.stringify(result.issues)}`); }
  async function setAutoUpload(enabled: boolean) {
    setSyncToggleBusy(true); setSyncNotice("");
    try {
      const response = await fetch("/api/sync/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoUploadEnabled: enabled }) });
      const payload = await response.json() as SyncStatus & { message?: string };
      if (!response.ok) throw new Error(payload.message || "自动上传设置保存失败");
      setSyncStatus(payload);
      if (enabled) void fetch("/api/sync/upload", { method: "POST" }).finally(() => void loadSyncStatus());
    } catch (reason) {
      setSyncNotice(reason instanceof Error ? reason.message : "自动上传设置保存失败");
    } finally {
      setSyncToggleBusy(false);
    }
  }
  async function replaceDatabase(direction: "pull" | "push") {
    const phrase = direction === "pull" ? "从云端取回" : "复制到云端";
    const target = direction === "pull" ? "本地" : "云端";
    const scope = ["创作数据库", overwriteModels ? "大模型配置" : "", overwriteSecrets ? "API Key/Secret" : ""].filter(Boolean).join("、");
    const sensitiveNotice = overwriteModels ? "覆盖前备份将包含目标端现有 API Key，请妥善保管 data/recovery。" : "";
    const typed = window.prompt(`此操作会用${direction === "pull" ? "云端" : "本地"}的${scope}覆盖${target}。${sensitiveNotice}输入“${phrase}”确认：`, "");
    if (typed !== phrase) return;
    setSyncBusy(direction); setSyncNotice("");
    try {
      if (!await studio.saveNow()) throw new Error("本地内容尚未保存，已取消覆盖");
      const response = await fetch(`/api/sync/${direction}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ includeModels: overwriteModels, includeSecrets: overwriteSecrets }) });
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
  const response = await fetch("/api/system/service", { cache: "no-store" });
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
      const response = await fetch("/api/system/service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; previousStartedAt?: string | null };
      if (!response.ok || payload.ok !== true) throw new Error(payload.message || "服务端未接受重启请求");

      const previousStartedAt = payload.previousStartedAt ?? serviceStatus?.service.startedAt ?? null;
      const deadline = Date.now() + 45_000;
      setRestartPhase("waiting");
      setRestartNotice("服务端正在重启，恢复后会自动更新状态…");
      while (Date.now() < deadline) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 900));
        try {
          const latest = await fetchManagedServiceStatus();
          setServiceStatus(latest);
          setServiceError("");
          const startedAgain = latest.service.startedAt && latest.service.startedAt !== previousStartedAt;
          if (latest.service.state === "running" && latest.service.managed && startedAgain) {
            setRestartPhase("success");
            setRestartNotice("服务端已完成重启，可以继续使用。");
            return;
          }
        } catch {
          // A short connection failure is expected while the managed process restarts.
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
      <SettingRow title="应用版本"><span className="readonly-value">Writer Studio 2.1.0 PoC</span></SettingRow>
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

function VersionDrawer({ selectedVersionId, onClose, onPreview, onClearPreview, onNotice }: { selectedVersionId?: string; onClose: () => void; onPreview: (versionId: string) => void; onClearPreview: () => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const versions = studio.currentOutline.versions;
  const compareVersion = versions.find((version) => version.id === compareVersionId);
  const currentContent = resolvedOutlineContent(studio.currentOutline);
  const currentContentName = resolvedOutlineContentName(studio.currentOutline);
  const currentExcellentFragments = resolvedExcellentFragments(studio.currentOutline);
  const currentVersion = currentOutlineVersion(studio.currentOutline);
  const showStandaloneCurrent = !currentVersion;
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
      <div className="version-drawer-tools">
        <Button leftSection={<Icon name="plus" />} onClick={() => { const defaultName = timestampContentName(); const name = window.prompt("正文名称", defaultName); if (name !== null) studio.saveVersion(studio.currentOutline.id, name.trim() || defaultName, "手动", currentContent); }}>保存当前正文为新版本</Button>
        {studio.currentOutline.defaultVersionId && <Button variant="default" onClick={() => { studio.setDefaultVersion(studio.currentOutline.id); onNotice("已取消默认正文"); }}>取消默认正文</Button>}
      </div>
      {compareVersion ? <div className="diff-view" data-ui-overlay-scroll>
        <Button variant="subtle" size="xs" onClick={() => setCompareVersionId(null)}>← 返回版本</Button>
        <h3>与「{currentContentName}」对比</h3>
        <p><del>{currentContent.slice(0, 500) || "（当前正文为空）"}</del></p>
        <p><ins>{compareVersion.content.slice(0, 500) || "（版本正文为空）"}</ins></p>
        <div className="diff-legend"><span><i className="removed" />{currentContentName}</span><span><i className="added" />{compareVersion.name}</span></div>
      </div> : <div className="version-list" data-ui-overlay-scroll>
        {showStandaloneCurrent && <article className={!selectedVersionId ? "active current" : "current"}>
          <button className="version-preview-main" type="button" onClick={onClearPreview}><div><span className="ui-title" title={currentContentName}>{currentContentName}</span>{(studio.currentOutline.manualExcellent || currentExcellentFragments.length > 0) && <i className="excellent-fragment-dot" title={studio.currentOutline.manualExcellent ? "优秀正文" : "含优秀片段，已自动设为优秀"} />}<em>当前 · 已直接保存</em></div><p>{formatTime(studio.currentOutline.updatedAt)} · {wordCount(currentContent)} 字</p><span>正文</span></button>
          {!selectedVersionId && <div className="version-content-preview" aria-label="当前正文内容">{currentContent ? <ExcellentText text={currentContent} fragments={currentExcellentFragments} /> : "（正文为空）"}</div>}
        </article>}
        {versions.map((version) => {
          const isDefault = studio.currentOutline.defaultVersionId === version.id;
          const isCurrent = currentVersion?.id === version.id;
          const isActive = selectedVersionId ? selectedVersionId === version.id : isCurrent;
          const excellentFragments = normalizeExcellentFragments(version.content, version.excellentFragments);
          const isExcellent = version.manualExcellent === true || excellentFragments.length > 0;
          return <article className={`${isDefault ? "default" : ""} ${isCurrent ? "current" : ""} ${isActive ? "active" : ""}`} key={version.id}>
            <button className="version-preview-main" type="button" onClick={() => isCurrent ? onClearPreview() : onPreview(version.id)}><div><span className="ui-title">{version.name}</span>{isExcellent && <i className="excellent-fragment-dot" title={version.manualExcellent ? "优秀正文" : "含优秀片段，已自动设为优秀"} />}{isCurrent && <em>当前</em>}{isDefault && <em>默认</em>}</div><p>{formatTime(version.createdAt)} · {wordCount(version.content)} 字</p><span>{version.source}</span></button>
            {isActive && <div className="version-content-preview" aria-label={`${version.name}正文内容`}>{version.content ? <ExcellentText text={version.content} fragments={excellentFragments} /> : "（正文为空）"}</div>}
            <div className="version-actions">
              <button type="button" onClick={() => setCompareVersionId(version.id)}>对比</button>
              <button type="button" disabled={isCurrent} onClick={() => { studio.setCurrentVersion(studio.currentOutline.id, version.id); onClearPreview(); onNotice("已设为当前正文"); }}>{isCurrent ? "已当前" : "设为当前"}</button>
              <button type="button" disabled={isDefault} onClick={() => { studio.setDefaultVersion(studio.currentOutline.id, version.id); onNotice("已设为默认正文"); }}>{isDefault ? "已默认" : "设为默认"}</button>
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

function TaskPanel({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string, next?: "write" | "chat", previewVersionId?: string) => void }) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 3000);
    return () => window.clearInterval(timer);
  }, []);
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
    studio.setCurrentArticle(task.articleId);
    if (task.target === "全部名称") {
      window.history.pushState({}, "", `/articles/${task.articleId}/chapters/edit-all`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      onClose();
      return;
    }
    studio.setCurrentOutline(task.outlineId);
    onOpen(task.outlineId, task.target === "AI Chat" ? "chat" : "write", task.target === "正文" ? task.resultVersionId : undefined);
    onClose();
  }
  async function updateTaskState(task: AiTask, action: "cancel" | "retry" | "transfer") {
    const response = await fetch(`/api/ai/tasks/${encodeURIComponent(task.id)}/state`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const payload = await response.json() as { task?: Partial<AiTask>; revision?: number; error?: string };
    if (!response.ok || !payload.task || payload.revision === undefined) throw new Error(payload.error || "任务状态更新失败");
    studio.acceptServerMutation(payload.revision, (current) => ({
      ...current,
      articles: action !== "cancel" || task.target === "AI Chat" || task.target === "全部名称" ? current.articles : current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((outline) => outline.id === task.outlineId ? { ...outline, state: "saved" } : outline) })) })),
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
  const phaseLabels: Record<NonNullable<AiTask["phase"]>, string> = { queued: "等待调度", preparing: "准备上下文", connecting: "连接模型", generating: "模型生成中", receiving: "接收结果", saving: "保存结果", retrying: "准备重试", completed: "已保存", failed: "执行失败", cancelled: "已取消" };
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
  return <ScrollableDrawer
    scrollMode="content"
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭 AI 任务" }}
    title={<div className="task-drawer-title">{selectedTask && <IconButton name="back" label="返回任务列表" onClick={() => setSelectedTaskId("")} />}<div className="ws-drawer-title"><span className="ui-title">{selectedTask ? "任务详情" : "AI 任务"}</span><span>{selectedTask ? `${labels[selectedTask.state]} · ${selectedTask.target}` : activeCount ? `${activeCount} 个正在处理` : "没有进行中的任务"}</span></div></div>}
    position={compact ? "bottom" : "right"}
    size={compact ? "85dvh" : 470}
    classNames={{ content: "ws-drawer-content task-drawer-shell", header: "ws-drawer-header", body: "ws-drawer-body" }}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
  >
    <div className="task-panel" aria-label="AI 任务">
      {selectedTask ? <section className="task-detail" aria-label="任务详情">
        <div className="task-detail-body" data-ui-overlay-scroll>
          <div className={`task-detail-status ${isStale(selectedTask) ? "stale" : ""}`}><span className={`state-dot ${selectedTask.state}`} /><span className="ui-label">{isStale(selectedTask) ? "执行心跳已中断" : labels[selectedTask.state]}</span><span>{phaseLabels[selectedTask.phase ?? "queued"]} · {selectedTask.executionOrigin === "cloud" ? "云端执行" : "本地执行"} · 已用时 {taskElapsed(selectedTask)}</span></div>
          <dl className="task-detail-metadata">
            <div><dt>生成目标</dt><dd>{selectedTask.target}{selectedTask.target === "正文" ? ` · ${generateTargetWordsLabel(selectedTask.contextOptions?.targetWords)}` : ""}</dd></div>
            {selectedTask.target === "正文" && <div><dt>生成方式</dt><dd>{contentGenerationModeLabel(selectedTask.contextOptions?.contentMode)}{selectedTask.contextOptions?.contentMode === "rewrite" ? ` · 原文保留 ${rewriteRetentionLabel(selectedTask.contextOptions.rewriteRetention)}` : ""}</dd></div>}
            <div><dt>模型</dt><dd>{modelDisplayLabel(models, selectedTask.model || "", selectedTask.contextOptions?.modelName)}</dd></div>
            <div><dt>阶段</dt><dd>{phaseLabels[selectedTask.phase ?? "queued"]}</dd></div>
            <div><dt>尝试</dt><dd>{selectedTask.attempt ? `${selectedTask.attempt} / 3` : "—"}</dd></div>
            <div><dt>超时</dt><dd>{duration(selectedTask.timeoutMs ?? 600_000)}</dd></div>
            <div><dt>已接收</dt><dd>{(selectedTask.receivedCharacters ?? 0).toLocaleString("zh-CN")} 字符</dd></div>
            <div><dt>提交时间</dt><dd>{taskTime(selectedTask.createdAt)}</dd></div>
            <div><dt>最近更新</dt><dd>{selectedTask.lastProgressAt ? taskTime(selectedTask.lastProgressAt) : "—"}</dd></div>
            <div className="wide"><dt>位置</dt><dd>{selectedArticle?.title ?? "已删除的文章"}{selectedTask.target === "全部名称" ? " / 全章节编辑" : ` / ${selectedChapter?.title ?? "已删除的章节"} / ${selectedOutline ? outlineDisplayTitle(selectedOutline) : "已删除的大纲"}`}</dd></div>
          </dl>
          <section className="task-detail-section"><h3>任务指令</h3><div className="task-detail-copy">{selectedTask.prompt || (selectedTask.target === "全部名称" ? "使用文章命名设置，无补充要求" : "按大纲生成（无补充指令）")}</div></section>
          {selectedTask.contextOptions && <section className="task-detail-section"><h3>生成上下文</h3><div className="task-context-tags">{selectedTask.target === "全部名称" ? <><span>一次模型请求</span><span>{selectedTask.contextOptions.nameChapterCount ?? 0} 个章节名</span><span>{selectedTask.contextOptions.nameOutlineCount ?? 0} 个大纲名</span></> : <><span>{selectedTask.contextOptions.includePrevious ? "包含前面大纲" : "不包含前面大纲"}</span><span>{selectedTask.contextOptions.includeCharacters ? "包含相关人物" : "不包含相关人物"}</span></>}{selectedTask.target === "正文" && <span>{contentGenerationModeLabel(selectedTask.contextOptions.contentMode)}</span>}{selectedTask.target === "正文" && selectedTask.contextOptions.contentMode === "rewrite" && <span>原文保留 {rewriteRetentionLabel(selectedTask.contextOptions.rewriteRetention)}</span>}{selectedTask.target === "正文" && <span>{selectedTask.contextOptions.includeExcellentFragments ? `参考优秀片段 ${selectedTask.contextOptions.excellentFragmentIds?.length ?? 0} 个` : "不参考优秀片段"}</span>}{selectedTask.target === "正文" && <span>{selectedTask.contextOptions.contentMode === "fresh" ? "不发送当前正文" : "包含当前正文"}</span>}{selectedTask.target === "正文" && <span>{selectedTask.contextOptions.includeOutlineTitle ? "同时生成大纲名" : "不生成大纲名"}</span>}{selectedTask.target === "正文" && selectedTask.contextOptions.firstAppearanceCharacterIds && <span>首次出场：{selectedFirstAppearanceNames.length ? selectedFirstAppearanceNames.join("、") : "无"}</span>}{typeof selectedTask.contextOptions.estimatedCharacters === "number" && <span>约 {selectedTask.contextOptions.estimatedCharacters.toLocaleString("zh-CN")} 字符</span>}{selectedTask.contextOptions.sessionId && <span>会话 {selectedTask.contextOptions.sessionId}</span>}</div></section>}
          {selectedTask.contextOptions?.generatedOutlineTitleError && <section className="task-detail-section task-detail-error"><h3>大纲名未应用</h3><div>{selectedTask.contextOptions.generatedOutlineTitleError}。正文已正常保存。</div></section>}
          {selectedTask.error && <section className="task-detail-section task-detail-error"><h3>错误</h3><div>{selectedTask.error}</div></section>}
          <section className="task-detail-section"><h3>任务结果</h3>{selectedResult ? <div className="task-detail-result" aria-label="任务结果">{selectedResult}</div> : <div className="task-detail-empty">{selectedTask.state === "waiting" || selectedTask.state === "running" ? "任务尚未产生结果" : "没有可用结果"}</div>}</section>
        </div>
        <footer className="task-detail-actions">
          <button type="button" onClick={() => locate(selectedTask)}>{selectedTask.target === "全部名称" ? "查看名称候选" : selectedTask.state === "success" && selectedTask.target === "正文" ? "打开生成版本" : "打开对应内容"}</button>
          {(selectedTask.state === "waiting" || selectedTask.state === "running") && <button type="button" onClick={() => cancelTask(selectedTask)}>取消</button>}
          {isForeign(selectedTask) && selectedTask.target !== "AI Chat" && (selectedTask.state === "waiting" || isStale(selectedTask)) && <button type="button" onClick={() => transferTask(selectedTask)}>{transferLabel}</button>}
          {selectedTask.state === "success" && selectedTask.target !== "AI Chat" && selectedTask.target !== "正文" && selectedTask.target !== "全部名称" && <button type="button" onClick={() => applyResult(selectedTask)}>应用结果</button>}
          {(selectedTask.state === "failed" || selectedTask.state === "cancelled" || isStale(selectedTask)) && (selectedTask.target === "AI Chat" ? <button type="button" onClick={() => { studio.setChatDraft(selectedTask.outlineId, selectedTask.prompt); locate(selectedTask); }}>再次发送</button> : <button type="button" onClick={() => retryTask(selectedTask)}>重新执行</button>)}
          {["success", "failed", "cancelled"].includes(selectedTask.state) && <button className="danger-text" type="button" onClick={() => { setSelectedTaskId(""); studio.removeTask(selectedTask.id); }}>移除</button>}
        </footer>
      </section> : <><div className="task-list" data-ui-overlay-scroll>{tasks.map((task) => {
        const article = studio.data.articles.find((item) => item.id === task.articleId);
        const chapter = article?.chapters.find((item) => item.id === task.chapterId);
        const outline = chapter?.outlines.find((item) => item.id === task.outlineId);
        return <article className="task-card" key={task.id}>
          <div className="task-state"><span className={`state-dot ${task.state}`} />{labels[task.state]} · {phaseLabels[task.phase ?? "queued"]} · {formatTime(task.createdAt)}</div>
          <button className="task-title" type="button" aria-label={`查看任务详情：${task.target === "全部名称" ? "整篇章节与大纲命名" : outline ? outlineDisplayTitle(outline) : "已删除的大纲"}`} onClick={() => setSelectedTaskId(task.id)}>{task.target === "全部名称" ? "整篇章节与大纲命名" : outline ? outlineDisplayTitle(outline) : "已删除的大纲"}</button>
          <p>{article?.title ?? "未知文章"}{task.target === "全部名称" ? ` · ${task.contextOptions?.nameChapterCount ?? 0} 章 · ${task.contextOptions?.nameOutlineCount ?? 0} 个大纲` : ` · ${chapter?.title ?? "未知章节"}`} · 目标：{task.target}{task.target === "正文" ? ` · ${contentGenerationModeLabel(task.contextOptions?.contentMode)}${task.contextOptions?.contentMode === "rewrite" ? ` · 原文保留 ${rewriteRetentionLabel(task.contextOptions.rewriteRetention)}` : ""} · ${generateTargetWordsLabel(task.contextOptions?.targetWords)}` : ""}</p>
          <blockquote>{task.prompt || (task.target === "全部名称" ? "使用文章命名设置" : "按大纲生成")}</blockquote>
          {task.error && <p className="task-error">{task.error}</p>}
          <div><span>{modelDisplayLabel(models, task.model || "", task.contextOptions?.modelName)}</span><span className="task-buttons">
            <button type="button" onClick={() => setSelectedTaskId(task.id)}>打开</button>
            {(task.state === "waiting" || task.state === "running") && <button type="button" onClick={() => cancelTask(task)}>取消</button>}
            {isForeign(task) && task.target !== "AI Chat" && (task.state === "waiting" || isStale(task)) && <button type="button" onClick={() => transferTask(task)}>{transferLabel}</button>}
            {task.state === "success" && task.target !== "AI Chat" && task.target !== "正文" && task.target !== "全部名称" && <button type="button" onClick={() => { applyResult(task); locate(task); }}>应用结果</button>}
            {(task.state === "failed" || task.state === "cancelled" || isStale(task)) && (task.target === "AI Chat" ? <button type="button" onClick={() => { studio.setChatDraft(task.outlineId, task.prompt); locate(task); }}>再次发送</button> : <button type="button" onClick={() => retryTask(task)}>重新执行</button>)}
            {["success", "failed", "cancelled"].includes(task.state) && <button type="button" onClick={() => studio.removeTask(task.id)}>移除</button>}
          </span></div>
        </article>;
      })}{!tasks.length && <div className="empty-inline">暂无 AI 任务</div>}</div>
      <footer><span>生成并发 {generateRunningCount} / {studio.data.settings.taskConcurrency}{chatRunningCount ? ` · Chat ${chatRunningCount}` : ""}</span><span className="task-footer-actions"><button type="button" disabled={!completedCount} onClick={() => studio.clearCompletedTasks()}>清空已完成{completedCount ? ` (${completedCount})` : ""}</button><button type="button" onClick={() => { onClose(); window.history.pushState({}, "", "/settings/tasks"); window.dispatchEvent(new PopStateEvent("popstate")); }}>任务设置 →</button></span></footer></>}
    </div>
  </ScrollableDrawer>;
}

function NewArticleDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (fields: Pick<Article, "title" | "summary" | "type" | "style">) => void }) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [type, setType] = useState("");
  const [style, setStyle] = useState("");
  return <ResponsiveModal
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭新建文章" }}
    title="新建文章"
    size="md"
    classNames={{ body: "new-article-dialog-body" }}
  >
    <form className="new-article-form" onSubmit={(event) => { event.preventDefault(); onCreate({ title: title.trim(), summary, type, style }); }}>
      <label>标题 <em>必填</em><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} /></label>
      <label>简介 <textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={10000} /></label>
      <div className="dialog-grid"><label>文章类型<input value={type} onChange={(event) => setType(event.target.value)} maxLength={120} /></label><label>写作风格<input value={style} onChange={(event) => setStyle(event.target.value)} maxLength={5000} /></label></div>
      <footer><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-compact" type="submit" disabled={!title.trim()}>创建文章</button></footer>
    </form>
  </ResponsiveModal>;
}
