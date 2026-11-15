"use client";

import { TaskParameterSettings } from "@/app/ui/task-parameter-settings";
import { OutlineExpansionEditor } from "@/app/ui/outline-expansion-editor";
import { normalizeOutlineExpansion, outlineExpansionForEditing, rebaseOutlineExpansion } from "@/lib/outline-expansion";
import { taskReasoningEffort, taskNamingProfile } from "@/lib/task-parameters";
import { articleAiSettings, resolveAiSettings } from "@/lib/ai-settings-inheritance";

import { STANDALONE_AI_REVIEW_ENABLED } from "@/lib/features.mjs";

import { type ReasoningEffort } from "@/lib/reasoning-options";
import { MAX_REVIEW_RULE_CHARACTERS } from "@/lib/generate-review.mjs";
import { ReviewRuleSnapshotView } from "@/app/ui/review-rules";
import { createReviewRuleSnapshot, hasReviewRules, type ReviewRuleSnapshot } from "@/lib/review-rules.mjs";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Alert, Button, Group, Menu, Select, Stack, Textarea } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { resolvedOutlineContentName, timestampContentName } from "@/lib/content-name.mjs";
import { normalizeExcellentFragments } from "@/lib/excellent-fragments.mjs";

import { currentOutlineVersion, resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";

import { normalizeNameVersionState, type NameVersion } from "@/lib/name-versions";

import { fetchServerAction } from "@/lib/browser-network";
import { formatTime, useStudio, wordCount, type Article, type Chapter, type Outline } from "@/app/studio-state";

import { ResponsiveModal, ScrollableDrawer } from "@/app/ui/overlays";
import { ArticleSettingsInline, ChapterSettingsDrawer, ScopedSettingsInline } from "@/app/ui/story-settings-editor";
import { countChapterSettingChanges, countOutlineSettingChanges, resolveChapterSettings, resolveOutlineSettings } from "@/lib/story-settings";

import { PageHeader, Icon, AutoGrowTextarea, IconButton, useConfiguredModels, canonicalModelReference, configuredModelForReference, modelDisplayLabel, updateScopedTaskParameters, namingArticleContext, createServerTask, TaskReasoningSettings, resolvedExcellentFragments, useContinuousEditorViewport, copyTextToClipboard } from "@/app/ui/studio/shared";

import { useHorizontalSwipe, CONTINUOUS_POSITION_SETTLE_MS, outlineDropPlacement, saveStatusLabel, ChapterActionSheet } from "@/app/ui/studio/navigation";

import { type NameGeneratePreview, type OutlineDropPlacement, type ContinuousOutlinePanelView, type ConfiguredModel, type ContinuousDocumentPositionMemory, type OutlineDropIndicator } from "@/app/ui/studio/types";

import { storeNameCandidates } from "@/app/ui/studio/naming";

import { FullOutlineChatDialog } from "@/app/ui/studio/chat";

export function ChapterReader({ onOutline }: { onOutline: (id: string) => void }) {
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

export function ReaderSection({ number, title, onClick, children }: { number: string; title: string; onClick: () => void; children: ReactNode }) {
  return <section className="reader-section"><header><span>{number}</span><button type="button" onClick={onClick}><h2>{title}</h2></button></header><div className="reader-content">{children}</div></section>;
}

export function NameVersionOption({ label, version, selected, revealed, deleteDisabled, onSelect, onReveal, onDelete }: {
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

export function NameVersionChooser({ kind, entityId, title, versions, defaultVersionId, onSelect, onAdd, onDelete }: {
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

export function ContinuousChapterHeading({ chapterId, index, title, settingCount, settingsOpen, namesOpen, onSettings, onNames, onMore, onTitle, onTitleCommit }: {
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

export function UnifiedNamingEditor({ target, chapter, outline, onNotice, onTaskCreated }: {
  target: "article" | "chapter" | "outline";
  chapter?: Chapter;
  outline?: Outline;
  onNotice: (message: string) => void;
  onTaskCreated: () => void;
}) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const article = studio.currentArticle;
  const scopeId = target === "outline" ? outline?.id ?? "" : chapter?.id ?? article.id;
  const scopedOptions = resolveAiSettings(article, scopeId, "generate", target === "chapter" ? "chapter" : "outline", studio.data.settings).value;
  const scopedParameters = scopedOptions.tasks!;
  const settings = { ...studio.data.settings, generateModel: scopedOptions.model, namingModelMode: scopedParameters.namingModelMode === "fixed" ? "fixed" as const : "inherit" as const, namingModel: String(scopedParameters.namingModel), namingReasoningEffort: taskReasoningEffort(scopedParameters.namingReasoningEffort) };
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
    { value: "__inherit__", label: `继承生成（${modelDisplayLabel(models, inheritedReference)}）` },
    { value: "__local__", label: "本地演示引擎" },
    ...(namingSelection !== "__inherit__" && namingSelection !== "__local__" && !configuredModelForReference(models, namingSelection) ? [{ value: namingSelection, label: namingSelection }] : []),
    ...models.map((model) => ({ value: model.id, label: `${modelDisplayLabel(models, model.id)}${model.hasSecret ? "" : "（需密钥）"}` })),
  ];

  function selectNamingModel(value: string | null) {
    if (!value || value === "__inherit__") updateScopedTaskParameters(studio, target, scopeId, { namingModelMode: "inherit" });
    else if (value === "__local__") updateScopedTaskParameters(studio, target, scopeId, { namingModelMode: "fixed", namingModel: "" });
    else updateScopedTaskParameters(studio, target, scopeId, { namingModelMode: "fixed", namingModel: value });
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
        chapterNaming: taskNamingProfile(scopedParameters, "chapterNaming"),
        outlineNaming: taskNamingProfile(scopedParameters, "outlineNaming"),
        model: selectedModelReference,
        reasoningEffort: settings.namingReasoningEffort,
        modelLabel: modelDisplayLabel(models, selectedModelReference),
        instruction: instruction.trim(),
        context: namingArticleContext(article, studio.data.settings),
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
        chapterNaming: taskNamingProfile(scopedParameters, "chapterNaming"),
        outlineNaming: taskNamingProfile(scopedParameters, "outlineNaming"),
        timeoutMs: selectedRecord?.timeoutMs ?? 600_000,
        namingContext: namingArticleContext(article, studio.data.settings),
      });
      onNotice(`已创建后台任务，将按各级设置生成 ${eligibleChapters.length} 个章节和 ${eligibleOutlineCount} 个大纲的名称`);
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
      <div className="name-generation-reasoning"><TaskReasoningSettings kind="naming" level={target} targetId={scopeId} model={selectedRecord} disabled={Boolean(activeAllTask)} /></div>
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
    <TaskParameterSettings level={target} targetId={scopeId} groups={["命名"]} models={models} />
    <div className="unified-naming-heading"><span>{target === "chapter" ? "章节名称" : "大纲名称"}</span><Button variant="light" size="xs" leftSection={<Icon name="spark" />} loading={busy} disabled={busy || Boolean(activeAllTask) || !canGenerate} onClick={() => void generateOne()}>AI 生成候选</Button></div>
    <NameVersionChooser kind={kind} entityId={item.id} title={item.title} versions={state.nameVersions} defaultVersionId={state.defaultNameVersionId} onSelect={(versionId) => void selectDefault(kind, item.id, versionId)} onAdd={(title) => void addManual(kind, item.id, title)} onDelete={(versionId) => void deleteName(kind, item.id, versionId)} />
    {error && <Alert color="red">{error}</Alert>}
  </div>;
}

export function ContinuousEmptyChapter({ chapterId }: { chapterId: string }) {
  const { isOver, setNodeRef } = useDroppable({ id: `continuous-empty:${chapterId}`, data: { type: "chapter", chapterId } });
  return <div ref={setNodeRef} className={`continuous-empty-chapter ${isOver ? "chapter-drop-active" : ""}`} aria-label="将大纲移动到此章节" />;
}

export function ContinuousOutlineBlock({ item, number, mode, text, selectedVersionId, dropPlacement, contentStyle, active, propertiesOpen, namesOpen, onActivate, onAdd, onDelete, onArchive, onProperties, onNames, onTitle, onTitleCommit, onText, onContentFocus, onContentBlur, onSelectVersion, onSetCurrentVersion, onSetDefaultVersion, onMoveUp, onMoveDown, onMoveChapter, onOpenChat }: {
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
  const studio = useStudio();
  const legacyTargetWords = mode === "outline" ? resolveAiSettings(studio.currentArticle, item.id, "generate", "outline", studio.data.settings).value.targetWords : undefined;
  const expansion = mode === "outline" ? outlineExpansionForEditing(text, item.expansion, studio.data.settings.outlineLengthMode) : undefined;
  const displayTitle = outlineDisplayTitle(item);
  const selectedVersion = item.versions.find((version) => version.id === selectedVersionId);
  const currentVersion = currentOutlineVersion(item);
  const showWorkingCurrent = !currentVersion;
  const currentContentName = resolvedOutlineContentName(item);
  const currentExcellentFragments = resolvedExcellentFragments(item);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, data: { type: "outline", outlineId: item.id } });
  const textEditor = <AutoGrowTextarea
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
  />;
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
        {onOpenChat && <button className="continuous-outline-chat" type="button" aria-label="聊天" onClick={onOpenChat}><Icon name="chat" /><span>聊天</span></button>}
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
              const message = hasBody ? `「${displayTitle}」已有正文。删除后正文、正文版本和聊天都会一并删除，且无法撤销。确认删除？` : `删除大纲「${displayTitle}」？此操作无法撤销。`;
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
              <span className="continuous-version-option"><span className="ui-title">{version.name}{normalizeExcellentFragments(version.content, version.excellentFragments).length > 0 && <i className="excellent-fragment-dot" title="含优秀片段" />}{version.id === item.currentVersionId ? <em>当前</em> : null}{version.id === item.defaultVersionId ? <em>默认</em> : null}</span><small>{formatTime(version.createdAt)} · {wordCount(version.content)} 字 · {version.source === "AI Chat" ? "聊天" : version.source === "AI Generate" ? "生成" : version.source}</small></span>
            </Menu.Item>)}
            {!item.versions.length && <Menu.Item disabled>尚无候选版本</Menu.Item>}
          </Menu.Dropdown>
        </Menu>
        {selectedVersion && selectedVersion.id !== item.currentVersionId && <button className="continuous-set-current" type="button" aria-label={`将“${selectedVersion.name}”设为当前正文`} onClick={() => onSetCurrentVersion?.(selectedVersion.id)}>设为当前</button>}
        {selectedVersion && selectedVersion.id !== item.defaultVersionId && <button className="continuous-set-default" type="button" aria-label={`将“${selectedVersion.name}”设为默认正文`} onClick={() => onSetDefaultVersion?.(selectedVersion.id)}>设为默认</button>}
      </div>
    </div>}
    {mode === "outline" ? <OutlineExpansionEditor plan={text} value={expansion} globalMultiplier={studio.data.settings.outlineExpansionMultiplier} globalTargetWords={studio.data.settings.outlineExpansionWords} legacyTargetWords={legacyTargetWords} documentView onChange={next => studio.updateOutline(item.id, { expansion: normalizeOutlineExpansion(text, next) })}>{textEditor}</OutlineExpansionEditor> : textEditor}
  </article>;
}

export function ContinuousOutlinePropertiesDrawer({ outline, chapter, chapters, view, onView, onClose, onMove, onNotice, onTaskCreated }: {
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

export function AiReviewDialog({ article, chapters, models, initialModel, onClose, onSetDefaultModel, onRun }: {
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

export function ContinuousDocumentEditor({ mode, positionMemory, onNotice, onTaskCreated }: { mode: "outline" | "content"; positionMemory: ContinuousDocumentPositionMemory; onNotice: (message: string) => void; onTaskCreated: () => void }) {
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
              onText={(value) => {
                if (mode !== "outline") return changeContent(item.id, value, versionSelections[item.id]);
                const plan = value.slice(0, 10000);
                const expansion = outlineExpansionForEditing(item.plan, item.expansion, studio.data.settings.outlineLengthMode);
                studio.updateOutline(item.id, { plan, expansion: rebaseOutlineExpansion(item.plan, plan, expansion) });
              }}
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
