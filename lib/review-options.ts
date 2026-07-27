export const MAX_REVIEW_PRESETS = 20;
export const MAX_REVIEW_PRESET_CHARACTERS = 2000;

export const BUILTIN_REVIEW_REQUIREMENTS = [
  "修正中文正文中无必要夹杂的英文表达；保留人物名、品牌、专有名词、URL、代码和有意设计的英文对白。",
  "检查同一章节内重复的场景描写；保留第一次或最有效的完整描写，后续只保留推进情节或新增的信息。",
  "检查人物外貌、物品和其他事物的重复描写；保留必要的呼应与伏笔，将无新增信息的重复介绍删除或压缩。",
] as const;

export function normalizeReviewPresets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => String(item).trim().slice(0, MAX_REVIEW_PRESET_CHARACTERS))
    .filter(Boolean))]
    .slice(0, MAX_REVIEW_PRESETS);
}
