import { catalogEntry, normalizeModelMetadata, type ModelMetadata, type ModelCatalog, type CatalogModel } from "@/lib/ai-model-capabilities";
import { validateImageParameters } from "@/lib/image-model-parameters";
import { discoverSpicyCatalog, isSpicyApi } from "@/lib/spicy-api";
import { discoverCivitaiCatalog, readCivitaiCatalogPage, findCivitaiModelByAir, isCivitai } from "@/lib/civitai-api";
import { normalizeReasoningEffort, reasoningEffortError, type ReasoningEffort } from "@/lib/reasoning-options";
import { ensureDatabase, getDatabase } from "@/db/studio-state";

import { normalizeMaxInputCharacters } from "@/lib/model-options";

import { decryptAiSecret, encryptAiSecret } from "@/lib/ai-secret";
import { modelSelectionLabel } from "@/lib/model-label";

import { readableNetworkError } from "@/db/ai-errors";

export type AiProviderRecord = {
  id: string;
  name: string;
  adapterKind: "openai-compatible" | "openrouter" | "spicyapi" | "civitai";
  baseUrl: string;
  timeoutMs: number;
  hasSecret: boolean;
  modelCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AiModelRecord = {
  metadata?: ModelMetadata;
  id: string;
  providerId: string;
  providerName: string;
  adapterKind: "openai-compatible" | "openrouter" | "spicyapi" | "civitai";
  name: string;
  baseUrl: string;
  modelId: string;
  systemPrompt: string;
  reasoningEffort: ReasoningEffort | null;
  temperature: number | null;
  maxOutput: number | null;
  maxInputCharacters: number;
  timeoutMs: number;
  providerTimeoutMs: number;
  timeoutOverrideMs: number | null;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AiModelSyncRecord = Omit<AiModelRecord, "hasSecret"> & {
  secret?: string;
};

export type AiProviderSyncRecord = Omit<AiProviderRecord, "hasSecret" | "modelCount"> & {
  secret?: string;
};

export async function readProviderSecret(id: string) {
  const row = await getDatabase().prepare("SELECT secret FROM ai_providers WHERE id=?").bind(id).first<Record<string, unknown>>();
  const stored = String(row?.secret ?? "");
  if (!stored) return "";
  try { return await decryptAiSecret(stored); } catch { return ""; }
}

export function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function modelConfigurationMetadata(value: unknown) {
  const metadata = normalizeModelMetadata(value);
  if (value && typeof value === "object" && "imageParameters" in value) metadata.imageParameters = validateImageParameters(value.imageParameters);
  delete metadata.tests; return metadata;
}

export function modelFromRow(row: Record<string, unknown>): AiModelRecord {
  const providerTimeoutMs = boundedNumber(row.provider_timeout_ms, 120000, 5000, 600000);
  const timeoutOverrideMs = row.timeout_override_ms == null ? null : boundedNumber(row.timeout_override_ms, providerTimeoutMs, 5000, 600000);
  return {
    id: String(row.id), providerId: String(row.provider_id), providerName: String(row.provider_name),
    metadata: normalizeModelMetadata(JSON.parse(String(row.metadata_json || "{}"))),
    adapterKind: providerAdapterKind(row.provider_adapter_kind), name: String(row.name), baseUrl: String(row.provider_base_url), modelId: String(row.model_id),
    systemPrompt: String(row.system_prompt), temperature: row.temperature == null ? null : Number(row.temperature),
    reasoningEffort: normalizeReasoningEffort(row.reasoning_effort),
    maxOutput: row.max_output == null ? null : Number(row.max_output), maxInputCharacters: normalizeMaxInputCharacters(row.max_input_characters),
    timeoutMs: timeoutOverrideMs ?? providerTimeoutMs, providerTimeoutMs, timeoutOverrideMs,
    hasSecret: Number(row.provider_has_secret) === 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function providerFromRow(row: Record<string, unknown>): AiProviderRecord {
  return {
    id: String(row.id), name: String(row.name), adapterKind: providerAdapterKind(row.adapter_kind),
    baseUrl: String(row.base_url), timeoutMs: boundedNumber(row.timeout_ms, 120000, 5000, 600000),
    hasSecret: Number(row.has_secret) === 1, modelCount: Number(row.model_count ?? 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function validateModelUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("模型地址只允许 HTTP 或 HTTPS");
  if (url.username || url.password) throw new Error("模型地址不能包含用户名或密码");
  return url.toString().replace(/\/$/, "");
}

export async function listModels() {
  await ensureDatabase();
  const result = await getDatabase().prepare(`SELECT m.*,p.name provider_name,p.adapter_kind provider_adapter_kind,
    p.base_url provider_base_url,p.timeout_ms provider_timeout_ms,p.has_secret provider_has_secret
    FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id ORDER BY m.created_at`).all<Record<string, unknown>>();
  return (result.results ?? []).map(modelFromRow);
}

export async function listProviders() {
  await ensureDatabase();
  const result = await getDatabase().prepare(`SELECT p.*,COUNT(m.id) model_count FROM ai_providers p
    LEFT JOIN ai_models m ON m.provider_id=p.id GROUP BY p.id ORDER BY p.created_at`).all<Record<string, unknown>>();
  return (result.results ?? []).map(providerFromRow);
}

export async function findProvider(id?: string) {
  const normalized = String(id ?? "").trim();
  if (!normalized) return null;
  return (await listProviders()).find((provider) => provider.id === normalized) ?? null;
}

export function providerNameFromUrl(value: string) {
  try { return new URL(value).host || "AI Provider"; } catch { return "AI Provider"; }
}

export function providerAdapterKind(value: unknown): AiProviderRecord["adapterKind"] {
  const normalized = String(value ?? "openai-compatible").trim();
  if (normalized !== "openai-compatible" && normalized !== "openrouter" && normalized !== "spicyapi" && normalized !== "civitai") throw new Error("暂不支持该 Provider 协议");
  return normalized;
}

export async function createProvider(input: Partial<AiProviderRecord> & { secret?: unknown }) {
  await ensureDatabase();
  const now = new Date().toISOString();
  const baseUrl = validateModelUrl(String(input.baseUrl ?? "https://api.openai.com/v1"));
  const secret = String(input.secret ?? "").trim();
  const storedSecret = secret ? await encryptAiSecret(secret) : null;
  const requestedId = String(input.id ?? "").trim();
  if (requestedId.length > 200) throw new Error("Provider ID 过长");
  const provider: AiProviderRecord = {
    id: requestedId || crypto.randomUUID(), name: String(input.name ?? providerNameFromUrl(baseUrl)).trim().slice(0, 80),
    adapterKind: providerAdapterKind(input.adapterKind), baseUrl,
    timeoutMs: boundedNumber(input.timeoutMs, 120000, 5000, 600000), hasSecret: Boolean(storedSecret), modelCount: 0,
    createdAt: now, updatedAt: now,
  };
  if (!provider.name) throw new Error("Provider 名称不能为空");
  await getDatabase().prepare("INSERT INTO ai_providers(id,name,adapter_kind,base_url,timeout_ms,has_secret,secret,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(provider.id, provider.name, provider.adapterKind, provider.baseUrl, provider.timeoutMs, provider.hasSecret ? 1 : 0, storedSecret, now, now).run();
  return provider;
}

export async function invalidateProviderDiagnostics(id: string) {
  await getDatabase().batch([
    getDatabase().prepare("DELETE FROM app_settings WHERE key=?").bind(`ai_catalog:${id}`),
    getDatabase().prepare("UPDATE ai_models SET metadata_json=json_remove(metadata_json,'$.tests') WHERE provider_id=?").bind(id),
  ]);
}

export async function updateProvider(id: string, input: Partial<AiProviderRecord>) {
  const existing = await findProvider(id);
  if (!existing) throw new Error("Provider 不存在");
  const updated: AiProviderRecord = {
    ...existing, id, name: String(input.name ?? existing.name).trim().slice(0, 80),
    adapterKind: providerAdapterKind(input.adapterKind ?? existing.adapterKind),
    baseUrl: input.baseUrl ? validateModelUrl(input.baseUrl) : existing.baseUrl,
    timeoutMs: boundedNumber(input.timeoutMs, existing.timeoutMs, 5000, 600000), updatedAt: new Date().toISOString(),
  };
  if (!updated.name) throw new Error("Provider 名称不能为空");
  await getDatabase().prepare("UPDATE ai_providers SET name=?,adapter_kind=?,base_url=?,timeout_ms=?,updated_at=? WHERE id=?")
    .bind(updated.name, updated.adapterKind, updated.baseUrl, updated.timeoutMs, updated.updatedAt, id).run();
  if (updated.baseUrl !== existing.baseUrl || updated.adapterKind !== existing.adapterKind) await invalidateProviderDiagnostics(id);
  return updated;
}

export async function deleteProvider(id: string) {
  const provider = await findProvider(id);
  if (!provider) throw new Error("Provider 不存在");
  if (provider.modelCount) throw new Error(`该 Provider 仍关联 ${provider.modelCount} 个模型，请先删除或移动这些模型`);
  await invalidateProviderDiagnostics(id);
  await getDatabase().prepare("DELETE FROM ai_providers WHERE id=?").bind(id).run();
}

export async function setProviderSecret(id: string, secret: string) {
  const provider = await findProvider(id);
  if (!provider) throw new Error("Provider 不存在");
  if (!secret.trim()) throw new Error("密钥不能为空");
  const stored = await encryptAiSecret(secret.trim());
  await invalidateProviderDiagnostics(id);
  await getDatabase().prepare("UPDATE ai_providers SET secret=?,has_secret=1,updated_at=? WHERE id=?").bind(stored, new Date().toISOString(), id).run();
}

export async function clearProviderSecret(id: string) {
  const provider = await findProvider(id);
  if (!provider) throw new Error("Provider 不存在");
  await invalidateProviderDiagnostics(id);
  await getDatabase().prepare("UPDATE ai_providers SET secret=NULL,has_secret=0,updated_at=? WHERE id=?").bind(new Date().toISOString(), id).run();
}

export async function exportModelsForSync(includeSecrets: boolean): Promise<AiModelSyncRecord[]> {
  const models = await listModels();
  return Promise.all(models.map(async (record) => {
    const model = { ...record, metadata: modelConfigurationMetadata(record.metadata) };
    Reflect.deleteProperty(model, "hasSecret");
    return {
      ...model,
      ...(includeSecrets ? { secret: await readProviderSecret(model.providerId) } : {}),
    };
  }));
}

export async function exportProvidersForSync(includeSecrets: boolean): Promise<AiProviderSyncRecord[]> {
  const providers = await listProviders();
  return Promise.all(providers.map(async (record) => {
    const provider = { ...record };
    Reflect.deleteProperty(provider, "hasSecret");
    Reflect.deleteProperty(provider, "modelCount");
    return {
      ...provider,
      ...(includeSecrets ? { secret: await readProviderSecret(provider.id) } : {}),
    };
  }));
}

export async function replaceModelsFromSync(records: AiModelSyncRecord[], includeSecrets: boolean, providerRecords?: AiProviderSyncRecord[]) {
  await ensureDatabase();
  if (!Array.isArray(records) || records.length > 100) throw new Error("同步模型配置无效或数量超过 100 个");
  const ids = new Set<string>();
  const db = getDatabase();
  const existingResult = await db.prepare("SELECT id,secret FROM ai_providers").all<Record<string, unknown>>();
  const existingSecrets = new Map((existingResult.results ?? []).map((row) => [String(row.id), String(row.secret ?? "")]));
  const providerIds = new Set<string>();
  const prepared = await Promise.all(records.map(async (record) => {
    const id = String(record.id ?? "").trim();
    if (!id || ids.has(id)) throw new Error("同步模型包含空 ID 或重复 ID");
    ids.add(id);
    const name = String(record.name ?? "").trim().slice(0, 80);
    const modelId = String(record.modelId ?? "").trim().slice(0, 300);
    if (!name || !modelId) throw new Error("同步模型名称和模型 ID 不能为空");
    const providerId = String(record.providerId ?? "").trim() || crypto.randomUUID();
    providerIds.add(providerId);
    const baseUrl = validateModelUrl(String(record.baseUrl ?? ""));
    const plainSecret = includeSecrets ? String(record.secret ?? "").trim() : "";
    const storedSecret = includeSecrets
      ? plainSecret ? await encryptAiSecret(plainSecret) : ""
      : existingSecrets.get(providerId) ?? "";
    return {
      id,
      metadata: normalizeModelMetadata(record.metadata),
      providerId,
      providerName: String(record.providerName ?? providerNameFromUrl(baseUrl)).trim().slice(0, 80),
      adapterKind: providerAdapterKind(record.adapterKind),
      name,
      baseUrl,
      modelId,
      systemPrompt: String(record.systemPrompt ?? "").slice(0, 20000),
      temperature: record.temperature == null ? null : boundedNumber(record.temperature, 1, 0, 2),
      maxOutput: record.maxOutput == null ? null : boundedNumber(record.maxOutput, 4096, 1, 1000000),
      reasoningEffort: normalizeReasoningEffort(record.reasoningEffort),
      maxInputCharacters: normalizeMaxInputCharacters(record.maxInputCharacters),
      providerTimeoutMs: boundedNumber(record.providerTimeoutMs ?? record.timeoutMs, 120000, 5000, 600000),
      timeoutOverrideMs: record.timeoutOverrideMs == null ? null : boundedNumber(record.timeoutOverrideMs, 120000, 5000, 600000),
      storedSecret,
      createdAt: String(record.createdAt ?? new Date().toISOString()),
      updatedAt: String(record.updatedAt ?? new Date().toISOString()),
    };
  }));
  const providers = providerRecords
    ? await Promise.all(providerRecords.map(async (provider) => {
      const providerId = String(provider.id ?? "").trim();
      if (!providerId) throw new Error("同步 Provider 包含空 ID");
      const plainSecret = includeSecrets ? String(provider.secret ?? "").trim() : "";
      return {
        providerId, providerName: String(provider.name ?? "").trim().slice(0, 80), adapterKind: providerAdapterKind(provider.adapterKind),
        baseUrl: validateModelUrl(String(provider.baseUrl ?? "")), providerTimeoutMs: boundedNumber(provider.timeoutMs, 120000, 5000, 600000),
        storedSecret: includeSecrets ? plainSecret ? await encryptAiSecret(plainSecret) : "" : existingSecrets.get(providerId) ?? "",
        createdAt: String(provider.createdAt ?? new Date().toISOString()), updatedAt: String(provider.updatedAt ?? new Date().toISOString()),
      };
    }))
    : [...providerIds].map((providerId) => prepared.find((model) => model.providerId === providerId)!);
  const syncedProviderIds = new Set(providers.map((provider) => provider.providerId));
  if (prepared.some((model) => !syncedProviderIds.has(model.providerId))) throw new Error("同步模型引用了不存在的 Provider");
  await db.batch([
    db.prepare("DELETE FROM ai_models"),
    db.prepare("DELETE FROM ai_providers"),
    ...providers.map((provider) => db.prepare("INSERT INTO ai_providers(id,name,adapter_kind,base_url,timeout_ms,has_secret,secret,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(provider.providerId, provider.providerName, provider.adapterKind, provider.baseUrl, provider.providerTimeoutMs, provider.storedSecret ? 1 : 0, provider.storedSecret || null, provider.createdAt, provider.updatedAt)),
    ...prepared.map((model) => db.prepare("INSERT INTO ai_models(id,provider_id,name,base_url,model_id,system_prompt,temperature,max_output,max_input_characters,timeout_ms,timeout_override_ms,has_secret,secret,created_at,updated_at,reasoning_effort,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(model.id, model.providerId, model.name, model.baseUrl, model.modelId, model.systemPrompt, model.temperature, model.maxOutput, model.maxInputCharacters, model.timeoutOverrideMs ?? model.providerTimeoutMs, model.timeoutOverrideMs, 0, null, model.createdAt, model.updatedAt, model.reasoningEffort, JSON.stringify(model.metadata ?? {}))),
  ]);
  return { models: prepared.length, secretsReplaced: includeSecrets };
}

export async function findModel(reference?: string) {
  const models = await listModels();
  const normalized = String(reference ?? "").trim();
  if (!normalized) return null;
  return models.find((model) => model.id === normalized || model.name === normalized || modelSelectionLabel(model) === normalized) ?? null;
}

export async function legacyProvider(input: { providerId?: unknown; baseUrl?: unknown; secret?: unknown; timeoutMs?: unknown }, sourceModel?: AiModelRecord | null) {
  const providerId = String(input.providerId ?? sourceModel?.providerId ?? "").trim();
  if (providerId) {
    const provider = await findProvider(providerId);
    if (!provider) throw new Error("Provider 不存在");
    return provider;
  }
  const baseUrl = validateModelUrl(String(input.baseUrl ?? sourceModel?.baseUrl ?? "https://api.openai.com/v1"));
  const secret = String(input.secret ?? "").trim();
  for (const provider of (await listProviders()).filter((candidate) => candidate.baseUrl === baseUrl)) {
    const existingSecret = await readProviderSecret(provider.id);
    if (secret ? existingSecret === secret : !existingSecret) return provider;
  }
  return createProvider({ name: providerNameFromUrl(baseUrl), baseUrl, timeoutMs: boundedNumber(input.timeoutMs, 120000, 5000, 600000), secret });
}

export function modelNameSuffix(value: string) {
  const normalized = value.trim();
  const slash = normalized.lastIndexOf("/");
  return (slash >= 0 ? normalized.slice(slash + 1) : normalized) || normalized;
}

export async function createModels(input: {
  name?: unknown;
  appendModelIdToName?: unknown;
  baseUrl?: unknown;
  providerId?: unknown;
  existingModelId?: unknown;
  modelIds?: unknown;
  metadataByModelId?: Record<string, ModelMetadata>;
  metadata?: ModelMetadata;
  secret?: unknown;
  systemPrompt?: unknown;
  reasoningEffort?: unknown;
  temperature?: unknown;
  maxOutput?: unknown;
  maxInputCharacters?: unknown;
  timeoutMs?: unknown;
}) {
  const effortError = reasoningEffortError(input.reasoningEffort);
  if (effortError) throw new Error(effortError);
  const requestedIds = Array.isArray(input.modelIds)
    ? [...new Set(input.modelIds.map((value) => String(value).trim().slice(0, 300)).filter(Boolean))]
    : [];
  if (!requestedIds.length) throw new Error("请至少选择一个模型");
  if (requestedIds.length > 100) throw new Error("一次最多保存 100 个模型");

  const existingModelId = String(input.existingModelId ?? "").trim();
  const sourceModel = existingModelId ? await findModel(existingModelId) : null;
  if (existingModelId && (!sourceModel || sourceModel.id !== existingModelId)) throw new Error("用于复用配置的模型不存在");
  const provider = await legacyProvider(input, sourceModel);
  const baseUrl = provider.baseUrl;
  const existing = await listModels();
  const existingKeys = new Set(existing.map((model) => `${model.providerId}\n${model.modelId}`));
  const skippedModelIds = requestedIds.filter((modelId) => existingKeys.has(`${provider.id}\n${modelId}`));
  const modelIds = requestedIds.filter((modelId) => !existingKeys.has(`${provider.id}\n${modelId}`));
  if (!modelIds.length) return { models: [] as AiModelRecord[], skippedModelIds };

  const now = new Date().toISOString();
  const prefix = String(input.name ?? "").trim().slice(0, 80);
  const appendModelIdToName = Boolean(input.appendModelIdToName);
  const systemPrompt = String(input.systemPrompt ?? "").slice(0, 20000);
  const temperature = input.temperature == null ? null : boundedNumber(input.temperature, 1, 0, 2);
  const maxOutput = input.maxOutput == null ? null : boundedNumber(input.maxOutput, 4096, 1, 1000000);
  const maxInputCharacters = normalizeMaxInputCharacters(input.maxInputCharacters ?? sourceModel?.maxInputCharacters);
  const timeoutOverrideMs = input.timeoutMs == null ? sourceModel?.timeoutOverrideMs ?? null : boundedNumber(input.timeoutMs, provider.timeoutMs, 5000, 600000);
  const models: AiModelRecord[] = modelIds.map((modelId) => ({
    metadata: modelConfigurationMetadata(input.metadataByModelId?.[modelId] ?? input.metadata ?? sourceModel?.metadata),
    id: crypto.randomUUID(),
    providerId: provider.id,
    providerName: provider.name,
    adapterKind: provider.adapterKind,
    name: (modelIds.length === 1 && prefix && !appendModelIdToName ? prefix : prefix ? `${prefix} · ${modelNameSuffix(modelId)}` : modelNameSuffix(modelId)).slice(0, 80),
    baseUrl,
    modelId,
    systemPrompt,
    temperature,
    reasoningEffort: normalizeReasoningEffort(input.reasoningEffort === undefined ? sourceModel?.reasoningEffort : input.reasoningEffort),
    maxOutput,
    maxInputCharacters,
    timeoutMs: timeoutOverrideMs ?? provider.timeoutMs,
    providerTimeoutMs: provider.timeoutMs,
    timeoutOverrideMs,
    hasSecret: provider.hasSecret,
    createdAt: now,
    updatedAt: now,
  }));
  for (const model of models) validateImageParameters(model.metadata?.imageParameters, model);
  await getDatabase().batch(models.map((model) => getDatabase().prepare("INSERT INTO ai_models(id,provider_id,name,base_url,model_id,system_prompt,temperature,max_output,max_input_characters,timeout_ms,timeout_override_ms,has_secret,secret,created_at,updated_at,reasoning_effort,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(model.id, model.providerId, model.name, model.baseUrl, model.modelId, model.systemPrompt, model.temperature, model.maxOutput, model.maxInputCharacters, model.timeoutMs, model.timeoutOverrideMs, 0, null, now, now, model.reasoningEffort, JSON.stringify(model.metadata ?? {}))));
  return { models, skippedModelIds };
}

export async function createModel(input: Partial<AiModelRecord> & { secret?: unknown }) {
  const effortError = reasoningEffortError(input.reasoningEffort);
  if (effortError) throw new Error(effortError);
  const now = new Date().toISOString();
  const provider = await legacyProvider(input);
  const timeoutOverrideMs = input.timeoutOverrideMs !== undefined
    ? input.timeoutOverrideMs == null ? null : boundedNumber(input.timeoutOverrideMs, provider.timeoutMs, 5000, 600000)
    : input.timeoutMs == null ? null : boundedNumber(input.timeoutMs, provider.timeoutMs, 5000, 600000);
  const model: AiModelRecord = {
    metadata: modelConfigurationMetadata(input.metadata),
    id: crypto.randomUUID(), providerId: provider.id, providerName: provider.name, adapterKind: provider.adapterKind,
    name: String(input.name ?? "未命名模型").trim().slice(0, 80), baseUrl: provider.baseUrl,
    modelId: String(input.modelId ?? "").trim(), systemPrompt: String(input.systemPrompt ?? ""),
    temperature: input.temperature == null ? null : boundedNumber(input.temperature, 1, 0, 2),
    maxOutput: input.maxOutput == null ? null : boundedNumber(input.maxOutput, 4096, 1, 1000000),
    reasoningEffort: normalizeReasoningEffort(input.reasoningEffort),
    maxInputCharacters: normalizeMaxInputCharacters(input.maxInputCharacters),
    timeoutMs: timeoutOverrideMs ?? provider.timeoutMs, providerTimeoutMs: provider.timeoutMs, timeoutOverrideMs, hasSecret: provider.hasSecret,
    createdAt: now, updatedAt: now,
  };
  if (!model.name || !model.modelId) throw new Error("模型名称和模型 ID 不能为空");
  validateImageParameters(model.metadata?.imageParameters, model);
  await ensureDatabase();
  await getDatabase().prepare("INSERT INTO ai_models(id,provider_id,name,base_url,model_id,system_prompt,temperature,max_output,max_input_characters,timeout_ms,timeout_override_ms,has_secret,secret,created_at,updated_at,reasoning_effort,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(model.id, model.providerId, model.name, model.baseUrl, model.modelId, model.systemPrompt, model.temperature, model.maxOutput, model.maxInputCharacters, model.timeoutMs, model.timeoutOverrideMs, 0, null, now, now, model.reasoningEffort, JSON.stringify(model.metadata ?? {})).run();
  return model;
}

export async function updateModel(id: string, input: Partial<AiModelRecord>) {
  const effortError = reasoningEffortError(input.reasoningEffort);
  if (effortError) throw new Error(effortError);
  const existing = await findModel(id);
  if (!existing || existing.id !== id) throw new Error("模型不存在");
  const provider = input.providerId && input.providerId !== existing.providerId
    ? await findProvider(input.providerId)
    : input.baseUrl && validateModelUrl(input.baseUrl) !== existing.baseUrl
      ? await legacyProvider({ baseUrl: input.baseUrl })
      : await findProvider(existing.providerId);
  if (!provider) throw new Error("Provider 不存在");
  const timeoutOverrideMs = input.timeoutOverrideMs !== undefined
    ? input.timeoutOverrideMs == null ? null : boundedNumber(input.timeoutOverrideMs, provider.timeoutMs, 5000, 600000)
    : input.timeoutMs !== undefined ? boundedNumber(input.timeoutMs, provider.timeoutMs, 5000, 600000) : existing.timeoutOverrideMs;
  const updated: AiModelRecord = {
    ...existing, ...input, id,
    metadata: { ...modelConfigurationMetadata(input.metadata ?? existing.metadata), tests: existing.metadata?.tests },
    providerId: provider.id, providerName: provider.name, adapterKind: provider.adapterKind, baseUrl: provider.baseUrl,
    name: String(input.name ?? existing.name).trim().slice(0, 80),
    modelId: String(input.modelId ?? existing.modelId).trim(),
    reasoningEffort: input.reasoningEffort === undefined ? existing.reasoningEffort : normalizeReasoningEffort(input.reasoningEffort),
    systemPrompt: String(input.systemPrompt ?? existing.systemPrompt).slice(0, 20000),
    temperature: input.temperature == null ? existing.temperature : boundedNumber(input.temperature, existing.temperature ?? 1, 0, 2),
    maxOutput: input.maxOutput == null ? existing.maxOutput : boundedNumber(input.maxOutput, existing.maxOutput ?? 4096, 1, 1000000),
    maxInputCharacters: input.maxInputCharacters == null ? existing.maxInputCharacters : normalizeMaxInputCharacters(input.maxInputCharacters, existing.maxInputCharacters),
    timeoutMs: timeoutOverrideMs ?? provider.timeoutMs, providerTimeoutMs: provider.timeoutMs, timeoutOverrideMs,
    updatedAt: new Date().toISOString(), hasSecret: provider.hasSecret,
  };
  if (!updated.name || !updated.modelId) throw new Error("模型名称和模型 ID 不能为空");
  validateImageParameters(updated.metadata?.imageParameters, updated);
  if (updated.providerId !== existing.providerId || updated.modelId !== existing.modelId || JSON.stringify(updated.metadata?.outputModalities) !== JSON.stringify(existing.metadata?.outputModalities)) {
    updated.metadata = { ...normalizeModelMetadata(updated.metadata), tests: {} };
  }
  if (JSON.stringify(updated.metadata?.imageParameters ?? {}) !== JSON.stringify(existing.metadata?.imageParameters ?? {})) {
    updated.metadata = { ...updated.metadata!, tests: { ...updated.metadata?.tests } };
    delete updated.metadata.tests!.image;
  }
  await getDatabase().prepare("UPDATE ai_models SET provider_id=?,name=?,base_url=?,model_id=?,system_prompt=?,temperature=?,max_output=?,max_input_characters=?,timeout_ms=?,timeout_override_ms=?,has_secret=0,secret=NULL,updated_at=?,reasoning_effort=?,metadata_json=? WHERE id=?")
    .bind(updated.providerId, updated.name, updated.baseUrl, updated.modelId, updated.systemPrompt, updated.temperature, updated.maxOutput, updated.maxInputCharacters, updated.timeoutMs, updated.timeoutOverrideMs, updated.updatedAt, updated.reasoningEffort, JSON.stringify(updated.metadata ?? {}), id).run();
  return updated;
}

export async function deleteModel(id: string) {
  await ensureDatabase();
  await getDatabase().prepare("DELETE FROM ai_models WHERE id=?").bind(id).run();
}

export async function deleteModels(input: { providerId?: unknown; ids?: unknown }) {
  if (!input || typeof input.providerId !== "string" || !input.providerId.trim()) throw new Error("请选择服务连接");
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.some((id) => typeof id !== "string" || !id.trim())) throw new Error("请选择要删除的模型");
  const provider = await findProvider(input.providerId);
  if (!provider) throw new Error("Provider 不存在");
  const ids = [...new Set(input.ids as string[])];
  const result = await getDatabase().prepare("DELETE FROM ai_models WHERE provider_id=? AND id IN (SELECT value FROM json_each(?)) RETURNING id")
    .bind(provider.id, JSON.stringify(ids)).all<{ id: string }>();
  return { deletedIds: (result.results ?? []).map((model) => model.id) };
}

export async function setModelSecret(id: string, secret: string) {
  const model = await findModel(id);
  if (!model || model.id !== id) throw new Error("模型不存在");
  await setProviderSecret(model.providerId, secret);
}

export async function clearModelSecret(id: string) {
  const model = await findModel(id);
  if (!model || model.id !== id) throw new Error("模型不存在");
  await clearProviderSecret(model.providerId);
}

export function isOpenRouter(provider: { adapterKind?: string; baseUrl: string }) {
  return provider.adapterKind === "openrouter" || new URL(provider.baseUrl).hostname === "openrouter.ai";
}

export async function discoverConnection(baseUrl: string, secret: string, openRouter = false): Promise<ModelCatalog> {
  if (isCivitai({ baseUrl })) return discoverCivitaiCatalog(baseUrl, secret);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), 15000);
  const warnings: string[] = [];
  async function request(path: string) {
    const response = await fetch(baseUrl.replace(/\/$/, "") + path, { signal: controller.signal, headers: secret ? { Authorization: `Bearer ${secret}` } : undefined });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").split(secret || "\0").join("[REDACTED]");
      throw new Error(`获取模型目录失败（${response.status}）：${detail || response.statusText}`);
    }
    const raw = await response.text();
    if (raw.length > 5_000_000) throw new Error("模型目录响应过大");
    const payload = JSON.parse(raw) as { data?: unknown[]; models?: unknown[] };
    return (Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : []).map(catalogEntry).filter((entry): entry is CatalogModel => entry !== null);
  }
  try {
    const entries = await request(openRouter ? "/models?output_modalities=all" : "/models");
    if (openRouter) {
      try {
        const images = await request("/images/models");
        for (const image of images) { const index = entries.findIndex((entry) => entry.id === image.id); if (index >= 0) { const previous = entries[index]; entries[index] = { ...image, metadata: { ...previous.metadata, ...image.metadata, inputModalities: [...new Set([...previous.metadata.inputModalities, ...image.metadata.inputModalities])], outputModalities: [...new Set([...previous.metadata.outputModalities, ...image.metadata.outputModalities])] } }; } else entries.push(image); }
      } catch (error) { warnings.push(error instanceof Error ? error.message : "图像目录暂时无法获取"); }
    }
    const catalog = [...new Map(entries.map((entry) => [entry.id, entry])).values()].sort((a,b) => a.id.localeCompare(b.id));
    if (!catalog.length) throw new Error("接口没有返回可选择的模型，可使用手动添加");
    return { catalog, syncedAt: new Date().toISOString(), warnings };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("获取模型目录超时");
    if (error instanceof SyntaxError) throw new Error("模型目录不是有效 JSON");
    throw readableNetworkError(error, "获取模型目录");
  } finally { clearTimeout(timeout); }
}

export async function readProviderCatalog(id: string): Promise<ModelCatalog | null> {
  if (!await findProvider(id)) throw new Error("服务连接不存在");
  const row = await getDatabase().prepare("SELECT value_json FROM app_settings WHERE key=?").bind(`ai_catalog:${id}`).first<{ value_json: string }>();
  if (!row) return null;
  try { return JSON.parse(row.value_json) as ModelCatalog; } catch { return null; }
}

export async function discoverProviderCatalog(id: string) {
  const provider = await findProvider(id);
  if (!provider) throw new Error("服务连接不存在");
  const secret = await readProviderSecret(id);
  const result = isCivitai(provider) ? await discoverCivitaiCatalog(provider.baseUrl, secret) : isSpicyApi(provider) ? await discoverSpicyCatalog(provider.baseUrl, secret) : await discoverConnection(provider.baseUrl, secret, isOpenRouter(provider));
  await getDatabase().prepare("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)").bind(`ai_catalog:${id}`, JSON.stringify(result), result.syncedAt).run();
  return result;
}

export async function discoverProviderModelIds(id: string) { return (await discoverProviderCatalog(id)).catalog.map((entry) => entry.id); }

export async function readProviderCatalogPage(id: string, cursor?: string | null, signal?: AbortSignal, hint?: string, air?: string) {
  const provider = await findProvider(id);
  if (!provider) throw new Error("服务连接不存在");
  if (!isCivitai(provider)) throw new Error("此服务连接不支持完整目录分页搜索");
  const secret = await readProviderSecret(id);
  return air !== undefined ? findCivitaiModelByAir(provider.baseUrl, secret, air, signal) : readCivitaiCatalogPage(provider.baseUrl, secret, cursor, signal, hint);
}

export async function testProvider(id: string) {
  const started = Date.now();
  const models = await discoverProviderModelIds(id);
  return { ok: true, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, modelCount: models.length, message: "模型目录获取成功" };
}

export async function discoverModelIds(input: { providerId?: unknown; baseUrl?: unknown; secret?: unknown; existingModelId?: unknown }) {
  const providerId = String(input.providerId ?? "").trim();
  if (providerId) return discoverProviderModelIds(providerId);
  const existingId = String(input.existingModelId ?? "").trim();
  const existing = existingId ? await findModel(existingId) : null;
  if (existingId && !existing) throw new Error("模型不存在");
  const baseUrl = validateModelUrl(String(input.baseUrl ?? existing?.baseUrl ?? ""));
  const secret = String(input.secret ?? "").trim() || (existing ? await readProviderSecret(existing.providerId) : "");
  return (await (isSpicyApi({ baseUrl }) ? discoverSpicyCatalog(baseUrl, secret) : discoverConnection(baseUrl, secret, new URL(baseUrl).hostname === "openrouter.ai"))).catalog.map((entry) => entry.id);
}
