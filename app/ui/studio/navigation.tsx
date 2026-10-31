"use client";

import { useActiveStyleCount } from "@/app/ui/style-lab";

import { OutlineTaskIndicator } from "@/app/ui/task-interaction";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Group, Stack, Textarea, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";

import { useStudio, wordCount, type Chapter, type Outline } from "@/app/studio-state";
import { useDataTransfer } from "@/app/data-transfer";
import { MobileActionSheet, ResponsiveModal, ScrollableDrawer, type ActionSheetItem } from "@/app/ui/overlays";
import { ChapterSettingsDrawer, OutlineSettingsDrawer } from "@/app/ui/story-settings-editor";
import { countChapterSettingChanges, countOutlineSettingChanges } from "@/lib/story-settings";

import { Icon, copyTextToClipboard, useDismissOnOutside, IconButton, VirtualList, useConfiguredModels, chapterIsEmpty } from "@/app/ui/studio/shared";

import { type OutlineDropPlacement, type View, type OutlineDropIndicator, type IconName } from "@/app/ui/studio/types";

import { StructureGenerateSheet, generateWholeChapterNameCandidates } from "@/app/ui/studio/naming";

export function saveStatusLabel(status: ReturnType<typeof useStudio>["saveStatus"]) {
  return status === "saving" ? "正在保存…" : status === "unsaved" ? "未保存" : status === "local" ? "已保存到本机" : status === "failed" ? "保存失败" : status === "conflict" ? "保存冲突" : "已保存";
}

export function StructureEmptyState({ articleTitle, onCreate }: { articleTitle: string; onCreate: () => void }) {
  return <div className="structure-empty-state"><span>{articleTitle}</span><h1>开始规划这篇文章</h1><button className="primary-compact" type="button" onClick={onCreate}><Icon name="plus" />新建大纲</button></div>;
}

export function PersistenceNotices() {
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

export const CONTINUOUS_POSITION_SETTLE_MS = 1200;

export function outlineDropPlacement(event: DragEndEvent | DragOverEvent, orderedIds: string[]): OutlineDropPlacement {
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

export function DesktopChapterDropRow({ chapterId, className, children }: { chapterId: string; className: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: `desktop-chapter:${chapterId}`, data: { type: "chapter", chapterId } });
  return <div ref={setNodeRef} className={`${className} ${isOver ? "chapter-drop-active" : ""}`}>{children}</div>;
}

export function MobileChapterDropHeader({ chapterId, children }: { chapterId: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: `mobile-chapter:${chapterId}`, data: { type: "chapter", chapterId } });
  return <header ref={setNodeRef} className={isOver ? "chapter-drop-active" : ""}>{children}</header>;
}

export function EmptyChapterDropZone({ chapterId, mobile = false }: { chapterId: string; mobile?: boolean }) {
  const { isOver, setNodeRef } = useDroppable({ id: `${mobile ? "mobile" : "desktop"}-chapter-empty:${chapterId}`, data: { type: "chapter", chapterId } });
  return <div ref={setNodeRef} className={`empty-chapter-drop ${mobile ? "mobile-empty-chapter-drop" : ""} ${isOver ? "chapter-drop-active" : ""}`} aria-label="将大纲移动到此章节" />;
}

export function DesktopOutlineRow({ item, selected, style, dropPlacement, onOpen, onMore }: {
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

export function Sidebar({
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
  const styleTaskCount = useActiveStyleCount();
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
                      selected={currentOutline === item.id && (view === "write" || view === "chat" || view === "generate" || view === "illustrations")}
                      dropPlacement={dropIndicator?.targetId === item.id ? dropIndicator.placement : undefined}
                      onOpen={() => onOutline(item.id)}
                      onMore={() => setOutlineMenu(item)}
                    />
                  )} /> : <div className="outline-list">{group.items.map((item) => (
                    <DesktopOutlineRow
                      key={item.id}
                      item={item}
                      selected={currentOutline === item.id && (view === "write" || view === "chat" || view === "generate" || view === "illustrations")}
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
          <button type="button" aria-label="AI 任务" title="AI 任务" onClick={onTask}><Icon name="tasks" /><span>AI 任务</span>{(styleTaskCount > 0 || studio.data.tasks.some((task) => task.state === "waiting" || task.state === "running")) && <span className="task-count-badge ui-emphasis">{(studio.data.tasks.filter((task) => task.state === "waiting" || task.state === "running").length + styleTaskCount)}</span>}</button>
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

export function MobileArticleDrawer({ onClose, onGo, onNewArticle, onSelect }: {
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

export function MobileOutlineHome({
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
  const styleTaskCount = useActiveStyleCount();
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
        <IconButton name="tasks" label="AI 任务" variant="glass" size="large" className="mobile-header-action" badge={(studio.data.tasks.filter((task) => task.state === "waiting" || task.state === "running").length + styleTaskCount) || undefined} onClick={onTask} />
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
          if (window.confirm(`删除大纲「${displayTitle}」？对应正文、版本和聊天也会删除。`)) { studio.deleteOutline(actionTarget.id); act(`已删除「${displayTitle}」`); }
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

export function useHorizontalSwipe({
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

export function MobileOutlineRow({
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
          {item.state !== "saved" && <span>{item.state === "running" ? "生成中" : "生成失败"}</span>}
        </button>
        <OutlineTaskIndicator outlineId={item.id} fallback={item.state} />
        <IconButton name="more" label={`${displayTitle}更多操作`} className="mobile-row-more" aria-haspopup="dialog" aria-expanded={menuOpen} onPointerDown={() => swipe.allowActionClick()} onClick={(event) => { event.stopPropagation(); onMore(); }} />
      </div>
    </div>
  );
}

export function OutlineActionSheet({ title, archived, onClose, onSettings, onEdit, onGenerate, onChat, onCopy, onExport, onMove, onMoveUp, onMoveDown, onArchive, onDelete }: { title: string; archived: boolean; onClose: () => void; onSettings: () => void; onEdit: () => void; onGenerate: () => void; onChat: () => void; onCopy: () => void; onExport: () => void; onMove: () => void; onMoveUp?: () => void; onMoveDown?: () => void; onArchive: () => void; onDelete: () => void }) {
  const definitions: Array<{ key: string; icon: IconName; label: string; danger?: boolean }> = [
    { key: "settings", icon: "info", label: "大纲设定" },
    { key: "edit", icon: "edit", label: "编辑大纲" },
    { key: "chat", icon: "chat", label: "大纲聊天" },
    { key: "generate", icon: "spark", label: "生成大纲" },
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

export function DesktopOutlineMenu({ outline, onClose, onSettings, onOpenChat, onGenerate, onNotice }: { outline: Outline; onClose: () => void; onSettings: () => void; onOpenChat: () => void; onGenerate: () => void; onNotice: (message: string) => void }) {
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
    ["大纲聊天", onOpenChat],
    ["生成大纲", onGenerate],
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

export function ChapterActionSheet({ chapter, onClose, onNotice, onOpenOutline, onSettings }: { chapter: Chapter; onClose: () => void; onNotice: (message: string) => void; onOpenOutline: (id: string) => void; onSettings: () => void }) {
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

export function OutlineEditSheet({ target, onClose, onSave }: { target: { id: string; title: string; plan: string }; onClose: () => void; onSave: (title: string, plan: string) => void }) {
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
