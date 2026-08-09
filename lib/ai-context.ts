import { resolvedOutlineContent } from "./outline-content";
import { outlineDisplayTitle } from "./outline-title";
import { normalizeContentGenerationMode, type ContentGenerationMode } from "./generate-options";
import { DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile, type NamingProfile } from "./naming-options";

export type AiContextKind = "chat" | "content" | "outline" | "chapter-title";

type ContextMessage = { role: "user" | "assistant"; text: string };
type ContextSession = { id: string; messages: ContextMessage[] };
type ContextOutline = {
  id: string;
  title: string;
  titleGenerationPending?: boolean;
  plan: string;
  content: string;
  contentOverride?: boolean;
  excellentFragments?: Array<{ id: string; start: number; end: number; text: string }>;
  sourceVersionId?: string;
  versions: Array<{ id: string; content: string; excellentFragments?: Array<{ id: string; start: number; end: number; text: string }> }>;
  archived: boolean;
  chat: { sessions: ContextSession[]; activeSessionId: string };
};
type ContextChapter = { id: string; title: string; archived: boolean; outlines: ContextOutline[] };
type ContextCharacter = { id: string; name: string; aliases: string[]; description: string; archived: boolean };
type ContextRelationship = { characterAId: string; characterBId: string; description: string };
type ContextArticle = {
  id: string;
  title: string;
  summary: string;
  type: string;
  style: string;
  outlineNaming?: NamingProfile;
  chapters: ContextChapter[];
  characters: ContextCharacter[];
  relationships: ContextRelationship[];
};

export type AiContextData = { articles: ContextArticle[] };

export type SelectedAiContext = {
  kind: AiContextKind;
  article: { id: string; title: string; summary: string; type: string; style: string; outlineNaming: NamingProfile };
  currentChapter: { id: string; title: string };
  currentOutline: { id: string; title: string; titleGenerationPending: boolean; plan: string; content: string };
  previousOutlines: Array<{ id: string; title: string; plan: string }>;
  previousContentTail: string;
  chapterOutlines: Array<{ id: string; title: string; plan: string }>;
  characters: Array<{ id: string; name: string; aliases: string[]; description: string; appearanceStatus?: "first" | "established" }>;
  relationships: Array<{ characterA: string; characterB: string; description: string }>;
  recentMessages: ContextMessage[];
  excellentFragments: Array<{ id: string; text: string; outlineId: string; outlineTitle: string; versionId?: string }>;
};

export type AiContextOptions = {
  includePrevious?: boolean;
  includeCharacters?: boolean;
  sessionId?: string;
  contentMode?: ContentGenerationMode;
  instruction?: string;
  currentPlan?: string;
  firstAppearanceCharacterIds?: string[];
  includeExcellentFragments?: boolean;
  excellentFragmentIds?: string[];
};

export type FirstAppearanceSuggestion = {
  characterId: string;
  name: string;
  aliases: string[];
  firstAppearance: boolean;
  previousMatch?: {
    outlineId: string;
    outlineTitle: string;
    matchedReference: string;
  };
};

export type AiContextSummary = {
  total: number;
  article: number;
  chapter: number;
  chapterOutlines: number;
  outline: number;
  content: number;
  previous: number;
  previousCount: number;
  chapterOutlineCount: number;
  characters: number;
  characterCount: number;
  previousContent: number;
  excellentFragments: number;
  excellentFragmentCount: number;
  instruction: number;
};

export class AiContextSelectionError extends Error {
  constructor(message: string, readonly code: "not_found" | "archived") {
    super(message);
    this.name = "AiContextSelectionError";
  }
}

function matchesCharacterReference(searchable: string, name: string) {
  const candidate = name.trim();
  if (!candidate) return false;
  if (/^[\x00-\x7F]+$/.test(candidate)) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`, "i").test(searchable);
  }
  return searchable.toLocaleLowerCase().includes(candidate.toLocaleLowerCase());
}

function matchedCharacterReference(searchable: string, character: ContextCharacter) {
  return [character.name, ...character.aliases].find((name) => matchesCharacterReference(searchable, name));
}

function selectExcellentFragments(article: ContextArticle, currentChapter: ContextChapter, currentOutline: ContextOutline, options: AiContextOptions) {
  if (options.includeExcellentFragments !== true) return [];
  const allowedIds = Array.isArray(options.excellentFragmentIds) ? new Set(options.excellentFragmentIds.map(String)) : null;
  const visibleOutlines = article.chapters.filter((chapter) => !chapter.archived).flatMap((chapter) => chapter.outlines.filter((outline) => !outline.archived).map((outline) => ({ chapter, outline })));
  const currentIndex = visibleOutlines.findIndex((item) => item.outline.id === currentOutline.id);
  const candidates = visibleOutlines.flatMap(({ chapter, outline }, outlineIndex) => {
    const sources = [
      ...(outline.contentOverride ? [{ content: outline.content, versionId: undefined, fragments: outline.excellentFragments ?? [] }] : []),
      ...outline.versions.map((version) => ({ content: version.content, versionId: version.id, fragments: version.excellentFragments ?? [] })),
    ];
    const priority = outline.id === currentOutline.id ? 0 : chapter.id === currentChapter.id ? 1 : outlineIndex < currentIndex ? 2 : 3;
    return sources.flatMap((source) => source.fragments.flatMap((fragment) => {
      if (allowedIds && !allowedIds.has(fragment.id)) return [];
      const text = source.content.slice(fragment.start, fragment.end);
      if (!text.trim() || text !== fragment.text) return [];
      return [{ id: fragment.id, text, outlineId: outline.id, outlineTitle: outlineDisplayTitle(outline), versionId: source.versionId, priority, outlineIndex }];
    }));
  }).sort((left, right) => left.priority - right.priority || right.outlineIndex - left.outlineIndex);

  const selected = [] as Array<{ id: string; text: string; outlineId: string; outlineTitle: string; versionId?: string }>;
  const seen = new Set<string>();
  let characters = 0;
  for (const candidate of candidates) {
    const key = candidate.text.replace(/\s+/g, " ").trim();
    if (!key || seen.has(key) || selected.length >= 20 || characters + candidate.text.length > 12_000) continue;
    seen.add(key);
    characters += candidate.text.length;
    selected.push({ id: candidate.id, text: candidate.text, outlineId: candidate.outlineId, outlineTitle: candidate.outlineTitle, versionId: candidate.versionId });
  }
  return selected;
}

export function detectFirstAppearanceCharacters(data: AiContextData, outlineId: string, options: { instruction?: string; currentPlan?: string } = {}): FirstAppearanceSuggestion[] {
  const article = data.articles.find((candidate) => candidate.chapters.some((chapter) => chapter.outlines.some((outline) => outline.id === outlineId)));
  const chapter = article?.chapters.find((candidate) => candidate.outlines.some((outline) => outline.id === outlineId));
  const outline = chapter?.outlines.find((candidate) => candidate.id === outlineId);
  if (!article || !chapter || !outline || chapter.archived || outline.archived) return [];

  const visibleOutlines = article.chapters
    .filter((candidate) => !candidate.archived)
    .flatMap((candidate) => candidate.outlines.filter((item) => !item.archived));
  const currentIndex = visibleOutlines.findIndex((candidate) => candidate.id === outline.id);
  if (currentIndex < 0) return [];

  const currentPlan = options.currentPlan ?? outline.plan;
  const currentSearchable = `${outlineDisplayTitle({ ...outline, plan: currentPlan })}\n${currentPlan}\n${String(options.instruction ?? "")}`;
  const previousOutlines = visibleOutlines.slice(0, currentIndex);
  return article.characters.filter((character) => !character.archived && Boolean(matchedCharacterReference(currentSearchable, character))).map((character) => {
    for (const previous of previousOutlines) {
      const matchedReference = matchedCharacterReference(`${outlineDisplayTitle(previous)}\n${previous.plan}`, character);
      if (matchedReference) {
        return {
          characterId: character.id,
          name: character.name,
          aliases: [...character.aliases],
          firstAppearance: false,
          previousMatch: { outlineId: previous.id, outlineTitle: outlineDisplayTitle(previous), matchedReference },
        };
      }
    }
    return { characterId: character.id, name: character.name, aliases: [...character.aliases], firstAppearance: true };
  });
}

export function selectAiContext(data: AiContextData, outlineId: string, kind: AiContextKind, options: AiContextOptions = {}): SelectedAiContext {
  const article = data.articles.find((candidate) => candidate.chapters.some((chapter) => chapter.outlines.some((outline) => outline.id === outlineId)));
  if (!article) throw new AiContextSelectionError("大纲不存在", "not_found");
  const chapter = article.chapters.find((candidate) => candidate.outlines.some((outline) => outline.id === outlineId));
  const outline = chapter?.outlines.find((candidate) => candidate.id === outlineId);
  if (!chapter || !outline) throw new AiContextSelectionError("大纲不存在", "not_found");
  if (chapter.archived) throw new AiContextSelectionError("归档章节不能用于 AI", "archived");
  if (outline.archived) throw new AiContextSelectionError("归档大纲不能用于 AI", "archived");

  const visibleOutlines = article.chapters
    .filter((candidate) => !candidate.archived)
    .flatMap((candidate) => candidate.outlines.filter((item) => !item.archived));
  const currentIndex = visibleOutlines.findIndex((candidate) => candidate.id === outline.id);
  if (currentIndex < 0) throw new AiContextSelectionError("大纲不可用于 AI", "archived");
  const previous = options.includePrevious === false ? [] : visibleOutlines.slice(0, currentIndex);
  const previousOutline = options.includePrevious === false || currentIndex === 0 ? undefined : visibleOutlines[currentIndex - 1];
  const contentMode = normalizeContentGenerationMode(options.contentMode);
  const includeCurrentContent = kind === "chat" || (kind === "content" && contentMode !== "fresh");
  const currentContent = includeCurrentContent ? resolvedOutlineContent(outline) : "";
  const currentPlan = options.currentPlan ?? outline.plan;
  const searchable = `${outlineDisplayTitle({ ...outline, plan: currentPlan })}\n${currentPlan}\n${currentContent}\n${String(options.instruction ?? "")}`;
  const explicitFirstAppearanceIds = Array.isArray(options.firstAppearanceCharacterIds) ? options.firstAppearanceCharacterIds : null;
  const firstAppearanceIds = new Set(explicitFirstAppearanceIds
    ? explicitFirstAppearanceIds.filter((id): id is string => typeof id === "string")
    : kind === "content"
      ? detectFirstAppearanceCharacters(data, outlineId, { instruction: options.instruction, currentPlan }).filter((item) => item.firstAppearance).map((item) => item.characterId)
      : []);
  const matchedCharacters = kind === "chapter-title" || options.includeCharacters === false ? [] : article.characters.filter((person) => !person.archived && (firstAppearanceIds.has(person.id) || Boolean(matchedCharacterReference(searchable, person))));
  const characterIds = new Set(matchedCharacters.map((person) => person.id));
  const characterNames = new Map(matchedCharacters.map((person) => [person.id, person.name]));
  const activeSession = outline.chat.sessions.find((session) => session.id === (options.sessionId || outline.chat.activeSessionId)) ?? outline.chat.sessions[0];
  const excellentFragments = kind === "content" ? selectExcellentFragments(article, chapter, outline, options) : [];

  return {
    kind,
    article: { id: article.id, title: article.title, summary: article.summary, type: article.type, style: article.style, outlineNaming: normalizeNamingProfile(article.outlineNaming, DEFAULT_OUTLINE_NAMING_PROFILE) },
    currentChapter: { id: chapter.id, title: chapter.title },
    currentOutline: {
      id: outline.id,
      title: outlineDisplayTitle(outline),
      titleGenerationPending: outline.titleGenerationPending === true,
      plan: outline.plan,
      content: kind === "chat" || kind === "content" ? currentContent : "",
    },
    previousOutlines: kind === "chapter-title" ? [] : previous.map((item) => ({ id: item.id, title: outlineDisplayTitle(item), plan: item.plan })),
    previousContentTail: kind === "content" && previousOutline ? resolvedOutlineContent(previousOutline).slice(-3000) : "",
    chapterOutlines: kind === "chapter-title" ? chapter.outlines.filter((item) => !item.archived).map((item) => ({ id: item.id, title: outlineDisplayTitle(item), plan: item.plan })) : [],
    characters: matchedCharacters.map((person) => ({
      id: person.id, name: person.name, aliases: [...person.aliases], description: person.description,
      appearanceStatus: kind === "content" ? firstAppearanceIds.has(person.id) ? "first" : "established" : undefined,
    })),
    relationships: article.relationships
      .filter((relationship) => characterIds.has(relationship.characterAId) && characterIds.has(relationship.characterBId))
      .map((relationship) => ({ characterA: characterNames.get(relationship.characterAId) ?? "", characterB: characterNames.get(relationship.characterBId) ?? "", description: relationship.description })),
    recentMessages: kind === "chat" ? (activeSession?.messages.slice(-20).map((message) => ({ role: message.role, text: message.text })) ?? []) : [],
    excellentFragments,
  };
}

export function summarizeAiContext(context: SelectedAiContext, instruction: string): AiContextSummary {
  const counts = {
    article: context.article.title.length + context.article.summary.length + context.article.type.length + context.article.style.length,
    chapter: context.currentChapter.title.length,
    chapterOutlines: context.chapterOutlines.reduce((total, item) => total + item.plan.length, 0),
    outline: context.kind === "chapter-title"
      ? context.chapterOutlines.reduce((total, item) => total + item.plan.length, 0)
      : context.currentOutline.plan.length,
    content: Math.min(context.currentOutline.content.length, 30000),
    previous: context.previousOutlines.reduce((total, item) => total + item.plan.length, 0),
    characters: context.characters.reduce((total, person) => total + person.name.length + person.aliases.join("").length + person.description.length, 0)
      + context.relationships.reduce((total, relationship) => total + relationship.characterA.length + relationship.characterB.length + relationship.description.length, 0),
    previousContent: context.previousContentTail.length,
    excellentFragments: context.excellentFragments.reduce((total, fragment) => total + fragment.text.length, 0),
    excellentFragmentCount: context.excellentFragments.length,
    instruction: instruction.length,
  };
  const history = context.recentMessages.reduce((total, message) => total + message.text.length, 0);
  return {
    ...counts,
    total: Math.min(60000, Object.values(counts).reduce((total, value) => total + value, 0) + history + 256),
    previousCount: context.kind === "chapter-title" ? context.chapterOutlines.length : context.previousOutlines.length,
    chapterOutlineCount: context.chapterOutlines.length,
    characterCount: context.characters.length,
  };
}
