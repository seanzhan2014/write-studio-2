"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GENERATE_TARGET_WORDS, normalizeContentGenerationMode, normalizeGeneratePresets, normalizeGenerateTargetWords, normalizeRewriteRetentionLevel, type ContentGenerationMode, type RewriteRetentionLevel } from "@/lib/generate-options";
import { resolvedOutlineContentName, timestampContentName } from "@/lib/content-name.mjs";
import { cloneExcellentFragments, normalizeExcellentFragments, reanchorExcellentFragments, toggleExcellentFragment, type ExcellentFragment } from "@/lib/excellent-fragments.mjs";
import { currentOutlineVersion, resolvedOutlineContent, resolvedOutlineSnapshot } from "@/lib/outline-content";
import { normalizeOutlineTitle } from "@/lib/outline-title";
import { normalizeReviewPresets } from "@/lib/review-options";
import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile, type NamingProfile } from "@/lib/naming-options";
import type { SelectedAiContext } from "@/lib/ai-context";
import type { NamingArticleContext } from "@/db/ai";
import { appendNameVersion, normalizeNameVersionState, type NameVersion } from "@/lib/name-versions";
import { diffStudioData, isStudioChangesEmpty } from "@/lib/studio-changes";
import { durableStudioData, mergeStudioConflict, resolveStudioConflict, stableStudioStringify, type StudioConflictDetail } from "./studio-conflict.mjs";
import { moveOutlineBetweenChapters, moveOutlineToChapterEnd } from "./outline-order.mjs";
import { duplicateArticlesForImport, duplicateOutlineForImport } from "@/lib/data-transfer";

type OutlinePlacement = "before" | "after";
type NameEntityKind = "chapter" | "outline";

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
  manualExcellent?: boolean;
  excellentFragments?: ExcellentFragment[];
};

export type Outline = {
  id: string;
  title: string;
  titleGenerationPending: boolean;
  plan: string;
  generateInstruction: string;
  content: string;
  contentName?: string;
  currentVersionId: string | null;
  defaultVersionId: string | null;
  contentOutlineSnapshot?: {
    title: string;
    plan: string;
  };
  /** Legacy import-only fields. */
  contentOverride?: boolean;
  archived: boolean;
  state: "saved" | "running" | "failed";
  updatedAt: string;
  nameVersions?: NameVersion[];
  defaultNameVersionId?: string | null;
  sourceVersionId?: string;
  manualExcellent?: boolean;
  excellentFragments?: ExcellentFragment[];
  versions: Version[];
  chat: {
    sessions: ChatSession[];
    activeSessionId: string;
  };
};

export type Chapter = {
  id: string;
  title: string;
  nameVersions?: NameVersion[];
  defaultNameVersionId?: string | null;
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
  chapterNaming: NamingProfile;
  outlineNaming: NamingProfile;
  createdAt: string;
  updatedAt: string;
  lastOutlineId: string;
  chapters: Chapter[];
  characters: Character[];
  relationships: Relationship[];
};

export type TaskExecutionOrigin = "local" | "cloud";

export type AiTask = {
  id: string;
  articleId: string;
  chapterId: string;
  outlineId: string;
  target: "正文" | "大纲" | "章节标题" | "全部名称" | "AI Chat";
  prompt: string;
  model: string;
  executionOrigin: TaskExecutionOrigin;
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
    rewriteRetention?: RewriteRetentionLevel;
    outlinePlanSnapshot?: string;
    outlineTitleSnapshot?: string;
    configuredModelId?: string;
    modelId?: string;
    modelName?: string;
    generatedOutlineTitle?: string;
    generatedOutlineTitleError?: string;
    includeOutlineTitle?: boolean;
    chapterNamingSnapshot?: NamingProfile;
    outlineNamingSnapshot?: NamingProfile;
    nameChapterCount?: number;
    nameOutlineCount?: number;
    generatedNameCount?: number;
    sessionId?: string;
    firstAppearanceCharacterIds?: string[];
    includeExcellentFragments?: boolean;
    excellentFragmentIds?: string[];
    promptContext?: SelectedAiContext;
    namingContext?: NamingArticleContext;
  };
};

export type { ExcellentFragment };

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
  namingModelMode: "inherit" | "fixed";
  namingModel: string;
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
  return { id, title, titleGenerationPending: !normalizeOutlineTitle(title), plan, generateInstruction: "", content, contentName: timestampContentName(now), currentVersionId: null, defaultVersionId: null, contentOutlineSnapshot: { title, plan }, state, archived: false, updatedAt: now, excellentFragments: [], versions: [], chat: emptyChat(id) };
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
      chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE,
      outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE,
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
      chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE,
      outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE,
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
      chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE,
      outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE,
      createdAt: "2026-05-18T09:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
      lastOutlineId: "summer-outline-1",
      chapters: [{ id: "summer-chapter-1", title: "第一章 · 六月", archived: false, outlines: [outline("summer-outline-1", "蝉鸣开始的那天", "主角在暑假第一天收到一台旧相机。", "蝉鸣从铁路另一边传来时，邮差把那只没有寄件人的纸箱放在门口。")]}],
      characters: [],
      relationships: [],
    },
  ],
  tasks: [
    { id: "task-demo", articleId: "harbor-letters", chapterId: "chapter-1", outlineId: "outline-2", target: "正文", prompt: "延续悬疑氛围，让林澈和顾屿在旧码头重逢", model: "创作主模型", executionOrigin: "local", state: "cancelled", createdAt: "2026-07-28T14:31:00.000Z", error: "演示任务，不会自动执行" },
    { id: "task-failed", articleId: "harbor-letters", chapterId: "chapter-2", outlineId: "outline-5", target: "正文", prompt: "让海图显示出不存在的航线", model: "创作主模型", executionOrigin: "local", state: "failed", createdAt: "2026-07-28T13:50:00.000Z", error: "模拟服务暂时不可用" },
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
    chatModel: "",
    generateModel: "",
    namingModelMode: "inherit",
    namingModel: "",
    reviewModel: "",
    generateTargetWords: DEFAULT_GENERATE_TARGET_WORDS,
    generatePresets: [],
    reviewPresets: [],
  },
};

type StudioContextValue = {
  data: StudioData;
  executionOrigin: TaskExecutionOrigin;
  hydrated: boolean;
  saveStatus: "loading" | "saved" | "unsaved" | "saving" | "failed" | "conflict";
  saveError: string;
  conflict: { base: StudioData; local: StudioData; server: StudioData; serverRevision: number; details: StudioConflictDetail[] } | null;
  currentArticle: Article;
  currentChapter: Chapter;
  currentOutline: Outline;
  setCurrentArticle: (articleId: string) => void;
  setCurrentOutline: (outlineId: string) => void;
  createArticle: (fields: Pick<Article, "title" | "summary" | "type" | "style">) => string;
  updateArticle: (patch: Partial<Pick<Article, "title" | "summary" | "type" | "style" | "chapterNaming" | "outlineNaming">>) => void;
  deleteArticle: (articleId: string) => void;
  createChapter: (title?: string) => string;
  updateChapter: (chapterId: string, patch: Partial<Pick<Chapter, "title" | "archived">>) => void;
  applyGeneratedNames: (chapterId: string, chapterTitle: string | undefined, outlineTitles: Array<{ id: string; title: string }>) => void;
  addGeneratedNameCandidates: (chapterId: string, chapterTitle: string | undefined, outlineTitles: Array<{ id: string; title: string }>, metadata?: { model?: string; instruction?: string }) => number;
  addManualNameVersion: (kind: NameEntityKind, entityId: string, title: string, makeDefault?: boolean) => string | null;
  setDefaultNameVersion: (kind: NameEntityKind, entityId: string, versionId: string) => void;
  deleteNameVersion: (kind: NameEntityKind, entityId: string, versionId: string) => boolean;
  moveChapter: (chapterId: string, direction: -1 | 1) => void;
  deleteChapter: (chapterId: string) => void;
  createOutline: (chapterId?: string, afterId?: string) => string;
  updateOutline: (outlineId: string, patch: Partial<Pick<Outline, "title" | "titleGenerationPending" | "plan" | "content" | "contentName" | "currentVersionId" | "defaultVersionId" | "contentOutlineSnapshot" | "archived" | "state">>) => void;
  saveOutlinePlan: (outlineId: string, plan: string) => Promise<boolean>;
  stageContentDraft: (outlineId: string, text: string) => void;
  clearContentDraft: (outlineId: string) => void;
  saveCurrentContent: (outlineId: string, text: string, sourceVersionId?: string) => Promise<boolean>;
  commitContentEdit: (outlineId: string, text: string) => Promise<boolean>;
  preserveContentDraft: (outlineId: string, text: string, savedAt?: string) => Promise<boolean>;
  moveOutline: (sourceId: string, targetId: string, placement: OutlinePlacement) => void;
  moveOutlineToChapter: (outlineId: string, chapterId: string) => void;
  copyOutline: (outlineId: string) => string | null;
  importOutline: (chapterId: string, outline: Outline, afterId?: string) => string | null;
  importArticles: (articles: Article[], tasks?: AiTask[]) => string[];
  importSettings: (settings: StudioSettings) => void;
  deleteOutline: (outlineId: string) => void;
  saveVersion: (outlineId: string, name?: string, source?: Version["source"], content?: string, metadata?: Pick<Version, "model" | "modelId" | "prompt" | "taskId" | "outlineSnapshot" | "manualExcellent" | "excellentFragments">) => string;
  toggleExcellentFragment: (outlineId: string, versionId: string | undefined, start: number, end: number) => "added" | "removed" | "none";
  setBodyExcellent: (outlineId: string, versionId: string | undefined, excellent: boolean) => void;
  setCurrentVersion: (outlineId: string, versionId: string) => void;
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
  addTask: (task: Omit<AiTask, "id" | "createdAt" | "state"> & { id?: string; createdAt?: string; state?: AiTask["state"] }) => string | null;
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
  acceptServerMutation: (revision: number, update: (current: StudioData) => StudioData) => void;
  refreshFromServer: () => Promise<boolean>;
  saveNow: () => Promise<boolean>;
  retrySave: () => Promise<boolean>;
  resolveConflict: (choice: "keep-local" | "use-server") => Promise<void>;
};

const StudioContext = createContext<StudioContextValue | null>(null);
const legacyStorageKey = "writer-studio-poc-v2";
const deviceUiStorageKey = "writer-studio:device-ui-v1";
const draftPrefix = "writer-studio:draft:";
const saveRequestTimeoutMs = 45_000;

async function triggerBackgroundCloudUpload() {
  try {
    await fetch("/api/sync/upload", { method: "POST", keepalive: true });
  } catch { /* Local saves remain authoritative while the cloud is unavailable. */ }
  window.dispatchEvent(new Event("writer-studio-sync-status"));
}

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

type DeviceUiState = {
  currentArticleId?: string;
  currentOutlineId?: string;
  lastOutlineByArticle?: Record<string, string>;
  activeSessionByOutline?: Record<string, string>;
  chatDraftBySession?: Record<string, string>;
  lastReadBySession?: Record<string, string | null>;
  chatOptionsBySession?: Record<string, { includePrevious: boolean; includeCharacters: boolean }>;
  settings?: Pick<StudioSettings, "theme" | "editorFont" | "fontSize" | "lineHeight" | "contentWidth" | "outlineExpanded" | "showArchived" | "openLastArticle">;
};

function deviceUiFromData(data: StudioData): DeviceUiState {
  const result: DeviceUiState = {
    currentArticleId: data.currentArticleId,
    currentOutlineId: data.currentOutlineId,
    lastOutlineByArticle: {},
    activeSessionByOutline: {},
    chatDraftBySession: {},
    lastReadBySession: {},
    chatOptionsBySession: {},
    settings: {
      theme: data.settings.theme,
      editorFont: data.settings.editorFont,
      fontSize: data.settings.fontSize,
      lineHeight: data.settings.lineHeight,
      contentWidth: data.settings.contentWidth,
      outlineExpanded: data.settings.outlineExpanded,
      showArchived: data.settings.showArchived,
      openLastArticle: data.settings.openLastArticle,
    },
  };
  for (const article of data.articles) {
    result.lastOutlineByArticle![article.id] = article.lastOutlineId;
    for (const chapter of article.chapters) for (const outline of chapter.outlines) {
      result.activeSessionByOutline![outline.id] = outline.chat.activeSessionId;
      for (const session of outline.chat.sessions) {
        if (session.draft) result.chatDraftBySession![session.id] = session.draft;
        result.lastReadBySession![session.id] = session.lastReadMessageId ?? null;
        result.chatOptionsBySession![session.id] = { includePrevious: session.includePrevious, includeCharacters: session.includeCharacters };
      }
    }
  }
  return result;
}

function readDeviceUi(): DeviceUiState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(deviceUiStorageKey) ?? "{}") as DeviceUiState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function deviceUiForCurrentPath(source: DeviceUiState, data: StudioData): DeviceUiState {
  const ui = structuredClone(source);
  const articleId = window.location.pathname.match(/\/articles\/([^/]+)/)?.[1];
  const outlineId = window.location.pathname.match(/\/outlines\/([^/]+)/)?.[1];
  const chapterId = window.location.pathname.match(/\/chapters\/([^/]+)/)?.[1];
  const outlineOwner = outlineId
    ? data.articles.find((article) => article.chapters.some((chapter) => chapter.outlines.some((outline) => outline.id === outlineId)))
    : undefined;
  const chapterOwner = !outlineOwner && chapterId
    ? data.articles.find((article) => article.chapters.some((chapter) => chapter.id === chapterId))
    : undefined;
  const article = outlineOwner ?? chapterOwner ?? data.articles.find((item) => item.id === articleId);
  const requestedOutlineId = outlineOwner
    ? outlineId
    : chapterOwner?.chapters.find((chapter) => chapter.id === chapterId)?.outlines[0]?.id;
  if (article) ui.currentArticleId = article.id;
  if (article && requestedOutlineId) {
    ui.currentOutlineId = requestedOutlineId;
    ui.lastOutlineByArticle = { ...(ui.lastOutlineByArticle ?? {}), [article.id]: requestedOutlineId };
  }
  return ui;
}

function applyDeviceUi(source: StudioData, ui: DeviceUiState): StudioData {
  const data = structuredClone(source);
  if (ui.settings) data.settings = { ...data.settings, ...ui.settings };
  for (const article of data.articles) {
    const outlineIds = new Set(article.chapters.flatMap((chapter) => chapter.outlines.map((outline) => outline.id)));
    const requested = ui.lastOutlineByArticle?.[article.id];
    article.lastOutlineId = requested && outlineIds.has(requested) ? requested : firstOutline(article);
    for (const chapter of article.chapters) for (const outline of chapter.outlines) {
      const sessionIds = new Set(outline.chat.sessions.map((session) => session.id));
      const activeSessionId = ui.activeSessionByOutline?.[outline.id];
      outline.chat.activeSessionId = activeSessionId && sessionIds.has(activeSessionId) ? activeSessionId : outline.chat.sessions[0]?.id ?? "";
      for (const session of outline.chat.sessions) {
        session.draft = ui.chatDraftBySession?.[session.id] ?? "";
        session.lastReadMessageId = Object.prototype.hasOwnProperty.call(ui.lastReadBySession ?? {}, session.id)
          ? ui.lastReadBySession?.[session.id] ?? null
          : null;
        const options = ui.chatOptionsBySession?.[session.id];
        if (options) {
          session.includePrevious = options.includePrevious;
          session.includeCharacters = options.includeCharacters;
        }
      }
    }
  }
  const requestedArticle = data.articles.find((article) => article.id === ui.currentArticleId);
  const requestedOutlineOwner = data.articles.find((article) => article.chapters.some((chapter) => chapter.outlines.some((outline) => outline.id === ui.currentOutlineId)));
  const article = requestedArticle ?? requestedOutlineOwner ?? data.articles[0];
  data.currentArticleId = article?.id ?? "";
  const articleOutlineIds = new Set(article?.chapters.flatMap((chapter) => chapter.outlines.map((outline) => outline.id)) ?? []);
  data.currentOutlineId = ui.currentOutlineId && articleOutlineIds.has(ui.currentOutlineId)
    ? ui.currentOutlineId
    : article?.lastOutlineId ?? "";
  return data;
}

function durableSnapshot(data: StudioData) {
  return durableStudioData(data);
}

function serializeDurable(data: StudioData) {
  return stableStudioStringify(durableSnapshot(data));
}

function activeExcellentFragments(outline: Outline) {
  const version = currentOutlineVersion(outline);
  return version
    ? normalizeExcellentFragments(version.content, version.excellentFragments)
    : normalizeExcellentFragments(outline.content, outline.excellentFragments);
}

function activeManualExcellent(outline: Outline) {
  return currentOutlineVersion(outline)?.manualExcellent === true || (!outline.currentVersionId && outline.manualExcellent === true);
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
  const contentMode = task.target === "正文" ? normalizeContentGenerationMode(task.contextOptions?.contentMode) : undefined;
  return {
    ...task,
    executionOrigin: task.executionOrigin === "cloud" ? "cloud" : "local",
    contextOptions: task.contextOptions ? {
      ...task.contextOptions,
      ...(task.target === "正文" ? { contentMode, rewriteRetention: contentMode === "rewrite" ? normalizeRewriteRetentionLevel(task.contextOptions.rewriteRetention) : undefined } : {}),
      firstAppearanceCharacterIds: Array.isArray(task.contextOptions.firstAppearanceCharacterIds)
        ? [...new Set(task.contextOptions.firstAppearanceCharacterIds.map(String))].slice(0, 200)
        : undefined,
      includeExcellentFragments: task.contextOptions.includeExcellentFragments === true,
      excellentFragmentIds: Array.isArray(task.contextOptions.excellentFragmentIds)
        ? [...new Set(task.contextOptions.excellentFragmentIds.map(String))].slice(0, 200)
        : undefined,
    } : task.contextOptions,
    phase,
    attempt: Math.max(0, Number(task.attempt ?? 0)),
    receivedCharacters: Math.max(0, Number(task.receivedCharacters ?? task.resultText?.length ?? 0)),
  };
}

const emptyChapter: Chapter = { id: "", title: "", archived: false, outlines: [] };
const emptyOutline: Outline = { id: "", title: "", titleGenerationPending: false, plan: "", generateInstruction: "", content: "", contentName: timestampContentName(now), currentVersionId: null, defaultVersionId: null, contentOutlineSnapshot: { title: "", plan: "" }, archived: false, state: "saved", updatedAt: now, excellentFragments: [], versions: [], chat: emptyChat("empty") };
const emptyArticle: Article = { id: "", title: "", summary: "", type: "", style: "", chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE, outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE, createdAt: now, updatedAt: now, lastOutlineId: "", chapters: [], characters: [], relationships: [] };

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
      namingModelMode: source.settings?.namingModelMode === "fixed" ? "fixed" : "inherit",
      namingModel: String(source.settings?.namingModel ?? ""),
      generateTargetWords: normalizeGenerateTargetWords(source.settings?.generateTargetWords),
      generatePresets: normalizeGeneratePresets(source.settings?.generatePresets),
      reviewPresets: normalizeReviewPresets(source.settings?.reviewPresets),
    },
    articles: source.articles.map((article) => ({
      ...article,
      chapterNaming: normalizeNamingProfile(article.chapterNaming, DEFAULT_CHAPTER_NAMING_PROFILE),
      outlineNaming: normalizeNamingProfile(article.outlineNaming, DEFAULT_OUTLINE_NAMING_PROFILE),
      characters: (article.characters ?? []).map(normalizeCharacter),
      chapters: article.chapters.map((chapter) => {
        const chapterNameState = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
        return {
        ...chapter,
        ...chapterNameState,
        outlines: chapter.outlines.map((item) => {
          const normalizedTitle = normalizeOutlineTitle(item.title);
          const outlineNameState = normalizeNameVersionState(item.id, normalizedTitle, item.nameVersions, item.defaultNameVersionId, item.updatedAt, 80);
          const versions = (item.versions ?? []).map((version) => ({ ...version, manualExcellent: version.manualExcellent === true, excellentFragments: normalizeExcellentFragments(version.content, version.excellentFragments) }));
          const validVersionId = (value: unknown) => typeof value === "string" && versions.some((version) => version.id === value) ? value : null;
          const legacyDefaultVersionId = validVersionId(item.sourceVersionId);
          const defaultVersionId = Object.prototype.hasOwnProperty.call(item, "defaultVersionId")
            ? validVersionId(item.defaultVersionId)
            : legacyDefaultVersionId;
          const currentVersionId = Object.prototype.hasOwnProperty.call(item, "currentVersionId")
            ? validVersionId(item.currentVersionId)
            : item.contentOverride === false
              ? legacyDefaultVersionId
              : null;
          const legacySourceSnapshot = item.contentOverride === true && legacyDefaultVersionId
            ? versions.find((version) => version.id === legacyDefaultVersionId)?.outlineSnapshot
            : undefined;
          const { contentOverride: _legacyContentOverride, sourceVersionId: _legacySourceVersionId, ...currentItem } = item;
          const normalizedItem = {
            ...currentItem,
            ...outlineNameState,
            title: normalizedTitle,
            generateInstruction: String(item.generateInstruction ?? "").slice(0, 20000),
            contentName: item.contentName?.trim() || timestampContentName(item.updatedAt),
            currentVersionId,
            defaultVersionId,
            contentOutlineSnapshot: item.contentOutlineSnapshot ?? legacySourceSnapshot ?? { title: normalizedTitle, plan: item.plan },
            manualExcellent: item.manualExcellent === true,
            titleGenerationPending: item.titleGenerationPending ?? !normalizedTitle,
            excellentFragments: normalizeExcellentFragments(item.content, item.excellentFragments),
            versions,
          };
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
      };
      }),
    })),
  };
}

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [data, setDataState] = useState<StudioData>(() => normalizeStudioData(seedData));
  const [executionOrigin, setExecutionOrigin] = useState<TaskExecutionOrigin>("local");
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
  const pendingLegacyMigrationRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);

  const setData = useCallback((update: StudioData | ((current: StudioData) => StudioData)) => {
    const next = typeof update === "function" ? update(dataRef.current) : update;
    // dataRef is the source for sequential mutations. Sync it here, rather than
    // from a later React effect that could roll rapid streaming updates backward.
    dataRef.current = next;
    setDataState(next);
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error(`数据库加载失败（${response.status}）`);
        const payload = await response.json() as { data: StudioData | null; revision: number; executionOrigin?: TaskExecutionOrigin };
        const databaseData = normalizeStudioData(payload.data ?? emptyStudioData(seedData.settings));
        let loaded = databaseData;
        let migratedLegacy = false;
        revisionRef.current = payload.revision;
        setExecutionOrigin(payload.executionOrigin === "cloud" ? "cloud" : "local");
        if (loaded.articles.length === 0 && payload.revision === 0) {
          const legacy = window.localStorage.getItem(legacyStorageKey);
          if (legacy) {
            try {
              const parsed = JSON.parse(legacy) as StudioData;
              if (parsed.version === 1 && parsed.articles?.length) {
                loaded = normalizeStudioData(parsed);
                migratedLegacy = true;
              }
            } catch { /* Invalid legacy data is ignored during one-time migration. */ }
          }
        }
        const databaseSnapshot = serializeDurable(databaseData);
        const deviceUi = deviceUiForCurrentPath(migratedLegacy ? deviceUiFromData(loaded) : readDeviceUi(), loaded);
        loaded = applyDeviceUi(loaded, deviceUi);
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
              const version: Version = { id: makeId("version"), name: `未保存内容 · ${new Date(createdAt).toLocaleString("zh-CN")}`, content: draft.text, source: "未保存内容", createdAt, outlineSnapshot: { title: outline.title, plan: outline.plan }, manualExcellent: activeManualExcellent(outline), excellentFragments: cloneExcellentFragments(draft.text, reanchorExcellentFragments(resolvedOutlineContent(outline), draft.text, activeExcellentFragments(outline))) };
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
        pendingLegacyMigrationRef.current = migratedLegacy;
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

  const persist = useCallback(async function persistSnapshot(snapshot: StudioData, epoch = saveEpochRef.current, rebaseAttempt = 0): Promise<boolean> {
    if (epoch !== saveEpochRef.current) return false;
    const durable = durableSnapshot(snapshot);
    const serialized = stableStudioStringify(durable);
    if (serialized === lastSavedRef.current) return true;
    let base: StudioData;
    try {
      base = lastSavedRef.current ? normalizeStudioData(JSON.parse(lastSavedRef.current) as StudioData) : durable;
    } catch {
      base = durable;
    }
    const changes = diffStudioData(base, durable);
    if (isStudioChangesEmpty(changes)) {
      lastSavedRef.current = serialized;
      return true;
    }
    setSaveStatus("saving");
    setSaveError("");
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort("save-timeout"), saveRequestTimeoutMs);
    try {
      const response = await fetch("/api/state/mutations", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "If-Match": String(revisionRef.current) },
        body: JSON.stringify({ changes }),
      });
      const payload = await response.json() as { revision?: number; data?: StudioData; message?: string };
      if (response.status === 409) {
        if (!payload.data) {
          const currentResponse = await fetch("/api/state", { cache: "no-store" });
          const currentPayload = await currentResponse.json() as { revision?: number; data?: StudioData | null };
          if (currentResponse.ok && currentPayload.data && currentPayload.revision !== undefined) {
            payload.data = currentPayload.data;
            payload.revision = currentPayload.revision;
          }
        }
        if (!payload.data) throw new Error(payload.message || "保存冲突，无法读取服务端状态");
        if (rebaseAttempt < 3 && lastSavedRef.current) {
          try {
            const server = durableSnapshot(normalizeStudioData(payload.data));
            const latestUi = deviceUiFromData(dataRef.current);
            const latestLocal = durableSnapshot(dataRef.current);
            const result = mergeStudioConflict(base, latestLocal, server);
            if (!result.conflicts.length) {
              saveEpochRef.current += 1;
              const rebasedEpoch = saveEpochRef.current;
              revisionRef.current = Number(payload.revision ?? revisionRef.current);
              lastSavedRef.current = stableStudioStringify(server);
              const merged = applyDeviceUi(result.merged, latestUi);
              dataRef.current = merged;
              setData(merged);
              return persistSnapshot(merged, rebasedEpoch, rebaseAttempt + 1);
            }
            saveEpochRef.current += 1;
            setConflict({ base, local: latestLocal, server, serverRevision: Number(payload.revision ?? revisionRef.current), details: result.conflicts });
            setSaveStatus("conflict");
            return false;
          } catch { /* A malformed base snapshot falls through to explicit resolution. */ }
        }
        saveEpochRef.current += 1;
        const server = durableSnapshot(normalizeStudioData(payload.data));
        const base = lastSavedRef.current ? JSON.parse(lastSavedRef.current) as StudioData : server;
        const latestLocal = durableSnapshot(dataRef.current);
        const result = mergeStudioConflict(base, latestLocal, server);
        setConflict({ base, local: latestLocal, server, serverRevision: Number(payload.revision ?? revisionRef.current), details: result.conflicts });
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
      if (pendingLegacyMigrationRef.current) {
        window.localStorage.removeItem(legacyStorageKey);
        pendingLegacyMigrationRef.current = false;
      }
      return true;
    } catch (error) {
      setSaveError(controller.signal.reason === "save-timeout" ? "保存超时，请检查网络后重试" : error instanceof Error ? error.message : "保存失败");
      setSaveStatus("failed");
      return false;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }, [setData]);

  const enqueueSave = useCallback((snapshot: StudioData) => {
    const epoch = saveEpochRef.current;
    saveQueueRef.current = saveQueueRef.current.then(() => persist(snapshot, epoch), () => persist(snapshot, epoch));
    return saveQueueRef.current;
  }, [persist]);

  const refreshFromServer = useCallback(async () => {
    if (!hydrated || conflict || serializeDurable(dataRef.current) !== lastSavedRef.current) return false;
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const requestedSnapshot = lastSavedRef.current;
    const request = (async () => {
      try {
        const response = await fetch("/api/state", {
          cache: "no-store",
          headers: { "If-None-Match": `"writer-studio-state-${revisionRef.current}"` },
        });
        if (response.status === 304) return true;
        const payload = await response.json() as { data?: StudioData | null; revision?: number; executionOrigin?: TaskExecutionOrigin };
        if (!response.ok || !payload.data || payload.revision === undefined) return false;
        setExecutionOrigin(payload.executionOrigin === "cloud" ? "cloud" : "local");
        if (serializeDurable(dataRef.current) !== requestedSnapshot || lastSavedRef.current !== requestedSnapshot) return false;
        const server = durableSnapshot(normalizeStudioData(payload.data));
        const serialized = stableStudioStringify(server);
        revisionRef.current = payload.revision;
        if (serialized !== lastSavedRef.current) {
          const withDeviceUi = applyDeviceUi(server, deviceUiFromData(dataRef.current));
          dataRef.current = withDeviceUi;
          lastSavedRef.current = serialized;
          setData(withDeviceUi);
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
    const serialized = serializeDurable(data);
    if (serialized === lastSavedRef.current) return;
    setSaveStatus("unsaved");
    const timer = window.setTimeout(() => { void enqueueSave(data); }, 800);
    return () => window.clearTimeout(timer);
  }, [data, hydrated, conflict, enqueueSave]);

  useEffect(() => {
    const hasActiveTasks = data.tasks.some((task) => task.state === "waiting" || task.state === "running");
    if (!hydrated || saveStatus !== "saved" || hasActiveTasks) return;
    const timer = window.setTimeout(() => { void triggerBackgroundCloudUpload(); }, 5_000);
    return () => window.clearTimeout(timer);
  }, [data.tasks, hydrated, saveStatus]);

  useEffect(() => {
    if (!hydrated) return;
    const uploadWhenOnline = () => {
      if (!dataRef.current.tasks.some((task) => task.state === "waiting" || task.state === "running")) void triggerBackgroundCloudUpload();
    };
    window.addEventListener("online", uploadWhenOnline);
    return () => window.removeEventListener("online", uploadWhenOnline);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(deviceUiStorageKey, JSON.stringify(deviceUiFromData(data)));
    } catch { /* Device-local UI state is an optional convenience. */ }
  }, [data, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const onHidden = () => { if (document.visibilityState === "hidden") void enqueueSave(dataRef.current); };
    const onPageHide = () => { void enqueueSave(dataRef.current); };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => { document.removeEventListener("visibilitychange", onHidden); window.removeEventListener("pagehide", onPageHide); };
  }, [hydrated, enqueueSave]);

  const currentArticle = data.articles.find((article) => article.id === data.currentArticleId) ?? data.articles[0] ?? emptyArticle;
  const currentPair = currentArticle.id ? findOutlineInArticle(currentArticle, data.currentOutlineId) ?? findOutlineInArticle(currentArticle, firstOutline(currentArticle)) : null;
  const currentChapter = currentPair?.chapter ?? currentArticle.chapters[0] ?? emptyChapter;
  const currentOutline = currentPair?.outline ?? currentChapter?.outlines[0] ?? emptyOutline;

  const acceptServerMutation = useCallback((revision: number, update: (current: StudioData) => StudioData) => {
    if (revision < revisionRef.current) return;
    const nextLocal = update(dataRef.current);
    let base: StudioData;
    try {
      base = lastSavedRef.current
        ? normalizeStudioData(JSON.parse(lastSavedRef.current) as StudioData)
        : durableSnapshot(dataRef.current);
    } catch {
      base = durableSnapshot(dataRef.current);
    }
    const nextBase = durableSnapshot(update(base));
    revisionRef.current = revision;
    lastSavedRef.current = stableStudioStringify(nextBase);
    dataRef.current = nextLocal;
    setData(nextLocal);
    setConflict(null);
    setSaveStatus(serializeDurable(nextLocal) === lastSavedRef.current ? "saved" : "unsaved");
  }, [setData]);

  useEffect(() => {
    if (!hydrated) return;
    let polling = false;
    const refreshVisible = () => { if (document.visibilityState === "visible") void refreshFromServer(); };
    const timer = window.setInterval(() => {
      if (polling || document.visibilityState !== "visible" || !dataRef.current.tasks.some((task) => task.executionOrigin === executionOrigin && (task.state === "waiting" || task.state === "running"))) return;
      polling = true;
      void fetch("/api/ai/tasks", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { tasks?: AiTask[]; runningOutlineIds?: string[]; revision?: number };
          if (!response.ok || !payload.tasks || payload.revision === undefined) return;
          const activeIds = new Set(dataRef.current.tasks.filter((task) => task.state === "waiting" || task.state === "running").map((task) => task.id));
          const terminalTransition = payload.tasks.some((task) => activeIds.has(task.id) && task.state !== "waiting" && task.state !== "running");
          if (terminalTransition) await refreshFromServer();
          else {
            const runningOutlineIds = new Set(payload.runningOutlineIds ?? []);
            acceptServerMutation(payload.revision, (current) => ({
              ...current,
              tasks: payload.tasks!,
              articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((outline) => runningOutlineIds.has(outline.id) ? { ...outline, state: "running" } : outline) })) })),
            }));
          }
        })
        .catch(() => undefined)
        .finally(() => { polling = false; });
    }, 3000);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [executionOrigin, hydrated, refreshFromServer, acceptServerMutation]);

  const value = useMemo<StudioContextValue>(() => ({
    data,
    executionOrigin,
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
      setData((current) => {
        const owner = current.articles.find((article) => Boolean(findOutlineInArticle(article, outlineId)));
        if (!owner) return current;
        return {
          ...current,
          currentArticleId: owner.id,
          currentOutlineId: outlineId,
          articles: current.articles.map((article) => article.id === owner.id ? { ...article, lastOutlineId: outlineId } : article),
        };
      });
    },
    createArticle(fields) {
      const articleId = makeId("article");
      const chapterId = makeId("chapter");
      const outlineId = makeId("outline");
      const createdAt = new Date().toISOString();
      const article: Article = {
        id: articleId,
        ...fields,
        chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE,
        outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE,
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
    applyGeneratedNames(chapterId, chapterTitle, outlineTitles) {
      const generated = new Map(outlineTitles.map((item) => [item.id, normalizeOutlineTitle(item.title)]));
      const updatedAt = new Date().toISOString();
      setData((current) => ({
        ...current,
        articles: current.articles.map((article) => article.id !== current.currentArticleId ? article : {
          ...article,
          updatedAt,
          chapters: article.chapters.map((chapter) => chapter.id !== chapterId ? chapter : {
            ...chapter,
            ...(chapterTitle?.trim() ? { title: chapterTitle.trim().slice(0, 120) } : {}),
            outlines: chapter.outlines.map((outline) => {
              const title = generated.get(outline.id);
              return title ? { ...outline, title, titleGenerationPending: false, updatedAt } : outline;
            }),
          }),
        }),
      }));
    },
    addGeneratedNameCandidates(chapterId, chapterTitle, outlineTitles, metadata) {
      const generated = new Map(outlineTitles.map((item) => [item.id, normalizeOutlineTitle(item.title)]));
      const createdAt = new Date().toISOString();
      let added = 0;
      setData((current) => ({
        ...current,
        articles: current.articles.map((article) => article.id !== current.currentArticleId ? article : {
          ...article,
          updatedAt: createdAt,
          chapters: article.chapters.map((chapter) => {
            if (chapter.id !== chapterId) return chapter;
            const chapterState = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
            const chapterCandidate = chapterTitle?.trim().slice(0, 120);
            const nextChapterState = chapterCandidate
              ? appendNameVersion(chapterState, { id: makeId("name"), title: chapterCandidate, source: "ai", createdAt, ...metadata }, 120)
              : { state: chapterState, added: false };
            if (nextChapterState.added) added += 1;
            return {
              ...chapter,
              ...nextChapterState.state,
              outlines: chapter.outlines.map((outline) => {
                const candidate = generated.get(outline.id);
                if (!candidate) return outline;
                const outlineState = normalizeNameVersionState(outline.id, outline.title, outline.nameVersions, outline.defaultNameVersionId, outline.updatedAt, 80);
                const next = appendNameVersion(outlineState, { id: makeId("name"), title: candidate, source: "ai", createdAt, ...metadata }, 80);
                if (next.added) added += 1;
                return { ...outline, ...next.state };
              }),
            };
          }),
        }),
      }));
      return added;
    },
    addManualNameVersion(kind, entityId, title, makeDefault = true) {
      const normalized = kind === "outline" ? normalizeOutlineTitle(title) : title.trim().slice(0, 120);
      if (!normalized) return null;
      const createdAt = new Date().toISOString();
      let versionId: string | null = null;
      setData((current) => ({
        ...current,
        articles: current.articles.map((article) => article.id !== current.currentArticleId ? article : {
          ...article,
          updatedAt: createdAt,
          chapters: article.chapters.map((chapter) => {
            if (kind === "chapter" && chapter.id === entityId) {
              const state = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
              const next = appendNameVersion(state, { id: makeId("name"), title: normalized, source: "manual", createdAt }, 120);
              versionId = next.versionId;
              return { ...chapter, ...next.state, ...(makeDefault ? { title: normalized, defaultNameVersionId: next.versionId } : {}) };
            }
            return {
              ...chapter,
              outlines: chapter.outlines.map((outline) => {
                if (kind !== "outline" || outline.id !== entityId) return outline;
                const state = normalizeNameVersionState(outline.id, outline.title, outline.nameVersions, outline.defaultNameVersionId, outline.updatedAt, 80);
                const next = appendNameVersion(state, { id: makeId("name"), title: normalized, source: "manual", createdAt }, 80);
                versionId = next.versionId;
                return { ...outline, ...next.state, ...(makeDefault ? { title: normalized, titleGenerationPending: false, defaultNameVersionId: next.versionId } : {}), updatedAt: createdAt };
              }),
            };
          }),
        }),
      }));
      return versionId;
    },
    setDefaultNameVersion(kind, entityId, versionId) {
      const updatedAt = new Date().toISOString();
      setData((current) => ({
        ...current,
        articles: current.articles.map((article) => article.id !== current.currentArticleId ? article : {
          ...article,
          updatedAt,
          chapters: article.chapters.map((chapter) => {
            if (kind === "chapter" && chapter.id === entityId) {
              const state = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
              const selected = state.nameVersions.find((item) => item.id === versionId);
              return selected ? { ...chapter, ...state, title: selected.title, defaultNameVersionId: selected.id } : chapter;
            }
            return {
              ...chapter,
              outlines: chapter.outlines.map((outline) => {
                if (kind !== "outline" || outline.id !== entityId) return outline;
                const state = normalizeNameVersionState(outline.id, outline.title, outline.nameVersions, outline.defaultNameVersionId, outline.updatedAt, 80);
                const selected = state.nameVersions.find((item) => item.id === versionId);
                return selected ? { ...outline, ...state, title: selected.title, defaultNameVersionId: selected.id, titleGenerationPending: false, updatedAt } : outline;
              }),
            };
          }),
        }),
      }));
    },
    deleteNameVersion(kind, entityId, versionId) {
      const updatedAt = new Date().toISOString();
      let deleted = false;
      setData((current) => {
        const articles = current.articles.map((article) => {
          if (article.id !== current.currentArticleId) return article;
          let articleChanged = false;
          const chapters = article.chapters.map((chapter) => {
            if (kind === "chapter" && chapter.id === entityId) {
              const state = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
              if (!state.nameVersions.some((item) => item.id === versionId)) return chapter;
              const remaining = state.nameVersions.filter((item) => item.id !== versionId);
              if (state.defaultNameVersionId === versionId && !remaining.length) return chapter;
              deleted = true;
              articleChanged = true;
              if (state.defaultNameVersionId !== versionId) return { ...chapter, nameVersions: remaining };
              const fallback = remaining[0];
              return { ...chapter, nameVersions: remaining, title: fallback.title, defaultNameVersionId: fallback.id };
            }

            let chapterChanged = false;
            const usedOutlineTitles = new Set(chapter.outlines
              .filter((outline) => outline.id !== entityId)
              .map((outline) => normalizeOutlineTitle(outline.title))
              .filter(Boolean));
            const outlines = chapter.outlines.map((outline) => {
              if (kind !== "outline" || outline.id !== entityId) return outline;
              const state = normalizeNameVersionState(outline.id, outline.title, outline.nameVersions, outline.defaultNameVersionId, outline.updatedAt, 80);
              if (!state.nameVersions.some((item) => item.id === versionId)) return outline;
              const remaining = state.nameVersions.filter((item) => item.id !== versionId);
              deleted = true;
              articleChanged = true;
              chapterChanged = true;
              if (state.defaultNameVersionId !== versionId) return { ...outline, nameVersions: remaining, updatedAt };
              const fallback = remaining.find((item) => !usedOutlineTitles.has(item.title));
              return {
                ...outline,
                nameVersions: remaining,
                title: fallback?.title ?? "",
                defaultNameVersionId: fallback?.id ?? null,
                titleGenerationPending: !fallback,
                updatedAt,
              };
            });
            return chapterChanged ? { ...chapter, outlines } : chapter;
          });
          return articleChanged ? { ...article, updatedAt, chapters } : article;
        });
        return deleted ? { ...current, articles } : current;
      });
      return deleted;
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
        return { ...item, ...patch, titleGenerationPending, updatedAt: new Date().toISOString() };
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
    saveCurrentContent(outlineId, text, sourceVersionId) {
      const updatedAt = new Date().toISOString();
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, updatedAt: article.id === dataRef.current.currentArticleId ? updatedAt : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        const sourceVersion = sourceVersionId ? item.versions.find((version) => version.id === sourceVersionId) : undefined;
        const sourceContent = sourceVersion?.content ?? resolvedOutlineContent(item);
        const sourceFragments = sourceVersion ? normalizeExcellentFragments(sourceVersion.content, sourceVersion.excellentFragments) : activeExcellentFragments(item);
        return {
          ...item,
          content: text,
          contentName: timestampContentName(updatedAt),
          currentVersionId: null,
          contentOutlineSnapshot: sourceVersion?.outlineSnapshot ?? resolvedOutlineSnapshot(item) ?? { title: item.title, plan: item.plan },
          manualExcellent: sourceVersion?.manualExcellent ?? activeManualExcellent(item),
          excellentFragments: cloneExcellentFragments(text, reanchorExcellentFragments(sourceContent, text, sourceFragments)),
          updatedAt,
        };
      }) })) })) };
      dataRef.current = snapshot;
      setData(snapshot);
      return enqueueSave(snapshot);
    },
    commitContentEdit(outlineId, text) {
      const updatedAt = new Date().toISOString();
      const versionId = makeId("version");
      const existing = dataRef.current.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((item) => item.id === outlineId);
      const version: Version = { id: versionId, name: timestampContentName(updatedAt), content: text, source: "AI Chat", createdAt: updatedAt, outlineSnapshot: existing ? resolvedOutlineSnapshot(existing) : { title: "", plan: "" }, manualExcellent: existing ? activeManualExcellent(existing) : false, excellentFragments: existing ? cloneExcellentFragments(text, reanchorExcellentFragments(resolvedOutlineContent(existing), text, activeExcellentFragments(existing))) : [] };
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, updatedAt: article.id === dataRef.current.currentArticleId ? updatedAt : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, currentVersionId: versionId, updatedAt, versions: [version, ...item.versions] } : item) })) })) };
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
      const version: Version = { id: makeId("version"), name: `未保存内容 · ${new Date(savedAt).toLocaleString("zh-CN")}`, content: text, source: "未保存内容", createdAt: savedAt, outlineSnapshot: { title: existing.title, plan: existing.plan }, manualExcellent: activeManualExcellent(existing), excellentFragments: cloneExcellentFragments(text, reanchorExcellentFragments(resolvedOutlineContent(existing), text, activeExcellentFragments(existing))) };
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
    importOutline(chapterId, source, afterId) {
      let result: string | null = null;
      setData((current) => {
        const targetArticle = current.articles.find((article) => article.id === current.currentArticleId);
        if (!targetArticle?.chapters.some((chapter) => chapter.id === chapterId)) return current;
        const imported = duplicateOutlineForImport(source);
        result = imported.id;
        const updatedAt = new Date().toISOString();
        return normalizeStudioData({
          ...current,
          currentOutlineId: imported.id,
          articles: current.articles.map((article) => article.id !== current.currentArticleId ? article : {
            ...article,
            updatedAt,
            lastOutlineId: imported.id,
            chapters: article.chapters.map((chapter) => {
              if (chapter.id !== chapterId) return chapter;
              const outlines = [...chapter.outlines];
              const index = afterId ? outlines.findIndex((outline) => outline.id === afterId) : -1;
              outlines.splice(index >= 0 ? index + 1 : outlines.length, 0, imported);
              return { ...chapter, outlines };
            }),
          }),
        });
      });
      return result;
    },
    importArticles(sourceArticles, sourceTasks = []) {
      let importedIds: string[] = [];
      setData((current) => {
        const imported = duplicateArticlesForImport(sourceArticles, sourceTasks, current.articles.map((article) => article.title));
        importedIds = imported.articles.map((article) => article.id);
        if (!imported.articles.length) return current;
        const selected = imported.articles[0];
        return normalizeStudioData({
          ...current,
          currentArticleId: selected.id,
          currentOutlineId: selected.lastOutlineId || firstOutline(selected),
          articles: [...imported.articles, ...current.articles],
          tasks: [...imported.tasks, ...current.tasks],
        });
      });
      return importedIds;
    },
    importSettings(settings) {
      setData((current) => normalizeStudioData({ ...current, settings }));
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
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        const nextContent = content ?? resolvedOutlineContent(item);
        const excellentFragments = metadata?.excellentFragments
          ? cloneExcellentFragments(nextContent, metadata.excellentFragments)
          : cloneExcellentFragments(nextContent, reanchorExcellentFragments(resolvedOutlineContent(item), nextContent, activeExcellentFragments(item)));
        const inheritedOutlineSnapshot = resolvedOutlineSnapshot(item);
        const manualExcellent = metadata?.manualExcellent ?? activeManualExcellent(item);
        return { ...item, versions: [{ id, name: name || timestampContentName(createdAt), source, createdAt, content: nextContent, outlineSnapshot: metadata?.outlineSnapshot ?? inheritedOutlineSnapshot ?? { title: item.title, plan: item.plan }, ...metadata, manualExcellent, excellentFragments }, ...item.versions] };
      }) })) })) }));
      return id;
    },
    toggleExcellentFragment(outlineId, versionId, start, end) {
      let action: "added" | "removed" | "none" = "none";
      const createdAt = new Date().toISOString();
      const id = makeId("excellent");
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        if (versionId) {
          return { ...item, versions: item.versions.map((version) => {
            if (version.id !== versionId) return version;
            const toggled = toggleExcellentFragment(version.content, version.excellentFragments ?? [], { start, end }, { id, createdAt });
            action = toggled.action;
            return { ...version, excellentFragments: toggled.fragments };
          }) };
        }
        const toggled = toggleExcellentFragment(item.content, item.excellentFragments ?? [], { start, end }, { id, createdAt });
        action = toggled.action;
        return { ...item, excellentFragments: toggled.fragments };
      }) })) })) }));
      return action;
    },
    setBodyExcellent(outlineId, versionId, excellent) {
      const updatedAt = new Date().toISOString();
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, updatedAt: article.id === current.currentArticleId ? updatedAt : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        if (versionId) {
          if (!item.versions.some((version) => version.id === versionId)) return item;
          return { ...item, updatedAt, versions: item.versions.map((version) => version.id === versionId ? { ...version, manualExcellent: excellent } : version) };
        }
        return { ...item, manualExcellent: excellent, updatedAt };
      }) })) })) }));
    },
    setCurrentVersion(outlineId, versionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId || !item.versions.some((version) => version.id === versionId)) return item;
        return { ...item, currentVersionId: versionId, updatedAt: new Date().toISOString() };
      }) })) })) }));
    },
    setDefaultVersion(outlineId, versionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        if (versionId && !item.versions.some((version) => version.id === versionId)) return item;
        return { ...item, defaultVersionId: versionId ?? null, updatedAt: new Date().toISOString() };
      }) })) })) }));
    },
    applyVersion(outlineId, versionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        const selected = item.versions.find((version) => version.id === versionId);
        return selected ? { ...item, currentVersionId: selected.id, updatedAt: new Date().toISOString() } : item;
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
        const inheritedOutlineSnapshot = resolvedOutlineSnapshot(item);
        const backup: Version = { id: backupId, name: `应用 AI 前 · ${new Date().toLocaleString("zh-CN")}`, content: resolvedOutlineContent(item), source: "手动", createdAt, outlineSnapshot: inheritedOutlineSnapshot ?? { title: item.title, plan: item.plan }, manualExcellent: activeManualExcellent(item), excellentFragments: cloneExcellentFragments(resolvedOutlineContent(item), activeExcellentFragments(item)) };
        return { ...item, currentVersionId: selected.id, updatedAt: createdAt, versions: [backup, ...item.versions] };
      }) })) })) }));
      return backupId;
    },
    renameVersion(outlineId, versionId, name) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, versions: item.versions.map((version) => version.id === versionId ? { ...version, name } : version) } : item) })) })) }));
    },
    deleteVersion(outlineId, versionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId || item.currentVersionId === versionId || item.defaultVersionId === versionId) return item;
        return { ...item, versions: item.versions.filter((version) => version.id !== versionId) };
      }) })) })) }));
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
      const id = task.id ?? makeId("task");
      setData((current) => {
        const tasks = [{ ...task, id, executionOrigin: task.executionOrigin ?? executionOrigin, state: task.state ?? "waiting", createdAt: task.createdAt ?? new Date().toISOString() }, ...current.tasks.filter((item) => item.id !== id)];
        while (tasks.length > 20) {
          const removable = tasks.map((item, index) => ({ item, index })).reverse().find(({ item }) => ["success", "failed", "cancelled"].includes(item.state));
          if (!removable) break;
          tasks.splice(removable.index, 1);
        }
        if (task.target !== "正文") return { ...current, tasks };
        const updatedAt = new Date().toISOString();
        const articles = current.articles.map((article) => ({
          ...article,
          updatedAt: article.id === task.articleId ? updatedAt : article.updatedAt,
          chapters: article.chapters.map((chapter) => ({
            ...chapter,
            outlines: chapter.outlines.map((outline) => outline.id === task.outlineId
              ? { ...outline, generateInstruction: task.prompt.slice(0, 20000), updatedAt }
              : outline),
          })),
        }));
        return { ...current, articles, tasks };
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
        lastSavedRef.current = serializeDurable(cleared);
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
    acceptServerMutation,
    refreshFromServer,
    saveNow() {
      return enqueueSave(dataRef.current);
    },
    retrySave() {
      return enqueueSave(dataRef.current);
    },
    async resolveConflict(choice) {
      if (!conflict) return;
      let server = conflict.server;
      let serverRevision = conflict.serverRevision;
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        const payload = await response.json() as { data?: StudioData | null; revision?: number };
        if (response.ok && payload.data && payload.revision !== undefined) {
          server = durableSnapshot(normalizeStudioData(payload.data));
          serverRevision = payload.revision;
        }
      } catch { /* The conflict response is still a valid database snapshot. */ }
      const resolved = resolveStudioConflict(conflict.base, conflict.local, server, choice === "keep-local" ? "local" : "server");
      const withDeviceUi = applyDeviceUi(resolved, deviceUiFromData(dataRef.current));
      saveEpochRef.current += 1;
      revisionRef.current = serverRevision;
      lastSavedRef.current = stableStudioStringify(server);
      dataRef.current = withDeviceUi;
      setData(withDeviceUi);
      setConflict(null);
      setSaveStatus("unsaved");
      await enqueueSave(withDeviceUi);
    },
  }), [data, executionOrigin, hydrated, saveStatus, saveError, conflict, currentArticle, currentChapter, currentOutline, acceptServerMutation, enqueueSave, refreshFromServer, setData]);

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
