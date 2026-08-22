import type { AiTask, Article, Outline, StudioData, StudioSettings } from "@/app/studio-state";

export const TRANSFER_KIND = "writer-studio-transfer" as const;
export const TRANSFER_VERSION = 2 as const;

export type TransferScope = "outline" | "article" | "articles" | "system-config" | "complete";

export type PortableAiProvider = {
  id: string;
  name: string;
  adapterKind: "openai-compatible";
  baseUrl: string;
  timeoutMs: number;
  hadApiKey: boolean;
};

export type PortableAiModel = {
  id: string;
  providerId: string;
  name: string;
  modelId: string;
  systemPrompt: string;
  temperature: number | null;
  maxOutput: number | null;
  maxInputCharacters: number;
  timeoutOverrideMs: number | null;
};

export type OutlineTransferData = { outline: Outline };
export type ArticleTransferData = { article: Article; tasks: AiTask[] };
export type ArticlesTransferData = { articles: Article[]; tasks: AiTask[] };
export type SystemConfigTransferData = { settings: StudioSettings; providers: PortableAiProvider[]; models: PortableAiModel[] };
export type CompleteTransferData = { studio: StudioData; providers: PortableAiProvider[]; models: PortableAiModel[] };

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
    articles: new Map(), chapters: new Map(), outlines: new Map(), versions: new Map(), fragments: new Map(),
    characters: new Map(), relationships: new Map(), sessions: new Map(), messages: new Map(), tasks: new Map(),
  };
}

function register(map: Map<string, string>, id: unknown, prefix: string) {
  const source = String(id ?? "");
  if (source && !map.has(source)) map.set(source, makeId(prefix));
}

function registerOutline(source: Outline, ids: IdMaps) {
  register(ids.outlines, source.id, "outline");
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
      chapter.outlines?.forEach((outline) => registerOutline(outline, ids));
    });
  });
  tasks.forEach((task) => register(ids.tasks, task.id, "task"));
  return ids;
}

function mapped(map: Map<string, string>, id: unknown) {
  return map.get(String(id ?? "")) ?? "";
}

function cloneFragments<T extends { id: string }>(items: T[] | undefined, ids: IdMaps): T[] {
  return (items ?? []).map((item) => ({ ...item, id: mapped(ids.fragments, item.id) || makeId("excellent") }));
}

function cloneOutline(source: Outline, ids: IdMaps): Outline {
  const id = mapped(ids.outlines, source.id) || makeId("outline");
  const versions = (source.versions ?? []).map((version) => ({
    ...version,
    id: mapped(ids.versions, version.id) || makeId("version"),
    taskId: version.taskId ? mapped(ids.tasks, version.taskId) || undefined : undefined,
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
    id,
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

export function duplicateOutlineForImport(source: Outline): Outline {
  const ids = maps();
  registerOutline(source, ids);
  return cloneOutline(source, ids);
}

export function duplicateArticlesForImport(articles: Article[], tasks: AiTask[], existingTitles: string[] = []) {
  const ids = registerArticles(articles, tasks);
  const usedTitles = new Set(existingTitles);
  const importedArticles = articles.map((article) => {
    const imported: Article = {
      ...article,
      id: mapped(ids.articles, article.id) || makeId("article"),
      title: uniqueTitle(article.title, usedTitles),
      lastOutlineId: mapped(ids.outlines, article.lastOutlineId),
      characters: (article.characters ?? []).map((character) => ({ ...character, id: mapped(ids.characters, character.id) || makeId("character") })),
      relationships: (article.relationships ?? []).map((relationship) => ({
        ...relationship,
        id: mapped(ids.relationships, relationship.id) || makeId("relationship"),
        characterAId: mapped(ids.characters, relationship.characterAId),
        characterBId: mapped(ids.characters, relationship.characterBId),
      })).filter((relationship) => relationship.characterAId && relationship.characterBId),
      chapters: (article.chapters ?? []).map((chapter) => ({
        ...chapter,
        id: mapped(ids.chapters, chapter.id) || makeId("chapter"),
        outlines: (chapter.outlines ?? []).map((outline) => cloneOutline(outline, ids)),
      })),
    };
    if (!imported.lastOutlineId) imported.lastOutlineId = imported.chapters.flatMap((chapter) => chapter.outlines)[0]?.id ?? "";
    return imported;
  });
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
      } : undefined,
    } satisfies AiTask;
  }).filter((task) => task.articleId && task.chapterId && task.outlineId);
  return { articles: importedArticles, tasks: importedTasks };
}

export function portableProviders(providers: Array<Omit<PortableAiProvider, "hadApiKey"> & { hadApiKey?: boolean; hasSecret?: boolean }>): PortableAiProvider[] {
  return providers.map((provider) => ({
    id: String(provider.id), name: String(provider.name), adapterKind: "openai-compatible",
    baseUrl: String(provider.baseUrl), timeoutMs: Number(provider.timeoutMs), hadApiKey: Boolean(provider.hadApiKey ?? provider.hasSecret),
  }));
}

export function portableModels(models: Array<PortableAiModel & { timeoutMs?: number }>): PortableAiModel[] {
  return models.map((model) => ({
    id: String(model.id),
    providerId: String(model.providerId),
    name: String(model.name),
    modelId: String(model.modelId),
    systemPrompt: String(model.systemPrompt ?? ""),
    temperature: model.temperature == null ? null : Number(model.temperature),
    maxOutput: model.maxOutput == null ? null : Number(model.maxOutput),
    maxInputCharacters: Number(model.maxInputCharacters),
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
