import { DEFAULT_ILLUSTRATION_STYLE, isIllustrationStylePreset, type IllustrationStylePreset } from "./illustration-styles.ts";
import { normalizeSettingInheritance, type SettingInheritance } from "./setting-inheritance.ts";

export const PROMPT_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
] as const;
// Accept older saved language values while generating new prompts in English.
export type IllustrationPromptLanguage = "zh" | "en";
export const MAX_ILLUSTRATION_ADDITIONAL_PROMPT = 8000;
export type IllustrationOptions = {
  quality?: string;
  aspectRatio?: string;
  scenePrompt?: string;
  inheritance?: SettingInheritance;
  promptLanguage: IllustrationPromptLanguage;
  stylePreset: IllustrationStylePreset;
  resolution: string;
  additionalPrompt: string;
};
export const ILLUSTRATION_SETTING_KEYS = ["promptLanguage", "stylePreset", "resolution", "additionalPrompt", "quality", "aspectRatio", "scenePrompt"];
export const DEFAULT_ILLUSTRATION_OPTIONS: IllustrationOptions = {
  promptLanguage: "en", stylePreset: DEFAULT_ILLUSTRATION_STYLE, resolution: "", additionalPrompt: "",
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
    ...(normalizeSettingInheritance(source.inheritance, ILLUSTRATION_SETTING_KEYS) ? { inheritance: normalizeSettingInheritance(source.inheritance, ILLUSTRATION_SETTING_KEYS) } : {}),
    ...Object.fromEntries(["quality", "aspectRatio", "scenePrompt"].filter(key => typeof source[key] === "string" || typeof (base as unknown as Record<string, unknown>)[key] === "string").map(key => [key, String(source[key] ?? (base as unknown as Record<string, unknown>)[key]).slice(0, key === "scenePrompt" ? 2000 : 100)])),
    promptLanguage: "en",
    stylePreset: isIllustrationStylePreset(source.stylePreset) ? source.stylePreset : base.stylePreset,
    resolution: typeof source.resolution === "string" ? source.resolution.trim().slice(0, 100) : base.resolution,
    additionalPrompt: typeof source.additionalPrompt === "string" ? source.additionalPrompt.slice(0, MAX_ILLUSTRATION_ADDITIONAL_PROMPT) : base.additionalPrompt,
  };
}
// Keep the provider's exact spelling (for example 2K vs 2k).
export function supportedIllustrationResolution(requested: string, values: string[]) {
  return values.find(value => value.toLowerCase() === requested.toLowerCase()) ?? "";
}
