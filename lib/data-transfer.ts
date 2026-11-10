import type { ModelMetadata } from "./ai-model-capabilities";
import type { ReasoningEffort } from "@/lib/reasoning-options";
import type { AiTask, Article, Outline, StudioData, StudioSettings } from "@/lib/studio-types";
import type { NameVersion } from "@/lib/name-versions";
import type { StyleLabSnapshot } from "@/db/style-lab-history";

import { articleReviewRules } from "./review-rules.mjs";
import { EMPTY_ARTICLE_STORY_SETTINGS, normalizeChapterSettings, type ChapterSettings, type ResolvedChapterSettings, type ResolvedOutlineSettings, type SettingSource } from "./story-settings.ts";

export const TRANSFER_KIND = "writer-studio-transfer" as const;
export const TRANSFER_VERSION = 2 as const;

export type TransferScope = "outline" | "article" | "articles" | "system-config" | "complete";

export type PortableAiProvider = {
  id: string;
  name: string;
  adapterKind: "openai-compatible" | "openrouter" | "spicyapi" | "civitai";
  baseUrl: string;
  timeoutMs: number;
  hadApiKey: boolean;
};

export type PortableAiModel = {
  metadata?: ModelMetadata;
  id: string;
  providerId: string;
  name: string;
  modelId: string;
  systemPrompt: string;
  reasoningEffort?: ReasoningEffort | null;
  temperature: number | null;
  maxOutput: number | null;
  maxInputCharacters: number;
  timeoutOverrideMs: number | null;
};

export type OutlineTransferData = { outline: Outline };
export type ArticleTransferData = { article: Article; tasks: AiTask[] };
export type ArticlesTransferData = { articles: Article[]; tasks: AiTask[] };
export type SystemConfigTransferData = { settings: StudioSettings; providers: PortableAiProvider[]; models: PortableAiModel[] };
export type CompleteTransferData = { studio: StudioData; providers: PortableAiProvider[]; models: PortableAiModel[]; styleLab?: StyleLabSnapshot };

export type TransferDataByScope = {
  outline: OutlineTransferData;
  article: ArticleTransferData;
  articles: ArticlesTransferData;
  "system-config": SystemConfigTransferData;
  complete: CompleteTransferData;
};

export type TransferEnvelope<S extends TransferScope = TransferScope> = {
  kind: typeof TRANSFER_KIND;
  formatVersion: typeof TRANSFER_VERSION;
  scope: S;
  exportedAt: string;
  data: TransferDataByScope[S];
};

export type ArticleCopyVersionMode = "default" | "all";

export type ArticleCopyOptions = {
  title: string;
  includeStructure: boolean;
  includeContent: boolean;
  contentVersions: ArticleCopyVersionMode;
  nameVersions: ArticleCopyVersionMode;
  includeCharacters: boolean;
  includeStyle: boolean;
  includeMetadata: boolean;
  includeChat: boolean;
};

export const DEFAULT_ARTICLE_COPY_OPTIONS: ArticleCopyOptions = {
  title: "",
  includeStructure: true,
  includeContent: true,
  contentVersions: "default",
  nameVersions: "default",
  includeCharacters: true,
  includeStyle: true,
  includeMetadata: false,
  includeChat: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`${label}格式不正确`);
  return value;
}

function requireArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value;
}

function requireArticle(value: unknown, label = "文章") {
  const article = requireRecord(value, label);
  if (typeof article.id !== "string" || typeof article.title !== "string") throw new Error(`${label}缺少必要信息`);
  requireArray(article.chapters, `${label}章节`);
}

function requireOutline(value: unknown) {
  const outline = requireRecord(value, "大纲");
  if (typeof outline.id !== "string" || typeof outline.plan !== "string") throw new Error("大纲缺少必要信息");
  requireArray(outline.versions, "大纲版本");
  const chat = requireRecord(outline.chat, "大纲聊天");
  requireArray(chat.sessions, "大纲聊天会话");
}

function requireSettings(value: unknown) {
  const settings = requireRecord(value, "系统配置");
  if (typeof settings.theme !== "string" || typeof settings.taskConcurrency !== "number") throw new Error("系统配置缺少必要信息");
}

export function createTransferEnvelope<S extends TransferScope>(scope: S, data: TransferDataByScope[S]): TransferEnvelope<S> {
  return { kind: TRANSFER_KIND, formatVersion: TRANSFER_VERSION, scope, exportedAt: new Date().toISOString(), data };
}

export function parseTransferEnvelope(value: unknown): TransferEnvelope {
  const envelope = requireRecord(value, "导入文件");
  if (envelope.kind !== TRANSFER_KIND) throw new Error("这不是 Writer Studio 导出文件");
  if (![1, TRANSFER_VERSION].includes(Number(envelope.formatVersion))) throw new Error("导出文件版本暂不支持");
  if (!["outline", "article", "articles", "system-config", "complete"].includes(String(envelope.scope))) throw new Error("导出文件类型不支持");
  const data = requireRecord(envelope.data, "导出数据");
  if (envelope.scope === "outline") requireOutline(data.outline);
  if (envelope.scope === "article") {
    requireArticle(data.article);
    requireArray(data.tasks, "文章任务");
  }
  if (envelope.scope === "articles") {
    requireArray(data.articles, "文章列表").forEach((article, index) => requireArticle(article, `第 ${index + 1} 篇文章`));
    requireArray(data.tasks, "文章任务");
  }
  if (envelope.scope === "system-config") {
    requireSettings(data.settings);
    requireArray(data.models, "AI 模型配置");
    if (envelope.formatVersion === TRANSFER_VERSION) requireArray(data.providers, "AI Provider 配置");
  }
  if (envelope.scope === "complete") {
    const studio = requireRecord(data.studio, "完整数据");
    requireArray(studio.articles, "文章列表").forEach((article, index) => requireArticle(article, `第 ${index + 1} 篇文章`));
    requireArray(data.models, "AI 模型配置");
    if (envelope.formatVersion === TRANSFER_VERSION) requireArray(data.providers, "AI Provider 配置");
  }
  if (envelope.formatVersion === 1 && (envelope.scope === "system-config" || envelope.scope === "complete")) {
    const legacyModels = data.models as Array<Record<string, unknown>>;
    const providers: PortableAiProvider[] = [];
    const providerByUrl = new Map<string, PortableAiProvider>();
    const models = legacyModels.map((model) => {
      const baseUrl = String(model.baseUrl ?? "").trim().replace(/\/$/, "");
      let provider = providerByUrl.get(baseUrl);
      if (!provider) {
        let name = "AI Provider";
        try { name = new URL(baseUrl).host || name; } catch { /* validated during import */ }
        provider = {
          id: `provider-${String(model.id ?? makeId("legacy"))}`,
          name,
          adapterKind: "openai-compatible",
          baseUrl,
          timeoutMs: Number(model.timeoutMs ?? 120000),
          hadApiKey: Boolean(model.hadApiKey),
        };
        providers.push(provider);
        providerByUrl.set(baseUrl, provider);
      } else if (model.hadApiKey) provider.hadApiKey = true;
      const timeoutMs = Number(model.timeoutMs ?? provider.timeoutMs);
      return {
        id: String(model.id ?? ""), providerId: provider.id, name: String(model.name ?? ""), modelId: String(model.modelId ?? ""),
        systemPrompt: String(model.systemPrompt ?? ""), temperature: model.temperature == null ? null : Number(model.temperature),
        maxOutput: model.maxOutput == null ? null : Number(model.maxOutput), maxInputCharacters: Number(model.maxInputCharacters),
        reasoningEffort: (model.reasoningEffort ?? null) as PortableAiModel["reasoningEffort"],
        timeoutOverrideMs: timeoutMs === provider.timeoutMs ? null : timeoutMs,
      } satisfies PortableAiModel;
    });
    return { ...envelope, formatVersion: TRANSFER_VERSION, data: { ...data, providers, models } } as unknown as TransferEnvelope;
  }
  return envelope as unknown as TransferEnvelope;
}

function makeId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${id}`;
}

type IdMaps = {
  articles: Map<string, string>;
  chapters: Map<string, string>;
  outlines: Map<string, string>;
  names: Map<string, string>;
  versions: Map<string, string>;
  fragments: Map<string, string>;
  characters: Map<string, string>;
  relationships: Map<string, string>;
  sessions: Map<string, string>;
  messages: Map<string, string>;
  tasks: Map<string, string>;
};

function maps(): IdMaps {
  return {
    articles: new Map(), chapters: new Map(), outlines: new Map(), names: new Map(), versions: new Map(), fragments: new Map(),
    characters: new Map(), relationships: new Map(), sessions: new Map(), messages: new Map(), tasks: new Map(),
  };
}

function register(map: Map<string, string>, id: unknown, prefix: string) {
  const source = String(id ?? "");
  if (source && !map.has(source)) map.set(source, makeId(prefix));
}

function registerOutline(source: Outline, ids: IdMaps) {
  register(ids.outlines, source.id, "outline");
  source.nameVersions?.forEach((version) => register(ids.names, version.id, "name"));
  source.excellentFragments?.forEach((fragment) => register(ids.fragments, fragment.id, "excellent"));
  source.versions?.forEach((version) => {
    register(ids.versions, version.id, "version");
    version.excellentFragments?.forEach((fragment) => register(ids.fragments, fragment.id, "excellent"));
  });
  source.chat?.sessions?.forEach((session) => {
    register(ids.sessions, session.id, "chat");
    session.messages?.forEach((message) => register(ids.messages, message.id, "message"));
  });
}

function registerArticles(articles: Article[], tasks: AiTask[]) {
  const ids = maps();
  articles.forEach((article) => {
    register(ids.articles, article.id, "article");
    article.characters?.forEach((character) => register(ids.characters, character.id, "character"));
    article.relationships?.forEach((relationship) => register(ids.relationships, relationship.id, "relationship"));
    article.chapters?.forEach((chapter) => {
      register(ids.chapters, chapter.id, "chapter");
      chapter.nameVersions?.forEach((version) => register(ids.names, version.id, "name"));
      chapter.outlines?.forEach((outline) => registerOutline(outline, ids));
    });
  });
  tasks.forEach((task) => register(ids.tasks, task.id, "task"));
  return ids;
}

function mapped(map: Map<string, string>, id: unknown) {
  return map.get(String(id ?? "")) ?? "";
}

function mappedRewriteSourceId(sourceId: string | undefined, ids: IdMaps) {
  if (!sourceId) return undefined;
  const versionId = mapped(ids.versions, sourceId);
  if (versionId) return versionId;
  if (sourceId.startsWith("content:")) {
    const outlineId = mapped(ids.outlines, sourceId.slice("content:".length));
    if (outlineId) return `content:${outlineId}`;
  }
  return sourceId;
}

function cloneFragments<T extends { id: string }>(items: T[] | undefined, ids: IdMaps): T[] {
  return (items ?? []).map((item) => ({ ...item, id: mapped(ids.fragments, item.id) || makeId("excellent") }));
}

function cloneNameState(source: { nameVersions?: NameVersion[]; defaultNameVersionId?: string | null }, ids: IdMaps) {
  return {
    nameVersions: (source.nameVersions ?? []).map((version) => ({ ...version, id: mapped(ids.names, version.id) || makeId("name") })),
    defaultNameVersionId: mapped(ids.names, source.defaultNameVersionId) || null,
  };
}

function cloneChapterSettings(value: unknown, ids: IdMaps): ChapterSettings {
  const source = normalizeChapterSettings(value);
  return {
    story: structuredClone(source.story),
    ...(source.aiTasks ? { aiTasks: { ...structuredClone(source.aiTasks), ...(source.aiTasks.generate ? { generate: { ...structuredClone(source.aiTasks.generate), firstAppearanceOverrides: Object.fromEntries(Object.entries(source.aiTasks.generate.firstAppearanceOverrides).map(([id, value]) => [mapped(ids.characters, id), value]).filter(([id]) => Boolean(id))) } } : {}) } } : {}),
    characters: Object.fromEntries(Object.entries(source.characters).map(([id, settings]) => [mapped(ids.characters, id), structuredClone(settings)]).filter(([id]) => Boolean(id))),
    relationships: Object.fromEntries(Object.entries(source.relationships).map(([id, settings]) => [mapped(ids.relationships, id), structuredClone(settings)]).filter(([id]) => Boolean(id))),
  };
}

function cloneSettingSource(value: SettingSource, ids: IdMaps): SettingSource {
  if (value.kind === "chapter") return { ...value, chapterId: mapped(ids.chapters, value.chapterId) || value.chapterId };
  if (value.kind === "outline") return { ...value, outlineId: mapped(ids.outlines, value.outlineId) || value.outlineId };
  return value;
}

function cloneSettingSnapshot(value: ResolvedChapterSettings | undefined, ids: IdMaps): ResolvedChapterSettings | undefined {
  if (!value) return undefined;
  const outlineValue = value as ResolvedChapterSettings & Partial<ResolvedOutlineSettings>;
  return {
    ...structuredClone(value),
    chapterId: mapped(ids.chapters, value.chapterId) || value.chapterId,
    inheritedFromChapter: value.inheritedFromChapter ? { ...value.inheritedFromChapter, id: mapped(ids.chapters, value.inheritedFromChapter.id) || value.inheritedFromChapter.id } : undefined,
    ...(outlineValue.outlineId ? { outlineId: mapped(ids.outlines, outlineValue.outlineId) || outlineValue.outlineId } : {}),
    ...(outlineValue.inheritedFromOutline ? { inheritedFromOutline: { ...outlineValue.inheritedFromOutline, id: mapped(ids.outlines, outlineValue.inheritedFromOutline.id) || outlineValue.inheritedFromOutline.id } } : {}),
    storySources: Object.fromEntries(Object.entries(value.storySources).map(([key, source]) => [key, cloneSettingSource(source, ids)])) as ResolvedChapterSettings["storySources"],
    characters: value.characters.map((item) => ({
      ...item,
      id: mapped(ids.characters, item.id) || item.id,
      profileSources: Object.fromEntries(Object.entries(item.profileSources).map(([key, source]) => [key, cloneSettingSource(source, ids)])) as typeof item.profileSources,
    })),
    relationships: value.relationships.map((item) => ({
      ...item,
      id: mapped(ids.relationships, item.id) || item.id,
      characterAId: mapped(ids.characters, item.characterAId) || item.characterAId,
      characterBId: mapped(ids.characters, item.characterBId) || item.characterBId,
      source: cloneSettingSource(item.source, ids),
    })),
  };
}

function cloneOutline(source: Outline, ids: IdMaps): Outline {
  const id = mapped(ids.outlines, source.id) || makeId("outline");
  const versions = (source.versions ?? []).map((version) => ({
    ...version,
    id: mapped(ids.versions, version.id) || makeId("version"),
    taskId: version.taskId ? mapped(ids.tasks, version.taskId) || undefined : undefined,
    rewriteSourceId: mappedRewriteSourceId(version.rewriteSourceId, ids),
    settingSnapshot: cloneSettingSnapshot(version.settingSnapshot, ids),
    excellentFragments: cloneFragments(version.excellentFragments, ids),
  }));
  const sessions = (source.chat?.sessions ?? []).map((session) => ({
    ...session,
    id: mapped(ids.sessions, session.id) || makeId("chat"),
    messages: (session.messages ?? []).map((message) => ({ ...message, id: mapped(ids.messages, message.id) || makeId("message") })),
  }));
  const activeSessionId = mapped(ids.sessions, source.chat?.activeSessionId) || sessions[0]?.id || makeId("chat");
  const normalizedSessions = sessions.length ? sessions : [{
    id: activeSessionId,
    title: "新对话",
    messages: [],
    draft: "",
    includePrevious: true,
    includeCharacters: true,
    lastReadMessageId: null,
    createdAt: source.updatedAt,
    updatedAt: source.updatedAt,
  }];
  return {
    ...source,
    ...(source.expansion ? { expansion: structuredClone(source.expansion) } : {}),
    id,
    ...cloneNameState(source, ids),
    settings: cloneChapterSettings(source.settings, ids),
    currentVersionId: mapped(ids.versions, source.currentVersionId) || null,
    defaultVersionId: mapped(ids.versions, source.defaultVersionId) || null,
    excellentFragments: cloneFragments(source.excellentFragments, ids),
    versions,
    chat: { sessions: normalizedSessions, activeSessionId: normalizedSessions.some((session) => session.id === activeSessionId) ? activeSessionId : normalizedSessions[0].id },
    state: source.state === "running" ? "saved" : source.state,
  };
}

function uniqueTitle(title: string, used: Set<string>) {
  const base = title.trim() || "未命名文章";
  if (!used.has(base)) { used.add(base); return base; }
  let index = 1;
  let candidate = `${base}（导入）`;
  while (used.has(candidate)) { index += 1; candidate = `${base}（导入 ${index}）`; }
  used.add(candidate);
  return candidate;
}

export function suggestArticleCopyTitle(title: string, existingTitles: string[] = []) {
  const used = new Set(existingTitles.map((value) => value.trim()).filter(Boolean));
  const base = title.trim() || "未命名文章";
  const suffix = "（副本）";
  let candidate = `${base.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
  let index = 2;
  while (used.has(candidate)) {
    const numberedSuffix = `（副本 ${index}）`;
    candidate = `${base.slice(0, Math.max(1, 120 - numberedSuffix.length))}${numberedSuffix}`;
    index += 1;
  }
  return candidate;
}

function cloneArticleGraph(source: Article, ids: IdMaps, title = source.title): Article {
  const article: Article = {
    ...source,
    reviewRuleItems: articleReviewRules(source).map((rule) => ({ ...rule, id: makeId("review-rule") })),
    id: mapped(ids.articles, source.id) || makeId("article"),
    title,
    lastOutlineId: mapped(ids.outlines, source.lastOutlineId),
    characters: (source.characters ?? []).map((character) => ({ ...character, id: mapped(ids.characters, character.id) || makeId("character") })),
    relationships: (source.relationships ?? []).map((relationship) => ({
      ...relationship,
      id: mapped(ids.relationships, relationship.id) || makeId("relationship"),
      characterAId: mapped(ids.characters, relationship.characterAId),
      characterBId: mapped(ids.characters, relationship.characterBId),
    })).filter((relationship) => relationship.characterAId && relationship.characterBId),
    chapters: (source.chapters ?? []).map((chapter) => ({
      ...chapter,
      id: mapped(ids.chapters, chapter.id) || makeId("chapter"),
      ...cloneNameState(chapter, ids),
      settings: cloneChapterSettings(chapter.settings, ids),
      outlines: (chapter.outlines ?? []).map((outline) => cloneOutline(outline, ids)),
    })),
  };
  if (!article.lastOutlineId) article.lastOutlineId = article.chapters.flatMap((chapter) => chapter.outlines)[0]?.id ?? "";
  return article;
}

function emptyCopiedChat(outlineId: string, createdAt: string): Outline["chat"] {
  const sessionId = `chat:${outlineId}:${makeId("session")}`;
  return {
    activeSessionId: sessionId,
    sessions: [{
      id: sessionId,
      title: "新对话",
      messages: [],
      draft: "",
      includePrevious: true,
      includeCharacters: true,
      lastReadMessageId: null,
      createdAt,
      updatedAt: createdAt,
    }],
  };
}

function keepDefaultContent(outline: Outline): Outline {
  const selectedId = outline.defaultVersionId || outline.currentVersionId;
  const selected = selectedId ? outline.versions.find((version) => version.id === selectedId) : undefined;
  if (!selected) return { ...outline, currentVersionId: null, defaultVersionId: null, versions: [] };
  return {
    ...outline,
    content: selected.content,
    contentName: selected.name,
    currentVersionId: selected.id,
    defaultVersionId: selected.id,
    contentOutlineSnapshot: selected.outlineSnapshot ?? outline.contentOutlineSnapshot,
    manualExcellent: false,
    excellentFragments: [],
    versions: [selected],
  };
}

function copiedSettings(value: unknown, options: ArticleCopyOptions) {
  const settings = normalizeChapterSettings(value);
  if (!options.includeMetadata) settings.story = {};
  else if (!options.includeStyle) delete settings.story.style;
  if (!options.includeCharacters) {
    settings.characters = {};
    settings.relationships = {};
  }
  return settings;
}

export function duplicateArticleForCopy(source: Article, requested: ArticleCopyOptions, existingTitles: string[] = []) {
  const options = { ...DEFAULT_ARTICLE_COPY_OPTIONS, ...requested };
  const ids = registerArticles([source], []);
  const createdAt = new Date().toISOString();
  const title = options.title.trim().slice(0, 120) || suggestArticleCopyTitle(source.title, existingTitles);
  const article = cloneArticleGraph(source, ids, title);
  article.createdAt = createdAt;
  article.updatedAt = createdAt;
  article.summary = options.includeMetadata ? source.summary : "";
  article.type = options.includeMetadata ? source.type : "";
  article.storySettings = options.includeMetadata ? structuredClone(source.storySettings) : { ...EMPTY_ARTICLE_STORY_SETTINGS };
  article.style = options.includeStyle ? source.style : "";
  if (options.includeStyle) {
    if (source.storySettings?.advancedStyle) article.storySettings = { ...article.storySettings!, advancedStyle: structuredClone(source.storySettings.advancedStyle) };
    if (source.storySettings?.styleLibrary) article.storySettings = { ...article.storySettings!, styleLibrary: structuredClone(source.storySettings.styleLibrary) };
  } else if (article.storySettings) { delete article.storySettings.advancedStyle; delete article.storySettings.styleLibrary; }
  if (!options.includeCharacters) {
    article.characters = [];
    article.relationships = [];
  }
  if (!options.includeStructure) {
    article.chapters = [];
    article.lastOutlineId = "";
    return article;
  }
  article.chapters = article.chapters.map((chapter) => {
    const settings = copiedSettings(chapter.settings, options);
    return {
      ...chapter,
      settings,
      ...(options.nameVersions === "default" ? { nameVersions: [], defaultNameVersionId: null } : {}),
      outlines: chapter.outlines.map((outline) => {
      let copied: Outline = {
        ...outline,
        settings: copiedSettings(outline.settings, options),
        updatedAt: createdAt,
        state: "saved",
        ...(options.nameVersions === "default" ? { nameVersions: [], defaultNameVersionId: null } : {}),
        ...(!options.includeChat ? { chat: emptyCopiedChat(outline.id, createdAt) } : {
          chat: {
            ...outline.chat,
            activeSessionId: outline.chat.sessions[0]?.id ?? outline.chat.activeSessionId,
            sessions: outline.chat.sessions.map((session) => ({
              ...session,
              draft: "",
              includePrevious: true,
              includeCharacters: true,
              lastReadMessageId: null,
            })),
          },
        }),
      };
      if (!options.includeContent) {
        copied = {
          ...copied,
          content: "",
          contentName: "",
          currentVersionId: null,
          defaultVersionId: null,
          contentOutlineSnapshot: { title: copied.title, plan: copied.plan },
          manualExcellent: false,
          excellentFragments: [],
          versions: [],
        };
      } else if (options.contentVersions === "default") copied = keepDefaultContent(copied);
      copied.versions = copied.versions.map((version) => version.settingSnapshot ? {
        ...version,
        settingSnapshot: {
          ...version.settingSnapshot,
          story: options.includeMetadata
            ? { ...version.settingSnapshot.story, ...(!options.includeStyle ? { style: "" } : {}) }
            : { summary: "", location: "", style: options.includeStyle ? version.settingSnapshot.story.style : "", negativeConstraints: "" },
          characters: options.includeCharacters ? version.settingSnapshot.characters : [],
          relationships: options.includeCharacters ? version.settingSnapshot.relationships : [],
        },
      } : version);
      return copied;
      }),
    };
  });
  return article;
}

export function duplicateOutlineForImport(source: Outline): Outline {
  const ids = maps();
  registerOutline(source, ids);
  return cloneOutline(source, ids);
}

export function duplicateArticlesForImport(articles: Article[], tasks: AiTask[], existingTitles: string[] = []) {
  const ids = registerArticles(articles, tasks);
  const usedTitles = new Set(existingTitles);
  const importedArticles = articles.map((article) => cloneArticleGraph(article, ids, uniqueTitle(article.title, usedTitles)));
  const importedTasks = tasks.map((task) => {
    const interrupted = task.state === "waiting" || task.state === "running";
    return {
      ...task,
      id: mapped(ids.tasks, task.id) || makeId("task"),
      articleId: mapped(ids.articles, task.articleId),
      chapterId: mapped(ids.chapters, task.chapterId),
      outlineId: mapped(ids.outlines, task.outlineId),
      resultVersionId: task.resultVersionId ? mapped(ids.versions, task.resultVersionId) || undefined : undefined,
      state: interrupted ? "cancelled" as const : task.state,
      phase: interrupted ? "cancelled" as const : task.phase,
      error: interrupted ? "任务随导入数据迁移，未继续执行" : task.error,
      runnerId: undefined,
      leaseUntil: undefined,
      contextOptions: task.contextOptions ? {
        ...task.contextOptions,
        sessionId: task.contextOptions.sessionId ? mapped(ids.sessions, task.contextOptions.sessionId) || undefined : undefined,
        firstAppearanceCharacterIds: task.contextOptions.firstAppearanceCharacterIds?.map((id) => mapped(ids.characters, id)).filter(Boolean),
        excellentFragmentIds: task.contextOptions.excellentFragmentIds?.map((id) => mapped(ids.fragments, id)).filter(Boolean),
        rewriteSourceId: mappedRewriteSourceId(task.contextOptions.rewriteSourceId, ids),
      } : undefined,
    } satisfies AiTask;
  }).filter((task) => task.articleId && task.chapterId && task.outlineId);
  return { articles: importedArticles, tasks: importedTasks };
}

export function portableProviders(providers: Array<Omit<PortableAiProvider, "hadApiKey"> & { hadApiKey?: boolean; hasSecret?: boolean }>): PortableAiProvider[] {
  return providers.map((provider) => ({
    id: String(provider.id), name: String(provider.name), adapterKind: provider.adapterKind === "civitai" ? "civitai" : provider.adapterKind === "spicyapi" ? "spicyapi" : provider.adapterKind === "openrouter" ? "openrouter" : "openai-compatible",
    baseUrl: String(provider.baseUrl), timeoutMs: Number(provider.timeoutMs), hadApiKey: Boolean(provider.hadApiKey ?? provider.hasSecret),
  }));
}

export function portableModels(models: Array<PortableAiModel & { timeoutMs?: number }>): PortableAiModel[] {
  return models.map((model) => ({
    ...(model.metadata ? { metadata: { ...model.metadata, tests: undefined } } : {}),
    id: String(model.id),
    providerId: String(model.providerId),
    name: String(model.name),
    modelId: String(model.modelId),
    systemPrompt: String(model.systemPrompt ?? ""),
    temperature: model.temperature == null ? null : Number(model.temperature),
    maxOutput: model.maxOutput == null ? null : Number(model.maxOutput),
    maxInputCharacters: Number(model.maxInputCharacters),
    reasoningEffort: model.reasoningEffort ?? null,
    timeoutOverrideMs: model.timeoutOverrideMs == null ? null : Number(model.timeoutOverrideMs),
  }));
}

export function transferFilename(scope: TransferScope, title?: string) {
  const labels: Record<TransferScope, string> = {
    outline: "大纲",
    article: "文章",
    articles: "所有文章",
    "system-config": "系统配置",
    complete: "完整备份",
  };
  const safeTitle = String(title ?? labels[scope]).trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 80) || labels[scope];
  const date = new Date().toISOString().slice(0, 10);
  return `Writer-Studio-${safeTitle}-${date}.json`;
}
