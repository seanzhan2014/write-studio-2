export const PREPARATION_SECTIONS = [
  ["purpose", "核心与作用"], ["boundaries", "开头与结尾"], ["scenes", "场景推进"],
  ["actions", "人物目标与行动"], ["knowledge", "认知与信息边界"], ["perspective", "视角与信息揭示"],
  ["emotion", "情绪与关系"], ["constraints", "事实与约束"], ["expression", "表现与篇幅"],
] as const;
export const PREPARATION_SECTION_GUIDANCE: Record<(typeof PREPARATION_SECTIONS)[number][0], string> = {
  purpose: "本段核心冲突、在全篇中的作用及读者体验目标。",
  boundaries: "开场切入的具体状态、承接前文的方式、结尾动作或局势变化。",
  scenes: "逐场列出作用、有效行动、冲突或转折、结束后的变化；标明展开与概述的节点。",
  actions: "人物目标、阻力、行动因果、关键选择及后果。",
  knowledge: "区分作者掌握、视角人物知道、读者已经知道的事实，以及各自未知项。",
  perspective: "每场视角、开场透露的信息、暂缓解释、可用铺垫、揭示时机与触发点；允许直接交代。",
  emotion: "情绪与关系的变化，以及承载这些变化的行动、对白潜台词和必要内心活动。",
  constraints: "必须保留的事实、因果、作者明确的讲述顺序、负面约束与未决项。",
  expression: "适合本场景的具体手法、有意义的细节、关键节点篇幅和自然收束方式。",
};
export const PREPARATION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "writer_studio_writing_preparation", strict: true,
    schema: {
      type: "object", additionalProperties: false, required: ["brief", "questions"],
      properties: {
        brief: {
          type: "object", additionalProperties: false, required: PREPARATION_SECTIONS.map(([key]) => key),
          properties: Object.fromEntries(PREPARATION_SECTIONS.map(([key, title]) => [key, { type: "string", description: `${title}：${PREPARATION_SECTION_GUIDANCE[key]}必须为非空文本，最多6000字符；不适用或未知时明确说明。` }])),
        },
        questions: {
          type: "array", maxItems: 3,
          items: {
            type: "object", additionalProperties: false, required: ["id", "title", "reason", "options"],
            properties: {
              id: { type: "string" }, title: { type: "string" }, reason: { type: "string" },
              options: {
                type: "array", maxItems: 4,
                items: {
                  type: "object", additionalProperties: false, required: ["id", "label", "description"],
                  properties: { id: { type: "string" }, label: { type: "string" }, description: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
export type PreparationQuestion = { id: string; title: string; reason: string; options: Array<{ id: string; label: string; description: string }> };
export type PreparationReply = { answers: Record<string, string>; note: string };
export type PreparationStrategy = "minimal" | "explore";
export const PREPARATION_STRATEGY_LABELS = { minimal: "最少条件型讨论", explore: "最大探索型讨论" } as const;
export function normalizePreparationStrategy(value: unknown): PreparationStrategy {
  return value === "explore" ? "explore" : "minimal";
}
export type WritingPreparation = {
  version: 1; revision: number; maxRounds: number; round: number;
  strategy?: PreparationStrategy;
  /** Missing on older tasks, which continue to require author confirmation. */
  requireConfirmation?: boolean;
  stage: "preparing" | "awaiting_author" | "awaiting_confirmation" | "writing";
  brief: string; questions: PreparationQuestion[]; draft: PreparationReply;
  history: Array<{ round: number; brief: string; questions: PreparationQuestion[]; reply: PreparationReply; at: string }>;
  confirmedAt?: string;
  autoApprovedAt?: string;
  finishAfterReply?: boolean;
};
export const MAX_PREPARATION_ROUNDS = 5;
export function normalizePreparationRounds(value: unknown, fallback = 3) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_PREPARATION_ROUNDS ? value : fallback;
}
export function createWritingPreparation(maxRounds: number, options: { strategy?: PreparationStrategy; requireConfirmation?: boolean } = {}): WritingPreparation {
  return { version: 1, revision: 0, maxRounds, round: 0, strategy: normalizePreparationStrategy(options.strategy), requireConfirmation: options.requireConfirmation === true, stage: "preparing", brief: "", questions: [], draft: { answers: {}, note: "" }, history: [] };
}
export function preparationNeedsConfirmation(preparation: WritingPreparation) {
  return preparation.requireConfirmation !== false || preparation.finishAfterReply === true;
}
export function canWritePreparedProse(preparation: WritingPreparation) {
  return preparation.stage === "writing" && Boolean(preparation.brief.trim()) && Boolean(preparation.confirmedAt || (!preparationNeedsConfirmation(preparation) && preparation.autoApprovedAt));
}
export function isTaskAwaitingAuthor(task: { state: string; phase?: string }) {
  return task.state === "waiting" && (task.phase === "awaiting_author" || task.phase === "awaiting_confirmation");
}

export type PreparationResponseDiagnostic = { attempt: number; error: string; requestId?: string; provider?: string; finishReason?: string; outputCharacters: number; response: string; truncated: boolean };
export class PreparationResponseError extends Error {
  diagnostics: PreparationResponseDiagnostic[] = [];
  inputTokens = 0;
  outputTokens = 0;
  constructor(message: string) { super(message); this.name = "PreparationResponseError"; }
}
function requiredText(value: unknown, maximum: number, field: string, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > maximum) throw new PreparationResponseError(`准备稿 ${field} 必须为${allowEmpty ? "" : "非空"}文本，且不超过 ${maximum} 字符，请重试本步骤`);
  return value.trim();
}
function preparationRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PreparationResponseError(`准备稿 ${field} 必须为 JSON 对象，请重试本步骤`);
  return value as Record<string, unknown>;
}
export function parsePreparationResponse(text: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new PreparationResponseError("准备稿不是有效 JSON，请重试本步骤"); }
  const value = preparationRecord(parsed, "返回值");
  const sections = preparationRecord(value.brief, "brief");
  if (!Array.isArray(value.questions) || value.questions.length > 3) throw new PreparationResponseError("准备稿 questions 必须为最多三个问题的数组，无问题时返回 []");
  const brief = PREPARATION_SECTIONS.map(([key, title], index) => {
    // Some compatible providers ignore structured output and return localized keys or lists.
    // Preserve their text, but never fill a missing section or coerce arbitrary objects.
    let section = Object.hasOwn(sections, key) ? sections[key] : sections[title];
    if (Array.isArray(section) && section.every(item => typeof item === "string")) section = section.join("\n");
    return `${index + 1}. ${title}\n${requiredText(section, 6000, `brief.${key}（${title}）`)}`;
  }).join("\n\n");
  const ids = new Set<string>();
  const questions: PreparationQuestion[] = value.questions.map((raw, index) => {
    const field = `questions[${index}]`;
    const question = preparationRecord(raw, field);
    const id = requiredText(question.id, 80, `${field}.id`);
    const options = question.options === undefined ? [] : question.options;
    if (ids.has(id) || !Array.isArray(options) || options.length > 4) throw new PreparationResponseError(`准备稿 ${field} 问题编号重复或选项无效`);
    ids.add(id);
    const optionIds = new Set<string>();
    return { id, title: requiredText(question.title, 500, `${field}.title`), reason: requiredText(question.reason ?? "", 1500, `${field}.reason`, true), options: options.map((raw, optionIndex) => {
      const optionField = `${field}.options[${optionIndex}]`;
      const option = preparationRecord(raw, optionField);
      const optionId = requiredText(option.id, 80, `${optionField}.id`);
      if (optionIds.has(optionId)) throw new PreparationResponseError(`准备稿 ${optionField}.id 选项编号重复`);
      optionIds.add(optionId);
      return { id: optionId, label: requiredText(option.label, 500, `${optionField}.label`), description: requiredText(option.description ?? "", 1500, `${optionField}.description`, true) };
    }) };
  });
  return { brief, questions };
}
export function validatePreparationReply(value: unknown, questions: PreparationQuestion[], requireAnswer = false): PreparationReply {
  const reply = value as Partial<PreparationReply> | null;
  if (!reply || typeof reply.note !== "string" || reply.note.length > 12000 || !reply.answers || typeof reply.answers !== "object" || Array.isArray(reply.answers)) throw new Error("作者回答格式无效");
  const answers: Record<string, string> = {};
  for (const [id, answer] of Object.entries(reply.answers)) {
    const question = questions.find((item) => item.id === id);
    if (!question || !question.options.some((option) => option.id === answer)) throw new Error("待回答问题已经变化，请刷新后重新选择");
    answers[id] = answer;
  }
  if (requireAnswer && !reply.note.trim() && !questions.every((question) => Object.hasOwn(answers, question.id))) throw new Error("请选择各题选项，或补充你的想法");
  return { answers, note: reply.note };
}
