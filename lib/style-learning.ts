import { writingDefaults, overrideAiSettings } from "./ai-settings-inheritance.ts";
import { STYLE_FIELDS, GENERATE_FIELDS, normalizeAdvanced, advancedText, type StyleAdvanced } from "./advanced-writing.ts";
import { normalizeAiGenerateOptions, type AiGenerateOptions } from "./generate-options.ts";

export type ReferenceDocument = { id: string; title: string; text: string };
export type ScenePreference = { name: string; when: string; instruction: string };
export type StyleConfiguration = { style: string; advancedStyle: StyleAdvanced; generate: AiGenerateOptions; scenes: ScenePreference[]; notes: string };
export type ConfigurationVersion = { id: string; name: string; createdAt: string; configuration: StyleConfiguration; model?: string; baseFingerprint?: string; modelFingerprint?: string };
export type StyleExpression = Pick<AiGenerateOptions, "proseControls" | "advanced">;
export type StyleLibrary = { references: ReferenceDocument[]; scenes: ScenePreference[]; versions: ConfigurationVersion[]; calibrations: Record<string, ConfigurationVersion>; locked: string[]; activeVersionId?: string; expression?: StyleExpression };
export const MAX_REFERENCE_TOTAL = 240_000;
export const MIN_STYLE_CONTENT_SCORE = 70;
export const STYLE_TRIAL_INSTRUCTION = "按固定大纲完成当前场景；仅试写可迁移的表达方式，亲密情节留白，仅保留非露骨的关系变化与剧情作用。";
export const STYLE_TRIAL_EVALUATION_RULES = "试写与评估共用边界：亲密情节留白，仅比较非露骨的叙事功能、语言、视角、对白及节奏。不得因省略露骨细节而扣风格分或内容分，也不得建议恢复这些细节。内容覆盖只依据本次固定大纲的事件、必要事实和因果判断，不要求还原参考原文中的全部细节。";
export const SCORE_DIMENSIONS = ["语言与句式", "叙述声音与视角", "心理与对白", "节奏与结构", "细节组织与留白"];
export const STYLE_SCORE_RUBRIC = `五项各0–20分，按固定维度评价与参考表达是否接近，提供两边的具体依据及可执行的配置调整建议。内容覆盖另列0–100分，不计入风格总分。不要因更简洁、更文学而加分；不要因没有照搬原句而扣分。${STYLE_TRIAL_EVALUATION_RULES}`;

const rec = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function normalizeConfiguration(value: unknown): StyleConfiguration {
  const v = rec(value);
  const scenes = Array.isArray(v.scenes) ? v.scenes.slice(0, 12).map(s => { const p = rec(s); return { name: String(p.name ?? "").slice(0, 100), when: String(p.when ?? "").slice(0, 1000), instruction: String(p.instruction ?? "").slice(0, 3000) }; }).filter(s => s.name && s.when && s.instruction) : [];
  return { style: String(v.style ?? "").slice(0, 5000), advancedStyle: normalizeAdvanced(v.advancedStyle, STYLE_FIELDS), generate: normalizeAiGenerateOptions(v.generate), scenes, notes: String(v.notes ?? "").slice(0, 10000) };
}
export function configurationFingerprint(value: unknown) {
  const c = normalizeConfiguration(value);
  // Model choice is supplied separately; operational controls are not style targets.
  return fingerprint(JSON.stringify({ style: c.style, advancedStyle: c.advancedStyle, prose: c.generate.proseControls, advanced: c.generate.advanced, scenes: c.scenes }));
}
export function fingerprint(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
export function normalizeStyleLibrary(value: unknown): StyleLibrary {
  const v = rec(value);
  let total = 0;
  const references = (Array.isArray(v.references) ? v.references : []).slice(0, 8).map((raw, i) => {
    const r = rec(raw); const text = String(r.text ?? "").slice(0, Math.max(0, Math.min(100000, MAX_REFERENCE_TOTAL - total))); total += text.length;
    return { id: String(r.id ?? `reference-${i}`).slice(0, 100), title: String(r.title ?? `参考文章 ${i + 1}`).slice(0, 150), text };
  });
  function version(raw: unknown): ConfigurationVersion { const p = rec(raw); return { id: String(p.id ?? "").slice(0, 100), name: String(p.name ?? "配置版本").slice(0, 150), createdAt: String(p.createdAt ?? ""), configuration: normalizeConfiguration(p.configuration), ...(p.model ? { model: String(p.model).slice(0, 300), baseFingerprint: String(p.baseFingerprint ?? ""), modelFingerprint: String(p.modelFingerprint ?? "") } : {}) }; }
  return { references, scenes: normalizeConfiguration({ scenes: v.scenes }).scenes, versions: (Array.isArray(v.versions) ? v.versions : []).slice(-20).map(version), calibrations: Object.fromEntries(Object.entries(rec(v.calibrations)).slice(0, 30).map(([key, val]) => [key, version(val)])), locked: (Array.isArray(v.locked) ? v.locked : []).map(String).slice(0, 100), ...(typeof v.activeVersionId === "string" ? { activeVersionId: v.activeVersionId } : {}), ...(v.expression ? { expression: { proseControls: normalizeAiGenerateOptions(v.expression).proseControls, advanced: normalizeAiGenerateOptions(v.expression).advanced } } : {}) };
}
type ConfiguredArticle = { style: string; aiGenerateSettings: unknown; storySettings?: { advancedStyle?: StyleAdvanced; styleLibrary?: StyleLibrary } };
export function configurationOf(article: ConfiguredArticle, settings?: object): StyleConfiguration {
  return normalizeConfiguration({ style: article.style, advancedStyle: article.storySettings?.advancedStyle, generate: settings ? writingDefaults({ ...article, aiGenerateSettings: normalizeAiGenerateOptions(article.aiGenerateSettings), chapters: [] }, settings) : article.storySettings?.styleLibrary?.expression ?? article.aiGenerateSettings, scenes: article.storySettings?.styleLibrary?.scenes });
}
export function modelConfiguration(article: ConfiguredArticle, model: string, settings?: object) {
  const base = configurationOf(article, settings);
  const calibration = normalizeStyleLibrary(article.storySettings?.styleLibrary).calibrations[model];
  return calibration?.baseFingerprint === configurationFingerprint(base) ? { configuration: calibration.configuration, calibration } : { configuration: base, calibration: undefined };
}

export function restoreStyleGenerateSettings(current: AiGenerateOptions, before: AiGenerateOptions) {
  const next = overrideAiSettings(current, { proseControls: before.proseControls, advanced: before.advanced });
  const inheritance = { ...next.inheritance };
  for (const key of new Set([...Object.keys(inheritance), ...Object.keys(before.inheritance ?? {})])) {
    if (!key.startsWith("advanced.") && !key.startsWith("proseControls.")) continue;
    const mode = before.inheritance?.[key];
    if (mode) inheritance[key] = mode;
    else delete inheritance[key];
  }
  return { ...next, inheritance: Object.keys(inheritance).length ? inheritance : undefined };
}
export function sceneInstructions(scenes: ScenePreference[]) {
  return scenes.length ? "按当前场景功能选择适用偏好，不机械使用全部策略：\n" + scenes.map(s => `${s.name}（${s.when}）：${s.instruction}`).join("\n") : "";
}
export function compiledStyle(configuration: StyleConfiguration) {
  return [configuration.style, advancedText(configuration.advancedStyle, STYLE_FIELDS), sceneInstructions(configuration.scenes)].filter(Boolean).join("\n\n");
}
export function modelSettingsFingerprint(model: { id: string; providerId: string; modelId: string; baseUrl: string; systemPrompt: string; temperature: number | null; maxOutput: number | null; maxInputCharacters: number; reasoningEffort: unknown }) {
  return fingerprint(JSON.stringify({ id: model.id, provider: model.providerId, model: model.modelId, url: model.baseUrl, prompt: model.systemPrompt, temperature: model.temperature, output: model.maxOutput, input: model.maxInputCharacters, reasoning: model.reasoningEffort }));
}
export function applyLocks(candidate: StyleConfiguration, base: StyleConfiguration, locked: string[]): StyleConfiguration {
  const next = normalizeConfiguration(candidate);
  // AI may only optimize expression, never switch model, rewrite mode or operational settings.
  next.generate = { ...base.generate, proseControls: next.generate.proseControls, advanced: next.generate.advanced };
  for (const key of locked) {
    if (key === "style") next.style = base.style;
    if (key === "scenes") next.scenes = base.scenes;
    if (key.startsWith("style.")) { const field = key.slice(6) as keyof StyleAdvanced; next.advancedStyle[field] = base.advancedStyle[field] ?? ""; }
    if (key.startsWith("generate.")) { const field = key.slice(9) as keyof typeof GENERATE_FIELDS; next.generate.advanced[field] = base.generate.advanced[field] ?? ""; }
    if (key === "proseControls") next.generate.proseControls = base.generate.proseControls;
  }
  return next;
}
export function textStatistics(text: string) {
  const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const sentences = text.split(/[。！？!?]+/u).map(p => p.trim()).filter(Boolean);
  return { characters: text.replace(/\s/g, "").length, paragraphs: paragraphs.length, averageParagraph: Math.round(paragraphs.reduce((n, p) => n + p.length, 0) / Math.max(1, paragraphs.length)), averageSentence: Math.round(sentences.reduce((n, p) => n + p.length, 0) / Math.max(1, sentences.length)) };
}

export const LEARNING_RULES = `从参考文章只学习可迁移的表达规律。配置中不得带入人物、地点、身份、关系、具体事件、秘密、标志性物件、意象或题材模板；把人物匿名化仍保留事件也属于情节污染。配置必须自包含，不使用“按原文”等指代。跨片段稳定的规则写style或advancedStyle，可能随片段变化的策略写generate.advanced，多篇先提共性，再把差异写scenes中的场景偏好，使用对白交锋、内心判断、行动过程、背景过渡等功能分类。同类场景冲突时在notes标明来源编号及表达差异，不复述剧情。优先映射已有项，无法表达的信息才写各自additional（纯文本）；无额外要求留空。未知项留空表示自动。保留参考写法，不自动优化掉解释、舒缓或有意义的反复；亲密情节只分析非露骨的叙事功能。不要摘录原句。证据用来源编号及语言现象描述。返回格式中的示例值仅是字段说明，必须输出实际分析结果，不能照抄占位说明。`;
export function configurationSchema() {
  return { style: "通用且自包含的风格说明", advancedStyle: Object.fromEntries(Object.keys(STYLE_FIELDS).map(key => [key, `${STYLE_FIELDS[key as keyof typeof STYLE_FIELDS][0]}：${STYLE_FIELDS[key as keyof typeof STYLE_FIELDS][1]}；无要求留空`])), generate: { proseControls: { dialogueDensity: "auto|low|balanced|high", introspectionDensity: "auto|low|balanced|high", descriptionDetail: "auto|low|balanced|high", narrativePace: "auto|slow|balanced|fast", paragraphLength: "auto|short|balanced|long" }, advanced: Object.fromEntries(Object.keys(GENERATE_FIELDS).map(key => [key, `${GENERATE_FIELDS[key as keyof typeof GENERATE_FIELDS][0]}：${GENERATE_FIELDS[key as keyof typeof GENERATE_FIELDS][1]}；无要求留空`])) }, scenes: [{ name: "场景功能", when: "适用条件", instruction: "具体表达策略，不含参考剧情" }], notes: "来源依据、冲突与不确定项，不含剧情" };
}
