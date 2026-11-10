import { wordCount } from "./studio-display.ts";

export const DEFAULT_EXPANSION_MULTIPLIER = 10;
export const DEFAULT_SENTENCE_TARGET_WORDS = 300;
export const MAX_SENTENCE_TARGET_WORDS = 100000;
export const MIN_EXPANSION_MULTIPLIER = 0.000001;
export const MAX_EXPANSION_MULTIPLIER = 100000;
export const EXPANSION_DECIMALS = 6;
export const EXPANSION_MULTIPLIER_HELP = "请输入大于 0 且不超过 100,000 的倍率，最多六位小数";
export type OutlineSentence = { start: number; end: number; text: string };
export type OutlineLengthMode = "target" | "multiplier" | "words";
export type SentenceLength = { multiplier: number; targetWords?: never } | { targetWords: number; multiplier?: never };
export type SentenceMultiplier = OutlineSentence & SentenceLength;
export type OutlineExpansion = { enabled: boolean; mode?: "words"; defaultMultiplier?: number; defaultTargetWords?: number; marks: SentenceMultiplier[] };
export type ExpansionSentence = SentenceMultiplier & { source: "sentence" | "previous" | "outline" | "global"; words: number; targetCharacters: number };
export type ExpansionSnapshot = { defaultMultiplier: number; defaultTargetWords?: number; mode?: "words"; sentences: ExpansionSentence[]; estimatedCharacters: number };

export function isSentenceTargetWords(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SENTENCE_TARGET_WORDS;
}
export function normalizeSentenceTargetWords(value: unknown) {
  return isSentenceTargetWords(value) ? value : DEFAULT_SENTENCE_TARGET_WORDS;
}
export function normalizeOutlineLengthMode(value: unknown): OutlineLengthMode {
  return value === "multiplier" || value === "words" ? value : "target";
}
export function outlineLengthMode(value?: OutlineExpansion): OutlineLengthMode {
  return !value?.enabled ? "target" : value.mode === "words" ? "words" : "multiplier";
}
export function withOutlineLengthMode(value: OutlineExpansion | undefined, mode: OutlineLengthMode): OutlineExpansion {
  const next: OutlineExpansion = { ...(value ?? { marks: [] }), enabled: mode !== "target" };
  if (mode === "words") next.mode = "words";
  else if (mode === "multiplier") delete next.mode;
  return next;
}
function sentenceLength(value: Partial<SentenceLength>): SentenceLength | undefined {
  if (value.targetWords !== undefined) return isSentenceTargetWords(value.targetWords) && value.multiplier === undefined ? { targetWords: value.targetWords } : undefined;
  return isExpansionMultiplier(value.multiplier) ? { multiplier: value.multiplier } : undefined;
}
export function sentenceLengthLabel(value: SentenceLength) {
  return value.targetWords !== undefined ? `${value.targetWords.toLocaleString("zh-CN")} 字` : `${value.multiplier}×`;
}

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

/** Opening or editing an outline preserves its chosen length mode. */
export function outlineExpansionForEditing(plan: string, value: OutlineExpansion | undefined, fallbackMode: unknown = "target"): OutlineExpansion | undefined {
  return normalizeOutlineExpansion(plan, value) ?? (normalizeOutlineLengthMode(fallbackMode) === "target" ? undefined : withOutlineLengthMode(undefined, normalizeOutlineLengthMode(fallbackMode)));
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
    const length = mark && sentenceLength(mark);
    if (!length) continue;
    const sentence = sentences.find(sentence => sentence.start === mark.start && sentence.end === mark.end && sentence.text === mark.text);
    if (sentence) marks.set(sentence.start, { ...sentence, ...length });
  }
  return { enabled: source.enabled === true, ...(source.mode === "words" ? { mode: "words" as const } : {}), ...(isExpansionMultiplier(source.defaultMultiplier) ? { defaultMultiplier: source.defaultMultiplier } : {}), ...(isSentenceTargetWords(source.defaultTargetWords) ? { defaultTargetWords: source.defaultTargetWords } : {}), marks: [...marks.values()].sort((a, b) => a.start - b.start) };
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
    return [{ start, end, ...sentenceLength(mark)! }];
  });
  const marks = outlineSentences(after).flatMap(sentence => {
    const overlaps = mapped.filter(mark => mark.start < sentence.end && mark.end > sentence.start);
    const lengths = new Set(overlaps.map(mark => JSON.stringify(sentenceLength(mark))));
    return lengths.size === 1 ? [{ ...sentence, ...sentenceLength(overlaps[0])! }] : [];
  });
  return { ...expansion, marks };
}

export function resolveOutlineExpansion(plan: string, value: unknown, globalMultiplier: unknown = DEFAULT_EXPANSION_MULTIPLIER, globalTargetWords: unknown = DEFAULT_SENTENCE_TARGET_WORDS): ExpansionSnapshot | undefined {
  const expansion = normalizeOutlineExpansion(plan, value);
  if (!expansion?.enabled) return undefined;
  const defaultMultiplier = expansion.defaultMultiplier ?? normalizeExpansionMultiplier(globalMultiplier);
  const defaultTargetWords = expansion.defaultTargetWords ?? normalizeSentenceTargetWords(globalTargetWords);
  let length: SentenceLength = expansion.mode === "words" ? { targetWords: defaultTargetWords } : { multiplier: defaultMultiplier };
  let exactTotal = 0, roundedTotal = 0;
  const sentences = outlineSentences(plan).map((sentence, index): ExpansionSentence => {
    const explicit = expansion.marks.find(mark => mark.start === sentence.start);
    if (explicit) length = sentenceLength(explicit)!;
    const words = wordCount(sentence.text);
    exactTotal += length.targetWords !== undefined ? length.targetWords : words * length.multiplier;
    const targetCharacters = Math.round(exactTotal) - roundedTotal;
    roundedTotal += targetCharacters;
    return { ...sentence, ...length, source: explicit ? "sentence" : index ? "previous" : (expansion.mode === "words" ? expansion.defaultTargetWords : expansion.defaultMultiplier) !== undefined ? "outline" : "global", words, targetCharacters };
  });
  return { defaultMultiplier, ...(expansion.mode === "words" ? { mode: "words" as const, defaultTargetWords } : {}), sentences, estimatedCharacters: sentences.reduce((sum, sentence) => sum + sentence.targetCharacters, 0) };
}

export function validOutlineExpansion(plan: string, value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as OutlineExpansion;
  if (typeof source.enabled !== "boolean" || !Array.isArray(source.marks) || source.marks.length > 5000 || (source.defaultMultiplier !== undefined && !isExpansionMultiplier(source.defaultMultiplier))) return false;
  if ((source.mode !== undefined && source.mode !== "words") || (source.defaultTargetWords !== undefined && !isSentenceTargetWords(source.defaultTargetWords))) return false;
  const normalized = normalizeOutlineExpansion(plan, source)!;
  return normalized.marks.length === source.marks.length;
}
