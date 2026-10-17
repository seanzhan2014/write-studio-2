import path from "node:path";
import { databasePath, isCloudDatabase } from "./sqlite";

type Bucket = {
  put(key: string, value: Uint8Array, options?: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; } | null>;
  delete(key: string): Promise<unknown>;
};
const bucketSymbol = Symbol.for("writer-studio.illustration-bucket");
function bucket() {
  const value = (globalThis as typeof globalThis & { [bucketSymbol]?: Bucket })[bucketSymbol];
  if (!value) throw new Error("插图存储尚未配置，请检查服务端存储配置");
  return value;
}
const MAX_BYTES = 20 * 1024 * 1024;
function filePath(key: string) {
  if (!/^illustrations\/[a-f0-9-]+$/.test(key)) throw new Error("插图文件标识无效");
  return path.join(path.dirname(databasePath()), key);
}
function checkRemoteUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost = hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || !hostname.includes(".") || hostname.includes(":") || /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./.test(hostname);
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol) || (privateHost && process.env.WRITER_STUDIO_TEST_MODE !== "1")) throw new Error("图片服务返回了不可保存的图片地址");
  return url;
}
async function readRemote(src: string, signal: AbortSignal) {
  let url = checkRemoteUrl(src);
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(url, { signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = checkRemoteUrl(new URL(response.headers.get("location") || "", url).href);
      continue;
    }
    if (!response.ok || !response.body) throw new Error("无法下载模型生成的图片，请重试");
    if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body.cancel(); throw new Error("图片超过 20 MB，无法保存"); }
    const reader = response.body.getReader();
    const parts: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) throw new Error("图片超过 20 MB，无法保存");
        parts.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return bytes;
  }
  throw new Error("图片地址重定向过多，无法保存");
}
export async function saveIllustrationAsset(src: string, restoreKey?: string) {
  let bytes: Uint8Array;
  const inline = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (inline) {
    if (inline[2].length > Math.ceil(MAX_BYTES * 4 / 3)) throw new Error("图片超过 20 MB，无法保存");
    bytes = Uint8Array.from(atob(inline[2]), character => character.charCodeAt(0));
  } else bytes = await readRemote(src, AbortSignal.timeout(30_000));
  const head = Array.from(bytes.subarray(0, 12));
  const mime = head.slice(0, 8).join() === "137,80,78,71,13,10,26,10" ? "image/png"
    : head[0] === 255 && head[1] === 216 && head[2] === 255 ? "image/jpeg"
    : String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP" ? "image/webp" : "";
  if (!mime || !bytes.length || bytes.length > MAX_BYTES) throw new Error("图片不是有效的 PNG、JPEG 或 WebP，无法保存");
  const key = restoreKey ?? `illustrations/${crypto.randomUUID()}`;
  if (!/^illustrations\/[a-f0-9-]+$/.test(key)) throw new Error("图片文件标识无效");
  if (isCloudDatabase()) await bucket().put(key, bytes, { httpMetadata: { contentType: mime } });
  else {
    const fs = await import("node:fs/promises");
    const destination = filePath(key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { flag: "wx" });
  }
  return { key, mime };
}
export async function readIllustrationAsset(key: string) {
  if (isCloudDatabase()) return (await bucket().get(key))?.body ?? null;
  try { return new Uint8Array(await (await import("node:fs/promises")).readFile(filePath(key))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function deleteIllustrationAsset(key: string) {
  if (isCloudDatabase()) await bucket().delete(key);
  else await (await import("node:fs/promises")).rm(filePath(key), { force: true });
}
