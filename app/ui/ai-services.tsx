"use client";

import { Alert, Badge, Button, Checkbox, Group, NumberInput, PasswordInput, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStudio, type StudioSettings } from "@/app/studio-state";
import type { AiModelRecord, AiProviderRecord } from "@/db/ai";
import { catalogEntry, manualModelMetadata, supportsImages, supportsText, type CatalogModel, type ModelCatalog, type ModelCatalogPage, type ModelMetadata } from "@/lib/ai-model-capabilities";
import { matchesCatalogModel } from "@/lib/model-catalog-search";
import { fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { modelSelectionLabel } from "@/lib/model-label";
import { isSpicyApi } from "@/lib/spicy-api";
import { isCivitai, isCivitaiAirQuery, splitCivitaiAirQueries, lookupCivitaiAirBatch, type CivitaiAirBatch } from "@/lib/civitai-api";
import { DEFAULT_MAX_INPUT_CHARACTERS, MAX_MAX_INPUT_CHARACTERS, MIN_MAX_INPUT_CHARACTERS } from "@/lib/model-options";
import { ReasoningSettings } from "./reasoning-settings";
import { ResponsiveModal } from "./overlays";
import type { ReasoningEffort } from "@/lib/reasoning-options";

type Model = AiModelRecord;
type CatalogSearch = { providerId: string; query: string; mode: "provider" | "full"; attempt: number };
type CatalogScan = { catalog: Map<string, CatalogModel>; cursor: string | null; scanned: number; complete: boolean; seen: Set<string> };
type CatalogScanSnapshot = { key: string; catalog: CatalogModel[]; scanned: number; complete: boolean; airBatch?: CivitaiAirBatch };
const capabilityOptions = [{ value: "text", label: "文字生成" }, { value: "image", label: "图像生成" }, { value: "both", label: "文字与图像生成" }];
const emptyConnection = { name: "", baseUrl: "https://api.openai.com/v1", secret: "", adapterKind: "openai-compatible", timeoutMinutes: 2 };
const formatTime = (value?: string) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未同步";
const matchesReference = (model: Model, reference?: string) => Boolean(reference && [model.id, model.name, modelSelectionLabel(model)].includes(reference));
const modelKind = (model: Model) => supportsImages(model) ? supportsText(model) ? "both" : "image" : "text";

async function jsonRequest<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", signal?: AbortSignal): Promise<T> {
  const response = await (method === "GET" ? fetchFromServer : fetchServerAction)(path, {
    method, cache: "no-store", signal, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204 && response.ok) return undefined as T;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || `请求失败（${response.status}）`);
  return result as T;
}

function CapabilityBadges({ model }: { model: { metadata?: ModelMetadata } }) {
  return <span className="ai-capabilities">{supportsText(model) && <Badge variant="light" color="studio">文字</Badge>}{supportsImages(model) && <Badge variant="light" color="grape">图像</Badge>}{!supportsText(model) && !supportsImages(model) && <Badge variant="light" color="gray">能力待确认</Badge>}</span>;
}

export function AiServices() {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [providers, setProviders] = useState<AiProviderRecord[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [catalogs, setCatalogs] = useState<Record<string, ModelCatalog>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [connection, setConnection] = useState(emptyConnection);
  const [formError, setFormError] = useState("");
  const [adding, setAdding] = useState(false);
  const [addProvider, setAddProvider] = useState("");
  const [addMode, setAddMode] = useState("catalog");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogSearch, setCatalogSearch] = useState<CatalogSearch | null>(null);
  const [catalogSearchMode, setCatalogSearchMode] = useState<"provider" | "full">("provider");
  const [catalogFilter, setCatalogFilter] = useState("new");
  const [selected, setSelected] = useState<string[]>([]);
  const [manualIds, setManualIds] = useState("");
  const [manualKind, setManualKind] = useState("text");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState("");
  const requestRef = useRef(0);
  const scanCache = useRef(new Map<string, CatalogScan>());
  const searchPageCache = useRef(new Map<string, CatalogScan>());
  const scanController = useRef<AbortController | null>(null);
  const [scanSnapshot, setScanSnapshot] = useState<CatalogScanSnapshot | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  const [editing, setEditing] = useState<Model | null>(null);
  const [editForm, setEditForm] = useState({ providerId: "", name: "", modelId: "", kind: "text", systemPrompt: "", maxInput: DEFAULT_MAX_INPUT_CHARACTERS, reasoningEffort: null as ReasoningEffort | null });
  const [preview, setPreview] = useState<string | null>(null);
  const [managing, setManaging] = useState<AiProviderRecord | null>(null);
  const [manageQuery, setManageQuery] = useState("");
  const [managedSelection, setManagedSelection] = useState<string[]>([]);
  const [removal, setRemoval] = useState<{ models: Model[]; provider?: AiProviderRecord; clearAll?: boolean } | null>(null);
  const [removalError, setRemovalError] = useState("");

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([jsonRequest<{ providers: AiProviderRecord[] }>("/api/providers"), jsonRequest<{ models: Model[] }>("/api/models")]);
    setProviders(p.providers); setModels(m.models);
    const stored = await Promise.allSettled(p.providers.map(async (provider) => ({ id: provider.id, catalog: await jsonRequest<ModelCatalog | null>(`/api/providers/${provider.id}/discover`) })));
    setCatalogs((current) => {
      const next = { ...current };
      for (const result of stored) if (result.status === "fulfilled" && result.value.catalog) next[result.value.id] = result.value.catalog;
      return next;
    });
  }, []);
  useEffect(() => { void load().catch((cause) => setError(cause.message)).finally(() => setLoading(false)); }, [load]);

  const settings = studio.data.settings;
  const textModels = models.filter(supportsText);
  const imageModels = models.filter(supportsImages);
  function selectionOptions(items: Model[]) { return items.map((model) => ({ value: model.id, label: `${modelSelectionLabel(model)}${model.hasSecret ? "" : "（需密钥）"}`, disabled: !model.hasSecret })); }
  function canonical(reference?: string) { return models.find((model) => matchesReference(model, reference))?.id ?? reference ?? ""; }
  function updateDefaults(patch: Partial<StudioSettings>) { studio.updateSettings(patch); setNotice("默认用途已更新，正在自动保存"); }
  const textOptions = [{ value: "", label: "本地演示引擎" }, ...selectionOptions(textModels)];
  const generateLabel = models.find((model) => matchesReference(model, settings.generateModel));
  const inheritLabel = `继承正文生成 · ${generateLabel ? modelSelectionLabel(generateLabel) : "本地演示引擎"}`;
  const providerOptions = providers.map((provider) => ({ value: provider.id, label: provider.name }));
  const currentCatalog = catalogs[addProvider];
  const civitaiProvider = isCivitai(providers.find(provider => provider.id === addProvider) ?? {});
  const activeCatalogQuery = catalogSearch?.providerId === addProvider ? catalogSearch.query : "";
  const fullCatalogSearch = civitaiProvider && Boolean(activeCatalogQuery);
  const exactAirSearch = civitaiProvider && isCivitaiAirQuery(activeCatalogQuery);
  const providerSearch = fullCatalogSearch && catalogSearch?.mode === "provider";
  const searchKey = `${addProvider}\n${catalogSearch?.mode}\n${activeCatalogQuery.toLowerCase()}`;
  const scan = scanSnapshot?.key === searchKey ? scanSnapshot : null;
  const searchEdited = catalogQuery.trim() !== activeCatalogQuery || fullCatalogSearch && catalogSearchMode !== catalogSearch?.mode;
  const enabledIds = new Set(models.filter((model) => model.providerId === addProvider).map((model) => model.modelId));
  const candidates = fullCatalogSearch ? scan?.catalog ?? [] : [...new Map([...(currentCatalog?.catalog ?? []), ...[...(scanCache.current.get(addProvider)?.catalog.values() ?? [])].filter(entry => selected.includes(entry.id))].map(entry => [entry.id, entry])).values()];
  const matchedCandidates = exactAirSearch || providerSearch && !/[?*]/.test(activeCatalogQuery) ? candidates : candidates.filter(entry => matchesCatalogModel(entry, activeCatalogQuery));
  const visibleCandidates = matchedCandidates.filter(entry => catalogFilter === "all" || catalogFilter === "new" && !enabledIds.has(entry.id) || catalogFilter === "selected" && selected.includes(entry.id) || catalogFilter === "text" && entry.metadata.outputModalities.includes("text") || catalogFilter === "image" && supportsImages(entry));
  const selectable = (entry: CatalogModel) => !enabledIds.has(entry.id) && (!entry.metadata.outputModalities.length || supportsText(entry) || supportsImages(entry));
  const parsedManual = [...new Set(manualIds.split(/[\n,，]/).map((id) => id.trim()).filter(Boolean))].filter((id) => !enabledIds.has(id));
  const selectedNew = selected.filter((id) => !enabledIds.has(id));
  const addingIds = addMode === "manual" ? parsedManual : selectedNew;

  useEffect(() => {
    setScanError("");
    if (!adding || addMode !== "catalog" || !fullCatalogSearch) return;
    const controller = new AbortController();
    scanController.current = controller;
    setScanBusy(true);
    void scanFullCatalog(addProvider, activeCatalogQuery, catalogSearch!.mode, searchKey, controller.signal);
    return () => { controller.abort(); setScanBusy(false); };
  }, [adding, addMode, addProvider, catalogSearch]);

  async function scanFullCatalog(providerId: string, query: string, mode: CatalogSearch["mode"], key: string, signal: AbortSignal) {
    let pool = scanCache.current.get(providerId);
    if (!pool) { pool = { catalog: new Map((catalogs[providerId]?.catalog ?? []).map(entry => [entry.id, entry])), cursor: null, scanned: 0, complete: false, seen: new Set() }; scanCache.current.set(providerId, pool); }
    try {
      if (isCivitaiAirQuery(query)) {
        const batch = await lookupCivitaiAirBatch(query, air => jsonRequest<ModelCatalogPage>(`/api/providers/${encodeURIComponent(providerId)}/catalog-pages`, { air }, "POST", signal), signal, airBatch => {
          for (const entry of airBatch.catalog) pool.catalog.set(entry.id, entry);
          setScanSnapshot({ key, catalog: airBatch.catalog, scanned: airBatch.processed, complete: airBatch.processed === airBatch.total && !airBatch.failures.length, airBatch });
        });
        if (batch.failures.length) setScanError(batch.failures.map(({ air, message }) => `${air}：${message}`).join("；") + "。可重新查询 AIR，成功的结果已保留。");
        return;
      }
      if (query.length > 200) throw new Error("名称或通配符搜索请勿超过 200 字符；多个 AIR 可直接粘贴查询");
      const hint = mode === "provider" ? query.split(/[?*]+/).map(value => value.trim()).sort((a, b) => b.length - a.length)[0] : undefined;
      if (mode === "provider" && !hint) throw new Error("官方搜索需要至少一个关键词；仅含通配符时请选择全目录匹配");
      const cacheKey = mode === "full" ? `${providerId}\nfull` : key;
      let scan = searchPageCache.current.get(cacheKey);
      if (!scan) { scan = { catalog: new Map(), cursor: null, scanned: 0, complete: false, seen: new Set() }; searchPageCache.current.set(cacheKey, scan); }
      setScanSnapshot({ key, catalog: [...scan.catalog.values()], scanned: scan.scanned, complete: scan.complete });
      while (!scan.complete && !signal.aborted) {
        const page = await jsonRequest<ModelCatalogPage>(`/api/providers/${encodeURIComponent(providerId)}/catalog-pages`, { cursor: scan.cursor, ...(hint ? { hint } : {}) }, "POST", signal);
        if (signal.aborted) return;
        if (!Array.isArray(page.catalog) || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor))) throw new Error("服务返回了无效的目录分页");
        if (page.nextCursor && scan.seen.has(page.nextCursor)) throw new Error("Civitai 返回了重复的分页游标");
        for (const entry of page.catalog) { scan.catalog.set(entry.id, entry); pool.catalog.set(entry.id, entry); }
        scan.scanned += page.scanned;
        scan.cursor = page.nextCursor;
        scan.complete = page.nextCursor === null;
        if (page.nextCursor) scan.seen.add(page.nextCursor);
        setScanSnapshot({ key, catalog: [...scan.catalog.values()], scanned: scan.scanned, complete: scan.complete });
      }
    } catch (cause) {
      if (!signal.aborted) setScanError(`${cause instanceof Error ? cause.message : "目录搜索失败"}${isCivitaiAirQuery(query) ? "。可重新查询 AIR。" : "。已保留读取的结果，搜索尚未完成，可继续搜索。"}`);
    } finally { if (!signal.aborted) setScanBusy(false); }
  }
  function submitCatalogSearch() {
    scanController.current?.abort(); setScanSnapshot(null); setScanError("");
    const query = catalogQuery.trim();
    const key = `${addProvider}\n${catalogSearchMode}\n${query.toLowerCase()}`;
    if (catalogSearch?.query === query && catalogSearch.mode === catalogSearchMode) searchPageCache.current.delete(catalogSearchMode === "full" ? `${addProvider}\nfull` : key);
    setCatalogSearch(query ? { providerId: addProvider, query, mode: catalogSearchMode, attempt: (catalogSearch?.attempt ?? 0) + 1 } : null);
    setCatalogFilter("all");
  }
  function restartCatalogSearch() {
    scanController.current?.abort(); searchPageCache.current.delete(catalogSearch?.mode === "full" ? `${addProvider}\nfull` : searchKey); setScanSnapshot(null); setScanError(""); setCatalogSearch(value => value && { ...value, attempt: value.attempt + 1 });
  }
  function stopCatalogSearch() { scanController.current?.abort(); setScanBusy(false); }

  async function refreshCatalog(providerId = addProvider) {
    const request = ++requestRef.current;
    setCatalogBusy(true); setFormError(""); setCatalogNotice("");
    try {
      const result = await jsonRequest<ModelCatalog & { models?: string[] }>(`/api/providers/${providerId}/discover`, {}, "POST");
      if (request !== requestRef.current) return;
      const catalog = result.catalog ?? (result.models ?? []).map(catalogEntry).filter((entry): entry is CatalogModel => entry !== null);
      const old = new Set(catalogs[providerId]?.catalog.map((entry) => entry.id) ?? []);
      setCatalogs((current) => ({ ...current, [providerId]: { catalog, syncedAt: result.syncedAt || new Date().toISOString(), warnings: result.warnings ?? [] } }));
      setSelected((values) => values.filter((id) => catalog.some((entry) => entry.id === id) || scanCache.current.get(providerId)?.catalog.has(id)));
      setCatalogNotice(`已同步 ${catalog.length} 个模型${old.size ? `，新发现 ${catalog.filter((entry) => !old.has(entry.id)).length} 个` : ""}`);
    } catch (cause) { if (request === requestRef.current) setFormError(cause instanceof Error ? cause.message : "目录同步失败"); }
    finally { if (request === requestRef.current) setCatalogBusy(false); }
  }
  function closeAdd() { requestRef.current += 1; setAdding(false); setCatalogBusy(false); }
  function openAdd(providerId = providers[0]?.id ?? "") {
    setAddProvider(providerId); setAdding(true); setAddMode("catalog"); setCatalogQuery(""); setCatalogSearch(null); setCatalogSearchMode("provider"); setCatalogFilter("new"); setSelected([]); setManualIds(""); setManualKind(isCivitai(providers.find(provider => provider.id === providerId) ?? {}) ? "image" : "text"); setFormError(""); setCatalogNotice("");
    if (providerId && !catalogs[providerId]) void refreshCatalog(providerId);
  }
  function changeAddProvider(id: string) {
    requestRef.current += 1; setCatalogBusy(false); setAddProvider(id); setCatalogQuery(""); setCatalogSearch(null); setScanSnapshot(null); setManualKind(isCivitai(providers.find(provider => provider.id === id) ?? {}) ? "image" : "text"); setSelected([]); setFormError(""); setCatalogNotice("");
    if (id && !catalogs[id]) void refreshCatalog(id);
  }
  async function enableModels() {
    setBusy("enable"); setFormError("");
    try {
      const metadataByModelId = Object.fromEntries(addingIds.map((id) => {
        const discovered = addMode === "catalog" ? (candidates.find((entry) => entry.id === id) ?? scanCache.current.get(addProvider)?.catalog.get(id))?.metadata : null;
        return [id, discovered?.outputModalities.length ? discovered : manualModelMetadata(manualKind as "text" | "image" | "both")];
      }));
      const result = await jsonRequest<{ models: Model[] }>("/api/models/bulk", { providerId: addProvider, modelIds: addingIds, metadataByModelId });
      closeAdd(); await load(); setNotice(`已启用 ${result.models.length} 个新模型`);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "模型添加失败"); }
    finally { setBusy(""); }
  }
  function openConnection(provider?: AiProviderRecord) {
    setConnectionId(provider?.id ?? null); setConnection(provider ? { name: provider.name, baseUrl: provider.baseUrl, secret: "", adapterKind: isCivitai(provider) ? "civitai" : provider.adapterKind, timeoutMinutes: provider.timeoutMs / 60000 } : emptyConnection); setFormError(""); setConnectionOpen(true);
  }
  async function saveConnection() {
    setBusy("connection"); setFormError("");
    try {
      const provider = await jsonRequest<AiProviderRecord>(connectionId ? `/api/providers/${connectionId}` : "/api/providers", { name: connection.name, baseUrl: connection.baseUrl, adapterKind: connection.adapterKind, timeoutMs: Math.round(connection.timeoutMinutes * 60_000), ...(!connectionId ? { secret: connection.secret } : {}) }, connectionId ? "PATCH" : "POST");
      if (connectionId && connection.secret.trim()) await jsonRequest(`/api/providers/${connectionId}/secret`, { secret: connection.secret }, "PUT");
      setConnectionOpen(false); setConnectionsOpen(true); await load(); setNotice("服务连接已保存");
      if (!connectionId) openAdd(provider.id);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "连接保存失败"); }
    finally { setBusy(""); }
  }
  function openEdit(model: Model) {
    setEditing(model); setFormError(""); setEditForm({ providerId: model.providerId, name: model.name, modelId: model.modelId, kind: modelKind(model), systemPrompt: model.systemPrompt ?? "", maxInput: model.maxInputCharacters ?? DEFAULT_MAX_INPUT_CHARACTERS, reasoningEffort: model.reasoningEffort ?? null });
  }
  async function saveModel() {
    if (!editing) return;
    setBusy("model"); setFormError("");
    try {
      const metadata = editForm.kind === modelKind(editing) && editForm.providerId === editing.providerId ? editing.metadata : manualModelMetadata(editForm.kind as "text" | "image" | "both");
      const updated = await jsonRequest<Model>(`/api/models/${editing.id}`, { providerId: editForm.providerId, name: editForm.name, modelId: editForm.modelId, metadata, maxInputCharacters: editForm.maxInput, systemPrompt: editForm.systemPrompt, reasoningEffort: editForm.reasoningEffort }, "PATCH");
      const defaults: Partial<StudioSettings> = {};
      for (const key of ["generateModel", "chatModel", "namingModel", "illustrationPromptModel", "reviewModel", "illustrationImageModel"] as const) {
        if (matchesReference(editing, settings[key])) defaults[key] = (key === "illustrationImageModel" ? supportsImages(updated) : supportsText(updated)) ? updated.id : "";
      }
      if (defaults.namingModel === "") defaults.namingModelMode = "inherit";
      if (defaults.reviewModel === "") defaults.reviewModelMode = "inherit";
      if (Object.keys(defaults).length) studio.updateSettings(defaults);
      setEditing(null); await load(); setNotice("模型配置已保存");
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "模型保存失败"); }
    finally { setBusy(""); }
  }
  async function testOne(model: Model, operation: "text" | "image") {
    const response = await fetchServerAction(`/api/models/${model.id}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation }) });
    const result = await response.json() as { ok?: boolean; error?: string; message?: string; preview?: { src: string } };
    if (result.preview) setPreview(result.preview.src);
    return { ok: Boolean(response.ok && result.ok), message: result.message || result.error || "检测失败" };
  }
  async function testModels(targets: Model[], operation: "text" | "image") {
    setError(""); let passed = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        setBusy(`test:${targets[i].id}`); setNotice(`正在${operation === "image" ? "试生成" : "检测文字调用"} ${i + 1}/${targets.length}`);
        const result = await testOne(targets[i], operation); if (result.ok) passed++;
        if (targets.length === 1 && !result.ok) setError(result.message);
      }
      await load(); setNotice(`检测完成：${passed} 个通过，${targets.length - passed} 个未通过。结果已记录在各模型下方。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "检测中断"); }
    finally { setBusy(""); }
  }
  function openManage(provider: AiProviderRecord) {
    setManaging(provider); setManageQuery(""); setManagedSelection([]);
  }
  function removeModel(model: Model) {
    setRemovalError(""); setRemoval({ models: [model] });
  }
  function requestBulkRemoval(targets: Model[], clearAll = false) {
    if (!managing || !targets.length || busy) return;
    setRemovalError(""); setRemoval({ models: targets, provider: managing, clearAll });
  }
  async function confirmRemoval() {
    if (!removal || busy) return;
    setBusy("delete"); setRemovalError(""); setError("");
    try {
      let deletedIds: string[];
      if (removal.provider) {
        const result = await jsonRequest<{ deletedIds: string[] }>("/api/models/bulk", { providerId: removal.provider.id, ids: removal.models.map((model) => model.id) }, "DELETE");
        deletedIds = result.deletedIds;
      } else {
        await jsonRequest(`/api/models/${removal.models[0].id}`, undefined, "DELETE");
        deletedIds = [removal.models[0].id];
      }
      const deleted = new Set(deletedIds);
      const removedModels = removal.models.filter((model) => deleted.has(model.id));
      const removedReference = (reference?: string) => removedModels.some((model) => matchesReference(model, reference));
      const patch: Partial<StudioSettings> = {};
      for (const key of ["generateModel", "chatModel", "namingModel", "illustrationPromptModel", "illustrationImageModel", "reviewModel"] as const) if (removedReference(settings[key])) patch[key] = "";
      if (removedReference(settings.namingModel)) patch.namingModelMode = "inherit";
      if (removedReference(settings.reviewModel)) patch.reviewModelMode = "inherit";
      if (Object.keys(patch).length) studio.updateSettings(patch);
      setModels((current) => current.filter((model) => !deleted.has(model.id)));
      setManagedSelection((current) => current.filter((id) => !deleted.has(id)));
      setRemoval(null);
      setNotice(`已删除 ${deletedIds.length} 个模型${Object.keys(patch).length ? "，相关默认用途已重置" : ""}`);
      try { await load(); } catch { setError("模型已删除，但列表刷新失败，请刷新页面。"); }
    } catch (cause) { setRemovalError(cause instanceof Error ? cause.message : "删除失败"); }
    finally { setBusy(""); }
  }
  async function connectionAction(provider: AiProviderRecord, action: "test" | "delete" | "key") {
    if (action !== "test" && !window.confirm(action === "key" ? `移除「${provider.name}」的 API Key？` : `删除服务连接「${provider.name}」？`)) return;
    setBusy(`connection:${provider.id}`); setError("");
    try {
      if (action === "test") {
        const result = await jsonRequest<{ latencyMs: number; modelCount: number }>(`/api/providers/${provider.id}/test`, {}, "POST");
        setNotice(`${provider.name}：目录获取成功，${result.modelCount} 个模型，耗时 ${result.latencyMs} ms`);
      } else { await jsonRequest(`/api/providers/${provider.id}${action === "key" ? "/secret" : ""}`, undefined, "DELETE"); setNotice(action === "key" ? "API Key 已移除" : "服务连接已删除"); }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "连接操作失败"); }
    finally { setBusy(""); }
  }
  function uses(model: Model) {
    return [matchesReference(model, settings.generateModel) && "正文", matchesReference(model, settings.chatModel) && "对话", settings.namingModelMode === "fixed" && matchesReference(model, settings.namingModel) && "命名", settings.reviewModelMode === "fixed" && matchesReference(model, settings.reviewModel) && "审校", matchesReference(model, settings.illustrationPromptModel) && "插图提示词", matchesReference(model, settings.illustrationImageModel) && "插图"].filter(Boolean).join(" · ");
  }
  const visible = models.filter((model) => `${model.name} ${model.modelId} ${model.providerName}`.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || filter === "text" && supportsText(model) || filter === "image" && supportsImages(model) || filter === "used" && Boolean(uses(model)) || filter === "failed" && Object.values(model.metadata?.tests ?? {}).some((result) => !result?.ok)));
  const unfiltered = !query.trim() && filter === "all";
  const managedModels = models.filter((model) => model.providerId === managing?.id);
  const managedVisible = managedModels.filter((model) => `${model.name} ${model.modelId}`.toLowerCase().includes(manageQuery.toLowerCase()));
  const selectedManagedModels = managedModels.filter((model) => managedSelection.includes(model.id));
  const allManagedVisibleSelected = managedVisible.length > 0 && managedVisible.every((model) => managedSelection.includes(model.id));
  const removalUsesDefaults = removal?.models.some((model) => [settings.generateModel, settings.chatModel, settings.namingModel, settings.illustrationPromptModel, settings.illustrationImageModel, settings.reviewModel].some((reference) => matchesReference(model, reference)));
  const formModal = { fullScreen: compact, centered: !compact, scrollMode: "content" as const, classNames: { content: "ai-service-modal", body: "ai-service-modal-body" } };

  return <div className="ai-services">
    <div className="ai-service-intro"><div><Text c="dimmed" size="sm">为写作和插图选择合适的模型</Text><div className="ai-service-counts"><span>{providers.length} 个服务连接</span><span>{textModels.length} 个文字模型</span><span>{imageModels.length} 个图像模型</span></div></div><Button loading={loading} disabled={Boolean(busy)} onClick={() => providers.length ? openAdd() : openConnection()}>添加模型</Button></div>
    {error && <Alert color="red" role="alert" withCloseButton onClose={() => setError("")}>{error}</Alert>}
    {notice && <Alert color="studio" role="status" withCloseButton onClose={() => setNotice("")}>{notice}</Alert>}
    <section className="ai-service-section" aria-labelledby="ai-defaults-title"><div className="ai-section-heading"><div><h2 id="ai-defaults-title">默认用途</h2><p>在这里分配模型，执行任务时仍可单独选择。</p></div><span className="ai-auto-save">自动保存</span></div><div className="ai-default-grid">
      <Select label="正文生成" data={textOptions} value={canonical(settings.generateModel)} onChange={(value) => updateDefaults({ generateModel: value ?? "" })} searchable allowDeselect={false} />
      <Select label="聊天" data={textOptions} value={canonical(settings.chatModel)} onChange={(value) => updateDefaults({ chatModel: value ?? "" })} searchable allowDeselect={false} />
      <Select label="名称生成" data={[{ value: "__inherit__", label: inheritLabel }, ...textOptions]} value={settings.namingModelMode === "inherit" ? "__inherit__" : canonical(settings.namingModel)} onChange={(value) => updateDefaults(value === "__inherit__" ? { namingModelMode: "inherit", namingModel: "" } : { namingModelMode: "fixed", namingModel: value ?? "" })} searchable allowDeselect={false} />
      <Select label="插图提示词" data={[{ value: "", label: inheritLabel }, ...selectionOptions(textModels)]} value={canonical(settings.illustrationPromptModel)} onChange={(value) => updateDefaults({ illustrationPromptModel: value ?? "" })} searchable allowDeselect={false} />
      <Select label="插图生成" data={[{ value: "", label: "每次选择" }, ...selectionOptions(imageModels)]} value={canonical(settings.illustrationImageModel)} onChange={(value) => updateDefaults({ illustrationImageModel: value ?? "" })} searchable allowDeselect={false} />
    </div></section>
    <section className="ai-service-section" aria-labelledby="ai-models-title"><div className="ai-section-heading"><div><h2 id="ai-models-title">已启用模型 <span>{models.length}</span></h2><p>只显示你添加的模型；服务商目录可在添加时搜索。</p></div><Button variant="subtle" size="xs" disabled={Boolean(busy) || !textModels.length} onClick={() => void testModels(textModels, "text")}>检测文字模型</Button></div>
      <div className="ai-model-tools"><TextInput aria-label="搜索已启用模型" placeholder="搜索模型名称、ID 或服务商" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /><div className="ai-filter-tabs" role="group" aria-label="模型筛选">{[["all", "全部"], ["text", "文字"], ["image", "图像"], ["used", "默认使用中"], ["failed", "检测失败"]].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
      {loading ? <Text p="md" role="status">正在加载模型配置…</Text> : visible.length || unfiltered && providers.length ? <div className="ai-model-groups">{providers.map((provider) => {
        const items = visible.filter((model) => model.providerId === provider.id); if (!items.length && !unfiltered) return null;
        return <div className="ai-model-group" key={provider.id}><div className="ai-model-group-title"><h3>{provider.name}</h3><span>{items.length} 个模型</span><div className="ai-model-group-actions"><Button size="compact-xs" variant="default" disabled={Boolean(busy)} onClick={() => openManage(provider)}>管理模型</Button><Button size="compact-xs" variant="subtle" disabled={Boolean(busy)} onClick={() => openAdd(provider.id)}>添加模型</Button></div></div>{!items.length && <div className="ai-service-empty">暂无已启用模型，可从目录添加模型。</div>}{items.length > 0 && <table className="ai-model-table"><colgroup><col className="ai-model-col-name" /><col className="ai-model-col-uses" /><col className="ai-model-col-actions" /></colgroup><thead><tr><th>模型与能力</th><th>默认用途</th><th>操作</th></tr></thead><tbody>{items.map((model) => <tr key={model.id} data-provider-model-id={model.id}><td><div className="ai-model-name"><strong>{model.name}</strong><CapabilityBadges model={model} /></div><div className="ai-model-id"><code>{model.modelId}</code><button type="button" aria-label={`复制模型 ID：${model.modelId}`} onClick={() => void navigator.clipboard.writeText(model.modelId).then(() => setNotice("已复制模型 ID")).catch(() => setError("复制失败，请手动选择模型 ID"))}>复制</button></div>{!model.hasSecret && <span className="ai-inline-warning">连接缺少密钥</span>}{!isCivitai(provider) && catalogs[provider.id] && !catalogs[provider.id].catalog.some((entry) => entry.id === model.modelId) && <span className="ai-model-meta">最近目录未列出，仍可测试和使用</span>}<div className="ai-test-results">{(["text", "image"] as const).map((operation) => { const result = model.metadata?.tests?.[operation]; return result ? <span className={result.ok ? "passed" : "failed"} key={operation} title={`${formatTime(result.checkedAt)} · ${result.message}`}>{operation === "text" ? "文字" : "图像"}：{result.ok ? `${result.latencyMs} ms · 通过` : result.message}<small>{formatTime(result.checkedAt)}</small></span> : null; })}{!Object.keys(model.metadata?.tests ?? {}).length && <span className="ai-model-meta">尚未测试调用</span>}</div></td><td className="ai-model-uses">{uses(model) || "—"}</td><td><div className="ai-row-actions"><Button size="compact-xs" variant="subtle" disabled={Boolean(busy)} onClick={() => openEdit(model)}>编辑</Button><Button size="compact-xs" variant="subtle" color="red" disabled={Boolean(busy)} onClick={() => removeModel(model)}>删除</Button>{supportsText(model) && <Button size="compact-xs" variant="default" disabled={Boolean(busy) || !model.hasSecret} loading={busy === `test:${model.id}`} onClick={() => void testModels([model], "text")}>测试文字</Button>}{supportsImages(model) && <Button size="compact-xs" variant="default" disabled={Boolean(busy) || !model.hasSecret} loading={busy === `test:${model.id}`} onClick={() => void testModels([model], "image")}>试生成 1 张</Button>}</div></td></tr>)}</tbody></table>}</div>;
      })}</div> : <div className="ai-service-empty"><strong>{models.length ? "没有符合条件的模型" : "添加第一个模型"}</strong><p>{models.length ? "换一个关键词或筛选条件试试。" : "连接服务商后，选择文字或图像模型用于创作。"}</p>{!models.length && <Button variant="light" onClick={() => providers.length ? openAdd() : openConnection()}>添加模型</Button>}</div>}
    </section>
    <section className="ai-service-section"><button className="ai-connection-disclosure" type="button" aria-expanded={connectionsOpen} onClick={() => setConnectionsOpen(!connectionsOpen)}><span><strong>服务连接</strong><small>管理接口地址与 API Key · {providers.length} 个连接</small></span><span aria-hidden="true">{connectionsOpen ? "−" : "+"}</span></button>{connectionsOpen && <div className="ai-connections"><Group justify="space-between"><Text size="sm" c="dimmed">密钥配置与调用检测分别显示。</Text><Button variant="default" size="xs" onClick={() => openConnection()}>添加服务连接</Button></Group>{providers.map((provider) => <article className="ai-connection" key={provider.id}><div><h3>{provider.name} <Badge color={provider.hasSecret ? "gray" : "yellow"} variant="light">{provider.hasSecret ? "密钥已配置" : "缺少密钥"}</Badge></h3><p>{provider.baseUrl}</p><small>{isCivitai(provider) ? "Civitai（图像生成）" : isSpicyApi(provider) ? "文字、图像与角色库" : provider.adapterKind === "openrouter" || new URL(provider.baseUrl).hostname === "openrouter.ai" ? "OpenRouter" : "OpenAI 兼容接口"} · 超时 {provider.timeoutMs / 60000} 分钟</small><small>目录最近同步：{formatTime(catalogs[provider.id]?.syncedAt)}</small></div><div className="ai-connection-actions"><Button size="xs" variant="default" disabled={Boolean(busy)} onClick={() => openManage(provider)}>管理模型</Button><Button size="xs" variant="default" onClick={() => openConnection(provider)}>编辑连接</Button><Button size="xs" variant="default" disabled={Boolean(busy)} loading={busy === `connection:${provider.id}`} onClick={() => void connectionAction(provider, "test")}>检测目录</Button><Button size="xs" variant="subtle" disabled={Boolean(busy) || !provider.hasSecret} onClick={() => void connectionAction(provider, "key")}>移除密钥</Button><Button size="xs" variant="subtle" color="red" disabled={Boolean(busy) || models.some((model) => model.providerId === provider.id)} onClick={() => void connectionAction(provider, "delete")}>删除连接</Button></div></article>)}</div>}</section>

    <ResponsiveModal opened={Boolean(managing)} onClose={() => { if (!busy) setManaging(null); }} title={`管理模型 · ${managing?.name ?? ""}`} closeButtonProps={{ "aria-label": "关闭模型管理", disabled: Boolean(busy) }} closeOnEscape={!busy} closeOnClickOutside={!busy} size={800} {...formModal}>
      <div className="ai-add-model-content">
        <Group justify="space-between"><Text size="sm">{managing?.name} · 共 {managedModels.length} 个已启用模型</Text><Button size="xs" variant="subtle" color="red" disabled={Boolean(busy) || !managedModels.length} onClick={() => requestBulkRemoval(managedModels, true)}>清空全部模型</Button></Group>
        <Text size="xs" c="dimmed">删除后可从目录重新添加；服务连接与 API Key 会保留。</Text>
        <TextInput aria-label="搜索要管理的模型" placeholder="搜索模型名称或 ID" value={manageQuery} disabled={Boolean(busy)} onChange={(event) => setManageQuery(event.currentTarget.value)} />
        <Group justify="space-between"><Checkbox label="全选当前结果" checked={allManagedVisibleSelected} indeterminate={!allManagedVisibleSelected && managedVisible.some((model) => managedSelection.includes(model.id))} disabled={Boolean(busy) || !managedVisible.length} onChange={(event) => { const checked = event.currentTarget.checked; const ids = new Set(managedVisible.map((model) => model.id)); setManagedSelection((current) => checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.has(id))); }} /><Button size="compact-xs" variant="subtle" disabled={Boolean(busy) || !managedSelection.length} onClick={() => setManagedSelection([])}>清空选择</Button></Group>
        <div className="ai-catalog-scroll" aria-label="管理已启用模型">{managedVisible.length ? managedVisible.map((model) => <div className="ai-catalog-row ai-managed-model-row" key={model.id}><Checkbox aria-label={`选择已启用模型 ${model.modelId}`} checked={managedSelection.includes(model.id)} disabled={Boolean(busy)} onChange={(event) => { const checked = event.currentTarget.checked; setManagedSelection((current) => checked ? [...new Set([...current, model.id])] : current.filter((id) => id !== model.id)); }} /><span><strong>{model.name}</strong><code>{model.modelId}</code>{uses(model) && <Text size="xs" c="dimmed">默认用途：{uses(model)}</Text>}</span><Button size="compact-xs" variant="subtle" color="red" disabled={Boolean(busy)} onClick={() => removeModel(model)}>删除</Button></div>) : <div className="ai-service-empty">{managedModels.length ? "没有符合条件的模型" : "此 Provider 暂无已启用模型"}</div>}</div>
      </div>
      <footer className="ai-modal-footer"><Text size="sm">已选择 {selectedManagedModels.length} / {managedModels.length} 个模型</Text><Group><Button variant="default" disabled={Boolean(busy)} onClick={() => setManaging(null)}>完成</Button><Button color="red" disabled={Boolean(busy) || !selectedManagedModels.length} onClick={() => requestBulkRemoval(selectedManagedModels)}>删除所选（{selectedManagedModels.length}）</Button></Group></footer>
    </ResponsiveModal>
    <ResponsiveModal opened={Boolean(removal)} onClose={() => { if (!busy) setRemoval(null); }} title={removal?.clearAll ? "清空模型" : removal?.provider ? "批量删除模型" : "删除模型"} closeButtonProps={{ "aria-label": "关闭删除确认", disabled: Boolean(busy) }} closeOnEscape={!busy} closeOnClickOutside={!busy} centered size="md">
      <Stack>
        {removalError && <Alert color="red" role="alert">{removalError}</Alert>}
        <Text size="sm">{removal?.clearAll ? `确认清空「${removal.provider?.name}」的全部 ${removal.models.length} 个模型？此操作包含搜索条件之外的模型。` : removal?.provider ? `确认删除「${removal.provider.name}」中所选的 ${removal.models.length} 个模型？` : `确认删除模型「${removal?.models[0]?.name}」？`}</Text>
        {removal?.provider && <Text size="xs" c="dimmed">{removal.models.slice(0, 5).map((model) => model.name).join("、")}{removal.models.length > 5 ? " 等" : ""}</Text>}
        {removalUsesDefaults && <Alert color="yellow">所选模型正在用于默认用途。删除后，对应设置将重置；受影响的名称生成和审校设置将恢复继承。</Alert>}
        <Text size="xs" c="dimmed">模型配置将被删除，可从目录重新添加。服务连接、API Key 和已有创作内容会保留。</Text>
        <Group justify="flex-end"><Button variant="default" disabled={Boolean(busy)} onClick={() => setRemoval(null)}>取消</Button><Button color="red" loading={busy === "delete"} disabled={Boolean(busy) && busy !== "delete"} onClick={() => void confirmRemoval()}>{removal?.clearAll ? "确认清空" : "确认删除"}</Button></Group>
      </Stack>
    </ResponsiveModal>
    <ResponsiveModal opened={adding} onClose={closeAdd} title="添加模型" closeButtonProps={{ "aria-label": "关闭模型添加" }} size={800} {...formModal}>
      <div className="ai-add-model-content"><Select label="服务连接" data={providerOptions} value={addProvider} allowDeselect={false} onChange={(value) => changeAddProvider(value ?? "")} disabled={busy === "enable"} />
        <div className="ai-add-mode" role="group" aria-label="添加方式">{[["catalog", "从目录选择"], ["manual", "手动添加"]].map(([value, label]) => <button type="button" key={value} aria-pressed={addMode === value} onClick={() => { setAddMode(value); setFormError(""); }}>{label}</button>)}</div>
        {formError && <Alert color="red" role="alert">{formError}</Alert>}
        {addMode === "catalog" ? <><div className="ai-catalog-heading"><div><Text size="sm">{fullCatalogSearch ? matchedCandidates.length : candidates.length} {fullCatalogSearch ? "个匹配版本" : "个目录模型"} · 已启用 {enabledIds.size} 个</Text><Text size="xs" c="dimmed">最近同步：{formatTime(currentCatalog?.syncedAt)}</Text></div><Button size="xs" variant="default" loading={catalogBusy} disabled={!addProvider || busy === "enable" || scanBusy} onClick={() => fullCatalogSearch ? restartCatalogSearch() : void refreshCatalog()}>{exactAirSearch ? "重新查询 AIR" : fullCatalogSearch ? "重新搜索" : "刷新目录"}</Button></div>{catalogNotice && !fullCatalogSearch && <Text size="sm" role="status">{catalogNotice}</Text>}{!fullCatalogSearch && currentCatalog?.warnings.map((warning) => <Alert color="yellow" key={warning}>{warning}</Alert>)}<Group align="flex-end" wrap="nowrap"><Textarea style={{ flex: 1, minWidth: 0 }} autosize minRows={1} maxRows={4} aria-label="搜索目录模型" placeholder={civitaiProvider ? "输入名称、通配符或多个 AIR ID，再点击搜索" : "搜索模型名称或 ID"} description={civitaiProvider ? "支持 SD1.5/SDXL Checkpoint。多个 AIR 可用逗号、分号、空格或换行分隔。* 匹配任意长度，? 匹配一个字符。" : undefined} maxLength={civitaiProvider ? 20000 : 200} value={catalogQuery} onChange={(event) => { const value = event.currentTarget.value; setCatalogQuery(value); if (!value.trim()) { scanController.current?.abort(); setCatalogSearch(null); setScanSnapshot(null); setScanError(""); } }} /><Button disabled={!addProvider || !catalogQuery.trim() || busy === "enable" || scanBusy && !searchEdited} onClick={submitCatalogSearch}>搜索</Button></Group>{civitaiProvider && <Select label="搜索范围" description="官方搜索按关键词查找，通配符筛选其返回结果；需要完整通配符匹配时请选择全目录匹配。AIR 始终直接查询。" data={[{ value: "provider", label: "Civitai 官方搜索（较快）" }, { value: "full", label: "全目录匹配（较慢）" }]} value={catalogSearchMode} allowDeselect={false} onChange={value => setCatalogSearchMode(value === "full" ? "full" : "provider")} />}{searchEdited && <Text size="xs" c="dimmed" role="status">输入已修改，点击“搜索”更新结果。</Text>}{fullCatalogSearch && <><Text size="sm" role="status">{scan?.complete ? `${exactAirSearch ? "AIR 查询完成" : providerSearch ? "搜索完成，已读取全部官方搜索结果" : "搜索完成，已遍历完整目录"}，找到 ${matchedCandidates.length} 个匹配版本` : exactAirSearch ? `${scanBusy ? "正在根据 AIR 查询模型版本" : scan?.airBatch?.processed === scan?.airBatch?.total ? "AIR 查询结束" : "AIR 查询尚未完成"}：已查询 ${scan?.airBatch?.processed ?? 0}/${scan?.airBatch?.total ?? splitCivitaiAirQueries(activeCatalogQuery).length} 项，找到 ${matchedCandidates.length} 个匹配版本${scan?.airBatch?.failures.length ? `，失败 ${scan.airBatch.failures.length} 项` : ""}` : `${scanBusy ? providerSearch ? "正在搜索 Civitai" : "正在搜索完整目录" : "搜索尚未完成"}：已扫描 ${scan?.scanned ?? 0} 个资源，找到 ${matchedCandidates.length} 个匹配版本`}</Text>{scanError && <Alert color="red" role="alert">{scanError}</Alert>}{!scan?.complete && <Group><Button size="compact-xs" variant="subtle" onClick={() => scanBusy ? stopCatalogSearch() : setCatalogSearch(value => value && { ...value, attempt: value.attempt + 1 })}>{exactAirSearch ? scanBusy ? "停止查询" : "重新查询" : scanBusy ? "停止搜索" : "继续搜索"}</Button></Group>}</>}<div className="ai-filter-tabs" role="group" aria-label="目录筛选">{[["new", "未启用"], ["all", "全部"], ["text", "文字"], ["image", "图像"], ["selected", `已选 ${selected.length}`]].map(([value,label]) => <button type="button" key={value} aria-pressed={catalogFilter === value} onClick={() => setCatalogFilter(value)}>{label}</button>)}</div><div className="ai-catalog-scroll" aria-label="可添加的模型" aria-busy={catalogBusy || scanBusy}>
          {(catalogBusy || scanBusy) && !visibleCandidates.length ? <div className="ai-service-empty" role="status">{exactAirSearch ? "正在根据 AIR 查询模型版本…" : fullCatalogSearch ? providerSearch ? "正在读取 Civitai 官方搜索结果…" : "正在遍历 Civitai 目录，符合条件的模型会陆续显示…" : "正在获取模型目录…"}</div> : visibleCandidates.length ? visibleCandidates.map((entry) => <label className={`ai-catalog-row ${enabledIds.has(entry.id) ? "is-enabled" : ""}`} key={entry.id}><Checkbox aria-label={`选择模型 ${entry.id}`} checked={selected.includes(entry.id)} disabled={!selectable(entry) || Boolean(busy)} onChange={(event) => { const checked = event.currentTarget.checked; setSelected((values) => checked ? [...values, entry.id].slice(0, 100) : values.filter((id) => id !== entry.id)); }} /><span><strong>{entry.name}</strong><code>{entry.id}</code></span>{enabledIds.has(entry.id) ? <Badge variant="light" color="gray">已启用</Badge> : <CapabilityBadges model={entry} />}</label>) : <div className="ai-service-empty">{fullCatalogSearch ? scan?.complete ? "没有符合条件的模型" : exactAirSearch ? "未取得 AIR 查询结果，可重新查询" : "搜索尚未完成，可继续搜索" : candidates.length ? "没有符合条件的模型" : "暂无目录，可重试或手动添加模型"}</div>}
        </div><Group justify="space-between"><Button size="compact-xs" variant="subtle" disabled={Boolean(busy)} onClick={() => setSelected((values) => [...new Set([...values, ...visibleCandidates.filter(selectable).map((entry) => entry.id)])].slice(0, 100))}>选择当前结果（最多 100 个）</Button><Button size="compact-xs" variant="subtle" onClick={() => setSelected([])}>清空选择</Button></Group>{selectedNew.some((id) => !candidates.find((entry) => entry.id === id)?.metadata.outputModalities.length) && <Select label="未提供能力信息的模型按此类型添加" data={capabilityOptions} value={manualKind} allowDeselect={false} onChange={(value) => setManualKind(value || "text")} />}</> : <><Textarea label="模型 ID" description="支持逗号或换行分隔；已启用的 ID 会自动跳过。" value={manualIds} onChange={(event) => setManualIds(event.currentTarget.value)} minRows={4} /><Select label="模型能力" data={capabilityOptions} value={manualKind} allowDeselect={false} onChange={(value) => setManualKind(value || "text")} /><Text size="xs" c="dimmed">能力用于筛选；实际调用是否可用，以接口支持和测试结果为准。</Text></>}
      </div><footer className="ai-modal-footer"><Text size="sm">将启用 {addingIds.length} 个新模型</Text><Group><Button variant="default" onClick={closeAdd} disabled={busy === "enable"}>取消</Button><Button onClick={() => void enableModels()} loading={busy === "enable"} disabled={!addProvider || !addingIds.length || addingIds.length > 100 || catalogBusy}>启用 {addingIds.length} 个模型</Button></Group></footer>
    </ResponsiveModal>
    <ResponsiveModal opened={connectionOpen} onClose={() => setConnectionOpen(false)} title={connectionId ? "编辑服务连接" : "添加服务连接"} closeButtonProps={{ "aria-label": "关闭服务连接编辑" }} size="lg" {...formModal}><Stack>{formError && <Alert color="red" role="alert">{formError}</Alert>}<TextInput label="连接名称" placeholder="例如：OpenRouter" value={connection.name} onChange={(event) => setConnection({ ...connection, name: event.currentTarget.value })} /><TextInput label="接口地址" value={connection.baseUrl} onChange={(event) => { const baseUrl = event.currentTarget.value; setConnection({ ...connection, baseUrl, adapterKind: isCivitai({ baseUrl }) ? "civitai" : isSpicyApi({ baseUrl }) ? "spicyapi" : /^https:\/\/openrouter\.ai(?:\/|$)/.test(baseUrl) ? "openrouter" : connection.adapterKind }); }} />{isCivitai(connection) && <Alert color="blue">Civitai 用于生成插图，接口地址可填写 https://civitai.com/api/v1。当前支持 SD1.5、SDXL 系列的 Checkpoint；手动添加时请输入完整 AIR ID，并将能力设为图像生成。</Alert>}<PasswordInput label="API Key" description={connectionId ? "留空保留现有密钥" : undefined} autoComplete="new-password" value={connection.secret} onChange={(event) => setConnection({ ...connection, secret: event.currentTarget.value })} /><details className="ai-advanced"><summary>高级设置</summary><Stack mt="md"><Select label="接口适配" data={[{ value: "openai-compatible", label: "OpenAI 兼容接口" }, { value: "openrouter", label: "OpenRouter（文字与图像）" }, { value: "spicyapi", label: "SpicyAPI（文字、图像与角色库）" }, { value: "civitai", label: "Civitai（图像生成）" }]} value={connection.adapterKind} allowDeselect={false} onChange={(value) => setConnection({ ...connection, adapterKind: value || "openai-compatible" })} /><NumberInput label="请求超时（分钟）" min={0.1} max={10} step={0.1} value={connection.timeoutMinutes} onChange={(value) => setConnection({ ...connection, timeoutMinutes: Number(value) })} /></Stack></details><Group justify="flex-end"><Button variant="default" onClick={() => setConnectionOpen(false)}>取消</Button><Button loading={busy === "connection"} disabled={!connection.name.trim() || !connection.baseUrl.trim() || !Number.isFinite(connection.timeoutMinutes) || connection.timeoutMinutes < 0.1 || connection.timeoutMinutes > 10} onClick={() => void saveConnection()}>保存连接</Button></Group></Stack></ResponsiveModal>
    <ResponsiveModal opened={Boolean(editing)} onClose={() => setEditing(null)} title="编辑模型" closeButtonProps={{ "aria-label": "关闭模型编辑" }} size="lg" {...formModal}><Stack>{formError && <Alert color="red" role="alert">{formError}</Alert>}<Select label="服务连接" data={providerOptions} value={editForm.providerId} allowDeselect={false} onChange={(value) => setEditForm({ ...editForm, providerId: value ?? "" })} /><TextInput label="显示名称" value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.currentTarget.value })} /><TextInput label="模型 ID" value={editForm.modelId} onChange={(event) => setEditForm({ ...editForm, modelId: event.currentTarget.value })} /><Select label="模型能力" description={editing?.metadata?.source === "provider" ? "由服务商目录提供；修改后按手动配置保存。" : "手动确认模型支持的输出类型。"} data={capabilityOptions} value={editForm.kind} allowDeselect={false} onChange={(value) => setEditForm({ ...editForm, kind: value || "text" })} />{editForm.kind !== "image" && <details className="ai-advanced"><summary>文字模型高级设置</summary><Stack mt="md"><NumberInput label="输入上限（字符）" description="应用的输入限制，不代表模型官方上下文容量。" min={MIN_MAX_INPUT_CHARACTERS} max={MAX_MAX_INPUT_CHARACTERS} thousandSeparator="," value={editForm.maxInput} onChange={(value) => setEditForm({ ...editForm, maxInput: Number(value) })} /><ReasoningSettings modelSetting value={editForm.reasoningEffort} onChange={(value) => setEditForm({ ...editForm, reasoningEffort: value ?? null })} /><Textarea label="附加提示词" value={editForm.systemPrompt} minRows={3} autosize onChange={(event) => setEditForm({ ...editForm, systemPrompt: event.currentTarget.value })} /></Stack></details>}{editing && <Text size="xs" c="dimmed">能力来源：{editing.metadata?.source === "provider" ? "服务商目录" : editing.metadata?.source === "manual" ? "手动配置" : "原有文字模型配置"}。图像比例与画质在插图窗口中选择。</Text>}<Group justify="space-between"><Button variant="subtle" color="red" disabled={Boolean(busy)} onClick={() => { if (editing) { const model = editing; setEditing(null); void removeModel(model); } }}>删除模型</Button><Group><Button variant="default" onClick={() => setEditing(null)}>取消</Button><Button loading={busy === "model"} disabled={!editForm.name.trim() || !editForm.modelId.trim() || editForm.maxInput < MIN_MAX_INPUT_CHARACTERS || editForm.maxInput > MAX_MAX_INPUT_CHARACTERS} onClick={() => void saveModel()}>保存模型</Button></Group></Group></Stack></ResponsiveModal>
    <ResponsiveModal opened={Boolean(preview)} onClose={() => setPreview(null)} title="图像测试结果" size="md">{preview && <img className="ai-test-preview" src={preview} alt="图像模型测试生成结果" />}<Button mt="md" onClick={() => setPreview(null)}>关闭预览</Button></ResponsiveModal>
  </div>;
}
