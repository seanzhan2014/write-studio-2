"use client";
import { configuredModelFilter } from "@/app/ui/model-options";

import { advancedText, GENERATE_FIELDS } from "@/lib/advanced-writing";
import { GenerateAdvancedFields } from "@/app/ui/advanced-writing";
import { AiSettingsInheritance } from "@/app/ui/ai-settings-inheritance";
import { OutlineExpansionEditor } from "@/app/ui/outline-expansion-editor";
import { normalizeOutlineExpansion, outlineExpansionForEditing, rebaseOutlineExpansion, resolveOutlineExpansion, type OutlineExpansion } from "@/lib/outline-expansion";
import { TaskParameterSettings } from "@/app/ui/task-parameter-settings";
import { taskNamingProfile, taskReviewSnapshot } from "@/lib/task-parameters";
import { globalAiSettings, resolveAiSettings, inheritAiSettings, overrideGenerateSettings } from "@/lib/ai-settings-inheritance";

import { ReasoningSettings } from "@/app/ui/reasoning-settings";
import { resolveReasoningEffort } from "@/lib/reasoning-options";
import { generateModelUsageStorageKey, normalizeGenerateModelUsage, rememberGenerateModelUsage, sortGenerateModelOptions, type GenerateModelUsage } from "@/lib/generate-model-usage";
import { normalizeReviewRounds, normalizeReviewRules, normalizeReviewStrategy } from "@/lib/generate-review.mjs";

import { hasReviewRules } from "@/lib/review-rules.mjs";

import { TaskHistory } from "@/app/ui/task-history";
import { TaskInteraction } from "@/app/ui/task-interaction";
import { isTaskAwaitingAuthor } from "@/lib/writing-preparation";

import { taskPhaseLabels } from "@/lib/task-history";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NumberPresetMenu } from "@/app/ui/compact-controls";
import { Menu, Button, Checkbox, Group, NumberInput, Select, Text, Textarea, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import { detectFirstAppearanceCharacters, selectAiContext, type FirstAppearanceSuggestion } from "@/lib/ai-context";

import { resolvedOutlineContentName } from "@/lib/content-name.mjs";

import { CLOSING_SUMMARY_OPTIONS, normalizeClosingSummaryLength, DESCRIPTION_DETAIL_OPTIONS, DIALOGUE_DENSITY_OPTIONS, INTROSPECTION_DENSITY_OPTIONS, NARRATIVE_PACE_OPTIONS, PARAGRAPH_LENGTH_OPTIONS, hasActiveProseControls, normalizeAiGenerateOptions, generateExpressionSettings, generateExpressionKey, type AiGenerateOptions, MAX_GENERATE_PRESETS, MAX_GENERATE_PRESET_CHARACTERS, MAX_GENERATE_TARGET_WORDS, MIN_GENERATE_TARGET_WORDS, normalizeGeneratePresets, normalizeRewriteRetentionLevel, type ContentGenerationMode } from "@/lib/generate-options";
import { resolvedOutlineContent } from "@/lib/outline-content";
import { outlineDisplayTitle } from "@/lib/outline-title";

import { fetchServerAction, readServerJson } from "@/lib/browser-network";
import { useStudio, type AiTask, type Character } from "@/app/studio-state";

import { ResponsiveModal, ScrollableDrawer } from "@/app/ui/overlays";
import { ScopedSettingsInline } from "@/app/ui/story-settings-editor";

import { type GenerateTextareaHeightRecord, type GenerateTextareaHeightSlot, type ConfiguredModel, type GenerateContextSummary } from "@/app/ui/studio/types";

import { generateTextareaHeightStorageKey, maxRememberedGenerateTextareas } from "@/app/ui/studio/writing";

import { rewriteRetentionOptions, generateContextSummary, configuredModelForReference, modelDisplayLabel, resolvedProseControls, createServerTask, Icon, contentGenerationModes, ProseControlRow, contentGenerationModeLabel, rewriteRetentionLabel, proseControlsSummary, generateLengthLabel } from "@/app/ui/studio/shared";

export function readGenerateTextareaHeights(): GenerateTextareaHeightRecord {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(generateTextareaHeightStorageKey) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry && typeof entry === "object" && !Array.isArray(entry))) as GenerateTextareaHeightRecord;
  } catch {
    return {};
  }
}

export function rememberedGenerateTextareaHeight(outlineId: string, slot: GenerateTextareaHeightSlot) {
  const value = Number(readGenerateTextareaHeights()[outlineId]?.[slot]);
  return Number.isFinite(value) && value >= 60 && value <= 3000 ? Math.round(value) : undefined;
}

export function writeGenerateTextareaHeight(outlineId: string, slot: GenerateTextareaHeightSlot, height: number) {
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

export function useRememberedGenerateTextareaHeight(outlineId: string, slot: GenerateTextareaHeightSlot) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [element, setElement] = useState<HTMLTextAreaElement | null>(null);
  const registerTextarea = useCallback((node: HTMLTextAreaElement | null) => { textareaRef.current = node; setElement(node); }, []);
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
  }, [outlineId, slot, element]);
  return [textareaRef, registerTextarea] as const;
}

export function GenerateView({ models, outline, initialPrompt = "", onTaskCreated, onOpenTasks, independent = false, instanceId }: { models: ConfiguredModel[]; outline: { title: string; plan: string; content: string }; initialPrompt?: string; onTaskCreated: () => void; onOpenTasks: () => void; independent?: boolean; instanceId?: string }) {
  const studio = useStudio();
  const [modelUsage, setModelUsage] = useState<GenerateModelUsage>({});
  useEffect(() => {
    try {
      const saved = normalizeGenerateModelUsage(JSON.parse(window.localStorage.getItem(generateModelUsageStorageKey) ?? "{}"));
      const frame = requestAnimationFrame(() => setModelUsage(saved));
      return () => cancelAnimationFrame(frame);
    } catch { /* Unavailable or invalid browser storage must not block generation. */ }
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setModelUsage((previous) => rememberGenerateModelUsage(previous, studio.data.tasks, (reference) => configuredModelForReference(models, reference)?.id)));
    return () => cancelAnimationFrame(frame);
  }, [models, studio.data.tasks]);
  useEffect(() => {
    if (!Object.keys(modelUsage).length) return;
    try {
      window.localStorage.setItem(generateModelUsageStorageKey, JSON.stringify(modelUsage));
    } catch { /* Keep the in-memory order when browser storage is unavailable. */ }
  }, [modelUsage]);
  const viewId = useId();
  const generateViewRef = useRef<HTMLDivElement>(null);
  const displayTitle = outlineDisplayTitle(outline);
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const storedPromptAtOpen = studio.currentOutline.generateInstruction;
  const hasCurrentContent = Boolean(resolvedOutlineContent(studio.currentOutline).trim());
  const resolvedGenerateSettings = resolveAiSettings(studio.currentArticle, studio.currentOutline.id, "generate", "outline", studio.data.settings);
  const inheritedGenerateOptions = resolvedGenerateSettings.previous;
  const initialGenerateOptions = resolvedGenerateSettings.value;
  if (!hasCurrentContent && initialGenerateOptions.contentMode !== "fresh") initialGenerateOptions.contentMode = "fresh";
  const [generateOptions, setGenerateOptions] = useState<AiGenerateOptions>(initialGenerateOptions);
  const [settingsScope, setSettingsScope] = useState<"outline" | "task">(independent ? "task" : "outline");
  useEffect(() => { if (!independent) return; const frame = requestAnimationFrame(() => setSettingsScope("task")); return () => cancelAnimationFrame(frame); }, [independent]);
  const generateOptionsRef = useRef(initialGenerateOptions);
  const {
    includePrevious,
    includeCharacters,
    includeExcellentFragments,
    includeOutlineTitle,
    contentMode: generationMode,
    rewriteRetention,
    model: selectedModel,
    reasoningEffort,
    firstAppearanceOverrides: appearanceOverrides,
  } = generateOptions;
  const { advanced, proseControls, closingSummaryLength } = generateExpressionSettings(generateOptions);
  const inheritedExpression = generateExpressionSettings({ ...inheritedGenerateOptions, contentMode: generationMode });
  const taskParameters = useMemo(() => ({ ...resolvedGenerateSettings.value.tasks!, ...generateOptions.tasks }), [resolvedGenerateSettings.value.tasks, generateOptions.tasks]);
  const preparationEnabled = taskParameters.preparationEnabled !== false;
  const reviewMaxRounds = normalizeReviewRounds(taskParameters.reviewMaxRounds);
  const reviewInstruction = normalizeReviewRules(taskParameters.reviewInstruction);
  const reviewStrategy = normalizeReviewStrategy(taskParameters.reviewStrategy);
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
  const [expansionDraft, setExpansionDraft] = useState<OutlineExpansion | undefined>(() => outlineExpansionForEditing(outline.plan, studio.currentOutline.expansion, studio.data.settings.outlineLengthMode));
  const expansionDraftRef = useRef(expansionDraft);
  const lastSyncedExpansionRef = useRef(studio.currentOutline.expansion);
  const expansionSnapshot = useMemo(() => resolveOutlineExpansion(outlinePlanDraft, expansionDraft, studio.data.settings.outlineExpansionMultiplier, studio.data.settings.outlineExpansionWords), [outlinePlanDraft, expansionDraft, studio.data.settings.outlineExpansionMultiplier, studio.data.settings.outlineExpansionWords]);
  function changeExpansion(next?: OutlineExpansion, plan = outlinePlanDraftRef.current) {
    const normalized = normalizeOutlineExpansion(plan, next);
    expansionDraftRef.current = normalized;
    setExpansionDraft(normalized);
  }
  function changeLengthMode(next: OutlineExpansion) {
    changeExpansion(next);
    // Store the mode immediately without committing unsaved outline text.
    if (!independent) studio.updateOutline(studio.currentOutline.id, { expansion: rebaseOutlineExpansion(outlinePlanDraftRef.current, outline.plan, next) });
  }
  const lastSyncedOutlineRef = useRef({ id: studio.currentOutline.id, plan: outline.plan });
  const [outlineSaving, setOutlineSaving] = useState(false);
  const [outlinePlanHeightRef, registerOutlinePlan] = useRememberedGenerateTextareaHeight(instanceId ? `${studio.currentOutline.id}:${instanceId}` : studio.currentOutline.id, "outlinePlan");
  const [, registerInstruction] = useRememberedGenerateTextareaHeight(instanceId ? `${studio.currentOutline.id}:${instanceId}` : studio.currentOutline.id, "instruction");
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
  const targetWordsValid = expansionDraft?.enabled === true || targetWordsUnset || (Number.isInteger(parsedTargetWords) && parsedTargetWords >= MIN_GENERATE_TARGET_WORDS && parsedTargetWords <= MAX_GENERATE_TARGET_WORDS);
  const targetWords = !expansionDraft?.enabled && targetWordsValid && !targetWordsUnset ? parsedTargetWords : undefined;
  const outlinePlanDirty = outlinePlanDraft !== outline.plan || JSON.stringify(expansionDraft) !== JSON.stringify(studio.currentOutline.expansion);
  const normalizedPrompt = prompt.trim().slice(0, 20_000);
  const promptDirty = normalizedPrompt !== savedPrompt;

  const rememberGenerateOptions = useCallback((patch: Partial<AiGenerateOptions>) => {
    const next = normalizeAiGenerateOptions(overrideGenerateSettings(generateOptionsRef.current, patch), globalAiSettings("generate", studio.data.settings));
    if (!hasCurrentContent && next.contentMode !== "fresh") next.contentMode = "fresh";
    generateOptionsRef.current = next;
    setGenerateOptions(next);
    if (settingsScope === "outline") studio.updateOutline(studio.currentOutline.id, { generateOptions: next });
  }, [hasCurrentContent, studio, settingsScope, setGenerateOptions]);

  const applyInheritedGenerateOptions = (next: AiGenerateOptions) => {
    generateOptionsRef.current = next;
    setGenerateOptions(next);
    setTargetWordsInput(next.targetWords > 0 ? String(next.targetWords) : "");
    if (settingsScope === "outline") studio.updateOutline(studio.currentOutline.id, { generateOptions: next });
  };

  useEffect(() => {
    if (settingsScope === "task") return;
    const next = resolveAiSettings(studio.currentArticle, studio.currentOutline.id, "generate", "outline", studio.data.settings).value;
    if (!hasCurrentContent && next.contentMode !== "fresh") next.contentMode = "fresh";
    if (JSON.stringify(next) === JSON.stringify(generateOptionsRef.current)) return;
    if (next.targetWords !== generateOptionsRef.current.targetWords) setTargetWordsInput(next.targetWords > 0 ? String(next.targetWords) : "");
    generateOptionsRef.current = next;
    setGenerateOptions(next);
  }, [studio.currentArticle, studio.currentOutline.id, studio.data.settings, hasCurrentContent, settingsScope]);

  useEffect(() => {
    const previous = lastSyncedOutlineRef.current;
    if (previous.id !== studio.currentOutline.id || outlinePlanDraftRef.current === previous.plan) {
      outlinePlanDraftRef.current = outline.plan;
      setOutlinePlanDraft(outline.plan);
    }
    if (previous.id !== studio.currentOutline.id || JSON.stringify(expansionDraftRef.current) === JSON.stringify(lastSyncedExpansionRef.current)) {
      const nextExpansion = studio.currentOutline.expansion
        ? normalizeOutlineExpansion(outline.plan, studio.currentOutline.expansion)
        : outlineExpansionForEditing(outline.plan, undefined, studio.data.settings.outlineLengthMode);
      expansionDraftRef.current = nextExpansion; setExpansionDraft(nextExpansion);
    }
    lastSyncedExpansionRef.current = studio.currentOutline.expansion;
    lastSyncedOutlineRef.current = { id: studio.currentOutline.id, plan: outline.plan };
  }, [studio.currentOutline.id, studio.currentOutline.expansion, studio.currentArticle, studio.data.settings, outline.plan]);
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
  const modelOptions = sortGenerateModelOptions([
    { value: "", label: "本地演示引擎" },
    ...(selectedModelReference && !selectedRecord ? [{ value: selectedModelReference, label: selectedModelReference }] : []),
    ...models.map((model) => ({ value: model.id, label: `${modelDisplayLabel(models, model.id)}${model.hasSecret ? "" : "（需密钥）"}` })),
  ], modelUsage);

  function selectGenerateModel(model: string) {
    rememberGenerateOptions({ model });
  }

  const saveOutlineDraft = useCallback(async () => {
    if (!outlinePlanDirty) return true;
    setOutlineSaving(true);
    const saved = await studio.saveOutlinePlan(studio.currentOutline.id, outlinePlanDraft, expansionDraftRef.current);
    if (saved) lastSyncedOutlineRef.current = { id: studio.currentOutline.id, plan: outlinePlanDraft };
    setOutlineSaving(false);
    return saved;
  }, [outlinePlanDraft, outlinePlanDirty, studio]);

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
      await readServerJson(response, "任务状态更新失败");
      await studio.refreshFromServer();
    } catch (error) { setNotice(error instanceof Error ? error.message : "任务状态更新失败"); }
  }

  const submit = useCallback(async () => {
    if (generationMode !== "fresh" && !hasCurrentContent) { setNotice("当前正文为空，无法改写或续写。"); return; }
    if (!targetWordsValid) { setNotice(`目标字数请输入 ${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数，或留空表示不限字数。`); return; }
    if (reviewMaxRounds > 0 && reviewStrategy === "minimal" && !hasReviewRules(taskReviewSnapshot(studio.currentArticle, taskParameters, normalizeReviewRules(reviewInstruction), studio.data.settings)) && !hasActiveProseControls(proseControls) && !advancedText(advanced, GENERATE_FIELDS)) { setNotice("请添加本文章生效的审校规则或补充指令，也可将修正次数设为 0。"); return; }
    const effectiveFirstAppearanceIds = includeCharacters ? firstAppearanceCharacterIds : [];
    const appearanceSnapshot = JSON.stringify([...effectiveFirstAppearanceIds].sort());
    const excellentSnapshot = JSON.stringify([...excellentFragmentIds].sort());
    const duplicate = studio.data.tasks.find((task) => task.outlineId === studio.currentOutline.id && task.target === "正文" && (task.contextOptions?.configuredModelId ?? "") === selectedModelReference && task.contextOptions?.resolvedReasoningEffort === resolveReasoningEffort(selectedRecord, reasoningEffort) && task.prompt === prompt.trim() && normalizeReviewRounds(task.contextOptions?.reviewMaxRounds) === reviewMaxRounds && normalizeReviewStrategy(task.contextOptions?.reviewStrategy) === reviewStrategy && (studio.data.settings.reviewModelMode !== "fixed" || task.contextOptions?.reviewConfiguredModelId === studio.data.settings.reviewModel) && (task.contextOptions?.reviewInstruction ?? "") === normalizeReviewRules(reviewInstruction) && (reviewMaxRounds === 0 || JSON.stringify(task.contextOptions?.reviewRuleSnapshot) === JSON.stringify(taskReviewSnapshot(studio.currentArticle, taskParameters, normalizeReviewRules(reviewInstruction), studio.data.settings))) && JSON.stringify(task.contextOptions?.advanced ?? {}) === JSON.stringify(advanced) && JSON.stringify(resolvedProseControls(task.contextOptions)) === JSON.stringify(proseControls) && task.contextOptions?.targetWords === targetWords && JSON.stringify(task.contextOptions?.promptContext?.currentOutline.expansion) === JSON.stringify(expansionSnapshot) && task.contextOptions?.outlinePlanSnapshot === outlinePlanDraft && (task.contextOptions?.contentMode ?? "fresh") === generationMode && (generationMode !== "rewrite" || normalizeRewriteRetentionLevel(task.contextOptions?.rewriteRetention) === rewriteRetention) && JSON.stringify([...(task.contextOptions?.firstAppearanceCharacterIds ?? [])].sort()) === appearanceSnapshot && (task.contextOptions?.includeExcellentFragments === true) === includeExcellentFragments && (task.contextOptions?.includeOutlineTitle === true) === includeOutlineTitle && normalizeClosingSummaryLength(task.contextOptions?.closingSummaryLength, task.contextOptions?.includeClosingSummary) === closingSummaryLength && JSON.stringify([...(task.contextOptions?.excellentFragmentIds ?? [])].sort()) === excellentSnapshot && Date.now() - new Date(task.createdAt).getTime() < 3000);
    if (duplicate) { setNotice("相同生成请求已在队列中。"); return; }
    try {
      const promptContext = selectAiContext({ articles: [studio.currentArticle], settings: studio.data.settings }, studio.currentOutline.id, "content", {
        expansion: expansionDraft,
        includePrevious,
        includeCharacters,
        includeExcellentFragments,
        excellentFragmentIds,
        contentMode: generationMode,
        instruction: prompt,
        currentPlan: outlinePlanDraft,
        firstAppearanceCharacterIds: effectiveFirstAppearanceIds,
      });
      promptContext.article.outlineNaming = taskNamingProfile(taskParameters, "outlineNaming");
      await createServerTask(studio, {
        taskParameters,
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
        includeClosingSummary: closingSummaryLength !== "none",
        closingSummaryLength,
        excellentFragmentIds,
        estimatedCharacters: summary.total,
        targetWords,
        contentMode: generationMode,
        rewriteRetention: generationMode === "rewrite" ? rewriteRetention : undefined,
        advanced,
        proseControls,
        dialogueDensity: proseControls.dialogueDensity,
        reviewRuleSnapshot: taskReviewSnapshot(studio.currentArticle, taskParameters, normalizeReviewRules(reviewInstruction), studio.data.settings),
        reviewMaxRounds,
        reviewInstruction: normalizeReviewRules(reviewInstruction),
        firstAppearanceCharacterIds: effectiveFirstAppearanceIds,
        timeoutMs: selectedRecord?.timeoutMs ?? 600_000,
        promptContext,
        currentPlan: outlinePlanDraft,
        currentExpansion: expansionDraft,
        outlineTitleSnapshot: studio.currentOutline.title,
        generateOptions: settingsScope === "task" ? undefined : studio.currentOutline.generateOptions === null ? null : generateOptions,
      });
      lastSyncedOutlineRef.current = { id: studio.currentOutline.id, plan: outlinePlanDraft };
      lastSyncedExpansionRef.current = expansionDraft;
      setPrompt(normalizedPrompt);
      setSavedPrompt(normalizedPrompt);
      setPromptSaveFailed(false);
      setNotice("");
      onTaskCreated();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "AI 任务创建失败");
    }
  }, [prompt, normalizedPrompt, studio, reasoningEffort, selectedModelReference, selectedRecord, includePrevious, includeCharacters, includeExcellentFragments, includeOutlineTitle, closingSummaryLength, excellentFragmentIds, firstAppearanceCharacterIds, summary.total, targetWords, targetWordsValid, generationMode, rewriteRetention, proseControls, reviewMaxRounds, reviewInstruction, reviewStrategy, hasCurrentContent, outlinePlanDraft, expansionDraft, expansionSnapshot, generateOptions, advanced, settingsScope, taskParameters, onTaskCreated]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const owner = generateViewRef.current?.closest(".workspace-pane");
      if (generateViewRef.current?.offsetParent !== null && (!owner || owner.getAttribute("data-active") === "true") && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "Enter") { event.preventDefault(); void submit(); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [submit]);

  return (
    <div className="generate-view" ref={generateViewRef}>
      <div className="generate-page">
        <section className="generate-command-card">
          <section className="generate-input-section" aria-labelledby={`${viewId}-input-heading`}>
            <div className="generate-section-heading"><h3 id={`${viewId}-input-heading`}>本次写作</h3><span>当前大纲 · {displayTitle}</span></div>
          <section className="generate-outline-editor">
            <div className="generate-outline-editor-heading">
              <label htmlFor="generate-outline-plan">大纲内容</label>
              <span>{outlinePlanDraft.length.toLocaleString("zh-CN")} / 10,000</span>
            </div>
            <OutlineExpansionEditor plan={outlinePlanDraft} value={expansionDraft} globalMultiplier={studio.data.settings.outlineExpansionMultiplier} globalTargetWords={studio.data.settings.outlineExpansionWords} legacyTargetWords={generateOptions.targetWords} onChange={changeExpansion} onModeChange={changeLengthMode}><Textarea
              ref={registerOutlinePlan}
              id="generate-outline-plan"
              aria-label="生成使用的大纲内容"
              className="generate-outline-plan-control"
              classNames={{ input: "generate-outline-plan-input" }}
              maxLength={10000}
              rows={6}
              value={outlinePlanDraft}
              onChange={(event) => { const nextPlan = event.target.value; changeExpansion(rebaseOutlineExpansion(outlinePlanDraftRef.current, nextPlan, expansionDraftRef.current), nextPlan); outlinePlanDraftRef.current = nextPlan; setOutlinePlanDraft(nextPlan); }}
            /></OutlineExpansionEditor>
            {(outlinePlanDirty || outlineSaving) && <div className="generate-outline-save-row">
              <span className={`generate-outline-save-state ${outlinePlanDirty ? "unsaved" : "saved"}`}>{outlineSaving ? "正在保存…" : outlinePlanDirty ? "有未保存修改" : "已保存"}</span>
              <Button className="generate-outline-save-button" variant={outlinePlanDirty ? "light" : "subtle"} size="compact-sm" type="button" leftSection={<Icon name="check" />} disabled={!outlinePlanDirty || outlineSaving} loading={outlineSaving} onClick={() => void saveOutlineDraft()}>保存大纲</Button>
            </div>}
            <div className="generate-outline-resize-divider" hidden={expansionDraft?.enabled}>
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
          <div className="generate-prompt-label">
            <span>补充指令（可选） <small>{prompt.length.toLocaleString("zh-CN")} / 20,000</small></span>
            <Textarea ref={registerInstruction} maxLength={20000} rows={4} value={prompt} onChange={(event) => { setPrompt(event.target.value); setPromptSaveFailed(false); }} placeholder={generationMode === "rewrite" ? "说明改写方向和需要保留的内容" : generationMode === "continue" ? "说明接下来要发生的情节或节奏" : "补充生成要求"} />
            {(promptDirty || promptSaving || promptSaveFailed) && <div className="generate-instruction-save-row">
              <span className={`generate-instruction-save-state ${promptSaveFailed ? "failed" : promptDirty ? "unsaved" : "saved"}`}>{promptSaving ? "正在保存…" : promptSaveFailed ? "保存失败，请重试" : promptDirty ? "有未保存修改" : "已保存"}</span>
              <Button className="generate-instruction-save-button" variant={promptDirty ? "light" : "subtle"} size="compact-sm" type="button" leftSection={<Icon name="check" />} disabled={!promptDirty || promptSaving} loading={promptSaving} onClick={() => void saveGenerateInstruction()}>保存指令</Button>
            </div>}
          </div>
          <div className="generate-preset-toolbar"><Menu withinPortal position="bottom-end"><Menu.Target><Button variant="subtle" size="compact-sm" disabled={!studio.data.settings.generatePresets.length}>常用指令 ⌄</Button></Menu.Target><Menu.Dropdown>{studio.data.settings.generatePresets.map(item=><Menu.Item key={item} onClick={()=>setPrompt(item)}>{item}</Menu.Item>)}</Menu.Dropdown></Menu><Button className="manage-generate-presets" variant="subtle" size="compact-sm" onClick={() => setPresetManagerOpen(true)}>管理预设</Button></div>
          </section>
          <section className="generate-settings-scope" aria-label="生成设置范围">
            <Select label="参数调整范围" aria-label="参数调整范围" value={settingsScope} allowDeselect={false} data={independent ? [{ value: "task", label: "仅本窗口" }] : [{ value: "outline", label: "当前大纲（自动保存）" }, { value: "task", label: "仅本次生成" }]} onChange={value => { if (value !== "outline" && value !== "task") return; if (value === "outline") studio.updateOutline(studio.currentOutline.id, { generateOptions: generateOptionsRef.current }); setSettingsScope(value); }} />
            <div className="generate-scope-description">{studio.currentOutline.generateOptions ? <span className="generate-settings-source">正在使用此大纲最近的生成设置</span> : <span>当前来源 · {resolvedGenerateSettings.baselineLabel}</span>}</div>
          </section>
          <section className="generate-configuration-section" aria-label="生成方式与篇幅"><div className="generate-basics-grid" data-expansion-mode={expansionDraft?.enabled || undefined}>
          <section className="generate-mode-section" aria-labelledby={`${viewId}-mode-heading`}>
            <div className="generate-mode-heading"><span id={`${viewId}-mode-heading`}>生成方式</span></div>
            <div className="generate-mode-options" role="radiogroup" aria-label="正文生成方式">
              {contentGenerationModes.map((item) => {
                const disabled = item.value !== "fresh" && !hasCurrentContent;
                return <label className={generationMode === item.value ? "selected" : ""} key={item.value}><input type="radio" name={viewId+"-content-mode"} aria-label={item.label+"："+item.mobileDescription} checked={generationMode===item.value} disabled={disabled} onChange={()=>rememberGenerateOptions({contentMode:item.value})} /><span className="ui-title">{item.label}</span></label>;
              })}
            </div>
            {generationMode === "rewrite" && <p className="generate-mode-hint">原正文：{resolvedOutlineContentName(studio.currentOutline)}</p>}
            {!hasCurrentContent && <p className="generate-mode-hint">当前正文为空，只能使用全新生成。</p>}
          </section>
          {generationMode === "rewrite" && <section className="rewrite-retention-control" aria-label="改写保留度设置">
            <ProseControlRow id={viewId+"-retention"} label="原文保留度" value={rewriteRetention} options={rewriteRetentionOptions} onChange={rewriteRetention => rememberGenerateOptions({ rewriteRetention })} />
            {targetWords !== undefined && Math.abs(targetWords - resolvedOutlineContent(studio.currentOutline).length) > Math.max(500, resolvedOutlineContent(studio.currentOutline).length * .35) && <small className="rewrite-retention-warning">目标字数与原文长度差异较大，实际保留度可能降低。</small>}
          </section>}
            {!expansionDraft?.enabled && <NumberInput rightSectionWidth={34} rightSection={<NumberPresetMenu label="目标字数预设" values={[{value:0,label:"不限字数"},{value:1000,label:"1,000 字"},{value:2000,label:"2,000 字"},{value:3000,label:"3,000 字"},{value:5000,label:"5,000 字"}]} onChange={value=>{setTargetWordsInput(value?String(value):"");rememberGenerateOptions({targetWords:value});}} />} className="generate-word-count" label={generationMode === "continue" ? "新增目标字数" : "目标字数"} error={targetWordsValid ? undefined : `${MIN_GENERATE_TARGET_WORDS}–${MAX_GENERATE_TARGET_WORDS} 的整数`} aria-label={generationMode === "continue" ? "续写新增目标字数" : "正文目标字数"} min={0} max={MAX_GENERATE_TARGET_WORDS} step={100} thousandSeparator="," suffix=" 字" placeholder="不限" hideControls={compact} value={targetWordsInput} onChange={(value) => { const next = String(value); setTargetWordsInput(next); const parsed = Number(next); if (next.trim() === "" || parsed === 0) rememberGenerateOptions({ targetWords: 0 }); else if (Number.isInteger(parsed) && parsed >= MIN_GENERATE_TARGET_WORDS && parsed <= MAX_GENERATE_TARGET_WORDS) rememberGenerateOptions({ targetWords: parsed }); }} onBlur={() => { const parsed = Number(targetWordsInput); if (targetWordsInput.trim() === "" || parsed === 0) { setTargetWordsInput(""); rememberGenerateOptions({ targetWords: 0 }); } else if (!Number.isInteger(parsed) || parsed < MIN_GENERATE_TARGET_WORDS || parsed > MAX_GENERATE_TARGET_WORDS) setTargetWordsInput(generateOptionsRef.current.targetWords > 0 ? String(generateOptionsRef.current.targetWords) : ""); }} />}
          </div></section>
          <details className="prose-controls-section generate-settings-panel"><summary><span>表达偏好</span><small>{proseControlsSummary({proseControls})}</small></summary><div className="generate-settings-panel-body"><div className="prose-controls-grid">
              <ProseControlRow id={`${viewId}-dialogue-density`} label="对话密度" value={proseControls.dialogueDensity} options={DIALOGUE_DENSITY_OPTIONS} onChange={(dialogueDensity) => rememberGenerateOptions({ proseControls: { ...proseControls, dialogueDensity } })} className="dialogue-density-control" />
              <ProseControlRow id={`${viewId}-introspection-density`} label="内心活动" value={proseControls.introspectionDensity} options={INTROSPECTION_DENSITY_OPTIONS} onChange={(introspectionDensity) => rememberGenerateOptions({ proseControls: { ...proseControls, introspectionDensity } })} />
              <ProseControlRow id={`${viewId}-description-detail`} label="描写细度" value={proseControls.descriptionDetail} options={DESCRIPTION_DETAIL_OPTIONS} onChange={(descriptionDetail) => rememberGenerateOptions({ proseControls: { ...proseControls, descriptionDetail } })} />
              <ProseControlRow id={`${viewId}-narrative-pace`} label="叙事节奏" value={proseControls.narrativePace} options={NARRATIVE_PACE_OPTIONS} onChange={(narrativePace) => rememberGenerateOptions({ proseControls: { ...proseControls, narrativePace } })} />
              <ProseControlRow id={`${viewId}-paragraph-length`} label="段落长度" value={proseControls.paragraphLength} options={PARAGRAPH_LENGTH_OPTIONS} onChange={(paragraphLength) => rememberGenerateOptions({ proseControls: { ...proseControls, paragraphLength } })} />
              <ProseControlRow id={`${viewId}-closing-summary`} label="收尾总结" value={closingSummaryLength} options={CLOSING_SUMMARY_OPTIONS} onChange={(closingSummaryLength) => rememberGenerateOptions({ closingSummaryLength })} className="closing-summary-control" />
            </div>{!selectedModelReference && (hasActiveProseControls(proseControls) || closingSummaryLength !== "none") && <small>本地演示引擎不执行正文表达控制，使用配置的模型后生效。</small>}          <GenerateAdvancedFields value={advanced} inherited={inheritedExpression.advanced} onChange={advanced => rememberGenerateOptions({ advanced })} onRestore={key => applyInheritedGenerateOptions(inheritAiSettings(generateOptions, "global", resolvedGenerateSettings.globalDefaults, [generateExpressionKey(generateOptions, `advanced.${key}`)]))} onPrevious={key => applyInheritedGenerateOptions(inheritAiSettings(generateOptions, "previous", resolvedGenerateSettings.previous, [generateExpressionKey(generateOptions, `advanced.${key}`)]))} /></div></details>
          <details className="generate-reference-section generate-settings-panel"><summary><span>参考资料</span><small>{summary.previousCount} 条大纲 · {summary.characterCount} 位人物</small></summary><div className="generate-settings-panel-body"><div className="generate-reference-bar" aria-label="生成参考设置">
            <button className="generate-context-summary" type="button" onClick={() => setContextOpen(true)}><Icon name="book" /><span className="generate-context-copy"><span className="ui-title">上下文 {summary.total.toLocaleString("zh-CN")} 字符</span><small>{summary.previousCount} 条前序大纲 · {summary.characterCount} 位人物</small></span><Icon name="chevron" /></button>
            <Button className="generate-first-appearance-edit" variant="default" size="sm" type="button" onClick={() => setAppearanceEditorOpen(true)}>人物出场{firstAppearanceCharacters.length ? ` · ${firstAppearanceCharacters.length}` : ""}</Button>
          </div><div className="generate-reference-choices"><Checkbox label="包含前面大纲" checked={includePrevious} onChange={event => rememberGenerateOptions({ includePrevious: event.currentTarget.checked })} /><Checkbox label="包含相关人物" checked={includeCharacters} onChange={event => rememberGenerateOptions({ includeCharacters: event.currentTarget.checked })} />
              <label className="generate-excellent-fragments-toggle">
                <input aria-label="参考优秀片段" type="checkbox" checked={includeExcellentFragments} disabled={availableExcellentFragmentCount === 0} onChange={(event) => rememberGenerateOptions({ includeExcellentFragments: event.currentTarget.checked })} />
                <span><span className="ui-label">参考优秀片段</span><small>{availableExcellentFragmentCount > 0 ? `${availableExcellentFragmentCount} 个可用` : "暂无优秀片段"}</small></span>
              </label>
            </div><section className="generate-article-settings" aria-labelledby={`${viewId}-generate-article-settings-heading`}>
            <div className="generate-section-heading"><span id={`${viewId}-generate-article-settings-heading`}>文章资料继承</span></div>
            <ScopedSettingsInline level="outline" targetId={studio.currentOutline.id} includeTaskSettings={false} />
          </section></div></details>
          <details className="generate-workflow-section generate-settings-panel"><summary><span>写作流程</span><small>{preparationEnabled?"准备开启":"准备关闭"} · {reviewMaxRounds?"审校 "+reviewMaxRounds+" 轮":"审校关闭"}</small></summary><div className="generate-settings-panel-body"><div className="generate-workflow-summary"><span>{preparationEnabled ? `写作准备 · 最多互动 ${Number(taskParameters.preparationMaxRounds)} 轮` : "写作准备已关闭 · 直接写作"}</span><span>{reviewMaxRounds ? "审校 · 最多修正 " + reviewMaxRounds + " 次" : "自动审校关闭"}</span></div><label className="generate-outline-title-toggle">
                <input aria-label="同时生成大纲名" type="checkbox" checked={includeOutlineTitle} onChange={(event) => rememberGenerateOptions({ includeOutlineTitle: event.currentTarget.checked })} />
                <span><span className="ui-label">同时生成大纲名</span></span>
              </label><TaskParameterSettings expanded level="outline" targetId={studio.currentOutline.id} models={models} groups={["写作准备", "自动审校", "命名"]} title="调整准备、审校与命名" value={generateOptions} onChange={applyInheritedGenerateOptions} /></div></details>
          <section className="generate-inheritance-section" aria-label="参数来源与继承"><AiSettingsInheritance taskGroups={["写作准备", "自动审校", "命名"]} kind="generate" targetId={studio.currentOutline.id} value={generateOptions} onChange={applyInheritedGenerateOptions} /></section>
          <details className="generate-execution-section generate-settings-panel"><summary><span>推理设置</span><small>{reasoningEffort??"沿用模型"}</small></summary><div className="generate-settings-panel-body"><div className="generate-reasoning-options"><ReasoningSettings value={reasoningEffort} modelValue={selectedRecord?.reasoningEffort} onChange={(value) => rememberGenerateOptions({ reasoningEffort: value })} /></div></div></details>
          <div className="generate-submit-zone">
            <div className="generate-submit-row">
              <div className="generate-model-control"><Select aria-label="本次模型" filter={configuredModelFilter(models)} data={modelOptions} searchable nothingFoundMessage="没有匹配的模型" value={selectedModelReference} allowDeselect={false} onChange={(value) => selectGenerateModel(value ?? "")} />{selectedModelReference && !selectedRecord?.hasSecret && <small>需要载入密钥</small>}</div>
              <Button className="generate-submit-button" leftSection={<Icon name="spark" />} size="md" type="button" disabled={!targetWordsValid || generationMode !== "fresh" && !hasCurrentContent} onClick={() => void submit()}>开始生成</Button>
            </div>
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
          {activeTasks.map((task, index) => <article className="generation-card running-card" key={task.id}><div className="generation-state"><span className={`state-dot ${isTaskAwaitingAuthor(task) ? "awaiting-author" : task.state}`} />{isTaskAwaitingAuthor(task) ? taskPhaseLabels[task.phase!] : task.state === "waiting" ? `等待中 · 队列第 ${index + 1} 位` : taskPhaseLabels[task.phase ?? "generating"]}</div><span className="ui-title">{task.prompt || "按大纲生成"}</span><p>{contentGenerationModeLabel(task.contextOptions?.contentMode)}{task.contextOptions?.contentMode === "rewrite" ? ` · 原文保留 ${rewriteRetentionLabel(task.contextOptions.rewriteRetention)}` : ""} · {modelDisplayLabel(models, task.model || "", task.contextOptions?.modelName)} · {proseControlsSummary(task.contextOptions)} · 目标 {generateLengthLabel(task.contextOptions)} · 上下文约 {task.contextOptions?.estimatedCharacters?.toLocaleString("zh-CN") ?? "—"} 字符{task.contextOptions?.includeOutlineTitle ? " · 同时生成大纲名" : ""}</p><TaskHistory task={task} collapsible /><div className="generation-progress"><span /></div><button type="button" onClick={() => { void changeGenerateTaskState(task, "cancel"); }}>取消任务</button></article>)}
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

export function FirstAppearanceDialog({ characters, suggestions, selectedIds, overrides, onChange, onReset, onClose }: {
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

export function GeneratePresetDialog({ presets, onClose, onSave }: { presets: string[]; onClose: () => void; onSave: (presets: string[]) => void }) {
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

export function ContextCard({ summary, contentMode, includePrevious, includeCharacters, includeExcellentFragments, onPrevious, onCharacters, onExcellentFragments }: { summary: GenerateContextSummary; contentMode: ContentGenerationMode; includePrevious: boolean; includeCharacters: boolean; includeExcellentFragments: boolean; onPrevious: (value: boolean) => void; onCharacters: (value: boolean) => void; onExcellentFragments: (value: boolean) => void }) {
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
