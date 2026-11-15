import { STYLE_FIELDS, normalizeAdvanced, type StyleAdvanced } from "./advanced-writing.ts";
import { normalizeStyleLibrary, type StyleLibrary } from "./style-learning.ts";
import { normalizeAiGenerateOptions, type AiGenerateOptions } from "./generate-options.ts";
import { normalizeIllustrationOptions, type IllustrationOptions } from "./illustration-options.ts";
import { normalizeLegacySettings, resolveLegacyContext, type LegacySettings } from "./legacy-story-settings.ts";

export const STORY_FIELD_KEYS = ["summary", "location", "style", "negativeConstraints"] as const;
export type StoryFieldKey = typeof STORY_FIELD_KEYS[number];

export const CHARACTER_PROFILE_KEYS = ["age", "appearance", "immutableTraits"] as const;
export type CharacterProfileKey = typeof CHARACTER_PROFILE_KEYS[number];

export type ArticleStorySettings = {
  location: string;
  negativeConstraints: string;
  advancedStyle?: StyleAdvanced;
  styleLibrary?: StyleLibrary;
};

export type CharacterProfile = {
  age: string;
  appearance: string;
  immutableTraits: string;
};

export type OverrideScope = "ongoing" | "chapter";
export type TextSettingOverride = { value: string; scope: OverrideScope };
export type BooleanSettingOverride = { value: boolean; scope: OverrideScope };

export type ChapterCharacterSettings = {
  start: Partial<Record<CharacterProfileKey, TextSettingOverride>>;
  end: Partial<Record<CharacterProfileKey, string>>;
  appears?: BooleanSettingOverride;
};

export type ChapterRelationshipSettings = {
  start?: TextSettingOverride;
  end?: string;
  active?: BooleanSettingOverride;
};

export type ChapterSettings = {
  legacy?: LegacySettings;
  aiTasks?: { generate?: AiGenerateOptions; illustration?: IllustrationOptions };
  story: Partial<Record<StoryFieldKey, TextSettingOverride>>;
  characters: Record<string, ChapterCharacterSettings>;
  relationships: Record<string, ChapterRelationshipSettings>;
};

export type OutlineSettings = ChapterSettings;

export const EMPTY_ARTICLE_STORY_SETTINGS: ArticleStorySettings = {
  location: "",
  negativeConstraints: "",
};

export const EMPTY_CHARACTER_PROFILE: CharacterProfile = {
  age: "",
  appearance: "",
  immutableTraits: "",
};

export const EMPTY_CHAPTER_SETTINGS: ChapterSettings = { story: {}, characters: {}, relationships: {} };

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {}; }
function text(value: unknown, maximum = 20_000) { return String(value ?? "").slice(0, maximum); }
function scope(value: unknown): OverrideScope { return value === "chapter" ? "chapter" : "ongoing"; }

function appendMissingDetails(baseValue: unknown, details: Array<[string, unknown]>, maximum: number) {
  const base = text(baseValue, maximum);
  const additions = details
    .map(([label, value]) => [label, String(value ?? "").trim()] as const)
    .map(([label, value]) => value ? `${label}：${value}` : "")
    .filter((detail) => detail && !base.includes(detail));
  return text([base, ...additions].filter((value) => value.trim()).join("\n"), maximum);
}

function normalizeTextOverride(value: unknown): TextSettingOverride | undefined {
  const item = record(value);
  if (!("value" in item)) return undefined;
  return { value: text(item.value), scope: scope(item.scope) };
}

function normalizeBooleanOverride(value: unknown): BooleanSettingOverride | undefined {
  const item = record(value);
  if (!("value" in item)) return undefined;
  return { value: item.value === true, scope: scope(item.scope) };
}

export function normalizeArticleStorySettings(value: unknown): ArticleStorySettings {
  const item = record(value);
  return {
    location: text(item.location, 10_000),
    negativeConstraints: text(item.negativeConstraints, 30_000),
    ...(item.advancedStyle ? { advancedStyle: normalizeAdvanced(item.advancedStyle, STYLE_FIELDS) } : {}),
    ...(item.styleLibrary ? { styleLibrary: normalizeStyleLibrary(item.styleLibrary) } : {}),
  };
}

export function normalizeCharacterProfile(value: unknown): CharacterProfile {
  const item = record(value);
  return Object.fromEntries(CHARACTER_PROFILE_KEYS.map((key) => [key, text(item[key], key === "immutableTraits" ? 20_000 : 10_000)])) as CharacterProfile;
}

export function migrateArticleStoryDetails(summaryValue: unknown, typeValue: unknown, settingsValue: unknown) {
  const rawSettings = record(settingsValue);
  return {
    summary: appendMissingDetails(summaryValue, [
      ["类型", typeValue],
      ["时代背景", rawSettings.era],
      ["世界规则", rawSettings.worldRules],
      ["语调", rawSettings.tone],
    ], 10_000),
    type: "",
    storySettings: normalizeArticleStorySettings(rawSettings),
  };
}

export function migrateCharacterDetails(descriptionValue: unknown, profileValue: unknown) {
  const rawProfile = record(profileValue);
  const immutableTraits = [...new Set([
    String(rawProfile.boundaries ?? "").trim(),
    String(rawProfile.immutableTraits ?? "").trim(),
  ].filter(Boolean))].join("\n");
  return {
    description: appendMissingDetails(descriptionValue, [
      ["身份", rawProfile.identity],
      ["性格", rawProfile.personality],
      ["说话方式", rawProfile.speechStyle],
      ["能力", rawProfile.abilities],
      ["当前心理状态", rawProfile.mentalState],
      ["当前已知信息", rawProfile.knownInformation],
    ], 20_000),
    profile: normalizeCharacterProfile({
      age: rawProfile.age,
      appearance: rawProfile.appearance,
      immutableTraits,
    }),
  };
}

export function normalizeChapterSettings(value: unknown): ChapterSettings {
  const item = record(value);
  const storyValue = record(item.story);
  const story: ChapterSettings["story"] = {};
  for (const key of STORY_FIELD_KEYS) {
    const override = normalizeTextOverride(storyValue[key]);
    if (override) story[key] = override;
  }

  const characters: ChapterSettings["characters"] = {};
  for (const [characterId, raw] of Object.entries(record(item.characters)).slice(0, 1_000)) {
    const value = record(raw);
    const startValue = record(value.start);
    const endValue = record(value.end);
    const start: ChapterCharacterSettings["start"] = {};
    const end: ChapterCharacterSettings["end"] = {};
    for (const key of CHARACTER_PROFILE_KEYS) {
      const override = normalizeTextOverride(startValue[key]);
      if (override) start[key] = override;
      if (Object.prototype.hasOwnProperty.call(endValue, key)) {
        const ending = text(endValue[key]);
        if (ending.trim()) end[key] = ending;
      }
    }
    const appears = normalizeBooleanOverride(value.appears);
    if (Object.keys(start).length || Object.keys(end).length || appears) characters[characterId] = { start, end, ...(appears ? { appears } : {}) };
  }

  const relationships: ChapterSettings["relationships"] = {};
  for (const [relationshipId, raw] of Object.entries(record(item.relationships)).slice(0, 2_000)) {
    const value = record(raw);
    const start = normalizeTextOverride(value.start);
    const active = normalizeBooleanOverride(value.active);
    const end = text(value.end);
    const hasEnd = Object.prototype.hasOwnProperty.call(value, "end") && Boolean(end.trim());
    if (start || active || hasEnd) relationships[relationshipId] = {
      ...(start ? { start } : {}),
      ...(active ? { active } : {}),
      ...(hasEnd ? { end } : {}),
    };
  }
  const tasks = record(item.aiTasks);
  const aiTasks = {
    ...(tasks.generate && typeof tasks.generate === "object" ? { generate: normalizeAiGenerateOptions(tasks.generate) } : {}),
    ...(tasks.illustration && typeof tasks.illustration === "object" ? { illustration: normalizeIllustrationOptions(tasks.illustration) } : {}),
  };
  const legacy = normalizeLegacySettings(item);
  return { story, characters, relationships, ...(legacy ? { legacy } : {}), ...(Object.keys(aiTasks).length ? { aiTasks } : {}) };
}

export type StorySettingsArticle = {
  summary: string;
  style: string;
  storySettings?: ArticleStorySettings;
  chapters: Array<{ id: string; title: string; archived: boolean; settings?: ChapterSettings; outlines?: Array<{ id: string; title: string; archived: boolean; settings?: OutlineSettings }> }>;
  characters: Array<{ id: string; name: string; aliases: string[]; description: string; archived: boolean; profile?: CharacterProfile }>;
  relationships: Array<{ id?: string; characterAId: string; characterBId: string; description: string }>;
};

export type SettingSource = { kind: "article" } | { kind: "chapter"; chapterId: string; chapterTitle: string } | { kind: "outline"; outlineId: string; outlineTitle: string };
export type ResolvedChapterSettings = {
  chapterId: string;
  inheritedFromChapter?: { id: string; title: string };
  story: Record<StoryFieldKey, string>;
  storySources: Record<StoryFieldKey, SettingSource>;
  characters: Array<{
    id: string;
    name: string;
    aliases: string[];
    description: string;
    archived: boolean;
    appears?: boolean;
    profile: CharacterProfile;
    profileSources: Record<CharacterProfileKey, SettingSource>;
    endingChanges: Partial<CharacterProfile> & { description?: string };
  }>;
  relationships: Array<{
    id: string;
    characterAId: string;
    characterBId: string;
    description: string;
    active: boolean;
    source: SettingSource;
    endingDescription?: string;
  }>;
};

export type ResolvedOutlineSettings = ResolvedChapterSettings & {
  outlineId: string;
  inheritedFromOutline?: { id: string; title: string };
};

function articleSource(): SettingSource { return { kind: "article" }; }
function chapterSource(chapter: { id: string; title: string }): SettingSource { return { kind: "chapter", chapterId: chapter.id, chapterTitle: chapter.title }; }
function outlineSource(outline: { id: string; title: string }): SettingSource { return { kind: "outline", outlineId: outline.id, outlineTitle: outline.title }; }

export function resolveChapterSettings(article: StorySettingsArticle, chapterId: string, includeLegacy = true): ResolvedChapterSettings {
  const base = normalizeArticleStorySettings(article.storySettings);
  const story = { summary: text(article.summary, 10_000), location: base.location, style: text(article.style), negativeConstraints: base.negativeConstraints };
  const storySources = Object.fromEntries(STORY_FIELD_KEYS.map((key) => [key, articleSource()])) as Record<StoryFieldKey, SettingSource>;
  const profiles = new Map(article.characters.map((character) => [character.id, normalizeCharacterProfile(character.profile)]));
  const profileSources = new Map(article.characters.map((character) => [character.id, Object.fromEntries(CHARACTER_PROFILE_KEYS.map((key) => [key, articleSource()])) as Record<CharacterProfileKey, SettingSource>]));
  const appearances = new Map<string, boolean | undefined>();
  const relationshipId = (relationship: StorySettingsArticle["relationships"][number]) => relationship.id || [relationship.characterAId, relationship.characterBId].sort().join(":");
  const relationshipDescriptions = new Map(article.relationships.map((relationship) => [relationshipId(relationship), relationship.description]));
  const relationshipActive = new Map(article.relationships.map((relationship) => [relationshipId(relationship), true]));
  const relationshipSources = new Map(article.relationships.map((relationship) => [relationshipId(relationship), articleSource() as SettingSource]));
  const activeChapters = article.chapters.filter((chapter) => !chapter.archived);
  const activeTargetIndex = activeChapters.findIndex((chapter) => chapter.id === chapterId);
  const requestedTargetIndex = article.chapters.findIndex((chapter) => chapter.id === chapterId);
  const target = activeTargetIndex >= 0
    ? activeChapters[activeTargetIndex]
    : article.chapters[requestedTargetIndex] ?? activeChapters[0] ?? article.chapters[0] ?? { id: chapterId, title: "", archived: false };
  const preceding = activeTargetIndex >= 0
    ? activeChapters.slice(0, activeTargetIndex)
    : requestedTargetIndex >= 0
      ? article.chapters.slice(0, requestedTargetIndex).filter((chapter) => !chapter.archived)
      : [];

  for (const chapter of preceding) {
    const settings = normalizeChapterSettings(chapter.settings);
    const source = chapterSource(chapter);
    for (const key of STORY_FIELD_KEYS) {
      const override = settings.story[key];
      if (override?.scope === "ongoing") { story[key] = override.value; storySources[key] = source; }
    }
    for (const [characterId, characterSettings] of Object.entries(settings.characters)) {
      const profile = profiles.get(characterId);
      const sources = profileSources.get(characterId);
      if (!profile || !sources) continue;
      for (const key of CHARACTER_PROFILE_KEYS) {
        const start = characterSettings.start[key];
        if (start?.scope === "ongoing") { profile[key] = start.value; sources[key] = source; }
        if (Object.prototype.hasOwnProperty.call(characterSettings.end, key)) { profile[key] = characterSettings.end[key] ?? ""; sources[key] = source; }
      }
      if (characterSettings.appears?.scope === "ongoing") appearances.set(characterId, characterSettings.appears.value);
    }
    for (const [relationshipId, relationshipSettings] of Object.entries(settings.relationships)) {
      if (relationshipSettings.start?.scope === "ongoing") { relationshipDescriptions.set(relationshipId, relationshipSettings.start.value); relationshipSources.set(relationshipId, source); }
      if (Object.prototype.hasOwnProperty.call(relationshipSettings, "end")) { relationshipDescriptions.set(relationshipId, relationshipSettings.end ?? ""); relationshipSources.set(relationshipId, source); }
      if (relationshipSettings.active?.scope === "ongoing") relationshipActive.set(relationshipId, relationshipSettings.active.value);
    }
  }

  const current = normalizeChapterSettings(target.settings);
  const currentSource = chapterSource(target);
  for (const key of STORY_FIELD_KEYS) {
    const override = current.story[key];
    if (override) { story[key] = override.value; storySources[key] = currentSource; }
  }
  for (const [characterId, characterSettings] of Object.entries(current.characters)) {
    const profile = profiles.get(characterId);
    const sources = profileSources.get(characterId);
    if (!profile || !sources) continue;
    for (const key of CHARACTER_PROFILE_KEYS) {
      const override = characterSettings.start[key];
      if (override) { profile[key] = override.value; sources[key] = currentSource; }
    }
    if (characterSettings.appears) appearances.set(characterId, characterSettings.appears.value);
  }
  for (const [relationshipId, relationshipSettings] of Object.entries(current.relationships)) {
    if (relationshipSettings.start) { relationshipDescriptions.set(relationshipId, relationshipSettings.start.value); relationshipSources.set(relationshipId, currentSource); }
    if (relationshipSettings.active) relationshipActive.set(relationshipId, relationshipSettings.active.value);
  }

  const resolved: ResolvedChapterSettings = {
    chapterId: target.id,
    inheritedFromChapter: preceding.at(-1) ? { id: preceding.at(-1)!.id, title: preceding.at(-1)!.title } : undefined,
    story,
    storySources,
    characters: article.characters.map((character) => ({
      id: character.id,
      name: character.name,
      aliases: [...character.aliases],
      description: character.description,
      archived: character.archived,
      appears: appearances.get(character.id),
      profile: profiles.get(character.id) ?? { ...EMPTY_CHARACTER_PROFILE },
      profileSources: profileSources.get(character.id) ?? Object.fromEntries(CHARACTER_PROFILE_KEYS.map((key) => [key, articleSource()])) as Record<CharacterProfileKey, SettingSource>,
      endingChanges: current.characters[character.id]?.end ?? {},
    })),
    relationships: article.relationships.map((relationship) => ({
      id: relationshipId(relationship),
      characterAId: relationship.characterAId,
      characterBId: relationship.characterBId,
      description: relationshipDescriptions.get(relationshipId(relationship)) ?? relationship.description,
      active: relationshipActive.get(relationshipId(relationship)) !== false,
      source: relationshipSources.get(relationshipId(relationship)) ?? articleSource(),
      endingDescription: current.relationships[relationshipId(relationship)]?.end,
    })),
  };
  return includeLegacy ? withLegacyContext(article, resolved) : resolved;
}

function withLegacyContext<T extends ResolvedChapterSettings>(article: StorySettingsArticle, resolved: T): T {
  const legacy = resolveLegacyContext(article.chapters, resolved.chapterId, "outlineId" in resolved ? String(resolved.outlineId) : undefined);
  const append = (...parts: (string | undefined)[]) => parts.filter(part => part?.trim()).join("\n");
  return { ...resolved,
    story: { ...resolved.story, summary: append(resolved.story.summary, legacy.summary), style: append(resolved.story.style, legacy.tone ? `语调：${legacy.tone}` : "") },
    characters: resolved.characters.map(person => ({ ...person, description: append(person.description, legacy.descriptions.get(person.id)), endingChanges: { ...person.endingChanges, ...(legacy.endings.has(person.id) ? { description: legacy.endings.get(person.id) } : {}) } })),
  };
}

export function resolveOutlineSettings(article: StorySettingsArticle, outlineId: string): ResolvedOutlineSettings {
  const chapter = article.chapters.find((item) => item.outlines?.some((outline) => outline.id === outlineId));
  const outline = chapter?.outlines?.find((item) => item.id === outlineId);
  if (!chapter || !outline) {
    const fallback = resolveChapterSettings(article, chapter?.id ?? article.chapters[0]?.id ?? "");
    return { ...fallback, outlineId };
  }

  const chapterResolved = resolveChapterSettings(article, chapter.id, false);
  const story = { ...chapterResolved.story };
  const storySources = { ...chapterResolved.storySources };
  const profiles = new Map(chapterResolved.characters.map((character) => [character.id, { ...character.profile }]));
  const profileSources = new Map(chapterResolved.characters.map((character) => [character.id, { ...character.profileSources }]));
  const appearances = new Map(chapterResolved.characters.map((character) => [character.id, character.appears]));
  const relationshipDescriptions = new Map(chapterResolved.relationships.map((relationship) => [relationship.id, relationship.description]));
  const relationshipActive = new Map(chapterResolved.relationships.map((relationship) => [relationship.id, relationship.active]));
  const relationshipSources = new Map(chapterResolved.relationships.map((relationship) => [relationship.id, relationship.source]));
  const activeOutlines = (chapter.outlines ?? []).filter((item) => !item.archived);
  const activeTargetIndex = activeOutlines.findIndex((item) => item.id === outlineId);
  const requestedTargetIndex = (chapter.outlines ?? []).findIndex((item) => item.id === outlineId);
  const target = activeTargetIndex >= 0 ? activeOutlines[activeTargetIndex] : outline;
  const preceding = activeTargetIndex >= 0
    ? activeOutlines.slice(0, activeTargetIndex)
    : requestedTargetIndex >= 0
      ? (chapter.outlines ?? []).slice(0, requestedTargetIndex).filter((item) => !item.archived)
      : [];

  for (const precedingOutline of preceding) {
    const settings = normalizeChapterSettings(precedingOutline.settings);
    const source = outlineSource(precedingOutline);
    for (const key of STORY_FIELD_KEYS) {
      const override = settings.story[key];
      if (override?.scope === "ongoing") { story[key] = override.value; storySources[key] = source; }
    }
    for (const [characterId, characterSettings] of Object.entries(settings.characters)) {
      const profile = profiles.get(characterId);
      const sources = profileSources.get(characterId);
      if (!profile || !sources) continue;
      for (const key of CHARACTER_PROFILE_KEYS) {
        const start = characterSettings.start[key];
        if (start?.scope === "ongoing") { profile[key] = start.value; sources[key] = source; }
        if (Object.prototype.hasOwnProperty.call(characterSettings.end, key)) { profile[key] = characterSettings.end[key] ?? ""; sources[key] = source; }
      }
      if (characterSettings.appears?.scope === "ongoing") appearances.set(characterId, characterSettings.appears.value);
    }
    for (const [relationshipId, relationshipSettings] of Object.entries(settings.relationships)) {
      if (relationshipSettings.start?.scope === "ongoing") { relationshipDescriptions.set(relationshipId, relationshipSettings.start.value); relationshipSources.set(relationshipId, source); }
      if (Object.prototype.hasOwnProperty.call(relationshipSettings, "end")) { relationshipDescriptions.set(relationshipId, relationshipSettings.end ?? ""); relationshipSources.set(relationshipId, source); }
      if (relationshipSettings.active?.scope === "ongoing") relationshipActive.set(relationshipId, relationshipSettings.active.value);
    }
  }

  const current = normalizeChapterSettings(target.settings);
  const currentSource = outlineSource(target);
  for (const key of STORY_FIELD_KEYS) {
    const override = current.story[key];
    if (override) { story[key] = override.value; storySources[key] = currentSource; }
  }
  for (const [characterId, characterSettings] of Object.entries(current.characters)) {
    const profile = profiles.get(characterId);
    const sources = profileSources.get(characterId);
    if (!profile || !sources) continue;
    for (const key of CHARACTER_PROFILE_KEYS) {
      const override = characterSettings.start[key];
      if (override) { profile[key] = override.value; sources[key] = currentSource; }
    }
    if (characterSettings.appears) appearances.set(characterId, characterSettings.appears.value);
  }
  for (const [relationshipId, relationshipSettings] of Object.entries(current.relationships)) {
    if (relationshipSettings.start) { relationshipDescriptions.set(relationshipId, relationshipSettings.start.value); relationshipSources.set(relationshipId, currentSource); }
    if (relationshipSettings.active) relationshipActive.set(relationshipId, relationshipSettings.active.value);
  }

  return withLegacyContext(article, {
    ...chapterResolved,
    outlineId: target.id,
    inheritedFromOutline: preceding.at(-1) ? { id: preceding.at(-1)!.id, title: preceding.at(-1)!.title } : undefined,
    story,
    storySources,
    characters: chapterResolved.characters.map((character) => ({
      ...character,
      appears: appearances.get(character.id),
      profile: profiles.get(character.id) ?? { ...EMPTY_CHARACTER_PROFILE },
      profileSources: profileSources.get(character.id) ?? { ...character.profileSources },
      endingChanges: { ...character.endingChanges, ...(current.characters[character.id]?.end ?? {}) },
    })),
    relationships: chapterResolved.relationships.map((relationship) => ({
      ...relationship,
      description: relationshipDescriptions.get(relationship.id) ?? relationship.description,
      active: relationshipActive.get(relationship.id) !== false,
      source: relationshipSources.get(relationship.id) ?? relationship.source,
      endingDescription: current.relationships[relationship.id]?.end ?? relationship.endingDescription,
    })),
  });
}

export function countChapterSettingChanges(value: unknown) {
  const settings = normalizeChapterSettings(value);
  let count = Object.keys(settings.story).length;
  for (const item of Object.values(settings.characters)) count += Object.keys(item.start).length + Object.keys(item.end).length + (item.appears ? 1 : 0);
  for (const item of Object.values(settings.relationships)) count += (item.start ? 1 : 0) + (Object.prototype.hasOwnProperty.call(item, "end") ? 1 : 0) + (item.active ? 1 : 0);
  if (settings.legacy) { count += Object.keys(settings.legacy.story).length; for (const person of Object.values(settings.legacy.characters)) count += Object.keys(person.start).length + Object.keys(person.end).length; }
  return count;
}

export const countOutlineSettingChanges = countChapterSettingChanges;
