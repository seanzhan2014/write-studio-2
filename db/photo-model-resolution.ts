import { discoverProviderCatalog, findModel, findProvider, readProviderCatalog, type AiModelRecord } from "./ai";
import { isSpicyApi } from "@/lib/spicy-api";
import { imageReferenceCapability, supportsImages, type ModelCatalog } from "@/lib/ai-model-capabilities";
import { selectPhotoModel, type PhotoModelResolution } from "@/lib/photo-model-resolution";

const key = Symbol.for("writer-studio.photo-model-catalog-requests");
type Requests = Map<string, Promise<ModelCatalog>>;
function pending() {
  const global = globalThis as typeof globalThis & { [key]?: Requests };
  return global[key] ?? (global[key] = new Map());
}
async function catalogFor(model: AiModelRecord): Promise<ModelCatalog> {
  const provider = await findProvider(model.providerId);
  if (!provider) throw new Error("图像服务连接不存在");
  const cached = await readProviderCatalog(provider.id);
  const fresh = cached && Date.parse(cached.syncedAt) > Math.max(Date.now() - 5 * 60000, Date.parse(provider.updatedAt));
  if (fresh) return cached;
  const identity = `${provider.id}:${provider.baseUrl}:${provider.updatedAt}`;
  const requests = pending();
  if (requests.has(identity)) return requests.get(identity)!;
  const request = discoverProviderCatalog(provider.id);
  requests.set(identity, request);
  try { return await request; } finally { if (requests.get(identity) === request) requests.delete(identity); }
}

export async function resolvePhotoModel(id: string, useReferences: boolean): Promise<{ resolution: PhotoModelResolution; model: AiModelRecord }> {
  const selected = await findModel(id);
  if (!selected || !supportsImages(selected)) throw new Error("请选择支持图像生成的模型");
  // Native task services distinguish generation and edit by model ID. Other
  // adapters can use the same ID for both, so their declared input also works.
  const needsCatalog = isSpicyApi(selected) || !imageReferenceCapability(selected) || /\/(text-to-image|edit|image-to-image)$/.test(selected.modelId);
  let catalog: ModelCatalog | undefined;
  if (needsCatalog) {
    try { catalog = await catalogFor(selected); }
    catch (error) { if (isSpicyApi(selected) || useReferences) throw error; }
  }
  const choice = selectPhotoModel(selected, catalog?.catalog || [], useReferences);
  if (isSpicyApi(selected) && !catalog?.catalog.some(entry => entry.id === choice.model.modelId && supportsImages(entry))) throw new Error("所选图像模型当前不可用，请选择其他模型");
  const resolution: PhotoModelResolution = { selectedId: selected.id, requestedModelId: selected.modelId, ...choice, checkedAt: catalog?.syncedAt || new Date().toISOString() };
  return { resolution, model: { ...selected, modelId: choice.model.modelId, name: choice.model.name, metadata: choice.model.metadata } };
}
