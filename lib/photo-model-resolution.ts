import { imageParameterValues, imageReferenceCapability, supportsImages, type CatalogModel, type ModelMetadata } from "./ai-model-capabilities.ts";
import type { PhotoDraft } from "./character-photos.ts";

export type PhotoModelVersion = { modelId: string; name: string; metadata?: ModelMetadata };
export type PhotoModelResolution = {
  selectedId: string; requestedModelId: string; model: PhotoModelVersion;
  editVersion?: PhotoModelVersion; automaticEdit: boolean; checkedAt: string;
};

// The ID convention supplies a candidate, never permission to call it. Only a
// same-connection catalog entry with declared image input may become a match.
export function matchingPhotoEdit(modelId: string, catalog: CatalogModel[]) {
  const candidate = /\/text-to-image$/.test(modelId) ? modelId.replace(/\/text-to-image$/, "/edit") : /\/(edit|image-to-image)$/.test(modelId) ? modelId : `${modelId}/edit`;
  return catalog.find(entry => entry.id === candidate && supportsImages(entry) && imageReferenceCapability(entry));
}

export function selectPhotoModel(selected: PhotoModelVersion, catalog: CatalogModel[], useReferences: boolean) {
  const live = catalog.find(entry => entry.id === selected.modelId && supportsImages(entry));
  const current = live ? { modelId: live.id, name: live.name, metadata: live.metadata } : selected;
  const edit = matchingPhotoEdit(selected.modelId, catalog);
  const editVersion = edit ? { modelId: edit.id, name: edit.name, metadata: edit.metadata } : undefined;
  const model = useReferences && !imageReferenceCapability(current) && editVersion ? editVersion : current;
  return { model, ...(editVersion ? { editVersion } : {}), automaticEdit: model.modelId !== selected.modelId };
}

export function photoModelOptions(draft: PhotoDraft, model: PhotoModelVersion, automaticEdit: boolean): PhotoDraft {
  if (!automaticEdit) return draft;
  const next = { ...draft };
  const parameters = model.metadata?.supportedParameters;
  if (!parameters || Array.isArray(parameters)) return next;
  for (const key of ["size", "quality", "aspectRatio", "resolution"] as const) {
    const parameter = key === "aspectRatio" ? "aspect_ratio" : key;
    const values = imageParameterValues(model, parameter);
    if (next[key] && (!(parameter in parameters) || values.length > 0 && !values.includes(next[key]))) next[key] = "";
  }
  return next;
}
