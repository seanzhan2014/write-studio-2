"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { useStudio } from "@/app/studio-state";
import { fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { characterPhotos, EMPTY_PHOTO_DRAFT, normalizePhotoDraft, photoSrc, photoStyle, photoSyncStatus, type CharacterPhoto, type CharacterPhotoGallery, type PhotoDraft, type PhotoJob } from "@/lib/character-photos";
import { normalizeIllustrationStyles, resolveIllustrationStyle } from "@/lib/illustration-styles";
import { normalizeIllustrationOptions } from "@/lib/illustration-options";
import { supportsImages, imageReferenceCapability, imageParameterValues, type ModelMetadata } from "@/lib/ai-model-capabilities";
import { modelSelectionLabel } from "@/lib/model-label";
import { photoModelOptions, type PhotoModelResolution } from "@/lib/photo-model-resolution";
import { ResponsiveModal } from "./overlays";
import { newestTaskFirst } from "@/lib/task-order";
import type { TaskTimelineEntry } from "./task-timeline";

type Model = { id: string; name: string; providerName: string; hasSecret: boolean; metadata?: ModelMetadata };
type Provider = { id: string; name: string; hasSecret: boolean; characterLibrary: boolean };
type Overview = { gallery: CharacterPhotoGallery; jobs: PhotoJob[]; revision: number; providers: Provider[]; backgroundMode: "app" | "service"; error?: string };
const STATES: Record<PhotoJob["state"], string> = { queued: "排队中", running: "生成中", waiting: "等待图像服务", success: "已生成", error: "失败", interrupted: "等待恢复", cancelled: "已取消" };

const time = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const active = (job: PhotoJob) => ["queued", "running", "waiting"].includes(job.state);
const endpoint = "/api/ai/character-photos";
async function post(body: unknown) {
  const response = await fetchServerAction(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "照片操作失败");
  return payload;
}
function openPhotos(id: string) { window.dispatchEvent(new CustomEvent("writer-studio:photos", { detail: id })); }

// Dispatch is mounted for the entire app, so navigating away from a profile
// does not strand cloud jobs. Local services also have their own server runner.
export function CharacterPhotoRuntime() {
  const studio = useStudio();
  const studioRef = useRef(studio); studioRef.current = studio;
  const [personId, setPersonId] = useState("");
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  useEffect(() => {
    const listener = (e: Event) => setPersonId(String((e as CustomEvent).detail || ""));
    window.addEventListener("writer-studio:photos", listener);
    return () => window.removeEventListener("writer-studio:photos", listener);
  }, []);
  useEffect(() => {
    if (!studio.hydrated) return;
    let stopped = false; let loading = false; let revision = -1;
    const pending = new Set<string>();
    async function tick() {
      if (loading || document.visibilityState !== "visible" || !navigator.onLine) return;
      loading = true;
      try {
        const response = await fetchFromServer(`${endpoint}?dispatch=1`, { cache: "no-store" });
        if (!response.ok || stopped) return;
        const data = await response.json();
        for (const id of data.ids || []) {
          if (pending.has(id)) continue;
          pending.add(id);
          void post({ action: "execute", jobId: id }).catch(() => undefined).finally(() => pending.delete(id));
        }
        if (revision >= 0 && revision !== data.revision) await studioRef.current.refreshFromServer();
        revision = data.revision;
      } catch { /* Existing save/offline UI reports connectivity. */ }
      finally { loading = false; }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 4000);
    window.addEventListener("focus", tick);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("focus", tick); };
  }, [studio.hydrated]);
  const person = studio.data.articles.flatMap(a => a.characters).find(p => p.id === personId);
  return person ? <ResponsiveModal opened onClose={() => setPersonId("")} title={`${person.name} · 照片`} size={1120} fullScreen={compact} scrollMode="content" classNames={{ content: "character-photo-dialog", body: "character-photo-dialog-body" }}><CharacterPhotoWorkspace key={person.id} characterId={person.id} /></ResponsiveModal> : null;
}

export function CharacterPhotoEntry({ characterId }: { characterId: string }) {
  const studio = useStudio();
  const person = studio.data.articles.flatMap(a => a.characters).find(p => p.id === characterId);
  const g = characterPhotos(person?.photos, person?.visual);
  return <button type="button" className="photo-entry" onClick={() => openPhotos(characterId)}>{g.coverId && <img src={photoSrc(g.photos.find(p => p.id === g.coverId)!)} alt="人物主图" />}<span><strong>人物照片</strong><small>{g.photos.filter(p => p.status === "approved").length} 张相册照片 · 上传参考、生成与管理</small></span><span aria-hidden>›</span></button>;
}

export function CharacterPhotoTasks({ renderList }: { renderList?: (entries: TaskTimelineEntry[]) => ReactNode } = {}) {
  const [jobs, setJobs] = useState<PhotoJob[]>([]);
  useEffect(() => {
    let stopped = false;
    const load = () => void fetchFromServer(endpoint, { cache: "no-store" }).then(r => r.json()).then(data => { if (!stopped) setJobs(data.jobs || []); }).catch(() => undefined);
    load(); const timer = window.setInterval(load, 4000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  const entries = [...jobs].sort(newestTaskFirst).map(job => ({
    id: `photo:${job.id}`, createdAt: job.createdAt,
    content: <button className="photo-task-card" key={job.id} type="button" aria-label={`查看人物照片任务：${job.characterName}`} onClick={() => openPhotos(job.characterId)}><span><strong>{job.characterName}</strong><small>人物照片 · {job.snapshot.model.name} · {time(job.createdAt)}</small></span><span>{STATES[job.state]}</span></button>,
  }));
  if (renderList) return renderList(entries);
  if (!entries.length) return null;
  return <section className="photo-task-list" aria-label="人物照片任务"><h3>人物照片 <small>{jobs.filter(active).length} 个进行中</small></h3>{entries.map(entry => entry.content)}</section>;
}

export function CharacterPhotoWorkspace({ characterId }: { characterId: string }) {
  const studio = useStudio();
  const styles = normalizeIllustrationStyles(studio.data.settings.illustrationStyles);
  const styleLabel = (value: string) => resolveIllustrationStyle(value, styles).label;
  const studioRef = useRef(studio); studioRef.current = studio;
  const article = studio.data.articles.find(a => a.characters.some(p => p.id === characterId));
  const person = article?.characters.find(p => p.id === characterId);
  const [gallery, setGallery] = useState(() => characterPhotos(person?.photos, person?.visual));
  const [draft, setDraft] = useState<PhotoDraft>(() => ({ ...EMPTY_PHOTO_DRAFT }));
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [modelCheck, setModelCheck] = useState<{ key: string; resolution?: PhotoModelResolution; error?: string }>({ key: "" });
  const [modelCheckAttempt, setModelCheckAttempt] = useState(0);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [jobs, setJobs] = useState<PhotoJob[]>([]);
  const [mode, setMode] = useState<"approved" | "candidate" | "reference" | "archived">("approved");
  const [pane, setPane] = useState<"photos" | "generate">("photos");
  const [selectedId, setSelectedId] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compareSide, setCompareSide] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [backgroundMode, setBackgroundMode] = useState("service");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [providerId, setProviderId] = useState("");
  const [remoteId, setRemoteId] = useState("");
  const [remoteItems, setRemoteItems] = useState<Array<{ id: string; name: string; count?: number }>>([]);
  const [cursor, setCursor] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const rootRef = useRef<HTMLElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!compact) return;
    const surface = rootRef.current?.closest<HTMLElement>(".ws-overlay-surface");
    const viewport = window.visualViewport;
    if (!surface || !viewport) return;
    let frame = 0;
    const update = () => {
      surface.style.setProperty("--photo-viewport-height", `${Math.round(viewport.height)}px`);
      surface.dataset.photoKeyboard = window.innerHeight - viewport.height > 100 ? "true" : "false";
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && rootRef.current?.contains(focused) && /^(TEXTAREA|INPUT|SELECT)$/.test(focused.tagName)) focused.scrollIntoView({ block: "nearest" });
      });
    };
    update(); viewport.addEventListener("resize", update);
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener("resize", update); surface.style.removeProperty("--photo-viewport-height"); delete surface.dataset.photoKeyboard; };
  }, [compact]);

  const initialized = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const lastRevision = useRef(-1);
  const lastRemoteRefresh = useRef(0);
  const galleryRef = useRef(gallery); galleryRef.current = gallery;
  const draftKey = `writer-studio:photo-draft:${characterId}`;
  const queuedPost = useCallback((body: Record<string, unknown>) => {
    const task = serial.current.catch(() => undefined).then(() => post({ ...body, characterId }));
    serial.current = task; return task;
  }, [characterId]);
  const load = useCallback(async () => {
    const response = await fetchFromServer(`${endpoint}?characterId=${encodeURIComponent(characterId)}`, { cache: "no-store" });
    const data = await response.json() as Overview;
    if (!response.ok) throw new Error(data.error || "无法读取人物照片");
    setGallery(data.gallery); setJobs(data.jobs); setProviders(data.providers); setBackgroundMode(data.backgroundMode);
    if (!initialized.current) {
      let restored = data.gallery.draft;
      try { const local = localStorage.getItem(draftKey); if (local) restored = normalizePhotoDraft(JSON.parse(local)); } catch { /* Server draft remains available. */ }
      if (!restored.referenceIds.length) restored = { ...restored, referenceIds: data.gallery.referenceIds };
      setDraft(restored); initialized.current = true; setReady(true);
      setProviderId(data.gallery.binding?.providerId || data.providers.find(p => p.characterLibrary)?.id || "");
      if (!data.gallery.photos.some(p => p.status === "approved") && data.gallery.photos.some(p => p.status === "candidate")) setMode("candidate");
      else if (!data.gallery.photos.some(p => p.status === "approved") && data.gallery.photos.some(p => p.status === "reference")) setMode("reference");
    }
    if (lastRevision.current >= 0 && lastRevision.current !== data.revision) await studioRef.current.refreshFromServer();
    lastRevision.current = data.revision;
  }, [characterId, draftKey]);
  useEffect(() => {
    let stopped = false;
    void load().catch(e => { if (!stopped) setError(e.message); });
    void fetchFromServer("/api/models", { cache: "no-store" }).then(r => r.json()).then(data => { if (!stopped) setModels((data.models || []).filter(supportsImages)); }).catch(e => { if (!stopped) setError(e.message); });
    const timer = window.setInterval(() => { if (!stopped && document.visibilityState === "visible" && !busyRef.current) void load().catch(() => undefined); }, 4000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* Server autosave still works. */ }
    setDraftStatus("正在保存草稿…");
    const timer = window.setTimeout(() => {
      void queuedPost({ action: "draft", draft }).then(() => setDraftStatus("草稿已保存")).catch(() => setDraftStatus("草稿保留在此设备，联网后重试"));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, draftKey, queuedPost, ready]);
  useEffect(() => {
    if (!ready) return;
    const refresh = () => {
      const g = galleryRef.current;
      if (!g.binding || busyRef.current || Date.now() - lastRemoteRefresh.current < 60_000 || Date.now() - Date.parse(g.binding.checkedAt) < 60_000) return;
      lastRemoteRefresh.current = Date.now();
      void queuedPost({ action: "refresh" }).then(() => load()).catch(e => setNotice(`角色库刷新未完成：${e.message}`));
    };
    refresh(); window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load, queuedPost, ready]);
  async function run(action: string, payload: Record<string, unknown> = {}, message = "") {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(action); setError(""); setNotice("");
    try {
      if (!await studioRef.current.saveNow()) throw new Error("请先解决当前资料的保存问题，再操作照片");
      await queuedPost({ action, ...payload });
      await load(); await studioRef.current.refreshFromServer();
      if (message) setNotice(message);
    } catch (e) { setError(e instanceof Error ? e.message : "照片操作失败"); }
    finally { busyRef.current = false; setBusy(""); }
  }
  const patchDraft = (patch: Partial<PhotoDraft>) => setDraft(current => ({ ...current, ...patch }));
  const chosenModel = models.find(m => m.id === draft.modelId);
  const referenceCount = new Set([...draft.referenceIds, ...(draft.basePhotoId ? [draft.basePhotoId] : [])]).size;
  const hasReferences = referenceCount > 0;
  const modelCheckKey = `${draft.modelId}:${hasReferences}`;
  const checkedModel = modelCheck.key === modelCheckKey ? modelCheck : undefined;
  const checkingModel = Boolean(chosenModel && !checkedModel);
  const effectiveModel = checkedModel?.resolution?.model || chosenModel;
  const referenceCapability = imageReferenceCapability(effectiveModel);
  useEffect(() => {
    if (!draft.modelId || !chosenModel) return;
    const controller = new AbortController();
    const key = `${draft.modelId}:${hasReferences}`;
    setModelCheck({ key: "" });
    void fetchFromServer(`${endpoint}?modelId=${encodeURIComponent(draft.modelId)}&references=${hasReferences ? "1" : "0"}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法确认模型的图片编辑能力");
      if (controller.signal.aborted) return;
      setModelCheck({ key, resolution: payload });
      if (payload.automaticEdit) setDraft(current => current.modelId === payload.selectedId && Boolean(current.referenceIds.length || current.basePhotoId) === hasReferences ? photoModelOptions(current, payload.model, true) : current);
    }).catch(e => { if (!controller.signal.aborted) setModelCheck({ key, error: e instanceof Error ? e.message : "无法检测图像模型" }); });
    return () => controller.abort();
  }, [draft.modelId, chosenModel?.id, hasReferences, modelCheckAttempt]);
  const currentStyle = photoStyle(draft, gallery, normalizeIllustrationOptions(article?.illustrationSettings).stylePreset);
  const referenceIssue = checkingModel ? "" : checkedModel?.error || (referenceCount && !referenceCapability ? "此模型没有可用的参考图或 edit 版本，请选择其他图像模型。" : referenceCapability?.maxImages && referenceCount > referenceCapability.maxImages ? `此模型最多支持 ${referenceCapability.maxImages} 张参考图，包括修改底图。` : referenceCapability?.required && !referenceCount ? "此模型需要参考照片。" : "");
  const selected = gallery.photos.find(p => p.id === selectedId);
  const formal = gallery.photos.filter(p => p.status === "approved");
  const sync = photoSyncStatus(gallery);
  const candidates = gallery.photos.filter(p => p.status === "candidate");
  const visible = gallery.photos.filter(p => p.status === mode && (!favoriteOnly || p.favorite));
  const cover = gallery.photos.find(p => p.id === gallery.coverId);
  function editPhoto(photo: CharacterPhoto) {
    patchDraft({ basePhotoId: photo.id, referenceIds: gallery.referenceIds.filter(id => id !== photo.id), prompt: "", experimentId: crypto.randomUUID() });
    setSelectedId(""); setComparing(false); setPane("generate");
  }
  function adjust(job: PhotoJob) {
    patchDraft({ ...job.snapshot.draft, style: job.snapshot.stylePreset, count: 1 });
    setPane("generate"); setSelectedId("");
    setNotice("已载入原参数与当时风格；编辑后可开始下一次尝试。");
  }
  async function generate(retryId?: string) {
    const snapshot = { ...draftRef.current, experimentId: draftRef.current.experimentId || crypto.randomUUID() };
    patchDraft({ experimentId: snapshot.experimentId });
    await run("generate", { requestId: crypto.randomUUID(), draft: snapshot, ...(retryId ? { retryId } : {}) }, "已加入图像队列，可以继续编辑下一次要求。");
    setMode("candidate");
  }
  async function upload(files: FileList | null) {
    if (!files?.length || busyRef.current) return;
    busyRef.current = true; setBusy("upload"); setError("");
    const accepted: string[] = [];
    try {
      if (!await studioRef.current.saveNow()) throw new Error("人物资料尚未保存");
      for (const file of Array.from(files).slice(0, 20)) {
        if (file.size > 10 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error(`${file.name}：请选择 10 MB 以内的 PNG、JPEG 或 WebP 照片`);
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("无法读取照片")); reader.readAsDataURL(file); });
        const result = await queuedPost({ action: "upload", dataUrl, name: file.name });
        accepted.push(...result.gallery.referenceIds.filter((id: string) => !gallery.referenceIds.includes(id)));
      }
      patchDraft({ referenceIds: [...new Set([...draftRef.current.referenceIds, ...accepted])] });
      setMode("reference"); setNotice("参考照片已保存。可以选作生成参考，也可以加入正式相册。");
    } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); }
    finally { await load().catch(() => undefined); await studioRef.current.refreshFromServer(); busyRef.current = false; setBusy(""); if (uploadRef.current) uploadRef.current.value = ""; }
  }
  async function loadRemote(more = false) {
    if (!providerId || remoteLoading) return;
    setRemoteLoading(true); setError("");
    try {
      const response = await fetchFromServer(`/api/ai/image-characters?providerId=${encodeURIComponent(providerId)}${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "无法读取角色库");
      setRemoteItems(items => more ? [...items, ...data.items.filter((p: { id: string }) => !items.some(x => x.id === p.id))] : data.items || []); setCursor(data.nextCursor || "");
    } catch (e) { setError(e instanceof Error ? e.message : "无法读取角色库"); }
    finally { setRemoteLoading(false); }
  }
  function remoteLabel(photo: CharacterPhoto) {
    const b = gallery.binding;
    if (!b || photo.status !== "approved") return "";
    const r = photo.remote;
    if (!r || r.providerId !== b.providerId || r.baseUrl !== b.baseUrl || r.workspaceId !== b.workspaceId) return "仅本软件 · 待保存资产";
    return b.order.includes(r.assetId) ? "已在角色中" : "资产已保存 · 待加入角色";
  }
  function photoButtons(photo: CharacterPhoto) {
    return <div className="photo-detail-actions">
      {photo.status !== "archived" && <><button type="button" disabled={Boolean(busy)} onClick={() => void run("cover", { photoId: photo.id }, "已设为主图，原主图仍保留在相册。")}>{gallery.coverId === photo.id ? "当前主图" : "设为主图并加入相册"}</button>{photo.status !== "approved" && <button type="button" disabled={Boolean(busy)} onClick={() => void run("adopt", { photoId: photo.id }, "已加入正式相册。")}>加入相册</button>}<button type="button" onClick={() => editPhoto(photo)}>以此图修改</button><button type="button" disabled={Boolean(busy)} onClick={() => void run("favorite", { photoId: photo.id })}>{photo.favorite ? "取消收藏" : "收藏"}</button><button type="button" onClick={() => patchDraft({ referenceIds: draft.referenceIds.includes(photo.id) ? draft.referenceIds.filter(id => id !== photo.id) : [...draft.referenceIds, photo.id] })}>{draft.referenceIds.includes(photo.id) ? "移出本次参考" : "用作本次参考"}</button><button type="button" disabled={Boolean(busy)} onClick={() => void run("references", { ids: gallery.referenceIds.includes(photo.id) ? gallery.referenceIds.filter(id => id !== photo.id) : [...gallery.referenceIds, photo.id] })}>{gallery.referenceIds.includes(photo.id) ? "取消默认参考" : "设为默认参考"}</button></>}
      <a href={photoSrc(photo)} download={`${photo.name}.${photo.mime.split("/")[1]}`} target="_blank" rel="noreferrer">下载</a>
      <button type="button" disabled={Boolean(busy)} onClick={() => { if (photo.status !== "archived") patchDraft({ referenceIds: draft.referenceIds.filter(id => id !== photo.id), basePhotoId: draft.basePhotoId === photo.id ? "" : draft.basePhotoId }); void run(photo.status === "archived" ? "restore" : "archive", { photoId: photo.id }, photo.status === "archived" ? "照片已恢复到参考照片。" : "已移入历史，不会删除远端资产或改变过去生成的插图。"); }}>{photo.status === "archived" ? "恢复照片" : "移入历史"}</button>
    </div>;
  }
  const attempts = <details className="photo-attempts" open={jobs.some(j => active(j) || j.state === "interrupted" || j.state === "error")}><summary>生成记录 · {jobs.length} 次尝试 · {jobs.filter(active).length} 个进行中</summary><p className="photo-muted">{backgroundMode === "service" ? "本地服务运行期间，关闭浏览器也会继续处理。" : "此网站在应用打开时推进队列，重新打开后会恢复查询。"} 每个候选单独定稿。</p>{jobs.map(job => <article className={`photo-attempt ${job.state}`} key={job.id}><header><strong>{STATES[job.state]}</strong><small>{time(job.createdAt)} · {job.snapshot.model.name}</small></header><p>{job.snapshot.draft.prompt || job.snapshot.draft.pose} · {styleLabel(job.snapshot.stylePreset)}</p>{job.error && <p role="status" className="photo-error">{job.error}</p>}<div className="photo-inline-actions">{job.photoId && <button type="button" onClick={() => { setSelectedId(job.photoId!); setPane("photos"); }}>查看照片</button>}<button type="button" onClick={() => adjust(job)}>调整参数</button>{!["queued", "running", "waiting", "interrupted"].includes(job.state) && <button type="button" disabled={Boolean(busy)} onClick={() => void generate(job.id)}>原参数再试一次</button>}{job.state === "interrupted" && job.canResume && <button type="button" disabled={Boolean(busy)} onClick={() => void run("job", { jobId: job.id, operation: "resume" }, "将使用原任务继续查询。")}>继续查询原任务</button>}{job.state === "queued" && <button type="button" disabled={Boolean(busy)} onClick={() => void run("job", { jobId: job.id, operation: "cancel" })}>取消排队</button>}</div><details><summary>当时的提示词与参数</summary><pre>{job.snapshot.prompt}</pre><small>{job.snapshot.styleSource} · {job.snapshot.references.length} 张身份参考{job.snapshot.basePhoto ? " · 1 张修改底图" : ""} · {job.snapshot.draft.size || job.snapshot.draft.resolution || "默认分辨率"}</small></details></article>)}</details>;

  if (!person) return <p>人物不存在。</p>;
  return <section ref={rootRef} className={`photo-workspace ${pane === "generate" ? "show-generator" : "show-photos"}`} aria-label="人物照片工作区">
    <input type="file" ref={uploadRef} accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="上传人物参考照片" onChange={e => void upload(e.currentTarget.files)} />
    <header className="photo-workspace-header"><div className="photo-heading">{cover && <img src={photoSrc(cover)} alt={`${person.name}主图`} />}<div><strong>{person.name} · 人物照片</strong><small>{formal.length} 张相册照片 · {candidates.length} 张候选</small></div></div><span className="photo-draft-status" role="status">{draftStatus}</span></header>
    {error && <div className="photo-message photo-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="关闭照片错误提示">×</button></div>}
    {notice && <div className="photo-message" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="关闭照片提示">×</button></div>}
    {!ready && <p role="status">正在读取照片…</p>}
    <div className="photo-workspace-columns">
      <div className="photo-library-pane">
        {comparing ? <section className="photo-comparison" aria-label="照片对比"><div className="photo-section-heading"><button type="button" onClick={() => { setComparing(false); setZoom(1); }}>返回照片</button><strong>照片对比</strong><label>缩放<select aria-label="对比缩放" value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={1}>100%</option><option value={1.5}>150%</option><option value={2}>200%</option></select></label></div>{compact && <div className="photo-ab-switch">{compareIds.map((id, i) => <button type="button" aria-pressed={compareSide === i} key={id} onClick={() => setCompareSide(i)}>{i === 0 ? "A" : "B"} · {gallery.photos.find(p => p.id === id)?.name}</button>)}</div>}<div className="photo-compare-images">{compareIds.map((id, i) => { const photo = gallery.photos.find(p => p.id === id); return photo && (!compact || i === compareSide) ? <figure key={id}><div className="photo-zoom-scroll"><img src={photoSrc(photo)} alt={`对比 ${i === 0 ? "A" : "B"}：${photo.name}`} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} /></div><figcaption>{i === 0 ? "A" : "B"} · {photo.name}</figcaption>{photoButtons(photo)}</figure> : null; })}</div></section>
        : selected ? <section className="photo-detail" aria-label="照片详情"><div className="photo-section-heading"><button type="button" onClick={() => { setSelectedId(""); setZoom(1); }}>返回照片</button><label>缩放<select aria-label="照片缩放" value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={1}>100%</option><option value={1.5}>150%</option><option value={2}>200%</option></select></label></div><div className="photo-zoom-scroll photo-main-preview"><img src={photoSrc(selected)} alt={selected.name} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} /></div><h3>{selected.name}</h3>{remoteLabel(selected) && <p className="photo-remote-status">{remoteLabel(selected)}</p>}<small>{time(selected.createdAt)}{selected.generation ? ` · ${styleLabel(selected.generation.stylePreset)}` : ""}</small>{photoButtons(selected)}<label className="photo-rename">照片名称<input key={selected.id + selected.name} defaultValue={selected.name} maxLength={200} onBlur={e => { if (e.target.value.trim() && e.target.value !== selected.name) void run("rename", { photoId: selected.id, name: e.target.value }); }} /></label>{selected.parentId && <button type="button" onClick={() => setSelectedId(selected.parentId!)}>查看上一版本</button>}{gallery.photos.some(p => p.parentId === selected.id) && <div className="photo-version-list"><strong>后续版本</strong>{gallery.photos.filter(p => p.parentId === selected.id).map(p => <button type="button" key={p.id} onClick={() => setSelectedId(p.id)}>{p.name} · {time(p.createdAt)}</button>)}</div>}{selected.generation && <details><summary>生成设置快照</summary><pre>{selected.generation.prompt}</pre><p>{selected.generation.styleSource} · {selected.generation.model.name}</p><button type="button" onClick={() => { patchDraft({ ...selected.generation!.draft, style: selected.generation!.stylePreset, count: 1 }); setSelectedId(""); setPane("generate"); }}>使用这些设置</button></details>}</section>
        : <><nav className="photo-filter-bar" aria-label="照片分类">{([["approved", "相册", formal.length], ["candidate", "候选", candidates.length], ["reference", "参考", gallery.photos.filter(p => p.status === "reference").length], ["archived", "历史", gallery.photos.filter(p => p.status === "archived").length]] as const).map(([key, label, count]) => <button type="button" key={key} aria-pressed={mode === key} className={mode === key ? "active" : ""} onClick={() => setMode(key)}>{label}<small>{count}</small></button>)}</nav><div className="photo-section-heading"><label className="photo-check"><input type="checkbox" checked={favoriteOnly} onChange={e => setFavoriteOnly(e.target.checked)} />只看收藏</label><div className="photo-inline-actions">{mode === "candidate" && Boolean(candidates.length) && <button type="button" disabled={Boolean(busy)} onClick={() => { if (window.confirm("将未收藏、未采用、未作为参考的候选移入历史？可以恢复。")) void run("cleanup"); }}>整理候选</button>}<button type="button" disabled={compareIds.length !== 2} onClick={() => { setComparing(true); setCompareSide(0); setZoom(1); }}>对比 {compareIds.length}/2</button></div></div>
          {mode === "candidate" && <p className="photo-muted">满意后加入相册或设为主图。候选不会自动同步到角色库。</p>}
          {mode === "reference" && <p className="photo-muted">参考照片用来保持人物一致；加入相册后才会参与角色库同步。</p>}
          {!visible.length && <div className="photo-empty"><span aria-hidden>▧</span><strong>{mode === "approved" ? "为人物建立照片相册" : "这里还没有照片"}</strong><p>{mode === "approved" ? "上传参考照片，或根据外貌生成定妆照片。满意后再加入相册。" : mode === "candidate" ? "生成结果会保留在这里，可以反复比较和调整。" : mode === "archived" ? "旧照片和版本会保留在历史中。" : "上传正面、侧面等照片，帮助模型保持人物一致。"}</p></div>}
          <div className="photo-grid">{visible.map((photo, index) => <Fragment key={photo.id}>{mode === "candidate" && (index === 0 || visible[index - 1].experimentId !== photo.experimentId) && <h4 className="photo-experiment-label">一组尝试 · {time(photo.createdAt)} <small>{photo.generation ? styleLabel(photo.generation.stylePreset) : ""}</small></h4>}<article className="photo-card"><button type="button" className="photo-card-preview" onClick={() => { setSelectedId(photo.id); setZoom(1); }}><img src={photoSrc(photo)} alt={photo.name} loading="lazy" />{gallery.coverId === photo.id && <span className="photo-badge">主图</span>}{photo.favorite && <span className="photo-favorite" aria-label="已收藏">★</span>}</button><div className="photo-card-caption"><strong title={photo.name}>{photo.name}</strong><small>{photo.generation ? `${styleLabel(photo.generation.stylePreset)} · ${time(photo.createdAt)}` : photo.source === "remote" ? "来自角色库" : "上传照片"}</small>{remoteLabel(photo) && <small className="photo-remote-status">{remoteLabel(photo)}</small>}<div className="photo-card-checks"><label className="photo-check"><input type="checkbox" aria-label={`对比 ${photo.name}`} checked={compareIds.includes(photo.id)} disabled={!compareIds.includes(photo.id) && compareIds.length >= 2} onChange={e => setCompareIds(current => e.target.checked ? [...current, photo.id] : current.filter(id => id !== photo.id))} />对比</label>{photo.status !== "archived" && <label className="photo-check"><input type="checkbox" aria-label={`参考 ${photo.name}`} checked={draft.referenceIds.includes(photo.id)} onChange={e => patchDraft({ referenceIds: e.target.checked ? [...draft.referenceIds, photo.id] : draft.referenceIds.filter(id => id !== photo.id) })} />参考</label>}</div>{mode === "approved" && <div className="photo-order"><button type="button" disabled={index === 0 || Boolean(busy) || favoriteOnly} aria-label={`前移 ${photo.name}`} onClick={() => { const ids = formal.map(p => p.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; void run("reorder", { ids }); }}>← 前移</button><button type="button" disabled={index === formal.length - 1 || Boolean(busy) || favoriteOnly} aria-label={`后移 ${photo.name}`} onClick={() => { const ids = formal.map(p => p.id); [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]; void run("reorder", { ids }); }}>后移 →</button></div>}</div></article></Fragment>)}</div>
          <details className="photo-sync-panel"><summary>图像角色库 {gallery.binding ? `· ${gallery.binding.name}` : "· 可选关联"}</summary><p className="photo-muted">正式相册可与图像服务的角色对应。当前连接支持读取角色与保存资产，角色成员、顺序和主图需在服务网站编辑后刷新确认。</p>{gallery.binding && <><p>{sync.pending ? `${sync.pending} 张待加入角色` : "照片成员已对齐"}{sync.cover ? " · 主图待对齐" : ""}{sync.order ? " · 顺序或移除待对齐" : ""}</p><small>上次确认：{time(gallery.binding.checkedAt)}</small><div className="photo-inline-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void run("refresh", {}, "已按角色库最新集合检查并更新照片。")}>刷新角色照片</button><button type="button" disabled={Boolean(busy)} onClick={() => void run("sync", {}, "正式照片资产已保存。请到图像服务中加入角色、调整主图和顺序，再回来刷新确认。")}>保存正式照片到图像服务</button><a href={(() => { try { const url = new URL(gallery.binding.baseUrl); url.hostname = url.hostname.replace(/^api\./, ""); return url.origin; } catch { return "#"; } })()} target="_blank" rel="noreferrer">打开图像服务网站 ↗</a><button type="button" disabled={Boolean(busy)} onClick={() => void run("unbind", {}, "已解除角色关联，照片仍保留。")}>解除关联</button></div></>}
            <label>图像服务<select aria-label="角色库图像服务" value={providerId} onChange={e => { setProviderId(e.target.value); setRemoteItems([]); setRemoteId(""); setCursor(""); }}><option value="">选择支持角色库的服务</option>{providers.filter(p => p.characterLibrary).map(p => <option value={p.id} key={p.id} disabled={!p.hasSecret}>{p.name}{p.hasSecret ? "" : "（需密钥）"}</option>)}</select></label>{!providers.some(p => p.characterLibrary) && <p className="photo-muted">先到 AI 服务设置中添加支持角色库的图像连接；上传和生成照片可以独立使用。</p>}<div className="photo-inline-actions"><button type="button" disabled={!providerId || remoteLoading} onClick={() => void loadRemote()}>{remoteLoading ? "读取中…" : "读取角色库"}</button>{cursor && <button type="button" disabled={remoteLoading} onClick={() => void loadRemote(true)}>加载更多角色</button>}</div>{remoteItems.length > 0 && <><label>选择角色<select aria-label="选择图像角色" value={remoteId} onChange={e => setRemoteId(e.target.value)}><option value="">请选择</option>{remoteItems.map(p => <option key={p.id} value={p.id}>{p.name}{p.count != null ? ` · ${p.count} 张` : ""}</option>)}</select></label><button type="button" disabled={!remoteId || Boolean(busy)} onClick={() => void run("refresh", { providerId, remoteCharacterId: remoteId }, "已关联并读取角色的完整照片集合。")}>关联并读取全部照片</button></>}</details>
        </>}
      </div>
      <aside className="photo-generator-pane" aria-label="生成角色照片"><div className="photo-section-heading"><h3>生成角色照片</h3><button type="button" className="photo-mobile-back" onClick={() => setPane("photos")}>返回照片</button></div><p className="photo-muted">参考人物资料中的年龄与外貌，每次只需调整你想改变的部分。</p><label>图像模型<select aria-label="角色照片图像模型" value={draft.modelId} onChange={e => patchDraft({ modelId: e.target.value, size: "", quality: "", resolution: "", aspectRatio: "" })}><option value="">选择图像模型</option>{models.map(m => <option key={m.id} value={m.id} disabled={!m.hasSecret}>{modelSelectionLabel(m)}{m.hasSecret ? "" : "（需密钥）"}</option>)}</select></label>{chosenModel && <div className="photo-model-resolution" role="status">{checkingModel ? "正在检测图片编辑版本…" : checkedModel?.error ? <><span className="photo-error">{checkedModel.error}</span><button type="button" onClick={() => setModelCheckAttempt(v => v + 1)}>重新检测</button></> : checkedModel?.resolution?.automaticEdit ? <>使用参考照片，已自动匹配图片编辑版：<strong>{checkedModel.resolution.model.name}</strong></> : checkedModel?.resolution?.editVersion && !hasReferences ? "已找到图片编辑版；选择参考照片后将自动使用。" : referenceCapability ? "支持参考照片" : "此模型目前可按文字要求生成照片。"}</div>}{!models.length && <p className="photo-muted">在 AI 服务设置中添加图像模型并刷新目录后即可生成。</p>}<label>画面要求<textarea aria-label="角色照片画面要求" rows={4} maxLength={8000} value={draft.prompt} onChange={e => patchDraft({ prompt: e.target.value })} placeholder="例如：保持五官不变，改为微笑，背景干净，穿浅色外套" /></label><div className="photo-form-row"><label>构图<select aria-label="角色照片构图" value={draft.pose} onChange={e => patchDraft({ pose: e.target.value })}>{["正面半身", "侧面半身", "全身", "面部特写", "自由构图"].map(p => <option key={p}>{p}</option>)}</select></label><label>本次风格<select aria-label="本次照片风格" value={draft.style === "follow" ? "follow" : resolveIllustrationStyle(draft.style, styles).value} onChange={e => patchDraft({ style: e.target.value as PhotoDraft["style"] })}><option value="follow">{gallery.stylePreset === "follow" ? "跟随文章" : "跟随人物"}</option>{styles.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label></div><div className="photo-style-status">{currentStyle.styleSource} · {styleLabel(currentStyle.stylePreset)}<button type="button" onClick={() => { patchDraft({ style: "follow" }); void run("style", { style: "follow" }); }}>使用最新文章风格</button></div>
        <div className="photo-reference-selection"><strong>本次参考 · {referenceCount}{referenceCapability?.maxImages ? ` / ${referenceCapability.maxImages}` : ""} 张</strong>{draft.basePhotoId && <div className="photo-selected-base">修改底图{gallery.photos.find(p => p.id === draft.basePhotoId) && <img src={photoSrc(gallery.photos.find(p => p.id === draft.basePhotoId)!)} alt="修改底图" />}<button type="button" onClick={() => patchDraft({ basePhotoId: "" })}>移除底图</button></div>}<div className="photo-reference-strip">{draft.referenceIds.map(id => { const p = gallery.photos.find(p => p.id === id); return p ? <button type="button" key={id} onClick={() => patchDraft({ referenceIds: draft.referenceIds.filter(x => x !== id) })} aria-label={`移除参考 ${p.name}`}><img src={photoSrc(p)} alt={p.name} /><span>×</span></button> : <button type="button" key={id} onClick={() => patchDraft({ referenceIds: draft.referenceIds.filter(x => x !== id) })}>移除缺失参考</button>; })}</div><div className="photo-inline-actions"><button type="button" onClick={() => patchDraft({ referenceIds: gallery.referenceIds })}>使用默认参考</button><button type="button" onClick={() => { setPane("photos"); setMode("reference"); }}>挑选参考照片</button></div><small>相册数量与参考上限分开；修改底图排在输入首位。</small>{referenceIssue && <p className="photo-error" role="status">{referenceIssue}</p>}</div>
        <details className="photo-advanced"><summary>风格与高级设置</summary><label>人物默认风格<select aria-label="人物默认照片风格" value={gallery.stylePreset === "follow" ? "follow" : resolveIllustrationStyle(gallery.stylePreset, styles).value} disabled={Boolean(busy)} onChange={e => void run("style", { style: e.target.value })}><option value="follow">跟随文章图像风格</option>{styles.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>{([ ["size", "尺寸"], ["quality", "画质"], ["aspectRatio", "比例"], ["resolution", "分辨率"] ] as const).map(([key, label]) => { const values = effectiveModel ? imageParameterValues(effectiveModel, key === "aspectRatio" ? "aspect_ratio" : key) : []; return values.length ? <label key={key}>{label}<select value={draft[key]} aria-label={`照片${label}`} onChange={e => patchDraft({ [key]: e.target.value, ...(key === "size" ? { aspectRatio: "", resolution: "" } : key === "aspectRatio" || key === "resolution" ? { size: "" } : {}) })}><option value="">模型默认</option>{values.map(v => <option key={v}>{v}</option>)}</select></label> : null; })}<label>本轮尝试数量<select aria-label="本轮照片数量" value={draft.count} onChange={e => patchDraft({ count: Number(e.target.value) })}><option value={1}>1 张</option><option value={2}>2 张</option><option value={4}>4 张</option></select></label><p className="photo-muted">每张分别提交并计费，部分失败不影响其他结果。图像服务支持报价时，提交前会核对报价。</p><button type="button" onClick={() => { patchDraft({ experimentId: crypto.randomUUID(), basePhotoId: "" }); setNotice("已开始新一组尝试，原候选与参数仍保留。"); }}>开始新一组尝试</button></details>
        <button className="photo-generate-button" type="button" disabled={!ready || !chosenModel?.hasSecret || checkingModel || Boolean(referenceIssue) || Boolean(busy)} onClick={() => void generate()}>{busy === "generate" ? "正在加入队列…" : `生成${draft.count > 1 ? ` ${draft.count} 张` : "照片"}`}</button>{attempts}
      </aside>
    </div>
    <footer className="photo-bottom-actions"><button type="button" disabled={Boolean(busy) || !ready} onClick={() => uploadRef.current?.click()}>{busy === "upload" ? "上传中…" : "上传参考照片"}</button><button type="button" className="primary" onClick={() => { setPane(pane === "generate" ? "photos" : "generate"); setSelectedId(""); setComparing(false); }}>{pane === "generate" ? "查看照片与候选" : `生成照片${jobs.filter(active).length ? ` · ${jobs.filter(active).length} 个进行中` : ""}`}</button></footer>
  </section>;
}
