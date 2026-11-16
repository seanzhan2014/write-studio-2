"use client";
import { requestTextDialog, requestConfirmDialog } from "@/app/ui/operation-dialogs";

import { useCallback, useEffect, useRef, useState, type ComponentProps, type CSSProperties, type PointerEvent } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { WorkspaceLayoutPicker, WorkspaceModeTabs, workspaceLayouts } from "./workspace-chrome";
import { useStudio, type Version } from "@/app/studio-state";
import { resolveAiSettings } from "@/lib/ai-settings-inheritance";
import { resolvedOutlineContentName, timestampContentName } from "@/lib/content-name.mjs";
import { resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";
import { OutlineTaskIndicator } from "@/app/ui/task-interaction";
import { IllustrationGenerator } from "@/app/ui/illustration-generator";
import { OutlineSettingsDrawer } from "@/app/ui/story-settings-editor";
import { saveStatusLabel } from "./navigation";
import { directContentId, directContentPreview, IconButton, useConfiguredModels, useDismissOnOutside } from "./shared";
import { WritingView } from "./writing";
import { ChatView } from "./chat";
import { GenerateView } from "./generation";
import { VersionDrawer } from "./versions";
import { MobileHeader, type OutlineWorkspace } from "./workspace";

type Mode = "write" | "chat" | "generate" | "illustrations";
type Layout = "single" | "columns" | "rows" | "grid";
type Pane = { id: number; mode: Mode; version: string; session: string };
type WorkspaceState = { layout: Layout; x: number; y: number; active: number; panes: Pane[] };
const modes: { value: Mode; label: string }[] = [{ value: "write", label: "正文" }, { value: "chat", label: "聊天" }, { value: "generate", label: "生成" }, { value: "illustrations", label: "插图" }];
const preferenceKey = "writer-studio:workspace-layout";

function initialState(mode: Mode, session = ""): WorkspaceState {
  return { layout: "single", x: .5, y: .5, active: 0, panes: [mode, "chat", "generate", "illustrations"].map((value, id) => ({ id, mode: value as Mode, version: "current", session })) };
}

function clampRatio(value: number, extent: number, minimum: number) {
  const limit = Math.min(.45, minimum / Math.max(1, extent));
  return Math.max(limit, Math.min(1 - limit, value));
}

export function MultiWorkspace({ mode, outline, focusMode, onMode, onFocus, onTaskCreated, onOpenTasks, onNotice, previewVersion, onOpenRewriteSource, illustrationHistoryTab, navigationId = 0, onBack }: ComponentProps<typeof OutlineWorkspace> & { navigationId?: number }) {
  const studio = useStudio();
  const mobile = useMediaQuery("(max-width: 767px)") ?? false;
  const [chatHeaderHost,setChatHeaderHost]=useState<HTMLDivElement|null>(null);
  const outlineId = studio.currentOutline.id;
  const models = useConfiguredModels();
  const [state, setState] = useState(() => initialState(mode, studio.currentOutline.chat.activeSessionId));
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const [ready, setReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionPane, setVersionPane] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string | null>>({});
  const editors = useRef<Record<string, number>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = grid.getBoundingClientRect();
      if (!width || !height) return;
      setState(current => {
        const x = clampRatio(current.x, width, mobile ? 120 : 300);
        const y = clampRatio(current.y, height, mobile ? 96 : 180);
        return Math.abs(x - current.x) < .001 && Math.abs(y - current.y) < .001 ? current : { ...current, x, y };
      });
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [mobile]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || !mobile) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = Math.max(viewport?.offsetTop ?? 0, workspace.getBoundingClientRect().top);
      workspace.dataset.compactHeight = ((viewport?.height ?? window.innerHeight) < 480) ? "true" : "false";
      workspace.style.setProperty("--workspace-visible-height", Math.max(0, (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - top) + "px");
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); viewport?.removeEventListener("resize", schedule); viewport?.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); workspace.style.removeProperty("--workspace-visible-height"); delete workspace.dataset.compactHeight; };
  }, [mobile]);
  const drag = useRef<{ pointer: number; axis: "x" | "y" | "both" } | null>(null);
  const [dragging, setDragging] = useState(false);
  const routeRef = useRef({ mode, preview: previewVersion?.id, navigationId });
  const draftChanged = useCallback((id: number, text: string | null) => setDrafts(current => current[id] === text ? current : { ...current, [id]: text }), []);
  const editorChanged = useCallback((key: string, id: number, editing: boolean) => {
    if (editing) editors.current[key] = id;
    else if (editors.current[key] === id) delete editors.current[key];
  }, []);
  const requestEditor = useCallback((key: string, id: number) => {
    const owner = editors.current[key];
    if (owner !== undefined && owner !== id) { onNotice(`此正文正在窗口 ${owner + 1} 中编辑`); return false; }
    return true;
  }, [onNotice]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
    try {
      const preferences = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
      const selection = JSON.parse(localStorage.getItem(`${preferenceKey}:${outlineId}`) ?? "null");
      const next = initialState(routeRef.current.mode, studio.currentOutline.chat.activeSessionId);
      if (workspaceLayouts.some(item => item.value === preferences?.layout)) next.layout = preferences.layout;
      for (const axis of ["x", "y"] as const) if (Number.isFinite(preferences?.[axis])) next[axis] = Math.max(.1, Math.min(.9, preferences[axis]));
      if (selection?.panes) next.panes = next.panes.map((pane, id) => {
        const saved = selection.panes[id];
        return { ...pane, mode: modes.some(item => item.value === saved?.mode) ? saved.mode : pane.mode, version: typeof saved?.version === "string" ? saved.version : "current", session: typeof saved?.session === "string" && saved.session ? saved.session : pane.session };
      });
      if (Number.isInteger(selection?.active) && selection.active >= 0 && selection.active < 4) next.active = selection.active;
      next.panes[next.active].mode = routeRef.current.mode;
      if (routeRef.current.preview) next.panes[next.active].version = routeRef.current.preview;
      setState(next);
    } catch { /* Invalid device preferences fall back to one window. */ }
    setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  // A workspace is keyed by outline; routes are handled separately below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineId]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(preferenceKey, JSON.stringify({ layout: state.layout, x: state.x, y: state.y }));
      localStorage.setItem(`${preferenceKey}:${outlineId}`, JSON.stringify({ active: state.active, panes: state.panes }));
    } catch { /* Storage limits do not prevent using the workspace. */ }
  }, [ready, state, outlineId]);

  useEffect(() => {
    const previous = routeRef.current;
    routeRef.current = { mode, preview: previewVersion?.id, navigationId };
    if (previous.mode === mode && previous.preview === previewVersion?.id && previous.navigationId === navigationId) return;
    setState(current => ({ ...current, panes: current.panes.map(pane => pane.id === current.active ? { ...pane, mode, ...(mode === "write" && (previous.preview !== previewVersion?.id || previous.navigationId !== navigationId) ? { version: previewVersion?.id ?? "current" } : {}) } : pane) }));
  }, [mode, previewVersion?.id, navigationId]);

  const visibleIds = state.layout === "single" ? [state.active] : state.layout === "grid" ? [0, 1, 2, 3] : state.active < 2 ? [0, 1] : [2, 3];
  function updatePane(id: number, patch: Partial<Pane>) {
    setState(current => ({ ...current, active: id, panes: current.panes.map(pane => pane.id === id ? { ...pane, ...patch } : pane) }));
  }
  function activate(id: number) {
    if (stateRef.current.active !== id) {
      setState(current => ({ ...current, active: id }));
      void onMode(stateRef.current.panes[id].mode);
    }
  }
  function setLayout(layout: Layout) {
    setState(current => ({ ...current, layout }));
  }
  function selectMode(id: number, next: Mode) {
    updatePane(id, { mode: next });
    void onMode(next);
  }
  async function saveAsCurrentContent() {
    const name = (await requestTextDialog("另存为正文版本", `${resolvedOutlineContentName(studio.currentOutline)}-复制`));
    setMoreOpen(false);
    if (name === null) return;
    const versionName = name.trim() || timestampContentName();
    studio.saveVersion(outlineId, versionName, "手动", resolvedOutlineContent(studio.currentOutline));
    const saved = await studio.saveNow();
    onNotice(saved ? `已另存为「${versionName}」` : "另存为未完成，请查看保存状态");
  }
  function resize(event: PointerEvent<HTMLElement>) {
    if (!drag.current || drag.current.pointer !== event.pointerId || !gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const axis = drag.current.axis;
    setState(current => ({ ...current, ...(axis !== "y" ? { x: clampRatio((event.clientX - rect.left) / rect.width, rect.width, mobile ? 120 : 300) } : {}), ...(axis !== "x" ? { y: clampRatio((event.clientY - rect.top) / rect.height, rect.height, mobile ? 96 : 180) } : {}) }));
  }
  function startResize(event: PointerEvent<HTMLElement>, axis: "x" | "y" | "both") {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { pointer: event.pointerId, axis };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }
  function stopResize(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }
  const separator = (axis: "x" | "y") => <div
    className={`workspace-divider divider-${axis}`}
    role="separator" aria-label={axis === "x" ? "调整左右窗口宽度" : "调整上下窗口高度"} aria-orientation={axis === "x" ? "vertical" : "horizontal"}
    aria-valuenow={Math.round(state[axis] * 100)} aria-valuemin={10} aria-valuemax={90} tabIndex={0}
    onPointerDown={event => startResize(event, axis)} onPointerMove={resize} onPointerUp={stopResize} onPointerCancel={stopResize} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
    onDoubleClick={() => setState(current => ({ ...current, [axis]: .5 }))}
    onKeyDown={event => {
      const direction = axis === "x" ? event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0 : event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (direction || event.key === "Home") { event.preventDefault(); const extent = axis === "x" ? gridRef.current?.clientWidth : gridRef.current?.clientHeight; setState(current => ({ ...current, [axis]: event.key === "Home" ? .5 : clampRatio(current[axis] + direction * .02, extent ?? 1000, axis === "x" ? mobile ? 120 : 300 : mobile ? 96 : 180) })); }
    }}
  />;
  useDismissOnOutside(moreOpen, () => setMoreOpen(false), ".workspace-more-trigger, .workspace-more-menu");
  const title = outlineDisplayTitle(outline);
  const selectedPane = state.panes.find(pane => pane.id === versionPane);

  return <div className="workspace multi-workspace" ref={workspaceRef}>
    {mobile ? <MobileHeader title={title} status={saveStatusLabel(studio.saveStatus)} outlineId={outlineId} onBack={onBack ?? (() => {})} showVersions onVersions={() => setVersionPane(state.active)} mode={state.layout === "single" && state.panes[state.active].mode === "chat" ? "chat" : undefined} onChatHost={setChatHeaderHost} onMore={() => setMoreOpen(value => !value)} controls={<><WorkspaceLayoutPicker value={state.layout} onChange={setLayout} disabled={!ready} /><IconButton name={focusMode ? "close" : "focus"} label={focusMode ? "退出专注写作" : "专注写作"} onClick={onFocus} /></>} /> : <header className="workspace-header workspace-unified-header">
      {!(state.layout === "single" && state.panes[state.active].mode === "chat") && (!focusMode ? <div className="breadcrumb"><button type="button" onClick={() => { window.history.pushState({}, "", `/articles/${studio.currentArticle.id}/chapters/${studio.currentChapter.id}`); window.dispatchEvent(new PopStateEvent("popstate")); }}>{outline.chapter}</button><span>/</span><input value={normalizeOutlineTitle(outline.title)} placeholder={title} onChange={event => studio.updateOutline(outlineId, { title: event.target.value.slice(0, 80) })} aria-label="大纲标题" /><OutlineTaskIndicator outlineId={outlineId} /></div> : <span className="workspace-focus-title">{title}</span>)}
      <div className="workspace-chat-slot" ref={setChatHeaderHost} style={{display:state.layout === "single" && state.panes[state.active].mode === "chat"?"flex":"none"}} />
      {state.layout === "single" && <WorkspaceModeTabs value={state.panes[state.active].mode} onChange={next=>selectMode(state.active,next)} />}
      <div className="workspace-meta">{studio.saveStatus !== "saved" && <span className={`save-state ${studio.saveStatus}`} title={saveStatusLabel(studio.saveStatus)} aria-label={saveStatusLabel(studio.saveStatus)}><i /><span className="save-state-label">{saveStatusLabel(studio.saveStatus)}</span></span>}<WorkspaceLayoutPicker value={state.layout} onChange={setLayout} disabled={!ready} /><IconButton name={focusMode?"close":"focus"} label={focusMode?"退出专注写作":"专注写作"} onClick={onFocus} /><IconButton name="more" label="更多操作" className="workspace-more-trigger" onClick={()=>setMoreOpen(value=>!value)} /></div>
    </header>}
    <div className="workspace-grid" ref={gridRef} data-layout={state.layout} data-dragging={dragging || undefined} style={{ "--split-x": `${state.x * 100}%`, "--split-y": `${state.y * 100}%` } as CSSProperties}>
      {state.panes.map(pane => <WorkspacePane key={pane.id} pane={pane} mobile={mobile} visible={visibleIds.includes(pane.id)} position={visibleIds.indexOf(pane.id)} split={state.layout !== "single"} active={state.active === pane.id}
        globalChatHost={state.layout === "single" && visibleIds.includes(pane.id) ? chatHeaderHost : null} models={models} title={title} outline={outline} focusMode={focusMode} onActivate={() => activate(pane.id)} onMode={next => selectMode(pane.id, next)} onUpdate={patch => updatePane(pane.id, patch)}
        onNotice={onNotice} onTaskCreated={onTaskCreated} onOpenTasks={onOpenTasks} onOpenRewriteSource={onOpenRewriteSource} onVersions={() => setVersionPane(pane.id)}
        onDraftChange={draftChanged} onEditorChange={editorChanged} onRequestEditor={requestEditor} illustrationHistoryTab={illustrationHistoryTab}
        contextSource={visibleIds.map(id => state.panes[id]).find(other => other.id !== pane.id && other.mode === "write")}
        drafts={drafts}
        sharedContent={state.panes.filter(other => other.id !== pane.id && (selectedVersion(other.version, studio.currentOutline)?.id ?? studio.currentOutline.currentVersionId ?? directContentId(outlineId)) === (selectedVersion(pane.version, studio.currentOutline)?.id ?? studio.currentOutline.currentVersionId ?? directContentId(outlineId))).map(other => drafts[other.id]).find(text => text != null) ?? undefined}
      />)}
      {(state.layout === "columns" || state.layout === "grid") && separator("x")}
      {(state.layout === "rows" || state.layout === "grid") && separator("y")}
      {state.layout === "grid" && <button type="button" className="workspace-divider-cross" aria-label="同时调整窗口宽高" onPointerDown={event => startResize(event, "both")} onPointerMove={resize} onPointerUp={stopResize} onPointerCancel={stopResize} onLostPointerCapture={() => { drag.current = null; setDragging(false); }} onDoubleClick={() => setState(current => ({ ...current, x: .5, y: .5 }))} />}
    </div>
    {versionPane !== null && <VersionDrawer selectedVersionId={selectedPane?.version === "current" ? undefined : selectedPane?.version} onClose={() => setVersionPane(null)} onPreview={id => { if (selectedPane) { updatePane(selectedPane.id, { mode: "write", version: id }); } }} onClearPreview={() => { if (selectedPane) { updatePane(selectedPane.id, { mode: "write", version: "current" }); } }} onOpenRewriteSource={onOpenRewriteSource} onNotice={onNotice} />}
    {moreOpen && <div className="workspace-more-menu"><button type="button" onClick={()=>{setVersionPane(state.active);setMoreOpen(false);}}>管理正文版本</button><button type="button" onClick={() => { setSettingsOpen(true); setMoreOpen(false); }}>大纲设定</button><button type="button" onClick={() => { studio.saveVersion(outlineId, timestampContentName(), "手动", resolvedOutlineContent(studio.currentOutline)); setMoreOpen(false); }}>保存正文版本</button><button type="button" onClick={() => void saveAsCurrentContent()}>另存为正文版本</button><button type="button" onClick={() => { studio.updateOutline(outlineId, { archived: true }); setMoreOpen(false); }}>归档大纲</button><button className="danger" type="button" onClick={async () => { if ((await requestConfirmDialog(`删除「${title}」？`))) studio.deleteOutline(outlineId); setMoreOpen(false); }}>删除大纲</button></div>}
    {settingsOpen && <OutlineSettingsDrawer outlineId={outlineId} onClose={() => setSettingsOpen(false)} />}
  </div>;
}

type PaneProps = {
  globalChatHost: HTMLElement | null; pane: Pane; mobile: boolean; visible: boolean; position: number; split: boolean; active: boolean; models: ReturnType<typeof useConfiguredModels>; title: string;
  outline: ComponentProps<typeof OutlineWorkspace>["outline"]; focusMode: boolean; onActivate: () => void; onMode: (mode: Mode) => void; onUpdate: (patch: Partial<Pane>) => void;
  onNotice: (message: string) => void; onTaskCreated: () => void; onOpenTasks: () => void; onOpenRewriteSource: (id: string) => void; onVersions: () => void;
  onDraftChange: (id: number, text: string | null) => void; onEditorChange: (key: string, id: number, editing: boolean) => void; onRequestEditor: (key: string, id: number) => boolean; illustrationHistoryTab: string; contextSource?: Pane; drafts: Record<number, string | null>; sharedContent?: string;
};

function selectedVersion(version: string, outline: ReturnType<typeof useStudio>["currentOutline"]): Version | undefined {
  return version === directContentId(outline.id) ? directContentPreview(outline) : outline.versions.find(item => item.id === version);
}

function WorkspacePane({ globalChatHost, pane, mobile, visible, position, split, active, models, title, outline, focusMode, onActivate, onMode, onUpdate, onNotice, onTaskCreated, onOpenTasks, onOpenRewriteSource, onVersions, onDraftChange, onEditorChange, onRequestEditor, illustrationHistoryTab, contextSource, drafts, sharedContent }: PaneProps) {
  const studio = useStudio();
  const [localChatHost,setLocalChatHost]=useState<HTMLDivElement|null>(null);
  const [opened, setOpened] = useState<Mode[]>(visible ? [pane.mode] : []);
  const [editing, setEditing] = useState(false);
  const paneRef = useRef<HTMLElement>(null);
  const [readingChromeHidden, setReadingChromeHidden] = useState(false);
  useEffect(() => {
    setReadingChromeHidden(false);
    const element = paneRef.current;
    element?.style.removeProperty("--reading-toolbar-height");
    element?.style.removeProperty("--reading-heading-height");
    if (!element || !mobile || !visible || pane.mode !== "write" || editing) return;
    let previous = 0;
    let distance = 0;
    let direction = 0;
    const onScroll = (event: Event) => {
      const reader = event.target;
      if (!(reader instanceof HTMLElement) || !reader.classList.contains("content-reader")) return;
      const maximum = Math.max(0, reader.scrollHeight - reader.clientHeight);
      const top = Math.max(0, Math.min(reader.scrollTop, maximum));
      // Ignore clamps caused by toolbar resizing and Safari rubber-band scrolling.
      const delta = top - Math.min(previous, maximum);
      previous = top;
      if (top <= 8) { distance = 0; setReadingChromeHidden(false); return; }
      if (Math.abs(delta) < 1) return;
      const nextDirection = Math.sign(delta);
      distance = nextDirection === direction ? distance + Math.abs(delta) : Math.abs(delta);
      direction = nextDirection;
      if (distance >= (direction > 0 ? 20 : 10)) {
        if (direction > 0 && !element.hasAttribute("data-reading-chrome")) {
          const toolbar = element.querySelector<HTMLElement>(".workspace-pane-toolbar");
          const heading = reader.closest(".content-editor-section")?.querySelector<HTMLElement>(".editor-heading");
          if (toolbar) element.style.setProperty("--reading-toolbar-height", `${toolbar.offsetHeight}px`);
          if (heading) element.style.setProperty("--reading-heading-height", `${heading.offsetHeight}px`);
        }
        setReadingChromeHidden(direction > 0);
        distance = 0;
      }
    };
    element.addEventListener("scroll", onScroll, true);
    return () => element.removeEventListener("scroll", onScroll, true);
  }, [mobile, visible, split, pane.mode, pane.version, editing]);
  const [illustrationSource, setIllustrationSource] = useState<{ content: string; excerpt: string; currentContent: string; currentVersionId: string | null | undefined } | null>(null);
  const preview = selectedVersion(pane.version, studio.currentOutline);
  const editingKey = preview?.id ?? studio.currentOutline.currentVersionId ?? directContentId(studio.currentOutline.id);
  const ownContent = preview?.content ?? resolvedOutlineContent(studio.currentOutline);
  const activeIllustrationSource = illustrationSource?.currentContent === resolvedOutlineContent(studio.currentOutline) && illustrationSource.currentVersionId === studio.currentOutline.currentVersionId ? illustrationSource : null;
  const sourceVersion = contextSource ? selectedVersion(contextSource.version, studio.currentOutline) : undefined;
  const contextContent = contextSource ? drafts[contextSource.id] ?? sourceVersion?.content ?? resolvedOutlineContent(studio.currentOutline) : undefined;
  const contextLabel = contextSource ? `窗口 ${contextSource.id + 1} · ${sourceVersion?.name ?? resolvedOutlineContentName(studio.currentOutline)}${drafts[contextSource.id] != null ? " · 编辑草稿" : ""}` : undefined;
  const draftCallback = useCallback((text: string | null) => onDraftChange(pane.id, text), [onDraftChange, pane.id]);
  const editingCallback = useCallback((value: boolean) => {
    setEditing(value);
    onEditorChange(editingKey, pane.id, value);
  }, [onEditorChange, editingKey, pane.id]);
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => setOpened(current => current.includes(pane.mode) ? current : [...current, pane.mode]));
    return () => cancelAnimationFrame(frame);
  }, [pane.mode, visible]);
  const illustrationSettings = resolveAiSettings(studio.currentArticle, studio.currentOutline.id, "generate", "outline", studio.data.settings).value.tasks!;
  const bodyVisible = visible && pane.mode === "write";
  return <section ref={paneRef} className={`workspace-pane${mobile && editing ? " mobile-writing-editing" : ""}`} data-reading-chrome={readingChromeHidden && bodyVisible && !editing ? "hidden" : undefined} data-position={position} data-active={active || undefined} hidden={!visible} aria-label={`窗口 ${pane.id + 1}`} onPointerDownCapture={onActivate} onFocusCapture={onActivate}>
    {(split || mobile) && <div className="workspace-pane-toolbar">
      <WorkspaceModeTabs value={pane.mode} onChange={onMode} label={split ? `窗口 ${pane.id + 1} 功能` : "工作模式"} />
      <div className="workspace-chat-slot" ref={setLocalChatHost} style={{display:split && pane.mode === "chat"?"flex":"none"}} />
      {pane.mode === "write" && (split || focusMode) && <div className="workspace-pane-versions"><select aria-label={`窗口 ${pane.id + 1} 正文版本`} disabled={editing} value={preview?.id ?? "current"} onChange={event => onUpdate({ version: event.target.value })}><option value="current">当前正文</option>{studio.currentOutline.content && <option value={directContentId(studio.currentOutline.id)}>直接保存正文</option>}{studio.currentOutline.versions.map(version => <option key={version.id} value={version.id}>{version.name}</option>)}</select><IconButton name="versions" label={`窗口 ${pane.id + 1} 版本管理`} onClick={onVersions} disabled={editing} /></div>}
    </div>}
    {opened.includes("write") && <div className="workspace-pane-view" hidden={!bodyVisible}>
      <WritingView onManageVersions={onVersions} key={pane.version} sharedContent={sharedContent} focusMode={focusMode} previewVersion={preview} onOpenRewriteSource={onOpenRewriteSource} onClearPreview={() => onUpdate({ version: "current" })} onNotice={onNotice} onEditingChange={editingCallback}
        onSelectVersion={version => onUpdate({ version })} draftStorageKey={`writer-studio:pane-draft:${studio.currentOutline.id}:${pane.id}:${pane.version}`}
        onDraftChange={draftCallback} onRequestEditing={() => onRequestEditor(editingKey, pane.id)}
        onIllustration={(content, excerpt) => { setIllustrationSource({ content, excerpt, currentContent: resolvedOutlineContent(studio.currentOutline), currentVersionId: studio.currentOutline.currentVersionId }); onMode("illustrations"); }} />
    </div>}
    {opened.includes("chat") && <div className="workspace-pane-view" hidden={!visible || pane.mode !== "chat"}><ChatView headerHost={visible && pane.mode === "chat" ? (split ? localChatHost : globalChatHost) : null} models={models} outlineTitle={title} onNotice={onNotice} onUseAsGenerate={() => {}} sessionId={pane.session || studio.currentOutline.chat.sessions[0]?.id} onSessionChange={session => onUpdate({ session })} contextContent={contextContent} contextLabel={contextLabel} visible={visible && pane.mode === "chat"} copyOnly /></div>}
    {opened.includes("generate") && <div className="workspace-pane-view" hidden={!visible || pane.mode !== "generate"}><GenerateView models={models} outline={outline} onTaskCreated={onTaskCreated} onOpenTasks={onOpenTasks} independent={split} instanceId={pane.id === 0 ? undefined : String(pane.id)} /></div>}
    {opened.includes("illustrations") && <div className="workspace-pane-view illustration-mode-panel" hidden={!visible || pane.mode !== "illustrations"}><IllustrationGenerator outlineId={studio.currentOutline.id} content={activeIllustrationSource?.content ?? ownContent} selectedExcerpt={activeIllustrationSource?.excerpt ?? ""} initialTab={illustrationHistoryTab} defaultModel={String(illustrationSettings.illustrationPromptModel)} defaultImageModel={String(illustrationSettings.illustrationImageModel)} onClose={() => onMode("write")} independent={split} /></div>}
  </section>;
}
