"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Drawer,
  Group,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  PasswordInput,
  Select,
  SimpleGrid,
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
import { detectFirstAppearanceCharacters, selectAiContext, summarizeAiContext, type AiContextSummary, type FirstAppearanceSuggestion } from "@/lib/ai-context";
import { resolvedOutlineContentName, timestampContentName } from "@/lib/content-name.mjs";
import { MAX_GENERATE_PRESETS, MAX_GENERATE_PRESET_CHARACTERS, MAX_GENERATE_TARGET_WORDS, MIN_GENERATE_TARGET_WORDS, normalizeGeneratePresets, type ContentGenerationMode } from "@/lib/generate-options";
import { resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";
import { BUILTIN_REVIEW_REQUIREMENTS, MAX_REVIEW_PRESETS, MAX_REVIEW_PRESET_CHARACTERS, normalizeReviewPresets } from "@/lib/review-options";
import { StudioProvider, chatSessionHasUnread, formatTime, useStudio, wordCount, type AiTask, type Article, type Character, type Chapter, type Outline, type Version } from "./studio-state";

type View =
  | "outline-home"
  | "write"
  | "chat"
  | "generate"
  | "chapter"
  | "outline-edit"
  | "read"
  | "search"
  | "info-basic"
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
  return <span className={`icon icon-${name}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{name === "stop" ? <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /> : iconPaths[name].map((path) => <path d={path} key={path} />)}</svg></span>;
}

function clientId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`}`;
}

type ActiveChatStream = { controller: AbortController; cancel: () => void };
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
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

type ConfiguredModel = { id: string; name: string; modelId: string; hasSecret: boolean; timeoutMs: number };

function configuredModelForReference(models: ConfiguredModel[], reference: string) {
  const normalized = reference.trim();
  return models.find((model) => model.id === normalized || model.name === normalized);
}

function canonicalModelReference(models: ConfiguredModel[], reference: string) {
  return configuredModelForReference(models, reference)?.id ?? reference.trim();
}

function modelIdSuffix(value: string) {
  const identifier = value.trim();
  if (!identifier) return "";
  const lastSlash = identifier.lastIndexOf("/");
  return identifier.slice(lastSlash + 1) || identifier;
}

function modelDisplayLabel(models: ConfiguredModel[], selectedModel: string, fixedModelId?: string, fixedModelName?: string) {
  const reference = selectedModel.trim();
  if (!reference) return "本地 PoC 引擎";
  const configured = configuredModelForReference(models, reference);
  const name = fixedModelName?.trim() || configured?.name || reference;
  const identifier = modelIdSuffix(fixedModelId ?? configured?.modelId ?? "");
  return identifier ? `${name} ${identifier}` : name;
}

function chatbotDisplayName(models: ConfiguredModel[], selectedModel: string) {
  const configured = configuredModelForReference(models, selectedModel);
  return modelIdSuffix(configured?.modelId || selectedModel) || "本地 PoC 引擎";
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

const contentGenerationModes: Array<{ value: ContentGenerationMode; label: string; description: string }> = [
  { value: "fresh", label: "全新生成", description: "只依据当前大纲独立创作，不发送现有正文。" },
  { value: "rewrite", label: "改写正文", description: "以现有正文为原稿，返回完整的改写候选。" },
  { value: "continue", label: "续写正文", description: "模型只生成新增部分，保存时自动接到现有正文后。" },
];

function contentGenerationModeLabel(mode?: ContentGenerationMode) {
  return contentGenerationModes.find((item) => item.value === mode)?.label ?? "全新生成";
}

function activeChatSession(outline: Outline) {
  return outline.chat.sessions.find((session) => session.id === outline.chat.activeSessionId) ?? outline.chat.sessions[0];
}

function generateContextSummary(article: Article, outline: Outline, instruction: string, includePrevious: boolean, includeCharacters: boolean, target: "content" | "outline" | "chapter-title" = "content", contentMode: ContentGenerationMode = "fresh", firstAppearanceCharacterIds?: string[]): GenerateContextSummary {
  try {
    const selected = selectAiContext({ articles: [article] }, outline.id, target, { includePrevious, includeCharacters, contentMode, instruction, currentPlan: outline.plan, firstAppearanceCharacterIds });
    return summarizeAiContext({
      ...selected,
      currentOutline: { ...selected.currentOutline, title: outline.title, plan: outline.plan, content: target === "content" && contentMode !== "fresh" ? resolvedOutlineContent(outline) : selected.currentOutline.content },
      chapterOutlines: selected.chapterOutlines.map((item) => item.id === outline.id ? { ...item, title: outline.title, plan: outline.plan } : item),
    }, instruction);
  } catch {
    return { total: 0, article: 0, chapter: 0, chapterOutlines: 0, outline: 0, content: 0, previous: 0, previousCount: 0, chapterOutlineCount: 0, characters: 0, characterCount: 0, previousContent: 0, instruction: instruction.length };
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
  if (pathname.endsWith("/outlines/edit-all")) return "outline-edit";
  if (pathname.endsWith("/outlines")) return "outline-home";
  if (pathname.includes("/chat")) return "chat";
  if (pathname.includes("/generate")) return "generate";
  if (pathname.includes("/chapters/")) return "chapter";
  if (pathname.endsWith("/edit") || pathname.endsWith("/read")) return "read";
  if (pathname.endsWith("/search")) return "search";
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
    "outline-edit": `${base}/outlines/edit-all`,
    read: `${base}/edit`,
    search: `${base}/search`,
    "info-basic": `${base}/info/basic`,
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
  return <StudioProvider><WriterStudioInner /></StudioProvider>;
}

function WriterStudioInner() {
  const studio = useStudio();
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
    if (!studio.data.tasks.some((task) => task.state === "waiting" || task.state === "running")) return;
    const timer = window.setInterval(() => setTaskLeaseTick((value) => value + 1), 3000);
    return () => window.clearInterval(timer);
  }, [studio.data.tasks]);

  useEffect(() => {
    const currentStudio = studioRef.current;
    const currentTime = Date.now();
    const leaseExpired = (task: AiTask) => task.state === "running" && (!task.leaseUntil || new Date(task.leaseUntil).getTime() <= currentTime);
    const runningTasks = currentStudio.data.tasks.filter((task) => task.target !== "AI Chat" && task.state === "running" && !leaseExpired(task));
    const available = Math.max(0, currentStudio.data.settings.taskConcurrency - runningTasks.length);
    const occupiedBodyOutlines = new Set(runningTasks.filter((task) => task.target === "正文").map((task) => task.outlineId));
    const dispatchableTasks: AiTask[] = [];
    for (const task of currentStudio.data.tasks
      .filter((task) => task.target !== "AI Chat" && (task.state === "waiting" || leaseExpired(task)))
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
          if (task.state === "waiting" && !await studioRef.current.saveNow()) return;
          await fetch(`/api/ai/tasks/${encodeURIComponent(task.id)}/execute`, { method: "POST", cache: "no-store" });
        } finally {
          taskDispatches.current.delete(task.id);
          await studioRef.current.refreshFromServer();
        }
      })();
    });
  }, [studio.data.tasks, studio.data.settings.taskConcurrency, taskLeaseTick]);

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
    if (!skipSave && requiresSaveBeforeNavigation && next !== view && !await studio.saveNow()) return;
    const targetArticle = studio.data.articles.find((article) => article.chapters.some((chapter) => chapter.outlines.some((outline) => outline.id === outlineId))) ?? studio.currentArticle;
    const targetChapter = targetArticle.chapters.find((chapter) => chapter.outlines.some((outline) => outline.id === outlineId)) ?? studio.currentChapter;
    setView(next);
    window.history.pushState({}, "", routeFor(next, targetArticle.id, outlineId, targetChapter.id));
    setArticleMenu(false);
    setTaskPanel(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openOutline(outlineId: string, next: "write" | "chat" = "write") {
    if (requiresSaveBeforeNavigation && outlineId !== currentOutline && !await studio.saveNow()) return;
    setPreviewSelection(null);
    studio.setCurrentOutline(outlineId);
    await go(next, outlineId, true);
  }

  const previewVersion = previewSelection?.outlineId === currentOutline ? activeOutline.versions.find((version) => version.id === previewSelection.versionId) : undefined;
  const selectedOutline = { chapter: studio.currentChapter.title, title: activeOutline.title, plan: activeOutline.plan, content: previewVersion?.content ?? resolvedOutlineContent(activeOutline) };
  const isOutlineWorkspaceView = view === "write" || view === "chat" || view === "generate";
  const requiresSaveBeforeNavigation = isOutlineWorkspaceView || view === "outline-edit" || view === "read";
  const mobilePageTitle = view === "search"
    ? "搜索"
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
    return <div className="app-loading" role="status" aria-live="polite"><span className="loading-mark">W</span><strong>正在打开 Writer Studio</strong><p>正在加载文章树和正文…</p><div className="loading-bar"><i /></div></div>;
  }

  if (!studio.data.articles.length) {
    return <div className={`studio-shell empty-library-shell theme-${studio.data.settings.theme}`}><PersistenceNotices /><main className="main-area"><div className="library-empty-state"><span className="empty-library-mark">W</span><h1>创建第一篇文章</h1><button className="primary-compact" type="button" onClick={() => setNewArticle(true)}><Icon name="plus" />新建文章</button></div></main>{newArticle && <NewArticleDialog onClose={() => setNewArticle(false)} onCreate={(fields) => { studio.createArticle(fields); setNewArticle(false); setToast("文章已创建，并生成第一章"); setView(mobileLayout ? "outline-home" : "write"); window.history.pushState({}, "", "/"); }} />}{toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}</div>;
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
        {view === "outline-edit" && <ContinuousDocumentEditor key={`outline-edit:${activeArticle.id}`} mode="outline" onNotice={setToast} />}
        {view === "read" && <ContinuousDocumentEditor key={`content-edit:${activeArticle.id}`} mode="content" onNotice={setToast} />}
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
  const localOutline = studio.conflict?.local.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((outline) => outline.id === studio.conflict?.local.currentOutlineId);
  const serverOutline = studio.conflict?.server.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((outline) => outline.id === studio.conflict?.server.currentOutlineId);
  const comparingPlan = Boolean(localOutline && serverOutline && (localOutline.plan !== serverOutline.plan || localOutline.title !== serverOutline.title));
  const currentLocal = comparingPlan ? localOutline?.plan ?? "" : localOutline ? resolvedOutlineContent(localOutline) : "";
  const currentServer = comparingPlan ? serverOutline?.plan ?? "" : serverOutline ? resolvedOutlineContent(serverOutline) : "";
  const conflictRevision = studio.conflict?.serverRevision ?? -1;
  const copyState = copyFeedback.revision === conflictRevision ? copyFeedback.message : "";
  return <>
    {studio.saveStatus === "failed" && <div className="persistence-banner error" role="alert"><span><strong>保存失败</strong>{studio.saveError || "本地数据库暂时不可用，正文仍保留在本次会话中。"}</span><button type="button" onClick={() => void studio.retrySave()}>重试保存</button></div>}
    <Modal opened={Boolean(studio.conflict)} onClose={() => undefined} withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false} centered={!compact} fullScreen={compact} size="lg" title="处理保存冲突" classNames={{ content: "ws-modal-content conflict-modal", header: "ws-modal-header conflict-modal-header", body: "conflict-modal-body" }} overlayProps={{ backgroundOpacity: 0.48, blur: 3 }}>
      {studio.conflict && <div className="conflict-card"><p>同一项{comparingPlan ? "大纲" : "正文"}在其他窗口或设备上也被修改，请选择要保留的版本。</p><div className="conflict-columns"><section><strong>本机修改</strong><pre tabIndex={0}>{currentLocal.slice(0, 10000) || "（空）"}</pre></section><section><strong>数据库版本</strong><pre tabIndex={0}>{currentServer.slice(0, 10000) || "（空）"}</pre></section></div>{copyState && <div className={`conflict-copy-state ${copyState === "已复制" ? "success" : "error"}`} role="status">{copyState}</div>}<div className="conflict-actions"><Button variant="default" type="button" leftSection={<Icon name="copy" />} onClick={() => void copyTextToClipboard(currentLocal).then((copied) => setCopyFeedback({ revision: conflictRevision, message: copied ? "已复制" : "复制失败，请长按上方文字进行选择" }))}>复制本机内容</Button><Button variant="default" type="button" onClick={() => void studio.resolveConflict("use-server")}>使用数据库版本</Button><Button type="button" onClick={() => void studio.resolveConflict("keep-local")}>保留本机修改</Button></div></div>}
    </Modal>
  </>;
}

type OutlineDropPlacement = "before" | "after";
type OutlineDropIndicator = { targetId: string; placement: OutlineDropPlacement } | null;

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
            <button className="new-article-link" type="button" onClick={onNewArticle}><Icon name="plus" /> 新建文章</button>
          </div>
        )}

        <div className="sidebar-primary">
          <button className="primary-button" type="button" onClick={() => { const id = studio.createOutline(); onOutline(id); onNotice("已新建大纲"); }}><Icon name="plus" />新建大纲</button>
          <nav className="quick-links" aria-label="文章功能">
            <button className={view === "search" ? "active" : ""} onClick={() => onGo("search")} type="button"><Icon name="search" />搜索</button>
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
            {draggingOutline && <div className="desktop-outline-drag-overlay"><span className="outline-grip-dots" aria-hidden="true" /><strong>{outlineDisplayTitle(draggingOutline)}</strong></div>}
          </DragOverlay>
        </DndContext>

        <div className="sidebar-footer">
          <button className={view.startsWith("settings-") ? "active" : ""} type="button" onClick={() => onGo("settings-general")}><Icon name="settings" /><span>设置</span></button>
          <button type="button" onClick={onTask}><Icon name="tasks" /><span>AI 任务</span>{studio.data.tasks.some((task) => task.state === "waiting" || task.state === "running") && <b>{studio.data.tasks.filter((task) => task.state === "waiting" || task.state === "running").length}</b>}</button>
        </div>
        <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" onPointerDown={startResize} />
      </aside>
      {outlineMenu && <DesktopOutlineMenu outline={outlineMenu} onClose={() => setOutlineMenu(null)} onOpenChat={() => { studio.setCurrentOutline(outlineMenu.id); setOutlineMenu(null); onOutline(outlineMenu.id); onGo("chat"); }} onGenerate={() => { setStructureGenerate({ kind: "outline", id: outlineMenu.id, title: outlineDisplayTitle(outlineMenu) }); setOutlineMenu(null); }} onNotice={onNotice} />}
      {chapterMenu && <ChapterActionSheet chapter={chapterMenu} onClose={() => setChapterMenu(null)} onNotice={onNotice} onOpenOutline={onOutline} onGenerate={() => { setStructureGenerate({ kind: "chapter", id: chapterMenu.id, title: chapterMenu.title }); setChapterMenu(null); }} />}
      {structureGenerate && <StructureGenerateSheet target={structureGenerate} onClose={() => setStructureGenerate(null)} onApplied={(message, result, generatedTitle) => { if (structureGenerate.kind === "chapter") studio.updateChapter(structureGenerate.id, { title: result.slice(0, 120) }); else studio.updateOutline(structureGenerate.id, { plan: result, ...(generatedTitle ? { title: generatedTitle, titleGenerationPending: false } : {}) }); onNotice(message); setStructureGenerate(null); }} />}
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
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const articles = studio.data.articles.filter((article) => !normalizedQuery || `${article.title}${article.summary}`.toLocaleLowerCase().includes(normalizedQuery));

  return <Drawer
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
      <button type="button" onClick={() => onGo("outline-edit")}><Icon name="edit" /><span>全大纲编辑</span></button>
      <button type="button" onClick={() => onGo("read")}><Icon name="read" /><span>全文编辑</span></button>
      <button type="button" onClick={() => onGo("search")}><Icon name="search" /><span>搜索</span></button>
      <button type="button" onClick={() => onGo("info-basic")}><Icon name="info" /><span>文章资料</span></button>
    </nav>
    <TextInput className="mobile-article-search" aria-label="搜索文章" placeholder="搜索文章" leftSection={<Icon name="search" />} value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="mobile-article-list" role="list" aria-label="文章列表">
      {articles.map((article) => <button className={article.id === studio.currentArticle.id ? "selected" : ""} type="button" role="listitem" aria-current={article.id === studio.currentArticle.id ? "true" : undefined} key={article.id} onClick={() => void onSelect(article.id)}>
        <span className="article-mark">{article.title[0]}</span>
        <strong>{article.title}</strong>
        {article.id === studio.currentArticle.id && <Icon name="check" />}
      </button>)}
      {!articles.length && <div className="empty-inline">没有匹配的文章</div>}
    </div>
    <Button className="mobile-new-article" variant="default" fullWidth leftSection={<Icon name="plus" />} onClick={onNewArticle}>新建文章</Button>
  </Drawer>;
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
          <span><strong>{articleTitle}</strong></span>
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
            <button className="primary-compact" type="button" onClick={() => { const id = studio.createOutline(); onNotice("已在当前章节末尾新建大纲"); onOutline(id); }}><Icon name="plus" />新建大纲</button>
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
                <button className="mobile-chapter-title" type="button" onClick={() => { if (group.items[0]) studio.setCurrentOutline(group.items[0].id); onChapter(); }}><span>第 {groupIndex + 1} 章</span><strong>{group.title.replace(/^第.+?·\s*/, "")}</strong></button>
                <span className="chapter-count">{group.items.length}</span>
                <IconButton name="more" label={`${group.title}更多操作`} aria-haspopup="dialog" aria-expanded={chapterMenu?.id === group.id} onClick={() => setChapterMenu(group)} />
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
            {draggingOutline && <div className="mobile-outline-drag-overlay"><span className="outline-number">↕</span><strong>{outlineDisplayTitle(draggingOutline)}</strong></div>}
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
      />}
      {editTarget && <OutlineEditSheet target={editTarget} onClose={() => setEditTarget(null)} onSave={(title, plan) => {
        const normalizedTitle = normalizeOutlineTitle(title);
        studio.updateOutline(editTarget.id, { title: normalizedTitle, plan });
        onNotice(`已更新大纲「${outlineDisplayTitle({ title: normalizedTitle, plan })}」；正文和版本保持不变`);
        setEditTarget(null);
      }} />}
      {structureGenerate && <StructureGenerateSheet target={structureGenerate} onClose={() => setStructureGenerate(null)} onApplied={(message, result, generatedTitle) => {
        if (structureGenerate.kind === "chapter") studio.updateChapter(structureGenerate.id, { title: result.slice(0, 120) });
        else studio.updateOutline(structureGenerate.id, { plan: result, ...(generatedTitle ? { title: generatedTitle, titleGenerationPending: false } : {}) });
        onNotice(message);
        setStructureGenerate(null);
      }} />}
      {chapterMenu && <ChapterActionSheet chapter={chapterMenu} onClose={() => setChapterMenu(null)} onNotice={onNotice} onOpenOutline={onOutline} onGenerate={() => { setStructureGenerate({ kind: "chapter", id: chapterMenu.id, title: chapterMenu.title }); setChapterMenu(null); }} />}
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
          <strong>{displayTitle}</strong>
          {item.state !== "saved" && <span>{item.state === "running" ? "AI Generate 运行中" : "生成失败"}</span>}
        </button>
        {item.state !== "saved" && <span className={`state-dot ${item.state}`} />}
        <IconButton name="more" label={`${displayTitle}更多操作`} aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onMore} />
      </div>
    </div>
  );
}

function OutlineActionSheet({ title, archived, onClose, onEdit, onGenerate, onChat, onCopy, onMove, onMoveUp, onMoveDown, onArchive, onDelete }: { title: string; archived: boolean; onClose: () => void; onEdit: () => void; onGenerate: () => void; onChat: () => void; onCopy: () => void; onMove: () => void; onMoveUp?: () => void; onMoveDown?: () => void; onArchive: () => void; onDelete: () => void }) {
  const actions: Array<{ key: string; icon: IconName; label: string; danger?: boolean }> = [
    { key: "edit", icon: "edit", label: "编辑大纲" },
    { key: "chat", icon: "chat", label: "AI Chat 大纲" },
    { key: "generate", icon: "spark", label: "AI Generate 大纲" },
    { key: "copy", icon: "copy", label: "复制大纲内容" },
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
    else if (key === "move-up") onMoveUp?.();
    else if (key === "move-down") onMoveDown?.();
    else if (key === "move") onMove();
    else if (key === "archive") onArchive();
    else if (key === "delete") onDelete();
  }
  return <Drawer
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭大纲操作" }}
    title={<div className="ws-drawer-title"><span>大纲操作</span><strong>{title}</strong></div>}
    position="bottom"
    size="auto"
    classNames={{ content: "ws-drawer-content outline-action-drawer", header: "ws-drawer-header", body: "outline-action-drawer-body" }}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
  >
    <div className="sheet-actions">{actions.map((action) => <button className={`${action.key === "generate" ? "ai-structure-action" : action.key === "chat" ? "ai-chat-action" : ""} ${action.danger ? "sheet-danger" : ""}`.trim()} key={action.key} type="button" onClick={() => handle(action.key)}><span><Icon name={action.icon} /></span><strong>{action.label}</strong></button>)}</div>
  </Drawer>;
}

function DesktopOutlineMenu({ outline, onClose, onOpenChat, onGenerate, onNotice }: { outline: Outline; onClose: () => void; onOpenChat: () => void; onGenerate: () => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
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
    ...(previousOutline ? [["上移一位", () => { studio.moveOutline(outline.id, previousOutline.id, "before"); onNotice(`已上移「${displayTitle}」`); }] as [string, () => void]] : []),
    ...(nextOutline ? [["下移一位", () => { studio.moveOutline(outline.id, nextOutline.id, "after"); onNotice(`已下移「${displayTitle}」`); }] as [string, () => void]] : []),
    ["移动到章节", () => {
      const answer = window.prompt(studio.currentArticle.chapters.map((item, index) => `${index + 1}. ${item.title}`).join("\n"), "1");
      const target = studio.currentArticle.chapters[Number(answer) - 1];
      if (target) { studio.moveOutlineToChapter(outline.id, target.id); onNotice(`已移动到「${target.title}」`); }
    }],
    [outline.archived ? "恢复" : "归档", () => { studio.updateOutline(outline.id, { archived: !outline.archived }); onNotice(outline.archived ? "大纲已恢复" : "大纲已归档"); }],
  ];
  return <div className="desktop-action-layer"><button className="modal-scrim" type="button" aria-label="关闭大纲菜单" onClick={onClose} /><aside className="desktop-action-menu" role="dialog" aria-modal="true" aria-label={`大纲操作：${displayTitle}`}><header><span>大纲操作</span><strong>{displayTitle}</strong></header>{items.map(([label, action]) => <button type="button" key={label} onClick={() => { action(); onClose(); }}><strong>{label}</strong></button>)}<button className="danger" type="button" onClick={() => { if (window.confirm(`删除「${displayTitle}」及其正文、版本和聊天？`)) { studio.deleteOutline(outline.id); onNotice("大纲已删除"); onClose(); } }}>删除大纲</button></aside></div>;
}

function ChapterActionSheet({ chapter, onClose, onNotice, onOpenOutline, onGenerate }: { chapter: Chapter; onClose: () => void; onNotice: (message: string) => void; onOpenOutline: (id: string) => void; onGenerate: () => void }) {
  const studio = useStudio();
  const items = [
    ["重命名", () => { const title = window.prompt("章节标题", chapter.title); if (title?.trim()) { studio.updateChapter(chapter.id, { title: title.trim().slice(0, 120) }); onNotice("章节已重命名"); } }],
    ["AI Generate 章节标题", onGenerate],
    ["新建大纲", () => { const id = studio.createOutline(chapter.id); onOpenOutline(id); }],
    ["上移", () => studio.moveChapter(chapter.id, -1)],
    ["下移", () => studio.moveChapter(chapter.id, 1)],
    [chapter.archived ? "恢复章节" : "归档章节", () => studio.updateChapter(chapter.id, { archived: !chapter.archived })],
  ] as const;
  return <div className="desktop-action-layer"><button className="modal-scrim" type="button" aria-label="关闭章节菜单" onClick={onClose} /><aside className="desktop-action-menu" role="dialog" aria-modal="true" aria-label={`章节操作：${chapter.title}`}><header><span>章节操作</span><strong>{chapter.title}</strong></header>{items.map(([label, action]) => <button type="button" key={label} onClick={() => { action(); onClose(); }}><strong>{label}</strong></button>)}<button className="danger" type="button" onClick={() => { const typed = window.prompt(`章节包含 ${chapter.outlines.length} 条大纲。输入章节标题以确认删除：`, ""); if (typed === chapter.title) { studio.deleteChapter(chapter.id); onNotice("章节已删除"); onClose(); } }}>删除章节</button></aside></div>;
}

function OutlineEditSheet({ target, onClose, onSave }: { target: { id: string; title: string; plan: string }; onClose: () => void; onSave: (title: string, plan: string) => void }) {
  const [title, setTitle] = useState(target.title);
  const [plan, setPlan] = useState(target.plan);
  const automaticTitle = outlineDisplayTitle({ title: "", plan });
  return <Drawer
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
  </Drawer>;
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
  const [selectedModel, setSelectedModel] = useState(studio.data.settings.generateModel);
  const selectedModelReference = canonicalModelReference(models, selectedModel);
  const targetChapter = studio.currentArticle.chapters.find((chapter) => isChapter ? chapter.id === target.id : chapter.outlines.some((outline) => outline.id === target.id));
  const targetOutline = isChapter ? targetChapter?.outlines.find((outline) => !outline.archived) : targetChapter?.outlines.find((outline) => outline.id === target.id);
  const currentValue = isChapter ? targetChapter?.title ?? target.title : targetOutline?.plan ?? "";
  const contextSummary = targetChapter && targetOutline ? generateContextSummary(studio.currentArticle, targetOutline, prompt, true, true, isChapter ? "chapter-title" : "outline") : null;
  async function generate() {
    const outlineId = targetOutline?.id;
    if (!outlineId) { setError("该章节还没有可用大纲"); return; }
    if (!await studio.saveNow()) { setError("请先解决当前保存问题再生成"); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/ai/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outlineId, instruction: prompt.trim(), model: selectedModelReference, target: isChapter ? "chapter-title" : "outline", includePrevious: true, includeCharacters: true }) });
      const payload = await response.json() as { text?: string; outlineTitle?: string; error?: string };
      if (!response.ok || !payload.text) throw new Error(payload.error || "生成失败");
      setResult(payload.text);
      setGeneratedSourceText(payload.text.trim());
      setGeneratedOutlineTitle(normalizeOutlineTitle(payload.outlineTitle));
      setGenerated(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "生成失败"); }
    finally { setLoading(false); }
  }
  return <div className="outline-sheet-layer"><button className="outline-sheet-scrim" type="button" aria-label="关闭结构生成" onClick={onClose} /><aside className="structure-generate-sheet"><div className="sheet-grabber" /><header><div className="structure-generate-icon"><Icon name="spark" /></div><div><span>AI Generate · 文章结构</span><strong>{isChapter ? "生成章节标题" : "生成大纲内容"}</strong><small>{target.title}</small></div><IconButton name="close" label="关闭生成" onClick={onClose} /></header><div className="structure-context"><Icon name="book" /><strong>上下文 · {contextSummary?.total.toLocaleString("zh-CN") ?? "—"} 字符</strong></div><details className="structure-current"><summary>{isChapter ? "当前章节标题" : "当前大纲内容"}</summary><p>{currentValue || "（当前内容为空）"}</p></details><label>生成要求<textarea maxLength={20000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入生成要求" /></label><label className="structure-model">本次模型<select value={selectedModelReference} onChange={(event) => setSelectedModel(event.target.value)}><option value="">本地 PoC 引擎</option>{selectedModelReference && !configuredModelForReference(models, selectedModelReference) && <option value={selectedModelReference}>{selectedModelReference}</option>}{models.map((model) => <option value={model.id} key={model.id}>{modelDisplayLabel(models, model.id)}{model.hasSecret ? "" : "（需密钥）"}</option>)}</select></label>{error && <p className="task-error" role="alert">{error}</p>}{generated && <div className="structure-compare"><section><span>当前内容</span><p>{currentValue || "（空）"}</p></section><section><span>生成预览</span>{isChapter ? <input value={result} onChange={(event) => setResult(event.target.value)} /> : <textarea value={result} onChange={(event) => setResult(event.target.value)} />}</section></div>}<footer><button className="secondary-button" type="button" onClick={onClose}>取消</button>{generated ? <><button className="secondary-button" type="button" onClick={() => void generate()}>重新生成</button><button className="primary-compact" type="button" disabled={!result.trim()} onClick={() => onApplied(isChapter ? "已应用新的章节标题" : `已应用「${target.title}」的大纲内容`, result.trim(), !isChapter && result.trim() === generatedSourceText ? generatedOutlineTitle : undefined)}>应用结果</button></> : <button className="primary-compact" type="button" disabled={!prompt.trim() || loading} onClick={() => void generate()}><Icon name="spark" />{loading ? "正在生成…" : "生成预览"}</button>}</footer></aside></div>;
}

function MobileHeader({ title, status, onBack, onVersions, showVersions }: { title: string; status: string; onBack: () => void; onVersions: () => void; showVersions: boolean }) {
  return (
    <div className="mobile-header">
      <IconButton name="back" label="返回大纲" variant="glass" size="large" className="mobile-back-button" onClick={onBack} />
      <div><strong>{title}</strong><span>{status}</span></div>
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
        ) : <strong>专注写作</strong>}
        <div className="workspace-meta">
          <span className={`save-state ${studio.saveStatus}`}><i /> {saveStatusLabel(studio.saveStatus)}</span>
          <span>{wordCount(outline.content)} 字</span>
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
      {mode === "chat" && <ChatView outlineTitle={displayTitle} onNotice={onNotice} onUseAsGenerate={(text) => { setGenerateSeed(text); void onMode("generate"); }} />}
      {mode === "generate" && <GenerateView outline={outline} initialPrompt={generateSeed} onTaskCreated={onTaskCreated} onOpenTasks={onOpenTasks} />}
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
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editingRef = useRef(false);
  const draftRef = useRef("");
  const baselineRef = useRef("");
  const draftSavedAtRef = useRef("");
  const preservingRef = useRef(false);
  const studioRef = useRef(studio);
  studioRef.current = studio;
  const editingOutlineId = studio.currentOutline.id;
  const defaultVersion = !previewVersion && !studio.currentOutline.contentOverride && studio.currentOutline.sourceVersionId
    ? studio.currentOutline.versions.find((version) => version.id === studio.currentOutline.sourceVersionId)
    : undefined;
  const displayedVersion = previewVersion ?? defaultVersion;
  const displayedIsDefault = Boolean(displayedVersion && !studio.currentOutline.contentOverride && displayedVersion.id === studio.currentOutline.sourceVersionId);
  const planSnapshot = displayedVersion?.outlineSnapshot;
  const plan = planSnapshot?.plan ?? "";
  const displayedContent = previewVersion?.content ?? resolvedOutlineContent(studio.currentOutline);
  const displayedContentName = displayedVersion?.name ?? resolvedOutlineContentName(studio.currentOutline);
  const content = editing ? draftContent : displayedContent;

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
    baselineRef.current = displayedContent;
    draftRef.current = displayedContent;
    draftSavedAtRef.current = new Date().toISOString();
    preservingRef.current = false;
    editingRef.current = true;
    setDraftContent(displayedContent);
    setEditing(true);
    window.requestAnimationFrame(() => editorRef.current?.focus());
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
    const saved = await studio.saveCurrentContent(studio.currentOutline.id, draftRef.current);
    setSavingEdit(false);
    if (!saved) return;
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

  async function setDisplayedContentAsDefault() {
    if (!displayedContent.trim() || displayedIsDefault || settingDefault) return;
    setSettingDefault(true);
    const versionId = previewVersion?.id ?? studio.saveVersion(
      studio.currentOutline.id,
      resolvedOutlineContentName(studio.currentOutline),
      "手动",
      displayedContent,
    );
    studio.setDefaultVersion(studio.currentOutline.id, versionId);
    onClearPreview();
    const saved = await studio.saveNow();
    setSettingDefault(false);
    onNotice(saved ? "已设为默认正文" : "设置默认正文未完成，请查看保存状态");
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
          <div className="editor-heading"><span title={displayedContentName}>{displayedContentName}</span><div>{editing ? <><IconButton name="search" label="查找正文" title="查找" size="small" onClick={() => setFindOpen((value) => !value)} /><IconButton name="copy" label="复制正文" title="复制" size="small" onClick={() => void copyEditingContent()} /><IconButton name="paste" label="粘贴正文" title="粘贴" size="small" onClick={() => void pasteEditingContent()} /><IconButton name="save" label="保存正文" title="保存" size="small" disabled={savingEdit} onClick={() => void saveEditing()} /><IconButton name="saveAs" label="另存为正文" title="另存为" size="small" onClick={() => void saveAsEditingContent()} /><button className="finish-edit-button" type="button" onClick={requestExitEditing}>退出编辑</button></> : <><button className="set-default-body-button" type="button" disabled={!displayedContent.trim() || displayedIsDefault || settingDefault} aria-label={displayedIsDefault ? "当前正文已是默认正文" : displayedVersion ? `将“${displayedVersion.name}”设为默认正文` : "将当前正文设为默认正文"} onClick={() => void setDisplayedContentAsDefault()}><Icon name="check" />{displayedIsDefault ? "已默认" : settingDefault ? "设置中" : "设为默认"}</button><button className="start-edit-button" type="button" onClick={beginEditing}><Icon name="edit" />编辑</button></>}</div></div>
          {findOpen && editing && <div className="find-bar"><input autoFocus value={findQuery} onChange={(event) => { setFindQuery(event.target.value); setMatchIndex(0); }} placeholder="查找…" aria-label="查找正文" /><input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="替换为…" aria-label="替换内容" /><label><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />Aa</label><span>{matches.length ? `${Math.min(matchIndex + 1, matches.length)} / ${matches.length}` : "0 / 0"}</span><button type="button" onClick={() => selectMatch(matchIndex - 1)}>上一个</button><button type="button" onClick={() => selectMatch(matchIndex + 1)}>下一个</button><button type="button" onClick={replaceCurrent}>替换</button><button type="button" onClick={replaceAll}>全部</button><IconButton name="close" label="关闭查找" onClick={() => setFindOpen(false)} /></div>}
          {editing ? <textarea ref={editorRef} className="content-editor" value={draftContent} onChange={(event) => changeDraft(event.target.value)} aria-label="正文编辑器" placeholder="从这里开始写作…" spellCheck={false} style={{ fontSize: studio.data.settings.fontSize, lineHeight: studio.data.settings.lineHeight, fontFamily: studio.data.settings.editorFont === "serif" ? "Georgia, 'Noto Serif SC', serif" : undefined, maxWidth: studio.data.settings.contentWidth }} /> : <div className="content-reader" role="region" aria-label="正文内容" style={{ fontSize: studio.data.settings.fontSize, lineHeight: studio.data.settings.lineHeight, fontFamily: studio.data.settings.editorFont === "serif" ? "Georgia, 'Noto Serif SC', serif" : undefined, maxWidth: studio.data.settings.contentWidth }}>{content || "（正文为空）"}</div>}
        </section>
      </div>
      {planPeek && <div className="plan-peek-layer"><button className="outline-sheet-scrim" type="button" aria-label="关闭此正文大纲" onClick={() => setPlanPeek(false)} /><aside><div className="sheet-grabber" /><header><div><span>{planSnapshot?.title ? `生成时大纲 · ${planSnapshot.title}` : "正文版本"}</span><strong>此正文大纲</strong></div><IconButton name="close" label="关闭此正文大纲" onClick={() => setPlanPeek(false)} /></header><p aria-label="此正文大纲内容">{plan || "此版本未保存生成时的大纲内容"}</p><button type="button" onClick={() => setPlanPeek(false)}>返回正文</button></aside></div>}
      <Modal opened={exitPromptOpen} onClose={() => setExitPromptOpen(false)} closeButtonProps={{ "aria-label": "继续编辑正文" }} title="保存正文修改？" centered size="sm" classNames={{ content: "ws-modal-content", header: "ws-modal-header" }} overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}>
        <Group justify="flex-end" gap="sm"><Button variant="default" type="button" onClick={() => setExitPromptOpen(false)}>继续编辑</Button><Button variant="default" color="red" type="button" onClick={discardEditing}>放弃修改</Button><Button type="button" loading={savingEdit} onClick={() => void saveEditing()}>保存修改</Button></Group>
      </Modal>
    </div>
  );
}

function GenerateView({ outline, initialPrompt = "", onTaskCreated, onOpenTasks }: { outline: { title: string; plan: string; content: string }; initialPrompt?: string; onTaskCreated: () => void; onOpenTasks: () => void }) {
  const studio = useStudio();
  const displayTitle = outlineDisplayTitle(outline);
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const models = useConfiguredModels();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [contextOpen, setContextOpen] = useState(false);
  const [appearanceEditorOpen, setAppearanceEditorOpen] = useState(false);
  const [appearanceOverrides, setAppearanceOverrides] = useState<Record<string, boolean>>({});
  const [includePrevious, setIncludePrevious] = useState(true);
  const [includeCharacters, setIncludeCharacters] = useState(true);
  const [generationMode, setGenerationMode] = useState<ContentGenerationMode>("fresh");
  const [selectedModel, setSelectedModel] = useState(studio.data.settings.generateModel);
  const [notice, setNotice] = useState("");
  const [presetManagerOpen, setPresetManagerOpen] = useState(false);
  const [targetWordsInput, setTargetWordsInput] = useState(String(studio.data.settings.generateTargetWords));
  const [outlinePlanDraft, setOutlinePlanDraft] = useState(outline.plan);
  const outlinePlanDraftRef = useRef(outline.plan);
  const lastSyncedOutlineRef = useRef({ id: studio.currentOutline.id, plan: outline.plan });
  const [outlineSaving, setOutlineSaving] = useState(false);
  const parsedTargetWords = Number(targetWordsInput);
  const targetWords = Number.isInteger(parsedTargetWords) && parsedTargetWords >= MIN_GENERATE_TARGET_WORDS && parsedTargetWords <= MAX_GENERATE_TARGET_WORDS ? parsedTargetWords : studio.data.settings.generateTargetWords;
  const hasCurrentContent = Boolean(resolvedOutlineContent(studio.currentOutline).trim());
  const outlinePlanDirty = outlinePlanDraft !== outline.plan;
  useEffect(() => {
    const previous = lastSyncedOutlineRef.current;
    if (previous.id !== studio.currentOutline.id || outlinePlanDraftRef.current === previous.plan) {
      outlinePlanDraftRef.current = outline.plan;
      setOutlinePlanDraft(outline.plan);
      if (previous.id !== studio.currentOutline.id) setAppearanceOverrides({});
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
  const summary = useMemo(() => generateContextSummary(studio.currentArticle, { ...studio.currentOutline, plan: outlinePlanDraft }, prompt, includePrevious, includeCharacters, "content", generationMode, firstAppearanceCharacterIds), [studio.currentArticle, studio.currentOutline, outlinePlanDraft, prompt, includePrevious, includeCharacters, generationMode, firstAppearanceCharacterIds]);
  const outlineTasks = studio.data.tasks.filter((task) => task.outlineId === studio.currentOutline.id && task.target === "正文");
  const activeTasks = outlineTasks.filter((task) => task.state === "waiting" || task.state === "running").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const latestFailed = outlineTasks.find((task) => task.state === "failed");
  const selectedRecord = configuredModelForReference(models, selectedModel);
  const selectedModelReference = selectedRecord?.id ?? selectedModel.trim();
  const defaultGenerateModelReference = canonicalModelReference(models, studio.data.settings.generateModel);
  const modelOptions = [
    { value: "", label: "本地 PoC 引擎" },
    ...(selectedModelReference && !selectedRecord ? [{ value: selectedModelReference, label: selectedModelReference }] : []),
    ...models.map((model) => ({ value: model.id, label: `${modelDisplayLabel(models, model.id)}${model.hasSecret ? "" : "（需密钥）"}` })),
  ];

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
    const effectiveFirstAppearanceIds = includeCharacters ? firstAppearanceCharacterIds : [];
    const appearanceSnapshot = JSON.stringify([...effectiveFirstAppearanceIds].sort());
    const duplicate = studio.data.tasks.find((task) => task.outlineId === studio.currentOutline.id && task.target === "正文" && task.prompt === prompt.trim() && (task.contextOptions?.targetWords ?? 5000) === targetWords && (task.contextOptions?.contentMode ?? "fresh") === generationMode && JSON.stringify([...(task.contextOptions?.firstAppearanceCharacterIds ?? [])].sort()) === appearanceSnapshot && Date.now() - new Date(task.createdAt).getTime() < 3000);
    if (duplicate) { setNotice("相同生成请求已在队列中。"); return; }
    if (!await saveOutlineDraft() || !await studio.saveNow()) return;
    const taskId = studio.addTask({ articleId: studio.currentArticle.id, chapterId: studio.currentChapter.id, outlineId: studio.currentOutline.id, target: "正文", prompt: prompt.trim().slice(0, 20000), model: selectedModelReference, phase: "queued", attempt: 0, receivedCharacters: 0, timeoutMs: selectedRecord?.timeoutMs ?? 600_000, contextOptions: { includePrevious, includeCharacters, estimatedCharacters: summary.total, targetWords, contentMode: generationMode, outlinePlanSnapshot: outlinePlanDraft, outlineTitleSnapshot: studio.currentOutline.title, modelId: selectedRecord?.modelId, modelName: selectedRecord?.name, firstAppearanceCharacterIds: effectiveFirstAppearanceIds } });
    if (!taskId) { window.alert("已有 20 个等待或运行中的任务，请先取消一个任务后再生成。"); return; }
    setPrompt("");
    setNotice("");
    onTaskCreated();
  }, [prompt, studio, selectedModelReference, selectedRecord?.modelId, selectedRecord?.name, selectedRecord?.timeoutMs, includePrevious, includeCharacters, firstAppearanceCharacterIds, summary.total, targetWords, generationMode, hasCurrentContent, outlinePlanDraft, onTaskCreated, saveOutlineDraft]);

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
                return <button className={generationMode === item.value ? "selected" : ""} type="button" role="radio" aria-checked={generationMode === item.value} disabled={disabled} key={item.value} onClick={() => setGenerationMode(item.value)}><strong>{item.label}</strong><span>{item.description}</span></button>;
              })}
            </div>
            {!hasCurrentContent && <p className="generate-mode-hint">当前正文为空，只能使用全新生成。</p>}
          </section>
          <div className="generate-option-bar">
            <NumberInput className="generate-word-count" label={generationMode === "continue" ? "新增目标字数" : "目标字数"} aria-label={generationMode === "continue" ? "续写新增目标字数" : "正文目标字数"} min={MIN_GENERATE_TARGET_WORDS} max={MAX_GENERATE_TARGET_WORDS} step={100} thousandSeparator="," suffix=" 字" value={targetWordsInput} onChange={(value) => { const next = String(value); setTargetWordsInput(next); const parsed = Number(next); if (Number.isInteger(parsed) && parsed >= MIN_GENERATE_TARGET_WORDS && parsed <= MAX_GENERATE_TARGET_WORDS) studio.updateSettings({ generateTargetWords: parsed }); }} onBlur={() => setTargetWordsInput(String(studio.data.settings.generateTargetWords))} />
            <Button className="manage-generate-presets" variant="default" size="sm" onClick={() => setPresetManagerOpen(true)}>管理预设</Button>
          </div>
          {studio.data.settings.generatePresets.length > 0 && <div className="generate-quick-prompts" aria-label="自定义预设场景">{studio.data.settings.generatePresets.map((item) => <Button variant="light" size="compact-sm" type="button" key={item} onClick={() => setPrompt(item)}>{item}</Button>)}</div>}
          <section className="generate-first-appearance" aria-label="首次出场人物">
            <div className="generate-first-appearance-heading">
              <div><span>人物出场</span><strong>首次出场人物</strong><small>根据当前及前序大纲中的姓名、别名推测</small></div>
              <Button variant="default" size="compact-sm" type="button" onClick={() => setAppearanceEditorOpen(true)}>编辑</Button>
            </div>
            {includeCharacters ? firstAppearanceCharacters.length > 0
              ? <div className="generate-first-appearance-tags">{firstAppearanceCharacters.map((character) => <span key={character.id}>{character.name}</span>)}</div>
              : <p>未推测到首次出场人物，可点击“编辑”手动指定。</p>
              : <p>人物上下文已关闭，本次生成不会发送首次出场信息。</p>}
          </section>
          <div className="generate-prompt-label"><span>补充指令（可选） <small>{prompt.length.toLocaleString("zh-CN")} / 20,000</small></span><Textarea maxLength={20000} autosize minRows={4} maxRows={10} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={generationMode === "rewrite" ? "说明改写方向和需要保留的内容" : generationMode === "continue" ? "说明接下来要发生的情节或节奏" : "补充生成要求"} /></div>
          <div className="generate-submit-row">
            <button className="generate-context-summary" type="button" onClick={() => setContextOpen(true)}><Icon name="book" /><span><strong>{contentGenerationModeLabel(generationMode)} · 上下文 {summary.total.toLocaleString("zh-CN")} 字符</strong><small>前面大纲 {summary.previousCount} 条 · 当前正文 {generationMode === "fresh" ? "不发送" : `${summary.content.toLocaleString("zh-CN")} 字符`} · 人物 ${summary.characterCount} 位</small></span><Icon name="chevron" /></button>
            <div className="generate-model-control"><Select label="本次模型" data={modelOptions} value={selectedModelReference} allowDeselect={false} onChange={(value) => setSelectedModel(value ?? "")} /><small>{selectedModelReference ? selectedRecord?.hasSecret ? "● 可用" : "需要载入密钥" : "● 本地可用"}</small></div>
            <Button className="generate-submit-button" leftSection={<Icon name="spark" />} size="md" type="button" disabled={generationMode !== "fresh" && !hasCurrentContent} onClick={() => void submit()}>开始生成</Button>
          </div>
          <p className="generate-auto-apply-note">任务成功后会自动设为该大纲的当前正文，并保留在正文版本中。</p>
          {selectedModelReference !== defaultGenerateModelReference && <button className="set-default-model" type="button" onClick={() => studio.updateSettings({ generateModel: selectedModelReference })}>将“{selectedRecord?.name || selectedModelReference || "本地 PoC 引擎"}”设为默认</button>}
        </section>

        <Drawer
          opened={contextOpen}
          onClose={() => setContextOpen(false)}
          closeButtonProps={{ "aria-label": "关闭生成上下文" }}
          title="本次生成上下文"
          position={compact ? "bottom" : "right"}
          size={compact ? "80dvh" : 430}
          classNames={{ content: "ws-drawer-content", header: "ws-drawer-header", body: "ws-drawer-body" }}
          overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
        >
          <div className="generate-context-panel" aria-label="正文生成上下文">
            <Text size="xs" c="dimmed">预计发送 {summary.total.toLocaleString("zh-CN")} 字符</Text>
            <ContextCard summary={summary} contentMode={generationMode} includePrevious={includePrevious} includeCharacters={includeCharacters} onPrevious={setIncludePrevious} onCharacters={setIncludeCharacters} />
            <div className="context-preview"><span>当前大纲</span><strong>{displayTitle}</strong><p>{outlinePlanDraft || "尚未填写大纲内容"}</p></div>
          </div>
        </Drawer>

        <section className="generate-task-section">
          <div className="generate-results-title"><div><span>任务</span><h3>进行中</h3></div><button type="button" onClick={onOpenTasks}>查看全部 AI 任务 →</button></div>
          {activeTasks.map((task, index) => <article className="generation-card running-card" key={task.id}><div className="generation-state"><span className={`state-dot ${task.state}`} />{task.state === "waiting" ? `等待中 · 队列第 ${index + 1} 位` : "正在生成"}</div><strong>{task.prompt || "按大纲生成"}</strong><p>{contentGenerationModeLabel(task.contextOptions?.contentMode)} · {modelDisplayLabel(models, task.model || "", task.contextOptions?.modelId, task.contextOptions?.modelName)} · 目标 {(task.contextOptions?.targetWords ?? 5000).toLocaleString("zh-CN")} 字 · 上下文约 {task.contextOptions?.estimatedCharacters?.toLocaleString("zh-CN") ?? "—"} 字符</p><div className="generation-progress"><span /></div><button type="button" onClick={() => { studio.updateTask(task.id, { state: "cancelled" }); studio.updateOutline(task.outlineId, { state: "saved" }); }}>取消任务</button></article>)}
          {!activeTasks.length && latestFailed && <article className="generation-card failed-generation-card"><div className="generation-state"><span className="state-dot failed" />需要处理</div><strong>{latestFailed.prompt || "按大纲生成"}</strong><p>{latestFailed.error || "生成失败"}</p><div className="candidate-actions"><button type="button" onClick={() => setPrompt(latestFailed.prompt)}>编辑指令</button><button type="button" onClick={() => studio.updateTask(latestFailed.id, { state: "waiting", error: undefined })}>原样重试</button></div></article>}
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

  return <Modal
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
          <div><strong>{character.name}</strong>{character.aliases.length > 0 && <span>{character.aliases.join("、")}</span>}<small>{reason}</small></div>
          <em className={checked ? "first" : "established"}>{status}</em>
        </div>;
      })}
      {!ordered.length && <p className="first-appearance-empty">没有匹配的人物。</p>}
    </div>
    <Group justify="space-between" mt="md">
      <Button variant="subtle" type="button" disabled={!Object.keys(overrides).length} onClick={onReset}>恢复自动判断</Button>
      <Button type="button" onClick={onClose}>完成</Button>
    </Group>
  </Modal>;
}

function GeneratePresetDialog({ presets, onClose, onSave }: { presets: string[]; onClose: () => void; onSave: (presets: string[]) => void }) {
  const [items, setItems] = useState([...presets]);
  const listRef = useRef<HTMLDivElement>(null);
  const compact = useMediaQuery("(max-width: 767px)") ?? false;

  function addPreset() {
    setItems((current) => [...current, ""]);
    window.requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLTextAreaElement>("textarea").item(items.length)?.focus());
  }

  return <Modal
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
    <div className="generate-preset-list" ref={listRef}>
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
  </Modal>;
}

function ContextCard({ summary, contentMode, includePrevious, includeCharacters, onPrevious, onCharacters }: { summary: GenerateContextSummary; contentMode: ContentGenerationMode; includePrevious: boolean; includeCharacters: boolean; onPrevious: (value: boolean) => void; onCharacters: (value: boolean) => void }) {
  const fixed = [["文章信息", summary.article], ["当前章节", summary.chapter], ["当前大纲", summary.outline], ["前一条正文", summary.previousContent]] as const;
  return (
    <div className="context-card">
      <div><strong>内容类别</strong><span>发送前预计</span></div>
      {fixed.map(([label, characters]) => <label key={label}><input type="checkbox" checked readOnly disabled />{label}<span>{characters.toLocaleString("zh-CN")} 字符</span></label>)}
      <label><input type="checkbox" checked={contentMode !== "fresh"} readOnly disabled />当前正文<span>{contentMode === "fresh" ? "全新生成不发送" : `${summary.content.toLocaleString("zh-CN")} 字符`}</span></label>
      <label><input type="checkbox" checked={includePrevious} onChange={(event) => onPrevious(event.target.checked)} />前面大纲<span>{summary.previousCount} 条 · {summary.previous.toLocaleString("zh-CN")} 字符</span></label>
      <label><input type="checkbox" checked={includeCharacters} onChange={(event) => onCharacters(event.target.checked)} />相关人物<span>{summary.characterCount} 位 · {summary.characters.toLocaleString("zh-CN")} 字符</span></label>
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

function ChatView({ outlineId, outlineTitle, onUseAsGenerate, onNotice }: { outlineId?: string; outlineTitle: string; onUseAsGenerate: (text: string) => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const outline = studio.currentArticle.chapters.flatMap((chapter) => chapter.outlines).find((item) => item.id === outlineId) ?? studio.currentOutline;
  const outlineChapter = studio.currentArticle.chapters.find((chapter) => chapter.outlines.some((item) => item.id === outline.id)) ?? studio.currentChapter;
  const chatModelRecord = configuredModelForReference(models, studio.data.settings.chatModel);
  const chatModelReference = chatModelRecord?.id ?? studio.data.settings.chatModel.trim();
  const chatbotName = chatbotDisplayName(models, chatModelReference);
  const session = activeChatSession(outline);
  const message = session?.draft ?? "";
  const activeChatTask = studio.data.tasks.find((task) => task.target === "AI Chat" && task.outlineId === outline.id && (task.state === "waiting" || task.state === "running"));
  const sessionChatTask = activeChatTask?.contextOptions?.sessionId === session?.id ? activeChatTask : undefined;
  const isStreaming = Boolean(activeChatTask);
  const streaming = sessionChatTask?.resultText ?? "";
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
  const streamController = useRef<AbortController | null>(null);
  const streamTaskId = useRef("");
  const streamSessionId = useRef("");
  const chatStudioRef = useRef(studio);
  const streamingRef = useRef("");
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

  function stopStreaming(stopped = true) {
    const taskId = streamTaskId.current;
    const targetSessionId = streamSessionId.current;
    const partialResult = streamingRef.current;
    const controller = streamController.current;
    controller?.abort();
    if (taskId && controller) releaseActiveChatStream(taskId, controller);
    streamController.current = null;
    if (partialResult) studio.addChatMessage(outline.id, { id: clientId("message"), role: "assistant", text: partialResult, createdAt: new Date().toISOString(), stopped }, targetSessionId || undefined);
    if (taskId) studio.updateTask(taskId, { state: "cancelled", phase: "cancelled", completedAt: new Date().toISOString(), lastProgressAt: new Date().toISOString(), receivedCharacters: partialResult.length, resultText: partialResult || undefined, error: stopped ? "用户停止了聊天回复" : undefined });
    streamTaskId.current = "";
    streamSessionId.current = "";
    streamingRef.current = "";
    void chatStudioRef.current.saveNow();
  }
  useEffect(() => {
    chatStudioRef.current = studio;
  });

  function cancelCurrentChatTask() {
    if (!activeChatTask || cancelActiveChatStream(activeChatTask.id)) return;
    const completedAt = new Date().toISOString();
    studio.updateTask(activeChatTask.id, { state: "cancelled", phase: "cancelled", completedAt, lastProgressAt: completedAt, runnerId: undefined, leaseUntil: undefined });
    void studio.saveNow();
  }

  async function requestAnswer(question: string, addUser: boolean, targetSessionId = session?.id, targetSession = session) {
    if (!targetSessionId || !targetSession || isStreaming || streamTaskId.current || !await studio.saveNow()) return;
    const taskId = studio.addTask({
      articleId: studio.currentArticle.id,
      chapterId: outlineChapter.id,
      outlineId: outline.id,
      target: "AI Chat",
      prompt: question.slice(0, 20000),
      model: chatModelReference,
      state: "running",
      phase: "connecting",
      attempt: 1,
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
      receivedCharacters: 0,
      timeoutMs: chatModelRecord?.timeoutMs ?? 600_000,
      contextOptions: {
        includePrevious: targetSession.includePrevious,
        includeCharacters: targetSession.includeCharacters,
        estimatedCharacters: chatContext ? summarizeAiContext(chatContext, question).total : 0,
        sessionId: targetSessionId,
        modelId: chatModelRecord?.modelId,
        modelName: chatModelRecord?.name,
      },
    });
    if (!taskId) { onNotice("AI 任务已满，请先清理任务记录"); return; }
    streamTaskId.current = taskId;
    streamSessionId.current = targetSessionId;
    if (addUser) {
      studio.addChatMessage(outline.id, { id: clientId("message-user"), role: "user", text: question, createdAt: new Date().toISOString() }, targetSessionId);
      studio.setChatDraft(outline.id, "", targetSessionId);
      if (targetSession.title === "新对话") studio.renameChatSession(outline.id, targetSessionId, question.slice(0, 24));
    }
    const controller = new AbortController();
    streamController.current = controller;
    streamingRef.current = "";
    registerActiveChatStream(taskId, { controller, cancel: () => stopStreaming(true) });
    try {
      const response = await fetch(`/api/outlines/${encodeURIComponent(outline.id)}/chat/stream`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: question, sessionId: targetSessionId, model: chatModelReference, includePrevious: targetSession.includePrevious, includeCharacters: targetSession.includeCharacters }) });
      if (!response.ok || !response.body) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error || `${chatbotName} 失败（${response.status}）`); }
      studio.updateTask(taskId, { phase: "generating", lastProgressAt: new Date().toISOString() });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamingRef.current += decoder.decode(value, { stream: true });
        studio.updateTask(taskId, { phase: "receiving", lastProgressAt: new Date().toISOString(), receivedCharacters: streamingRef.current.length, resultText: streamingRef.current });
      }
      if (controller.signal.aborted) return;
      if (!streamingRef.current) throw new Error(`${chatbotName} 返回了空结果`);
      studio.addChatMessage(outline.id, { id: clientId("message-assistant"), role: "assistant", text: streamingRef.current, createdAt: new Date().toISOString() }, targetSessionId);
      studio.updateTask(taskId, { state: "success", phase: "completed", completedAt: new Date().toISOString(), lastProgressAt: new Date().toISOString(), receivedCharacters: streamingRef.current.length, resultText: streamingRef.current, error: undefined });
      await chatStudioRef.current.saveNow();
    } catch (error) {
      if (!controller.signal.aborted) {
        const errorMessage = error instanceof Error ? error.message : "请求失败";
        studio.addChatMessage(outline.id, { id: clientId("message-error"), role: "assistant", text: `${chatbotName} 错误：${errorMessage}`, createdAt: new Date().toISOString() }, targetSessionId);
        studio.updateTask(taskId, { state: "failed", phase: "failed", completedAt: new Date().toISOString(), lastProgressAt: new Date().toISOString(), receivedCharacters: streamingRef.current.length, error: errorMessage });
        await chatStudioRef.current.saveNow();
      }
    } finally {
      releaseActiveChatStream(taskId, controller);
      if (streamController.current === controller) streamController.current = null;
      if (streamTaskId.current === taskId) streamTaskId.current = "";
      if (streamSessionId.current === targetSessionId) streamSessionId.current = "";
      streamingRef.current = "";
    }
  }

  async function send() {
    const question = message.trim();
    if (!question || isStreaming || editingMessage) return;
    await requestAnswer(question, true);
  }

  async function submitEditedMessage() {
    if (!editingMessage || isStreaming) return;
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
    studio.saveVersion(outline.id, timestampContentName(), "AI Chat", text, { model: chatModelRecord?.name ?? chatModelReference, modelId: chatModelRecord?.modelId, prompt: session?.title });
    setMessageMenuId("");
    onNotice("已保存为候选版本");
  }

  async function appendToBody(text: string) {
    if (!window.confirm("把这条 AI 回复追加到当前正文？")) return;
    const currentContent = resolvedOutlineContent(outline);
    const nextContent = `${currentContent.trim()}${currentContent.trim() ? "\n\n" : ""}${text.trim()}`;
    if (!await studio.commitContentEdit(outline.id, nextContent)) return;
    setMessageMenuId("");
    onNotice("已追加到正文并设为默认");
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
          <span className="chat-header-icon"><Icon name="chat" /></span><span><strong>{session.title}</strong><small>{session.messages.length} 条消息</small></span><Icon name="chevron" />
        </button>
        <div className="chat-header-actions">
          <IconButton name="plus" label="新建 AI Chat 会话" className="chat-new-session" onClick={() => { if (!isStreaming) { cancelEditingMessage(); studio.createChatSession(outline.id); setSessionsOpen(false); composerRef.current?.focus(); } }} />
          <IconButton name="more" label="会话操作" aria-haspopup="menu" aria-expanded={sessionMenuOpen} onClick={() => { setSessionMenuOpen((value) => !value); setSessionsOpen(false); }} />
        </div>
        {sessionsOpen && <div className="chat-session-popover" role="dialog" aria-label="AI Chat 会话"><div className="chat-session-popover-head"><strong>AI Chat 会话</strong></div>{outline.chat.sessions.map((item) => <button className={item.id === session.id ? "active" : ""} type="button" key={item.id} disabled={isStreaming} onClick={() => { cancelEditingMessage(); studio.setActiveChatSession(outline.id, item.id); setSessionsOpen(false); }}><span><strong>{item.title}</strong><small>{item.messages.length} 条 · {formatTime(item.updatedAt)}</small></span>{item.id === session.id && <Icon name="check" />}</button>)}</div>}
        {sessionMenuOpen && <div className="chat-session-menu" role="menu"><button role="menuitem" type="button" onClick={() => { const title = window.prompt("会话名称", session.title); if (title?.trim()) studio.renameChatSession(outline.id, session.id, title); setSessionMenuOpen(false); }}><Icon name="edit" />重命名</button><button role="menuitem" type="button" onClick={() => { if (window.confirm("清空当前会话的全部消息？")) studio.clearChat(outline.id); setSessionMenuOpen(false); }}><Icon name="refresh" />清空消息</button><button role="menuitem" className="danger" type="button" onClick={() => { if (window.confirm("删除当前会话？")) studio.deleteChatSession(outline.id, session.id); setSessionMenuOpen(false); }}><Icon name="trash" />删除会话</button></div>}
      </header>

      <div className="chat-thread" ref={chatThreadRef}>
        {!session.messages.length && !isStreaming && <div className="chat-empty"><span><Icon name="spark" /></span><h2>和 {chatbotName} 讨论「{outlineTitle}」</h2><div>{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => { studio.setChatDraft(outline.id, prompt); composerRef.current?.focus(); }}>{prompt}</button>)}</div></div>}
        {session.messages.map((item, index) => {
          const isError = item.role === "assistant" && item.text.includes("错误：");
          const previousUser = item.role === "assistant" ? [...session.messages.slice(0, index)].reverse().find((candidate) => candidate.role === "user") : null;
          return <article className={`message ${item.role} ${isError ? "error" : ""} ${editingMessage?.sessionId === session.id && editingMessage.messageId === item.id ? "editing" : ""}`} key={item.id}>
            {item.role === "assistant" && <div className="avatar"><Icon name="spark" /></div>}
            <div className="message-body"><div className="message-meta"><strong>{item.role === "user" ? "你" : chatbotName}</strong>{item.stopped && <span>已停止</span>}</div>
              {editingMessage?.sessionId === session.id && editingMessage.messageId === item.id ? <form className="inline-message-editor" onSubmit={(event) => { event.preventDefault(); void submitEditedMessage(); }}>
                <textarea autoFocus maxLength={20000} value={editingMessage.text} aria-label="编辑聊天消息" onChange={(event) => setEditingMessage({ ...editingMessage, text: event.currentTarget.value })} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelEditingMessage(); } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submitEditedMessage(); } }} />
                <div><span>Ctrl/⌘ + Enter 发送</span><button type="button" onClick={cancelEditingMessage}>取消</button><button className="primary" type="submit" disabled={!editingMessage.text.trim()}>发送</button></div>
              </form> : <><ChatMessageContent text={item.text} /><div className="message-actions">
                <IconButton name={copiedId === item.id ? "check" : "copy"} label="复制消息" title="复制" size="small" onClick={() => void copyMessage(item.id, item.text)} />
                {item.role === "user" && <IconButton name="edit" label="编辑并重发" size="small" disabled={isStreaming || Boolean(editingMessage)} onClick={() => setEditingMessage({ sessionId: session.id, messageId: item.id, text: item.text })} />}
                {item.role === "assistant" && previousUser && <IconButton name="refresh" label="重新生成" size="small" disabled={isStreaming || Boolean(editingMessage)} onClick={() => { studio.replaceChatMessages(outline.id, session.messages.slice(0, index)); void requestAnswer(previousUser.text, false); }} />}
                <IconButton name="branch" label="从这里分支" size="small" onClick={() => branchFrom(item.id)} />
                {item.role === "assistant" && <IconButton name="more" label="更多写作操作" title="更多" size="small" className="message-action-trigger" aria-haspopup="menu" aria-expanded={messageMenuId === item.id} onClick={() => setMessageMenuId((value) => value === item.id ? "" : item.id)} />}
              </div>
              {messageMenuId === item.id && <div className="message-action-menu"><button type="button" onClick={() => saveCandidate(item.text)}><Icon name="versions" />保存为候选版本</button><button type="button" onClick={() => void appendToBody(item.text)}><Icon name="insert" />追加到正文</button><button type="button" onClick={() => { setMessageMenuId(""); onUseAsGenerate(item.text); }}><Icon name="spark" />交给 AI Generate</button></div>}</>}
            </div>
          </article>;
        })}
        {isStreaming && <article className="message assistant streaming"><div className="avatar"><Icon name="spark" /></div><div className="message-body"><div className="message-meta"><strong>{chatbotName}</strong><span>正在回复</span></div><ChatMessageContent text={streaming || "正在思考…"} /><button className="inline-stop" type="button" onClick={cancelCurrentChatTask}><Icon name="stop" />停止</button></div></article>}
        <div ref={threadEndRef} />
      </div>

      <div className="chat-composer-wrap">
        {contextOpen && <div className="chat-context-panel" role="dialog" aria-label="AI Chat 上下文"><header><div><strong>本次上下文</strong><span>{contextCharacters.toLocaleString("zh-CN")} 字符</span></div><IconButton name="close" label="关闭上下文" onClick={() => setContextOpen(false)} /></header><div className="chat-context-fixed"><p><Icon name="check" /><span>文章信息</span><small>{studio.currentArticle.title}</small></p><p><Icon name="check" /><span>当前章节</span><small>{studio.currentChapter.title}</small></p><p><Icon name="check" /><span>当前大纲与正文</span><small>{outlineTitle}</small></p><p><Icon name="check" /><span>最近消息</span><small>{Math.min(20, session.messages.length)} 条</small></p></div><label><input type="checkbox" checked={session.includePrevious} onChange={(event) => studio.setChatSetting(outline.id, "includePrevious", event.target.checked)} /><span>前面全部大纲</span><small>{previous.length} 条</small></label>{session.includePrevious && previous.length > 0 && <div className="chat-context-sources">{previous.map((item) => <span key={item.id}>{outlineDisplayTitle(item)}</span>)}</div>}<label><input type="checkbox" checked={session.includeCharacters} onChange={(event) => studio.setChatSetting(outline.id, "includeCharacters", event.target.checked)} /><span>相关人物</span><small>{matchedCharacters.length} 位</small></label>{session.includeCharacters && matchedCharacters.length > 0 && <div className="chat-context-sources">{matchedCharacters.map((item) => <span key={item.id}>{item.name}</span>)}</div>}</div>}
        <div className="chat-composer">
          <textarea ref={composerRef} rows={1} maxLength={20000} value={message} disabled={Boolean(editingMessage)} onChange={(event) => { studio.setChatDraft(outline.id, event.target.value); resizeComposer(event.currentTarget); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={editingMessage ? "正在编辑上方消息" : "输入消息"} aria-label="AI Chat 消息" />
          <div className="composer-actions"><div className="composer-left-actions"><IconButton name="plus" label="添加参考或快捷指令" title="添加" className="composer-icon-button" aria-haspopup="menu" aria-expanded={toolsOpen} disabled={Boolean(editingMessage)} onClick={() => { setToolsOpen((value) => !value); setContextOpen(false); }} /><button className={`composer-context-chip ${contextOpen ? "active" : ""}`} type="button" disabled={Boolean(editingMessage)} aria-expanded={contextOpen} onClick={() => { setContextOpen((value) => !value); setToolsOpen(false); }}><Icon name="context" /><span>上下文 {contextCharacters.toLocaleString("zh-CN")}</span></button><label className="composer-model-chip"><Icon name="spark" /><select aria-label="聊天模型" disabled={Boolean(editingMessage)} value={chatModelReference} onChange={(event) => studio.updateSettings({ chatModel: event.target.value })}><option value="">本地 PoC 引擎</option>{chatModelReference && !chatModelRecord && <option value={chatModelReference}>{chatModelReference}</option>}{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label></div>{isStreaming ? <button className="composer-send stop" type="button" onClick={cancelCurrentChatTask} aria-label="停止回复"><Icon name="stop" /></button> : <button className="composer-send" type="button" onClick={() => void send()} disabled={!message.trim() || Boolean(editingMessage)} aria-label="发送消息"><Icon name="send" /></button>}</div>
          {toolsOpen && <div className="chat-tools-popover"><div>{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => { studio.setChatDraft(outline.id, message ? `${message}\n${prompt}` : prompt); setToolsOpen(false); composerRef.current?.focus(); }}>{prompt}</button>)}</div><button type="button" onClick={() => fileRef.current?.click()}><Icon name="attachment" />添加文本参考</button></div>}
          <input className="chat-file-input" ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => { void attachTextFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        </div>
      </div>
    </div>
  );
}

function FullOutlineChatDialog({ outlineId, onClose, onNotice }: { outlineId: string; onClose: () => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const outline = studio.currentArticle.chapters.flatMap((chapter) => chapter.outlines).find((item) => item.id === outlineId);
  if (!outline) return null;
  const displayTitle = outlineDisplayTitle(outline);
  return <Modal
    opened
    onClose={onClose}
    fullScreen={compact}
    size="xl"
    title={`AI Chat · ${displayTitle}`}
    classNames={{ content: "ws-modal-content full-outline-chat-modal", header: "ws-modal-header", body: "full-outline-chat-body" }}
    overlayProps={{ backgroundOpacity: 0.46, blur: 3 }}
  >
    <ChatView
      key={outline.id}
      outlineId={outline.id}
      outlineTitle={displayTitle}
      onUseAsGenerate={() => onNotice("请在正文视图中继续使用 AI Generate")}
      onNotice={onNotice}
    />
  </Modal>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

function ChapterReader({ onOutline }: { onOutline: (id: string) => void }) {
  const studio = useStudio();
  const chapter = studio.currentChapter;
  const [structureGenerate, setStructureGenerate] = useState(false);
  const outlines = chapter.outlines.filter((item) => studio.data.settings.showArchived || !item.archived);
  const totalWords = outlines.reduce((total, item) => total + wordCount(resolvedOutlineContent(item)), 0);
  return <>
    <div className="page-scroll"><div className="reader-page">
      <PageHeader eyebrow={studio.currentArticle.title} title={chapter.title} description={`${outlines.length} 条大纲 · ${totalWords} 字`} actions={<><button className="secondary-button" type="button" onClick={() => setStructureGenerate(true)}><Icon name="spark" />AI Generate 章节标题</button><button className="primary-compact" type="button" onClick={() => { const id = studio.createOutline(chapter.id); onOutline(id); }}><Icon name="plus" />新建大纲</button></>} />
      <div className="reader-divider" />
      {outlines.map((item, index) => <ReaderSection key={item.id} number={String(index + 1).padStart(2, "0")} title={outlineDisplayTitle(item)} onClick={() => onOutline(item.id)}>{resolvedOutlineContent(item).split("\n\n").filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</ReaderSection>)}
      {!outlines.length && <div className="empty-inline">本章节还没有大纲。</div>}
    </div></div>
    {structureGenerate && <StructureGenerateSheet target={{ kind: "chapter", id: chapter.id, title: chapter.title }} onClose={() => setStructureGenerate(false)} onApplied={(message, result) => { studio.updateChapter(chapter.id, { title: result.slice(0, 120) }); setStructureGenerate(false); window.alert(message); }} />}
  </>;
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

function ContinuousOutlineBlock({ item, number, mode, text, selectedVersionId, dropPlacement, contentStyle, onTitle, onText, onContentFocus, onContentBlur, onSelectVersion, onSetDefaultVersion, onMoveUp, onMoveDown, onMoveChapter, onOpenChat }: {
  item: Outline;
  number: number;
  mode: "outline" | "content";
  text: string;
  selectedVersionId?: string;
  dropPlacement?: OutlineDropPlacement;
  contentStyle?: CSSProperties;
  onTitle: (value: string) => void;
  onText: (value: string) => void;
  onContentFocus?: () => void;
  onContentBlur?: () => void | Promise<unknown>;
  onSelectVersion?: (versionId?: string) => void | Promise<void>;
  onSetDefaultVersion?: (versionId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveChapter: () => void;
  onOpenChat?: () => void;
}) {
  const displayTitle = outlineDisplayTitle(item);
  const selectedVersion = item.versions.find((version) => version.id === selectedVersionId);
  const defaultVersion = item.versions.find((version) => version.id === item.sourceVersionId);
  const currentContentName = resolvedOutlineContentName(item);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, data: { type: "outline", outlineId: item.id } });
  return <article
    ref={setNodeRef}
    data-continuous-outline-id={item.id}
    className={`continuous-outline-block ${isDragging ? "dragging" : ""} ${dropPlacement ? `drop-${dropPlacement}` : ""}`}
    style={{ transform: CSS.Transform.toString(transform), transition }}
  >
    <div className="continuous-outline-gutter">
      <span>{String(number).padStart(2, "0")}</span>
      <button ref={setActivatorNodeRef} className="continuous-drag-handle" type="button" {...attributes} {...listeners} aria-label={`拖动排序：${displayTitle}`} title="拖动调整顺序"><i aria-hidden="true" /></button>
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
            <Menu.Item onClick={() => void onSelectVersion?.()}>
              <span className="continuous-version-option"><strong>{currentContentName}</strong><small>{item.contentOverride ? "当前正文 · 已直接保存" : defaultVersion ? "当前默认正文" : "空正文"}</small></span>
            </Menu.Item>
            {item.versions.map((version) => <Menu.Item key={version.id} onClick={() => void onSelectVersion?.(version.id)}>
              <span className="continuous-version-option"><strong>{version.name}{version.id === item.sourceVersionId ? <em>默认</em> : null}</strong><small>{formatTime(version.createdAt)} · {wordCount(version.content)} 字 · {version.source}</small></span>
            </Menu.Item>)}
            {!item.versions.length && <Menu.Item disabled>尚无候选版本</Menu.Item>}
          </Menu.Dropdown>
        </Menu>
        {selectedVersion && selectedVersion.id !== item.sourceVersionId && <button className="continuous-set-default" type="button" aria-label={`将“${selectedVersion.name}”设为默认正文`} onClick={() => onSetDefaultVersion?.(selectedVersion.id)}>设为默认</button>}
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
  const defaultModel = canonicalModelReference(models, initialModel);
  const [chapterId, setChapterId] = useState(availableChapters[0]?.id ?? "");
  const [model, setModel] = useState(preferredModel);
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

  return <Modal
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
        <Select label="模型" value={model} onChange={(value) => setModel(value ?? "")} data={models.map((item) => ({ value: item.id, label: `${modelDisplayLabel(models, item.id)}${item.hasSecret ? "" : "（需密钥）"}` }))} disabled={running} />
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
        {model && model !== defaultModel && <Button variant="subtle" type="button" disabled={running} onClick={() => onSetDefaultModel(model)}>设为 Review 默认</Button>}
        <Button variant="default" type="button" disabled={running} onClick={onClose}>取消</Button>
        <Button leftSection={<Icon name="review" />} loading={running} disabled={!chapterId || !model || !models.length} onClick={() => void submit()}>开始 AI Review</Button>
      </Group>
    </Stack>
  </Modal>;
}

function ContinuousDocumentEditor({ mode, onNotice }: { mode: "outline" | "content"; onNotice: (message: string) => void }) {
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
  const studioRef = useRef(studio);
  const orderedIds = outlines.map((item) => item.id);
  const draggingOutline = outlines.find((item) => item.id === draggingId);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => { contentDraftsRef.current = contentDrafts; }, [contentDrafts]);
  useEffect(() => { studioRef.current = studio; }, [studio]);

  useEffect(() => {
    if (mode !== "content") return;
    setContentDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const item of outlines) {
        if (Object.prototype.hasOwnProperty.call(next, item.id)) continue;
        const content = resolvedOutlineContent(item);
        next[item.id] = content;
        contentBaselinesRef.current[item.id] = content;
        defaultContentsRef.current[item.id] = content;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [mode, outlines]);

  useEffect(() => () => {
    if (mode !== "content") return;
    for (const [outlineId, text] of Object.entries(contentDraftsRef.current)) {
      if (text !== contentBaselinesRef.current[outlineId]) void studioRef.current.preserveContentDraft(outlineId, text);
    }
  }, [mode]);

  function changeContent(outlineId: string, text: string) {
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
    const saved = await studio.saveCurrentContent(outlineId, next);
    if (!saved) return false;
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
    setDirtyContentIds((current) => { const next = new Set(current); next.delete(outlineId); return next; });
  }

  async function selectContentVersion(item: Outline, versionId?: string) {
    await commitContent(item.id);
    const version = versionId ? item.versions.find((candidate) => candidate.id === versionId) : undefined;
    if (versionId && !version) return;
    showContentVersion(item.id, version?.content ?? defaultContentsRef.current[item.id] ?? resolvedOutlineContent(item), version?.id);
  }

  function setContentDefaultVersion(item: Outline, versionId: string) {
    const version = item.versions.find((candidate) => candidate.id === versionId);
    if (!version) return;
    studio.setDefaultVersion(item.id, version.id);
    defaultContentsRef.current[item.id] = version.content;
    showContentVersion(item.id, version.content);
    onNotice(`已将“${version.name}”设为「${outlineDisplayTitle(item)}」的默认正文`);
  }

  function openOutlineChat(item: Outline) {
    studio.setChatSetting(item.id, "includePrevious", true);
    setChatOutlineId(item.id);
  }

  async function runReview(input: { chapterId: string; model: string; requirements: string[]; additionalRequirement: string }) {
    for (const outlineId of [...dirtyContentIds]) {
      if (!await commitContent(outlineId)) throw new Error("正文尚未保存，不能开始 AI Review");
    }
    if (!await studio.saveNow()) throw new Error("正文尚未保存，不能开始 AI Review");
    const response = await fetch("/api/ai/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId: studio.currentArticle.id, ...input }),
    });
    const payload = await response.json() as {
      error?: string;
      updated?: Array<{ outlineId: string; versionId: string; name: string; text: string }>;
      editCount?: number;
      inputTokens?: number;
      outputTokens?: number;
    };
    if (!response.ok) throw new Error(payload.error || "AI Review 失败");
    const refreshed = await studio.refreshFromServer();
    if (!refreshed) throw new Error("AI Review 已保存，但页面未能刷新；请刷新页面查看新正文");
    const updated = payload.updated ?? [];
    if (updated.length) {
      const nextDrafts = { ...contentDraftsRef.current };
      const nextSelections = { ...versionSelections };
      for (const item of updated) {
        nextDrafts[item.outlineId] = item.text;
        contentBaselinesRef.current[item.outlineId] = item.text;
        defaultContentsRef.current[item.outlineId] = item.text;
        delete nextSelections[item.outlineId];
        studio.clearContentDraft(item.outlineId);
      }
      contentDraftsRef.current = nextDrafts;
      setContentDrafts(nextDrafts);
      setVersionSelections(nextSelections);
      setDirtyContentIds((current) => {
        const next = new Set(current);
        updated.forEach((item) => next.delete(item.outlineId));
        return next;
      });
    }
    const usage = payload.inputTokens || payload.outputTokens ? ` · ${Number(payload.inputTokens ?? 0).toLocaleString("zh-CN")} 输入 / ${Number(payload.outputTokens ?? 0).toLocaleString("zh-CN")} 输出 tokens` : "";
    onNotice(updated.length ? `AI Review 已修改 ${updated.length} 条正文并设为新默认${usage}` : `AI Review 完成，未发现需要修改的正文${usage}`);
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

  return <div className="page-scroll"><div className={`continuous-document-editor ${mode}`}>
    <PageHeader eyebrow={mode === "outline" ? "全大纲编辑" : "全文编辑"} title={studio.currentArticle.title} description={`${groups.length} 章 · ${outlines.length} 条大纲${mode === "content" ? ` · ${contentWords.toLocaleString("zh-CN")} 字` : ""} · ${status}`} actions={mode === "content" ? <><Button variant="default" type="button" onClick={() => void saveAllContentAsVersions()}>另存为</Button><Button type="button" loading={studio.saveStatus === "saving"} onClick={() => void saveAllContent()}>保存</Button><IconButton name="review" label="AI Review" variant="glass" size="large" className="full-content-review-button" onClick={() => setReviewOpen(true)} /></> : undefined} />
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
              onTitle={(value) => studio.updateOutline(item.id, { title: value.slice(0, 80) })}
              onText={(value) => mode === "outline" ? studio.updateOutline(item.id, { plan: value.slice(0, 10000) }) : changeContent(item.id, value)}
              onContentBlur={mode === "content" ? () => commitContent(item.id) : undefined}
              onSelectVersion={mode === "content" ? (versionId) => selectContentVersion(item, versionId) : undefined}
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
        {draggingOutline && <div className="continuous-drag-overlay"><span className="outline-grip-dots" aria-hidden="true" /><strong>{outlineDisplayTitle(draggingOutline)}</strong></div>}
      </DragOverlay>
    </DndContext>
    {mode === "outline" && chatOutlineId && <FullOutlineChatDialog outlineId={chatOutlineId} onClose={() => setChatOutlineId(null)} onNotice={onNotice} />}
    {mode === "content" && reviewOpen && <AiReviewDialog chapters={studio.currentArticle.chapters} models={reviewModels} presets={studio.data.settings.reviewPresets} initialModel={studio.data.settings.reviewModel} onClose={() => setReviewOpen(false)} onSavePresets={(presets) => studio.updateSettings({ reviewPresets: presets })} onSetDefaultModel={(reviewModel) => studio.updateSettings({ reviewModel })} onRun={runReview} />}
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
  return <button className="search-result" type="button" onClick={onClick}><span className="result-type">{type}</span><div><strong>{title}</strong><p>{snippet}</p></div><span>打开 →</span></button>;
}

function ArticleInfoPage({ view, onGo }: { view: View; onGo: (view: View) => void }) {
  const studio = useStudio();
  const [moreOpen, setMoreOpen] = useState(false);
  useDismissOnOutside(moreOpen, () => setMoreOpen(false), ".info-more-trigger, .info-more-menu");
  return (
    <div className="page-scroll"><div className="standard-page info-page">
      <PageHeader eyebrow={studio.currentArticle.title} title="文章资料" actions={<IconButton name="more" label="文章资料更多操作" className="info-more-trigger" onClick={() => setMoreOpen((open) => !open)} />} />
      {moreOpen && <div className="info-more-menu"><button type="button" onClick={() => { studio.updateSettings({ showArchived: !studio.data.settings.showArchived }); setMoreOpen(false); }}>{studio.data.settings.showArchived ? "隐藏" : "显示"}已归档内容</button><button className="danger" type="button" onClick={() => { const value = window.prompt(`输入文章标题「${studio.currentArticle.title}」以确认删除`); if (value === studio.currentArticle.title) studio.deleteArticle(studio.currentArticle.id); setMoreOpen(false); }}>删除文章</button></div>}
      <Tabs items={[
        ["info-basic", "基本信息"], ["info-characters", "人物"], ["info-relationships", "人物关系"],
      ]} active={view} onGo={onGo} />
      {view === "info-basic" && <BasicInfo />}
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
  return <><div className="relationship-toolbar"><strong>{studio.currentArticle.relationships.length} 条人物关系</strong><button className="primary-compact" type="button" onClick={create}><Icon name="plus" />新建关系</button></div><div className="relationship-list">{studio.currentArticle.relationships.map((item) => { const a = studio.currentArticle.characters.find((person) => person.id === item.characterAId); const b = studio.currentArticle.characters.find((person) => person.id === item.characterBId); if (!a || !b) return null; return <article className="relationship-card" key={item.id}><div className="mini-avatar blue">{a.name[0]}</div><strong>{a.name}</strong><span className="relationship-line"><Icon name="link" /><em>{item.description}</em></span><strong>{b.name}</strong><div className="mini-avatar blue">{b.name[0]}</div><div className="card-actions"><button type="button" onClick={() => { const description = window.prompt("关系描述", item.description); if (description?.trim()) studio.updateRelationship(item.id, { description: description.trim() }); }}>编辑</button><button className="danger-text" type="button" onClick={() => { if (window.confirm("删除这条人物关系？")) studio.deleteRelationship(item.id); }}>删除</button></div></article>; })}</div></>;
}

function SettingsPage({ view, onGo }: { view: View; onGo: (view: View) => void }) {
  const items: [View, string][] = [
    ["settings-general", "常规"],
    ["settings-appearance", "外观与编辑器"],
    ["settings-models", "AI 模型"],
    ["settings-tasks", "AI 任务"],
    ["settings-database", "数据库"],
    ["settings-system", "系统与诊断"],
  ];
  const activeItem = items.find(([key]) => key === view) ?? items[0];
  return <div className="settings-layout"><nav className="settings-nav" aria-label="设置分类"><div><span>Writer Studio</span><strong>设置</strong></div>{items.map(([key, label]) => <button className={view === key ? "active" : ""} key={key} type="button" onClick={() => onGo(key)}><strong>{label}</strong></button>)}</nav><div className="settings-content"><PageHeader title={activeItem[1]} />{view === "settings-general" && <GeneralSettings />}{view === "settings-appearance" && <AppearanceSettings />}{view === "settings-models" && <ModelSettings />}{view === "settings-tasks" && <TaskSettings />}{view === "settings-database" && <DatabaseSettings />}{view === "settings-system" && <SystemSettings />}</div></div>;
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="setting-section"><div className="setting-title"><h2>{title}</h2></div><div className="setting-body">{children}</div></section>;
}

function SettingRow({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><strong>{title}</strong></div>{children}</div>;
}

function Toggle({ checked = true, onChange }: { checked?: boolean; onChange?: (checked: boolean) => void }) { return <button type="button" className={`toggle ${checked ? "on" : ""}`} aria-label={checked ? "已开启" : "已关闭"} aria-pressed={checked} onClick={() => onChange?.(!checked)}><span /></button>; }

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
  type Model = { id: string; name: string; baseUrl: string; modelId: string; systemPrompt: string; temperature: number | null; maxOutput: number | null; timeoutMs: number; hasSecret: boolean };
  const timeoutMinutes = (timeoutMs: number) => Math.max(0.1, Math.min(10, Number((timeoutMs / 60_000).toFixed(2))));
  const parseModelIds = (value: string) => [...new Set(value.split(",").map((modelId) => modelId.trim()).filter(Boolean))];
  const formatModelIds = (modelIds: string[]) => modelIds.join(", ");
  const [models, setModels] = useState<Model[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", baseUrl: "https://api.openai.com/v1", modelId: "", secret: "", systemPrompt: "", timeoutMinutes: "2" });
  const parsedTimeoutMinutes = Number(form.timeoutMinutes);
  const timeoutIsValid = Number.isFinite(parsedTimeoutMinutes) && parsedTimeoutMinutes >= 0.1 && parsedTimeoutMinutes <= 10;
  const requestedModelIds = selectedModelIds.length ? selectedModelIds : parseModelIds(form.modelId);
  const load = async () => { const response = await fetch("/api/models", { cache: "no-store" }); const payload = await response.json() as { models?: Model[] }; setModels(payload.models ?? []); };
  useEffect(() => {
    let active = true;
    void fetch("/api/models", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ models?: Model[] }>)
      .then((payload) => { if (active) setModels(payload.models ?? []); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "模型加载失败"); });
    return () => { active = false; };
  }, []);
  function closeForm() {
    setFormOpen(false); setEditingId(null); setDiscoveredModels([]); setSelectedModelIds([]);
    setForm({ name: "", baseUrl: "https://api.openai.com/v1", modelId: "", secret: "", systemPrompt: "", timeoutMinutes: "2" });
  }
  function openCreate() {
    setError(""); setEditingId(null); setDiscoveredModels([]); setSelectedModelIds([]);
    setForm({ name: "", baseUrl: "https://api.openai.com/v1", modelId: "", secret: "", systemPrompt: "", timeoutMinutes: "2" });
    setFormOpen(true);
  }
  function openEdit(model: Model) {
    setError(""); setEditingId(model.id); setDiscoveredModels([]); setSelectedModelIds([]);
    setForm({ name: model.name, baseUrl: model.baseUrl, modelId: model.modelId, secret: "", systemPrompt: model.systemPrompt, timeoutMinutes: String(timeoutMinutes(model.timeoutMs)) });
    setFormOpen(true);
  }
  async function discover() {
    setBusy("discover"); setError(""); setDiscoveredModels([]);
    try {
      const response = await fetch("/api/models/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: form.baseUrl, secret: form.secret, existingModelId: editingId }) });
      const payload = await response.json() as { models?: string[]; error?: string };
      if (!response.ok || !payload.models?.length) throw new Error(payload.error || "没有获取到模型");
      setDiscoveredModels(payload.models);
      const sameEndpoint = (value: string) => value.replace(/\/$/, "") === form.baseUrl.trim().replace(/\/$/, "");
      const savedCandidates = editingId
        ? models.filter((model) => sameEndpoint(model.baseUrl) && payload.models!.includes(model.modelId)).map((model) => model.modelId)
        : [];
      const manuallyEntered = parseModelIds(form.modelId).filter((modelId) => payload.models!.includes(modelId));
      const initiallySelected = [...new Set([
        ...manuallyEntered,
        ...savedCandidates,
        ...(!editingId && !manuallyEntered.length ? [payload.models[0]] : []),
      ])];
      setSelectedModelIds(initiallySelected);
      setForm((current) => ({ ...current, modelId: formatModelIds(initiallySelected) || current.modelId }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "获取模型列表失败"); }
    finally { setBusy(""); }
  }
  async function save() {
    setBusy("save"); setError("");
    const previous = editingId ? models.find((model) => model.id === editingId) : null;
    try {
      if (!editingId) {
        const response = await fetch("/api/models/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, baseUrl: form.baseUrl, modelIds: requestedModelIds, secret: form.secret, systemPrompt: form.systemPrompt, timeoutMs: Math.round(parsedTimeoutMinutes * 60_000) }) });
        const payload = await response.json() as { models?: Model[]; skippedModelIds?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "创建失败");
        if (!payload.models?.length) throw new Error("所选模型已经存在，无需重复保存");
      } else {
        const primaryModelId = previous && requestedModelIds.includes(previous.modelId) ? previous.modelId : requestedModelIds[0] ?? previous?.modelId ?? "";
        const response = await fetch(`/api/models/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, baseUrl: form.baseUrl, modelId: primaryModelId, systemPrompt: form.systemPrompt, timeoutMs: Math.round(parsedTimeoutMinutes * 60_000) }) });
        const model = await response.json() as Model & { error?: string };
        if (!response.ok) throw new Error(model.error || "更新失败");
        if (form.secret.trim()) {
          const secretResponse = await fetch(`/api/models/${model.id}/secret`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: form.secret }) });
          if (!secretResponse.ok) throw new Error("模型配置已保存，但密钥保存失败");
        }
        const additionalModelIds = requestedModelIds.filter((modelId) => modelId !== model.modelId);
        if (additionalModelIds.length) {
          const bulkResponse = await fetch("/api/models/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, appendModelIdToName: true, baseUrl: form.baseUrl, existingModelId: model.id, modelIds: additionalModelIds, secret: form.secret, systemPrompt: form.systemPrompt, timeoutMs: Math.round(parsedTimeoutMinutes * 60_000) }) });
          const bulkPayload = await bulkResponse.json() as { error?: string };
          if (!bulkResponse.ok) throw new Error(bulkPayload.error || "新增候选模型失败");
        }
        if (previous && previous.name !== model.name) {
          if ([previous.id, previous.name].includes(studio.data.settings.chatModel)) studio.updateSettings({ chatModel: model.id });
          if ([previous.id, previous.name].includes(studio.data.settings.generateModel)) studio.updateSettings({ generateModel: model.id });
          if ([previous.id, previous.name].includes(studio.data.settings.reviewModel)) studio.updateSettings({ reviewModel: model.id });
        }
      }
      closeForm(); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : (editingId ? "更新失败" : "创建失败")); }
    finally { setBusy(""); }
  }
  async function test(id: string) {
    setBusy(id); setError("");
    try { const response = await fetch(`/api/models/${id}/test`, { method: "POST" }); const payload = await response.json() as { latencyMs?: number; error?: string }; if (!response.ok) throw new Error(payload.error || "连接失败"); window.alert(`连接正常，耗时 ${payload.latencyMs}ms`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "连接失败"); }
    finally { setBusy(""); }
  }
  async function remove(model: Model) {
    if (!window.confirm(`删除模型「${model.name}」？`)) return;
    await fetch(`/api/models/${model.id}`, { method: "DELETE" });
    if ([model.id, model.name].includes(studio.data.settings.chatModel)) studio.updateSettings({ chatModel: "" });
    if ([model.id, model.name].includes(studio.data.settings.generateModel)) studio.updateSettings({ generateModel: "" });
    if ([model.id, model.name].includes(studio.data.settings.reviewModel)) studio.updateSettings({ reviewModel: "" });
    await load();
  }
  return <>
    <Group className="settings-actionbar" justify="space-between" align="center">
      <Text c="dimmed" size="sm">{models.length} 个模型</Text>
      <Button size="sm" leftSection={<Icon name="plus" />} onClick={openCreate}>新建模型</Button>
    </Group>
    {!formOpen && error && <Alert className="settings-error" color="red" role="alert">{error}</Alert>}
    <Modal
      opened={formOpen}
      onClose={closeForm}
      closeButtonProps={{ "aria-label": "关闭模型编辑" }}
      title={editingId ? "编辑模型" : "新建模型"}
      size="lg"
      fullScreen={compact}
      centered={!compact}
      classNames={{ content: "ws-modal-content", header: "ws-modal-header", body: "model-form-modal" }}
      overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
    >
      <Stack className="model-editor-stack" gap="md">
        {error && <Alert className="model-form-error" color="red" role="alert">{error}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <TextInput label={selectedModelIds.length > 1 ? "显示名称前缀" : "显示名称"} description={selectedModelIds.length > 1 ? "新增候选会自动附加自己的模型 ID" : undefined} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <TextInput label="接口地址" value={form.baseUrl} onChange={(event) => { setForm({ ...form, baseUrl: event.target.value }); setDiscoveredModels([]); setSelectedModelIds([]); }} />
          <PasswordInput label="API 密钥" autoComplete="new-password" value={form.secret} onChange={(event) => { setForm({ ...form, secret: event.target.value }); setDiscoveredModels([]); setSelectedModelIds([]); }} />
          <NumberInput label="超时" aria-label="超时（分钟）" min={0.1} max={10} step={0.1} decimalScale={2} suffix=" 分钟" value={form.timeoutMinutes} error={!timeoutIsValid ? "请输入 0.1–10 分钟" : undefined} onChange={(value) => setForm({ ...form, timeoutMinutes: String(value) })} />
        </SimpleGrid>
        <div className="model-id-field">
          <Group className="model-field-heading" justify="space-between" align="end">
            <Text component="label" htmlFor="model-id-input" size="sm" fw={500}>模型 ID</Text>
            {!compact && <Button variant="light" size="xs" aria-label="Fetch 模型列表" loading={busy === "discover"} disabled={!form.baseUrl.trim()} onClick={() => void discover()}>{discoveredModels.length ? "重新 Fetch" : "Fetch 模型"}</Button>}
          </Group>
          <TextInput id="model-id-input" aria-label="模型 ID" placeholder="多个模型 ID 使用逗号分隔" value={form.modelId} onChange={(event) => { const modelId = event.target.value; setForm({ ...form, modelId }); setSelectedModelIds(parseModelIds(modelId).filter((value) => discoveredModels.includes(value))); }} />
          {compact && <Button className="mobile-model-fetch" variant="light" fullWidth leftSection={<Icon name="refresh" />} aria-label="Fetch 模型列表" loading={busy === "discover"} disabled={!form.baseUrl.trim()} onClick={() => void discover()}>{discoveredModels.length ? "重新 Fetch 模型列表" : "Fetch 模型列表"}</Button>}
          {discoveredModels.length > 0 && <MultiSelect
            className="discovered-model-select"
            label={`已获取 ${discoveredModels.length} 个模型，可多选候选`}
            description="只有这里勾选并保存的候选才会出现在 AI Chat、Generate 和 Review 中；其余 Fetch 结果不会保存。"
            aria-label="选择获取到的大模型"
            placeholder="选择一个或多个候选模型"
            searchable
            withCheckIcon
            checkIconPosition="right"
            data={discoveredModels}
            value={selectedModelIds}
            onChange={(values) => { setSelectedModelIds(values); setForm((current) => ({ ...current, modelId: formatModelIds(values) })); }}
          />}
        </div>
        <Textarea label="附加提示词" autosize minRows={3} maxRows={8} value={form.systemPrompt} onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })} />
        <Group className="model-form-actions" justify="flex-end">
          <Button variant="default" onClick={closeForm}>取消</Button>
          <Button disabled={!requestedModelIds.length || (Boolean(editingId) && !form.name.trim()) || !timeoutIsValid} loading={busy === "save"} onClick={() => void save()}>{editingId ? requestedModelIds.length > 1 ? "保存候选配置" : "保存修改" : requestedModelIds.length > 1 ? `保存 ${requestedModelIds.length} 个候选` : "保存模型"}</Button>
        </Group>
      </Stack>
    </Modal>
    <Stack gap="sm" className="model-list">
      {models.map((model) => <Card withBorder radius="md" className="model-card" key={model.id}>
        <div className="model-icon"><Icon name="spark" /></div>
        <div className="model-card-main">
          <Group justify="space-between" align="start" wrap="nowrap">
            <div><h3>{model.name}</h3><p>{model.baseUrl} · {model.modelId}</p></div>
            <Badge color={model.hasSecret ? "green" : "yellow"} variant="light">{model.hasSecret ? "可用" : "缺少密钥"}</Badge>
          </Group>
          <div className="model-card-meta"><div className="model-default-tags">{[model.id, model.name].includes(studio.data.settings.generateModel) && <em>默认 AI Generate</em>}{[model.id, model.name].includes(studio.data.settings.chatModel) && <em>默认 AI Chat</em>}{[model.id, model.name].includes(studio.data.settings.reviewModel) && <em>默认 AI Review</em>}</div></div>
        </div>
        <div className="model-card-actions">
          <Button variant="default" size="xs" onClick={() => openEdit(model)}>编辑</Button>
          <Button variant="light" size="xs" loading={busy === model.id} disabled={!model.hasSecret} onClick={() => void test(model.id)}>测试</Button>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target><Button variant="subtle" size="xs">更多</Button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item disabled={studio.data.settings.generateModel === model.id} onClick={() => studio.updateSettings({ generateModel: model.id })}>设为 Generate 默认</Menu.Item>
              <Menu.Item disabled={studio.data.settings.chatModel === model.id} onClick={() => studio.updateSettings({ chatModel: model.id })}>设为 Chat 默认</Menu.Item>
              <Menu.Item disabled={studio.data.settings.reviewModel === model.id} onClick={() => studio.updateSettings({ reviewModel: model.id })}>设为 Review 默认</Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={() => void remove(model)}>删除模型</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </Card>)}
    </Stack>
    {!models.length && <div className="empty-inline">尚未配置模型</div>}
  </>;
}

function TaskSettings() { const studio = useStudio(); return <SettingSection title="任务队列"><SettingRow title="并发任务数"><select value={studio.data.settings.taskConcurrency} onChange={(event) => studio.updateSettings({ taskConcurrency: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></SettingRow><SettingRow title="自动重试"><span className="readonly-value">2 次</span></SettingRow><SettingRow title="任务记录"><button className="secondary-button" type="button" onClick={() => studio.data.tasks.filter((task) => ["success", "failed", "cancelled"].includes(task.state)).forEach((task) => studio.removeTask(task.id))}>清除终态任务</button></SettingRow></SettingSection>; }

function DatabaseSettings() {
  const studio = useStudio();
  const [status, setStatus] = useState<{ connected?: boolean; engine?: string; revision?: number; articles?: number; searchMode?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => { void fetch("/api/database/status", { cache: "no-store" }).then((response) => response.json()).then(setStatus); }, [studio.saveStatus]);
  async function check() { setChecking(true); const response = await fetch("/api/database/integrity-check", { method: "POST" }); const result = await response.json() as { ok?: boolean; issues?: unknown[]; message?: string }; setChecking(false); window.alert(result.ok ? "完整性检查通过：未发现孤立记录或外键错误。" : `检查发现问题：${result.message || JSON.stringify(result.issues)}`); }
  return <><SettingSection title="当前数据"><div className="database-card"><span className="db-icon">DB</span><div><strong>{status?.engine ?? "本地 D1 / SQLite"}</strong><p>修订号 {status?.revision ?? "—"} · 搜索 {status?.searchMode ?? "检测中"}</p></div><span className={status?.connected === false ? "status-warning" : "status-online"}>{status?.connected === false ? "连接失败" : "已连接"}</span><button className="secondary-button" type="button" onClick={() => window.alert("数据库由本机 3002 服务管理，电脑和同一局域网内的手机访问同一份数据。")}>数据位置</button></div></SettingSection><SettingSection title="维护"><SettingRow title="数据完整性检查"><button className="secondary-button" type="button" disabled={checking} onClick={() => void check()}>{checking ? "正在检查…" : "开始检查"}</button></SettingRow></SettingSection><SettingSection title="危险操作"><SettingRow title="清除全部业务数据"><button className="danger-button" type="button" onClick={() => { const confirmText = window.prompt("输入 CLEAR 确认清除全部文章、正文、版本、人物、聊天和 AI 任务"); if (confirmText === "CLEAR") void studio.clearBusinessData(); }}>清除全部业务数据</button></SettingRow></SettingSection></>;
}

function SystemSettings() { const studio = useStudio(); return <><SettingSection title="运行状态"><SettingRow title="应用版本"><span className="readonly-value">Writer Studio 2.1.0 PoC</span></SettingRow><SettingRow title="本地服务"><span className="status-online">运行正常</span></SettingRow><SettingRow title="最近错误"><span className="readonly-value">暂无错误</span></SettingRow></SettingSection><SettingSection title="诊断"><SettingRow title="脱敏诊断信息"><button className="secondary-button" type="button" onClick={() => void copyTextToClipboard(JSON.stringify({ version: "2.1.0-poc", articles: studio.data.articles.length, tasks: studio.data.tasks.map((task) => task.state), browser: navigator.userAgent }, null, 2))}>复制诊断信息</button></SettingRow><SettingRow title="非业务缓存"><button className="secondary-button" type="button" onClick={() => window.alert("非业务缓存已清除，创作数据未受影响。")}>清除缓存</button></SettingRow></SettingSection></>; }

function VersionDrawer({ selectedVersionId, onClose, onPreview, onClearPreview, onNotice }: { selectedVersionId?: string; onClose: () => void; onPreview: (versionId: string) => void; onClearPreview: () => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const versions = studio.currentOutline.versions;
  const compareVersion = versions.find((version) => version.id === compareVersionId);
  const currentContent = resolvedOutlineContent(studio.currentOutline);
  return <Drawer
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭正文版本" }}
    title={<div className="ws-drawer-title"><span>正文版本</span><strong>{outlineDisplayTitle(studio.currentOutline)}</strong></div>}
    position={compact ? "bottom" : "right"}
    size={compact ? "calc(100dvh - 10px)" : 920}
    classNames={{ content: "ws-drawer-content version-drawer-shell", header: "ws-drawer-header", body: "ws-drawer-body" }}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
  >
    <div className="version-drawer" aria-label="正文版本">
      <div className="version-drawer-tools">
        <Button leftSection={<Icon name="plus" />} onClick={() => { const defaultName = timestampContentName(); const name = window.prompt("正文名称", defaultName); if (name !== null) studio.saveVersion(studio.currentOutline.id, name.trim() || defaultName, "手动", currentContent); }}>保存当前正文为新版本</Button>
        {studio.currentOutline.sourceVersionId && <Button variant="default" onClick={() => { studio.setDefaultVersion(studio.currentOutline.id); onNotice("已取消默认正文"); }}>取消默认正文</Button>}
      </div>
      {compareVersion ? <div className="diff-view">
        <Button variant="subtle" size="xs" onClick={() => setCompareVersionId(null)}>← 返回版本</Button>
        <h3>与当前正文对比</h3>
        <p><del>{currentContent.slice(0, 500) || "（当前正文为空）"}</del></p>
        <p><ins>{compareVersion.content.slice(0, 500) || "（版本正文为空）"}</ins></p>
        <div className="diff-legend"><span><i className="removed" />当前正文</span><span><i className="added" />{compareVersion.name}</span></div>
      </div> : <div className="version-list">
        <article className={!selectedVersionId ? "active current" : "current"}>
          <button className="version-preview-main" type="button" onClick={onClearPreview}><div><strong>当前正文</strong><em>{studio.currentOutline.contentOverride ? "已直接保存" : studio.currentOutline.sourceVersionId ? "当前正文" : "空正文"}</em></div><p>{formatTime(studio.currentOutline.updatedAt)} · {wordCount(currentContent)} 字</p><span>正文</span></button>
          {!selectedVersionId && <div className="version-content-preview" aria-label="当前正文内容">{currentContent || "（正文为空）"}</div>}
        </article>
        {versions.map((version) => {
          const isDefault = studio.currentOutline.sourceVersionId === version.id;
          const isActive = selectedVersionId === version.id;
          return <article className={`${isDefault ? "default" : ""} ${isActive ? "active" : ""}`} key={version.id}>
            <button className="version-preview-main" type="button" onClick={() => onPreview(version.id)}><div><strong>{version.name}</strong>{isDefault && <em>默认</em>}</div><p>{formatTime(version.createdAt)} · {wordCount(version.content)} 字</p><span>{version.source}</span></button>
            {isActive && <div className="version-content-preview" aria-label={`${version.name}正文内容`}>{version.content || "（正文为空）"}</div>}
            <div className="version-actions">
              <button type="button" onClick={() => setCompareVersionId(version.id)}>对比</button>
              <button type="button" disabled={isDefault} onClick={() => { studio.setDefaultVersion(studio.currentOutline.id, version.id); onNotice("已设为默认正文"); }}>{isDefault ? "已默认" : "设为默认"}</button>
              <button type="button" onClick={() => { const name = window.prompt("重命名版本", version.name); if (name?.trim()) studio.renameVersion(studio.currentOutline.id, version.id, name.trim()); }}>重命名</button>
              <button className="danger-text" type="button" onClick={() => { if (window.confirm(isDefault ? "删除默认版本？删除后当前正文将显示为空。" : "删除这个版本？")) studio.deleteVersion(studio.currentOutline.id, version.id); }}>删除</button>
            </div>
          </article>;
        })}
        {!versions.length && <div className="empty-inline">尚未保存正文版本</div>}
      </div>}
    </div>
  </Drawer>;
}

function TaskPanel({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string, next?: "write" | "chat") => void }) {
  const studio = useStudio();
  const refreshTasks = studio.refreshFromServer;
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => { setClock(Date.now()); void refreshTasks(); }, 3000);
    void refreshTasks();
    return () => window.clearInterval(timer);
  }, [refreshTasks]);
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
    studio.setCurrentOutline(task.outlineId);
    onOpen(task.outlineId, task.target === "AI Chat" ? "chat" : "write");
    onClose();
  }
  function cancelTask(task: AiTask) {
    if (task.target === "AI Chat" && cancelActiveChatStream(task.id)) return;
    const completedAt = new Date().toISOString();
    studio.updateTask(task.id, { state: "cancelled", phase: "cancelled", completedAt, lastProgressAt: completedAt, runnerId: undefined, leaseUntil: undefined });
    if (task.target !== "AI Chat") studio.updateOutline(task.outlineId, { state: "saved" });
    void studio.saveNow();
  }
  function retryTask(task: AiTask) {
    studio.updateTask(task.id, { state: "waiting", phase: "queued", attempt: 0, startedAt: undefined, completedAt: undefined, lastProgressAt: undefined, receivedCharacters: 0, runnerId: undefined, leaseUntil: undefined, error: undefined });
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
  return <Drawer
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭 AI 任务" }}
    title={<div className="task-drawer-title">{selectedTask && <IconButton name="back" label="返回任务列表" onClick={() => setSelectedTaskId("")} />}<div className="ws-drawer-title"><strong>{selectedTask ? "任务详情" : "AI 任务"}</strong><span>{selectedTask ? `${labels[selectedTask.state]} · ${selectedTask.target}` : activeCount ? `${activeCount} 个正在处理` : "没有进行中的任务"}</span></div></div>}
    position={compact ? "bottom" : "right"}
    size={compact ? "85dvh" : 470}
    classNames={{ content: "ws-drawer-content task-drawer-shell", header: "ws-drawer-header", body: "ws-drawer-body" }}
    overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
  >
    <div className="task-panel" aria-label="AI 任务">
      {selectedTask ? <section className="task-detail" aria-label="任务详情">
        <div className="task-detail-body">
          <div className={`task-detail-status ${isStale(selectedTask) ? "stale" : ""}`}><span className={`state-dot ${selectedTask.state}`} /><strong>{isStale(selectedTask) ? "执行心跳已中断" : labels[selectedTask.state]}</strong><span>{phaseLabels[selectedTask.phase ?? "queued"]} · 已用时 {taskElapsed(selectedTask)}</span></div>
          <dl className="task-detail-metadata">
            <div><dt>生成目标</dt><dd>{selectedTask.target}{selectedTask.target === "正文" ? ` · ${(selectedTask.contextOptions?.targetWords ?? 5000).toLocaleString("zh-CN")} 字` : ""}</dd></div>
            {selectedTask.target === "正文" && <div><dt>生成方式</dt><dd>{contentGenerationModeLabel(selectedTask.contextOptions?.contentMode)}</dd></div>}
            <div><dt>模型</dt><dd>{modelDisplayLabel([], selectedTask.model || "", selectedTask.contextOptions?.modelId, selectedTask.contextOptions?.modelName)}</dd></div>
            <div><dt>阶段</dt><dd>{phaseLabels[selectedTask.phase ?? "queued"]}</dd></div>
            <div><dt>尝试</dt><dd>{selectedTask.attempt ? `${selectedTask.attempt} / 3` : "—"}</dd></div>
            <div><dt>超时</dt><dd>{duration(selectedTask.timeoutMs ?? 600_000)}</dd></div>
            <div><dt>已接收</dt><dd>{(selectedTask.receivedCharacters ?? 0).toLocaleString("zh-CN")} 字符</dd></div>
            <div><dt>提交时间</dt><dd>{taskTime(selectedTask.createdAt)}</dd></div>
            <div><dt>最近更新</dt><dd>{selectedTask.lastProgressAt ? taskTime(selectedTask.lastProgressAt) : "—"}</dd></div>
            <div className="wide"><dt>位置</dt><dd>{selectedArticle?.title ?? "已删除的文章"} / {selectedChapter?.title ?? "已删除的章节"} / {selectedOutline ? outlineDisplayTitle(selectedOutline) : "已删除的大纲"}</dd></div>
          </dl>
          <section className="task-detail-section"><h3>任务指令</h3><div className="task-detail-copy">{selectedTask.prompt || "按大纲生成（无补充指令）"}</div></section>
          {selectedTask.contextOptions && <section className="task-detail-section"><h3>生成上下文</h3><div className="task-context-tags">{selectedTask.target === "正文" && <span>{contentGenerationModeLabel(selectedTask.contextOptions.contentMode)}</span>}<span>{selectedTask.contextOptions.includePrevious ? "包含前面大纲" : "不包含前面大纲"}</span><span>{selectedTask.contextOptions.includeCharacters ? "包含相关人物" : "不包含相关人物"}</span>{selectedTask.target === "正文" && <span>{selectedTask.contextOptions.contentMode === "fresh" ? "不发送当前正文" : "包含当前正文"}</span>}{selectedTask.target === "正文" && selectedTask.contextOptions.firstAppearanceCharacterIds && <span>首次出场：{selectedFirstAppearanceNames.length ? selectedFirstAppearanceNames.join("、") : "无"}</span>}{typeof selectedTask.contextOptions.estimatedCharacters === "number" && <span>约 {selectedTask.contextOptions.estimatedCharacters.toLocaleString("zh-CN")} 字符</span>}{selectedTask.contextOptions.sessionId && <span>会话 {selectedTask.contextOptions.sessionId}</span>}</div></section>}
          {selectedTask.error && <section className="task-detail-section task-detail-error"><h3>错误</h3><div>{selectedTask.error}</div></section>}
          <section className="task-detail-section"><h3>任务结果</h3>{selectedResult ? <div className="task-detail-result" aria-label="任务结果">{selectedResult}</div> : <div className="task-detail-empty">{selectedTask.state === "waiting" || selectedTask.state === "running" ? "任务尚未产生结果" : "没有可用结果"}</div>}</section>
        </div>
        <footer className="task-detail-actions">
          <button type="button" onClick={() => locate(selectedTask)}>{selectedTask.state === "success" && selectedTask.target === "正文" ? "打开当前正文" : "打开对应内容"}</button>
          {(selectedTask.state === "waiting" || selectedTask.state === "running") && <button type="button" onClick={() => cancelTask(selectedTask)}>取消</button>}
          {selectedTask.state === "success" && selectedTask.target !== "AI Chat" && selectedTask.target !== "正文" && <button type="button" onClick={() => applyResult(selectedTask)}>应用结果</button>}
          {(selectedTask.state === "failed" || selectedTask.state === "cancelled" || isStale(selectedTask)) && (selectedTask.target === "AI Chat" ? <button type="button" onClick={() => { studio.setChatDraft(selectedTask.outlineId, selectedTask.prompt); locate(selectedTask); }}>再次发送</button> : <button type="button" onClick={() => retryTask(selectedTask)}>重新执行</button>)}
          {["success", "failed", "cancelled"].includes(selectedTask.state) && <button className="danger-text" type="button" onClick={() => { setSelectedTaskId(""); studio.removeTask(selectedTask.id); }}>移除</button>}
        </footer>
      </section> : <><div className="task-list">{tasks.map((task) => {
        const article = studio.data.articles.find((item) => item.id === task.articleId);
        const chapter = article?.chapters.find((item) => item.id === task.chapterId);
        const outline = chapter?.outlines.find((item) => item.id === task.outlineId);
        return <article className="task-card" key={task.id}>
          <div className="task-state"><span className={`state-dot ${task.state}`} />{labels[task.state]} · {phaseLabels[task.phase ?? "queued"]} · {formatTime(task.createdAt)}</div>
          <button className="task-title" type="button" aria-label={`查看任务详情：${outline ? outlineDisplayTitle(outline) : "已删除的大纲"}`} onClick={() => setSelectedTaskId(task.id)}>{outline ? outlineDisplayTitle(outline) : "已删除的大纲"}</button>
          <p>{article?.title ?? "未知文章"} · {chapter?.title ?? "未知章节"} · 目标：{task.target}{task.target === "正文" ? ` · ${contentGenerationModeLabel(task.contextOptions?.contentMode)} · ${(task.contextOptions?.targetWords ?? 5000).toLocaleString("zh-CN")} 字` : ""}</p>
          <blockquote>{task.prompt || "按大纲生成"}</blockquote>
          {task.error && <p className="task-error">{task.error}</p>}
          <div><span>{modelDisplayLabel([], task.model || "", task.contextOptions?.modelId, task.contextOptions?.modelName)}</span><span className="task-buttons">
            <button type="button" onClick={() => setSelectedTaskId(task.id)}>打开</button>
            {(task.state === "waiting" || task.state === "running") && <button type="button" onClick={() => cancelTask(task)}>取消</button>}
            {task.state === "success" && task.target !== "AI Chat" && task.target !== "正文" && <button type="button" onClick={() => { applyResult(task); locate(task); }}>应用结果</button>}
            {(task.state === "failed" || task.state === "cancelled" || isStale(task)) && (task.target === "AI Chat" ? <button type="button" onClick={() => { studio.setChatDraft(task.outlineId, task.prompt); locate(task); }}>再次发送</button> : <button type="button" onClick={() => retryTask(task)}>重新执行</button>)}
            {["success", "failed", "cancelled"].includes(task.state) && <button type="button" onClick={() => studio.removeTask(task.id)}>移除</button>}
          </span></div>
        </article>;
      })}{!tasks.length && <div className="empty-inline">暂无 AI 任务</div>}</div>
      <footer><span>生成并发 {generateRunningCount} / {studio.data.settings.taskConcurrency}{chatRunningCount ? ` · Chat ${chatRunningCount}` : ""}</span><span className="task-footer-actions"><button type="button" disabled={!completedCount} onClick={() => studio.clearCompletedTasks()}>清空已完成{completedCount ? ` (${completedCount})` : ""}</button><button type="button" onClick={() => { onClose(); window.history.pushState({}, "", "/settings/tasks"); window.dispatchEvent(new PopStateEvent("popstate")); }}>任务设置 →</button></span></footer></>}
    </div>
  </Drawer>;
}

function NewArticleDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (fields: Pick<Article, "title" | "summary" | "type" | "style">) => void }) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [type, setType] = useState("");
  const [style, setStyle] = useState("");
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} aria-label="关闭新建文章" /><form className="dialog" onSubmit={(event) => { event.preventDefault(); onCreate({ title: title.trim(), summary, type, style }); }}><header><div><span className="article-mark">新</span><h2>新建文章</h2></div><IconButton name="close" label="关闭" onClick={onClose} /></header><label>标题 <em>必填</em><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} /></label><label>简介 <textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={10000} /></label><div className="dialog-grid"><label>文章类型<input value={type} onChange={(event) => setType(event.target.value)} maxLength={120} /></label><label>写作风格<input value={style} onChange={(event) => setStyle(event.target.value)} maxLength={5000} /></label></div><footer><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-compact" type="submit" disabled={!title.trim()}>创建文章</button></footer></form></div>;
}
