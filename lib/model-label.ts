export type ModelLabelSource = {
  providerName?: string | null;
  name?: string | null;
};

/** The user-facing identity used everywhere a configured AI model is shown. */
export function modelSelectionLabel(model: ModelLabelSource) {
  const providerName = String(model.providerName ?? "").trim();
  const modelName = String(model.name ?? "").trim();
  if (providerName && modelName) return `${providerName}-${modelName}`;
  return modelName || providerName;
}
