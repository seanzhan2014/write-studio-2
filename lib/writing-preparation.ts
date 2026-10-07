export const PREPARATION_SECTIONS = [
  ["purpose", "核心与作用"], ["boundaries", "开头与结尾"], ["scenes", "场景推进"],
  ["actions", "人物目标与行动"], ["knowledge", "认知与信息边界"], ["perspective", "视角与信息揭示"],
  ["emotion", "情绪与关系"], ["constraints", "事实与约束"], ["expression", "表现与篇幅"],
] as const;
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

function requiredText(value: unknown, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error("准备稿返回格式无效，请重试");
  return value.trim();
}
export function parsePreparationResponse(text: string) {
  const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!value || typeof value.brief !== "object" || !Array.isArray(value.questions) || value.questions.length > 3) throw new Error("准备稿必须包含九项内容及最多三个问题");
  const brief = PREPARATION_SECTIONS.map(([key, title], index) => `${index + 1}. ${title}\n${requiredText(value.brief[key], 6000)}`).join("\n\n");
  const ids = new Set<string>();
  const questions: PreparationQuestion[] = value.questions.map((question: Record<string, unknown>) => {
    const id = requiredText(question.id, 80);
    if (ids.has(id) || !Array.isArray(question.options) || question.options.length > 4) throw new Error("准备稿问题编号或选项无效");
    ids.add(id);
    const optionIds = new Set<string>();
    return { id, title: requiredText(question.title, 500), reason: requiredText(question.reason, 1500), options: question.options.map((option: Record<string, unknown>) => {
      const optionId = requiredText(option.id, 80);
      if (optionIds.has(optionId)) throw new Error("准备稿选项编号重复");
      optionIds.add(optionId);
      return { id: optionId, label: requiredText(option.label, 500), description: requiredText(option.description, 1500) };
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
