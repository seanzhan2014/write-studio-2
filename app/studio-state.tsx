"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GENERATE_TARGET_WORDS, normalizeContentGenerationMode, normalizeGeneratePresets, normalizeGenerateTargetWords, type ContentGenerationMode } from "@/lib/generate-options";
import { timestampContentName } from "@/lib/content-name.mjs";
import { resolvedOutlineContent } from "@/lib/outline-content";
import { normalizeOutlineTitle } from "@/lib/outline-title";
import { normalizeReviewPresets } from "@/lib/review-options";
import { mergeAiManagedConflict } from "./studio-conflict.mjs";
import { moveOutlineBetweenChapters, moveOutlineToChapterEnd, type OutlinePlacement } from "./outline-order.mjs";

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  stopped?: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  draft: string;
  includePrevious: boolean;
  includeCharacters: boolean;
  lastReadMessageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Version = {
  id: string;
  name: string;
  content: string;
  source: "手动" | "AI Generate" | "AI Chat" | "AI Review" | "未保存内容";
  createdAt: string;
  model?: string;
  modelId?: string;
  prompt?: string;
  taskId?: string;
  outlineSnapshot?: {
    title: string;
    plan: string;
  };
};

export type Outline = {
  id: string;
  title: string;
  titleGenerationPending: boolean;
  plan: string;
  content: string;
  contentName?: string;
  contentOverride?: boolean;
  archived: boolean;
  state: "saved" | "running" | "failed";
  updatedAt: string;
  sourceVersionId?: string;
  versions: Version[];
  chat: {
    sessions: ChatSession[];
    activeSessionId: string;
  };
};

export type Chapter = {
  id: string;
  title: string;
  archived: boolean;
  outlines: Outline[];
};

export type Character = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  archived: boolean;
};

export type Relationship = {
  id: string;
  characterAId: string;
  characterBId: string;
  description: string;
};

export type Article = {
  id: string;
  title: string;
  summary: string;
  type: string;
  style: string;
  createdAt: string;
  updatedAt: string;
  lastOutlineId: string;
  chapters: Chapter[];
  characters: Character[];
  relationships: Relationship[];
};

export type AiTask = {
  id: string;
  articleId: string;
  chapterId: string;
  outlineId: string;
  target: "正文" | "大纲" | "章节标题" | "AI Chat";
  prompt: string;
  model: string;
  state: "waiting" | "running" | "success" | "failed" | "cancelled";
  phase?: "queued" | "preparing" | "connecting" | "generating" | "receiving" | "saving" | "retrying" | "completed" | "failed" | "cancelled";
  attempt?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastProgressAt?: string;
  receivedCharacters?: number;
  timeoutMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  runnerId?: string;
  leaseUntil?: string;
  resultVersionId?: string;
  resultText?: string;
  error?: string;
  contextOptions?: {
    includePrevious: boolean;
    includeCharacters: boolean;
    estimatedCharacters: number;
    targetWords?: number;
    contentMode?: ContentGenerationMode;
    outlinePlanSnapshot?: string;
    outlineTitleSnapshot?: string;
    modelId?: string;
    modelName?: string;
    generatedOutlineTitle?: string;
    sessionId?: string;
    firstAppearanceCharacterIds?: string[];
  };
};

export type StudioSettings = {
  theme: "light" | "dark" | "system";
  editorFont: "sans" | "serif";
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  outlineExpanded: boolean;
  showArchived: boolean;
  openLastArticle: boolean;
  taskConcurrency: number;
  chatModel: string;
  generateModel: string;
  reviewModel: string;
  generateTargetWords: number;
  generatePresets: string[];
  reviewPresets: string[];
};

export type StudioData = {
  version: 1;
  currentArticleId: string;
  currentOutlineId: string;
  articles: Article[];
  tasks: AiTask[];
  settings: StudioSettings;
};

const now = "2026-07-28T14:32:00.000Z";

function emptyChat(outlineId: string, messages: Message[] = []): Outline["chat"] {
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

function outline(id: string, title: string, plan: string, content: string, state: Outline["state"] = "saved"): Outline {
  return { id, title, titleGenerationPending: !normalizeOutlineTitle(title), plan, content, contentName: timestampContentName(now), state, archived: false, updatedAt: now, versions: [], chat: emptyChat(id) };
}

const openingContent = "雨从凌晨开始落，到清晨也没有停下来的意思。\n\n林澈推开修理铺的百叶门时，海风正沿着旧街一路灌进来，带着盐、铁锈和昨夜没有散尽的雾。门后的铜铃只响了半声，像被谁在梦里按住。\n\n工作台上多了一封信。\n\n信封是最普通的牛皮纸，边缘却被海水泡得发白。她翻到背面，没有邮票，也没有寄件人的名字，只有一行熟悉得让她停住呼吸的字：给二〇三三年的林澈。\n\n那是她自己的笔迹。\n\n她没有立刻拆开。墙上的挂钟走到八点十七分，老旧的秒针轻轻颤了一下。远处，港口的雾笛在看不见的海面上响起，低沉得像某种迟到了很多年的回答。";

const opening = outline(
  "outline-1",
  "收到一封来自未来的信",
  "林澈在修复旧收音机时，发现一封落款日期是七年后的信。信里只有一张潮汐表和一句警告。建立悬念，同时交代她与这座海港的疏离关系。",
  openingContent,
);
opening.versions = [
  { id: "version-ai-opening", name: "AI：加强开场悬念", source: "AI Generate", createdAt: "2026-07-28T14:28:00.000Z", content: "雨从凌晨开始落，挂钟的秒针却忽然向后退了一格。\n\n工作台上多了一封信，像有人刚刚离开。信封正面写着：给二〇三三年的林澈。" },
  { id: "version-manual-opening", name: "手动版本", source: "手动", createdAt: "2026-07-28T13:46:00.000Z", content: openingContent },
  { id: "version-draft-opening", name: "初稿", source: "手动", createdAt: "2026-07-27T22:10:00.000Z", content: "工作台上放着一封信。信封边缘被海水泡得发白，收件人却是七年后的林澈。" },
];
opening.chat = emptyChat(opening.id, [
  { id: "message-1", role: "user", text: "这段开场的悬念够强吗？我希望读者第一段就意识到时间出了问题。", createdAt: "2026-07-28T14:10:00.000Z" },
  { id: "message-2", role: "assistant", text: "悬念已经成立。可以让墙上的钟先倒走一秒，再出现那封信，让时间异常先被感知、再被文字确认。", createdAt: "2026-07-28T14:10:08.000Z" },
]);

const seedData: StudioData = {
  version: 1,
  currentArticleId: "harbor-letters",
  currentOutlineId: "outline-1",
  articles: [
    {
      id: "harbor-letters",
      title: "潮汐来信",
      summary: "林澈收到一封来自七年后的信。为了弄清寄信人，她回到停用的旧码头，也重新遇见了那个本应消失的人。",
      type: "近未来悬疑",
      style: "克制、写实，重视环境细节",
      createdAt: "2026-07-12T09:00:00.000Z",
      updatedAt: now,
      lastOutlineId: "outline-1",
      chapters: [
        {
          id: "chapter-1",
          title: "第一章 · 潮汐之前",
          archived: false,
          outlines: [
            opening,
            outline("outline-2", "旧码头的重逢", "林澈按照信中线索前往已经停用的七码头，意外遇见多年未见的顾屿。他似乎也在寻找同一件东西。", "七码头的铁门已经锈死，顾屿却站在门的另一边，像从未离开过这座城。\n\n“你迟到了七年。”他说。", "running"),
            outline("outline-3", "潮汐表上的空白", "发现日期缺失与七年前的事故有关，推动林澈主动追查。", "潮汐表八月十七日的位置是一片空白，像有人从时间里整齐地剪走了一天。"),
          ],
        },
        {
          id: "chapter-2",
          title: "第二章 · 雾中航线",
          archived: false,
          outlines: [
            outline("outline-4", "凌晨三点的灯塔", "让两位主角在灯塔内发现第二条线索，关系因共同的秘密发生变化。", "灯塔的光每隔十二秒扫过窗面，也把两个人的影子一次次推回黑暗里。"),
            outline("outline-5", "失踪的第七码头", "旧海图显示港区曾经存在第七码头，但所有现实记录都否认它。", "海图摊开时，一条不存在的航线正在墨迹里缓慢显现。", "failed"),
          ],
        },
        {
          id: "chapter-3",
          title: "第三章 · 回声抵岸",
          archived: false,
          outlines: [outline("outline-6", "黎明前的选择", "林澈需要在保留现有时间线和救回失踪者之间作出选择。", "天亮以前，她只能寄出一封信。")],
        },
      ],
      characters: [
        { id: "character-lin", name: "林澈", aliases: ["阿澈"], description: "海港长大的修理师。冷静敏锐，擅长精密仪器维修和旧地图辨识，习惯用可验证的事实抵抗失序。", archived: false },
        { id: "character-gu", name: "顾屿", aliases: ["顾先生"], description: "海图绘制员，左手有旧伤。克制且擅长隐藏真实意图，七年前失踪，如今似乎知道信件来源。", archived: false },
        { id: "character-zhou", name: "周岚", aliases: ["周姨"], description: "港务记录员，谨慎而固执，总带着一本蓝封皮记录册，保存着旧港关闭前最后一份完整潮汐记录。", archived: false },
      ],
      relationships: [
        { id: "relation-1", characterAId: "character-lin", characterBId: "character-gu", description: "旧日搭档 / 彼此隐瞒关键信息" },
        { id: "relation-2", characterAId: "character-lin", characterBId: "character-zhou", description: "忘年之交 / 记录委托" },
        { id: "relation-3", characterAId: "character-gu", characterBId: "character-zhou", description: "共同保守七年前的秘密" },
      ],
    },
    {
      id: "south-city",
      title: "城南旧事集",
      summary: "关于旧城街巷与家庭记忆的短篇集。",
      type: "现实题材",
      style: "温柔、含蓄",
      createdAt: "2026-06-02T09:00:00.000Z",
      updatedAt: "2026-07-20T12:00:00.000Z",
      lastOutlineId: "south-outline-1",
      chapters: [{ id: "south-chapter-1", title: "第一章 · 榕树下", archived: false, outlines: [outline("south-outline-1", "搬家前的最后一个下午", "一家人在旧屋整理多年留下的物件。", "阳光从榕树叶间落进院子，纸箱里全是没有来得及告别的年月。")]}],
      characters: [],
      relationships: [],
    },
    {
      id: "long-summer",
      title: "漫长夏日备忘录",
      summary: "一段发生在海边小镇的成长故事。",
      type: "青春小说",
      style: "明亮、松弛",
      createdAt: "2026-05-18T09:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
      lastOutlineId: "summer-outline-1",
      chapters: [{ id: "summer-chapter-1", title: "第一章 · 六月", archived: false, outlines: [outline("summer-outline-1", "蝉鸣开始的那天", "主角在暑假第一天收到一台旧相机。", "蝉鸣从铁路另一边传来时，邮差把那只没有寄件人的纸箱放在门口。")]}],
      characters: [],
      relationships: [],
    },
  ],
  tasks: [
    { id: "task-running", articleId: "harbor-letters", chapterId: "chapter-1", outlineId: "outline-2", target: "正文", prompt: "延续悬疑氛围，让林澈和顾屿在旧码头重逢", model: "创作主模型", state: "running", createdAt: "2026-07-28T14:31:00.000Z" },
    { id: "task-failed", articleId: "harbor-letters", chapterId: "chapter-2", outlineId: "outline-5", target: "正文", prompt: "让海图显示出不存在的航线", model: "创作主模型", state: "failed", createdAt: "2026-07-28T13:50:00.000Z", error: "模拟服务暂时不可用" },
  ],
  settings: {
    theme: "light",
    editorFont: "sans",
    fontSize: 17,
    lineHeight: 1.8,
    contentWidth: 920,
    outlineExpanded: true,
    showArchived: false,
    openLastArticle: true,
    taskConcurrency: 2,
    chatModel: "快速对话模型",
    generateModel: "",
    reviewModel: "",
    generateTargetWords: DEFAULT_GENERATE_TARGET_WORDS,
    generatePresets: [],
    reviewPresets: [],
  },
};

type StudioContextValue = {
  data: StudioData;
  hydrated: boolean;
  saveStatus: "loading" | "saved" | "unsaved" | "saving" | "failed" | "conflict";
  saveError: string;
  conflict: { local: StudioData; server: StudioData; serverRevision: number } | null;
  currentArticle: Article;
  currentChapter: Chapter;
  currentOutline: Outline;
  setCurrentArticle: (articleId: string) => void;
  setCurrentOutline: (outlineId: string) => void;
  createArticle: (fields: Pick<Article, "title" | "summary" | "type" | "style">) => string;
  updateArticle: (patch: Partial<Pick<Article, "title" | "summary" | "type" | "style">>) => void;
  deleteArticle: (articleId: string) => void;
  createChapter: (title?: string) => string;
  updateChapter: (chapterId: string, patch: Partial<Pick<Chapter, "title" | "archived">>) => void;
  moveChapter: (chapterId: string, direction: -1 | 1) => void;
  deleteChapter: (chapterId: string) => void;
  createOutline: (chapterId?: string, afterId?: string) => string;
  updateOutline: (outlineId: string, patch: Partial<Pick<Outline, "title" | "titleGenerationPending" | "plan" | "content" | "contentName" | "contentOverride" | "archived" | "state" | "sourceVersionId">>) => void;
  saveOutlinePlan: (outlineId: string, plan: string) => Promise<boolean>;
  stageContentDraft: (outlineId: string, text: string) => void;
  clearContentDraft: (outlineId: string) => void;
  saveCurrentContent: (outlineId: string, text: string) => Promise<boolean>;
  commitContentEdit: (outlineId: string, text: string) => Promise<boolean>;
  preserveContentDraft: (outlineId: string, text: string, savedAt?: string) => Promise<boolean>;
  moveOutline: (sourceId: string, targetId: string, placement: OutlinePlacement) => void;
  moveOutlineToChapter: (outlineId: string, chapterId: string) => void;
  copyOutline: (outlineId: string) => string | null;
  deleteOutline: (outlineId: string) => void;
  saveVersion: (outlineId: string, name?: string, source?: Version["source"], content?: string, metadata?: Pick<Version, "model" | "modelId" | "prompt" | "taskId" | "outlineSnapshot">) => string;
  setDefaultVersion: (outlineId: string, versionId?: string) => void;
  applyVersion: (outlineId: string, versionId: string) => void;
  applyVersionWithBackup: (outlineId: string, versionId: string) => string | null;
  renameVersion: (outlineId: string, versionId: string, name: string) => void;
  deleteVersion: (outlineId: string, versionId: string) => void;
  createChatSession: (outlineId: string, title?: string, messages?: Message[]) => string;
  setActiveChatSession: (outlineId: string, sessionId: string) => void;
  renameChatSession: (outlineId: string, sessionId: string, title: string) => void;
  deleteChatSession: (outlineId: string, sessionId: string) => void;
  branchChatSession: (outlineId: string, messageId: string) => string | null;
  setChatDraft: (outlineId: string, draft: string, sessionId?: string) => void;
  setChatSetting: (outlineId: string, key: "includePrevious" | "includeCharacters", value: boolean) => void;
  addChatMessage: (outlineId: string, message: Message, sessionId?: string) => void;
  replaceChatMessages: (outlineId: string, messages: Message[], sessionId?: string) => void;
  markChatSessionRead: (outlineId: string, sessionId: string) => void;
  clearChat: (outlineId: string) => void;
  addTask: (task: Omit<AiTask, "id" | "createdAt" | "state"> & { state?: AiTask["state"] }) => string | null;
  updateTask: (taskId: string, patch: Partial<AiTask>) => void;
  removeTask: (taskId: string) => void;
  clearCompletedTasks: () => void;
  updateSettings: (patch: Partial<StudioSettings>) => void;
  addCharacter: (character: Omit<Character, "id">) => string;
  updateCharacter: (characterId: string, patch: Partial<Character>) => void;
  deleteCharacter: (characterId: string) => void;
  addRelationship: (relationship: Omit<Relationship, "id">) => string;
  updateRelationship: (relationshipId: string, patch: Partial<Relationship>) => void;
  deleteRelationship: (relationshipId: string) => void;
  clearBusinessData: () => Promise<boolean>;
  refreshFromServer: () => Promise<boolean>;
  saveNow: () => Promise<boolean>;
  retrySave: () => Promise<boolean>;
  resolveConflict: (choice: "keep-local" | "use-server") => Promise<void>;
};

const StudioContext = createContext<StudioContextValue | null>(null);
const legacyStorageKey = "writer-studio-poc-v2";
const draftPrefix = "writer-studio:draft:";

function makeId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${id}`;
}

function findOutlineInArticle(article: Article, outlineId: string) {
  for (const chapter of article.chapters) {
    const found = chapter.outlines.find((item) => item.id === outlineId);
    if (found) return { chapter, outline: found };
  }
  return null;
}

function firstOutline(article: Article) {
  return article.chapters.flatMap((chapter) => chapter.outlines).find((item) => !item.archived)?.id ?? article.chapters.flatMap((chapter) => chapter.outlines)[0]?.id ?? "";
}

function normalizeCharacter(source: unknown): Character {
  const item = source as Partial<Character> & Record<string, unknown>;
  const legacyDescription = [item.role, item.appearance, item.personality, item.abilities, item.background]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n");
  return {
    id: String(item.id ?? makeId("character")),
    name: String(item.name ?? ""),
    aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
    description: String(item.description ?? legacyDescription),
    archived: Boolean(item.archived),
  };
}

function normalizeAiTask(task: AiTask): AiTask {
  const phase = task.phase ?? (task.state === "waiting" ? "queued" : task.state === "success" ? "completed" : task.state === "failed" ? "failed" : task.state === "cancelled" ? "cancelled" : "generating");
  return {
    ...task,
    contextOptions: task.contextOptions ? {
      ...task.contextOptions,
      ...(task.target === "正文" ? { contentMode: normalizeContentGenerationMode(task.contextOptions.contentMode) } : {}),
      firstAppearanceCharacterIds: Array.isArray(task.contextOptions.firstAppearanceCharacterIds)
        ? [...new Set(task.contextOptions.firstAppearanceCharacterIds.map(String))].slice(0, 200)
        : undefined,
    } : task.contextOptions,
    phase,
    attempt: Math.max(0, Number(task.attempt ?? 0)),
    receivedCharacters: Math.max(0, Number(task.receivedCharacters ?? task.resultText?.length ?? 0)),
  };
}

const emptyChapter: Chapter = { id: "", title: "", archived: false, outlines: [] };
const emptyOutline: Outline = { id: "", title: "", titleGenerationPending: false, plan: "", content: "", contentName: timestampContentName(now), archived: false, state: "saved", updatedAt: now, versions: [], chat: emptyChat("empty") };
const emptyArticle: Article = { id: "", title: "", summary: "", type: "", style: "", createdAt: now, updatedAt: now, lastOutlineId: "", chapters: [], characters: [], relationships: [] };

function emptyStudioData(settings: StudioSettings): StudioData {
  return { version: 1, currentArticleId: "", currentOutlineId: "", articles: [], tasks: [], settings };
}

function normalizeStudioData(source: StudioData): StudioData {
  return {
    ...source,
    tasks: (source.tasks ?? []).map(normalizeAiTask),
    settings: {
      ...seedData.settings,
      ...(source.settings ?? {}),
      generateTargetWords: normalizeGenerateTargetWords(source.settings?.generateTargetWords),
      generatePresets: normalizeGeneratePresets(source.settings?.generatePresets),
      reviewPresets: normalizeReviewPresets(source.settings?.reviewPresets),
    },
    articles: source.articles.map((article) => ({
      ...article,
      characters: (article.characters ?? []).map(normalizeCharacter),
      chapters: article.chapters.map((chapter) => ({
        ...chapter,
        outlines: chapter.outlines.map((item) => {
          const normalizedTitle = normalizeOutlineTitle(item.title);
          const normalizedItem = { ...item, title: normalizedTitle, contentName: item.contentName?.trim() || timestampContentName(item.updatedAt), contentOverride: item.contentOverride === true, titleGenerationPending: item.titleGenerationPending ?? !normalizedTitle };
          const legacy = item.chat as typeof item.chat & { messages?: Message[]; draft?: string; includePrevious?: boolean; includeCharacters?: boolean };
          if (Array.isArray(legacy.sessions) && legacy.sessions.length) {
            const sessions = legacy.sessions.map((session) => ({
              ...session,
              lastReadMessageId: Object.prototype.hasOwnProperty.call(session, "lastReadMessageId")
                ? session.lastReadMessageId ?? null
                : session.messages.filter((message) => message.role === "assistant").at(-1)?.id ?? null,
            }));
            const activeSessionId = sessions.some((session) => session.id === legacy.activeSessionId) ? legacy.activeSessionId : sessions[0].id;
            return { ...normalizedItem, chat: { sessions, activeSessionId } };
          }
          const chat = emptyChat(item.id, legacy.messages ?? []);
          chat.sessions[0] = { ...chat.sessions[0], draft: legacy.draft ?? "", includePrevious: legacy.includePrevious !== false, includeCharacters: legacy.includeCharacters !== false };
          return { ...normalizedItem, chat };
        }),
      })),
    })),
  };
}

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [data, setDataState] = useState<StudioData>(seedData);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<StudioContextValue["saveStatus"]>("loading");
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState<StudioContextValue["conflict"]>(null);
  const dataRef = useRef(data);
  const revisionRef = useRef(0);
  const lastSavedRef = useRef("");
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveEpochRef = useRef(0);
  const pendingRecoveredDraftKeysRef = useRef<string[]>([]);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);

  const setData = useCallback((update: StudioData | ((current: StudioData) => StudioData)) => {
    const next = typeof update === "function" ? update(dataRef.current) : update;
    dataRef.current = next;
    setDataState(next);
  }, []);

  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error(`数据库加载失败（${response.status}）`);
        const payload = await response.json() as { data: StudioData | null; revision: number };
        let loaded = payload.data;
        revisionRef.current = payload.revision;
        if (!loaded) {
          const legacy = window.localStorage.getItem(legacyStorageKey);
          if (legacy) {
            try {
              const parsed = JSON.parse(legacy) as StudioData;
              if (parsed.version === 1 && parsed.articles?.length) loaded = parsed;
            } catch { /* Invalid legacy data is ignored during one-time migration. */ }
          }
          loaded ??= emptyStudioData(seedData.settings);
          window.localStorage.removeItem(legacyStorageKey);
        }
        if (loaded) loaded = normalizeStudioData(loaded);
        const databaseSnapshot = JSON.stringify(loaded);
        const recoveredDraftKeys: string[] = [];
        const storedDraftKeys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index)).filter((key): key is string => Boolean(key?.startsWith(draftPrefix)));
        for (const key of storedDraftKeys) {
          try {
            const draft = JSON.parse(window.sessionStorage.getItem(key) ?? "") as { outlineId: string; text: string; savedAt?: string };
            if (typeof draft.outlineId !== "string" || typeof draft.text !== "string") throw new Error("invalid editor draft");
            const createdAt = draft.savedAt && !Number.isNaN(new Date(draft.savedAt).getTime()) ? draft.savedAt : new Date().toISOString();
            let recovered = false;
            loaded = { ...loaded, articles: loaded.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((outline) => {
              if (outline.id !== draft.outlineId || outline.content === draft.text || outline.versions.some((version) => version.source === "未保存内容" && version.content === draft.text)) return outline;
              recovered = true;
              const version: Version = { id: makeId("version"), name: `未保存内容 · ${new Date(createdAt).toLocaleString("zh-CN")}`, content: draft.text, source: "未保存内容", createdAt, outlineSnapshot: { title: outline.title, plan: outline.plan } };
              return { ...outline, versions: [version, ...outline.versions] };
            }) })) })) };
            if (recovered) recoveredDraftKeys.push(key);
            else window.sessionStorage.removeItem(key);
          } catch {
            window.sessionStorage.removeItem(key);
          }
        }
        if (!active) return;
        setData(loaded);
        dataRef.current = loaded;
        lastSavedRef.current = databaseSnapshot;
        pendingRecoveredDraftKeysRef.current = recoveredDraftKeys;
        setSaveStatus("saved");
      } catch (error) {
        if (!active) return;
        setSaveError(error instanceof Error ? error.message : "数据库加载失败");
        setSaveStatus("failed");
      } finally {
        if (active) setHydrated(true);
      }
    }
    void load();
    return () => { active = false; };
  }, [setData]);

  const persist = useCallback(async function persistSnapshot(snapshot: StudioData, force = false, epoch = saveEpochRef.current, rebaseAttempt = 0): Promise<boolean> {
    if (!force && epoch !== saveEpochRef.current) return false;
    const serialized = JSON.stringify(snapshot);
    if (!force && serialized === lastSavedRef.current) return true;
    setSaveStatus("saving");
    setSaveError("");
    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": String(revisionRef.current) },
        body: JSON.stringify({ data: snapshot, conflictResolution: force ? "keep-local" : undefined }),
      });
      const payload = await response.json() as { revision?: number; data?: StudioData; message?: string };
      if (response.status === 409 && payload.data) {
        if (!force && rebaseAttempt < 2 && lastSavedRef.current) {
          try {
            const base = JSON.parse(lastSavedRef.current) as StudioData;
            const server = normalizeStudioData(payload.data);
            const merged = mergeAiManagedConflict(base, snapshot, server);
            if (merged) {
              revisionRef.current = Number(payload.revision ?? revisionRef.current);
              dataRef.current = merged;
              setData(merged);
              return persistSnapshot(merged, false, epoch, rebaseAttempt + 1);
            }
          } catch { /* A malformed base snapshot falls through to explicit resolution. */ }
        }
        saveEpochRef.current += 1;
        setConflict({ local: snapshot, server: normalizeStudioData(payload.data), serverRevision: Number(payload.revision ?? revisionRef.current) });
        setSaveStatus("conflict");
        return false;
      }
      if (!response.ok || payload.revision === undefined) throw new Error(payload.message || `保存失败（${response.status}）`);
      revisionRef.current = payload.revision;
      lastSavedRef.current = serialized;
      setConflict(null);
      setSaveStatus("saved");
      pendingRecoveredDraftKeysRef.current.forEach((key) => window.sessionStorage.removeItem(key));
      pendingRecoveredDraftKeysRef.current = [];
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
      setSaveStatus("failed");
      return false;
    }
  }, [setData]);

  const enqueueSave = useCallback((snapshot: StudioData, force = false) => {
    const epoch = saveEpochRef.current;
    saveQueueRef.current = saveQueueRef.current.then(() => persist(snapshot, force, epoch), () => persist(snapshot, force, epoch));
    return saveQueueRef.current;
  }, [persist]);

  const refreshFromServer = useCallback(async () => {
    if (!hydrated || conflict || JSON.stringify(dataRef.current) !== lastSavedRef.current) return false;
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const requestedSnapshot = lastSavedRef.current;
    const request = (async () => {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        const payload = await response.json() as { data?: StudioData | null; revision?: number };
        if (!response.ok || !payload.data || payload.revision === undefined) return false;
        if (JSON.stringify(dataRef.current) !== requestedSnapshot || lastSavedRef.current !== requestedSnapshot) return false;
        const server = normalizeStudioData(payload.data);
        const serialized = JSON.stringify(server);
        revisionRef.current = payload.revision;
        if (serialized !== lastSavedRef.current) {
          dataRef.current = server;
          lastSavedRef.current = serialized;
          setData(server);
        }
        return true;
      } catch {
        return false;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();
    refreshPromiseRef.current = request;
    return request;
  }, [hydrated, conflict, setData]);

  useEffect(() => {
    if (!hydrated || conflict) return;
    const serialized = JSON.stringify(data);
    if (serialized === lastSavedRef.current) return;
    setSaveStatus("unsaved");
    const timer = window.setTimeout(() => { void enqueueSave(data); }, 800);
    return () => window.clearTimeout(timer);
  }, [data, hydrated, conflict, enqueueSave]);

  useEffect(() => {
    if (!hydrated) return;
    const onHidden = () => { if (document.visibilityState === "hidden") void enqueueSave(dataRef.current); };
    const onPageHide = () => { void enqueueSave(dataRef.current); };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => { document.removeEventListener("visibilitychange", onHidden); window.removeEventListener("pagehide", onPageHide); };
  }, [hydrated, enqueueSave]);

  useEffect(() => {
    if (!hydrated) return;
    const refreshVisible = () => { if (document.visibilityState === "visible") void refreshFromServer(); };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && dataRef.current.tasks.some((task) => task.state === "waiting" || task.state === "running")) void refreshFromServer();
    }, 3000);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [hydrated, refreshFromServer]);

  const currentArticle = data.articles.find((article) => article.id === data.currentArticleId) ?? data.articles[0] ?? emptyArticle;
  const currentPair = currentArticle.id ? findOutlineInArticle(currentArticle, data.currentOutlineId) ?? findOutlineInArticle(currentArticle, firstOutline(currentArticle)) : null;
  const currentChapter = currentPair?.chapter ?? currentArticle.chapters[0] ?? emptyChapter;
  const currentOutline = currentPair?.outline ?? currentChapter?.outlines[0] ?? emptyOutline;

  const value = useMemo<StudioContextValue>(() => ({
    data,
    hydrated,
    saveStatus,
    saveError,
    conflict,
    currentArticle,
    currentChapter,
    currentOutline,
    setCurrentArticle(articleId) {
      setData((current) => {
        const article = current.articles.find((item) => item.id === articleId);
        if (!article) return current;
        return { ...current, currentArticleId: articleId, currentOutlineId: article.lastOutlineId || firstOutline(article) };
      });
    },
    setCurrentOutline(outlineId) {
      setData((current) => ({
        ...current,
        currentOutlineId: outlineId,
        articles: current.articles.map((article) => article.id === current.currentArticleId ? { ...article, lastOutlineId: outlineId } : article),
      }));
    },
    createArticle(fields) {
      const articleId = makeId("article");
      const chapterId = makeId("chapter");
      const outlineId = makeId("outline");
      const createdAt = new Date().toISOString();
      const article: Article = {
        id: articleId,
        ...fields,
        createdAt,
        updatedAt: createdAt,
        lastOutlineId: outlineId,
        chapters: [{ id: chapterId, title: "第一章", archived: false, outlines: [outline(outlineId, "", "", "")] }],
        characters: [],
        relationships: [],
      };
      setData((current) => ({ ...current, currentArticleId: articleId, currentOutlineId: outlineId, articles: [article, ...current.articles] }));
      return outlineId;
    },
    updateArticle(patch) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => article.id === current.currentArticleId ? { ...article, ...patch, updatedAt: new Date().toISOString() } : article) }));
    },
    deleteArticle(articleId) {
      setData((current) => {
        const articles = current.articles.filter((article) => article.id !== articleId);
        const nextArticle = articles[0];
        return { ...current, articles, currentArticleId: nextArticle?.id ?? "", currentOutlineId: nextArticle ? nextArticle.lastOutlineId || firstOutline(nextArticle) : "", tasks: current.tasks.filter((task) => task.articleId !== articleId) };
      });
    },
    createChapter(title = "未命名章节") {
      const id = makeId("chapter");
      setData((current) => ({ ...current, articles: current.articles.map((article) => article.id === current.currentArticleId ? { ...article, chapters: [...article.chapters, { id, title, archived: false, outlines: [] }] } : article) }));
      return id;
    },
    updateChapter(chapterId, patch) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => article.id === current.currentArticleId ? { ...article, chapters: article.chapters.map((chapter) => chapter.id === chapterId ? { ...chapter, ...patch } : chapter) } : article) }));
    },
    moveChapter(chapterId, direction) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => {
        if (article.id !== current.currentArticleId) return article;
        const chapters = [...article.chapters];
        const index = chapters.findIndex((chapter) => chapter.id === chapterId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= chapters.length) return article;
        [chapters[index], chapters[target]] = [chapters[target], chapters[index]];
        return { ...article, chapters };
      }) }));
    },
    deleteChapter(chapterId) {
      setData((current) => {
        let nextOutlineId = current.currentOutlineId;
        const articles = current.articles.map((article) => {
          if (article.id !== current.currentArticleId) return article;
          const deletingCurrent = article.chapters.find((chapter) => chapter.id === chapterId)?.outlines.some((item) => item.id === current.currentOutlineId);
          const chapters = article.chapters.filter((chapter) => chapter.id !== chapterId);
          if (deletingCurrent) nextOutlineId = firstOutline({ ...article, chapters });
          return { ...article, chapters, lastOutlineId: nextOutlineId };
        });
        return { ...current, articles, currentOutlineId: nextOutlineId, tasks: current.tasks.filter((task) => task.chapterId !== chapterId) };
      });
    },
    createOutline(chapterId, afterId) {
      const id = makeId("outline");
      setData((current) => ({ ...current, currentOutlineId: id, articles: current.articles.map((article) => {
        if (article.id !== current.currentArticleId) return article;
        const targetChapterId = chapterId ?? findOutlineInArticle(article, current.currentOutlineId)?.chapter.id ?? article.chapters[0]?.id;
        let chapters = article.chapters;
        if (!targetChapterId) chapters = [{ id: makeId("chapter"), title: "第一章", archived: false, outlines: [] }];
        return { ...article, lastOutlineId: id, chapters: chapters.map((chapter) => {
          if (chapter.id !== (targetChapterId ?? chapters[0].id)) return chapter;
          const items = [...chapter.outlines];
          const index = afterId ? items.findIndex((item) => item.id === afterId) + 1 : items.length;
          items.splice(Math.max(0, index), 0, outline(id, "", "", ""));
          return { ...chapter, outlines: items };
        }) };
      }) }));
      return id;
    },
    updateOutline(outlineId, patch) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, updatedAt: article.id === current.currentArticleId ? new Date().toISOString() : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        const sourceVersionId = Object.prototype.hasOwnProperty.call(patch, "sourceVersionId") ? patch.sourceVersionId : item.sourceVersionId;
        const hasPendingPatch = Object.prototype.hasOwnProperty.call(patch, "titleGenerationPending");
        const planChanged = Object.prototype.hasOwnProperty.call(patch, "plan") && patch.plan !== item.plan;
        const hasTitlePatch = Object.prototype.hasOwnProperty.call(patch, "title");
        const titleGenerationPending = hasPendingPatch
          ? Boolean(patch.titleGenerationPending)
          : hasTitlePatch
            ? !normalizeOutlineTitle(patch.title)
            : planChanged
              ? true
              : item.titleGenerationPending;
        return { ...item, ...patch, titleGenerationPending, updatedAt: new Date().toISOString(), sourceVersionId };
      }) })) })) }));
    },
    saveOutlinePlan(outlineId, plan) {
      const updatedAt = new Date().toISOString();
      const nextPlan = plan.slice(0, 10000);
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, updatedAt: article.id === dataRef.current.currentArticleId ? updatedAt : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, plan: nextPlan, titleGenerationPending: nextPlan !== item.plan ? true : item.titleGenerationPending, updatedAt } : item) })) })) };
      dataRef.current = snapshot;
      setData(snapshot);
      return enqueueSave(snapshot);
    },
    stageContentDraft(outlineId, text) {
      window.sessionStorage.setItem(`${draftPrefix}${outlineId}`, JSON.stringify({ outlineId, text, savedAt: new Date().toISOString() }));
    },
    clearContentDraft(outlineId) {
      window.sessionStorage.removeItem(`${draftPrefix}${outlineId}`);
    },
    saveCurrentContent(outlineId, text) {
      const updatedAt = new Date().toISOString();
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, updatedAt: article.id === dataRef.current.currentArticleId ? updatedAt : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, content: text, contentName: item.contentName?.trim() || timestampContentName(updatedAt), contentOverride: true, updatedAt } : item) })) })) };
      dataRef.current = snapshot;
      setData(snapshot);
      return enqueueSave(snapshot);
    },
    commitContentEdit(outlineId, text) {
      const updatedAt = new Date().toISOString();
      const versionId = makeId("version");
      const existing = dataRef.current.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((item) => item.id === outlineId);
      const version: Version = { id: versionId, name: timestampContentName(updatedAt), content: text, source: "手动", createdAt: updatedAt, outlineSnapshot: { title: existing?.title ?? "", plan: existing?.plan ?? "" } };
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, updatedAt: article.id === dataRef.current.currentArticleId ? updatedAt : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, content: text, contentName: version.name, contentOverride: false, sourceVersionId: versionId, updatedAt, versions: [version, ...item.versions] } : item) })) })) };
      dataRef.current = snapshot;
      setData(snapshot);
      return enqueueSave(snapshot);
    },
    async preserveContentDraft(outlineId, text, savedAt = new Date().toISOString()) {
      const existing = dataRef.current.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((item) => item.id === outlineId);
      if (!existing || resolvedOutlineContent(existing) === text || existing.versions.some((version) => version.source === "未保存内容" && version.content === text)) {
        window.sessionStorage.removeItem(`${draftPrefix}${outlineId}`);
        return true;
      }
      const version: Version = { id: makeId("version"), name: `未保存内容 · ${new Date(savedAt).toLocaleString("zh-CN")}`, content: text, source: "未保存内容", createdAt: savedAt, outlineSnapshot: { title: existing.title, plan: existing.plan } };
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, versions: [version, ...item.versions] } : item) })) })) };
      dataRef.current = snapshot;
      setData(snapshot);
      const saved = await enqueueSave(snapshot);
      if (saved) window.sessionStorage.removeItem(`${draftPrefix}${outlineId}`);
      return saved;
    },
    moveOutline(sourceId, targetId, placement) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => {
        if (article.id !== current.currentArticleId) return article;
        const chapters = moveOutlineBetweenChapters(article.chapters, sourceId, targetId, placement);
        return chapters === article.chapters ? article : { ...article, chapters, updatedAt: new Date().toISOString() };
      }) }));
    },
    moveOutlineToChapter(outlineId, chapterId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => {
        if (article.id !== current.currentArticleId) return article;
        const chapters = moveOutlineToChapterEnd(article.chapters, outlineId, chapterId);
        return chapters === article.chapters ? article : { ...article, chapters, updatedAt: new Date().toISOString() };
      }) }));
    },
    copyOutline(outlineId) {
      const id = makeId("outline");
      let copied = false;
      setData((current) => ({ ...current, articles: current.articles.map((article) => {
        if (article.id !== current.currentArticleId) return article;
        return { ...article, chapters: article.chapters.map((chapter) => {
          const index = chapter.outlines.findIndex((item) => item.id === outlineId);
          if (index < 0) return chapter;
          const source = chapter.outlines[index];
          const items = [...chapter.outlines];
          const sourceTitle = normalizeOutlineTitle(source.title);
          items.splice(index + 1, 0, { ...outline(id, sourceTitle ? `${sourceTitle}（副本）` : "", source.plan, ""), titleGenerationPending: true, archived: source.archived });
          copied = true;
          return { ...chapter, outlines: items };
        }) };
      }) }));
      return copied ? id : null;
    },
    deleteOutline(outlineId) {
      setData((current) => {
        const articles = current.articles.map((article) => {
          const chapters = article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.filter((item) => item.id !== outlineId) }));
          return { ...article, chapters };
        });
        const activeArticle = articles.find((article) => article.id === current.currentArticleId) ?? articles[0];
        const nextId = current.currentOutlineId === outlineId ? activeArticle ? firstOutline(activeArticle) : "" : current.currentOutlineId;
        return { ...current, articles: articles.map((article) => article.id === current.currentArticleId ? { ...article, lastOutlineId: nextId } : article), currentOutlineId: nextId, tasks: current.tasks.filter((task) => task.outlineId !== outlineId) };
      });
    },
    saveVersion(outlineId, name, source = "手动", content, metadata) {
      const id = makeId("version");
      const createdAt = new Date().toISOString();
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, versions: [{ id, name: name || timestampContentName(createdAt), source, createdAt, content: content ?? resolvedOutlineContent(item), outlineSnapshot: metadata?.outlineSnapshot ?? { title: item.title, plan: item.plan }, ...metadata }, ...item.versions] } : item) })) })) }));
      return id;
    },
    setDefaultVersion(outlineId, versionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        if (versionId && !item.versions.some((version) => version.id === versionId)) return item;
        const selected = item.versions.find((version) => version.id === versionId);
        return { ...item, contentName: selected?.name ?? item.contentName, contentOverride: selected ? false : item.contentOverride, sourceVersionId: versionId, updatedAt: new Date().toISOString() };
      }) })) })) }));
    },
    applyVersion(outlineId, versionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        const selected = item.versions.find((version) => version.id === versionId);
        return selected ? { ...item, content: selected.content, contentName: selected.name, contentOverride: false, sourceVersionId: selected.id, updatedAt: new Date().toISOString() } : item;
      }) })) })) }));
    },
    applyVersionWithBackup(outlineId, versionId) {
      const targetExists = dataRef.current.articles.some((article) => article.chapters.some((chapter) => chapter.outlines.some((item) => item.id === outlineId && item.versions.some((version) => version.id === versionId))));
      if (!targetExists) return null;
      const backupId = makeId("version");
      const createdAt = new Date().toISOString();
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        const selected = item.versions.find((version) => version.id === versionId);
        if (!selected) return item;
        const backup: Version = { id: backupId, name: `应用 AI 前 · ${new Date().toLocaleString("zh-CN")}`, content: resolvedOutlineContent(item), source: "手动", createdAt, outlineSnapshot: { title: item.title, plan: item.plan } };
        return { ...item, content: selected.content, contentName: selected.name, contentOverride: false, sourceVersionId: selected.id, updatedAt: createdAt, versions: [backup, ...item.versions] };
      }) })) })) }));
      return backupId;
    },
    renameVersion(outlineId, versionId, name) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, versions: item.versions.map((version) => version.id === versionId ? { ...version, name } : version) } : item) })) })) }));
    },
    deleteVersion(outlineId, versionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, versions: item.versions.filter((version) => version.id !== versionId), sourceVersionId: item.sourceVersionId === versionId ? undefined : item.sourceVersionId } : item) })) })) }));
    },
    createChatSession(outlineId, title = "新对话", messages = []) {
      const id = makeId("chat");
      const createdAt = new Date().toISOString();
      const cloned = messages.map((message) => ({ ...message, id: makeId("message") }));
      const session: ChatSession = { id, title: title.trim().slice(0, 48) || "新对话", messages: cloned, draft: "", includePrevious: true, includeCharacters: true, lastReadMessageId: cloned.filter((message) => message.role === "assistant").at(-1)?.id ?? null, createdAt, updatedAt: createdAt };
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, chat: { sessions: [session, ...item.chat.sessions], activeSessionId: id } } : item) })) })) }));
      return id;
    },
    setActiveChatSession(outlineId, sessionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId && item.chat.sessions.some((session) => session.id === sessionId) ? { ...item, chat: { ...item.chat, activeSessionId: sessionId } } : item) })) })) }));
    },
    renameChatSession(outlineId, sessionId, title) {
      const nextTitle = title.trim().slice(0, 48) || "新对话";
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, chat: { ...item.chat, sessions: item.chat.sessions.map((session) => session.id === sessionId ? { ...session, title: nextTitle, updatedAt: new Date().toISOString() } : session) } } : item) })) })) }));
    },
    deleteChatSession(outlineId, sessionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        if (item.chat.sessions.length <= 1) {
          return { ...item, chat: { ...item.chat, sessions: item.chat.sessions.map((session) => session.id === sessionId ? { ...session, title: "新对话", messages: [], draft: "", updatedAt: new Date().toISOString() } : session) } };
        }
        const sessions = item.chat.sessions.filter((session) => session.id !== sessionId);
        return { ...item, chat: { sessions, activeSessionId: item.chat.activeSessionId === sessionId ? sessions[0].id : item.chat.activeSessionId } };
      }) })) })) }));
    },
    branchChatSession(outlineId, messageId) {
      const target = dataRef.current.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((item) => item.id === outlineId);
      const active = target?.chat.sessions.find((session) => session.id === target.chat.activeSessionId);
      const index = active?.messages.findIndex((message) => message.id === messageId) ?? -1;
      if (!target || !active || index < 0) return null;
      const id = makeId("chat");
      const createdAt = new Date().toISOString();
      const messages = active.messages.slice(0, index + 1).map((message) => ({ ...message, id: makeId("message") }));
      const session: ChatSession = { ...active, id, title: `分支 · ${active.title}`.slice(0, 48), messages, draft: "", lastReadMessageId: messages.filter((message) => message.role === "assistant").at(-1)?.id ?? null, createdAt, updatedAt: createdAt };
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, chat: { sessions: [session, ...item.chat.sessions], activeSessionId: id } } : item) })) })) }));
      return id;
    },
    setChatDraft(outlineId, draft, sessionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, chat: { ...item.chat, sessions: item.chat.sessions.map((session) => session.id === (sessionId ?? item.chat.activeSessionId) ? { ...session, draft } : session) } } : item) })) })) }));
    },
    setChatSetting(outlineId, key, settingValue) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, chat: { ...item.chat, sessions: item.chat.sessions.map((session) => session.id === item.chat.activeSessionId ? { ...session, [key]: settingValue, updatedAt: new Date().toISOString() } : session) } } : item) })) })) }));
    },
    addChatMessage(outlineId, message, sessionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, chat: { ...item.chat, sessions: item.chat.sessions.map((session) => session.id === (sessionId ?? item.chat.activeSessionId) ? { ...session, messages: [...session.messages, message], updatedAt: message.createdAt } : session) } } : item) })) })) }));
    },
    replaceChatMessages(outlineId, messages, sessionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, chat: { ...item.chat, sessions: item.chat.sessions.map((session) => session.id === (sessionId ?? item.chat.activeSessionId) ? { ...session, messages, updatedAt: new Date().toISOString() } : session) } } : item) })) })) }));
    },
    markChatSessionRead(outlineId, sessionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        const sessions = item.chat.sessions.map((session) => {
          if (session.id !== sessionId) return session;
          const latestAssistantId = session.messages.filter((message) => message.role === "assistant").at(-1)?.id ?? null;
          return session.lastReadMessageId === latestAssistantId ? session : { ...session, lastReadMessageId: latestAssistantId };
        });
        return { ...item, chat: { ...item.chat, sessions } };
      }) })) })) }));
    },
    clearChat(outlineId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, chat: { ...item.chat, sessions: item.chat.sessions.map((session) => session.id === item.chat.activeSessionId ? { ...session, messages: [], draft: "", updatedAt: new Date().toISOString() } : session) } } : item) })) })) }));
    },
    addTask(task) {
      if (dataRef.current.tasks.length >= 20 && !dataRef.current.tasks.some((item) => ["success", "failed", "cancelled"].includes(item.state))) return null;
      const id = makeId("task");
      setData((current) => {
        const tasks = [{ ...task, id, state: task.state ?? "waiting", createdAt: new Date().toISOString() }, ...current.tasks];
        while (tasks.length > 20) {
          const removable = tasks.map((item, index) => ({ item, index })).reverse().find(({ item }) => ["success", "failed", "cancelled"].includes(item.state));
          if (!removable) break;
          tasks.splice(removable.index, 1);
        }
        return { ...current, tasks };
      });
      return id;
    },
    updateTask(taskId, patch) {
      setData((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task) }));
    },
    removeTask(taskId) {
      setData((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== taskId) }));
    },
    clearCompletedTasks() {
      setData((current) => ({ ...current, tasks: current.tasks.filter((task) => task.state !== "success") }));
    },
    updateSettings(patch) {
      setData((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
    },
    addCharacter(character) {
      const id = makeId("character");
      let result = id;
      setData((current) => ({ ...current, articles: current.articles.map((article) => {
        if (article.id !== current.currentArticleId) return article;
        const existing = article.characters.find((item) => item.name.toLocaleLowerCase() === character.name.toLocaleLowerCase());
        if (existing) { result = existing.id; return article; }
        return { ...article, characters: [...article.characters, { ...character, id }] };
      }) }));
      return result;
    },
    updateCharacter(characterId, patch) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => article.id === current.currentArticleId ? { ...article, characters: article.characters.map((character) => character.id === characterId ? { ...character, ...patch } : character) } : article) }));
    },
    deleteCharacter(characterId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => article.id === current.currentArticleId ? { ...article, characters: article.characters.filter((character) => character.id !== characterId), relationships: article.relationships.filter((relationship) => relationship.characterAId !== characterId && relationship.characterBId !== characterId) } : article) }));
    },
    addRelationship(relationship) {
      const id = makeId("relationship");
      let result = id;
      const [characterAId, characterBId] = [relationship.characterAId, relationship.characterBId].sort();
      setData((current) => ({ ...current, articles: current.articles.map((article) => {
        if (article.id !== current.currentArticleId || characterAId === characterBId) return article;
        const existing = article.relationships.find((item) => [item.characterAId, item.characterBId].sort().join(":") === `${characterAId}:${characterBId}`);
        if (existing) { result = existing.id; return article; }
        return { ...article, relationships: [...article.relationships, { ...relationship, id, characterAId, characterBId }] };
      }) }));
      return result;
    },
    updateRelationship(relationshipId, patch) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => article.id === current.currentArticleId ? { ...article, relationships: article.relationships.map((relationship) => relationship.id === relationshipId ? { ...relationship, ...patch } : relationship) } : article) }));
    },
    deleteRelationship(relationshipId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => article.id === current.currentArticleId ? { ...article, relationships: article.relationships.filter((relationship) => relationship.id !== relationshipId) } : article) }));
    },
    async clearBusinessData() {
      try {
        const response = await fetch("/api/database/business-data", { method: "DELETE" });
        const payload = await response.json() as { revision?: number; error?: string };
        if (!response.ok || payload.revision === undefined) throw new Error(payload.error || "清除失败");
        saveEpochRef.current += 1;
        revisionRef.current = payload.revision;
        const cleared = emptyStudioData(dataRef.current.settings);
        dataRef.current = cleared;
        lastSavedRef.current = JSON.stringify(cleared);
        setData(cleared);
        setConflict(null);
        setSaveStatus("saved");
        for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
          const key = window.sessionStorage.key(index);
          if (key?.startsWith(draftPrefix)) window.sessionStorage.removeItem(key);
        }
        return true;
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "清除失败");
        setSaveStatus("failed");
        return false;
      }
    },
    refreshFromServer,
    saveNow() {
      return enqueueSave(dataRef.current);
    },
    retrySave() {
      return enqueueSave(dataRef.current);
    },
    async resolveConflict(choice) {
      if (!conflict) return;
      if (choice === "use-server") {
        let server = conflict.server;
        let serverRevision = conflict.serverRevision;
        try {
          const response = await fetch("/api/state", { cache: "no-store" });
          const payload = await response.json() as { data?: StudioData | null; revision?: number };
          if (response.ok && payload.data && payload.revision !== undefined) {
            server = payload.data;
            serverRevision = payload.revision;
          }
        } catch { /* The conflict response is still a valid database snapshot. */ }
        revisionRef.current = serverRevision;
        lastSavedRef.current = JSON.stringify(server);
        dataRef.current = server;
        setData(server);
        setConflict(null);
        setSaveStatus("saved");
        return;
      }
      revisionRef.current = conflict.serverRevision;
      await enqueueSave(conflict.local, true);
    },
  }), [data, hydrated, saveStatus, saveError, conflict, currentArticle, currentChapter, currentOutline, enqueueSave, refreshFromServer, setData]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used inside StudioProvider");
  return context;
}

export function chatSessionHasUnread(session: ChatSession) {
  const latestAssistantId = session.messages.filter((message) => message.role === "assistant").at(-1)?.id;
  return Boolean(latestAssistantId && latestAssistantId !== session.lastReadMessageId);
}

export function wordCount(text: string) {
  const chinese = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
  return chinese + latin;
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
