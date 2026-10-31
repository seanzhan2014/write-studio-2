import type { Article, Character } from "../lib/studio-types.ts";
import { normalizeArticleStorySettings, normalizeCharacterProfile } from "../lib/story-settings.ts";
import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile } from "../lib/naming-options.ts";
import { normalizeAiGenerateOptions } from "../lib/generate-options.ts";
import { normalizeIllustrationOptions } from "../lib/illustration-options.ts";
import { normalizeCharacterVisual } from "../lib/character-visual.ts";
import { normalizeCharacterPhotos } from "../lib/character-photos.ts";

export function serializeArticleSettings(article: Pick<Article, "storySettings" | "chapterNaming" | "outlineNaming" | "aiGenerateSettings" | "illustrationSettings">) {
  return [
    JSON.stringify(normalizeArticleStorySettings(article.storySettings)),
    JSON.stringify(normalizeNamingProfile(article.chapterNaming, DEFAULT_CHAPTER_NAMING_PROFILE)),
    JSON.stringify(normalizeNamingProfile(article.outlineNaming, DEFAULT_OUTLINE_NAMING_PROFILE)),
    JSON.stringify(normalizeAiGenerateOptions(article.aiGenerateSettings)),
    JSON.stringify(normalizeIllustrationOptions(article.illustrationSettings)),
  ];
}

export function serializeCharacterSettings(character: Character) {
  return [
    JSON.stringify(normalizeCharacterProfile(character.profile)),
    JSON.stringify(normalizeCharacterVisual(character.visual) ?? null),
    JSON.stringify(normalizeCharacterPhotos(character.photos) ?? null),
  ];
}
