"use client";
import { requestTextDialog, requestConfirmDialog } from "@/app/ui/operation-dialogs";

import { WorkspaceModeSelect, type WorkspaceMode } from "./workspace-chrome";

import { resolveAiSettings } from "@/lib/ai-settings-inheritance";

import { OutlineTaskIndicator } from "@/app/ui/task-interaction";

import { IllustrationGenerator } from "@/app/ui/illustration-generator";

import { useEffect, useState } from "react";
import { Alert, Menu } from "@mantine/core";

import { resolvedOutlineContentName, timestampContentName } from "@/lib/content-name.mjs";

import { resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";
import { normalizeNameVersionState } from "@/lib/name-versions";

import { useStudio, type Version } from "@/app/studio-state";

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

export function MobileHeader({ title, status, onBack, onVersions, showVersions, outlineId, mode, onMode, onMore, onChatHost, controls }: { title: string; status: string; onBack: () => void; onVersions: () => void; showVersions: boolean; outlineId?: string; mode?: WorkspaceMode; onMode?: (mode: WorkspaceMode) => void; onMore?: () => void; onChatHost?: (element:HTMLDivElement|null)=>void; controls?: React.ReactNode }) {
  return (
    <div className={mode || controls ? "mobile-header mobile-workspace-header" : "mobile-header"}>
      <IconButton name="back" label="返回大纲" variant="glass" size="large" className="mobile-back-button" onClick={onBack} />
      {mode === "chat" ? <div className="workspace-mobile-chat-slot" ref={onChatHost} /> : <div><div className="mobile-header-title-line">{outlineId ? <MobileOutlineTitleMenu key={outlineId} outlineId={outlineId} title={title} /> : <span className="ui-title">{title}</span>}{outlineId && <OutlineTaskIndicator outlineId={outlineId} />}</div><span>{status}</span></div>}
      {mode && onMode && <WorkspaceModeSelect value={mode} onChange={onMode} />}
      {controls}
      {onMore ? <IconButton name="more" label="更多操作" onClick={onMore} className="workspace-more-trigger" /> : showVersions ? <IconButton name="versions" label="选择正文版本" variant="glass" size="large" onClick={onVersions} /> : <span className="mobile-header-placeholder" />}
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
  onFocus: _onFocus,
  onTaskCreated,
  onOpenTasks,
  onNotice,
  previewVersion,
  onOpenRewriteSource,
  onClearPreview,
  onWritingEditingChange,
  onBack,
  onPreviewVersion,
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
  onBack?: () => void;
  onPreviewVersion?: (id:string)=>void;
}) {
  const studio = useStudio();
  const [chatHeaderHost,setChatHeaderHost]=useState<HTMLDivElement|null>(null);
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
  useDismissOnOutside(moreOpen, () => setMoreOpen(false), ".workspace-more-trigger, .workspace-more-menu");

  async function saveAsCurrentContent() {
    const defaultName = `${resolvedOutlineContentName(studio.currentOutline)}-复制`;
    const name = (await requestTextDialog("另存为正文版本", defaultName));
    if (name === null) { setMoreOpen(false); return; }
    const versionName = name.trim() || defaultName;
    studio.saveVersion(studio.currentOutline.id, versionName, "手动", resolvedOutlineContent(studio.currentOutline));
    setMoreOpen(false);
    const saved = await studio.saveNow();
    onNotice(saved ? `已另存为「${versionName}」` : "另存为未完成，请查看保存状态");
  }

  return (
    <div className="workspace">
      <MobileHeader onChatHost={setChatHeaderHost} title={displayTitle} status={saveStatusLabel(studio.saveStatus)} onBack={onBack ?? (()=>onMode("outline-home"))} onVersions={onVersions} showVersions={false} outlineId={studio.currentOutline.id} mode={mode} onMode={onMode} onMore={()=>setMoreOpen(value=>!value)} />

      {mode === "write" && <WritingView onSelectVersion={onPreviewVersion} onManageVersions={onVersions} focusMode={focusMode} previewVersion={previewVersion} onOpenRewriteSource={onOpenRewriteSource} onClearPreview={onClearPreview} onNotice={onNotice} onEditingChange={onWritingEditingChange} onIllustration={openIllustration} />}
      {mode === "chat" && <ChatView headerHost={chatHeaderHost} models={models} outlineTitle={displayTitle} onNotice={onNotice} onUseAsGenerate={(text) => { setGenerateSeed(text); void onMode("generate"); }} />}
      {mode === "generate" && <GenerateView key={studio.currentOutline.id} models={models} outline={outline} initialPrompt={generateSeed} onTaskCreated={onTaskCreated} onOpenTasks={onOpenTasks} />}
      {(mode === "illustrations" || illustrationOpened) && <div className="illustration-mode-panel" hidden={mode !== "illustrations"}>
        <IllustrationGenerator outlineId={studio.currentOutline.id} content={activeIllustrationSource?.content ?? outline.content} selectedExcerpt={activeIllustrationSource?.excerpt ?? ""} initialTab={illustrationHistoryTab} defaultModel={String(resolveAiSettings(studio.currentArticle, studio.currentOutline.id, "generate", "outline", studio.data.settings).value.tasks!.illustrationPromptModel)} defaultImageModel={String(resolveAiSettings(studio.currentArticle, studio.currentOutline.id, "generate", "outline", studio.data.settings).value.tasks!.illustrationImageModel)} onClose={() => onMode("write")} />
      </div>}
      {moreOpen && <div className="workspace-more-menu"><button type="button" onClick={()=>{onVersions();setMoreOpen(false);}}>管理正文版本</button><button type="button" onClick={() => { setSettingsOpen(true); setMoreOpen(false); }}>大纲设定{countOutlineSettingChanges(studio.currentOutline.settings) ? ` · ${countOutlineSettingChanges(studio.currentOutline.settings)}` : ""}</button><button type="button" onClick={() => { studio.saveVersion(studio.currentOutline.id, timestampContentName(), "手动", resolvedOutlineContent(studio.currentOutline)); setMoreOpen(false); }}>保存正文版本</button><button type="button" onClick={() => void saveAsCurrentContent()}>另存为正文版本</button><button type="button" onClick={() => { studio.updateOutline(studio.currentOutline.id, { archived: true }); setMoreOpen(false); }}>归档大纲</button><button className="danger" type="button" onClick={async () => { if ((await requestConfirmDialog(`删除「${displayTitle}」？`))) studio.deleteOutline(studio.currentOutline.id); setMoreOpen(false); }}>删除大纲</button></div>}
      {settingsOpen && <OutlineSettingsDrawer outlineId={studio.currentOutline.id} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
