"use client";

import { ReviewRuleSnapshotView } from "@/app/ui/review-rules";

import { GenerateReviewReportView } from "@/app/ui/generate-review-report";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Group, Menu } from "@mantine/core";

import { resolvedOutlineContentName, timestampContentName } from "@/lib/content-name.mjs";
import { normalizeExcellentFragments } from "@/lib/excellent-fragments.mjs";

import { currentOutlineVersion, resolvedOutlineContent } from "@/lib/outline-content";

import { useStudio, wordCount, type Version } from "@/app/studio-state";

import { ResponsiveModal, ScrollableDrawer } from "@/app/ui/overlays";
import { BodyDeleteDialog, type BodyDeleteTarget } from "@/app/ui/studio/body-delete-dialog";

import { directContentId, useDismissOnOutside, useWritingEditorViewport, selectedRangeWithin, copyTextToClipboard, Icon, IconButton, ExcellentText } from "@/app/ui/studio/shared";

export function WritingView({ focusMode, previewVersion, onOpenRewriteSource, onClearPreview, onNotice, onEditingChange, onIllustration }: { focusMode: boolean; previewVersion?: Version; onOpenRewriteSource: (sourceId: string) => void; onClearPreview: () => void; onNotice: (message: string) => void; onEditingChange: (editing: boolean) => void; onIllustration: (content: string, excerpt: string) => void }) {
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
  const [deleteTarget, setDeleteTarget] = useState<BodyDeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<{ left: number; top: number; start: number; end: number } | null>(null);
  const writingScrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const pendingContentScrollRef = useRef<{ top: number; max: number; ratio: number } | null>(null);
  const pendingEditorCaretRef = useRef<number | null>(null);
  const selectionPointerActiveRef = useRef(false);
  const selectionMenuTimerRef = useRef<number | null>(null);
  const lastReaderTouchRef = useRef<{ at: number; x: number; y: number } | null>(null);
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
  const directContentName = studio.currentOutline.contentName?.trim() || timestampContentName(studio.currentOutline.updatedAt);
  const showDirectContent = !currentVersion || Boolean(studio.currentOutline.content.trim() || studio.currentOutline.contentName?.trim());
  const content = editing ? draftContent : displayedContent;
  const displayedFragments = displayedVersion
    ? normalizeExcellentFragments(displayedVersion.content, displayedVersion.excellentFragments)
    : normalizeExcellentFragments(displayedContent, studio.currentOutline.excellentFragments);
  const displayedManuallyExcellent = displayedVersion ? displayedVersion.manualExcellent === true : studio.currentOutline.manualExcellent === true;
  const displayedAutomaticallyExcellent = displayedFragments.length > 0;
  const displayedIsExcellent = displayedManuallyExcellent || displayedAutomaticallyExcellent;
  const hasSelectedContent = Boolean(selectionMenu && selectionMenu.end > selectionMenu.start);
  const selectedFragmentIsExcellent = Boolean(hasSelectedContent && selectionMenu && displayedFragments.some((fragment) => selectionMenu.start >= fragment.start && selectionMenu.end <= fragment.end));

  useDismissOnOutside(Boolean(selectionMenu), () => setSelectionMenu(null), ".content-selection-menu");
  useDismissOnOutside(editToolsOpen, () => setEditToolsOpen(false), ".mobile-edit-more, .mobile-edit-overflow-menu");
  useWritingEditorViewport(writingScrollRef, editorRef, editing);

  useEffect(() => () => onEditingChange(false), [onEditingChange]);

  const showSelectionMenu = useCallback((point?: { x: number; y: number }) => {
    const reader = readerRef.current;
    if (!reader) return false;
    const selected = selectedRangeWithin(reader);
    const selection = window.getSelection();
    if (!selected && !point) return false;
    const bounds = selected && selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : reader.getBoundingClientRect();
    const menuWidth = 176;
    const rowHeight = window.matchMedia("(max-width: 767px)").matches ? 44 : 34;
    const menuHeight = Math.min((selected ? 6 : 4) * rowHeight + (selected ? 21 : 12), window.innerHeight - 16);
    const desiredLeft = point?.x ?? bounds.left + bounds.width / 2 - menuWidth / 2;
    const below = (point?.y ?? bounds.bottom) + 8;
    const desiredTop = below + menuHeight <= window.innerHeight ? below : (point?.y ?? bounds.top) - menuHeight - 8;
    setSelectionMenu({
      left: Math.max(8, Math.min(desiredLeft, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(desiredTop, window.innerHeight - menuHeight - 8)),
      start: selected?.start ?? 0,
      end: selected?.end ?? 0,
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

  async function selectContent(versionId?: string) {
    studio.setCurrentVersion(studio.currentOutline.id, versionId);
    onClearPreview();
    const saved = await studio.saveNow();
    if (!saved) onNotice("正文已切换，保存未完成，请查看保存状态");
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

  function requestDeleteDisplayedContent() {
    setEditToolsOpen(false);
    setDeleteTarget({
      outlineId: studio.currentOutline.id,
      versionId: displayedIsDirectContent ? null : displayedVersion?.id ?? null,
      name: displayedContentName,
      isCurrent: displayedIsCurrent,
    });
  }

  async function deleteDisplayedContent() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    if (editing) finishWithoutChanges();
    studio.deleteVersion(deleteTarget.outlineId, deleteTarget.versionId);
    onClearPreview();
    const saved = await studio.saveNow();
    setDeleting(false);
    setDeleteTarget(null);
    onNotice(saved ? "正文已删除" : "删除未完成，请查看保存状态");
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

  async function copyReaderContent(selectedOnly: boolean) {
    if (selectedOnly && !hasSelectedContent) return;
    const text = selectedOnly && selectionMenu ? displayedContent.slice(selectionMenu.start, selectionMenu.end) : displayedContent;
    if (selectionMenuTimerRef.current !== null) window.clearTimeout(selectionMenuTimerRef.current);
    selectionMenuTimerRef.current = null;
    setSelectionMenu(null);
    const copied = await copyTextToClipboard(text);
    onNotice(copied ? selectedOnly ? "已复制选中文字" : "正文已复制" : "复制失败，请检查剪贴板权限");
  }

  function selectAllReaderContent() {
    const reader = readerRef.current;
    if (!reader || !displayedContent) return;
    const range = document.createRange();
    range.selectNodeContents(reader);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    showSelectionMenu();
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
              <Menu position="bottom-start" shadow="md" width="min(400px, calc(100vw - 24px))" withinPortal>
                <Menu.Target>
                  <button className={`body-title-toggle ${displayedIsDefault ? "default" : ""}`} type="button" disabled={editing || savingEdit || settingDefault || settingExcellent} aria-label="正文标题，选择正文候选" title={editing ? "完成编辑后可切换正文" : `${displayedContentName} · 选择正文候选`}><span>{displayedContentName}</span><Icon name="chevron" /></button>
                </Menu.Target>
                <Menu.Dropdown className="body-title-dropdown">
                  <Menu.Label>正文候选</Menu.Label>
                  {showDirectContent && <Menu.RadioItem value={directContentId(studio.currentOutline.id)} checked={!displayedVersion || displayedIsDirectContent} closeMenuOnClick onClick={() => void selectContent()}>
                    <span className="body-title-option"><span className="body-title-option-name">{directContentName}</span><small>{!currentVersion ? "当前 · " : ""}已直接保存 · {wordCount(studio.currentOutline.content).toLocaleString("zh-CN")} 字</small></span>
                  </Menu.RadioItem>}
                  {studio.currentOutline.versions.map((version) => <Menu.RadioItem key={version.id} value={version.id} checked={displayedVersion?.id === version.id} closeMenuOnClick onClick={() => void selectContent(version.id)}>
                    <span className="body-title-option"><span className="body-title-option-name">{version.name}</span><small>{currentVersion?.id === version.id ? "当前 · " : ""}{studio.currentOutline.defaultVersionId === version.id ? "默认 · " : ""}{wordCount(version.content).toLocaleString("zh-CN")} 字 · {version.source === "AI Chat" ? "聊天" : version.source === "AI Generate" ? "生成" : version.source}</small></span>
                  </Menu.RadioItem>)}
                </Menu.Dropdown>
              </Menu>
              <button className={`body-status-button default-status ${displayedIsDefault ? "active" : ""}`} type="button" disabled={!displayedContent.trim() || settingDefault} aria-label={displayedIsDefault ? "取消默认正文" : "设为默认正文"} aria-pressed={displayedIsDefault} title={displayedIsDefault ? "取消默认正文" : "设为默认正文"} onClick={() => void toggleDisplayedContentDefault()}><span aria-hidden="true">P</span></button>
              <button className={`body-status-button excellent-status ${displayedIsExcellent ? "active" : ""} ${displayedAutomaticallyExcellent && !displayedManuallyExcellent ? "automatic" : ""}`} type="button" disabled={!displayedContent.trim() || settingExcellent} aria-label={displayedManuallyExcellent ? "取消手动优秀正文" : displayedAutomaticallyExcellent ? "手动保留优秀正文" : "设为优秀正文"} aria-pressed={displayedIsExcellent} title={displayedManuallyExcellent ? "取消手动优秀正文" : displayedAutomaticallyExcellent ? "含优秀片段，已自动设为优秀；点击可手动保留" : "设为优秀正文"} onClick={() => void toggleDisplayedBodyExcellent()}><span aria-hidden="true">★</span></button>
              <button className="body-status-button body-delete-button" type="button" aria-label="删除正文" title="删除正文" disabled={savingEdit || settingDefault || settingExcellent || deleting} onClick={requestDeleteDisplayedContent}><Icon name="trash" /></button>
              {editing && <span className={`mobile-edit-save-state ${draftContent === baselineRef.current ? "saved" : "unsaved"}`}>{savingEdit ? "正在保存…" : draftContent === baselineRef.current ? "未修改" : "未保存"}</span>}
            </div>
            <div className="editor-tools">{editing ? <>
              <div className="desktop-edit-tools"><IconButton name="search" label="查找正文" title="查找" size="small" onClick={() => setFindOpen((value) => !value)} /><IconButton name="copy" label="复制正文" title="复制" size="small" onClick={() => void copyEditingContent()} /><IconButton name="paste" label="粘贴正文" title="粘贴" size="small" onClick={() => void pasteEditingContent()} /><IconButton name="save" label="保存正文" title="保存" size="small" disabled={savingEdit} onClick={() => void saveEditing()} /><IconButton name="saveAs" label="另存为正文" title="另存为" size="small" onClick={() => void saveAsEditingContent()} /><button className="finish-edit-button" type="button" onClick={requestExitEditing}>退出编辑</button></div>
              <div className="mobile-edit-tools"><button className="finish-edit-button" type="button" aria-label="退出编辑" onClick={requestExitEditing}>完成</button><IconButton name="more" label="更多编辑操作" size="small" className="mobile-edit-more" aria-expanded={editToolsOpen} aria-haspopup="menu" onClick={() => setEditToolsOpen((open) => !open)} />{editToolsOpen && <div className="mobile-edit-overflow-menu" role="menu" aria-label="编辑操作"><button type="button" role="menuitem" onClick={() => { setFindOpen((value) => !value); setEditToolsOpen(false); }}><Icon name="search" />查找与替换</button><button type="button" role="menuitem" onClick={() => { setEditToolsOpen(false); void copyEditingContent(); }}><Icon name="copy" />复制全文</button><button type="button" role="menuitem" onClick={() => { setEditToolsOpen(false); void pasteEditingContent(); }}><Icon name="paste" />粘贴</button><button type="button" role="menuitem" disabled={savingEdit} onClick={() => { setEditToolsOpen(false); void saveEditing(); }}><Icon name="save" />保存并结束</button><button type="button" role="menuitem" onClick={() => { setEditToolsOpen(false); void saveAsEditingContent(); }}><Icon name="saveAs" />另存为正文</button><button className="danger-text" type="button" role="menuitem" disabled={savingEdit || settingDefault || settingExcellent || deleting} onClick={requestDeleteDisplayedContent}><Icon name="trash" />删除正文</button></div>}</div>
            </> : <span className="content-word-count">{wordCount(displayedContent).toLocaleString("zh-CN")} 字</span>}</div>
          </div>
          {!editing && displayedVersion?.rewriteSourceId && <div className="rewrite-source-row"><span>改写自</span><button type="button" onClick={() => onOpenRewriteSource(displayedVersion.rewriteSourceId!)}>{displayedVersion.rewriteSourceName || "原正文"}</button></div>}
          {findOpen && editing && <div className="find-bar"><input autoFocus value={findQuery} onChange={(event) => { setFindQuery(event.target.value); setMatchIndex(0); }} placeholder="查找…" aria-label="查找正文" /><input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="替换为…" aria-label="替换内容" /><label><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />Aa</label><span>{matches.length ? `${Math.min(matchIndex + 1, matches.length)} / ${matches.length}` : "0 / 0"}</span><button type="button" onClick={() => selectMatch(matchIndex - 1)}>上一个</button><button type="button" onClick={() => selectMatch(matchIndex + 1)}>下一个</button><button type="button" onClick={replaceCurrent}>替换</button><button type="button" onClick={replaceAll}>全部</button><IconButton name="close" label="关闭查找" onClick={() => setFindOpen(false)} /></div>}
          {editing ? <textarea ref={editorRef} className="content-editor" value={draftContent} onChange={(event) => changeDraft(event.target.value)} aria-label="正文编辑器" placeholder="从这里开始写作…" spellCheck={false} style={{ fontSize: studio.data.settings.fontSize, lineHeight: studio.data.settings.lineHeight, fontFamily: "var(--font-editor)", maxWidth: studio.data.settings.contentWidth }} /> : <><span id="content-reader-description" hidden>选中文字可欣赏；双击或按 Enter 进入编辑</span><div ref={readerRef} className="content-reader" role="region" tabIndex={0} aria-label="正文内容" aria-describedby="content-reader-description" aria-keyshortcuts="Enter" onContextMenu={openSelectionMenu} onDoubleClick={(event) => { event.preventDefault(); beginEditing(); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); beginEditing(); } }} onPointerDown={() => { selectionPointerActiveRef.current = true; }} onPointerCancel={() => { selectionPointerActiveRef.current = false; }} onPointerUp={(event) => { selectionPointerActiveRef.current = false; if (isTouchDoubleTap(event, lastReaderTouchRef)) beginEditing(); else queueSelectionMenu(); }} style={{ fontSize: studio.data.settings.fontSize, lineHeight: studio.data.settings.lineHeight, fontFamily: "var(--font-editor)", maxWidth: studio.data.settings.contentWidth }}>{content ? <ExcellentText text={content} fragments={displayedFragments} /> : "（正文为空）"}</div></>}
        </section>
      </div>
      {selectionMenu && <div className="content-selection-menu" role="menu" aria-label="正文选择菜单" onMouseDown={(event) => event.preventDefault()} style={{ left: selectionMenu.left, top: selectionMenu.top }}>
        <button type="button" role="menuitem" disabled={!hasSelectedContent} onClick={() => void copyReaderContent(true)}>复制</button>
        <button type="button" role="menuitem" disabled={!displayedContent} onClick={() => void copyReaderContent(false)}>复制全文</button>
        <button type="button" role="menuitem" disabled={!displayedContent} onClick={selectAllReaderContent}>全选</button>
        <button type="button" role="menuitem" onClick={beginEditing}>编辑正文</button>
        {hasSelectedContent && <><div className="content-menu-separator" role="separator" /><button className={selectedFragmentIsExcellent ? "active" : ""} type="button" role="menuitemcheckbox" aria-checked={selectedFragmentIsExcellent} onClick={() => applyAppreciationRange(selectionMenu)}><span>欣赏</span>{selectedFragmentIsExcellent && <Icon name="check" />}</button><button type="button" role="menuitem" onClick={() => { onIllustration(displayedContent, displayedContent.slice(selectionMenu.start, selectionMenu.end)); setSelectionMenu(null); window.getSelection()?.removeAllRanges(); }}>生成插图</button></>}
      </div>}
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
      <BodyDeleteDialog target={deleteTarget} hasUnsavedChanges={editing && draftContent !== baselineRef.current} deleting={deleting} onClose={() => { if (!deleting) setDeleteTarget(null); }} onConfirm={() => void deleteDisplayedContent()} />
      <ResponsiveModal opened={exitPromptOpen} onClose={() => setExitPromptOpen(false)} closeButtonProps={{ "aria-label": "继续编辑正文" }} title="保存正文修改？" size="sm">
        <Group justify="flex-end" gap="sm"><Button variant="default" type="button" onClick={() => setExitPromptOpen(false)}>继续编辑</Button><Button variant="default" color="red" type="button" onClick={discardEditing}>放弃修改</Button><Button type="button" loading={savingEdit} onClick={() => void saveEditing()}>保存修改</Button></Group>
      </ResponsiveModal>
    </div>
  );
}

export const generateTextareaHeightStorageKey = "writer-studio:generate-textarea-heights:v1";

export const maxRememberedGenerateTextareas = 500;
