import type { AiTask, Article, Chapter, Character, Outline, Relationship, StudioData, StudioSettings } from "@/app/studio-state";
import { articleReviewRules } from "@/lib/review-rules.mjs";
import equal from "fast-deep-equal";
import { outlineDisplayTitle } from "@/lib/outline-title";

export type StudioArticleChange = Omit<Article, "chapters" | "characters" | "relationships">;
export type StudioChapterChange = { articleId: string; position: number; chapter: Omit<Chapter, "outlines"> };
export type StudioOutlineChange = { articleId: string; chapterId: string; position: number; outline: Outline };
export type StudioCharacterChange = { articleId: string; character: Character };
export type StudioRelationshipChange = { articleId: string; relationship: Relationship };

export type StudioOutlinePatch = {
  id: string;
  articleId: string;
  chapterId: string;
  location?: Partial<Pick<StudioOutlineChange, "articleId" | "chapterId" | "position">>;
  outline?: Partial<Pick<Outline, "title" | "nameVersions" | "defaultNameVersionId" | "plan" | "generateInstruction" | "generateOptions" | "illustrationOptions" | "settings" | "archived" | "state" | "titleGenerationPending" | "updatedAt">>;
  content?: Partial<Pick<Outline, "content" | "contentName" | "currentVersionId" | "defaultVersionId" | "contentOutlineSnapshot" | "manualExcellent">>;
  versions?: Outline["versions"];
  excellentFragments?: Outline["excellentFragments"];
  chat?: Outline["chat"];
  refreshSearch?: { title: string };
};

export type StudioChanges = {
  version: 1 | 2;
  settings?: StudioSettings;
  articles: { upsert: StudioArticleChange[]; delete: string[] };
  chapters: { upsert: StudioChapterChange[]; delete: string[] };
  outlines: { upsert: StudioOutlineChange[]; patch?: StudioOutlinePatch[]; delete: string[] };
  characters: { upsert: StudioCharacterChange[]; delete: string[] };
  relationships: { upsert: StudioRelationshipChange[]; delete: string[] };
  tasks: { upsert: AiTask[]; delete: string[] };
};

type LocatedChapter = { articleId: string; position: number; chapter: Omit<Chapter, "outlines"> };
type LocatedOutline = { articleId: string; chapterId: string; position: number; outline: Outline };

function jsonComparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : jsonComparable(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, jsonComparable(item)]));
  }
  return value;
}

// HTTP JSON drops undefined object fields. Treat those as absent while keeping
// fast-deep-equal's property-order-independent comparison for normal saves.
const same = (left: unknown, right: unknown) => equal(left, right) || equal(jsonComparable(left), jsonComparable(right));

const outlineFieldKeys = ["title", "nameVersions", "defaultNameVersionId", "plan", "generateInstruction", "generateOptions", "illustrationOptions", "settings", "archived", "state", "titleGenerationPending", "updatedAt"] as const;
const contentFieldKeys = ["content", "contentName", "currentVersionId", "defaultVersionId", "contentOutlineSnapshot", "manualExcellent"] as const;

function changedFields<T extends object, K extends keyof T>(before: T, after: T, keys: readonly K[]) {
  const result: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    // JSON cannot represent an object property whose value is undefined. Those
    // legacy optional fields must not turn into a visually empty, invalid patch.
    if (after[key] !== undefined && !same(before[key], after[key])) (result as Record<keyof T, unknown>)[key] = after[key];
  }
  return result;
}

function hasFields(value: object | undefined) {
  return Boolean(value && Object.keys(value).length);
}

function articleRecord(article: Article): StudioArticleChange {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    type: article.type,
    style: article.style,
    storySettings: article.storySettings,
    reviewRules: article.reviewRules ?? "",
    reviewRuleItems: articleReviewRules(article),
    chapterNaming: article.chapterNaming,
    outlineNaming: article.outlineNaming,
    aiGenerateSettings: article.aiGenerateSettings,
    illustrationSettings: article.illustrationSettings,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    lastOutlineId: article.lastOutlineId,
  };
}

function chapterRecord(chapter: Chapter): Omit<Chapter, "outlines"> {
  return {
    id: chapter.id,
    title: chapter.title,
    nameVersions: chapter.nameVersions,
    defaultNameVersionId: chapter.defaultNameVersionId,
    archived: chapter.archived,
    settings: chapter.settings,
  };
}

function indexStudioData(data: StudioData) {
  const articles = new Map<string, StudioArticleChange>();
  const chapters = new Map<string, LocatedChapter>();
  const outlines = new Map<string, LocatedOutline>();
  const characters = new Map<string, StudioCharacterChange>();
  const relationships = new Map<string, StudioRelationshipChange>();
  const tasks = new Map(data.tasks.map((task) => [task.id, task]));
  for (const article of data.articles) {
    articles.set(article.id, articleRecord(article));
    article.chapters.forEach((chapter, chapterIndex) => {
      chapters.set(chapter.id, { articleId: article.id, position: (chapterIndex + 1) * 1024, chapter: chapterRecord(chapter) });
      chapter.outlines.forEach((outline, outlineIndex) => {
        outlines.set(outline.id, { articleId: article.id, chapterId: chapter.id, position: (outlineIndex + 1) * 1024, outline });
      });
    });
    article.characters.forEach((character) => characters.set(character.id, { articleId: article.id, character }));
    article.relationships.forEach((relationship) => relationships.set(relationship.id, { articleId: article.id, relationship }));
  }
  return { articles, chapters, outlines, characters, relationships, tasks };
}

function changedValues<T>(before: Map<string, T>, after: Map<string, T>) {
  return [...after].filter(([id, value]) => !before.has(id) || !same(before.get(id), value)).map(([, value]) => value);
}

function deletedIds<T>(before: Map<string, T>, after: Map<string, T>) {
  return [...before.keys()].filter((id) => !after.has(id));
}

function changedOutlines(before: Map<string, LocatedOutline>, after: Map<string, LocatedOutline>) {
  const upsert: StudioOutlineChange[] = [];
  const patch: StudioOutlinePatch[] = [];
  for (const [id, next] of after) {
    const previous = before.get(id);
    if (!previous) {
      upsert.push(next);
      continue;
    }
    if (same(previous, next)) continue;

    const location = changedFields(previous, next, ["articleId", "chapterId", "position"] as const);
    const outline = changedFields(previous.outline, next.outline, outlineFieldKeys);
    const content = changedFields(previous.outline, next.outline, contentFieldKeys);
    const versionsChanged = !same(previous.outline.versions, next.outline.versions);
    const excellentFragmentsChanged = !same(previous.outline.excellentFragments, next.outline.excellentFragments);
    const chatChanged = !same(previous.outline.chat, next.outline.chat);
    const refreshSearch = hasFields(location) && (location.articleId !== undefined || location.chapterId !== undefined)
      || Object.prototype.hasOwnProperty.call(outline, "title")
      || Object.prototype.hasOwnProperty.call(outline, "plan")
      || Object.prototype.hasOwnProperty.call(content, "content")
      || Object.prototype.hasOwnProperty.call(content, "currentVersionId")
      || versionsChanged;

    const change: StudioOutlinePatch = {
      id,
      articleId: next.articleId,
      chapterId: next.chapterId,
      ...(hasFields(location) ? { location } : {}),
      ...(hasFields(outline) ? { outline } : {}),
      ...(hasFields(content) ? { content } : {}),
      ...(versionsChanged ? { versions: next.outline.versions } : {}),
      ...(excellentFragmentsChanged ? { excellentFragments: next.outline.excellentFragments } : {}),
      ...(chatChanged ? { chat: next.outline.chat } : {}),
      ...(refreshSearch ? { refreshSearch: { title: outlineDisplayTitle(next.outline) } } : {}),
    };
    if ([change.location, change.outline, change.content, change.versions, change.excellentFragments, change.chat]
      .some((part) => part !== undefined && (!isRecord(part) || Object.keys(part).length > 0))) patch.push(change);
  }
  return { upsert, patch, delete: deletedIds(before, after) };
}

export function diffStudioData(before: StudioData, after: StudioData): StudioChanges {
  const previous = indexStudioData(before);
  const next = indexStudioData(after);
  return {
    version: 2,
    ...(same(before.settings, after.settings) ? {} : { settings: after.settings }),
    articles: { upsert: changedValues(previous.articles, next.articles), delete: deletedIds(previous.articles, next.articles) },
    chapters: { upsert: changedValues(previous.chapters, next.chapters), delete: deletedIds(previous.chapters, next.chapters) },
    outlines: changedOutlines(previous.outlines, next.outlines),
    characters: { upsert: changedValues(previous.characters, next.characters), delete: deletedIds(previous.characters, next.characters) },
    relationships: { upsert: changedValues(previous.relationships, next.relationships), delete: deletedIds(previous.relationships, next.relationships) },
    tasks: { upsert: changedValues(previous.tasks, next.tasks), delete: deletedIds(previous.tasks, next.tasks) },
  };
}

export function emptyStudioChanges(): StudioChanges {
  return {
    version: 2,
    articles: { upsert: [], delete: [] },
    chapters: { upsert: [], delete: [] },
    outlines: { upsert: [], patch: [], delete: [] },
    characters: { upsert: [], delete: [] },
    relationships: { upsert: [], delete: [] },
    tasks: { upsert: [], delete: [] },
  };
}

export function isStudioChangesEmpty(changes: StudioChanges) {
  return !changes.settings && [changes.articles, changes.chapters, changes.outlines, changes.characters, changes.relationships, changes.tasks]
    .every((group) => group.upsert.length === 0 && group.delete.length === 0)
    && (changes.outlines.patch?.length ?? 0) === 0;
}

function mergeGroup<T extends object>(
  target: { upsert: T[]; delete: string[] },
  source: { upsert: T[]; delete: string[] },
  idOf: (value: T) => string,
) {
  const upserts = new Map(target.upsert.map((value) => [idOf(value), value]));
  const deleted = new Set(target.delete);
  for (const id of source.delete) { upserts.delete(id); deleted.add(id); }
  for (const value of source.upsert) { const id = idOf(value); deleted.delete(id); upserts.set(id, value); }
  target.upsert = [...upserts.values()];
  target.delete = [...deleted];
}

function applyOutlinePatch(target: StudioOutlineChange, patch: StudioOutlinePatch): StudioOutlineChange {
  return {
    articleId: patch.location?.articleId ?? patch.articleId ?? target.articleId,
    chapterId: patch.location?.chapterId ?? patch.chapterId ?? target.chapterId,
    position: patch.location?.position ?? target.position,
    outline: {
      ...target.outline,
      ...patch.outline,
      ...patch.content,
      ...(Object.prototype.hasOwnProperty.call(patch, "versions") ? { versions: patch.versions } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "excellentFragments") ? { excellentFragments: patch.excellentFragments } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "chat") ? { chat: patch.chat } : {}),
    },
  };
}

function mergeOutlinePatch(previous: StudioOutlinePatch | undefined, next: StudioOutlinePatch): StudioOutlinePatch {
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    location: { ...previous.location, ...next.location },
    outline: { ...previous.outline, ...next.outline },
    content: { ...previous.content, ...next.content },
    ...(Object.prototype.hasOwnProperty.call(next, "versions") ? { versions: next.versions } : {}),
    ...(Object.prototype.hasOwnProperty.call(next, "excellentFragments") ? { excellentFragments: next.excellentFragments } : {}),
    ...(Object.prototype.hasOwnProperty.call(next, "chat") ? { chat: next.chat } : {}),
    ...(next.refreshSearch ? { refreshSearch: next.refreshSearch } : {}),
  };
}

function mergeOutlineGroup(target: StudioChanges["outlines"], source: StudioChanges["outlines"]) {
  const upserts = new Map(target.upsert.map((value) => [value.outline.id, value]));
  const patches = new Map((target.patch ?? []).map((value) => [value.id, value]));
  const deleted = new Set(target.delete);
  for (const id of source.delete) {
    upserts.delete(id);
    patches.delete(id);
    deleted.add(id);
  }
  for (const value of source.upsert) {
    const id = value.outline.id;
    deleted.delete(id);
    patches.delete(id);
    upserts.set(id, value);
  }
  for (const value of source.patch ?? []) {
    const id = value.id;
    deleted.delete(id);
    const upsert = upserts.get(id);
    if (upsert) upserts.set(id, applyOutlinePatch(upsert, value));
    else patches.set(id, mergeOutlinePatch(patches.get(id), value));
  }
  target.upsert = [...upserts.values()];
  target.patch = [...patches.values()];
  target.delete = [...deleted];
}

export function mergeStudioChanges(values: StudioChanges[]) {
  const merged = emptyStudioChanges();
  for (const value of values) {
    if (value.settings) merged.settings = value.settings;
    mergeGroup(merged.articles, value.articles, (item) => item.id);
    mergeGroup(merged.chapters, value.chapters, (item) => item.chapter.id);
    mergeOutlineGroup(merged.outlines, value.outlines);
    mergeGroup(merged.characters, value.characters, (item) => item.character.id);
    mergeGroup(merged.relationships, value.relationships, (item) => item.relationship.id);
    mergeGroup(merged.tasks, value.tasks, (item) => item.id);
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function optionalString(value: Record<string, unknown>, key: string, maxLength: number) {
  return !Object.prototype.hasOwnProperty.call(value, key) || (typeof value[key] === "string" && value[key].length <= maxLength);
}

function optionalNullableId(value: Record<string, unknown>, key: string) {
  return !Object.prototype.hasOwnProperty.call(value, key) || value[key] === null || (typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 240);
}

function validOutlinePatch(value: unknown): value is StudioOutlinePatch {
  if (!isRecord(value) || !onlyKeys(value, ["id", "articleId", "chapterId", "location", "outline", "content", "versions", "excellentFragments", "chat", "refreshSearch"])) return false;
  if (![value.id, value.articleId, value.chapterId].every((id) => typeof id === "string" && id.length > 0 && id.length <= 240)) return false;

  if (value.location !== undefined) {
    if (!isRecord(value.location) || !onlyKeys(value.location, ["articleId", "chapterId", "position"])) return false;
    if (!optionalString(value.location, "articleId", 240) || !optionalString(value.location, "chapterId", 240)) return false;
    if (Object.prototype.hasOwnProperty.call(value.location, "position") && (!Number.isSafeInteger(value.location.position) || Number(value.location.position) < 0)) return false;
  }
  if (value.outline !== undefined) {
    if (!isRecord(value.outline) || !onlyKeys(value.outline, outlineFieldKeys)) return false;
    const outline = value.outline;
    if (!optionalString(outline, "title", 80) || !optionalString(outline, "plan", 10_000) || !optionalString(outline, "generateInstruction", 20_000) || !optionalString(outline, "updatedAt", 80)) return false;
    if (Object.prototype.hasOwnProperty.call(outline, "settings") && (!isRecord(outline.settings) || JSON.stringify(outline.settings).length > 500_000)) return false;
    if (Object.prototype.hasOwnProperty.call(outline, "generateOptions") && outline.generateOptions !== null && (!isRecord(outline.generateOptions) || JSON.stringify(outline.generateOptions).length > 100_000)) return false;
    if (Object.prototype.hasOwnProperty.call(outline, "illustrationOptions") && outline.illustrationOptions !== null && (!isRecord(outline.illustrationOptions) || JSON.stringify(outline.illustrationOptions).length > 50_000)) return false;
    if (Object.prototype.hasOwnProperty.call(outline, "nameVersions") && !Array.isArray(outline.nameVersions)) return false;
    if (!optionalNullableId(outline, "defaultNameVersionId")) return false;
    if (["archived", "titleGenerationPending"].some((key) => Object.prototype.hasOwnProperty.call(outline, key) && typeof outline[key] !== "boolean")) return false;
    if (Object.prototype.hasOwnProperty.call(outline, "state") && !["saved", "running", "failed"].includes(String(outline.state))) return false;
  }
  if (value.content !== undefined) {
    if (!isRecord(value.content) || !onlyKeys(value.content, contentFieldKeys)) return false;
    if (!optionalString(value.content, "content", Number.MAX_SAFE_INTEGER) || !optionalString(value.content, "contentName", 240)) return false;
    if (!optionalNullableId(value.content, "currentVersionId") || !optionalNullableId(value.content, "defaultVersionId")) return false;
    if (Object.prototype.hasOwnProperty.call(value.content, "manualExcellent") && typeof value.content.manualExcellent !== "boolean") return false;
    if (Object.prototype.hasOwnProperty.call(value.content, "contentOutlineSnapshot")) {
      const snapshot = value.content.contentOutlineSnapshot;
      if (!isRecord(snapshot) || typeof snapshot.title !== "string" || typeof snapshot.plan !== "string") return false;
    }
  }
  if (value.versions !== undefined && !Array.isArray(value.versions)) return false;
  if (value.excellentFragments !== undefined && !Array.isArray(value.excellentFragments)) return false;
  if (value.chat !== undefined && (!isRecord(value.chat) || !Array.isArray(value.chat.sessions) || typeof value.chat.activeSessionId !== "string")) return false;
  if (value.refreshSearch !== undefined && (!isRecord(value.refreshSearch) || !onlyKeys(value.refreshSearch, ["title"]) || typeof value.refreshSearch.title !== "string" || value.refreshSearch.title.length > 80)) return false;
  return [value.location, value.outline, value.content, value.versions, value.excellentFragments, value.chat].some((part) => part !== undefined && (!isRecord(part) || Object.keys(part).length > 0));
}

export function isStudioChanges(value: unknown): value is StudioChanges {
  if (!value || typeof value !== "object") return false;
  const version = (value as { version?: unknown }).version;
  if (version !== 1 && version !== 2) return false;
  const source = value as Partial<StudioChanges>;
  const validGroups = [source.articles, source.chapters, source.outlines, source.characters, source.relationships, source.tasks].every((group) =>
    Boolean(group && Array.isArray(group.upsert) && Array.isArray(group.delete) && group.delete.every((id) => typeof id === "string" && id.length > 0 && id.length <= 240)),
  );
  if (!validGroups) return false;
  const patches = source.outlines?.patch;
  if (source.version === 1) return patches === undefined;
  return Array.isArray(patches) && patches.every(validOutlinePatch);
}
