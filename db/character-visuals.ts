import { AiInputError, findProvider, readProviderSecret } from "./ai";
import { readStudioState } from "./runtime";
import { deleteIllustrationAsset, readIllustrationAsset, saveIllustrationAsset } from "./illustration-assets";
import { getSpicyCharacter, getSpicyLibraryScope, isSpicyApi, spicyApiBaseUrl } from "@/lib/spicy-api";
import { normalizeCharacterVisual, type CharacterReference, type CharacterVisual, type CharacterVisualImage } from "@/lib/character-visual";
import { resolveOutlineSettings } from "@/lib/story-settings";

export async function spicyConnection(providerId: string) {
  const provider = await findProvider(providerId);
  if (!provider || !isSpicyApi(provider)) throw new AiInputError("请选择 SpicyAPI 服务连接");
  const secret = await readProviderSecret(provider.id);
  if (!secret) throw new AiInputError("此 SpicyAPI 连接尚未设置可用密钥");
  return { provider, secret };
}

export async function bindSpicyCharacter(input: { providerId?: unknown; characterId?: unknown; imageIds?: unknown; coverAssetId?: unknown }) {
  if (typeof input.providerId !== "string" || typeof input.characterId !== "string" || !Array.isArray(input.imageIds) || !input.imageIds.length || input.imageIds.length > 8 || input.imageIds.some(id => typeof id !== "string") || new Set(input.imageIds).size !== input.imageIds.length) throw new AiInputError("请选择角色及 1–8 张参考图");
  const { provider, secret } = await spicyConnection(input.providerId);
  const [remote, workspaceId] = await Promise.all([getSpicyCharacter(provider.baseUrl, secret, input.characterId), getSpicyLibraryScope(provider.baseUrl, secret)]);
  if (remote.kind !== "character" || remote.id !== input.characterId) throw new AiInputError("SpicyAPI 返回了无效角色");
  // Filter in the provider's order, never the checkbox click order.
  const ids = input.imageIds as string[];
  const selected = remote.assets?.filter(asset => ids.includes(asset.id)) ?? [];
  if (selected.length !== ids.length || selected.some(asset => !/^spicy:\/\/a\/[\w-]+$/.test(asset.uri) || !asset.previewUrl || (asset.kind && asset.kind !== "image"))) throw new AiInputError("所选角色图片已变化，请刷新后重新选择");
  const images: CharacterVisualImage[] = [];
  try {
    for (const asset of selected) {
      const saved = await saveIllustrationAsset(asset.previewUrl!);
      images.push({ id: asset.id, uri: asset.uri, name: asset.name || "参考图", assetKey: saved.key, mime: saved.mime });
    }
    const visual: CharacterVisual = { providerId: provider.id, providerBaseUrl: spicyApiBaseUrl(provider.baseUrl), workspaceId, characterId: remote.id, characterName: remote.name, coverAssetId: images.some(image => image.id === input.coverAssetId) ? String(input.coverAssetId) : images[0].id, images, syncedAt: new Date().toISOString() };
    return visual;
  } catch (error) { await Promise.allSettled(images.map(image => deleteIllustrationAsset(image.assetKey))); throw error; }
}

export async function illustrationCharacterReference(outlineId: string, characterId: unknown): Promise<CharacterReference | undefined> {
  if (characterId == null || characterId === "") return undefined;
  if (typeof characterId !== "string") throw new AiInputError("人物标识无效");
  const { data } = await readStudioState();
  const article = data?.articles.find(article => article.chapters.some(chapter => chapter.outlines.some(outline => outline.id === outlineId)));
  const chapter = article?.chapters.find(chapter => chapter.outlines.some(outline => outline.id === outlineId));
  const person = article?.characters.find(person => person.id === characterId && !person.archived);
  const visual = normalizeCharacterVisual(person?.visual);
  if (!article || !chapter || !person || !visual) throw new AiInputError("此人物尚未绑定可用的 SpicyAPI 形象，请到人物资料中绑定");
  const resolved = resolveOutlineSettings(article, outlineId).characters.find(item => item.id === person.id);
  if (resolved?.appears === false) throw new AiInputError("此人物在当前大纲中已设为不出场，请先修改设定");
  return { characterId: person.id, name: person.name, age: resolved?.profile.age ?? "", appearance: resolved?.profile.appearance ?? "", visual };
}

export async function validateCharacterReference(reference: CharacterReference, providerId: string) {
  const visual = normalizeCharacterVisual(reference.visual);
  if (!visual || visual.providerId !== providerId) throw new AiInputError("人物形象与图片模型必须使用同一个 SpicyAPI 服务连接");
  const connection = await spicyConnection(providerId);
  if (visual.providerBaseUrl !== spicyApiBaseUrl(connection.provider.baseUrl) || visual.workspaceId !== await getSpicyLibraryScope(connection.provider.baseUrl, connection.secret)) throw new AiInputError("SpicyAPI 连接的素材库已改变，请重新绑定人物形象");
  return visual.images.map(image => image.uri);
}

// A JSON export/sync carries the stable binding. Restore a missing local image
// lazily using a fresh provider URL; signed URLs never enter durable state.
export async function readCharacterImage(key: string) {
  const stored = await readIllustrationAsset(key);
  if (stored) {
    const bytes = stored instanceof Uint8Array ? stored : new Uint8Array(await new Response(stored).arrayBuffer());
    const mime = bytes[0] === 255 ? "image/jpeg" : bytes[0] === 82 ? "image/webp" : "image/png";
    return { bytes, mime };
  }
  const { data } = await readStudioState();
  const visuals = [
    ...data?.articles.flatMap(article => article.characters.flatMap(person => person.visual ? [person.visual] : [])) ?? [],
    ...data?.tasks.flatMap(task => task.contextOptions?.illustrationInput?.characterReference?.visual ? [task.contextOptions.illustrationInput.characterReference.visual] : []) ?? [],
  ];
  const visual = visuals.find(visual => visual.images.some(image => image.assetKey === key));
  const image = visual?.images.find(image => image.assetKey === key);
  if (!image) return null;
  let bytes = await readIllustrationAsset(key);
  if (!bytes && visual && image) {
    const { provider, secret } = await spicyConnection(visual.providerId);
    await validateCharacterReference({ characterId: "", name: "", age: "", appearance: "", visual }, provider.id);
    const { getSpicyAsset } = await import("@/lib/spicy-api");
    const remote = await getSpicyAsset(provider.baseUrl, secret, image.id);
    if (remote.uri !== image.uri || !remote.previewUrl) return null;
    await saveIllustrationAsset(remote.previewUrl, key);
    bytes = await readIllustrationAsset(key);
  }
  return bytes ? { bytes, mime: image?.mime ?? "image/png" } : null;
}
