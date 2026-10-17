export type CharacterVisualImage = { id: string; uri: string; name: string; assetKey: string; mime: string };
export type CharacterVisual = {
  providerId: string;
  providerBaseUrl: string;
  workspaceId: string;
  characterId: string;
  characterName: string;
  coverAssetId: string;
  images: CharacterVisualImage[];
  syncedAt: string;
};
export type CharacterReference = { characterId: string; name: string; age: string; appearance: string; visual: CharacterVisual };
export function normalizeCharacterVisual(value: unknown): CharacterVisual | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.images) || !raw.images.length || raw.images.length > 8) return undefined;
  const string = (key: string, max = 300) => typeof raw[key] === "string" ? (raw[key] as string).slice(0, max) : "";
  const images = (Array.isArray(raw.images) ? raw.images : []).slice(0, 8).flatMap((value): CharacterVisualImage[] => {
    if (!value || typeof value !== "object") return [];
    const image = value as CharacterVisualImage;
    if (typeof image.id !== "string" || !/^spicy:\/\/a\/[\w-]+$/.test(image.uri) || !/^illustrations\/[a-f0-9-]+$/.test(image.assetKey) || !["image/png", "image/jpeg", "image/webp"].includes(image.mime)) return [];
    return [{ id: image.id.slice(0, 200), uri: image.uri, name: String(image.name || "参考图").slice(0, 200), assetKey: image.assetKey, mime: image.mime }];
  });
  if (!string("providerId") || !string("providerBaseUrl", 2000) || !string("workspaceId") || !string("characterId") || images.length !== raw.images.length || new Set(images.map(image => image.id)).size !== images.length) return undefined;
  return { providerId: string("providerId"), providerBaseUrl: string("providerBaseUrl", 2000), workspaceId: string("workspaceId"), characterId: string("characterId"), characterName: string("characterName"), coverAssetId: images.some(image => image.id === raw.coverAssetId) ? string("coverAssetId") : images[0].id, images, syncedAt: string("syncedAt") };
}
export function characterImageSrc(image: CharacterVisualImage) { return `/api/ai/character-images/${image.assetKey.split("/")[1]}`; }
export function characterCover(visual?: CharacterVisual) { return visual?.images.find(image => image.id === visual.coverAssetId) ?? visual?.images[0]; }
