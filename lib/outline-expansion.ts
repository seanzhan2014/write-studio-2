import { wordCount } from "./studio-display.ts";

export const DEFAULT_EXPANSION_MULTIPLIER = 10;
export const MIN_EXPANSION_MULTIPLIER = 0.000001;
export const MAX_EXPANSION_MULTIPLIER = 100000;
export const EXPANSION_DECIMALS = 6;
export const EXPANSION_MULTIPLIER_HELP = "请输入大于 0 且不超过 100,000 的倍率，最多六位小数";
export type OutlineSentence = { start: number; end: number; text: string };
export type SentenceMultiplier = OutlineSentence & { multiplier: number };
export type OutlineExpansion = { enabled: boolean; defaultMultiplier?: number; marks: SentenceMultiplier[] };
export type ExpansionSentence = SentenceMultiplier & { source: "sentence" | "previous" | "outline" | "global"; words: number; targetCharacters: number };
export type ExpansionSnapshot = { defaultMultiplier: number; sentences: ExpansionSentence[]; estimatedCharacters: number };

export function isExpansionMultiplier(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_EXPANSION_MULTIPLIER && value <= MAX_EXPANSION_MULTIPLIER && Math.abs(value - Number(value.toFixed(EXPANSION_DECIMALS))) < 1e-10;
}
export function normalizeExpansionMultiplier(value: unknown, fallback = DEFAULT_EXPANSION_MULTIPLIER) {
  return isExpansionMultiplier(value) ? value : fallback;
}

/** Legacy totals are a one-time conversion source, never a continuing total cap. */
export function convertTargetWordsToExpansion(plan: string, targetWords: number | undefined, value?: OutlineExpansion): OutlineExpansion {
  const normalized = normalizeOutlineExpansion(plan, value);
  const words = wordCount(plan);
  const multiplier = words > 0 && targetWords !== undefined && Number.isFinite(targetWords) && targetWords > 0
    ? Number((targetWords / words).toFixed(EXPANSION_DECIMALS)) : undefined;
  return { enabled: true, ...(isExpansionMultiplier(multiplier) ? { defaultMultiplier: multiplier } : {}), marks: normalized?.marks ?? [] };
}

export function outlineExpansionForEditing(plan: string, value: OutlineExpansion | undefined, legacyTargetWords?: number): OutlineExpansion {
  const normalized = normalizeOutlineExpansion(plan, value);
  return normalized?.enabled ? normalized : convertTargetWordsToExpansion(plan, legacyTargetWords, normalized);
}

/** Only whole sentences can carry metadata. Whitespace and punctuation remain in the original plan. */
export function outlineSentences(plan: string): OutlineSentence[] {
  const result: OutlineSentence[] = [];
  let start = 0;
  const add = (end: number) => {
    while (start < end && /\s/u.test(plan[start])) start++;
    let trimmedEnd = end;
    while (trimmedEnd > start && /\s/u.test(plan[trimmedEnd - 1])) trimmedEnd--;
    if (trimmedEnd > start) result.push({ start, end: trimmedEnd, text: plan.slice(start, trimmedEnd) });
    start = end;
  };
  for (let index = 0; index < plan.length; index++) {
    const char = plan[index];
    if (char === "\n" || char === "\r") { add(index); start = index + 1; continue; }
    if (/[。！？!?]/u.test(char) || (char === "." && /[\s”’"')\]]|^$/u.test(plan[index + 1] ?? ""))) {
      while (index + 1 < plan.length && /[。！？!?.”’"'）)\]】」』]/u.test(plan[index + 1])) index++;
      add(index + 1);
    }
  }
  add(plan.length);
  return result;
}

export function normalizeOutlineExpansion(plan: string, value: unknown): OutlineExpansion | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Partial<OutlineExpansion>;
  const sentences = outlineSentences(plan);
  const marks = new Map<number, SentenceMultiplier>();
  for (const mark of Array.isArray(source.marks) ? source.marks.slice(0, 5000) : []) {
    if (!mark || !isExpansionMultiplier(mark.multiplier)) continue;
    const sentence = sentences.find(sentence => sentence.start === mark.start && sentence.end === mark.end && sentence.text === mark.text);
    if (sentence) marks.set(sentence.start, { ...sentence, multiplier: mark.multiplier });
  }
  return { enabled: source.enabled === true, ...(isExpansionMultiplier(source.defaultMultiplier) ? { defaultMultiplier: source.defaultMultiplier } : {}), marks: [...marks.values()].sort((a, b) => a.start - b.start) };
}

/** Map the changed interval, including edits made outside the generation page. */
export function rebaseOutlineExpansion(before: string, after: string, value: unknown): OutlineExpansion | undefined {
  const expansion = normalizeOutlineExpansion(before, value);
  if (!expansion || before === after) return expansion;
  let left = 0;
  while (left < before.length && left < after.length && before[left] === after[left]) left++;
  let oldRight = before.length, newRight = after.length;
  while (oldRight > left && newRight > left && before[oldRight - 1] === after[newRight - 1]) { oldRight--; newRight--; }
  const delta = after.length - before.length;
  const mapped = expansion.marks.flatMap(mark => {
    // A fully replaced sentence has no remaining anchor; never attach its mark to unrelated text.
    if (mark.start >= left && mark.end <= oldRight && oldRight > left) return [];
    if (mark.start < oldRight && mark.end > left && !wordCount(before.slice(mark.start, Math.min(mark.end, left)) + before.slice(Math.max(mark.start, oldRight), mark.end))) return [];
    const start = mark.start >= oldRight ? mark.start + delta : Math.min(mark.start, left);
    const end = mark.end <= left ? mark.end : mark.end >= oldRight ? mark.end + delta : newRight;
    return [{ start, end, multiplier: mark.multiplier }];
  });
  const marks = outlineSentences(after).flatMap(sentence => {
    const overlaps = mapped.filter(mark => mark.start < sentence.end && mark.end > sentence.start);
    const multipliers = new Set(overlaps.map(mark => mark.multiplier));
    return multipliers.size === 1 ? [{ ...sentence, multiplier: overlaps[0].multiplier }] : [];
  });
  return { ...expansion, marks };
}

export function resolveOutlineExpansion(plan: string, value: unknown, globalMultiplier: unknown = DEFAULT_EXPANSION_MULTIPLIER): ExpansionSnapshot | undefined {
  const expansion = normalizeOutlineExpansion(plan, value);
  if (!expansion?.enabled) return undefined;
  const defaultMultiplier = expansion.defaultMultiplier ?? normalizeExpansionMultiplier(globalMultiplier);
  let multiplier = defaultMultiplier;
  let exactTotal = 0, roundedTotal = 0;
  const sentences = outlineSentences(plan).map((sentence, index): ExpansionSentence => {
    const explicit = expansion.marks.find(mark => mark.start === sentence.start);
    if (explicit) multiplier = explicit.multiplier;
    const words = wordCount(sentence.text);
    exactTotal += words * multiplier;
    const targetCharacters = Math.round(exactTotal) - roundedTotal;
    roundedTotal += targetCharacters;
    return { ...sentence, multiplier, source: explicit ? "sentence" : index ? "previous" : expansion.defaultMultiplier !== undefined ? "outline" : "global", words, targetCharacters };
  });
  return { defaultMultiplier, sentences, estimatedCharacters: sentences.reduce((sum, sentence) => sum + sentence.targetCharacters, 0) };
}

export function validOutlineExpansion(plan: string, value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as OutlineExpansion;
  if (typeof source.enabled !== "boolean" || !Array.isArray(source.marks) || source.marks.length > 5000 || (source.defaultMultiplier !== undefined && !isExpansionMultiplier(source.defaultMultiplier))) return false;
  const normalized = normalizeOutlineExpansion(plan, source)!;
  return normalized.marks.length === source.marks.length;
}
