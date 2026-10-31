import type { Message, ChatSession, Outline, Article } from "./studio-types.ts";

import { timestampContentName } from "./content-name.mjs";
import { normalizeExcellentFragments } from "./excellent-fragments.mjs";
import { currentOutlineVersion } from "./outline-content.ts";
import { normalizeOutlineTitle } from "./outline-title.ts";

import { EMPTY_CHAPTER_SETTINGS } from "./story-settings.ts";

export const now = "2026-07-28T14:32:00.000Z";

export function emptyChat(outlineId: string, messages: Message[] = []): Outline["chat"] {
  const createdAt = messages[0]?.createdAt ?? now;
  const updatedAt = messages.at(-1)?.createdAt ?? createdAt;
  const lastReadMessageId = messages.filter((message) => message.role === "assistant").at(-1)?.id ?? null;
  const session: ChatSession = {
    id: `chat:${outlineId}`,
    title: messages[0]?.text.slice(0, 24) || "新对话",
    messages,
    draft: "",
    includePrevious: true,
    includeCharacters: true,
    lastReadMessageId,
    createdAt,
    updatedAt,
  };
  return { sessions: [session], activeSessionId: session.id };
}

export function outline(id: string, title: string, plan: string, content: string, state: Outline["state"] = "saved"): Outline {
  return { id, title, titleGenerationPending: !normalizeOutlineTitle(title), plan, generateInstruction: "", generateOptions: null, settings: { ...EMPTY_CHAPTER_SETTINGS }, content, contentName: timestampContentName(now), currentVersionId: null, defaultVersionId: null, contentOutlineSnapshot: { title, plan }, state, archived: false, updatedAt: now, excellentFragments: [], versions: [], chat: emptyChat(id) };
}

export function makeId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${id}`;
}

export function findOutlineInArticle(article: Article, outlineId: string) {
  for (const chapter of article.chapters) {
    const found = chapter.outlines.find((item) => item.id === outlineId);
    if (found) return { chapter, outline: found };
  }
  return null;
}

export function firstOutline(article: Article) {
  return article.chapters.flatMap((chapter) => chapter.outlines).find((item) => !item.archived)?.id ?? article.chapters.flatMap((chapter) => chapter.outlines)[0]?.id ?? "";
}

export function activeExcellentFragments(outline: Outline) {
  const version = currentOutlineVersion(outline);
  return version
    ? normalizeExcellentFragments(version.content, version.excellentFragments)
    : normalizeExcellentFragments(outline.content, outline.excellentFragments);
}

export function activeManualExcellent(outline: Outline) {
  return currentOutlineVersion(outline)?.manualExcellent === true || (!outline.currentVersionId && outline.manualExcellent === true);
}
