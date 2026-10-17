import { isIllustrationStylePreset, type IllustrationStylePreset } from "./illustration-styles.ts";
import type { CharacterVisual } from "./character-visual.ts";

export type PhotoDraft = {
  prompt: string; modelId: string; pose: string; style: "follow" | IllustrationStylePreset;
  referenceIds: string[]; basePhotoId: string; experimentId: string;
  size: string; quality: string; aspectRatio: string; resolution: string; count: number;
};
export type PhotoSnapshot = {
  draft: PhotoDraft; prompt: string; stylePreset: IllustrationStylePreset; styleSource: string;
  person: { name: string; age: string; appearance: string };
  references: CharacterPhoto[]; basePhoto?: CharacterPhoto;
  model: { id: string; modelId: string; requestedModelId?: string; name: string; providerId: string; baseUrl: string; adapterKind: string; timeoutMs: number; metadata?: import("./ai-model-capabilities").ModelMetadata };
};
export type CharacterPhoto = {
  id: string; assetKey: string; mime: string; name: string; hash?: string; createdAt: string;
  source: "upload" | "generated" | "remote";
  status: "reference" | "candidate" | "approved" | "archived";
  favorite?: boolean; parentId?: string; experimentId?: string;
  generation?: Omit<PhotoSnapshot, "references" | "basePhoto"> & { referenceIds: string[]; basePhotoId?: string };
  librarySave?: { providerId: string; baseUrl: string; workspaceId: string; requestId: string; createdAt: string; source: { source: "upload"; fileId: string; name: string } | { source: "task_output"; taskId: string; index: number; name: string } };
  remote?: { providerId: string; baseUrl: string; workspaceId: string; assetId: string; uri: string; member: boolean };
};
export type CharacterPhotoGallery = {
  photos: CharacterPhoto[]; coverId: string; referenceIds: string[];
  stylePreset: "follow" | IllustrationStylePreset;
  draft: PhotoDraft;
  binding?: { providerId: string; baseUrl: string; workspaceId: string; characterId: string; name: string; order: string[]; coverId: string; checkedAt: string };
};
export type PhotoJob = {
  id: string; characterId: string; characterName: string; state: "queued" | "running" | "waiting" | "success" | "error" | "interrupted" | "cancelled";
  snapshot: PhotoSnapshot; createdAt: string; updatedAt: string; error: string; remoteTaskId?: string; photoId?: string; canResume?: boolean;
};
export const EMPTY_PHOTO_DRAFT: PhotoDraft = { prompt: "", modelId: "", pose: "正面半身", style: "follow", referenceIds: [], basePhotoId: "", experimentId: "", size: "", quality: "", aspectRatio: "", resolution: "", count: 1 };
export function normalizePhotoDraft(value: unknown): PhotoDraft {
  const raw = value && typeof value === "object" ? value as Partial<PhotoDraft> : {};
  const s = (key: keyof PhotoDraft, max = 200) => typeof raw[key] === "string" ? String(raw[key]).slice(0, max) : String(EMPTY_PHOTO_DRAFT[key] ?? "");
  return { prompt: s("prompt", 8000), modelId: s("modelId"), pose: s("pose"), style: isIllustrationStylePreset(raw.style) ? raw.style : "follow", referenceIds: Array.isArray(raw.referenceIds) ? [...new Set(raw.referenceIds.filter(id => typeof id === "string"))].slice(0, 100) : [], basePhotoId: s("basePhotoId"), experimentId: s("experimentId"), size: s("size"), quality: s("quality"), aspectRatio: s("aspectRatio"), resolution: s("resolution"), count: [1, 2, 4].includes(Number(raw.count)) ? Number(raw.count) : 1 };
}
export function normalizeCharacterPhotos(value: unknown): CharacterPhotoGallery | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as CharacterPhotoGallery;
  if (!Array.isArray(raw.photos)) return undefined;
  const seen = new Set<string>();
  const photos = raw.photos.slice(0, 2000).flatMap((p): CharacterPhoto[] => {
    if (!p || typeof p.id !== "string" || seen.has(p.id) || !/^illustrations\/[a-f0-9-]+$/.test(p.assetKey) || !["image/png", "image/jpeg", "image/webp"].includes(p.mime)) return [];
    seen.add(p.id);
    const { remote, generation } = p;
    return [{ id: p.id.slice(0, 200), assetKey: p.assetKey, mime: p.mime, name: String(p.name || "人物照片").slice(0, 200), createdAt: String(p.createdAt || ""), source: ["upload", "generated", "remote"].includes(p.source) ? p.source : "upload", status: ["reference", "candidate", "approved", "archived"].includes(p.status) ? p.status : "reference", favorite: Boolean(p.favorite), ...(typeof p.hash === "string" ? { hash: p.hash.slice(0, 100) } : {}), ...(p.parentId ? { parentId: String(p.parentId).slice(0, 200) } : {}), ...(p.experimentId ? { experimentId: String(p.experimentId).slice(0, 200) } : {}), ...(generation && typeof generation === "object" ? { generation } : {}), ...(p.librarySave && typeof p.librarySave.requestId === "string" && p.librarySave.source ? { librarySave: p.librarySave } : {}), ...(remote && typeof remote.providerId === "string" && typeof remote.workspaceId === "string" && typeof remote.baseUrl === "string" && /^spicy:\/\/a\/[\w-]+$/.test(remote.uri) ? { remote: { providerId: remote.providerId, baseUrl: remote.baseUrl, workspaceId: remote.workspaceId, assetId: String(remote.assetId), uri: remote.uri, member: Boolean(remote.member) } } : {}) }];
  });
  const ids = new Set(photos.map(p => p.id));
  const b = raw.binding;
  const binding = b && [b.providerId, b.baseUrl, b.workspaceId, b.characterId, b.name, b.checkedAt].every(x => typeof x === "string") && Array.isArray(b.order) ? { ...b, order: b.order.filter(x => typeof x === "string").slice(0, 100), coverId: String(b.coverId || "") } : undefined;
  return { photos, coverId: photos.some(p => p.id === raw.coverId && p.status === "approved") ? raw.coverId : photos.find(p => p.status === "approved")?.id || "", referenceIds: Array.isArray(raw.referenceIds) ? [...new Set(raw.referenceIds.filter(id => ids.has(id)))].slice(0, 100) : [], stylePreset: isIllustrationStylePreset(raw.stylePreset) ? raw.stylePreset : "follow", draft: normalizePhotoDraft(raw.draft), ...(binding ? { binding } : {}) };
}
export function characterPhotos(value?: CharacterPhotoGallery, legacy?: CharacterVisual): CharacterPhotoGallery {
  const gallery = normalizeCharacterPhotos(value);
  if (gallery) return gallery;
  const photos: CharacterPhoto[] = legacy?.images.map(p => ({ ...p, id: `remote-${p.id}`, source: "remote", status: "approved", createdAt: legacy.syncedAt, remote: { providerId: legacy.providerId, baseUrl: legacy.providerBaseUrl, workspaceId: legacy.workspaceId, assetId: p.id, uri: p.uri, member: true } })) || [];
  const referenceIds = photos.slice(0, 4).map(p => p.id);
  return { photos, coverId: photos.find(p => p.remote?.assetId === legacy?.coverAssetId)?.id || photos[0]?.id || "", referenceIds, stylePreset: "follow", draft: { ...EMPTY_PHOTO_DRAFT, referenceIds }, ...(legacy ? { binding: { providerId: legacy.providerId, baseUrl: legacy.providerBaseUrl, workspaceId: legacy.workspaceId, characterId: legacy.characterId, name: legacy.characterName, order: legacy.images.map(p => p.id), coverId: legacy.coverAssetId, checkedAt: legacy.syncedAt } } : {}) };
}
export function photoSrc(photo: Pick<CharacterPhoto, "assetKey">) { return `/api/ai/character-images/${photo.assetKey.split("/")[1]}`; }
export function photoStyle(draft: PhotoDraft, gallery: CharacterPhotoGallery, articleStyle: IllustrationStylePreset) {
  return draft.style !== "follow" ? { stylePreset: draft.style, styleSource: "本次指定" } : gallery.stylePreset !== "follow" ? { stylePreset: gallery.stylePreset, styleSource: "人物专属" } : { stylePreset: articleStyle, styleSource: "跟随文章" };
}
export function photoSyncStatus(g: CharacterPhotoGallery) {
  if (!g.binding) return { pending: 0, cover: false, order: false };
  const formal = g.photos.filter(p => p.status === "approved");
  const b = g.binding;
  const belongs = (p: CharacterPhoto) => p.remote?.providerId === b.providerId && p.remote?.baseUrl === b.baseUrl && p.remote?.workspaceId === b.workspaceId;
  const ids = formal.filter(belongs).map(p => p.remote!.assetId);
  return { pending: formal.filter(p => !belongs(p) || !b.order.includes(p.remote!.assetId)).length, cover: g.photos.find(p => p.id === g.coverId)?.remote?.assetId !== b.coverId, order: JSON.stringify(ids) !== JSON.stringify(b.order) };
}
