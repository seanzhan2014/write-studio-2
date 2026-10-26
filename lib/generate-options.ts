import { isReasoningEffort, type ReasoningEffort } from "./reasoning-options.ts";
import { GENERATE_FIELDS, normalizeAdvanced, type GenerateAdvanced } from "./advanced-writing.ts";
import { normalizeSettingInheritance, type SettingInheritance } from "./setting-inheritance.ts";
import { TASK_PARAMETER_FIELDS, normalizeTaskParameters, type TaskParameters } from "./task-parameters.ts";

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

export const PROSE_DENSITY_LEVELS = ["auto", "low", "balanced", "high"] as const;
export type ProseDensityLevel = typeof PROSE_DENSITY_LEVELS[number];
export const NARRATIVE_PACE_LEVELS = ["auto", "slow", "balanced", "fast"] as const;
export type NarrativePaceLevel = typeof NARRATIVE_PACE_LEVELS[number];
export const PARAGRAPH_LENGTH_LEVELS = ["auto", "short", "balanced", "long"] as const;
export type ParagraphLengthLevel = typeof PARAGRAPH_LENGTH_LEVELS[number];

export const DIALOGUE_DENSITY_LEVELS = PROSE_DENSITY_LEVELS;
export type DialogueDensityLevel = ProseDensityLevel;
export type IntrospectionDensityLevel = ProseDensityLevel;
export type DescriptionDetailLevel = ProseDensityLevel;

export type ProseControls = {
  dialogueDensity: DialogueDensityLevel;
  introspectionDensity: IntrospectionDensityLevel;
  descriptionDetail: DescriptionDetailLevel;
  narrativePace: NarrativePaceLevel;
  paragraphLength: ParagraphLengthLevel;
};

export type AiGenerateOptions = {
  tasks?: TaskParameters;
  inheritance?: SettingInheritance;
  advanced: GenerateAdvanced;
  model: string;
  /** undefined inherits the model setting; null explicitly omits the parameter. */
  reasoningEffort?: ReasoningEffort | null;
  targetWords: number;
  contentMode: ContentGenerationMode;
  rewriteRetention: RewriteRetentionLevel;
  proseControls: ProseControls;
  includePrevious: boolean;
  includeCharacters: boolean;
  includeExcellentFragments: boolean;
  includeOutlineTitle: boolean;
  includeClosingSummary: boolean;
  reviewMaxRounds: number;
  reviewInstruction: string;
  firstAppearanceOverrides: Record<string, boolean>;
};

export const DEFAULT_DIALOGUE_DENSITY: DialogueDensityLevel = "auto";
export const DEFAULT_PROSE_CONTROLS: ProseControls = {
  dialogueDensity: DEFAULT_DIALOGUE_DENSITY,
  introspectionDensity: "auto",
  descriptionDetail: "auto",
  narrativePace: "auto",
  paragraphLength: "auto",
};

export const DEFAULT_AI_GENERATE_OPTIONS: AiGenerateOptions = {
  advanced: {},
  model: "",
  reasoningEffort: undefined,
  targetWords: DEFAULT_GENERATE_TARGET_WORDS,
  contentMode: "fresh",
  rewriteRetention: DEFAULT_REWRITE_RETENTION_LEVEL,
  proseControls: DEFAULT_PROSE_CONTROLS,
  includePrevious: true,
  includeCharacters: true,
  includeExcellentFragments: false,
  includeOutlineTitle: false,
  includeClosingSummary: false,
  reviewMaxRounds: 0,
  reviewInstruction: "",
  firstAppearanceOverrides: {},
};

export const DIALOGUE_DENSITY_OPTIONS: Array<{ value: DialogueDensityLevel; label: string; description: string }> = [
  { value: "auto", label: "自动", description: "根据大纲、场景和文章风格自然安排对白。" },
  { value: "low", label: "低", description: "以叙述、动作和心理描写为主，保留必要对白。" },
  { value: "balanced", label: "适中", description: "对白与叙述交替，用对白推动情节。" },
  { value: "high", label: "高", description: "更多通过人物交谈展现冲突、关系和信息，同时保留必要描写。" },
];

export const INTROSPECTION_DENSITY_OPTIONS: Array<{ value: IntrospectionDensityLevel; label: string; description: string }> = [
  { value: "auto", label: "自动", description: "根据视角人物、场景需要和文章风格自然安排内心活动。" },
  { value: "low", label: "少", description: "减少直接心理解释，主要通过行动、对白和可观察反应呈现人物。" },
  { value: "balanced", label: "适中", description: "在关键判断和情绪变化处进入人物内心，避免持续自我解释。" },
  { value: "high", label: "多", description: "更充分呈现视角人物的判断、犹豫、联想和情绪变化。" },
];

export const DESCRIPTION_DETAIL_OPTIONS: Array<{ value: DescriptionDetailLevel; label: string; description: string }> = [
  { value: "auto", label: "自动", description: "根据场景重要性和文章风格自然决定描写细度。" },
  { value: "low", label: "简练", description: "只保留定位场景、支撑行动和情绪所需的关键细节。" },
  { value: "balanced", label: "适中", description: "使用有选择的环境与感官细节建立空间、气氛和动作连续性。" },
  { value: "high", label: "细腻", description: "增加具体而有意义的环境、感官和身体感受，避免堆砌形容词。" },
];

export const NARRATIVE_PACE_OPTIONS: Array<{ value: NarrativePaceLevel; label: string; description: string }> = [
  { value: "auto", label: "自动", description: "根据大纲事件、场景性质和文章风格自然安排推进速度。" },
  { value: "slow", label: "舒缓", description: "放大关键时刻和过程，允许更多停顿、观察与情绪发酵。" },
  { value: "balanced", label: "适中", description: "场景展开与事件推进保持平衡，详略随情节重要性变化。" },
  { value: "fast", label: "紧凑", description: "减少无后果的停顿和重复说明，让行动、信息或局势持续变化。" },
];

export const PARAGRAPH_LENGTH_OPTIONS: Array<{ value: ParagraphLengthLevel; label: string; description: string }> = [
  { value: "auto", label: "自动", description: "根据对话、动作、转场和文章风格自然安排段落长度。" },
  { value: "short", label: "短", description: "以较短段落形成轻快、清晰的阅读节奏，但避免机械地一句一段。" },
  { value: "balanced", label: "适中", description: "长短段落自然交替，每段围绕一个连贯的叙事单元展开。" },
  { value: "long", label: "长", description: "允许较完整地展开动作、观察和思绪，但不把无关内容强行合并。" },
];

export function isDialogueDensity(value: unknown): value is DialogueDensityLevel {
  return DIALOGUE_DENSITY_LEVELS.includes(value as DialogueDensityLevel);
}

export function normalizeDialogueDensity(value: unknown): DialogueDensityLevel {
  return isDialogueDensity(value) ? value : DEFAULT_DIALOGUE_DENSITY;
}

export function isNarrativePace(value: unknown): value is NarrativePaceLevel {
  return NARRATIVE_PACE_LEVELS.includes(value as NarrativePaceLevel);
}

export function isParagraphLength(value: unknown): value is ParagraphLengthLevel {
  return PARAGRAPH_LENGTH_LEVELS.includes(value as ParagraphLengthLevel);
}

export function isProseControls(value: unknown): value is Partial<ProseControls> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const controls = value as Record<string, unknown>;
  return (controls.dialogueDensity === undefined || isDialogueDensity(controls.dialogueDensity))
    && (controls.introspectionDensity === undefined || isDialogueDensity(controls.introspectionDensity))
    && (controls.descriptionDetail === undefined || isDialogueDensity(controls.descriptionDetail))
    && (controls.narrativePace === undefined || isNarrativePace(controls.narrativePace))
    && (controls.paragraphLength === undefined || isParagraphLength(controls.paragraphLength));
}

export function normalizeProseControls(value: unknown, legacyDialogueDensity?: unknown): ProseControls {
  const controls = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    dialogueDensity: normalizeDialogueDensity(controls.dialogueDensity ?? legacyDialogueDensity),
    introspectionDensity: isDialogueDensity(controls.introspectionDensity) ? controls.introspectionDensity : "auto",
    descriptionDetail: isDialogueDensity(controls.descriptionDetail) ? controls.descriptionDetail : "auto",
    narrativePace: isNarrativePace(controls.narrativePace) ? controls.narrativePace : "auto",
    paragraphLength: isParagraphLength(controls.paragraphLength) ? controls.paragraphLength : "auto",
  };
}

export function hasActiveProseControls(value: unknown, legacyDialogueDensity?: unknown) {
  return Object.values(normalizeProseControls(value, legacyDialogueDensity)).some((setting) => setting !== "auto");
}

export function dialogueDensityLabel(value?: DialogueDensityLevel): string {
  return DIALOGUE_DENSITY_OPTIONS.find((item) => item.value === normalizeDialogueDensity(value))!.label;
}

export function introspectionDensityLabel(value?: IntrospectionDensityLevel): string {
  return INTROSPECTION_DENSITY_OPTIONS.find((item) => item.value === (isDialogueDensity(value) ? value : "auto"))!.label;
}

export function descriptionDetailLabel(value?: DescriptionDetailLevel): string {
  return DESCRIPTION_DETAIL_OPTIONS.find((item) => item.value === (isDialogueDensity(value) ? value : "auto"))!.label;
}

export function narrativePaceLabel(value?: NarrativePaceLevel): string {
  return NARRATIVE_PACE_OPTIONS.find((item) => item.value === (isNarrativePace(value) ? value : "auto"))!.label;
}

export function paragraphLengthLabel(value?: ParagraphLengthLevel): string {
  return PARAGRAPH_LENGTH_OPTIONS.find((item) => item.value === (isParagraphLength(value) ? value : "auto"))!.label;
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

function optionRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeFirstAppearanceOverrides(value: unknown): Record<string, boolean> {
  const source = optionRecord(value);
  const normalized: Record<string, boolean> = {};
  for (const [id, selected] of Object.entries(source)) {
    if (Object.keys(normalized).length >= 500) break;
    if (id.length > 0 && id.length <= 240 && typeof selected === "boolean") normalized[id] = selected;
  }
  return normalized;
}

export function normalizeAiGenerateOptions(value: unknown, fallback: AiGenerateOptions = DEFAULT_AI_GENERATE_OPTIONS): AiGenerateOptions {
  const source = optionRecord(value);
  const base = fallback === DEFAULT_AI_GENERATE_OPTIONS ? DEFAULT_AI_GENERATE_OPTIONS : normalizeAiGenerateOptions(fallback);
  const hasRequestedReasoning = Object.prototype.hasOwnProperty.call(source, "reasoningEffort");
  const requestedReasoning = hasRequestedReasoning ? source.reasoningEffort : base.reasoningEffort;
  const reasoningEffort = hasRequestedReasoning && requestedReasoning === undefined
    ? undefined
    : requestedReasoning === null
    ? null
    : isReasoningEffort(requestedReasoning)
      ? requestedReasoning
      : base.reasoningEffort;
  const targetWords = Object.prototype.hasOwnProperty.call(source, "targetWords")
    ? normalizeGenerateTargetWords(source.targetWords)
    : base.targetWords;
  const reviewRounds = Number(source.reviewMaxRounds ?? base.reviewMaxRounds);
  return {
    ...(source.tasks || base.tasks ? { tasks: { ...normalizeTaskParameters(base.tasks), ...normalizeTaskParameters(source.tasks) } } : {}),
    ...(normalizeSettingInheritance(source.inheritance, GENERATE_SETTING_KEYS) ? { inheritance: normalizeSettingInheritance(source.inheritance, GENERATE_SETTING_KEYS) } : {}),
    advanced: { ...normalizeAdvanced(base.advanced, GENERATE_FIELDS), ...normalizeAdvanced(source.advanced, GENERATE_FIELDS) },
    model: String(source.model ?? base.model).trim().slice(0, 300),
    reasoningEffort,
    targetWords,
    contentMode: isContentGenerationMode(source.contentMode) ? source.contentMode : base.contentMode,
    rewriteRetention: isRewriteRetentionLevel(source.rewriteRetention) ? source.rewriteRetention : base.rewriteRetention,
    proseControls: normalizeProseControls(source.proseControls ?? base.proseControls),
    includePrevious: typeof source.includePrevious === "boolean" ? source.includePrevious : base.includePrevious,
    includeCharacters: typeof source.includeCharacters === "boolean" ? source.includeCharacters : base.includeCharacters,
    includeExcellentFragments: typeof source.includeExcellentFragments === "boolean" ? source.includeExcellentFragments : base.includeExcellentFragments,
    includeOutlineTitle: typeof source.includeOutlineTitle === "boolean" ? source.includeOutlineTitle : base.includeOutlineTitle,
    includeClosingSummary: typeof source.includeClosingSummary === "boolean" ? source.includeClosingSummary : base.includeClosingSummary,
    reviewMaxRounds: Number.isInteger(reviewRounds) ? Math.max(0, Math.min(10, reviewRounds)) : base.reviewMaxRounds,
    reviewInstruction: String(source.reviewInstruction ?? base.reviewInstruction).slice(0, 20_000),
    firstAppearanceOverrides: Object.prototype.hasOwnProperty.call(source, "firstAppearanceOverrides")
      ? normalizeFirstAppearanceOverrides(source.firstAppearanceOverrides)
      : { ...base.firstAppearanceOverrides },
  };
}

export const GENERATE_SETTING_KEYS = [
  ...Object.keys(DEFAULT_AI_GENERATE_OPTIONS).filter(key => key !== "advanced" && key !== "proseControls"),
  ...Object.keys(GENERATE_FIELDS).map(key => `advanced.${key}`),
  ...Object.keys(DEFAULT_PROSE_CONTROLS).map(key => `proseControls.${key}`),
  ...TASK_PARAMETER_FIELDS.map(field => `tasks.${field.key}`),
];

export function normalizeGeneratePresets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => String(item).trim().slice(0, MAX_GENERATE_PRESET_CHARACTERS))
    .filter(Boolean))]
    .slice(0, MAX_GENERATE_PRESETS);
}
