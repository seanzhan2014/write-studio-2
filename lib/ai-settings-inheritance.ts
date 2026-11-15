import { GENERATE_EXPRESSION_KEYS, GENERATE_SETTING_KEYS, normalizeAiGenerateOptions, generateExpressionSettings, type AiGenerateOptions } from "./generate-options.ts";
import { ILLUSTRATION_SETTING_KEYS, normalizeIllustrationOptions, type IllustrationOptions } from "./illustration-options.ts";
import type { ChapterSettings } from "./story-settings.ts";
import { TASK_PARAMETER_FIELDS, taskParameterDefaults } from "./task-parameters.ts";
import type { NamingProfile } from "./naming-options.ts";

export type AiSettingsKind = "generate" | "illustration";
type TaskOptions = AiGenerateOptions | IllustrationOptions;
type SettingsArticle = {
  storySettings?: { styleLibrary?: { expression?: Pick<AiGenerateOptions, "proseControls" | "advanced">; activeVersionId?: string } };
  chapterNaming?: NamingProfile;
  outlineNaming?: NamingProfile;
  aiGenerateSettings?: AiGenerateOptions;
  illustrationSettings?: IllustrationOptions;
  chapters: Array<{ id: string; title: string; archived: boolean; settings?: ChapterSettings; outlines: Array<{ id: string; title: string; archived: boolean; generateOptions?: AiGenerateOptions | null; illustrationOptions?: IllustrationOptions | null }> }>;
};

export const AI_SETTING_LABELS: Record<string, string> = {
  model: "模型", reasoningEffort: "推理设置", targetWords: "目标字数", contentMode: "生成方式", rewriteRetention: "原文保留度",
  includePrevious: "包含前面大纲", includeCharacters: "包含相关人物", includeExcellentFragments: "参考优秀片段", includeOutlineTitle: "同时生成大纲名",
  reviewMaxRounds: "审校轮次", reviewInstruction: "审校指令", firstAppearanceOverrides: "人物出场",
  closingSummaryLength: "收尾总结",
  "proseControls.dialogueDensity": "对话密度", "proseControls.introspectionDensity": "内心活动", "proseControls.descriptionDetail": "描写细度", "proseControls.narrativePace": "叙事节奏", "proseControls.paragraphLength": "段落长度",
  promptLanguage: "生成 Prompt 的语言", stylePreset: "插图风格", resolution: "分辨率", additionalPrompt: "附加 Prompt",
  quality: "图片画质", aspectRatio: "画面比例", scenePrompt: "画面要求",
};
export function aiSettingKeys(kind: AiSettingsKind) {
  return kind === "generate" ? GENERATE_SETTING_KEYS : ILLUSTRATION_SETTING_KEYS;
}
export function visibleAiSettingKeys(kind: AiSettingsKind, value: TaskOptions) {
  return aiSettingKeys(kind).filter(key => kind !== "generate" || ((value as AiGenerateOptions).contentMode === "rewrite" ? !GENERATE_EXPRESSION_KEYS.includes(key) : !key.startsWith("rewriteExpression.")));
}
export function readAiSetting(value: TaskOptions, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => (current as Record<string, unknown> | undefined)?.[part], value);
}
function writeAiSetting(value: TaskOptions, key: string, setting: unknown) {
  const parts = key.split(".");
  let current = value as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) { current[part] ??= {}; current = current[part] as Record<string, unknown>; }
  current[parts.at(-1)!] = structuredClone(setting);
}
export function overrideAiSetting<T extends TaskOptions>(current: T, key: string, setting: unknown): T {
  const next = structuredClone(current);
  writeAiSetting(next, key, setting);
  if (next.inheritance) delete next.inheritance[key];
  return next;
}
function normalize(kind: AiSettingsKind, value: unknown, fallback?: TaskOptions): TaskOptions {
  return kind === "generate" ? normalizeAiGenerateOptions(value, fallback as AiGenerateOptions | undefined) : normalizeIllustrationOptions(value, fallback as IllustrationOptions | undefined);
}
function resolve(kind: AiSettingsKind, raw: TaskOptions | null | undefined, article: TaskOptions, previous: TaskOptions, baseline = article, global = article, missingFieldMode?: "parent" | "article") {
  if (!raw) return inheritAiSettings(normalize(kind, baseline), "parent", baseline, aiSettingKeys(kind));
  const value = normalize(kind, raw ?? baseline, baseline);
  const inheritance = { ...normalize(kind, raw).inheritance };
  if (kind === "generate" && missingFieldMode) {
    const stored = raw as AiGenerateOptions;
    for (const key of aiSettingKeys(kind)) {
      if (readAiSetting(stored, key) !== undefined) continue;
      inheritance[key] ??= missingFieldMode;
    }
  }
  if (Object.keys(inheritance).length) value.inheritance = inheritance;
  for (const [key, mode] of Object.entries(inheritance)) writeAiSetting(value, key, readAiSetting(mode === "global" ? global : mode === "parent" ? baseline : mode === "article" ? article : previous, key));
  return normalize(kind, value);
}

/** Complete runtime values; the stored article keeps its per-field inheritance markers. */
export function globalAiSettings<K extends AiSettingsKind>(kind: K, settings: object = {}) {
  const source = settings as Record<string, unknown>;
  const value = kind === "generate" ? normalizeAiGenerateOptions(source.aiGenerateSettings, normalizeAiGenerateOptions({ model: source.generateModel, reasoningEffort: source.generateReasoningEffort, targetWords: source.generateTargetWords, reviewMaxRounds: source.generateReviewMaxRounds })) : normalizeIllustrationOptions(source.illustrationSettings);
  if (kind === "generate") {
    const generate = value as AiGenerateOptions;
    generate.model = String(source.generateModel ?? generate.model);
    generate.reasoningEffort = source.generateReasoningEffort as AiGenerateOptions["reasoningEffort"];
    generate.targetWords = normalizeAiGenerateOptions({ targetWords: source.generateTargetWords }).targetWords;
    generate.tasks = { ...taskParameterDefaults(settings), reviewRules: "__global_rules__" };
  }
  delete value.inheritance;
  return value as K extends "generate" ? AiGenerateOptions : IllustrationOptions;
}

export function createInheritedAiSettings<K extends AiSettingsKind>(kind: K) {
  const value = globalAiSettings(kind);
  return inheritAiSettings(value, "global", value, aiSettingKeys(kind));
}

export function articleAiSettings<K extends AiSettingsKind>(article: SettingsArticle, kind: K, settings: object = {}) {
  const global = globalAiSettings(kind, settings);
  const raw = kind === "generate" ? article.aiGenerateSettings : article.illustrationSettings;
  const baseline = normalize(kind, raw);
  if (kind === "generate") {
    const generate = baseline as AiGenerateOptions;
    const storedTasks = (raw as AiGenerateOptions | undefined)?.tasks;
    generate.tasks = { ...taskParameterDefaults(settings, article), ...generate.tasks };
    generate.inheritance = { ...generate.inheritance };
    // Older articles already followed global workflow defaults when a field
    // was absent. Keep that live relationship when another field is edited.
    for (const field of TASK_PARAMETER_FIELDS) {
      if (field.key === "reviewRules" || field.key.includes("Naming_") || Object.hasOwn(storedTasks ?? {}, field.key)) continue;
      generate.inheritance[`tasks.${field.key}`] ??= "global";
    }
  }
  return resolve(kind, baseline, global, global, global, global) as K extends "generate" ? AiGenerateOptions : IllustrationOptions;
}

/** Only an explicitly applied learning result may add article expression preferences. */
export function writingDefaults(article: SettingsArticle, settings: object = {}) {
  const value = globalAiSettings("generate", settings);
  const library = article.storySettings?.styleLibrary;
  const learned = library?.expression ?? (library?.activeVersionId ? article.aiGenerateSettings : undefined);
  if (!learned) return value;
  const expression = normalizeAiGenerateOptions(learned);
  return { ...value, proseControls: expression.proseControls, advanced: expression.advanced };
}

/** Outline defaults follow the preceding active outline across chapter boundaries. */
export function resolveAiSettings<K extends AiSettingsKind>(article: SettingsArticle, targetId: string, kind: K, level: "outline" | "chapter" = "outline", globalSettings: object = {}) {
  const global = globalAiSettings(kind, globalSettings);
  const baseline = kind === "generate" ? writingDefaults(article, globalSettings) : global;
  let previous: TaskOptions = baseline;
  let previousLabel = "全局默认";
  for (const chapter of article.chapters) {
    if (chapter.archived && chapter.id !== targetId && !chapter.outlines.some(outline => outline.id === targetId)) continue;
    if (level === "chapter" && chapter.id === targetId) {
      return result(previous, previous, previousLabel);
    }
    for (const outline of chapter.outlines) {
      if (outline.archived && outline.id !== targetId) continue;
      const raw = kind === "generate" ? outline.generateOptions : outline.illustrationOptions;
      const value = resolve(kind, raw, global, previous, previous, global, "parent");
      // Retire article/chapter markers while preserving explicit outline overrides.
      for (const [key, mode] of Object.entries(value.inheritance ?? {})) value.inheritance![key] = mode === "article" ? "global" : mode === "parent" ? "previous" : mode;
      if (level === "outline" && outline.id === targetId) return result(value, previous, previousLabel, raw ? "当前大纲设置" : previousLabel);
      if (!chapter.archived && !outline.archived) {
        previous = value;
        previousLabel = `上一大纲：${outline.title || "未命名大纲"}`;
      }
    }
  }
  return result(baseline, baseline, "全局默认");

  function result(value: TaskOptions, previous: TaskOptions, previousLabel: string, baselineLabel = previousLabel) {
    type Options = K extends "generate" ? AiGenerateOptions : IllustrationOptions;
    return { value: value as Options, globalDefaults: global as Options, previous: previous as Options, previousLabel, baselineLabel, parentLabel: previousLabel };
  }
}

export function inheritAiSettings<T extends TaskOptions>(current: T, mode: "article" | "previous" | "global" | "parent", source: T, keys: string[]): T {
  const next = structuredClone(current);
  next.inheritance = { ...next.inheritance };
  for (const key of keys) { writeAiSetting(next, key, readAiSetting(source, key)); next.inheritance[key] = mode; }
  return next;
}

export function overrideAiSettings<T extends TaskOptions>(current: T, patch: Partial<T>): T {
  const inheritance = { ...current.inheritance };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "inheritance") continue;
    if (key === "advanced" || key === "proseControls" || key === "tasks" || key === "rewriteExpression") {
      clearChanged(value, key);
    } else delete inheritance[key];
  }
  return { ...current, ...patch, inheritance: Object.keys(inheritance).length ? inheritance : undefined } as T;

  function clearChanged(value: unknown, path: string) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) clearChanged(child, `${path}.${key}`);
    } else if (readAiSetting(current, path) !== value) delete inheritance[path];
  }
}

/** Expression edits target the active mode; ordinary writing keeps its own values. */
export function overrideGenerateSettings(current: AiGenerateOptions, patch: Partial<AiGenerateOptions>): AiGenerateOptions {
  if ((patch.contentMode ?? current.contentMode) !== "rewrite") return overrideAiSettings(current, patch);
  const rest = { ...patch };
  const expression = { ...generateExpressionSettings({ ...current, contentMode: "rewrite" }) };
  let changed = false;
  for (const key of ["advanced", "proseControls", "closingSummaryLength"] as const) {
    if (!Object.hasOwn(patch, key)) continue;
    Object.assign(expression, { [key]: patch[key] });
    delete rest[key];
    changed = true;
  }
  return overrideAiSettings(current, { ...rest, ...(changed ? { rewriteExpression: expression } : {}) });
}

/** REST patches inherit untouched fields just like edits in the settings forms. */
export function patchAiSettings(kind: "generate", current: AiGenerateOptions, input: unknown): AiGenerateOptions;
export function patchAiSettings(kind: "illustration", current: IllustrationOptions, input: unknown): IllustrationOptions;
export function patchAiSettings(kind: AiSettingsKind, current: TaskOptions, input: unknown): TaskOptions {
  const patch = input && typeof input === "object" && !Array.isArray(input) ? { ...input } as Record<string, unknown> : {};
  if (Object.hasOwn(patch, "inheritance")) return normalize(kind, patch, current);
  for (const key of ["advanced", "proseControls", "tasks"]) {
    if (patch[key] && typeof patch[key] === "object" && !Array.isArray(patch[key])) patch[key] = { ...(current as unknown as Record<string, object>)[key], ...patch[key] as object };
  }
  return normalize(kind, overrideAiSettings(current, patch as Partial<TaskOptions>));
}
