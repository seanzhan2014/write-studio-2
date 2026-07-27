import { resolvedOutlineContent } from "./outline-content";
import { outlineDisplayTitle } from "./outline-title";

export type AiContextKind = "chat" | "content" | "outline" | "chapter-title";

type ContextMessage = { role: "user" | "assistant"; text: string };
type ContextSession = { id: string; messages: ContextMessage[] };
type ContextOutline = {
  id: string;
  title: string;
  titleGenerationPending?: boolean;
  plan: string;
  content: string;
  sourceVersionId?: string;
  versions: Array<{ id: string; content: string }>;
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
  chapters: ContextChapter[];
  characters: ContextCharacter[];
  relationships: ContextRelationship[];
};

export type AiContextData = { articles: ContextArticle[] };

export type SelectedAiContext = {
  kind: AiContextKind;
  article: { id: string; title: string; summary: string; type: string; style: string };
  currentChapter: { id: string; title: string };
  currentOutline: { id: string; title: string; titleGenerationPending: boolean; plan: string; content: string };
  previousOutlines: Array<{ id: string; title: string; plan: string }>;
  previousContentTail: string;
  chapterOutlines: Array<{ id: string; title: string; plan: string }>;
  characters: Array<{ id: string; name: string; aliases: string[]; description: string }>;
  relationships: Array<{ characterA: string; characterB: string; description: string }>;
  recentMessages: ContextMessage[];
};

export type AiContextSummary = {
  total: number;
  article: number;
  chapter: number;
  outline: number;
  content: number;
  previous: number;
  previousCount: number;
  characters: number;
  characterCount: number;
  previousContent: number;
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

export function selectAiContext(data: AiContextData, outlineId: string, kind: AiContextKind, options: { includePrevious?: boolean; includeCharacters?: boolean; sessionId?: string } = {}): SelectedAiContext {
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
  const currentContent = resolvedOutlineContent(outline);
  const searchable = `${outlineDisplayTitle(outline)}\n${outline.plan}\n${currentContent}`;
  const matchedCharacters = kind === "chapter-title" || options.includeCharacters === false ? [] : article.characters.filter((person) => !person.archived && [person.name, ...person.aliases].some((name) => matchesCharacterReference(searchable, name)));
  const characterIds = new Set(matchedCharacters.map((person) => person.id));
  const characterNames = new Map(matchedCharacters.map((person) => [person.id, person.name]));
  const activeSession = outline.chat.sessions.find((session) => session.id === (options.sessionId || outline.chat.activeSessionId)) ?? outline.chat.sessions[0];

  return {
    kind,
    article: { id: article.id, title: article.title, summary: article.summary, type: article.type, style: article.style },
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
    characters: matchedCharacters.map((person) => ({ id: person.id, name: person.name, aliases: [...person.aliases], description: person.description })),
    relationships: article.relationships
      .filter((relationship) => characterIds.has(relationship.characterAId) && characterIds.has(relationship.characterBId))
      .map((relationship) => ({ characterA: characterNames.get(relationship.characterAId) ?? "", characterB: characterNames.get(relationship.characterBId) ?? "", description: relationship.description })),
    recentMessages: kind === "chat" ? (activeSession?.messages.slice(-20).map((message) => ({ role: message.role, text: message.text })) ?? []) : [],
  };
}

export function summarizeAiContext(context: SelectedAiContext, instruction: string): AiContextSummary {
  const counts = {
    article: context.article.title.length + context.article.summary.length + context.article.type.length + context.article.style.length,
    chapter: context.currentChapter.title.length,
    outline: context.kind === "chapter-title"
      ? context.chapterOutlines.reduce((total, item) => total + item.title.length + item.plan.length, 0)
      : context.currentOutline.title.length + context.currentOutline.plan.length,
    content: Math.min(context.currentOutline.content.length, 30000),
    previous: context.previousOutlines.reduce((total, item) => total + item.title.length + item.plan.length, 0),
    characters: context.characters.reduce((total, person) => total + person.name.length + person.aliases.join("").length + person.description.length, 0)
      + context.relationships.reduce((total, relationship) => total + relationship.characterA.length + relationship.characterB.length + relationship.description.length, 0),
    previousContent: context.previousContentTail.length,
    instruction: instruction.length,
  };
  const history = context.recentMessages.reduce((total, message) => total + message.text.length, 0);
  return {
    ...counts,
    total: Math.min(60000, Object.values(counts).reduce((total, value) => total + value, 0) + history + 256),
    previousCount: context.kind === "chapter-title" ? context.chapterOutlines.length : context.previousOutlines.length,
    characterCount: context.characters.length,
  };
}
