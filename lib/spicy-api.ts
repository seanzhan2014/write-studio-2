import type { CatalogModel, ModelCatalog } from "./ai-model-capabilities";

type SchemaField = { type?: string; enum?: unknown[]; default?: unknown; minLength?: number; maxLength?: number };
type ImageModel = {
  model?: string; displayName?: string; modality?: string; tasks?: string[];
  enabled?: boolean; available?: boolean;
  inputSchema?: { properties?: Record<string, SchemaField>; required?: string[] };
};
export type SpicyImageOptions = { size?: string; quality?: string; aspectRatio?: string; resolution?: string };
type Task = {
  taskId?: string; state?: string; errorCode?: string; errorMessage?: string;
  output?: { assets?: Array<{ url?: string; mime?: string; pending?: boolean; unavailable?: boolean }> };
};

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
  if (raw.length > 5_000_000) throw new Error("SpicyAPI 响应过大");
  let envelope: { code?: number; msg?: string; data?: T; request_id?: string };
  try { envelope = JSON.parse(raw); }
  catch { throw new Error(`SpicyAPI 返回无效 JSON（HTTP ${response.status}）`); }
  if (!envelope || typeof envelope !== "object") throw new Error("SpicyAPI 返回无效响应结构");
  if (!response.ok || envelope.code !== 200 || !envelope.data) {
    throw new Error(`SpicyAPI 请求失败（HTTP ${response.status}，code=${envelope.code ?? "unknown"}）：${redact(String(envelope.msg || response.statusText), secret)}`);
  }
  return envelope.data;
}

function supportedImageModel(model: ImageModel) {
  return model.enabled === true && model.available === true && model.modality === "image" && model.tasks?.includes("text-to-image");
}

export async function discoverSpicyImageCatalog(baseUrl: string, secret: string): Promise<ModelCatalog> {
  const signal = AbortSignal.timeout(15_000);
  try {
    const data = await api<{ items?: ImageModel[] }>(baseUrl, secret, "/models?modality=image&task=text-to-image&includeSchema=1", signal);
    const catalog: CatalogModel[] = [];
    let unsupported = 0;
    for (const model of data.items ?? []) {
      if (!model.model || !supportedImageModel(model)) continue;
      // Models that require a control/reference image cannot run in this text-to-image UI.
      if (model.inputSchema?.required?.some((key) => key !== "prompt")) { unsupported++; continue; }
      const supportedParameters = Object.fromEntries(Object.entries(model.inputSchema?.properties ?? {}).map(([key, field]) => [key, {
        type: field.type, ...(field.enum ? { values: field.enum } : {}),
      }]));
      catalog.push({ id: model.model, name: model.displayName || model.model, metadata: { source: "provider", inputModalities: ["text"], outputModalities: ["image"], supportedParameters } });
    }
    catalog.sort((a, b) => a.id.localeCompare(b.id));
    if (!catalog.length) throw new Error("SpicyAPI 没有返回当前可调用的文生图模型");
    return { catalog, syncedAt: new Date().toISOString(), warnings: unsupported ? [`已略过 ${unsupported} 个需要参考图片或其他必填参数的模型。`] : [] };
  } catch (error) {
    if (signal.aborted) throw new Error("获取 SpicyAPI 文生图目录超时");
    throw error;
  }
}

export function spicyImageInput(model: ImageModel, prompt: string, options: SpicyImageOptions = {}) {
  if (!supportedImageModel(model)) throw new Error("此 SpicyAPI 模型当前不可调用，或不支持文生图，请刷新目录后重新选择");
  const schema = model.inputSchema;
  const fields = schema?.properties;
  if (!fields?.prompt) throw new Error("SpicyAPI 没有返回此模型的提示词参数结构");
  if (!prompt.trim() || prompt.length < (fields.prompt.minLength ?? 1) || prompt.length > (fields.prompt.maxLength ?? 12000)) throw new Error(`此模型的提示词长度应为 ${fields.prompt.minLength ?? 1}–${fields.prompt.maxLength ?? 12000} 字符`);
  if (schema?.required?.some((key) => key !== "prompt")) throw new Error("此模型还需要参考图片或其他参数，请选择仅需提示词的文生图模型");
  if (options.size && (options.aspectRatio || options.resolution)) throw new Error("尺寸与比例、分辨率请分别选择一种方式");
  const input: Record<string, unknown> = { prompt };
  for (const [key, value] of [["size", options.size], ["quality", options.quality], ["aspect_ratio", options.aspectRatio], ["resolution", options.resolution]] as const) {
    if (!value) continue;
    const field = fields[key];
    if (!field || field.type !== "string" || (field.enum && !field.enum.includes(value))) throw new Error(`此 SpicyAPI 模型不支持所选 ${key} 参数，请刷新目录`);
    input[key] = value;
  }
  // Do not inject OpenAI's n or default size into model-specific schemas.
  if (fields.num_outputs) input.num_outputs = 1;
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

export async function generateSpicyImage(connection: { baseUrl: string; secret: string; modelId: string; timeoutMs: number }, prompt: string, options: SpicyImageOptions = {}, signal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), connection.timeoutMs);
  const cancel = () => controller.abort("cancelled");
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  let taskId = "";
  const { baseUrl, secret, modelId } = connection;
  try {
    const model = await api<ImageModel>(baseUrl, secret, `/models/${modelId.split("/").map(encodeURIComponent).join("/")}`, controller.signal);
    const input = spicyImageInput(model, prompt, options);
    const quote = await api<{ quoteId?: string; estimatedCost?: string }>(baseUrl, secret, "/jobs/quote", controller.signal, { model: modelId, input });
    if (!quote.quoteId || typeof quote.estimatedCost !== "string" || !/^\d+(?:\.\d+)?$/.test(quote.estimatedCost)) throw new Error("SpicyAPI 未返回有效报价，未创建生成任务");
    let task = await api<Task>(baseUrl, secret, "/jobs/createTask", controller.signal, { model: modelId, input, quoteId: quote.quoteId, expectedCost: quote.estimatedCost }, crypto.randomUUID());
    taskId = task.taskId || "";
    if (!taskId) throw new Error("SpicyAPI 未返回任务 ID；请先在服务商后台确认任务状态，避免重复提交");
    let delay = 2000;
    while (true) {
      if (task.state === "succeeded") {
        const assets = task.output?.assets ?? [];
        const image = assets.find((asset) => !asset.pending && !asset.unavailable && asset.url && ["image/png", "image/jpeg", "image/webp"].includes(asset.mime || ""));
        if (image) return { data: [{ url: image.url, media_type: image.mime }] };
        if (!assets.some((asset) => asset.pending && !asset.unavailable)) throw new Error("SpicyAPI 任务已完成，但没有可用的 PNG、JPEG 或 WebP 图片");
      } else if (task.state !== "queued" && task.state !== "running") {
        throw new Error(`SpicyAPI 图像任务失败（${task.errorCode || task.state || "unknown"}）：${task.errorMessage || "请在服务商后台查看任务"}`);
      }
      await pause(delay, controller.signal);
      task = await api<Task>(baseUrl, secret, `/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, controller.signal);
      delay = Math.min(delay + 1000, 10000);
    }
  } catch (error) {
    const detail = controller.signal.aborted
      ? controller.signal.reason === "timeout" ? "SpicyAPI 图像生成等待超时，可增加连接超时时间" : "已停止等待 SpicyAPI 图像任务"
      : error instanceof Error ? error.message : "SpicyAPI 图像生成失败";
    throw new Error(`${redact(detail, secret)}${taskId ? `（任务 ${redact(taskId, secret)}；已提交的远程任务不会因停止等待而取消，请先确认状态再重试）` : ""}`);
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); }
}
