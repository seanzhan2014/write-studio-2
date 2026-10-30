import type { CatalogModel, ModelCatalog } from "./ai-model-capabilities";

import { validateImageParameters, type ImageParameters } from "./image-model-parameters";

type SchemaField = {
  type?: string; enum?: unknown[]; const?: unknown; default?: unknown; minLength?: number; maxLength?: number;
  minimum?: number; maximum?: number; minItems?: number; maxItems?: number; items?: SchemaField;
  properties?: Record<string, SchemaField>; required?: string[]; additionalProperties?: boolean;
  anyOf?: SchemaField[]; oneOf?: SchemaField[]; allOf?: SchemaField[]; if?: SchemaField; then?: SchemaField; else?: SchemaField;
  "x-ui"?: { widget?: string; accept?: string | string[] };
};
type SpicyModel = {
  model?: string; displayName?: string; modality?: string; tasks?: string[];
  enabled?: boolean; available?: boolean;
  inputSchema?: SchemaField;
};
export type SpicyImageOptions = { size?: string; quality?: string; aspectRatio?: string; resolution?: string; referenceImages?: string[]; negativePrompt?: string; parameters?: ImageParameters };
export type SpicyAsset = { id: string; uri: string; name?: string; kind?: string; contentType?: string; previewUrl?: string };
export type SpicyCharacter = { id: string; kind: string; name: string; note?: string; cover?: SpicyAsset | null; assets?: SpicyAsset[]; count?: number; updatedAt?: string };
export type SpicyTask = {
  taskId?: string; state?: string; errorCode?: string; errorMessage?: string;
  output?: { assets?: Array<{ url?: string; key?: string; mime?: string; pending?: boolean; unavailable?: boolean }> };
};
type Task = SpicyTask;

export function isSpicyApi(provider: { adapterKind?: string; baseUrl?: string }) {
  if (provider.adapterKind === "spicyapi") return true;
  try { return new URL(provider.baseUrl || "").hostname === "api.spicyapi.ai"; } catch { return false; }
}

export function spicyApiBaseUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = /\/(?:api\/)?v1$/.test(path) ? path.replace(/\/(?:api\/)?v1$/, "/api/v1") : `${path}/api/v1`;
  url.search = ""; url.hash = "";
  return url.href.replace(/\/$/, "");
}

export function spicyChatBaseUrl(baseUrl: string) { return spicyApiBaseUrl(baseUrl).replace(/\/api\/v1$/, "/v1"); }

function redact(value: string, secret: string) {
  return value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").split(secret || "\0").join("[REDACTED]").slice(0, 500);
}

async function api<T>(baseUrl: string, secret: string, path: string, signal: AbortSignal, body?: unknown, idempotencyKey?: string): Promise<T> {
  const response = await fetch(spicyApiBaseUrl(baseUrl) + path, {
    method: body === undefined ? "GET" : "POST", signal,
    headers: { Authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  if (raw.length > 5_000_000) throw new Error("图像服务响应过大");
  let envelope: { code?: number; msg?: string; data?: T; request_id?: string };
  try { envelope = JSON.parse(raw); }
  catch { throw new Error(`图像服务返回无效 JSON（HTTP ${response.status}）`); }
  if (!envelope || typeof envelope !== "object") throw new Error("图像服务返回无效响应结构");
  if (!response.ok || envelope.code !== 200 || !envelope.data) {
    throw new Error(`图像服务请求失败（HTTP ${response.status}，code=${envelope.code ?? "unknown"}）：${redact(String(envelope.msg || response.statusText), secret)}`);
  }
  return envelope.data;
}

function supportedImageModel(model: SpicyModel) {
  return model.enabled === true && model.available === true && model.modality === "image" && model.tasks?.some(task => ["text-to-image", "image-to-image", "edit"].includes(task));
}

export function spicyReferenceField(schema?: SchemaField): [string, SchemaField] | undefined {
  const fields = Object.entries(schema?.properties ?? {}).filter(([key, field]) => {
    if (/mask|control|depth|pose|edge/i.test(key)) return false;
    const widget = field["x-ui"]?.widget;
    const accept = String(field["x-ui"]?.accept ?? "");
    const imageField = /^(image_url|image_urls|images|image_input|reference_images?|reference_image_urls?)$/.test(key);
    return (imageField || (accept.includes("image") && ["upload", "multi-upload"].includes(widget ?? "")))
      && (field.type === "string" || (field.type === "array" && field.items?.type === "string"));
  });
  return fields.length === 1 ? fields[0] : undefined;
}

function schemaAccepts(schema: SchemaField, value: unknown): boolean {
  if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  if (schema.type === "string" && (typeof value !== "string" || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity))) return false;
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value)) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) return false;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") return false;
  if (schema.type === "array" && !Array.isArray(value)) return false;
  if (Array.isArray(value) && (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity) || (schema.items && !value.every(item => schemaAccepts(schema.items!, item))))) return false;
  if (schema.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) return false;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    if (schema.required?.some(key => !(key in object))) return false;
    if (Object.entries(object).some(([key, item]) => schema.properties?.[key] ? !schemaAccepts(schema.properties[key], item) : schema.additionalProperties === false)) return false;
  }
  if (schema.anyOf && !schema.anyOf.some(branch => schemaAccepts(branch, value))) return false;
  if (schema.oneOf && schema.oneOf.filter(branch => schemaAccepts(branch, value)).length !== 1) return false;
  if (schema.allOf && !schema.allOf.every(branch => schemaAccepts(branch, value))) return false;
  if (schema.if) { const branch = schemaAccepts(schema.if, value) ? schema.then : schema.else; if (branch && !schemaAccepts(branch, value)) return false; }
  return true;
}

export async function listSpicyCharacters(baseUrl: string, secret: string, cursor = "") {
  return api<{ items: SpicyCharacter[]; nextCursor?: string }>(baseUrl, secret, `/assets/entities?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, AbortSignal.timeout(15_000));
}
export async function getSpicyCharacter(baseUrl: string, secret: string, id: string) {
  return api<SpicyCharacter>(baseUrl, secret, `/assets/entities/${encodeURIComponent(id)}`, AbortSignal.timeout(15_000));
}
export async function getSpicyLibraryScope(baseUrl: string, secret: string) {
  const data = await api<{ scope?: { workspaceId?: string } }>(baseUrl, secret, "/assets/usage", AbortSignal.timeout(15_000));
  if (!data.scope?.workspaceId) throw new Error("图像服务尚无可用素材工作区，请先在其网页端创建角色后重试");
  return data.scope.workspaceId;
}
export async function getSpicyAsset(baseUrl: string, secret: string, id: string) {
  return api<SpicyAsset>(baseUrl, secret, `/assets/${encodeURIComponent(id)}`, AbortSignal.timeout(15_000));
}

export async function discoverSpicyCatalog(baseUrl: string, secret: string): Promise<ModelCatalog> {
  const signal = AbortSignal.timeout(15_000);
  try {
    const data = await api<{ items?: SpicyModel[] }>(baseUrl, secret, "/models?includeSchema=1", signal);
    const catalog: CatalogModel[] = [];
    let unsupported = 0;
    for (const model of data.items ?? []) {
      if (!model.model || model.enabled !== true || model.available !== true) continue;
      if (model.modality === "text" && model.tasks?.includes("chat")) {
        const supportedParameters = Object.fromEntries(Object.entries(model.inputSchema?.properties ?? {}).map(([key, field]) => [key, {
          type: field.type, ...(field.enum ? { values: field.enum } : {}),
        }]));
        catalog.push({ id: model.model, name: model.displayName || model.model, metadata: { source: "provider", inputModalities: ["text"], outputModalities: ["text"], supportedParameters } });
        continue;
      }
      if (!supportedImageModel(model)) continue;
      const reference = spicyReferenceField(model.inputSchema);
      if (!model.inputSchema?.properties?.prompt || model.inputSchema.required?.some(key => key !== "prompt" && key !== reference?.[0]) || (!model.tasks?.includes("text-to-image") && !reference)) { unsupported++; continue; }
      const supportedParameters = Object.fromEntries(Object.entries(model.inputSchema?.properties ?? {}).map(([key, field]) => [key, {
        type: field.type, ...(field.enum ? { values: field.enum } : {}),
        ...(reference?.[0] === key ? { referenceImage: true, maxImages: field.type === "array" ? field.maxItems ?? null : 1, required: Boolean(model.inputSchema?.required?.includes(key)) || !model.tasks?.includes("text-to-image") } : {}),
      }]));
      catalog.push({ id: model.model, name: model.displayName || model.model, metadata: { source: "provider", inputModalities: reference ? ["text", "image"] : ["text"], outputModalities: ["image"], supportedParameters } });
    }
    catalog.sort((a, b) => a.id.localeCompare(b.id));
    if (!catalog.length) throw new Error("服务没有返回当前可调用的文字或图片模型");
    return { catalog, syncedAt: new Date().toISOString(), warnings: unsupported ? [`已略过 ${unsupported} 个需要额外必填参数或暂不支持的参考图结构的模型。`] : [] };
  } catch (error) {
    if (signal.aborted) throw new Error("获取服务模型目录超时");
    throw error;
  }
}

export function spicyImageInput(model: SpicyModel, prompt: string, options: SpicyImageOptions = {}) {
  if (!supportedImageModel(model)) throw new Error("此图像模型当前不可调用，或不支持图片生成，请刷新目录后重新选择");
  const schema = model.inputSchema;
  const fields = schema?.properties;
  if (!fields?.prompt) throw new Error("图像服务没有返回此模型的提示词参数结构");
  if (!prompt.trim() || prompt.length < (fields.prompt.minLength ?? 1) || prompt.length > (fields.prompt.maxLength ?? 12000)) throw new Error(`此模型的提示词长度应为 ${fields.prompt.minLength ?? 1}–${fields.prompt.maxLength ?? 12000} 字符`);
  if (options.size && (options.aspectRatio || options.resolution)) throw new Error("尺寸与比例、分辨率请分别选择一种方式");
  const parameters = validateImageParameters(options.parameters, { adapterKind: "spicyapi" });
  const input: Record<string, unknown> = { ...parameters, prompt };
  if (options.negativePrompt?.trim()) {
    const key = ["negative_prompt", "negativePrompt"].find(key => fields[key]?.type === "string");
    if (key) input[key] = options.negativePrompt.trim();
    else input.prompt = `${prompt}\n\nNegative prompt (elements to avoid):\n${options.negativePrompt.trim()}`;
    if (String(input.prompt).length > (fields.prompt.maxLength ?? 12000)) throw new Error("加入 Negative Prompt 后超过此模型的提示词长度上限");
  }
  const reference = spicyReferenceField(schema);
  if (options.referenceImages?.length) {
    if (!reference) throw new Error("此模型不支持人物参考图，请刷新目录并选择支持参考图的模型");
    const [key, field] = reference;
    const limit = field.type === "array" ? field.maxItems ?? Infinity : 1;
    if (options.referenceImages.length > limit) throw new Error(`此模型最多支持 ${limit} 张参考图，请减少人物参考图后重试`);
    if (options.referenceImages.some(uri => !/^spicy:\/\/[af]\/[\w-]+$/.test(uri))) throw new Error("人物参考图引用无效");
    input[key] = field.type === "array" ? options.referenceImages : options.referenceImages[0];
  } else if (!model.tasks?.includes("text-to-image")) throw new Error("此模型需要人物参考图，请先选择已绑定形象的人物");
  for (const [key, value] of [["size", options.size], ["quality", options.quality], ["aspect_ratio", options.aspectRatio], ["resolution", options.resolution]] as const) {
    if (!value) continue;
    const field = fields[key];
    if (!field || field.type !== "string" || (field.enum && !field.enum.includes(value))) throw new Error(`此图像模型不支持所选 ${key} 参数，请刷新目录`);
    input[key] = value;
  }
  // Do not inject OpenAI's n or default size into model-specific schemas.
  if (fields.num_outputs && input.num_outputs === undefined) input.num_outputs = 1;
  if (!schemaAccepts(schema!, input)) throw new Error("图片参数不符合此模型的实时结构，请检查参考图数量或刷新模型目录");
  return input;
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// A portrait job persists this exact quoted request before submitting it. A
// lost create response can therefore be replayed with its original identity.
export async function prepareSpicyPhoto(baseUrl: string, secret: string, modelId: string, prompt: string, options: SpicyImageOptions) {
  const signal = AbortSignal.timeout(30_000);
  const model = await api<SpicyModel>(baseUrl, secret, `/models/${modelId.split("/").map(encodeURIComponent).join("/")}`, signal);
  const input = spicyImageInput(model, prompt, options);
  const quote = await api<{ quoteId?: string; estimatedCost?: string }>(baseUrl, secret, "/jobs/quote", signal, { model: modelId, input });
  if (!quote.quoteId || typeof quote.estimatedCost !== "string" || !/^\d+(?:\.\d+)?$/.test(quote.estimatedCost)) throw new Error("未取得有效报价，未提交图像任务");
  return { model: modelId, input, quoteId: quote.quoteId, expectedCost: quote.estimatedCost };
}
export function submitSpicyPhoto(baseUrl: string, secret: string, body: unknown, id: string) {
  return api<SpicyTask>(baseUrl, secret, "/jobs/createTask", AbortSignal.timeout(30_000), body, id);
}
export function querySpicyPhoto(baseUrl: string, secret: string, id: string) {
  return api<SpicyTask>(baseUrl, secret, `/jobs/recordInfo?taskId=${encodeURIComponent(id)}`, AbortSignal.timeout(20_000));
}
export async function uploadSpicyPhoto(baseUrl: string, secret: string, bytes: Uint8Array, mime: string) {
  if (bytes.length > 10 * 1024 * 1024) throw new Error("此图像服务的参考照片上限为 10 MB");
  const ticket = await api<{ fileId: string; uploadUrl: string; headers?: Record<string, string>; maxBytes?: number; method?: string }>(baseUrl, secret, "/common/upload-url", AbortSignal.timeout(20_000), { contentType: mime, bytes: bytes.length });
  if (!ticket.fileId || !ticket.uploadUrl || (ticket.maxBytes && bytes.length > ticket.maxBytes)) throw new Error("图像服务上传票据无效或照片过大");
  const url = new URL(ticket.uploadUrl);
  if (url.protocol !== "https:" && !(typeof process !== "undefined" && process.env.WRITER_STUDIO_TEST_MODE === "1")) throw new Error("图像服务返回了无效上传地址");
  const headers = new Headers(ticket.headers);
  headers.delete("authorization");
  const put = await fetch(url, { method: "PUT", headers, body: bytes as BodyInit, redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!put.ok) throw new Error(`参考照片上传失败（${put.status}）`);
  const committed = await api<{ status: string; uri: string }>(baseUrl, secret, `/files/${encodeURIComponent(ticket.fileId)}/commit`, AbortSignal.timeout(20_000), {});
  if (committed.status !== "ready" || !/^spicy:\/\/f\/[\w-]+$/.test(committed.uri)) throw new Error("参考照片尚未就绪，请稍后重试");
  return { fileId: ticket.fileId, uri: committed.uri };
}
export function saveSpicyPhoto(baseUrl: string, secret: string, source: { source: "upload"; fileId: string; name: string } | { source: "task_output"; taskId: string; index: number; name: string }, id: string) {
  return api<SpicyAsset>(baseUrl, secret, "/assets", AbortSignal.timeout(30_000), source, id);
}

export async function generateSpicyImage(connection: { baseUrl: string; secret: string; modelId: string; timeoutMs: number }, prompt: string, options: SpicyImageOptions = {}, signal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), connection.timeoutMs);
  const cancel = () => controller.abort("cancelled");
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  let taskId = "";
  const { baseUrl, secret, modelId } = connection;
  try {
    const model = await api<SpicyModel>(baseUrl, secret, `/models/${modelId.split("/").map(encodeURIComponent).join("/")}`, controller.signal);
    const input = spicyImageInput(model, prompt, options);
    const quote = await api<{ quoteId?: string; estimatedCost?: string }>(baseUrl, secret, "/jobs/quote", controller.signal, { model: modelId, input });
    if (!quote.quoteId || typeof quote.estimatedCost !== "string" || !/^\d+(?:\.\d+)?$/.test(quote.estimatedCost)) throw new Error("图像服务未返回有效报价，未创建生成任务");
    let task = await api<Task>(baseUrl, secret, "/jobs/createTask", controller.signal, { model: modelId, input, quoteId: quote.quoteId, expectedCost: quote.estimatedCost }, crypto.randomUUID());
    taskId = task.taskId || "";
    if (!taskId) throw new Error("图像服务未返回任务 ID；请先在服务商后台确认任务状态，避免重复提交");
    let delay = 2000;
    while (true) {
      if (task.state === "succeeded") {
        const assets = task.output?.assets ?? [];
        const image = assets.find((asset) => !asset.pending && !asset.unavailable && asset.url && ["image/png", "image/jpeg", "image/webp"].includes(asset.mime || ""));
        if (image) return { data: [{ url: image.url, media_type: image.mime }] };
        if (!assets.some((asset) => asset.pending && !asset.unavailable)) throw new Error("图像服务任务已完成，但没有可用的 PNG、JPEG 或 WebP 图片");
      } else if (task.state !== "queued" && task.state !== "running") {
        throw new Error(`图像任务失败（${task.errorCode || task.state || "unknown"}）：${task.errorMessage || "请在服务商后台查看任务"}`);
      }
      await pause(delay, controller.signal);
      task = await api<Task>(baseUrl, secret, `/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, controller.signal);
      delay = Math.min(delay + 1000, 10000);
    }
  } catch (error) {
    const detail = controller.signal.aborted
      ? controller.signal.reason === "timeout" ? "图像生成等待超时，可增加连接超时时间" : "已停止等待图像任务"
      : error instanceof Error ? error.message : "图像生成失败";
    throw new Error(`${redact(detail, secret)}${taskId ? `（任务 ${redact(taskId, secret)}；已提交的远程任务不会因停止等待而取消，请先确认状态再重试）` : ""}`);
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
}
