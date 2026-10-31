

export function readableNetworkError(error: unknown, action: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (/^internal error;\s*reference\s*=/i.test(message)) return new Error(`${action}失败：本机 3002 服务无法访问模型 API。请检查：1) 运行 npm run dev 的电脑能否访问模型域名；2) 防火墙是否放行 node 进程的出站 HTTPS；3) 如需代理请先设置 HTTPS_PROXY 再启动服务。`);
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(message)) return new Error(`${action}失败：无法解析模型 API 域名，请检查本机 DNS 或模型地址`);
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|certificate|CERT_|SSL|TLS|fetch failed/i.test(message)) return new Error(`${action}失败：无法连接模型 API（${message.slice(0, 120)}），请检查网络、防火墙或代理设置`);
  return error instanceof Error ? error : new Error(`${action}失败`);
}

export type CompletionDiagnostics = {
  requestId?: string;
  provider?: string;
  finishReason?: string;
  nativeFinishReason?: string;
  errorType?: string;
  errorCode?: string;
  promptTokens?: number;
  completionTokens?: number;
  outputCharacters: number;
  responseHeadersMs: number;
  totalMs: number;
};

export class AiUpstreamCompletionError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly diagnostics: CompletionDiagnostics) {
    super(message);
    this.name = "AiUpstreamCompletionError";
  }
}

export class AiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiInputError";
  }
}

export class AiPromptTooLongError extends AiInputError {
  constructor(message: string, readonly inputCharacters: number, readonly maxInputCharacters: number) {
    super(message);
    this.name = "AiPromptTooLongError";
  }
}
