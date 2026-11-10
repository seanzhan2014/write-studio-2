"use client";

import { rebaseOutlineExpansion } from "@/lib/outline-expansion";

import { taskReasoningEffort, taskNamingProfile, type TaskParameters } from "@/lib/task-parameters";
import { articleAiSettings, resolveAiSettings, overrideAiSettings } from "@/lib/ai-settings-inheritance";

import { ReasoningSettings } from "@/app/ui/reasoning-settings";

import { normalizeReviewRounds, normalizeReviewRules, normalizeReviewStrategy } from "@/lib/generate-review.mjs";

import { normalizePreparationRounds, normalizePreparationStrategy } from "@/lib/writing-preparation";

import { supportsText } from "@/lib/ai-model-capabilities";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

import getCaretCoordinates from "textarea-caret";
import { selectAiContext, summarizeAiContext } from "@/lib/ai-context";
import type { NamingArticleContext } from "@/db/ai-naming";
import { timestampContentName } from "@/lib/content-name.mjs";
import { normalizeExcellentFragments } from "@/lib/excellent-fragments.mjs";
import { descriptionDetailLabel, dialogueDensityLabel, introspectionDensityLabel, narrativePaceLabel, paragraphLengthLabel, normalizeProseControls, type AiGenerateOptions, normalizeRewriteRetentionLevel, type ContentGenerationMode, type RewriteRetentionLevel } from "@/lib/generate-options";
import { currentOutlineVersion, resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle } from "@/lib/outline-title";
import { modelSelectionLabel } from "@/lib/model-label";

import { fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { useStudio, type AiTask, type Article, type Chapter, type ExcellentFragment, type Outline, type Version } from "@/app/studio-state";

import { type IconName, type ServerTaskInput, type ActiveChatStream, type ConfiguredModel, type GenerateContextSummary, type View } from "@/app/ui/studio/types";

export const iconPaths: Record<Exclude<IconName, "stop">, string[]> = {
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

export function Icon({ name }: { name: IconName }) {
  return <span className={`icon icon-${name}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{name === "stop" ? <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /> : name === "more" ? [5, 12, 19].map((cx) => <circle cx={cx} cy="12" r="1.45" fill="currentColor" stroke="none" key={cx} />) : iconPaths[name].map((path) => <path d={path} key={path} />)}</svg></span>;
}

export function clientId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`}`;
}

export function chapterIsEmpty(chapter: Chapter) {
  return chapter.outlines.length <= 1 && chapter.outlines.every((item) => (
    !normalizeOutlineTitle(item.title)
    && !item.plan.trim()
    && !resolvedOutlineContent(item).trim()
    && !item.versions.some((version) => version.content.trim())
    && !item.chat.sessions.some((session) => session.draft.trim() || session.messages.length > 0)
  ));
}

export async function createServerTask(studio: ReturnType<typeof useStudio>, input: ServerTaskInput) {
  const taskId = clientId("task");
  const taskParameters = input.taskParameters ?? resolveAiSettings(studio.currentArticle, input.outlineId, "generate", "outline", studio.data.settings).value.tasks!;
  const preparationEnabled = (input.preparationEnabled ?? taskParameters.preparationEnabled) !== false;
  const response = await fetchServerAction("/api/ai/tasks", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "Idempotency-Key": taskId },
    body: JSON.stringify({ ...input, ...(input.target === "content" ? {
      preparationEnabled,
      reviewMaxRounds: normalizeReviewRounds(taskParameters.reviewMaxRounds),
      reviewInstruction: normalizeReviewRules(taskParameters.reviewInstruction),
      reviewStrategy: normalizeReviewStrategy(taskParameters.reviewStrategy),
      reviewModelMode: taskParameters.reviewModelMode === "fixed" ? "fixed" : "inherit",
      reviewModel: taskParameters.reviewModel,
      reviewReasoningEffort: taskReasoningEffort(taskParameters.reviewReasoningEffort),
      reviewReasoningEffortInheritModel: taskParameters.reviewReasoningEffort === "__inherit__",
    } : {}), ...(input.target === "content" && input.model.trim() && preparationEnabled ? {
      preparationRounds: input.preparationRounds ?? normalizePreparationRounds(taskParameters.preparationMaxRounds),
      preparationStrategy: input.preparationStrategy ?? normalizePreparationStrategy(taskParameters.preparationStrategy),
      preparationRequireConfirmation: input.preparationRequireConfirmation ?? taskParameters.preparationRequireConfirmation === true,
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
          expansion: input.currentExpansion === undefined ? rebaseOutlineExpansion(outline.plan, input.currentPlan!, outline.expansion) : input.currentExpansion,
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

export function namingArticleContext(article: Article, globalSettings: object = {}): NamingArticleContext {
  const defaults = resolveAiSettings(article, article.id, "generate", "outline", globalSettings).articleDefaults;
  const namingFor = (id: string, level: "chapter" | "outline") => {
    const options = resolveAiSettings(article, id, "generate", level, globalSettings).value;
    const build = (value: AiGenerateOptions) => ({ model: String(value.tasks!.namingModelMode === "fixed" ? value.tasks!.namingModel : value.model), reasoningEffort: taskReasoningEffort(value.tasks!.namingReasoningEffort), chapterNaming: taskNamingProfile(value.tasks!, "chapterNaming"), outlineNaming: taskNamingProfile(value.tasks!, "outlineNaming") });
    const settings = build(options);
    return JSON.stringify(settings) === JSON.stringify(build(defaults)) ? undefined : settings;
  };
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    style: article.style,
    chapterNaming: taskNamingProfile(defaults.tasks!, "chapterNaming"),
    outlineNaming: taskNamingProfile(defaults.tasks!, "outlineNaming"),
    chapters: article.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      archived: chapter.archived,
      naming: namingFor(chapter.id, "chapter"),
      outlines: chapter.outlines.map((outline) => ({ id: outline.id, title: outline.title, plan: outline.plan, archived: outline.archived, naming: namingFor(outline.id, "outline") })),
    })),
  };
}

export const activeChatStreams = new Map<string, ActiveChatStream>();

export function registerActiveChatStream(taskId: string, stream: ActiveChatStream) {
  activeChatStreams.set(taskId, stream);
}

export function releaseActiveChatStream(taskId: string, controller: AbortController) {
  if (activeChatStreams.get(taskId)?.controller === controller) activeChatStreams.delete(taskId);
}

export function cancelActiveChatStream(taskId: string) {
  const stream = activeChatStreams.get(taskId);
  if (!stream) return false;
  stream.cancel();
  return true;
}

export function useDismissOnOutside(open: boolean, onClose: () => void, insideSelector: string) {
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

export async function copyTextToClipboard(text: string) {
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

export function configuredModelForReference(models: ConfiguredModel[], reference: string) {
  const normalized = reference.trim();
  return models.find((model) => model.id === normalized || model.name === normalized || modelSelectionLabel(model) === normalized);
}

export function ExcellentText({ text, fragments }: { text: string; fragments?: ExcellentFragment[] }) {
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

export function resolvedExcellentFragments(outline: Outline) {
  const version = currentOutlineVersion(outline);
  return version
    ? normalizeExcellentFragments(version.content, version.excellentFragments)
    : normalizeExcellentFragments(outline.content, outline.excellentFragments);
}

export function directContentId(outlineId: string) {
  return `content:${outlineId}`;
}

export function directContentPreview(outline: Outline): Version {
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

export function locateRewriteSource(articles: Article[], sourceId: string) {
  for (const article of articles) for (const chapter of article.chapters) for (const outline of chapter.outlines) {
    if (sourceId === directContentId(outline.id)) return { articleId: article.id, outlineId: outline.id, previewId: sourceId };
    if (outline.versions.some((version) => version.id === sourceId)) return { articleId: article.id, outlineId: outline.id, previewId: sourceId };
  }
  return null;
}

export function textOffsetWithin(root: HTMLElement, node: Node, offset: number) {
  if (node !== root && !root.contains(node)) return null;
  const range = document.createRange();
  range.setStart(root, 0);
  try { range.setEnd(node, offset); } catch { return null; }
  return range.toString().length;
}

export function selectedRangeWithin(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const start = textOffsetWithin(root, range.startContainer, range.startOffset);
  const end = textOffsetWithin(root, range.endContainer, range.endOffset);
  return start === null || end === null || end <= start ? null : { start, end };
}

export function canonicalModelReference(models: ConfiguredModel[], reference: string) {
  return configuredModelForReference(models, reference)?.id ?? reference.trim();
}

export function updateScopedTaskParameters(studio: ReturnType<typeof useStudio>, level: "article" | "chapter" | "outline", targetId: string, patch: TaskParameters) {
  const options = level === "article" ? articleAiSettings(studio.currentArticle, "generate", studio.data.settings) : resolveAiSettings(studio.currentArticle, targetId, "generate", level === "chapter" ? "chapter" : "outline", studio.data.settings).value;
  const next = overrideAiSettings(options, { tasks: { ...options.tasks, ...patch } });
  if (level === "article") studio.updateArticle({ aiGenerateSettings: next });
  else if (level === "outline") studio.updateOutline(targetId, { generateOptions: next });
  else { const chapter = studio.currentArticle.chapters.find(chapter => chapter.id === targetId)!; studio.updateChapter(targetId, { settings: { ...chapter.settings!, aiTasks: { ...chapter.settings?.aiTasks, generate: next } } }); }
}

export function TaskReasoningSettings({ kind, model, disabled = false, level = "outline", targetId }: { kind: "generate" | "chat" | "naming" | "review"; model?: ConfiguredModel; disabled?: boolean; level?: "article" | "chapter" | "outline"; targetId?: string }) {
  const studio = useStudio();
  const key = `${kind}ReasoningEffort` as const;
  const id = targetId ?? studio.currentOutline.id;
  const options = resolveAiSettings(studio.currentArticle, id, "generate", level === "chapter" ? "chapter" : "outline", studio.data.settings).value;
  const tasks = level === "article" ? articleAiSettings(studio.currentArticle, "generate", studio.data.settings).tasks! : options.tasks!;
  return <ReasoningSettings value={kind === "generate" ? options.reasoningEffort : taskReasoningEffort(tasks[key])} modelValue={model?.reasoningEffort} disabled={disabled} onChange={(value) => { if (kind === "generate") studio.updateOutline(id, { generateOptions: overrideAiSettings(options, { reasoningEffort: value }) }); else updateScopedTaskParameters(studio, level, id, { [key]: value === null ? "__omit__" : value ?? "__inherit__" }); }} />;
}

export function modelDisplayLabel(models: ConfiguredModel[], selectedModel: string, fixedModelName?: string) {
  const reference = selectedModel.trim();
  if (!reference) return "本地演示引擎";
  const configured = configuredModelForReference(models, reference);
  return configured ? modelSelectionLabel(configured) : fixedModelName?.trim() || reference;
}

export function chatbotDisplayName(models: ConfiguredModel[], selectedModel: string) {
  return modelDisplayLabel(models, selectedModel);
}

export function useConfiguredModels() {
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

export const contentGenerationModes: Array<{ value: ContentGenerationMode; label: string; description: string; mobileDescription: string }> = [
  { value: "fresh", label: "全新生成", description: "只依据当前大纲独立创作，不发送现有正文。", mobileDescription: "仅依据大纲，不发送现有正文" },
  { value: "rewrite", label: "改写正文", description: "以现有正文为原稿，返回完整的改写候选。", mobileDescription: "基于现有正文，返回完整候选" },
  { value: "continue", label: "续写正文", description: "模型只生成新增部分，保存时自动接到现有正文后。", mobileDescription: "只生成新增正文，保存时自动追加" },
];

export const rewriteRetentionOptions: Array<{ value: RewriteRetentionLevel; label: string; shortLabel: string; description: string }> = [
  { value: "low", label: "低保留", shortLabel: "深度重写", description: "只保留核心情节、人物设定和必要事实，允许全面重构叙述、句段与对白措辞。" },
  { value: "balanced", label: "平衡", shortLabel: "平衡改写", description: "保留事实、因果、视角和关键对白意图，可以重组句段并调整节奏。" },
  { value: "high", label: "高保留", shortLabel: "轻度润色", description: "尽量保留事件顺序、段落结构和关键信息，主要润色措辞与局部句式。" },
];

export function contentGenerationModeLabel(mode?: ContentGenerationMode) {
  return contentGenerationModes.find((item) => item.value === mode)?.label ?? "全新生成";
}

export function rewriteRetentionLabel(level?: RewriteRetentionLevel) {
  const normalized = normalizeRewriteRetentionLevel(level);
  return rewriteRetentionOptions.find((item) => item.value === normalized)?.label ?? "平衡";
}

export function resolvedProseControls(options?: AiTask["contextOptions"]) {
  return normalizeProseControls(options?.proseControls, options?.dialogueDensity);
}

export function proseControlsSummary(options?: AiTask["contextOptions"]) {
  const controls = resolvedProseControls(options);
  return `对话 ${dialogueDensityLabel(controls.dialogueDensity)} · 心理 ${introspectionDensityLabel(controls.introspectionDensity)} · 描写 ${descriptionDetailLabel(controls.descriptionDetail)} · 节奏 ${narrativePaceLabel(controls.narrativePace)} · 段落 ${paragraphLengthLabel(controls.paragraphLength)}`;
}

export function ProseControlRow<T extends string>({ id, label, value, options, onChange, className = "", compactHelp = false }: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
  className?: string;
  compactHelp?: boolean;
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
    {compactHelp ? <small id={descriptionId} className="prose-control-description">{options.find((item) => item.value === value)?.description}</small> : <details className="prose-control-help"><summary>{label}说明</summary><small id={descriptionId}>{options.find((item) => item.value === value)?.description}</small></details>}
  </div>;
}

export function generateLengthLabel(options?: AiTask["contextOptions"]) {
  const expansion = options?.promptContext?.currentOutline.expansion;
  return expansion ? `大纲倍率 · 预计约 ${expansion.estimatedCharacters.toLocaleString("zh-CN")} 字` : generateTargetWordsLabel(options?.targetWords);
}

export function generateTargetWordsLabel(targetWords?: number) {
  return targetWords && targetWords > 0 ? `${targetWords.toLocaleString("zh-CN")} 字` : "不限字数";
}

export function activeChatSession(outline: Outline) {
  return outline.chat.sessions.find((session) => session.id === outline.chat.activeSessionId) ?? outline.chat.sessions[0];
}

export function generateContextSummary(article: Article, outline: Outline, instruction: string, includePrevious: boolean, includeCharacters: boolean, target: "content" | "outline" | "chapter-title" = "content", contentMode: ContentGenerationMode = "fresh", firstAppearanceCharacterIds?: string[], includeExcellentFragments = false, excellentFragmentIds?: string[]): GenerateContextSummary {
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

export function IconButton({
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

export function VirtualList<T extends { id: string }>({ items, rowHeight, maxHeight, className, renderItem }: { items: T[]; rowHeight: number; maxHeight: number; className: string; renderItem: (item: T, index: number, style: CSSProperties) => ReactNode }) {
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

export function viewFromPath(pathname: string): View {
  if (pathname.endsWith("/chapters/edit-all")) return "outline-edit";
  if (pathname.endsWith("/outlines/edit-all")) return "outline-edit";
  if (pathname.endsWith("/outlines")) return "outline-home";
  if (pathname.includes("/chat")) return "chat";
  if (pathname.includes("/generate")) return "generate";
  if (pathname.includes("/illustrations")) return "illustrations";
  if (pathname.includes("/chapters/")) return "chapter";
  if (pathname.endsWith("/edit") || pathname.endsWith("/read")) return "read";
  if (pathname.endsWith("/search")) return "search";
  if (pathname.includes("/info/ai-tasks")) return "outline-edit";
  // Keep old article AI bookmarks in the chapter and outline settings view.
  if (pathname.includes("/info/review-rules")) return "outline-edit";
  if (pathname.includes("/info/chapters")) return "outline-edit";
  if (pathname.includes("/info/characters")) return "info-characters";
  if (pathname.includes("/info/relationships")) return "info-relationships";
  if (pathname.includes("/info/references")) return "info-references";
  if (pathname.includes("/info/")) return "info-basic";
  if (pathname.includes("/settings/appearance")) return "settings-appearance";
  if (pathname.includes("/settings/models")) return "settings-models";
  if (pathname.includes("/settings/prompts")) return "settings-tasks";
  if (pathname.includes("/settings/tasks")) return "settings-tasks";
  if (pathname.includes("/settings/database")) return "settings-database";
  if (pathname.includes("/settings/system")) return "settings-system";
  if (pathname.includes("/settings/")) return "settings-general";
  return "write";
}

export function routeFor(view: View, articleId: string, outlineId: string, chapterId: string) {
  const base = `/articles/${articleId}`;
  const paths: Record<View, string> = {
    "outline-home": `${base}/outlines`,
    write: `${base}/outlines/${outlineId}/write`,
    chat: `${base}/outlines/${outlineId}/chat`,
    generate: `${base}/outlines/${outlineId}/generate`,
    illustrations: `${base}/outlines/${outlineId}/illustrations`,
    chapter: `${base}/chapters/${chapterId}`,
    "outline-edit": `${base}/outlines/edit-all`,
    read: `${base}/edit`,
    search: `${base}/search`,
    "info-basic": `${base}/info/basic`,
    "info-references": `${base}/info/references`,
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

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function AutoGrowTextarea({ value, onChange, onFocus, onBlur, className, label, placeholder, maxLength, spellCheck = true, style }: {
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

export function textareaCaretBounds(textarea: HTMLTextAreaElement) {
  const computed = window.getComputedStyle(textarea);
  const textareaBounds = textarea.getBoundingClientRect();
  const caretOffset = textarea.selectionDirection === "backward" ? textarea.selectionStart : textarea.selectionEnd;
  const caret = getCaretCoordinates(textarea, caretOffset);
  const fallbackLineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.4 || 22;
  const caretHeight = Number.isFinite(caret.height) && caret.height > 0 ? caret.height : fallbackLineHeight;
  const top = textareaBounds.top + caret.top - textarea.scrollTop;
  return { top, bottom: top + caretHeight };
}

export function useWritingEditorViewport(scrollRef: { current: HTMLDivElement | null }, editorRef: { current: HTMLTextAreaElement | null }, editing: boolean) {
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

export function useContinuousEditorViewport(scrollRef: { current: HTMLDivElement | null }) {
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

export function SearchGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="search-group"><h2>{title}</h2>{children}</section>;
}

export function SearchResult({ type, title, snippet, onClick }: { type: string; title: string; snippet: string; onClick: () => void }) {
  return <button className="search-result" type="button" onClick={onClick}><span className="result-type">{type}</span><div><span className="ui-title">{title}</span><p>{snippet}</p></div><span>打开 →</span></button>;
}
