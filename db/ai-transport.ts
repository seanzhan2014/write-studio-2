import { supportsText } from "@/lib/ai-model-capabilities";

import { isSpicyApi, spicyChatBaseUrl } from "@/lib/spicy-api";
import { isCivitai } from "@/lib/civitai-api";
import { reasoningRequestBody, type ReasoningEffort } from "@/lib/reasoning-options";

import { PreparationResponseError } from "@/lib/writing-preparation";

import { type AiModelRecord, readProviderSecret } from "@/db/ai-models";

import { AiInputError, AiUpstreamCompletionError, type CompletionDiagnostics, readableNetworkError } from "@/db/ai-errors";

export function endpoint(model: AiModelRecord) {
  if (isCivitai(model)) throw new AiInputError("Civitai 连接用于图像生成，请选择其他文字模型");
  if (!supportsText(model)) throw new AiInputError("此模型不支持文字生成，请选择文字模型");
  return `${isSpicyApi(model) ? spicyChatBaseUrl(model.baseUrl) : model.baseUrl.replace(/\/$/, "")}/chat/completions`;
}

export type CompletionErrorPayload = {
  code?: string | number;
  message?: string;
  metadata?: { error_type?: string; provider_code?: string | number };
};

export type ChatCompletionPayload = {
  id?: string;
  model?: string;
  provider?: string;
  error?: CompletionErrorPayload;
  choices?: Array<{
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    message?: { content?: string | Array<{ text?: string }> };
    error?: CompletionErrorPayload;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function isRetryableAiError(error: unknown) {
  if (error instanceof AiUpstreamCompletionError) return error.retryable;
  if (!(error instanceof Error) || error instanceof AiInputError || error instanceof PreparationResponseError) return false;
  return /模型返回 (408|429|500|502|503|504)：|模型请求超时|无法连接模型 API|无法解析模型 API 域名/.test(error.message);
}

export function completionText(value: string | Array<{ text?: string }> | undefined) {
  if (typeof value === "string") return value;
  return Array.isArray(value) ? value.map((item) => item?.text ?? "").join("") : "";
}

export function completionResult(payload: ChatCompletionPayload, handle: Awaited<ReturnType<typeof upstream>>, action: string) {
  const choice = payload.choices?.[0];
  const content = completionText(choice?.message?.content);
  const upstreamError = choice?.error ?? payload.error;
  const finishReason = String(choice?.finish_reason ?? "").trim() || undefined;
  const nativeFinishReason = String(choice?.native_finish_reason ?? "").trim() || undefined;
  const errorType = String(upstreamError?.metadata?.error_type ?? "").trim() || undefined;
  const errorCode = upstreamError?.code == null ? undefined : String(upstreamError.code);
  const diagnostics: CompletionDiagnostics = {
    requestId: String(payload.id ?? "").trim() || undefined,
    provider: String(payload.provider ?? "").trim() || undefined,
    finishReason,
    nativeFinishReason,
    errorType,
    errorCode,
    promptTokens: Number.isFinite(payload.usage?.prompt_tokens) ? Number(payload.usage?.prompt_tokens) : undefined,
    completionTokens: Number.isFinite(payload.usage?.completion_tokens) ? Number(payload.usage?.completion_tokens) : undefined,
    outputCharacters: content.length,
    responseHeadersMs: handle.responseHeadersAt - handle.requestStartedAt,
    totalMs: Date.now() - handle.requestStartedAt,
  };
  const event = { event: "ai_upstream_completion", action, model: handle.model.modelId, ...diagnostics };

  if (finishReason === "length") {
    console.warn(JSON.stringify({ ...event, accepted: false }));
    throw new AiUpstreamCompletionError(`${action}达到模型输出长度上限，已丢弃 ${content.length.toLocaleString("zh-CN")} 字不完整结果；推理也可能占用输出额度，请提高模型输出上限或降低目标字数`, false, diagnostics);
  }
  const nonRetryableError = ["content_policy_violation", "refusal", "invalid_request"].includes(errorType ?? "")
    || finishReason === "content_filter";
  if (upstreamError || finishReason === "error" || finishReason === "content_filter") {
    console.warn(JSON.stringify({ ...event, accepted: false }));
    const reason = errorType || errorCode || finishReason || "unknown";
    throw new AiUpstreamCompletionError(`${action}被上游中断（${reason}），已丢弃 ${content.length.toLocaleString("zh-CN")} 字不完整结果`, !nonRetryableError, diagnostics);
  }
  if (finishReason && finishReason !== "stop") {
    console.warn(JSON.stringify({ ...event, accepted: false }));
    throw new AiUpstreamCompletionError(`${action}以异常原因结束（finish_reason=${finishReason}），未保存返回内容`, false, diagnostics);
  }
  console.info(JSON.stringify({ ...event, accepted: true }));
  return { content, diagnostics };
}

export async function upstream(model: AiModelRecord, messages: Array<{ role: string; content: string }>, signal?: AbortSignal, stream = false, extraBody: Record<string, unknown> = {}, reasoningEffort?: ReasoningEffort | null) {
  const secret = await readProviderSecret(model.providerId);
  if (!secret) throw new Error(`Provider「${model.providerName}」尚未设置 API 密钥，或保存的密钥无法解密；请重新保存密钥`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), model.timeoutMs);
  const cancel = () => controller.abort("cancelled");
  if (signal) signal.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const cleanup = () => {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  };
  try {
    const requestStartedAt = Date.now();
    const response = await fetch(endpoint(model), {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ model: model.modelId, messages, stream, temperature: model.temperature ?? undefined, max_tokens: model.maxOutput ?? undefined, ...extraBody, ...reasoningRequestBody(model, reasoningEffort) }),
    });
    if (!response.ok) {
      const unsafeDetail = (await response.text()).slice(0, 500);
      const detail = unsafeDetail.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").split(secret).join("[REDACTED]");
      throw new Error(`模型返回 ${response.status}：${detail || response.statusText}`);
    }
    return { response, controller, cleanup, model, requestStartedAt, responseHeadersAt: Date.now() };
  } catch (error) {
    cleanup();
    if (controller.signal.aborted) throw new Error(controller.signal.reason === "timeout" ? "模型请求超时" : "模型请求已取消");
    throw readableNetworkError(error, "连接模型服务");
  }
}

export async function consumeUpstream<T>(handle: Awaited<ReturnType<typeof upstream>>, consume: (response: Response) => Promise<T>) {
  try {
    return await consume(handle.response);
  } catch (error) {
    if (handle.controller.signal.aborted) throw new Error(handle.controller.signal.reason === "timeout" ? "模型请求超时" : "模型请求已取消");
    throw readableNetworkError(error, "读取模型响应");
  } finally {
    handle.cleanup();
  }
}

export function sseToTextStream(body: ReadableStream<Uint8Array>, signal: AbortSignal | undefined, upstreamController: AbortController, cleanup: () => void) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let downstreamCancelled = false;
  let cleanedUp = false;
  const cleanupOnce = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    cleanup();
  };
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const activeReader = body.getReader();
      reader = activeReader;
      let buffer = "";
      let finished = false;
      let failed = false;
      let completionSeen = false;
      const emitEvent = (event: string) => {
        for (const rawLine of event.split("\n")) {
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") { finished = true; return; }
          let payload: {
            error?: unknown;
            choices?: Array<{
              delta?: { content?: string | Array<{ text?: string }> };
              text?: string;
              finish_reason?: string | null;
            }>;
          };
          try { payload = JSON.parse(data); } catch { continue; }
          if (payload.error) throw new Error("模型流返回错误，回复未完成");
          const choice = payload.choices?.[0];
          const content = choice?.delta?.content;
          const chunk = typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.map((item) => item?.text ?? "").join("")
              : choice?.text;
          if (chunk) controller.enqueue(encoder.encode(chunk));
          if (choice?.finish_reason === "length") throw new Error("模型输出达到长度限制，回复未完成");
          if (choice?.finish_reason === "error" || choice?.finish_reason === "content_filter") throw new Error("模型中止了回复");
          if (choice?.finish_reason) completionSeen = true;
        }
      };
      const drainEvents = (flush = false) => {
        // SSE permits LF and CRLF. Preserve a trailing CR until the next chunk so
        // a CRLF delimiter split across network chunks is still recognized.
        const normalized = buffer.replace(/\r\n/g, "\n");
        const events = normalized.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          emitEvent(event);
          if (finished) break;
        }
        if (flush && !finished && buffer.trim()) {
          emitEvent(buffer);
          buffer = "";
        }
      };
      try {
        while (!signal?.aborted && !finished) {
          const { done, value } = await activeReader.read();
          if (done) {
            buffer += decoder.decode();
            drainEvents(true);
            if (!finished && !completionSeen) throw new Error("模型连接提前关闭，回复未完成");
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          drainEvents();
        }
        if (finished) await activeReader.cancel().catch(() => undefined);
      } catch (error) {
        failed = true;
        if (!downstreamCancelled && !signal?.aborted) {
          if (upstreamController.signal.aborted) controller.error(new Error(upstreamController.signal.reason === "timeout" ? "模型请求超时" : "模型请求已取消"));
          else controller.error(readableNetworkError(error, "读取模型响应"));
        }
      } finally {
        if (reader === activeReader) reader = undefined;
        activeReader.releaseLock();
        cleanupOnce();
        if (!failed && !signal?.aborted && !downstreamCancelled) {
          try { controller.enqueue(encoder.encode("\u001e")); } catch { /* The downstream may have cancelled. */ }
        }
        try { controller.close(); } catch { /* The stream may already be errored. */ }
      }
    },
    cancel(reason) {
      downstreamCancelled = true;
      if (!upstreamController.signal.aborted) upstreamController.abort("cancelled");
      cleanupOnce();
      // The response body is locked while start() owns its reader. Cancelling the
      // body directly here throws ERR_INVALID_STATE and can terminate Node. Cancel
      // the active reader instead and let start() release its lock in finally.
      return reader?.cancel(reason).catch(() => undefined);
    },
  });
}
