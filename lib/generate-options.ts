export const DEFAULT_GENERATE_TARGET_WORDS = 5000;
export const MIN_GENERATE_TARGET_WORDS = 100;
export const MAX_GENERATE_TARGET_WORDS = 100000;
export const MAX_GENERATE_PRESETS = 20;
export const MAX_GENERATE_PRESET_CHARACTERS = 500;

export const CONTENT_GENERATION_MODES = ["fresh", "rewrite", "continue"] as const;
export type ContentGenerationMode = typeof CONTENT_GENERATION_MODES[number];

export const REWRITE_RETENTION_LEVELS = ["low", "balanced", "high"] as const;
export type RewriteRetentionLevel = typeof REWRITE_RETENTION_LEVELS[number];
export const DEFAULT_REWRITE_RETENTION_LEVEL: RewriteRetentionLevel = "balanced";

export function isContentGenerationMode(value: unknown): value is ContentGenerationMode {
  return CONTENT_GENERATION_MODES.includes(value as ContentGenerationMode);
}

export function normalizeContentGenerationMode(value: unknown): ContentGenerationMode {
  return isContentGenerationMode(value) ? value : "fresh";
}

export function isRewriteRetentionLevel(value: unknown): value is RewriteRetentionLevel {
  return REWRITE_RETENTION_LEVELS.includes(value as RewriteRetentionLevel);
}

export function normalizeRewriteRetentionLevel(value: unknown): RewriteRetentionLevel {
  return isRewriteRetentionLevel(value) ? value : DEFAULT_REWRITE_RETENTION_LEVEL;
}

export function normalizeGenerateTargetWords(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_GENERATE_TARGET_WORDS;
  if (parsed === 0) return 0;
  return Math.max(MIN_GENERATE_TARGET_WORDS, Math.min(MAX_GENERATE_TARGET_WORDS, parsed));
}

export function normalizeOptionalGenerateTargetWords(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const parsed = Number(value);
  if (parsed === 0) return undefined;
  if (!Number.isInteger(parsed)) return undefined;
  return Math.max(MIN_GENERATE_TARGET_WORDS, Math.min(MAX_GENERATE_TARGET_WORDS, parsed));
}

export function normalizeGeneratePresets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => String(item).trim().slice(0, MAX_GENERATE_PRESET_CHARACTERS))
    .filter(Boolean))]
    .slice(0, MAX_GENERATE_PRESETS);
}
