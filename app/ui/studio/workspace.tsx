"use client";

import { resolveAiSettings } from "@/lib/ai-settings-inheritance";

import { OutlineTaskIndicator } from "@/app/ui/task-interaction";

import { IllustrationGenerator } from "@/app/ui/illustration-generator";

import { useEffect, useState } from "react";
import { Alert, Menu } from "@mantine/core";

import { resolvedOutlineContentName, timestampContentName } from "@/lib/content-name.mjs";

import { resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";
import { normalizeNameVersionState } from "@/lib/name-versions";

import { chatSessionHasUnread, useStudio, type Version } from "@/app/studio-state";

import { OutlineSettingsDrawer } from "@/app/ui/story-settings-editor";
import { countOutlineSettingChanges } from "@/lib/story-settings";

import { IconButton, useConfiguredModels, useDismissOnOutside, Icon } from "@/app/ui/studio/shared";

import { type View } from "@/app/ui/studio/types";

import { saveStatusLabel } from "@/app/ui/studio/navigation";

import { WritingView } from "@/app/ui/studio/writing";

import { ChatView } from "@/app/ui/studio/chat";

import { GenerateView } from "@/app/ui/studio/generation";

function MobileOutlineTitleMenu({ outlineId, title }: { outlineId: string; title: string }) {
  const studio = useStudio();
  const [opened, setOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const chapter = studio.currentArticle.chapters.find(chapter => chapter.outlines.some(outline => outline.id === outlineId));
  const outline = chapter?.outlines.find(outline => outline.id === outlineId);
  if (!outline) return <span className="ui-title">{title}</span>;
  const state = normalizeNameVersionState(outline.id, outline.title, outline.nameVersions, outline.defaultNameVersionId, outline.updatedAt, 80);

  async function selectTitle(versionId: string) {
    if (saving) return;
    const selected = state.nameVersions.find(version => version.id === versionId);
    if (!selected) return;
    if (chapter?.outlines.some(item => item.id !== outlineId && normalizeOutlineTitle(item.title) === selected.title)) {
      setError(`同一章节内已经使用大纲名「${selected.title}」`);
      return;
    }
    if (versionId === state.defaultNameVersionId) { setOpened(false); return; }
    setSaving(true);
    setError("");
    try {
      studio.setDefaultNameVersion("outline", outlineId, versionId);
      if (await studio.saveNow()) setOpened(false);
      else setError("名称已更新，但保存尚未完成");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "名称保存失败"); }
    finally { setSaving(false); }
  }

  return <Menu opened={opened} onChange={value => { setOpened(value); if (value) setError(""); }} position="bottom" offset={16} shadow="md" width="min(360px, calc(100vw - 24px))" withinPortal>
    <Menu.Target>
      <button className="mobile-outline-title-toggle" type="button" aria-label="大纲标题，选择候选标题" aria-busy={saving} title={`${title} · 选择候选标题`}><span className="ui-title">{title}</span><Icon name="chevron" /></button>
    </Menu.Target>
    <Menu.Dropdown className="mobile-outline-title-dropdown">
      <Menu.Label>候选标题</Menu.Label>
      {state.nameVersions.map(version => <Menu.RadioItem key={version.id} value={version.id} checked={version.id === state.defaultNameVersionId} disabled={saving} closeMenuOnClick={false} onClick={() => void selectTitle(version.id)}>
        <span className="mobile-outline-title-option"><span>{version.title}</span><small>{version.source === "ai" ? "AI 候选" : "手动名称"}{version.id === state.defaultNameVersionId ? " · 当前" : ""}</small></span>
      </Menu.RadioItem>)}
      {!state.nameVersions.length && <Menu.Item disabled>尚无候选标题</Menu.Item>}
      {error && <Alert color="red" className="mobile-outline-title-error">{error}</Alert>}
    </Menu.Dropdown>
  </Menu>;
}

export function MobileHeader({ title, status, onBack, onVersions, showVersions, outlineId }: { title: string; status: string; onBack: () => void; onVersions: () => void; showVersions: boolean; outlineId?: string }) {
  return (
    <div className="mobile-header">
      <IconButton name="back" label="返回大纲" variant="glass" size="large" className="mobile-back-button" onClick={onBack} />
      <div><div className="mobile-header-title-line">{outlineId ? <MobileOutlineTitleMenu key={outlineId} outlineId={outlineId} title={title} /> : <span className="ui-title">{title}</span>}{outlineId && <OutlineTaskIndicator outlineId={outlineId} />}</div><span>{status}</span></div>
      {showVersions ? <IconButton name="versions" label="选择正文版本" variant="glass" size="large" onClick={onVersions} /> : <span className="mobile-header-placeholder" />}
    </div>
  );
}

export function OutlineWorkspace({
  mode,
  illustrationHistoryTab,
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
  mode: "write" | "chat" | "generate" | "illustrations";
  illustrationHistoryTab: string;
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
  const [illustrationSource, setIllustrationSource] = useState<{ content: string; excerpt: string; currentContent: string; currentVersionId: string | null | undefined } | null>(null);
  const [illustrationOpened, setIllustrationOpened] = useState(mode === "illustrations");
  useEffect(() => {
    if (mode !== "illustrations") return;
    const frame = requestAnimationFrame(() => setIllustrationOpened(true));
    return () => cancelAnimationFrame(frame);
  }, [mode]);
  function openIllustration(content: string, excerpt: string) {
    setIllustrationSource({ content, excerpt, currentContent: resolvedOutlineContent(studio.currentOutline), currentVersionId: studio.currentOutline.currentVersionId });
    onMode("illustrations");
  }
  const activeIllustrationSource = illustrationSource?.currentContent === resolvedOutlineContent(studio.currentOutline)
    && illustrationSource.currentVersionId === studio.currentOutline.currentVersionId ? illustrationSource : null;
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
          <button className={mode === "chat" ? "active" : ""} role="tab" aria-label="聊天" aria-selected={mode === "chat"} type="button" onClick={() => onMode("chat")}><span>聊天</span>{chatResultReady && <i className="chat-result-ready" title="聊天已生成新回复" aria-label="有新生成的聊天回复" />}</button>
          <button className={mode === "generate" ? "active" : ""} role="tab" aria-selected={mode === "generate"} type="button" onClick={() => onMode("generate")}>生成</button>
          <button className={mode === "illustrations" ? "active" : ""} role="tab" aria-selected={mode === "illustrations"} type="button" onClick={() => onMode("illustrations")}>插图</button>
        </div>
      )}

      {mode === "write" && <WritingView focusMode={focusMode} previewVersion={previewVersion} onOpenRewriteSource={onOpenRewriteSource} onClearPreview={onClearPreview} onNotice={onNotice} onEditingChange={onWritingEditingChange} onIllustration={openIllustration} />}
      {mode === "chat" && <ChatView models={models} outlineTitle={displayTitle} onNotice={onNotice} onUseAsGenerate={(text) => { setGenerateSeed(text); void onMode("generate"); }} />}
      {mode === "generate" && <GenerateView key={studio.currentOutline.id} models={models} outline={outline} initialPrompt={generateSeed} onTaskCreated={onTaskCreated} onOpenTasks={onOpenTasks} />}
      {(mode === "illustrations" || illustrationOpened) && <div className="illustration-mode-panel" hidden={mode !== "illustrations"}>
        <IllustrationGenerator outlineId={studio.currentOutline.id} content={activeIllustrationSource?.content ?? outline.content} selectedExcerpt={activeIllustrationSource?.excerpt ?? ""} initialTab={illustrationHistoryTab} defaultModel={String(resolveAiSettings(studio.currentArticle, studio.currentOutline.id, "generate", "outline", studio.data.settings).value.tasks!.illustrationPromptModel)} defaultImageModel={String(resolveAiSettings(studio.currentArticle, studio.currentOutline.id, "generate", "outline", studio.data.settings).value.tasks!.illustrationImageModel)} onClose={() => onMode("write")} />
      </div>}
      {moreOpen && <div className="workspace-more-menu"><button type="button" onClick={() => { setSettingsOpen(true); setMoreOpen(false); }}>大纲设定{countOutlineSettingChanges(studio.currentOutline.settings) ? ` · ${countOutlineSettingChanges(studio.currentOutline.settings)}` : ""}</button><button type="button" onClick={() => { studio.saveVersion(studio.currentOutline.id, timestampContentName(), "手动", resolvedOutlineContent(studio.currentOutline)); setMoreOpen(false); }}>保存正文版本</button><button type="button" onClick={() => void saveAsCurrentContent()}>另存为正文版本</button><button type="button" onClick={() => { studio.updateOutline(studio.currentOutline.id, { archived: true }); setMoreOpen(false); }}>归档大纲</button><button className="danger" type="button" onClick={() => { if (window.confirm(`删除「${displayTitle}」？`)) studio.deleteOutline(studio.currentOutline.id); setMoreOpen(false); }}>删除大纲</button></div>}
      {settingsOpen && <OutlineSettingsDrawer outlineId={studio.currentOutline.id} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
