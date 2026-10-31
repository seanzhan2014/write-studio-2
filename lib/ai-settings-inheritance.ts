import { GENERATE_SETTING_KEYS, normalizeAiGenerateOptions, type AiGenerateOptions } from "./generate-options.ts";
import { ILLUSTRATION_SETTING_KEYS, normalizeIllustrationOptions, type IllustrationOptions } from "./illustration-options.ts";
import type { ChapterSettings } from "./story-settings.ts";
import { taskParameterDefaults } from "./task-parameters.ts";
import type { NamingProfile } from "./naming-options.ts";

export type AiSettingsKind = "generate" | "illustration";
type TaskOptions = AiGenerateOptions | IllustrationOptions;
type SettingsArticle = {
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
export function readAiSetting(value: TaskOptions, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => (current as Record<string, unknown> | undefined)?.[part], value);
}
function writeAiSetting(value: TaskOptions, key: string, setting: unknown) {
  const parts = key.split(".");
  let current = value as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) { current[part] ??= {}; current = current[part] as Record<string, unknown>; }
  current[parts.at(-1)!] = structuredClone(setting);
}
function normalize(kind: AiSettingsKind, value: unknown, fallback?: TaskOptions): TaskOptions {
  return kind === "generate" ? normalizeAiGenerateOptions(value, fallback as AiGenerateOptions | undefined) : normalizeIllustrationOptions(value, fallback as IllustrationOptions | undefined);
}
function resolve(kind: AiSettingsKind, raw: TaskOptions | null | undefined, article: TaskOptions, previous: TaskOptions, baseline = article) {
  const value = normalize(kind, raw ?? baseline, baseline);
  for (const [key, mode] of Object.entries(raw ? normalize(kind, raw).inheritance ?? {} : {})) writeAiSetting(value, key, readAiSetting(mode === "article" ? article : previous, key));
  return normalize(kind, value);
}

/** Previous outlines are scoped to the current chapter; its first outline falls back to the previous active chapter. */
export function resolveAiSettings<K extends AiSettingsKind>(article: SettingsArticle, targetId: string, kind: K, level: "outline" | "chapter" = "outline", globalSettings: object = {}) {
  const defaults = normalize(kind, kind === "generate" ? article.aiGenerateSettings : article.illustrationSettings);
  if (kind === "generate") (defaults as AiGenerateOptions).tasks = { ...taskParameterDefaults(globalSettings, article), ...(defaults as AiGenerateOptions).tasks };
  delete defaults.inheritance;
  let previousChapter = defaults;
  let previousChapterSource = "文章默认";
  let chapterLabel = "文章默认";
  for (const chapter of article.chapters) {
    if (chapter.archived && chapter.id !== targetId && !chapter.outlines.some(outline => outline.id === targetId)) continue;
    const chapterRaw = chapter.settings?.aiTasks?.[kind];
    const chapterValue = chapterRaw ? resolve(kind, chapterRaw, defaults, previousChapter) : previousChapter;
    const chapterSource = chapterRaw ? `章节：${chapter.title}` : previousChapterSource;
    if (level === "chapter" && chapter.id === targetId) return result(chapterValue, previousChapter, chapterLabel, chapterSource);
    let previous = previousChapter;
    let previousLabel = chapterLabel;
    for (const outline of chapter.outlines) {
      if (outline.archived && outline.id !== targetId) continue;
      const raw = kind === "generate" ? outline.generateOptions : outline.illustrationOptions;
      const value = resolve(kind, raw, defaults, previous, chapterValue);
      if (level === "outline" && outline.id === targetId) return result(value, previous, previousLabel, raw ? "当前大纲设置" : chapterSource);
      previous = value;
      previousLabel = `上一大纲点：${outline.title || "未命名大纲"}`;
    }
    // Chapter settings are explicit, independent of an outline's temporary task choices.
    previousChapter = chapterValue;
    previousChapterSource = chapterSource;
    chapterLabel = `上一章节：${chapter.title}`;
  }
  return result(defaults, defaults, "文章默认");

  function result(value: TaskOptions, previous: TaskOptions, previousLabel: string, baselineLabel = "文章默认") {
    type Options = K extends "generate" ? AiGenerateOptions : IllustrationOptions;
    return { value: value as Options, articleDefaults: defaults as Options, previous: previous as Options, previousLabel, baselineLabel };
  }
}

export function inheritAiSettings<T extends TaskOptions>(current: T, mode: "article" | "previous", source: T, keys: string[]): T {
  const next = structuredClone(current);
  next.inheritance = { ...next.inheritance };
  for (const key of keys) { writeAiSetting(next, key, readAiSetting(source, key)); next.inheritance[key] = mode; }
  return next;
}

export function overrideAiSettings<T extends TaskOptions>(current: T, patch: Partial<T>): T {
  const inheritance = { ...current.inheritance };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "inheritance") continue;
    if (key === "advanced" || key === "proseControls" || key === "tasks") {
      for (const child of Object.keys(value as object)) if (readAiSetting(current, `${key}.${child}`) !== (value as Record<string, unknown>)[child]) delete inheritance[`${key}.${child}`];
    } else delete inheritance[key];
  }
  return { ...current, ...patch, inheritance: Object.keys(inheritance).length ? inheritance : undefined } as T;
}
