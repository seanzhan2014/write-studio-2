"use client";

import { CharacterPhotoRuntime } from "@/app/ui/character-photos";

import { StyleLabRuntime } from "@/app/ui/style-lab";

import { isTaskAwaitingAuthor } from "@/lib/writing-preparation";
import { StudioThemeProvider } from "@/app/ui/studio-theme";

import { useEffect, useRef, useState } from "react";
import { useMantineColorScheme } from "@mantine/core";

import { resolvedOutlineContent } from "@/lib/outline-content";
import { outlineDisplayTitle } from "@/lib/outline-title";

import { browserIsOffline, fetchFromServer } from "@/lib/browser-network";
import { StudioProvider, useStudio, type AiTask } from "@/app/studio-state";
import { DataTransferProvider, useDataTransfer } from "@/app/data-transfer";

import { type View, type ContinuousDocumentPosition } from "@/app/ui/studio/types";

import { viewFromPath, routeFor, locateRewriteSource, directContentId, directContentPreview, Icon } from "@/app/ui/studio/shared";

import { PersistenceNotices, Sidebar, saveStatusLabel, MobileOutlineHome, StructureEmptyState, MobileArticleDrawer } from "@/app/ui/studio/navigation";

import { SettingsPage, ArticleInfoPage } from "@/app/ui/studio/settings";

import { NewArticleDialog } from "@/app/ui/studio/article-dialogs";

import { TaskPanel } from "@/app/ui/studio/tasks";

import { MobileHeader, OutlineWorkspace } from "@/app/ui/studio/workspace";

import { ChapterReader, ContinuousDocumentEditor } from "@/app/ui/studio/continuous";

import { SearchPage } from "@/app/ui/studio/search";

import { VersionDrawer } from "@/app/ui/studio/versions";

export default function WriterStudioApp() {
  return <StudioProvider><StudioThemeProvider><DataTransferProvider><CharacterPhotoRuntime /><StyleLabRuntime /><WriterStudioInner /></DataTransferProvider></StudioThemeProvider></StudioProvider>;
}

export function WriterStudioInner() {
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
  const [illustrationHistoryTab, setIllustrationHistoryTab] = useState("images");
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
  useEffect(() => { const complete = (event: Event) => setToast((event as CustomEvent<string>).detail); window.addEventListener("writer-studio-style-completed", complete); return () => window.removeEventListener("writer-studio-style-completed", complete); }, []);
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
    const available = Math.max(0, Math.max(currentStudio.data.settings.taskConcurrency, ...currentStudio.data.tasks.filter(task => task.executionOrigin === currentStudio.executionOrigin && task.state === "waiting").map(task => task.contextOptions?.taskConcurrency ?? 1)) - runningTasks.length);
    const occupiedBodyOutlines = new Set([...runningTasks.filter((task) => task.target === "正文"), ...currentStudio.data.tasks.filter((task) => task.target === "正文" && isTaskAwaitingAuthor(task))].map((task) => task.outlineId));
    const dispatchableTasks: AiTask[] = [];
    for (const task of currentStudio.data.tasks
      .filter((task) => task.executionOrigin === currentStudio.executionOrigin && task.target !== "AI Chat" && !isTaskAwaitingAuthor(task) && (task.state === "waiting" || leaseExpired(task)))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
      if (dispatchableTasks.length >= available) break;
      if (runningTasks.length + dispatchableTasks.length >= (task.contextOptions?.taskConcurrency ?? currentStudio.data.settings.taskConcurrency)) continue;
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
      && (view === "write" || view === "chat" || view === "generate" || view === "illustrations")
      && (next === "write" || next === "chat" || next === "generate" || next === "illustrations");
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

  async function openOutline(outlineId: string, next: "write" | "chat" | "illustrations" = "write", previewVersionId?: string) {
    if (requiresSaveBeforeNavigation && outlineId !== currentOutline && !await studio.saveNow()) return false;
    if (previewVersionId) {
      const hasVersion = () => studioRef.current.data.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines)
        .some((outline) => outline.id === outlineId && outline.versions.some((version) => version.id === previewVersionId));
      if (!hasVersion()) {
        if (!await studioRef.current.saveNow()) return false;
        await studioRef.current.refreshFromServer();
        if (!hasVersion()) {
          setToast("生成版本尚未载入，请稍后重试；可先在任务详情查看生成结果。");
          return false;
        }
      }
    }
    const targetOutline = studioRef.current.data.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((outline) => outline.id === outlineId);
    // Opening the current result should keep following the current body. Only
    // an explicitly selected historical version needs a pinned preview.
    setPreviewSelection(previewVersionId && previewVersionId !== targetOutline?.currentVersionId ? { outlineId, versionId: previewVersionId } : null);
    studioRef.current.setCurrentOutline(outlineId);
    await go(next, outlineId, true);
    return true;
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
  const isOutlineWorkspaceView = view === "write" || view === "chat" || view === "generate" || view === "illustrations";
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
          setIllustrationHistoryTab(task.target === "插图" ? "images" : "prompts");
          void openOutline(task.outlineId, "illustrations");
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
        {isOutlineWorkspaceView && (
          hasOutlines ? <OutlineWorkspace
            key={currentOutline}
            mode={view as "write" | "chat" | "generate" | "illustrations"}
            illustrationHistoryTab={illustrationHistoryTab}
            outline={selectedOutline}
            focusMode={focusMode}
            onMode={go}
            onVersions={() => setVersions(true)}
            onFocus={() => setFocusMode((value) => !value)}
            onTaskCreated={() => { setPreviewSelection(null); setToast("生成任务已加入队列"); }}
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
