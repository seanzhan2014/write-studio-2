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

export const DIALOGUE_DENSITY_LEVELS = ["auto", "low", "balanced", "high"] as const;
export type DialogueDensityLevel = typeof DIALOGUE_DENSITY_LEVELS[number];
export const DEFAULT_DIALOGUE_DENSITY: DialogueDensityLevel = "auto";
export const DIALOGUE_DENSITY_OPTIONS: Array<{ value: DialogueDensityLevel; label: string; description: string }> = [
  { value: "auto", label: "自动", description: "根据大纲、场景和文章风格自然安排对白。" },
  { value: "low", label: "低", description: "以叙述、动作和心理描写为主，保留必要对白。" },
  { value: "balanced", label: "适中", description: "对白与叙述交替，用对白推动情节。" },
  { value: "high", label: "高", description: "更多通过人物交谈展现冲突、关系和信息，同时保留必要描写。" },
];

export function isDialogueDensity(value: unknown): value is DialogueDensityLevel {
  return DIALOGUE_DENSITY_LEVELS.includes(value as DialogueDensityLevel);
}

export function normalizeDialogueDensity(value: unknown): DialogueDensityLevel {
  return isDialogueDensity(value) ? value : DEFAULT_DIALOGUE_DENSITY;
}

export function dialogueDensityLabel(value?: DialogueDensityLevel): string {
  return DIALOGUE_DENSITY_OPTIONS.find((item) => item.value === normalizeDialogueDensity(value))!.label;
}

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
