export type IllustrationPrompt = { excerpt: string; prompt: string; negativePrompt: string };
export type IllustrationImage = { src: string; revisedPrompt?: string };

export const MAX_ILLUSTRATION_CONTENT = 80000;
export const MAX_ILLUSTRATION_EXCERPT = 3000;
export const MAX_ILLUSTRATION_PROMPT = 12000;
export const MAX_ILLUSTRATION_NEGATIVE_PROMPT = 4000;

export function parseIllustrationPrompt(raw: string, content: string, selectedExcerpt = ""): IllustrationPrompt {
  let value: unknown;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("AI 未返回有效的插图提示词，请重新生成"); }
  if (!value || typeof value !== "object") throw new Error("AI 插图提示词格式无效");
  const result = value as Record<string, unknown>;
  const excerpt = typeof result.excerpt === "string" ? result.excerpt.trim() : "";
  const prompt = typeof result.prompt === "string" ? result.prompt.trim() : "";
  const negativePrompt = typeof result.negativePrompt === "string" ? result.negativePrompt.trim() : "";
  if (!excerpt || excerpt.length > MAX_ILLUSTRATION_EXCERPT || !content.includes(excerpt)) throw new Error("AI 选取的片段不在正文中，请重新生成");
  if (selectedExcerpt && excerpt !== selectedExcerpt.trim()) throw new Error("AI 改动了选中的片段，请重新生成");
  if (!prompt || prompt.length > MAX_ILLUSTRATION_PROMPT) throw new Error("AI 返回的图片 prompt 为空或过长，请重新生成");
  if (!negativePrompt || negativePrompt.length > MAX_ILLUSTRATION_NEGATIVE_PROMPT) throw new Error("AI 返回的 Negative Prompt 为空或过长，请重新生成");
  return { excerpt, prompt, negativePrompt };
}

export function parseIllustrationImage(payload: unknown): IllustrationImage {
  const value = payload as { data?: Array<{ b64_json?: unknown; url?: unknown; revised_prompt?: unknown; media_type?: unknown }>; output_format?: string } | null;
  const image = value?.data?.[0];
  if (!image) throw new Error("文生图模型没有返回图片，请检查模型是否支持图片生成");
  let src = "";
  if (typeof image.b64_json === "string" && image.b64_json.length > 0 && image.b64_json.length <= 28_000_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.b64_json)) {
    const mime = typeof image.media_type === "string" ? image.media_type : "";
    const format = mime === "image/jpeg" || value?.output_format === "jpeg" ? "jpeg" : mime === "image/webp" || value?.output_format === "webp" ? "webp" : "png";
    if (mime && !["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new Error("暂不支持此图片格式，请选择 PNG、JPEG 或 WebP");
    src = `data:image/${format};base64,${image.b64_json}`;
  } else if (typeof image.url === "string") {
    try {
      const url = new URL(image.url);
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) src = url.href;
    } catch { /* Report an invalid image below. */ }
  }
  if (!src) throw new Error("文生图模型返回的图片格式无效");
  return { src, revisedPrompt: typeof image.revised_prompt === "string" ? image.revised_prompt.slice(0, MAX_ILLUSTRATION_PROMPT) : undefined };
}
