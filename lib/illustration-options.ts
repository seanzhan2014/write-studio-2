import { DEFAULT_ILLUSTRATION_STYLE, isIllustrationStylePreset, type IllustrationStylePreset } from "./illustration-styles.ts";

export const PROMPT_LANGUAGE_OPTIONS = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
] as const;
export type IllustrationPromptLanguage = typeof PROMPT_LANGUAGE_OPTIONS[number]["value"];
export type IllustrationOptions = {
  promptLanguage: IllustrationPromptLanguage;
  stylePreset: IllustrationStylePreset;
  resolution: string;
};
export const DEFAULT_ILLUSTRATION_OPTIONS: IllustrationOptions = {
  promptLanguage: "zh", stylePreset: DEFAULT_ILLUSTRATION_STYLE, resolution: "",
};
export const ILLUSTRATION_RESOLUTION_OPTIONS = [
  { value: "", label: "模型默认" },
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
  { value: "1024x1024", label: "1024 × 1024" },
  { value: "1536x1024", label: "1536 × 1024" },
  { value: "1024x1536", label: "1024 × 1536" },
];
export function isIllustrationPromptLanguage(value: unknown): value is IllustrationPromptLanguage {
  return value === "zh" || value === "en";
}
export function normalizeIllustrationOptions(value: unknown, fallback = DEFAULT_ILLUSTRATION_OPTIONS): IllustrationOptions {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const base = fallback === DEFAULT_ILLUSTRATION_OPTIONS ? fallback : normalizeIllustrationOptions(fallback);
  return {
    promptLanguage: isIllustrationPromptLanguage(source.promptLanguage) ? source.promptLanguage : base.promptLanguage,
    stylePreset: isIllustrationStylePreset(source.stylePreset) ? source.stylePreset : base.stylePreset,
    resolution: typeof source.resolution === "string" ? source.resolution.trim().slice(0, 100) : base.resolution,
  };
}
// Keep the provider's exact spelling (for example 2K vs 2k).
export function supportedIllustrationResolution(requested: string, values: string[]) {
  return values.find(value => value.toLowerCase() === requested.toLowerCase()) ?? "";
}
