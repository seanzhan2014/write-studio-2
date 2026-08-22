import type { AiTask, Article, Chapter, Character, Outline, Relationship, StudioData, StudioSettings } from "@/app/studio-state";

export type StudioArticleChange = Omit<Article, "chapters" | "characters" | "relationships">;
export type StudioChapterChange = { articleId: string; position: number; chapter: Omit<Chapter, "outlines"> };
export type StudioOutlineChange = { articleId: string; chapterId: string; position: number; outline: Outline };
export type StudioCharacterChange = { articleId: string; character: Character };
export type StudioRelationshipChange = { articleId: string; relationship: Relationship };

export type StudioChanges = {
  version: 1;
  settings?: StudioSettings;
  articles: { upsert: StudioArticleChange[]; delete: string[] };
  chapters: { upsert: StudioChapterChange[]; delete: string[] };
  outlines: { upsert: StudioOutlineChange[]; delete: string[] };
  characters: { upsert: StudioCharacterChange[]; delete: string[] };
  relationships: { upsert: StudioRelationshipChange[]; delete: string[] };
  tasks: { upsert: AiTask[]; delete: string[] };
};

type LocatedChapter = { articleId: string; position: number; chapter: Omit<Chapter, "outlines"> };
type LocatedOutline = { articleId: string; chapterId: string; position: number; outline: Outline };

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function articleRecord(article: Article): StudioArticleChange {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    type: article.type,
    style: article.style,
    chapterNaming: article.chapterNaming,
    outlineNaming: article.outlineNaming,
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

export function diffStudioData(before: StudioData, after: StudioData): StudioChanges {
  const previous = indexStudioData(before);
  const next = indexStudioData(after);
  return {
    version: 1,
    ...(same(before.settings, after.settings) ? {} : { settings: after.settings }),
    articles: { upsert: changedValues(previous.articles, next.articles), delete: deletedIds(previous.articles, next.articles) },
    chapters: { upsert: changedValues(previous.chapters, next.chapters), delete: deletedIds(previous.chapters, next.chapters) },
    outlines: { upsert: changedValues(previous.outlines, next.outlines), delete: deletedIds(previous.outlines, next.outlines) },
    characters: { upsert: changedValues(previous.characters, next.characters), delete: deletedIds(previous.characters, next.characters) },
    relationships: { upsert: changedValues(previous.relationships, next.relationships), delete: deletedIds(previous.relationships, next.relationships) },
    tasks: { upsert: changedValues(previous.tasks, next.tasks), delete: deletedIds(previous.tasks, next.tasks) },
  };
}

export function emptyStudioChanges(): StudioChanges {
  return {
    version: 1,
    articles: { upsert: [], delete: [] },
    chapters: { upsert: [], delete: [] },
    outlines: { upsert: [], delete: [] },
    characters: { upsert: [], delete: [] },
    relationships: { upsert: [], delete: [] },
    tasks: { upsert: [], delete: [] },
  };
}

export function isStudioChangesEmpty(changes: StudioChanges) {
  return !changes.settings && [changes.articles, changes.chapters, changes.outlines, changes.characters, changes.relationships, changes.tasks]
    .every((group) => group.upsert.length === 0 && group.delete.length === 0);
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

export function mergeStudioChanges(values: StudioChanges[]) {
  const merged = emptyStudioChanges();
  for (const value of values) {
    if (value.settings) merged.settings = value.settings;
    mergeGroup(merged.articles, value.articles, (item) => item.id);
    mergeGroup(merged.chapters, value.chapters, (item) => item.chapter.id);
    mergeGroup(merged.outlines, value.outlines, (item) => item.outline.id);
    mergeGroup(merged.characters, value.characters, (item) => item.character.id);
    mergeGroup(merged.relationships, value.relationships, (item) => item.relationship.id);
    mergeGroup(merged.tasks, value.tasks, (item) => item.id);
  }
  return merged;
}

export function isStudioChanges(value: unknown): value is StudioChanges {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) return false;
  const source = value as Partial<StudioChanges>;
  return [source.articles, source.chapters, source.outlines, source.characters, source.relationships, source.tasks].every((group) =>
    Boolean(group && Array.isArray(group.upsert) && Array.isArray(group.delete) && group.delete.every((id) => typeof id === "string" && id.length > 0 && id.length <= 240)),
  );
}
