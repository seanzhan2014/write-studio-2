/** Cloudflare Worker entry point for Writer Studio. */
import { DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES, handleImageOptimization } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

type D1PreparedStatementLike = {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  run: <T = Record<string, unknown>>() => Promise<{ success: boolean; results?: T[]; meta?: { changes?: number; last_row_id?: number } }>;
  all: <T = Record<string, unknown>>() => Promise<{ success: boolean; results?: T[]; meta?: { changes?: number; last_row_id?: number } }>;
  first: <T = Record<string, unknown>>(column?: string) => Promise<T | null>;
};

type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatementLike;
  batch: <T = Record<string, unknown>>(statements: D1PreparedStatementLike[]) => Promise<Array<{ success: boolean; results?: T[]; meta?: { changes?: number; last_row_id?: number } }>>;
};

const cloudDatabaseSymbol = Symbol.for("writer-studio.cloud-database");

function setCloudDatabase(database: D1DatabaseLike | undefined) {
  (globalThis as typeof globalThis & { [cloudDatabaseSymbol]?: D1DatabaseLike })[cloudDatabaseSymbol] = database;
}

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: D1DatabaseLike;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    setCloudDatabase(env?.DB);
    const url = new URL(request.url);
    if (url.pathname === "/_vinext/image" && env?.ASSETS && env.IMAGES) {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
