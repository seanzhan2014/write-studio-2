export type ModelTestResult = { ok: boolean; checkedAt: string; latencyMs: number; message: string };
export type ModelMetadata = {
  source: "provider" | "manual" | "legacy";
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters?: Record<string, unknown> | string[];
  contextLength?: number;
  tests?: Partial<Record<"text" | "image", ModelTestResult>>;
};
export type CatalogModel = { id: string; name: string; metadata: ModelMetadata };
export type ModelCatalog = { catalog: CatalogModel[]; syncedAt: string; warnings: string[] };
export type CapabilityModel = { metadata?: ModelMetadata | null };

export function normalizeModelMetadata(value: unknown): ModelMetadata {
  const raw = value && typeof value === "object" ? value as Partial<ModelMetadata> : {};
  const strings = (items: unknown) => Array.isArray(items) ? [...new Set(items.filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 40)))].slice(0, 16) : [];
  const source = raw.source === "provider" || raw.source === "manual" ? raw.source : "legacy";
  return {
    source,
    inputModalities: strings(raw.inputModalities), outputModalities: strings(raw.outputModalities),
    ...(raw.supportedParameters && typeof raw.supportedParameters === "object" ? { supportedParameters: raw.supportedParameters } : {}),
    ...(Number.isFinite(raw.contextLength) && Number(raw.contextLength) > 0 ? { contextLength: Number(raw.contextLength) } : {}),
    ...(raw.tests && typeof raw.tests === "object" ? { tests: raw.tests } : {}),
  };
}

// Existing configured models retain their text behavior until explicitly classified.
export function supportsText(model: CapabilityModel) {
  return !model.metadata || model.metadata.source === "legacy" || model.metadata.outputModalities.includes("text");
}
export function supportsImages(model: CapabilityModel) {
  return Boolean(model.metadata?.outputModalities.includes("image"));
}
export function manualModelMetadata(kind: "text" | "image" | "both"): ModelMetadata {
  return { source: "manual", inputModalities: ["text"], outputModalities: kind === "both" ? ["text", "image"] : [kind] };
}
export function catalogEntry(value: unknown): CatalogModel | null {
  const raw = typeof value === "string" ? { id: value } : value && typeof value === "object" ? value as Record<string, unknown> : {};
  const id = String(raw.id ?? raw.name ?? "").trim().slice(0, 300);
  if (!id) return null;
  const architecture = raw.architecture && typeof raw.architecture === "object" ? raw.architecture as Record<string, unknown> : {};
  return {
    id, name: String(raw.name ?? id).slice(0, 200),
    metadata: normalizeModelMetadata({ source: "provider", inputModalities: architecture.input_modalities, outputModalities: architecture.output_modalities, supportedParameters: raw.supported_parameters, contextLength: raw.context_length }),
  };
}

export function imageParameterValues(model: CapabilityModel, parameter: string): string[] {
  const parameters = model.metadata?.supportedParameters;
  if (!parameters || Array.isArray(parameters)) return [];
  const descriptor = parameters[parameter] as { values?: unknown } | undefined;
  return Array.isArray(descriptor?.values) ? descriptor.values.filter((v): v is string => typeof v === "string") : [];
}
