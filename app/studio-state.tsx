"use client";

import { parseTaskHistory } from "@/lib/task-history";

import type { ReasoningEffort } from "@/lib/reasoning-options";

import { drainChatCompletions } from "@/lib/chat-client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GENERATE_TARGET_WORDS, normalizeContentGenerationMode, normalizeGeneratePresets, normalizeGenerateTargetWords, normalizeDialogueDensity, type DialogueDensityLevel, normalizeRewriteRetentionLevel, type ContentGenerationMode, type RewriteRetentionLevel } from "@/lib/generate-options";
import { timestampContentName } from "@/lib/content-name.mjs";
import { cloneExcellentFragments, normalizeExcellentFragments, reanchorExcellentFragments, toggleExcellentFragment, type ExcellentFragment } from "@/lib/excellent-fragments.mjs";
import { currentOutlineVersion, resolvedOutlineContent, resolvedOutlineSnapshot } from "@/lib/outline-content";
import { normalizeOutlineTitle } from "@/lib/outline-title";
import { articleReviewRules, createDefaultReviewRules, type ReviewRule, type ReviewRuleSnapshot } from "@/lib/review-rules.mjs";
import { normalizeReviewPresets } from "@/lib/review-options";
import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile, type NamingProfile } from "@/lib/naming-options";
import type { SelectedAiContext } from "@/lib/ai-context";
import type { NamingArticleContext } from "@/db/ai";
import { appendNameVersion, normalizeNameVersionState, type NameVersion } from "@/lib/name-versions";
import { diffStudioData, isStudioChangesEmpty } from "@/lib/studio-changes";
import { browserIsOffline, fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { deleteOfflineContentDraft, readOfflineContentDrafts, readOfflineStudioSnapshot, writeOfflineContentDraft, writeOfflineStudioSnapshot, type OfflineContentDraft } from "@/lib/offline-store";
import { studioStateEtag, type StudioStateIdentity } from "@/lib/state-version";
import { durableStudioData, mergeStudioConflict, resolveStudioConflict, stableStudioStringify, type StudioConflictDetail } from "./studio-conflict.mjs";
import { moveOutlineBetweenChapters, moveOutlineToChapterEnd } from "./outline-order.mjs";
import { duplicateArticleForCopy, duplicateArticlesForImport, duplicateOutlineForImport, type ArticleCopyOptions } from "@/lib/data-transfer";
import {
  EMPTY_ARTICLE_STORY_SETTINGS,
  EMPTY_CHARACTER_PROFILE,
  EMPTY_CHAPTER_SETTINGS,
  normalizeArticleStorySettings,
  normalizeCharacterProfile,
  normalizeChapterSettings,
  resolveChapterSettings,
  type ArticleStorySettings,
  type CharacterProfile,
  type ChapterSettings,
  type ResolvedChapterSettings,
} from "@/lib/story-settings";

import { normalizeReviewRounds, normalizeReviewRules, type GenerateReviewReport } from "@/lib/generate-review.mjs";

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
  /** Direct link to the body that an AI rewrite used as its source. */
  rewriteSourceId?: string;
  /** Source body name as shown when the rewrite was submitted. */
  rewriteSourceName?: string;
  reviewReport?: GenerateReviewReport;
  reviewRuleSnapshot?: ReviewRuleSnapshot;
  outlineSnapshot?: {
    title: string;
    plan: string;
  };
  settingSnapshot?: ResolvedChapterSettings;
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
  settings?: ChapterSettings;
  outlines: Outline[];
};

export type Character = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  profile?: CharacterProfile;
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
  storySettings?: ArticleStorySettings;
  reviewRules?: string;
  reviewRuleItems?: ReviewRule[];
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
  phase?: "queued" | "preparing" | "connecting" | "generating" | "receiving" | "reviewing" | "revising" | "verifying" | "saving" | "retrying" | "completed" | "failed" | "cancelled";
  history?: import("@/lib/task-history").TaskHistoryEntry[];
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
    reasoningEffort?: ReasoningEffort | null;
    resolvedReasoningEffort?: ReasoningEffort | null;
    includePrevious: boolean;
    includeCharacters: boolean;
    estimatedCharacters: number;
    targetWords?: number;
    contentMode?: ContentGenerationMode;
    rewriteRetention?: RewriteRetentionLevel;
    dialogueDensity?: DialogueDensityLevel;
    reviewMaxRounds?: number;
    reviewRules?: string;
    reviewRuleSnapshot?: ReviewRuleSnapshot;
    reviewInstruction?: string;
    reviewRound?: number;
    reviewReport?: GenerateReviewReport;
    reviewSourceContent?: string;
    reviewSourceVersionId?: string | null;
    reviewCandidateOnly?: boolean;
    rewriteSourceId?: string;
    rewriteSourceName?: string;
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
    serverManaged?: boolean;
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
  generateReasoningEffort?: ReasoningEffort | null;
  chatReasoningEffort?: ReasoningEffort | null;
  namingReasoningEffort?: ReasoningEffort | null;
  reviewReasoningEffort?: ReasoningEffort | null;
  namingModelMode: "inherit" | "fixed";
  namingModel: string;
  reviewModel: string;
  generateReviewMaxRounds?: number;
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
      storySettings: {
        era: "2033 年前后，现实世界的近未来",
        location: "常年多雾的临海旧港与已经停用的第七码头",
        tone: "冷静、潮湿、悬疑中带克制的浪漫",
        worldRules: "时间异常只通过信件和潮汐发生；改变过去必然造成等价记忆缺失。",
        negativeConstraints: "不出现无代价复活。\n不把时间异常解释成梦境。",
      },
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
        { id: "character-lin", name: "林澈", aliases: ["阿澈"], description: "海港长大的修理师，习惯用可验证的事实抵抗失序。", profile: { age: "29 岁", identity: "精密仪器修理师", appearance: "短发，常穿深色工作服，指尖有细小划痕", personality: "冷静、敏锐、谨慎", speechStyle: "短句，先确认事实再表达判断", abilities: "精密仪器维修、旧地图辨识", mentalState: "对故乡和七年前的事故保持疏离与戒备", knownInformation: "知道旧港事故的公开结论，不知道顾屿失踪与潮汐信件有关", boundaries: "不拿无辜者验证时间异常", immutableTraits: "面对失序会害怕，但一定会追查到可以验证的事实" }, archived: false },
        { id: "character-gu", name: "顾屿", aliases: ["顾先生"], description: "七年前失踪，如今似乎知道信件来源。", profile: { age: "31 岁", identity: "海图绘制员", appearance: "左手有旧伤，衣着整洁", personality: "克制，擅长隐藏真实意图", speechStyle: "很少解释，用含有双重意思的陈述代替回答", abilities: "海图绘制、航线记忆", mentalState: "急于阻止某件事发生，同时不愿让林澈承担代价", knownInformation: "知道信件来源和七年前事故的真相，但不知道本次循环会在哪一刻结束", boundaries: "不会主动欺骗林澈有关生死的事实", immutableTraits: "即使隐瞒动机，也不会把林澈当成可以牺牲的工具" }, archived: false },
        { id: "character-zhou", name: "周岚", aliases: ["周姨"], description: "保存着旧港关闭前最后一份完整潮汐记录。", profile: { age: "58 岁", identity: "港务记录员", appearance: "总带着一本蓝封皮记录册", personality: "谨慎而固执", speechStyle: "说话缓慢，习惯给出具体日期", abilities: "熟悉港务档案和潮汐记录", mentalState: "希望秘密终止在自己这里", knownInformation: "知道旧港记录被改写过，不知道顾屿仍然活着", boundaries: "不伪造档案", immutableTraits: "宁可保持沉默，也不会编造证据" }, archived: false },
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
      storySettings: { ...EMPTY_ARTICLE_STORY_SETTINGS },
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
      storySettings: { ...EMPTY_ARTICLE_STORY_SETTINGS },
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
  saveStatus: "loading" | "saved" | "local" | "unsaved" | "saving" | "failed" | "conflict";
  saveError: string;
  conflict: { base: StudioData; local: StudioData; server: StudioData; serverRevision: number; details: StudioConflictDetail[] } | null;
  currentArticle: Article;
  currentChapter: Chapter;
  currentOutline: Outline;
  setCurrentArticle: (articleId: string) => void;
  setCurrentOutline: (outlineId: string) => void;
  createArticle: (fields: Pick<Article, "title" | "summary" | "type" | "style">) => string;
  duplicateArticle: (articleId: string, options: ArticleCopyOptions) => { articleId: string; outlineId: string } | null;
  updateArticle: (patch: Partial<Pick<Article, "title" | "summary" | "type" | "style" | "storySettings" | "reviewRules" | "reviewRuleItems" | "chapterNaming" | "outlineNaming">>) => void;
  deleteArticle: (articleId: string) => void;
  createChapter: (title?: string) => string;
  updateChapter: (chapterId: string, patch: Partial<Pick<Chapter, "title" | "archived" | "settings">>) => void;
  applyGeneratedNames: (chapterId: string, chapterTitle: string | undefined, outlineTitles: Array<{ id: string; title: string }>) => void;
  addGeneratedNameCandidates: (chapterId: string, chapterTitle: string | undefined, outlineTitles: Array<{ id: string; title: string }>, metadata?: { model?: string; instruction?: string }) => number;
  addManualNameVersion: (kind: NameEntityKind, entityId: string, title: string, makeDefault?: boolean) => string | null;
  setDefaultNameVersion: (kind: NameEntityKind, entityId: string, versionId: string) => void;
  deleteNameVersion: (kind: NameEntityKind, entityId: string, versionId: string) => boolean;
  moveChapter: (chapterId: string, direction: -1 | 1) => void;
  deleteChapter: (chapterId: string) => void;
  createOutline: (chapterId?: string, afterId?: string) => string;
  updateOutline: (outlineId: string, patch: Partial<Pick<Outline, "title" | "titleGenerationPending" | "plan" | "generateInstruction" | "content" | "contentName" | "currentVersionId" | "defaultVersionId" | "contentOutlineSnapshot" | "archived" | "state">>) => void;
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
  saveVersion: (outlineId: string, name?: string, source?: Version["source"], content?: string, metadata?: Pick<Version, "model" | "modelId" | "prompt" | "taskId" | "outlineSnapshot" | "settingSnapshot" | "manualExcellent" | "excellentFragments">) => string;
  toggleExcellentFragment: (outlineId: string, versionId: string | undefined, start: number, end: number) => "added" | "removed" | "none";
  setBodyExcellent: (outlineId: string, versionId: string | undefined, excellent: boolean) => void;
  setCurrentVersion: (outlineId: string, versionId?: string) => void;
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
  acceptServerMutation: (revision: number, update: (current: StudioData) => StudioData, coverage?: "complete" | "partial") => void;
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
    await fetchFromServer("/api/sync/upload", { method: "POST", keepalive: true });
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
  // Locally created records can still omit fields that hydration and SQLite
  // synthesize (notably nameVersions). Canonicalize every side of the save/merge
  // boundary so those defaults cannot look like local deletions during AI sync.
  return durableStudioData(normalizeStudioData(data));
}

function serializeDurable(data: StudioData) {
  return stableStudioStringify(durableSnapshot(data));
}

type StudioStatePayload = StudioStateIdentity & {
  data: StudioData | null;
  executionOrigin?: TaskExecutionOrigin;
};

function stateIdentityFromPayload(payload: Partial<StudioStatePayload>): StudioStateIdentity | null {
  if (
    typeof payload.databaseId !== "string" || !payload.databaseId ||
    !Number.isSafeInteger(payload.schemaVersion) || Number(payload.schemaVersion) < 0 ||
    !Number.isSafeInteger(payload.databaseVersion) || Number(payload.databaseVersion) < 0 ||
    !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 0
  ) return null;
  return {
    databaseId: payload.databaseId,
    schemaVersion: Number(payload.schemaVersion),
    databaseVersion: Number(payload.databaseVersion),
    revision: Number(payload.revision),
  };
}

function recoverStoredDrafts(source: StudioData, indexedDrafts: OfflineContentDraft[] = []) {
  let loaded = source;
  const recoveredDraftKeys: string[] = [];
  const recoveredOfflineDraftIds: string[] = [];
  const candidates = new Map<string, { outlineId: string; text: string; savedAt: string; sessionKeys: string[]; storedOffline: boolean }>();
  for (const draft of indexedDrafts) candidates.set(draft.outlineId, { outlineId: draft.outlineId, text: draft.text, savedAt: draft.savedAt, sessionKeys: [], storedOffline: true });
  const storedDraftKeys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index)).filter((key): key is string => Boolean(key?.startsWith(draftPrefix)));
  for (const key of storedDraftKeys) {
    try {
      const draft = JSON.parse(window.sessionStorage.getItem(key) ?? "") as { outlineId: string; text: string; savedAt?: string };
      if (typeof draft.outlineId !== "string" || typeof draft.text !== "string") throw new Error("invalid editor draft");
      const savedAt = draft.savedAt && !Number.isNaN(new Date(draft.savedAt).getTime()) ? draft.savedAt : new Date().toISOString();
      const existing = candidates.get(draft.outlineId);
      const sessionKeys = [...(existing?.sessionKeys ?? []), key];
      candidates.set(draft.outlineId, !existing || new Date(savedAt).getTime() >= new Date(existing.savedAt).getTime()
        ? { outlineId: draft.outlineId, text: draft.text, savedAt, sessionKeys, storedOffline: existing?.storedOffline === true }
        : { ...existing, sessionKeys });
    } catch {
      window.sessionStorage.removeItem(key);
    }
  }
  for (const draft of candidates.values()) {
    let recovered = false;
    loaded = { ...loaded, articles: loaded.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((outline) => {
      if (outline.id !== draft.outlineId || outline.content === draft.text || outline.versions.some((version) => version.source === "未保存内容" && version.content === draft.text)) return outline;
      recovered = true;
      const version: Version = { id: makeId("version"), name: `未保存内容 · ${new Date(draft.savedAt).toLocaleString("zh-CN")}`, content: draft.text, source: "未保存内容", createdAt: draft.savedAt, outlineSnapshot: { title: outline.title, plan: outline.plan }, manualExcellent: activeManualExcellent(outline), excellentFragments: cloneExcellentFragments(draft.text, reanchorExcellentFragments(resolvedOutlineContent(outline), draft.text, activeExcellentFragments(outline))) };
      return { ...outline, versions: [version, ...outline.versions] };
    }) })) })) };
    if (recovered) {
      recoveredDraftKeys.push(...draft.sessionKeys);
      if (draft.storedOffline) recoveredOfflineDraftIds.push(draft.outlineId);
    } else {
      draft.sessionKeys.forEach((key) => window.sessionStorage.removeItem(key));
      if (draft.storedOffline) void deleteOfflineContentDraft(draft.outlineId);
    }
  }
  return { loaded, recoveredDraftKeys, recoveredOfflineDraftIds };
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
    profile: normalizeCharacterProfile(item.profile ?? {
      age: item.age,
      identity: item.role,
      appearance: item.appearance,
      personality: item.personality,
      speechStyle: item.speechStyle,
      abilities: item.abilities,
      mentalState: item.mentalState,
      knownInformation: item.knownInformation,
      boundaries: item.boundaries,
      immutableTraits: item.immutableTraits,
    }),
    archived: Boolean(item.archived),
  };
}

function normalizeAiTask(task: AiTask): AiTask {
  const phase = task.phase ?? (task.state === "waiting" ? "queued" : task.state === "success" ? "completed" : task.state === "failed" ? "failed" : task.state === "cancelled" ? "cancelled" : "generating");
  const contentMode = task.target === "正文" ? normalizeContentGenerationMode(task.contextOptions?.contentMode) : undefined;
  return {
    ...task,
    history: parseTaskHistory(task.history),
    executionOrigin: task.executionOrigin === "cloud" ? "cloud" : "local",
    contextOptions: task.contextOptions ? {
      ...task.contextOptions,
      ...(task.target === "正文" ? { contentMode, dialogueDensity: normalizeDialogueDensity(task.contextOptions.dialogueDensity), rewriteRetention: contentMode === "rewrite" ? normalizeRewriteRetentionLevel(task.contextOptions.rewriteRetention) : undefined } : {}),
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

function reconcileTaskPoll(current: StudioData, tasks: AiTask[], runningOutlineIds: string[]) {
  const running = new Set(runningOutlineIds);
  const terminalByOutline = new Map<string, AiTask["state"]>();
  for (const task of tasks) {
    if (task.target === "AI Chat" || task.target === "全部名称" || task.state === "waiting" || task.state === "running" || terminalByOutline.has(task.outlineId)) continue;
    terminalByOutline.set(task.outlineId, task.state);
  }
  return {
    ...current,
    tasks,
    articles: current.articles.map((article) => ({
      ...article,
      chapters: article.chapters.map((chapter) => ({
        ...chapter,
        outlines: chapter.outlines.map((outline) => {
          if (running.has(outline.id)) return outline.state === "running" ? outline : { ...outline, state: "running" as const };
          if (outline.state !== "running") return outline;
          return { ...outline, state: terminalByOutline.get(outline.id) === "failed" ? "failed" as const : "saved" as const };
        }),
      })),
    })),
  };
}

const emptyChapter: Chapter = { id: "", title: "", archived: false, settings: EMPTY_CHAPTER_SETTINGS, outlines: [] };
const emptyOutline: Outline = { id: "", title: "", titleGenerationPending: false, plan: "", generateInstruction: "", content: "", contentName: timestampContentName(now), currentVersionId: null, defaultVersionId: null, contentOutlineSnapshot: { title: "", plan: "" }, archived: false, state: "saved", updatedAt: now, excellentFragments: [], versions: [], chat: emptyChat("empty") };
const emptyArticle: Article = { id: "", title: "", summary: "", type: "", style: "", storySettings: EMPTY_ARTICLE_STORY_SETTINGS, chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE, outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE, createdAt: now, updatedAt: now, lastOutlineId: "", chapters: [], characters: [], relationships: [] };

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
      generateReviewMaxRounds: normalizeReviewRounds(source.settings?.generateReviewMaxRounds),
    },
    articles: source.articles.map((article) => ({
      ...article,
      storySettings: normalizeArticleStorySettings(article.storySettings),
      reviewRules: normalizeReviewRules(article.reviewRules),
      reviewRuleItems: articleReviewRules(article),
      chapterNaming: normalizeNamingProfile(article.chapterNaming, DEFAULT_CHAPTER_NAMING_PROFILE),
      outlineNaming: normalizeNamingProfile(article.outlineNaming, DEFAULT_OUTLINE_NAMING_PROFILE),
      characters: (article.characters ?? []).map(normalizeCharacter),
      chapters: article.chapters.map((chapter) => {
        const chapterNameState = normalizeNameVersionState(chapter.id, chapter.title, chapter.nameVersions, chapter.defaultNameVersionId, article.updatedAt, 120);
        return {
        ...chapter,
        ...chapterNameState,
        settings: normalizeChapterSettings(chapter.settings),
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
          const currentItem = { ...item };
          Reflect.deleteProperty(currentItem, "contentOverride");
          Reflect.deleteProperty(currentItem, "sourceVersionId");
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
  const executionOriginRef = useRef<TaskExecutionOrigin>("local");
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
  const pendingRecoveredOfflineDraftIdsRef = useRef<string[]>([]);
  const pendingLegacyMigrationRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const stateIdentityRef = useRef<StudioStateIdentity | null>(null);
  const offlineCacheReadyRef = useRef(false);
  const refreshCachedStateOnHydrateRef = useRef(false);

  const setData = useCallback((update: StudioData | ((current: StudioData) => StudioData)) => {
    const next = typeof update === "function" ? update(dataRef.current) : update;
    // dataRef is the source for sequential mutations. Sync it here, rather than
    // from a later React effect that could roll rapid streaming updates backward.
    dataRef.current = next;
    setDataState(next);
  }, []);

  const persistOfflineCache = useCallback(async (localSnapshot = dataRef.current) => {
    if (!offlineCacheReadyRef.current || !stateIdentityRef.current || !lastSavedRef.current) return false;
    try {
      const baseData = durableSnapshot(normalizeStudioData(JSON.parse(lastSavedRef.current) as StudioData));
      const localData = durableSnapshot(normalizeStudioData(localSnapshot));
      return writeOfflineStudioSnapshot({
        ...stateIdentityRef.current,
        etag: studioStateEtag(stateIdentityRef.current),
        baseData,
        localData,
        executionOrigin: executionOriginRef.current,
      });
    } catch {
      return false;
    }
  }, []);

  const advanceStateIdentity = useCallback((revision: number, databaseVersion?: number) => {
    const current = stateIdentityRef.current;
    if (!current) return;
    stateIdentityRef.current = {
      ...current,
      revision,
      databaseVersion: Number.isSafeInteger(databaseVersion) && Number(databaseVersion) >= 0 ? Number(databaseVersion) : current.databaseVersion,
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      const [cached, indexedDrafts] = await Promise.all([readOfflineStudioSnapshot(), readOfflineContentDrafts()]);
      if (cached && active) {
        try {
          const base = durableSnapshot(normalizeStudioData(cached.baseData));
          const local = durableSnapshot(normalizeStudioData(cached.localData));
          const deviceUi = deviceUiForCurrentPath(readDeviceUi(), local);
          const recovered = recoverStoredDrafts(applyDeviceUi(local, deviceUi), indexedDrafts);
          stateIdentityRef.current = {
            databaseId: cached.databaseId,
            schemaVersion: cached.schemaVersion,
            databaseVersion: cached.databaseVersion,
            revision: cached.revision,
          };
          revisionRef.current = cached.revision;
          lastSavedRef.current = stableStudioStringify(base);
          pendingRecoveredDraftKeysRef.current = recovered.recoveredDraftKeys;
          pendingRecoveredOfflineDraftIdsRef.current = recovered.recoveredOfflineDraftIds;
          offlineCacheReadyRef.current = true;
          refreshCachedStateOnHydrateRef.current = true;
          executionOriginRef.current = cached.executionOrigin;
          setExecutionOrigin(cached.executionOrigin);
          setData(recovered.loaded);
          setSaveStatus(serializeDurable(recovered.loaded) === lastSavedRef.current ? "saved" : "local");
          setHydrated(true);
          return;
        } catch { /* An invalid cache falls through to the authoritative server. */ }
      }
      try {
        const response = await fetchFromServer("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error(`数据库加载失败（${response.status}）`);
        const payload = await response.json() as StudioStatePayload;
        const identity = stateIdentityFromPayload(payload);
        if (!identity) throw new Error("数据库版本信息无效");
        const databaseData = normalizeStudioData(payload.data ?? emptyStudioData(seedData.settings));
        let loaded = databaseData;
        let migratedLegacy = false;
        revisionRef.current = payload.revision;
        stateIdentityRef.current = identity;
        executionOriginRef.current = payload.executionOrigin === "cloud" ? "cloud" : "local";
        setExecutionOrigin(executionOriginRef.current);
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
        const recovered = recoverStoredDrafts(loaded, indexedDrafts);
        loaded = recovered.loaded;
        if (!active) return;
        setData(loaded);
        dataRef.current = loaded;
        lastSavedRef.current = databaseSnapshot;
        pendingRecoveredDraftKeysRef.current = recovered.recoveredDraftKeys;
        pendingRecoveredOfflineDraftIdsRef.current = recovered.recoveredOfflineDraftIds;
        pendingLegacyMigrationRef.current = migratedLegacy;
        offlineCacheReadyRef.current = true;
        setSaveStatus("saved");
        await persistOfflineCache(loaded);
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
  }, [persistOfflineCache, setData]);

  const persist = useCallback(async function persistSnapshot(snapshot: StudioData, epoch = saveEpochRef.current, rebaseAttempt = 0): Promise<boolean> {
    if (epoch !== saveEpochRef.current) return false;
    const durable = durableSnapshot(snapshot);
    const serialized = stableStudioStringify(durable);
    if (serialized === lastSavedRef.current) return true;
    let base: StudioData;
    try {
      // Normalization restores valid active chat/session defaults. Strip those
      // device-only values again before diffing against the durable snapshot.
      base = lastSavedRef.current ? durableSnapshot(normalizeStudioData(JSON.parse(lastSavedRef.current) as StudioData)) : durable;
    } catch {
      base = durable;
    }
    const changes = diffStudioData(base, durable);
    if (isStudioChangesEmpty(changes)) {
      lastSavedRef.current = serialized;
      return true;
    }
    if (browserIsOffline()) {
      const cached = await persistOfflineCache(snapshot);
      if (epoch !== saveEpochRef.current) return false;
      if (cached) {
        setSaveError("修改已保存在本设备，连接服务后会自动同步。");
        setSaveStatus("local");
        return true;
      }
      setSaveError("当前处于离线模式，且无法写入本设备缓存。");
      setSaveStatus("failed");
      return false;
    }
    setSaveStatus("saving");
    setSaveError("");
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort("save-timeout"), saveRequestTimeoutMs);
    try {
      const response = await fetchFromServer("/api/state/mutations", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "If-Match": String(revisionRef.current) },
        body: JSON.stringify({ changes }),
      });
      const payload = await response.json() as { revision?: number; databaseVersion?: number; data?: StudioData; message?: string };
      // An authoritative API response may have advanced the shared revision
      // while this request was in flight. Never let this older response roll
      // the accepted revision and save baseline backward.
      if (epoch !== saveEpochRef.current) return response.ok && payload.revision !== undefined;
      if (response.status === 409) {
        if (!payload.data) {
          const currentResponse = await fetchFromServer("/api/state", { cache: "no-store" });
          const currentPayload = await currentResponse.json() as Partial<StudioStatePayload>;
          if (currentResponse.ok && currentPayload.data && currentPayload.revision !== undefined) {
            payload.data = currentPayload.data;
            payload.revision = currentPayload.revision;
            payload.databaseVersion = currentPayload.databaseVersion;
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
              advanceStateIdentity(revisionRef.current, payload.databaseVersion);
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
        const resolutionBase = lastSavedRef.current ? JSON.parse(lastSavedRef.current) as StudioData : server;
        const latestLocal = durableSnapshot(dataRef.current);
        const result = mergeStudioConflict(resolutionBase, latestLocal, server);
        setConflict({ base: resolutionBase, local: latestLocal, server, serverRevision: Number(payload.revision ?? revisionRef.current), details: result.conflicts });
        setSaveStatus("conflict");
        return false;
      }
      if (!response.ok || payload.revision === undefined) throw new Error(payload.message || `保存失败（${response.status}）`);
      revisionRef.current = payload.revision;
      advanceStateIdentity(payload.revision, payload.databaseVersion);
      lastSavedRef.current = serialized;
      setConflict(null);
      setSaveStatus(serializeDurable(dataRef.current) === serialized ? "saved" : "unsaved");
      pendingRecoveredDraftKeysRef.current.forEach((key) => window.sessionStorage.removeItem(key));
      pendingRecoveredDraftKeysRef.current = [];
      await Promise.all(pendingRecoveredOfflineDraftIdsRef.current.map((outlineId) => deleteOfflineContentDraft(outlineId)));
      pendingRecoveredOfflineDraftIdsRef.current = [];
      if (pendingLegacyMigrationRef.current) {
        window.localStorage.removeItem(legacyStorageKey);
        pendingLegacyMigrationRef.current = false;
      }
      await persistOfflineCache(dataRef.current);
      return true;
    } catch (error) {
      if (epoch !== saveEpochRef.current) return false;
      const cached = await persistOfflineCache(snapshot);
      if (cached) {
        setSaveError("修改已保存在本设备，连接服务后会自动同步。");
        setSaveStatus("local");
        return true;
      }
      setSaveError(controller.signal.reason === "save-timeout" ? "保存超时，请检查网络后重试" : error instanceof Error ? error.message : "保存失败");
      setSaveStatus("failed");
      return false;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }, [advanceStateIdentity, persistOfflineCache, setData]);

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
        const response = await fetchFromServer("/api/state", {
          cache: "no-store",
          headers: stateIdentityRef.current ? { "If-None-Match": studioStateEtag(stateIdentityRef.current) } : undefined,
        });
        if (response.status === 304) return true;
        const payload = await response.json() as Partial<StudioStatePayload>;
        const identity = stateIdentityFromPayload(payload);
        if (!response.ok || !payload.data || !identity) return false;
        executionOriginRef.current = payload.executionOrigin === "cloud" ? "cloud" : "local";
        setExecutionOrigin(executionOriginRef.current);
        if (serializeDurable(dataRef.current) !== requestedSnapshot || lastSavedRef.current !== requestedSnapshot) return false;
        const server = durableSnapshot(normalizeStudioData(payload.data));
        const serialized = stableStudioStringify(server);
        revisionRef.current = identity.revision;
        stateIdentityRef.current = identity;
        if (serialized !== lastSavedRef.current) {
          const withDeviceUi = applyDeviceUi(server, deviceUiFromData(dataRef.current));
          dataRef.current = withDeviceUi;
          lastSavedRef.current = serialized;
          setData(withDeviceUi);
        }
        lastSavedRef.current = serialized;
        setSaveError("");
        setSaveStatus("saved");
        await persistOfflineCache(dataRef.current);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();
    refreshPromiseRef.current = request;
    return request;
  }, [hydrated, conflict, persistOfflineCache, setData]);

  useEffect(() => {
    if (!hydrated || !refreshCachedStateOnHydrateRef.current) return;
    refreshCachedStateOnHydrateRef.current = false;
    void refreshFromServer();
  }, [hydrated, refreshFromServer]);

  useEffect(() => {
    if (!hydrated || !offlineCacheReadyRef.current) return;
    const timer = window.setTimeout(() => { void persistOfflineCache(data); }, 120);
    return () => window.clearTimeout(timer);
  }, [data, hydrated, persistOfflineCache]);

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
    let syncing = false;
    const synchronizeWhenOnline = async (refreshCleanState = false) => {
      if (!navigator.onLine || syncing || conflict) return;
      const dirty = serializeDurable(dataRef.current) !== lastSavedRef.current;
      if (!dirty && !refreshCleanState) return;
      syncing = true;
      try {
        const synchronized = dirty ? await enqueueSave(dataRef.current) : await refreshFromServer();
        if (synchronized && !dataRef.current.tasks.some((task) => task.state === "waiting" || task.state === "running")) void triggerBackgroundCloudUpload();
      } finally {
        syncing = false;
      }
    };
    const synchronizeAfterReconnect = () => { void synchronizeWhenOnline(true); };
    const synchronizeWhenVisible = () => { if (document.visibilityState === "visible") synchronizeAfterReconnect(); };
    window.addEventListener("online", synchronizeAfterReconnect);
    window.addEventListener("focus", synchronizeAfterReconnect);
    window.addEventListener("pageshow", synchronizeAfterReconnect);
    document.addEventListener("visibilitychange", synchronizeWhenVisible);
    const timer = window.setInterval(() => { void synchronizeWhenOnline(); }, 2_000);
    void synchronizeWhenOnline();
    return () => {
      window.removeEventListener("online", synchronizeAfterReconnect);
      window.removeEventListener("focus", synchronizeAfterReconnect);
      window.removeEventListener("pageshow", synchronizeAfterReconnect);
      document.removeEventListener("visibilitychange", synchronizeWhenVisible);
      window.clearInterval(timer);
    };
  }, [hydrated, conflict, enqueueSave, refreshFromServer]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(deviceUiStorageKey, JSON.stringify(deviceUiFromData(data)));
    } catch { /* Device-local UI state is an optional convenience. */ }
  }, [data, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const onHidden = () => { if (document.visibilityState === "hidden") { void persistOfflineCache(dataRef.current); void enqueueSave(dataRef.current); } };
    const onPageHide = () => { void persistOfflineCache(dataRef.current); void enqueueSave(dataRef.current); };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => { document.removeEventListener("visibilitychange", onHidden); window.removeEventListener("pagehide", onPageHide); };
  }, [hydrated, enqueueSave, persistOfflineCache]);

  const currentArticle = data.articles.find((article) => article.id === data.currentArticleId) ?? data.articles[0] ?? emptyArticle;
  const currentPair = currentArticle.id ? findOutlineInArticle(currentArticle, data.currentOutlineId) ?? findOutlineInArticle(currentArticle, firstOutline(currentArticle)) : null;
  const currentChapter = currentPair?.chapter ?? currentArticle.chapters[0] ?? emptyChapter;
  const currentOutline = currentPair?.outline ?? currentChapter?.outlines[0] ?? emptyOutline;

  const acceptServerMutation = useCallback((revision: number, update: (current: StudioData) => StudioData, coverage: "complete" | "partial" = "complete") => {
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
    // A partial task poll does not describe every field covered by the global
    // revision. It may update the visible task progress and its matching slice
    // of the save baseline, but only a complete mutation response may advance
    // the revision used by subsequent writes.
    if (coverage === "complete") {
      saveEpochRef.current += 1;
      revisionRef.current = revision;
      advanceStateIdentity(revision);
    }
    lastSavedRef.current = stableStudioStringify(nextBase);
    dataRef.current = nextLocal;
    setData(nextLocal);
    setConflict(null);
    setSaveStatus(serializeDurable(nextLocal) === lastSavedRef.current ? "saved" : "unsaved");
    void persistOfflineCache(nextLocal);
  }, [advanceStateIdentity, persistOfflineCache, setData]);

  useEffect(() => {
    if (!hydrated) return;
    const recover = () => { if (navigator.onLine) void drainChatCompletions().then((changed) => { if (changed) void refreshFromServer(); }); };
    recover();
    const timer = window.setInterval(recover, 5_000);
    window.addEventListener("online", recover);
    return () => { window.clearInterval(timer); window.removeEventListener("online", recover); };
  }, [hydrated, refreshFromServer]);

  useEffect(() => {
    if (!hydrated) return;
    let polling = false;
    const refreshVisible = () => { if (document.visibilityState === "visible") void refreshFromServer(); };
    const timer = window.setInterval(() => {
      if (browserIsOffline() || polling || document.visibilityState !== "visible" || !dataRef.current.tasks.some((task) => task.executionOrigin === executionOrigin && (task.state === "waiting" || task.state === "running"))) return;
      polling = true;
      void fetchFromServer("/api/ai/tasks", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { tasks?: AiTask[]; runningOutlineIds?: string[]; revision?: number };
          if (!response.ok || !payload.tasks || payload.revision === undefined) return;
          const activeIds = new Set(dataRef.current.tasks.filter((task) => task.state === "waiting" || task.state === "running").map((task) => task.id));
          const terminalTransition = payload.tasks.some((task) => activeIds.has(task.id) && task.state !== "waiting" && task.state !== "running");
          // Task state is authoritative even while the editor has unrelated
          // unsaved changes. Apply the terminal transition first so the task
          // and its original outline cannot remain stuck as running; a clean
          // full refresh below then brings in the generated version and title.
          acceptServerMutation(payload.revision, (current) => ({ ...reconcileTaskPoll(current, payload.tasks!, payload.runningOutlineIds ?? []) }), "partial");
          if (terminalTransition) await refreshFromServer();
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
        storySettings: { ...EMPTY_ARTICLE_STORY_SETTINGS },
        reviewRuleItems: createDefaultReviewRules(articleId, createdAt),
        chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE,
        outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE,
        createdAt,
        updatedAt: createdAt,
        lastOutlineId: outlineId,
        chapters: [{ id: chapterId, title: "第一章", archived: false, settings: { ...EMPTY_CHAPTER_SETTINGS }, outlines: [outline(outlineId, "", "", "")] }],
        characters: [],
        relationships: [],
      };
      setData((current) => ({ ...current, currentArticleId: articleId, currentOutlineId: outlineId, articles: [article, ...current.articles] }));
      return outlineId;
    },
    duplicateArticle(articleId, options) {
      let result: { articleId: string; outlineId: string } | null = null;
      setData((current) => {
        const source = current.articles.find((article) => article.id === articleId);
        if (!source) return current;
        const copied = duplicateArticleForCopy(source, options, current.articles.map((article) => article.title));
        const outlineId = copied.lastOutlineId || firstOutline(copied);
        result = { articleId: copied.id, outlineId };
        return normalizeStudioData({
          ...current,
          currentArticleId: copied.id,
          currentOutlineId: outlineId,
          articles: [copied, ...current.articles],
        });
      });
      return result;
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
      setData((current) => ({ ...current, articles: current.articles.map((article) => article.id === current.currentArticleId ? { ...article, chapters: [...article.chapters, { id, title, archived: false, settings: { ...EMPTY_CHAPTER_SETTINGS }, outlines: [] }] } : article) }));
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
        if (!targetChapterId) chapters = [{ id: makeId("chapter"), title: "第一章", settings: { ...EMPTY_CHAPTER_SETTINGS }, archived: false, outlines: [] }];
        return { ...article, lastOutlineId: id, chapters: chapters.map((chapter) => {
          if (chapter.id !== (targetChapterId ?? chapters[0].id)) return chapter;
          const items = [...chapter.outlines];
          const requestedAfterId = afterId ?? (items.some((item) => item.id === current.currentOutlineId) ? current.currentOutlineId : undefined);
          const index = requestedAfterId ? items.findIndex((item) => item.id === requestedAfterId) + 1 : items.length;
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
      const savedAt = new Date().toISOString();
      window.sessionStorage.setItem(`${draftPrefix}${outlineId}`, JSON.stringify({ outlineId, text, savedAt }));
      void writeOfflineContentDraft(outlineId, text, savedAt);
    },
    clearContentDraft(outlineId) {
      window.sessionStorage.removeItem(`${draftPrefix}${outlineId}`);
      void deleteOfflineContentDraft(outlineId);
    },
    saveCurrentContent(outlineId, text, sourceVersionId) {
      const updatedAt = new Date().toISOString();
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, updatedAt: article.id === dataRef.current.currentArticleId ? updatedAt : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        const sourceIsDirectContent = sourceVersionId === `content:${item.id}`;
        const sourceVersion = sourceVersionId && !sourceIsDirectContent ? item.versions.find((version) => version.id === sourceVersionId) : undefined;
        const sourceContent = sourceIsDirectContent ? item.content : sourceVersion?.content ?? resolvedOutlineContent(item);
        const sourceFragments = sourceIsDirectContent
          ? normalizeExcellentFragments(item.content, item.excellentFragments)
          : sourceVersion ? normalizeExcellentFragments(sourceVersion.content, sourceVersion.excellentFragments) : activeExcellentFragments(item);
        return {
          ...item,
          content: text,
          contentName: timestampContentName(updatedAt),
          currentVersionId: null,
          contentOutlineSnapshot: sourceIsDirectContent ? item.contentOutlineSnapshot : sourceVersion?.outlineSnapshot ?? resolvedOutlineSnapshot(item) ?? { title: item.title, plan: item.plan },
          manualExcellent: sourceIsDirectContent ? item.manualExcellent : sourceVersion?.manualExcellent ?? activeManualExcellent(item),
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
        await deleteOfflineContentDraft(outlineId);
        return true;
      }
      const version: Version = { id: makeId("version"), name: `未保存内容 · ${new Date(savedAt).toLocaleString("zh-CN")}`, content: text, source: "未保存内容", createdAt: savedAt, outlineSnapshot: { title: existing.title, plan: existing.plan }, manualExcellent: activeManualExcellent(existing), excellentFragments: cloneExcellentFragments(text, reanchorExcellentFragments(resolvedOutlineContent(existing), text, activeExcellentFragments(existing))) };
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, versions: [version, ...item.versions] } : item) })) })) };
      dataRef.current = snapshot;
      setData(snapshot);
      const saved = await enqueueSave(snapshot);
      if (saved) {
        window.sessionStorage.removeItem(`${draftPrefix}${outlineId}`);
        await deleteOfflineContentDraft(outlineId);
      }
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
        return { ...item, versions: [{ id, name: name || timestampContentName(createdAt), source, createdAt, content: nextContent, outlineSnapshot: metadata?.outlineSnapshot ?? inheritedOutlineSnapshot ?? { title: item.title, plan: item.plan }, settingSnapshot: metadata?.settingSnapshot ?? resolveChapterSettings(article, chapter.id), ...metadata, manualExcellent, excellentFragments }, ...item.versions] };
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
        if (item.id !== outlineId || (versionId && !item.versions.some((version) => version.id === versionId))) return item;
        return { ...item, currentVersionId: versionId ?? null, updatedAt: new Date().toISOString() };
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
      setData((current) => ({ ...current, articles: current.articles.map((article) => {
        if (article.id !== current.currentArticleId) return article;
        const removedRelationshipIds = new Set(article.relationships.filter((relationship) => relationship.characterAId === characterId || relationship.characterBId === characterId).map((relationship) => relationship.id));
        return {
          ...article,
          characters: article.characters.filter((character) => character.id !== characterId),
          relationships: article.relationships.filter((relationship) => !removedRelationshipIds.has(relationship.id)),
          chapters: article.chapters.map((chapter) => {
            const settings = normalizeChapterSettings(chapter.settings);
            const characters = { ...settings.characters };
            delete characters[characterId];
            return { ...chapter, settings: { ...settings, characters, relationships: Object.fromEntries(Object.entries(settings.relationships).filter(([id]) => !removedRelationshipIds.has(id))) } };
          }),
        };
      }) }));
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
      setData((current) => ({ ...current, articles: current.articles.map((article) => article.id === current.currentArticleId ? { ...article, relationships: article.relationships.filter((relationship) => relationship.id !== relationshipId), chapters: article.chapters.map((chapter) => { const settings = normalizeChapterSettings(chapter.settings); const relationships = { ...settings.relationships }; delete relationships[relationshipId]; return { ...chapter, settings: { ...settings, relationships } }; }) } : article) }));
    },
    async clearBusinessData() {
      try {
        const response = await fetchServerAction("/api/database/business-data", { method: "DELETE" });
        const payload = await response.json() as { revision?: number; databaseVersion?: number; error?: string };
        if (!response.ok || payload.revision === undefined) throw new Error(payload.error || "清除失败");
        saveEpochRef.current += 1;
        revisionRef.current = payload.revision;
        advanceStateIdentity(payload.revision, payload.databaseVersion);
        const cleared = emptyStudioData(dataRef.current.settings);
        dataRef.current = cleared;
        lastSavedRef.current = serializeDurable(cleared);
        setData(cleared);
        setConflict(null);
        setSaveStatus("saved");
        await persistOfflineCache(cleared);
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
      let serverIdentity: StudioStateIdentity | null = null;
      try {
        const response = await fetchFromServer("/api/state", { cache: "no-store" });
        const payload = await response.json() as Partial<StudioStatePayload>;
        if (response.ok && payload.data && payload.revision !== undefined) {
          server = durableSnapshot(normalizeStudioData(payload.data));
          serverRevision = payload.revision;
          serverIdentity = stateIdentityFromPayload(payload);
        }
      } catch { /* The conflict response is still a valid database snapshot. */ }
      const resolved = resolveStudioConflict(conflict.base, conflict.local, server, choice === "keep-local" ? "local" : "server");
      const withDeviceUi = applyDeviceUi(resolved, deviceUiFromData(dataRef.current));
      saveEpochRef.current += 1;
      revisionRef.current = serverRevision;
      if (serverIdentity) stateIdentityRef.current = serverIdentity;
      else advanceStateIdentity(serverRevision);
      lastSavedRef.current = stableStudioStringify(server);
      dataRef.current = withDeviceUi;
      setData(withDeviceUi);
      setConflict(null);
      setSaveStatus("unsaved");
      await enqueueSave(withDeviceUi);
    },
  }), [data, executionOrigin, hydrated, saveStatus, saveError, conflict, currentArticle, currentChapter, currentOutline, acceptServerMutation, advanceStateIdentity, enqueueSave, persistOfflineCache, refreshFromServer, setData]);

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
