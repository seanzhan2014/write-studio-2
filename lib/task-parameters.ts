import { isReasoningEffort, type ReasoningEffort } from "./reasoning-options.ts";
import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile, NAMING_STYLE_OPTIONS, NAMING_EXPRESSION_OPTIONS, NAMING_FORMAT_OPTIONS, CIPAI_OPTIONS, type NamingProfile } from "./naming-options.ts";
import { createReviewRuleSnapshot, normalizeReviewRuleSnapshot, type ReviewRuleSnapshot } from "./review-rules.mjs";

type Choice = { value: string; label: string };
export type TaskParameterField = { key: string; label: string; group: string; default: string | number | boolean; global?: string; options?: readonly Choice[]; max?: number; model?: boolean; reasoning?: boolean };
const strategies = [{ value: "minimal", label: "最少条件型" }, { value: "explore", label: "最大探索型" }];
const modelModes = [{ value: "inherit", label: "跟随生成模型" }, { value: "fixed", label: "指定模型" }];
export const TASK_PARAMETER_FIELDS: TaskParameterField[] = [
  { key: "preparationStrategy", label: "讨论策略", group: "写作准备与讨论", default: "minimal", options: strategies },
  { key: "preparationMaxRounds", label: "写作前最多互动轮次", group: "写作准备与讨论", default: 3, max: 5 },
  { key: "preparationRequireConfirmation", label: "准备稿无问题时仍需确认", group: "写作准备与讨论", default: false },
  { key: "reviewMaxRounds", label: "最多修正次数", group: "自动审校", default: 0, global: "generateReviewMaxRounds", max: 10 },
  { key: "reviewStrategy", label: "审校类型", group: "自动审校", default: "minimal", global: "generateReviewStrategy", options: strategies },
  { key: "reviewInstruction", label: "审校补充指令", group: "自动审校", default: "", global: "generateReviewInstruction", max: 20000 },
  { key: "reviewRules", label: "本级审校规则", group: "自动审校", default: "__article_rules__", max: 20000 },
  { key: "reviewModelMode", label: "审校模型方式", group: "自动审校", default: "inherit", options: modelModes },
  { key: "reviewModel", label: "审校模型", group: "自动审校", default: "", model: true },
  { key: "reviewReasoningEffort", label: "审校推理设置", group: "自动审校", default: "__inherit__", reasoning: true },
  { key: "namingModelMode", label: "命名模型方式", group: "命名", default: "inherit", options: modelModes },
  { key: "namingModel", label: "命名模型", group: "命名", default: "", model: true },
  { key: "namingReasoningEffort", label: "命名推理设置", group: "命名", default: "__inherit__", reasoning: true },
  { key: "chatModel", label: "聊天模型", group: "聊天", default: "", model: true },
  { key: "chatReasoningEffort", label: "聊天推理设置", group: "聊天", default: "__inherit__", reasoning: true },
  { key: "chatIncludePrevious", label: "聊天包含前面大纲", group: "聊天", default: true },
  { key: "chatIncludeCharacters", label: "聊天包含相关人物", group: "聊天", default: true },
  { key: "illustrationPromptModel", label: "插图提示词模型", group: "插图模型", default: "", model: true },
  { key: "illustrationImageModel", label: "插图图片模型", group: "插图模型", default: "", model: true },
  { key: "taskConcurrency", label: "任务并发上限", group: "任务队列", default: 2, max: 5 },
];
const namingLabels: Record<keyof NamingProfile, string> = { style: "语言风格", expression: "表达内容", format: "名称格式", minCharacters: "最少字数", maxCharacters: "最多字数", lineCount: "句数", cipai: "词牌", customStyle: "自定义语言风格", customExpression: "自定义表达要求" };
for (const prefix of ["chapterNaming", "outlineNaming"]) for (const [key, value] of Object.entries(DEFAULT_CHAPTER_NAMING_PROFILE)) TASK_PARAMETER_FIELDS.push({
  key: `${prefix}_${key}`, label: `${prefix === "chapterNaming" ? "章节" : "大纲"}${namingLabels[key as keyof NamingProfile]}`, group: "命名", default: value,
  options: key === "style" ? NAMING_STYLE_OPTIONS : key === "expression" ? NAMING_EXPRESSION_OPTIONS : key === "format" ? NAMING_FORMAT_OPTIONS : key === "cipai" ? CIPAI_OPTIONS : undefined,
  max: typeof value === "number" ? key === "lineCount" ? 4 : 80 : 500,
});
export type TaskParameters = Record<string, string | number | boolean>;
export function normalizeTaskParameters(value: unknown): TaskParameters {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result: TaskParameters = {};
  for (const field of TASK_PARAMETER_FIELDS) {
    const candidate = raw[field.key];
    if (!Object.hasOwn(raw, field.key)) continue;
    if (field.reasoning) result[field.key] = candidate === "__omit__" || isReasoningEffort(candidate) ? String(candidate) : "__inherit__";
    else if (field.options) result[field.key] = field.options.some(option => option.value === candidate) ? String(candidate) : field.default;
    else if (typeof field.default === "boolean") result[field.key] = typeof candidate === "boolean" ? candidate : field.default;
    else if (typeof field.default === "number") result[field.key] = typeof candidate === "number" && Number.isInteger(candidate) ? Math.max(field.key.includes("Naming_") || field.key === "taskConcurrency" ? 1 : 0, Math.min(field.max!, candidate)) : field.default;
    else result[field.key] = typeof candidate === "string" ? candidate.slice(0, field.model ? 300 : field.max ?? 20000) : field.default;
  }
  return result;
}
export function taskParameterDefaults(settings: object = {}, article?: { chapterNaming?: NamingProfile; outlineNaming?: NamingProfile }): TaskParameters {
  const global = settings as Record<string, unknown>;
  const defaults = Object.fromEntries(TASK_PARAMETER_FIELDS.map(field => [field.key, field.reasoning ? global[field.global ?? field.key] === null ? "__omit__" : global[field.global ?? field.key] ?? field.default : global[field.global ?? field.key] ?? field.default]));
  defaults.illustrationPromptModel = global.illustrationPromptModel || global.generateModel || "";
  for (const prefix of ["chapterNaming", "outlineNaming"] as const) for (const [key, value] of Object.entries(normalizeNamingProfile(article?.[prefix], prefix === "chapterNaming" ? DEFAULT_CHAPTER_NAMING_PROFILE : DEFAULT_OUTLINE_NAMING_PROFILE))) defaults[`${prefix}_${key}`] = value;
  return normalizeTaskParameters(defaults);
}
export function taskReasoningEffort(value: unknown): ReasoningEffort | null | undefined {
  return value === "__omit__" ? null : isReasoningEffort(value) ? value : undefined;
}
export function taskNamingProfile(tasks: TaskParameters, prefix: "chapterNaming" | "outlineNaming"): NamingProfile {
  return normalizeNamingProfile(Object.fromEntries(Object.entries(tasks).filter(([key]) => key.startsWith(`${prefix}_`)).map(([key, value]) => [key.slice(prefix.length + 1), value])), prefix === "chapterNaming" ? DEFAULT_CHAPTER_NAMING_PROFILE : DEFAULT_OUTLINE_NAMING_PROFILE);
}

export function taskReviewSnapshot(article: Parameters<typeof createReviewRuleSnapshot>[0], tasks: TaskParameters, instruction: string): ReviewRuleSnapshot {
  if (tasks.reviewRules === undefined || tasks.reviewRules === "__article_rules__") return createReviewRuleSnapshot(article, instruction);
  const content = String(tasks.reviewRules).trim();
  return normalizeReviewRuleSnapshot({ version: 1, instruction, rules: content ? [{ id: `scoped-review:${article.id}`, title: "本级审校规则", content, revision: 1 }] : [] });
}
