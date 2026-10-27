import type { CatalogModel, ModelCatalog, ModelCatalogPage } from "./ai-model-capabilities";

type Connection = { baseUrl: string; secret: string; modelId: string; timeoutMs: number };
type ImageOptions = { size?: string; quality?: string; aspectRatio?: string; resolution?: string; referenceImages?: string[]; negativePrompt?: string };
type Resource = { id?: number; name?: string; type?: string; mode?: string; supportsGeneration?: boolean; modelVersions?: Version[] };
type Version = { id?: number; name?: string; baseModel?: string; air?: string; supportsGeneration?: boolean };
type Workflow = { id?: string; status?: string; steps?: Array<{ reason?: unknown; blockedReason?: unknown; output?: { images?: Array<{ url?: string }>; blobs?: Array<{ url?: string }> } }> };
const AIR = /^urn:air:(sd1|sdxl):checkpoint:civitai:[1-9]\d*@[1-9]\d*$/;
const PAGE_SIZE = 10;
const MAX_PAGES = 3;
const MAX_RESPONSE_BYTES = 5_000_000;

export function isCivitaiAirQuery(value: string) {
  return /^(?:(?:urn:)?air:|civitai:)/i.test(value.trim()) && !/[?*]/.test(value);
}

export function parseCivitaiAir(value: string) {
  const full = /^(?:urn:)?air:([a-z0-9_-]+):([a-z0-9_-]+):civitai:([1-9]\d*)(?:@([1-9]\d*))?$/i.exec(value.trim());
  const short = /^civitai:([1-9]\d*)@([1-9]\d*)$/i.exec(value.trim());
  if (!full && !short) return null;
  const modelId = full?.[3] ?? short![1], versionId = full?.[4] ?? short?.[2] ?? null;
  if (![modelId, ...(versionId ? [versionId] : [])].every(id => Number.isSafeInteger(Number(id)))) return null;
  return { modelId, versionId, ecosystem: full?.[1].toLowerCase(), type: full?.[2].toLowerCase() };
}

export function isCivitai(provider: { adapterKind?: string; baseUrl?: string }) {
  if (provider.adapterKind === "civitai") return true;
  try { return ["civitai.com", "www.civitai.com", "orchestration.civitai.com"].includes(new URL(provider.baseUrl || "").hostname); } catch { return false; }
}

export function civitaiBaseUrls(baseUrl: string) {
  if (isCivitai({ baseUrl })) return { catalog: "https://civitai.com/api/v1", generation: "https://orchestration.civitai.com/v2/consumer" };
  // An explicitly selected adapter may also use a proxy with a path prefix.
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/(?:api\/v1|v2\/consumer|v1)$/, "");
  url.search = ""; url.hash = "";
  const root = url.href.replace(/\/$/, "");
  return { catalog: `${root}/api/v1`, generation: `${root}/v2/consumer` };
}

function redact(value: unknown, secret: string) {
  return String(value).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").split(secret || "\0").join("[REDACTED]").slice(0, 600);
}

async function api<T>(url: string, secret: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, { signal, headers: { ...(secret ? { Authorization: `Bearer ${secret}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  // Enforce the limit while reading, before buffering a large resource directory.
  const reader = response.body?.getReader();
  let raw = "", bytes = 0;
  if (reader) {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("Civitai 单页响应过大，请稍后刷新目录"); }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
  }
  if (!response.ok) throw new Error(`Civitai 请求失败（${response.status}）：${redact(raw || response.statusText, secret)}`);
  try { return JSON.parse(raw) as T; } catch { throw new Error("Civitai 返回的响应不是有效 JSON"); }
}

function ecosystem(baseModel = "") {
  if (/^SD 1\.[45](?:$| )/.test(baseModel)) return "sd1";
  if (/^SDXL(?:$| )/.test(baseModel) || ["Pony", "Illustrious", "NoobAI"].includes(baseModel)) return "sdxl";
  return null;
}

function sizes(family: string) { return family === "sd1" ? ["512x512", "768x512", "512x768"] : ["1024x1024", "1216x832", "832x1216", "1344x768", "768x1344", "1536x640", "640x1536"]; }

function entries(resource: Resource): CatalogModel[] {
  if (resource?.type !== "Checkpoint" || resource.mode || !resource.supportsGeneration) return [];
  const models: CatalogModel[] = [];
  for (const version of resource.modelVersions ?? []) {
    if (version.supportsGeneration === false) continue;
    const family = ecosystem(version.baseModel);
    const id = version.air || (family && Number.isSafeInteger(resource.id) && Number(resource.id) > 0 && Number.isSafeInteger(version.id) && Number(version.id) > 0 ? `urn:air:${family}:checkpoint:civitai:${resource.id}@${version.id}` : "");
    const match = id.match(AIR);
    if (!match) continue;
    models.push({ id, name: `${resource.name || resource.id} · ${version.name || version.id}`.slice(0, 200), searchTerms: [resource.name, version.name, resource.id, version.id].filter(value => value != null).map(String), metadata: { source: "provider", inputModalities: ["text"], outputModalities: ["image"], supportedParameters: { size: { type: "enum", values: sizes(match[1]) } } } });
  }
  return models;
}

function nextCatalogCursor(metadata: { nextCursor?: string | number; nextPage?: string } | undefined, endpoint: string) {
  if (metadata?.nextCursor != null && String(metadata.nextCursor)) return String(metadata.nextCursor);
  if (!metadata?.nextPage) return null;
  const next = new URL(metadata.nextPage, endpoint), expected = new URL(endpoint);
  if (next.origin !== expected.origin || next.pathname !== expected.pathname) throw new Error("Civitai 返回了无效的目录分页地址");
  const cursor = next.searchParams.get("cursor");
  if (!cursor) throw new Error("Civitai 目录分页缺少游标，搜索尚未完成");
  return cursor;
}

export async function findCivitaiModelByAir(baseUrl: string, secret: string, air: string, signal?: AbortSignal): Promise<ModelCatalogPage> {
  const parsed = typeof air === "string" && air.length <= 200 ? parseCivitaiAir(air) : null;
  if (!parsed) throw new Error("AIR 格式无效，例如 urn:air:sdxl:checkpoint:civitai:101055@128078");
  if (parsed.ecosystem && (!["sd1", "sdxl"].includes(parsed.ecosystem) || parsed.type !== "checkpoint")) throw new Error("此 AIR 不是当前支持的 SD1.5 / SDXL Checkpoint");
  const timeout = AbortSignal.timeout(30_000);
  const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
  const endpoint = civitaiBaseUrls(baseUrl).catalog;
  try {
    let version: (Version & { modelId?: number }) | undefined;
    if (parsed.versionId) {
      version = await api(`${endpoint}/model-versions/${parsed.versionId}`, secret, requestSignal);
      if (String(version?.id) !== parsed.versionId || String(version?.modelId) !== parsed.modelId) throw new Error("AIR 中的模型 ID 与版本 ID 不对应，请检查序列号");
    }
    const resource = await api<Resource>(`${endpoint}/models/${parsed.modelId}`, secret, requestSignal);
    if (String(resource?.id) !== parsed.modelId) throw new Error("Civitai 返回的模型与 AIR 不对应");
    const prefix = parsed.ecosystem ? `urn:air:${parsed.ecosystem}:${parsed.type}:civitai:${parsed.modelId}@` : null;
    const catalog = entries(version ? { ...resource, modelVersions: [version] } : resource).filter(model => {
      const resolved = parseCivitaiAir(model.id);
      return resolved?.modelId === parsed.modelId && (!parsed.versionId || resolved.versionId === parsed.versionId) && (!prefix || model.id.startsWith(prefix));
    });
    if (!catalog.length) throw new Error("AIR 对应模型当前不可用，或不是支持的 SD1.5 / SDXL Checkpoint");
    return { catalog, nextCursor: null, scanned: 1, syncedAt: new Date().toISOString(), warnings: [] };
  } catch (error) {
    if (timeout.aborted) throw new Error("根据 AIR 查询模型超时，请重试");
    if (error instanceof Error && error.message.includes("（404）")) throw new Error("未找到此 AIR 对应的模型或版本，请检查序列号及访问权限");
    throw error;
  }
}

// One bounded upstream request per call. The caller follows every cursor, so a
// complete scan has no page limit and cannot exceed a Worker's request lifetime.
// Avoid Civitai's full-text query: it is not a superset of substring/glob matches.
export async function readCivitaiCatalogPage(baseUrl: string, secret: string, cursor?: string | null, signal?: AbortSignal, hint?: string): Promise<ModelCatalogPage> {
  if (cursor != null && (typeof cursor !== "string" || cursor.length > 8192)) throw new Error("Civitai 目录游标无效");
  if (hint != null && (typeof hint !== "string" || hint.length > 200)) throw new Error("Civitai 搜索关键词无效");
  const timeout = AbortSignal.timeout(30_000);
  const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
  const endpoint = `${civitaiBaseUrls(baseUrl).catalog}/models`;
  const url = new URL(endpoint);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("types", "Checkpoint");
  url.searchParams.set("supportsGeneration", "true");
  url.searchParams.set("primaryFileOnly", "true");
  if (hint?.trim()) url.searchParams.set("query", hint.trim());
  else url.searchParams.set("sort", "Newest");
  if (cursor) url.searchParams.set("cursor", cursor);
  try {
    const payload = await api<{ items?: Resource[]; metadata?: { nextCursor?: string | number; nextPage?: string } }>(url.href, secret, requestSignal);
    if (!Array.isArray(payload?.items)) throw new Error("Civitai 模型目录格式无效");
    const nextCursor = nextCatalogCursor(payload.metadata, endpoint);
    if (nextCursor && nextCursor === cursor) throw new Error("Civitai 返回了重复的目录游标，搜索尚未完成");
    const catalog = [...new Map(payload.items.flatMap(entries).map(model => [model.id, model])).values()];
    return { catalog, scanned: payload.items.length, nextCursor, syncedAt: new Date().toISOString(), warnings: [] };
  } catch (error) {
    if (timeout.aborted) throw new Error("读取 Civitai 目录超时，可继续搜索以重试当前分页");
    throw error;
  }
}

export async function discoverCivitaiCatalog(baseUrl: string, secret: string): Promise<ModelCatalog> {
  const signal = AbortSignal.timeout(30_000);
  const endpoint = `${civitaiBaseUrls(baseUrl).catalog}/models`;
  const catalog = new Map<string, CatalogModel>();
  const warnings: string[] = [];
  let cursor = "", more = false;
  const seen = new Set<string>();
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(endpoint);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("types", "Checkpoint");
      url.searchParams.set("supportsGeneration", "true");
      url.searchParams.set("primaryFileOnly", "true");
      if (cursor) url.searchParams.set("cursor", cursor);
      let payload: { items?: Resource[]; metadata?: { nextCursor?: string | number; nextPage?: string } };
      try { payload = await api(url.href, secret, signal); }
      catch (error) { if (!catalog.size) throw error; warnings.push(`已保留成功获取的模型，后续目录未完成：${redact(error instanceof Error ? error.message : error, secret)}`); break; }
      if (!Array.isArray(payload?.items)) throw new Error("Civitai 模型目录格式无效");
      for (const resource of payload.items) { const model = entries(resource)[0]; if (model) catalog.set(model.id, model); }
      const metadata = payload.metadata;
      cursor = metadata?.nextCursor == null ? "" : String(metadata.nextCursor);
      if (!cursor && metadata?.nextPage) {
        const next = new URL(metadata.nextPage, endpoint);
        const expected = new URL(endpoint);
        if (next.origin !== expected.origin || next.pathname !== expected.pathname) throw new Error("Civitai 返回了无效的目录分页地址");
        cursor = next.searchParams.get("cursor") || "";
      }
      more = Boolean(cursor);
      if (!cursor || seen.has(cursor)) break;
      seen.add(cursor);
    }
    if (!catalog.size) throw new Error("Civitai 未返回可用的 SD1.5 / SDXL Checkpoint，可手动添加对应版本的 AIR ID");
    if (more) warnings.push("Civitai 目录较大，当前分批展示部分热门模型；输入名称或 ID 可搜索完整目录，支持 * 和 ? 通配符。");
    warnings.push("当前支持 SD1.5、SDXL（含 Pony、Illustrious、NoobAI）的 Checkpoint 文生图；暂不支持单独使用 LoRA 或人物参考图。");
    return { catalog: [...catalog.values()].sort((a, b) => a.name.localeCompare(b.name)), syncedAt: new Date().toISOString(), warnings };
  } catch (error) {
    if (signal.aborted) throw new Error("获取 Civitai 模型目录超时，请稍后重试");
    throw error;
  }
}

export function civitaiImageInput(modelId: string, prompt: string, options: ImageOptions = {}) {
  const match = modelId.match(AIR);
  if (!match) throw new Error("Civitai 需要完整的 SD1.5 / SDXL Checkpoint AIR ID，例如 urn:air:sdxl:checkpoint:civitai:101055@128078");
  if (!prompt.trim() || prompt.length > 10_000) throw new Error("Civitai 图片提示词应为 1–10,000 字符");
  if (options.referenceImages?.length) throw new Error("此 Civitai 接入暂不支持人物参考图，请移除参考图后生成");
  if (options.quality || options.resolution || options.aspectRatio) throw new Error("此 Civitai 模型请使用图片尺寸设置，画质、比例和分辨率应选模型默认");
  const size = options.size || sizes(match[1])[0];
  const dimensions = /^(\d{2,4})x(\d{2,4})$/.exec(size);
  const width = Number(dimensions?.[1]), height = Number(dimensions?.[2]);
  if (!dimensions || [width, height].some(value => value < 64 || value > 2048 || value % 16)) throw new Error("Civitai 图片宽高须为 64–2048 且为 16 的倍数");
  // The OpenAPI schema calls this checkpointModel (the recipe prose uses model).
  return { engine: "sdcpp", ecosystem: match[1], operation: "createImage", checkpointModel: modelId, prompt: prompt.trim(), ...(options.negativePrompt?.trim() ? { negativePrompt: options.negativePrompt.trim() } : {}), width, height, quantity: 1 };
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

export async function generateCivitaiImage(connection: Connection, prompt: string, options: ImageOptions = {}, signal?: AbortSignal) {
  const input = civitaiImageInput(connection.modelId, prompt, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), connection.timeoutMs);
  const cancel = () => controller.abort("cancelled");
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const endpoint = `${civitaiBaseUrls(connection.baseUrl).generation}/workflows`;
  const externalId = crypto.randomUUID();
  let workflowId = "", submitted = false;
  try {
    controller.signal.throwIfAborted();
    submitted = true;
    let workflow = await api<Workflow>(`${endpoint}?wait=0`, connection.secret, controller.signal, { externalId, currencies: ["blue", "green", "yellow"], steps: [{ $type: "imageGen", input }] });
    workflowId = workflow?.id || "";
    if (!workflowId) throw new Error("Civitai 未返回生成任务 ID");
    let attempt = 0;
    while (true) {
      if (workflow.status === "succeeded") {
        const outputs = workflow.steps?.flatMap(step => [...(step.output?.images ?? []), ...(step.output?.blobs ?? [])]) ?? [];
        const image = outputs.find(blob => typeof blob.url === "string" && /^https?:\/\//.test(blob.url));
        if (!image) throw new Error("Civitai 任务已完成，但没有返回可用图片");
        return { data: [{ url: image.url }] };
      }
      if (["failed", "expired", "canceled"].includes(workflow.status || "")) {
        const reason = workflow.steps?.find(step => step.reason || step.blockedReason);
        throw new Error(`Civitai 图像任务${workflow.status}：${redact(reason?.reason || reason?.blockedReason || "请在 Civitai 查看任务详情", connection.secret)}`);
      }
      if (!["unassigned", "preparing", "scheduled", "processing"].includes(workflow.status || "")) throw new Error("Civitai 返回了未知任务状态");
      await pause([2000, 5000, 10000, 15000][Math.min(attempt++, 3)], controller.signal);
      workflow = await api<Workflow>(`${endpoint}/${encodeURIComponent(workflowId)}`, connection.secret, controller.signal);
    }
  } catch (error) {
    const detail = controller.signal.aborted ? controller.signal.reason === "timeout" ? "Civitai 图像生成等待超时，可增加连接超时时间" : "已停止等待 Civitai 图像任务" : error instanceof Error ? error.message : "Civitai 图像生成失败";
    throw new Error(`${redact(detail, connection.secret)}${submitted ? `（${workflowId ? `任务 ${redact(workflowId, connection.secret)}` : `请求 ${externalId}`}；请先在 Civitai 确认状态，再重试以避免重复生成）` : ""}`);
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
}
