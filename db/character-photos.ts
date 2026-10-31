import { normalizeTaskConcurrency } from "@/lib/task-concurrency";
import { resolvePhotoModel } from "./photo-model-resolution";
import { photoModelOptions } from "@/lib/photo-model-resolution";
import { ensureDatabase, getDatabase, readStudioState, applyStudioChanges } from "./studio-state";
import { isCloudDatabase } from "./sqlite";
import { findModel, readProviderSecret, type AiModelRecord } from "@/db/ai-models";
import { requestModelImage } from "@/db/ai-images";
import { readIllustrationAsset, saveIllustrationAsset, deleteIllustrationAsset } from "./illustration-assets";
import { spicyConnection } from "./character-visuals";
import { getSpicyCharacter, getSpicyLibraryScope, isSpicyApi, spicyApiBaseUrl, prepareSpicyPhoto, submitSpicyPhoto, querySpicyPhoto, uploadSpicyPhoto, saveSpicyPhoto } from "@/lib/spicy-api";
import { characterPhotos, normalizePhotoDraft, photoStyle, type CharacterPhoto, type CharacterPhotoGallery, type PhotoJob, type PhotoSnapshot } from "@/lib/character-photos";
import { illustrationVisualDirection, normalizeIllustrationStyles, resolveIllustrationStyle } from "@/lib/illustration-styles";
import { normalizeIllustrationOptions } from "@/lib/illustration-options";
import { imageReferenceCapability } from "@/lib/ai-model-capabilities";
import { diffStudioData } from "@/lib/studio-changes";
import { currentTaskExecutionOrigin } from "./task-execution";

type JobRow = { id: string; character_id: string; state: PhotoJob["state"]; snapshot_json: string; credential_hash: string; request_json: string | null; output_index: number; remote_task_id: string | null; error: string; photo_id: string | null; runner_id: string | null; lease_until: string | null; next_poll_at: string | null; created_at: string; updated_at: string };
const now = () => new Date().toISOString();
async function digest(bytes: Uint8Array | string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", (typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes) as BufferSource)), b => b.toString(16).padStart(2, "0")).join(""); }
function personIn(data: Awaited<ReturnType<typeof readStudioState>>["data"], id: string) {
  const article = data?.articles.find(a => a.characters.some(p => p.id === id));
  const person = article?.characters.find(p => p.id === id);
  if (!article || !person) throw new Error("人物不存在，请先保存人物资料");
  return { article, person };
}
export async function updatePhotoGallery(id: string, change: (gallery: CharacterPhotoGallery) => void) {
  for (let tries = 0; tries < 8; tries++) {
    const state = await readStudioState();
    const { person } = personIn(state.data, id);
    const next = structuredClone(state.data!);
    const target = personIn(next, id).person;
    const gallery = characterPhotos(person.photos, person.visual);
    change(gallery); target.photos = gallery;
    const result = await applyStudioChanges(diffStudioData(state.data!, next), state.revision);
    if (!result.conflict) return { gallery, revision: result.revision };
  }
  throw new Error("人物照片正在其他页面更新，请稍后重试");
}
export async function photoBytes(photo: Pick<CharacterPhoto, "assetKey">) {
  const value = await readIllustrationAsset(photo.assetKey);
  if (!value) {
    const { readCharacterImage } = await import("./character-visuals");
    const restored = await readCharacterImage(photo.assetKey);
    if (!restored) throw new Error("参考照片文件缺失，请重新上传或刷新角色库");
    return restored.bytes instanceof Uint8Array ? restored.bytes : new Uint8Array(await new Response(restored.bytes).arrayBuffer());
  }
  return value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
}
export function bytesDataUrl(bytes: Uint8Array, mime: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export async function uploadCharacterPhoto(id: string, dataUrl: string, name: string) {
  personIn((await readStudioState()).data, id);
  if (typeof dataUrl !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl) || dataUrl.length > 14_000_000) throw new Error("请上传 10 MB 以内的 PNG、JPEG 或 WebP 照片");
  const saved = await saveIllustrationAsset(dataUrl);
  let used = false;
  try {
    const hash = await digest(await photoBytes({ assetKey: saved.key }));
    const result = await updatePhotoGallery(id, g => {
      const duplicate = g.photos.find(p => p.hash === hash);
      if (duplicate) { if (duplicate.status === "archived") duplicate.status = "reference"; if (!g.referenceIds.includes(duplicate.id)) g.referenceIds.push(duplicate.id); return; }
      if (g.photos.length >= 2000) throw new Error("照片已达上限，请先整理历史照片");
      const photo: CharacterPhoto = { id: crypto.randomUUID(), assetKey: saved.key, mime: saved.mime, hash, name: String(name || "参考照片").slice(0, 200), createdAt: now(), source: "upload", status: "reference" };
      g.photos.push(photo); g.referenceIds.push(photo.id); used = true;
    });
    if (!used) await deleteIllustrationAsset(saved.key);
    return result;
  } catch (e) { if (!used) await deleteIllustrationAsset(saved.key); throw e; }
}
function publicJob(row: JobRow): PhotoJob {
  const snapshot = JSON.parse(row.snapshot_json) as PhotoSnapshot;
  return { id: row.id, characterId: row.character_id, characterName: snapshot.person.name, state: row.state, snapshot, createdAt: row.created_at, updatedAt: row.updated_at, error: row.error, canResume: isSpicyApi(snapshot.model) && Boolean(row.remote_task_id || row.request_json && Date.now() - Date.parse(row.created_at) < 23 * 3600000), ...(row.remote_task_id ? { remoteTaskId: row.remote_task_id } : {}), ...(row.photo_id ? { photoId: row.photo_id } : {}) };
}
export async function listPhotoJobs(characterId?: string) {
  await ensureDatabase();
  const rows = await getDatabase().prepare(`SELECT j.* FROM character_photo_jobs j JOIN characters c ON c.id=j.character_id ${characterId ? "WHERE j.character_id=?" : ""} ORDER BY j.created_at DESC,j.id LIMIT 200`).bind(...(characterId ? [characterId] : [])).all<JobRow>();
  return (rows.results || []).map(publicJob);
}
export async function photoOverview(id?: string) {
  const state = await readStudioState();
  const result = id ? personIn(state.data, id) : undefined;
  return { gallery: result ? characterPhotos(result.person.photos, result.person.visual) : undefined, jobs: await listPhotoJobs(id), revision: state.revision, backgroundMode: isCloudDatabase() ? "app" : "service" };
}
async function snapshotFor(id: string, draftValue: unknown) {
  const { data } = await readStudioState();
  const styles = normalizeIllustrationStyles(data?.settings.illustrationStyles);
  const { article, person } = personIn(data, id);
  if (person.archived) throw new Error("请先恢复此人物，再生成照片");
  const gallery = characterPhotos(person.photos, person.visual);
  let draft = normalizePhotoDraft(draftValue);
  if (!draft.prompt.trim() && !person.profile?.appearance.trim() && !draft.referenceIds.length && !draft.basePhotoId) throw new Error("请填写外貌、画面要求或上传参考照片");
  const references = draft.referenceIds.map(id => gallery.photos.find(p => p.id === id && p.status !== "archived"));
  const basePhoto = draft.basePhotoId ? gallery.photos.find(p => p.id === draft.basePhotoId && p.status !== "archived") : undefined;
  if (references.some(p => !p) || (draft.basePhotoId && !basePhoto)) throw new Error("参考照片已变化，请重新选择");
  const referenceCount = new Set([...references.map(p => p!.id), ...(basePhoto ? [basePhoto.id] : [])]).size;
  const { model, resolution } = await resolvePhotoModel(draft.modelId, referenceCount > 0);
  draft = photoModelOptions(draft, resolution.model, resolution.automaticEdit);
  const capability = imageReferenceCapability(model);
  if (referenceCount && !capability) throw new Error("此模型没有可用的参考图或 edit 版本，请选择其他图像模型");
  if (capability?.required && !referenceCount) throw new Error("此模型需要参考照片");
  if (capability?.maxImages && referenceCount > capability.maxImages) throw new Error(`此模型最多支持 ${capability.maxImages} 张参考图（包括修改底图）`);
  const style = photoStyle(draft, gallery, normalizeIllustrationOptions(article.illustrationSettings).stylePreset);
  style.stylePreset = resolveIllustrationStyle(style.stylePreset, styles).value;
  const personSnapshot = { name: person.name, age: person.profile?.age || "", appearance: person.profile?.appearance || "" };
  const prompt = [`人物定妆照片：${person.name}。年龄：${personSnapshot.age || "以参考照片为准"}。外貌：${personSnapshot.appearance || "以参考照片及画面要求为准"}。`, `构图：${draft.pose || "正面半身"}。${draft.prompt}`, referenceCount ? `${basePhoto ? "第一张图片是修改底图，" : ""}其余参考照片用于保持同一人物的脸型、五官和体态；只调整本次要求的内容。` : "", illustrationVisualDirection(style.stylePreset, "", styles), "单个人物，清晰完整，无文字、水印或拼图。"].filter(Boolean).join("\n");
  const snapshot: PhotoSnapshot = { draft: { ...draft, experimentId: draft.experimentId || crypto.randomUUID() }, ...style, prompt, person: personSnapshot, references: references as CharacterPhoto[], ...(basePhoto ? { basePhoto } : {}), model: { id: model.id, modelId: model.modelId, requestedModelId: resolution.requestedModelId, metadata: model.metadata, name: model.name, providerId: model.providerId, baseUrl: model.baseUrl, adapterKind: model.adapterKind, timeoutMs: model.timeoutMs } };
  return { snapshot, model };
}
export async function createPhotoJobs(id: string, requestId: string, draft: unknown, retryId?: string) {
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new Error("生成请求标识无效");
  const existing = (await listPhotoJobs(id)).filter(j => j.id.startsWith(requestId + "-"));
  if (existing.length) return existing;
  let snapshot: PhotoSnapshot;
  let model: AiModelRecord | null;
  if (retryId) {
    const original = await getDatabase().prepare("SELECT * FROM character_photo_jobs WHERE id=? AND character_id=?").bind(retryId, id).first<JobRow>();
    if (!original) throw new Error("原尝试不存在");
    snapshot = JSON.parse(original.snapshot_json);
    snapshot.draft.count = 1;
    model = await findModel(snapshot.model.id);
    if (!model || model.providerId !== snapshot.model.providerId || model.baseUrl !== snapshot.model.baseUrl || model.modelId !== (snapshot.model.requestedModelId || snapshot.model.modelId)) throw new Error("原模型连接已改变，请使用调整参数重新生成");
  } else ({ snapshot, model } = await snapshotFor(id, draft));
  const secret = await readProviderSecret(model!.providerId);
  if (!secret) throw new Error("图像服务尚未设置密钥");
  const hash = await digest(secret);
  const active = await getDatabase().prepare("SELECT COUNT(*) AS count FROM character_photo_jobs WHERE state IN ('queued','running','waiting')").first<number>("count");
  if (Number(active) + snapshot.draft.count > 30) throw new Error("图像队列已有 30 个任务，请等待部分任务完成");
  const timestamp = now();
  await getDatabase().batch(Array.from({ length: snapshot.draft.count }, (_, i) => getDatabase().prepare("INSERT OR IGNORE INTO character_photo_jobs(id,character_id,state,snapshot_json,credential_hash,created_at,updated_at) VALUES(?,?,'queued',?,?,?,?)").bind(`${requestId}-${i}`, id, JSON.stringify(snapshot), hash, timestamp, timestamp)));
  return (await listPhotoJobs(id)).filter(j => j.id.startsWith(requestId + "-"));
}
async function referenceInput(snapshot: PhotoSnapshot, secret: string) {
  const photos = [...(snapshot.basePhoto ? [snapshot.basePhoto] : []), ...snapshot.references].filter((p, index, list) => list.findIndex(q => q.id === p.id) === index);
  return photoReferenceImages(photos, snapshot.model, secret);
}
export async function photoReferenceImages(photos: CharacterPhoto[], model: { providerId?: string; id?: string; baseUrl: string; adapterKind: string }, secret: string) {
  const native = isSpicyApi(model);
  const providerId = model.providerId || model.id;
  const workspace = native && photos.some(p => p.remote?.providerId === providerId) ? await getSpicyLibraryScope(model.baseUrl, secret) : "";
  const result: string[] = [];
  for (const p of photos) {
    if (native && p.remote && p.remote.providerId === providerId && (p.remote.baseUrl !== spicyApiBaseUrl(model.baseUrl) || p.remote.workspaceId !== workspace)) throw new Error("参考照片所属素材库已改变，请重新关联角色库");
    if (native && p.remote && p.remote.providerId === providerId && p.remote.baseUrl === spicyApiBaseUrl(model.baseUrl) && p.remote.workspaceId === workspace) result.push(p.remote.uri);
    else {
      const bytes = await photoBytes(p);
      result.push(native ? (await uploadSpicyPhoto(model.baseUrl, secret, bytes, p.mime)).uri : bytesDataUrl(bytes, p.mime));
    }
  }
  return result;
}
export async function executePhotoJob(id: string) {
  await ensureDatabase();
  const db = getDatabase();
  const row = await db.prepare("SELECT * FROM character_photo_jobs WHERE id=?").bind(id).first<JobRow>();
  if (!row || ["success", "error", "interrupted", "cancelled"].includes(row.state)) return;
  const snapshot = JSON.parse(row.snapshot_json) as PhotoSnapshot;
  const runner = crypto.randomUUID();
  const timestamp = now();
  const state = await readStudioState();
  const capacity = normalizeTaskConcurrency(state.data?.settings.taskConcurrency);
  const lease = new Date(Date.now() + Math.max(snapshot.model.timeoutMs + 120000, 180000)).toISOString();
  const claimed = await db.prepare(`UPDATE character_photo_jobs SET state='running',runner_id=?,lease_until=?,updated_at=? WHERE id=? AND (state IN ('queued','waiting') OR (state='running' AND lease_until<?)) AND (next_poll_at IS NULL OR next_poll_at<=?)
    AND ((SELECT COUNT(*) FROM character_photo_jobs WHERE id<>? AND (state='waiting' OR (state='running' AND lease_until>?))) + (SELECT COUNT(*) FROM ai_tasks WHERE execution_origin=? AND target<>'chat' AND status='running' AND lease_until>?))<?`).bind(runner, lease, timestamp, id, timestamp, timestamp, id, timestamp, currentTaskExecutionOrigin(), timestamp, capacity).run();
  if (!Number(claimed.meta?.changes)) return;
  let remoteId = row.remote_task_id;
  let request = row.request_json ? JSON.parse(row.request_json) : null;
  let submitted = Boolean(request);
  let savedAssetKey: string | undefined;
  let photoSaved = false;
  const set = (status: string, error = "", delay = 0) => db.prepare("UPDATE character_photo_jobs SET state=?,error=?,runner_id=NULL,lease_until=NULL,next_poll_at=?,updated_at=? WHERE id=? AND runner_id=?").bind(status, error.slice(0, 1500), delay ? new Date(Date.now() + delay).toISOString() : null, now(), id, runner).run();
  try {
    personIn(state.data, row.character_id);
    const configured = await findModel(snapshot.model.id);
    const secret = await readProviderSecret(snapshot.model.providerId);
    if (!configured || configured.baseUrl !== snapshot.model.baseUrl || configured.modelId !== (snapshot.model.requestedModelId || snapshot.model.modelId) || configured.providerId !== snapshot.model.providerId || configured.adapterKind !== snapshot.model.adapterKind || !secret || await digest(secret) !== row.credential_hash) throw new Error("创建此任务的连接或密钥已改变，请恢复原连接再继续查询");
    const model = { ...configured, modelId: snapshot.model.modelId, name: snapshot.model.name, metadata: snapshot.model.metadata || configured.metadata };
    let src: string;
    if (isSpicyApi(snapshot.model)) {
      if (!request && !remoteId) {
        const referenceImages = await referenceInput(snapshot, secret);
        request = await prepareSpicyPhoto(snapshot.model.baseUrl, secret, snapshot.model.modelId, snapshot.prompt, { ...snapshot.draft, referenceImages });
        await db.prepare("UPDATE character_photo_jobs SET request_json=?,updated_at=? WHERE id=? AND runner_id=?").bind(JSON.stringify(request), now(), id, runner).run();
      }
      if (!remoteId && row.request_json && Date.now() - Date.parse(row.created_at) > 23 * 60 * 60 * 1000) throw new Error("原请求已超过安全重放期限，请先在图像服务核实任务，避免重复计费");
      submitted = true;
      const task = remoteId ? await querySpicyPhoto(snapshot.model.baseUrl, secret, remoteId) : await submitSpicyPhoto(snapshot.model.baseUrl, secret, request, id);
      remoteId = remoteId || task.taskId || null;
      if (!remoteId) throw new Error("服务未返回任务编号；保留原请求，继续查询将使用同一请求标识恢复");
      await db.prepare("UPDATE character_photo_jobs SET remote_task_id=?,updated_at=? WHERE id=? AND runner_id=?").bind(remoteId, now(), id, runner).run();
      if (["queued", "running"].includes(task.state || "") || task.output?.assets?.some(a => a.pending && !a.unavailable)) { await set("waiting", "", 5000); return; }
      if (task.state !== "succeeded") { await set("error", task.errorMessage || "远程图像任务失败"); return; }
      const output = task.output?.assets?.find(a => !a.pending && !a.unavailable && a.url && ["image/png", "image/jpeg", "image/webp"].includes(a.mime || ""));
      if (!output?.url) throw new Error("任务已完成但未返回可用图片，请稍后继续查询");
      await db.prepare("UPDATE character_photo_jobs SET output_index=? WHERE id=? AND runner_id=?").bind(task.output!.assets!.indexOf(output), id, runner).run();
      src = output.url;
    } else {
      if (row.state === "running" && request) throw new Error("上次请求已中断且此接口不支持任务查询，请先到服务商确认结果；重新生成可能再次计费");
      const referenceImages = await referenceInput(snapshot, secret);
      request = { dispatched: true };
      await db.prepare("UPDATE character_photo_jobs SET request_json=? WHERE id=? AND runner_id=?").bind(JSON.stringify(request), id, runner).run();
      submitted = true;
      const image = await requestModelImage(model, snapshot.prompt, { ...snapshot.draft, referenceImages });
      src = image.src;
    }
    const saved = await saveIllustrationAsset(src);
    savedAssetKey = saved.key;
    const photoId = `photo-${id}`;
    const hash = await digest(await photoBytes({ assetKey: saved.key }));
    const { references, basePhoto, ...generation } = snapshot;
    await updatePhotoGallery(row.character_id, g => {
      if (g.photos.some(p => p.id === photoId)) return;
      g.photos.push({ id: photoId, assetKey: saved.key, mime: saved.mime, hash, name: `${snapshot.person.name} · ${snapshot.draft.pose || "照片"} ${g.photos.filter(p => p.source === "generated").length + 1}`, createdAt: now(), source: "generated", status: "candidate", experimentId: snapshot.draft.experimentId, ...(basePhoto ? { parentId: basePhoto.id } : {}), generation: { ...generation, referenceIds: references.map(p => p.id), ...(basePhoto ? { basePhotoId: basePhoto.id } : {}) } });
    });
    photoSaved = true;
    await db.prepare("UPDATE character_photo_jobs SET state='success',photo_id=?,error='',runner_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND runner_id=?").bind(photoId, now(), id, runner).run();
  } catch (e) {
    if (savedAssetKey && !photoSaved) await deleteIllustrationAsset(savedAssetKey).catch(() => undefined);
    const error = e instanceof Error ? e.message : "图像生成失败";
    // Never start a fresh charged request as recovery. Known native jobs can
    // be queried again; uncertain submission keeps its exact request/key.
    await set(submitted || remoteId ? "interrupted" : "error", error);
  }
}
export async function dispatchPhotoJobs() {
  await ensureDatabase();
  const timestamp = now();
  const rows = await getDatabase().prepare("SELECT j.id FROM character_photo_jobs j JOIN characters c ON c.id=j.character_id WHERE j.state IN ('queued','waiting','running') AND (j.lease_until IS NULL OR j.lease_until<?) AND (j.next_poll_at IS NULL OR j.next_poll_at<=?) ORDER BY j.created_at LIMIT 5").bind(timestamp, timestamp).all<{ id: string }>();
  return rows.results?.map(r => r.id) || [];
}
export async function changePhotoJob(id: string, characterId: string, action: string) {
  await ensureDatabase();
  const row = await getDatabase().prepare("SELECT * FROM character_photo_jobs WHERE id=? AND character_id=?").bind(id, characterId).first<JobRow>();
  if (!row) throw new Error("尝试不存在");
  if (action === "cancel") {
    if (row.state !== "queued") throw new Error("已提交的图像任务无法在这里取消，请等待结果");
    await getDatabase().prepare("UPDATE character_photo_jobs SET state='cancelled',updated_at=? WHERE id=? AND state='queued'").bind(now(), id).run();
  } else if (action === "resume") {
    const snapshot = JSON.parse(row.snapshot_json) as PhotoSnapshot;
    if (!isSpicyApi(snapshot.model) || !["interrupted", "waiting"].includes(row.state)) throw new Error("此任务无法继续查询，请先核实服务商记录");
    await getDatabase().prepare("UPDATE character_photo_jobs SET state='waiting',next_poll_at=NULL,error='',updated_at=? WHERE id=?").bind(now(), id).run();
  } else throw new Error("未知操作");
}
export async function refreshCharacterLibrary(id: string, connection?: { providerId: string; characterId: string }) {
  const { person } = personIn((await readStudioState()).data, id);
  const gallery = characterPhotos(person.photos, person.visual);
  const binding = connection || gallery.binding;
  if (!binding) throw new Error("请先选择图像服务中的角色");
  const { provider, secret } = await spicyConnection(binding.providerId);
  const [remote, workspaceId] = await Promise.all([getSpicyCharacter(provider.baseUrl, secret, binding.characterId), getSpicyLibraryScope(provider.baseUrl, secret)]);
  const baseUrl = spicyApiBaseUrl(provider.baseUrl);
  if (!connection && (gallery.binding!.baseUrl !== baseUrl || gallery.binding!.workspaceId !== workspaceId)) throw new Error("角色库连接或工作区已改变，请重新选择角色");
  if (remote.kind !== "character" || remote.id !== binding.characterId || !Array.isArray(remote.assets) || remote.assets.length > 100 || remote.assets.some(a => !/^spicy:\/\/a\/[\w-]+$/.test(a.uri))) throw new Error("角色库返回的照片集合无效");
  const incoming: CharacterPhoto[] = [];
  const createdKeys: string[] = [];
  try {
    for (const asset of remote.assets) {
      const previous = gallery.photos.find(p => p.remote?.assetId === asset.id && p.remote.providerId === provider.id && p.remote.baseUrl === baseUrl && p.remote.workspaceId === workspaceId);
      if (previous) { incoming.push({ ...previous, remote: { ...previous.remote!, member: true } }); continue; }
      if (!asset.previewUrl || (asset.kind && asset.kind !== "image")) continue;
      const saved = await saveIllustrationAsset(asset.previewUrl);
      createdKeys.push(saved.key);
      const hash = await digest(await photoBytes({ assetKey: saved.key }));
      incoming.push({ id: crypto.randomUUID(), assetKey: saved.key, mime: saved.mime, hash, name: asset.name || "角色照片", createdAt: now(), source: "remote", status: "approved", remote: { providerId: provider.id, baseUrl, workspaceId, assetId: asset.id, uri: asset.uri, member: true } });
    }
    return await updatePhotoGallery(id, g => {
      const prior = g.binding;
      const same = prior?.providerId === provider.id && prior.characterId === remote.id && prior.workspaceId === workspaceId && prior.baseUrl === baseUrl;
      const localCover = g.photos.find(p => p.id === g.coverId);
      const followCover = !g.coverId || (same && localCover?.remote?.assetId === prior.coverId);
      const localOrder = g.photos.filter(p => p.status === "approved").map(p => p.remote?.assetId || p.id);
      const followOrder = !same || !prior.order.length || JSON.stringify(localOrder) === JSON.stringify(prior.order);
      for (const photo of incoming) {
        let current = g.photos.find(p => p.remote?.assetId === photo.remote!.assetId && p.remote.providerId === provider.id && p.remote.baseUrl === baseUrl && p.remote.workspaceId === workspaceId);
        if (!current) current = g.photos.find(p => p.hash && p.hash === photo.hash && !p.remote);
        if (current) { current.remote = photo.remote; if (current.status !== "archived" && current.status !== "approved") current.status = "approved";
          g.photos.filter(p => p.remote?.assetId === photo.remote!.assetId && p.remote.providerId === provider.id && p.remote.baseUrl === baseUrl && p.remote.workspaceId === workspaceId).forEach(p => { p.remote = photo.remote; });
        }
        else g.photos.push(photo);
      }
      const remoteIds = incoming.map(p => p.remote!.assetId);
      for (const p of g.photos) {
        if (p.remote?.providerId === provider.id && p.remote.baseUrl === baseUrl && p.remote.workspaceId === workspaceId && !remoteIds.includes(p.remote.assetId)) {
          if (p.source === "remote" && p.remote.member) p.status = "archived";
          p.remote.member = false;
        }
      }
      if (followOrder) {
        const rank = (p: CharacterPhoto) => p.status === "approved" && p.remote?.providerId === provider.id && remoteIds.includes(p.remote.assetId) ? remoteIds.indexOf(p.remote.assetId) : 1000;
        g.photos.sort((a, b) => rank(a) - rank(b));
      }
      const coverId = remote.cover?.id || incoming[0]?.remote?.assetId || "";
      if (followCover) g.coverId = g.photos.find(p => p.status === "approved" && p.remote?.assetId === coverId && p.remote.providerId === provider.id)?.id || g.photos.find(p => p.status === "approved")?.id || "";
      if (!g.referenceIds.length) g.referenceIds = g.photos.filter(p => p.status === "approved").slice(0, 4).map(p => p.id);
      g.binding = { providerId: provider.id, baseUrl, workspaceId, characterId: remote.id, name: remote.name, order: remoteIds, coverId, checkedAt: now() };
    });
  } catch (e) { await Promise.allSettled(createdKeys.map(key => deleteIllustrationAsset(key))); throw e; }
}
export async function saveFormalPhotosToLibrary(id: string) {
  const { person } = personIn((await readStudioState()).data, id);
  const g = characterPhotos(person.photos, person.visual);
  if (!g.binding) throw new Error("请先关联图像角色库");
  const b = g.binding;
  const { provider, secret } = await spicyConnection(b.providerId);
  if (spicyApiBaseUrl(provider.baseUrl) !== b.baseUrl || await getSpicyLibraryScope(provider.baseUrl, secret) !== b.workspaceId) throw new Error("角色库连接已改变，请重新关联");
  for (const p of g.photos.filter(p => p.status === "approved")) {
    if (p.remote?.providerId === provider.id && p.remote.baseUrl === b.baseUrl && p.remote.workspaceId === b.workspaceId) continue;
    let pending = p.librarySave;
    if (!pending || pending.providerId !== provider.id || pending.baseUrl !== b.baseUrl || pending.workspaceId !== b.workspaceId) {
      const job = await getDatabase().prepare("SELECT * FROM character_photo_jobs WHERE photo_id=? AND state='success'").bind(p.id).first<JobRow>();
      const model = job ? (JSON.parse(job.snapshot_json) as PhotoSnapshot).model : null;
      const source = job?.remote_task_id && model?.providerId === provider.id && spicyApiBaseUrl(model.baseUrl) === b.baseUrl && job.credential_hash === await digest(secret)
        ? { source: "task_output" as const, taskId: job.remote_task_id, index: job.output_index, name: p.name }
        : { source: "upload" as const, fileId: (await uploadSpicyPhoto(provider.baseUrl, secret, await photoBytes(p), p.mime)).fileId, name: p.name };
      pending = { providerId: provider.id, baseUrl: b.baseUrl, workspaceId: b.workspaceId, requestId: crypto.randomUUID(), createdAt: now(), source };
      const savedRequest = pending;
      await updatePhotoGallery(id, current => { const item = current.photos.find(x => x.id === p.id); if (item) item.librarySave = savedRequest; });
    }
    if (Date.now() - Date.parse(pending.createdAt) > 23 * 3600000) throw new Error("上次资产保存已超过恢复期限，请先在图像服务核实并刷新角色照片，避免重复保存");
    const asset = await saveSpicyPhoto(provider.baseUrl, secret, pending.source, pending.requestId);
    if (!/^spicy:\/\/a\/[\w-]+$/.test(asset.uri)) throw new Error("图像服务未返回永久资产引用");
    await updatePhotoGallery(id, current => { const item = current.photos.find(x => x.id === p.id); if (item) item.remote = { providerId: provider.id, baseUrl: b.baseUrl, workspaceId: b.workspaceId, assetId: asset.id, uri: asset.uri, member: false }; if (item) delete item.librarySave; });
  }
  return photoOverview(id);
}
