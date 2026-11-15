export const LEGACY_STORY_LABELS: Record<string, string> = { type: "类型", era: "时代背景", worldRules: "世界规则", tone: "语调" };
export const LEGACY_CHARACTER_LABELS: Record<string, string> = { identity: "身份", personality: "性格", speechStyle: "说话方式", abilities: "能力", mentalState: "心理状态", knownInformation: "已知信息", boundaries: "人物底线" };
type Override = { value: string; scope: "ongoing" | "chapter" };
export type LegacySettings = { story: Record<string, Override>; characters: Record<string, { start: Record<string, Override>; end: Record<string, string> }> };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function overrides(value: unknown, labels: Record<string, string>) {
  const raw = record(value), result: Record<string, Override> = {};
  for (const key of Object.keys(labels)) {
    const item = record(raw[key]);
    if (typeof item.value === "string") result[key] = { value: item.value.slice(0, 30_000), scope: item.scope === "chapter" ? "chapter" : "ongoing" };
  }
  return result;
}

/** Retain each retired field independently, including its original lifetime. */
export function normalizeLegacySettings(value: unknown): LegacySettings | undefined {
  const raw = record(value), stored = record(raw.legacy);
  const story = { ...overrides(raw.story, LEGACY_STORY_LABELS), ...overrides(stored.story, LEGACY_STORY_LABELS) };
  const original = record(raw.characters), saved = record(stored.characters), characters: LegacySettings["characters"] = {};
  for (const id of new Set([...Object.keys(original), ...Object.keys(saved)])) {
    const old = record(original[id]), current = record(saved[id]);
    const start = { ...overrides(old.start, LEGACY_CHARACTER_LABELS), ...overrides(current.start, LEGACY_CHARACTER_LABELS) };
    const ending = { ...record(old.end), ...record(current.end) }, end: Record<string, string> = {};
    for (const key of Object.keys(LEGACY_CHARACTER_LABELS)) if (typeof ending[key] === "string") end[key] = String(ending[key]).slice(0, 20_000);
    if (Object.keys(start).length || Object.keys(end).length) characters[id] = { start, end };
  }
  return Object.keys(story).length || Object.keys(characters).length ? { story, characters } : undefined;
}

type Chapter = { id: string; archived: boolean; settings?: unknown; outlines?: Array<{ id: string; archived: boolean; settings?: unknown }> };
export function resolveLegacyContext(chapters: Chapter[], chapterId: string, outlineId?: string) {
  const story: Record<string, string> = {}, characters = new Map<string, Record<string, string>>();
  const lines = (values: Record<string, string>, labels: Record<string, string>) => Object.entries(values).filter(([, value]) => value.trim()).map(([key, value]) => `${labels[key]}：${value}`).join("\n");
  function apply(settings: unknown, preceding: boolean) {
    const legacy = normalizeLegacySettings(settings);
    if (!legacy) return;
    for (const [key, item] of Object.entries(legacy.story)) if (!preceding || item.scope === "ongoing") story[key] = item.value;
    for (const [id, item] of Object.entries(legacy.characters)) {
      const profile = characters.get(id) ?? {};
      for (const [key, change] of Object.entries(item.start)) if (!preceding || change.scope === "ongoing") profile[key] = change.value;
      if (preceding) Object.assign(profile, item.end);
      characters.set(id, profile);
    }
  }
  const index = chapters.findIndex(chapter => chapter.id === chapterId);
  for (const chapter of chapters.slice(0, Math.max(0, index))) if (!chapter.archived) apply(chapter.settings, true);
  const chapter = chapters[index];
  apply(chapter?.settings, false);
  const outlineIndex = chapter?.outlines?.findIndex(outline => outline.id === outlineId) ?? -1;
  if (outlineId) {
    for (const outline of chapter?.outlines?.slice(0, Math.max(0, outlineIndex)) ?? []) if (!outline.archived) apply(outline.settings, true);
    apply(chapter?.outlines?.[outlineIndex]?.settings, false);
  }
  const endings = new Map<string, string>();
  for (const current of [chapter?.settings, ...(outlineId ? [chapter?.outlines?.[outlineIndex]?.settings] : [])]) {
    for (const [id, item] of Object.entries(normalizeLegacySettings(current)?.characters ?? {})) {
      const content = lines(item.end, LEGACY_CHARACTER_LABELS);
      if (content) endings.set(id, [endings.get(id), content].filter(Boolean).join("\n"));
    }
  }
  const { tone, ...facts } = story;
  return { summary: lines(facts, LEGACY_STORY_LABELS), tone: tone ?? "", descriptions: new Map([...characters].map(([id, values]) => [id, lines(values, LEGACY_CHARACTER_LABELS)])), endings };
}
