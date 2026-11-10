import { normalizeOutlineExpansion, normalizeOutlineLengthMode, rebaseOutlineExpansion, withOutlineLengthMode } from "@/lib/outline-expansion";
import { createInheritedAiSettings } from "@/lib/ai-settings-inheritance";
import { normalizeStudioData } from "@/lib/studio-normalization";
import { outline, makeId, findOutlineInArticle, firstOutline, activeExcellentFragments, activeManualExcellent } from "@/lib/studio-entities";

import type { ChatSession, Version, Article, TaskExecutionOrigin, StudioData } from "@/lib/studio-types";

import { normalizeAppearance } from "@/lib/appearance.mjs";

import { timestampContentName } from "@/lib/content-name.mjs";
import { cloneExcellentFragments, normalizeExcellentFragments, reanchorExcellentFragments, toggleExcellentFragment } from "@/lib/excellent-fragments.mjs";
import { currentOutlineVersion, deleteOutlineVersion, resolvedOutlineContent, resolvedOutlineSnapshot, selectOutlineVersion } from "@/lib/outline-content";
import { normalizeOutlineTitle } from "@/lib/outline-title";
import { createDefaultReviewRules } from "@/lib/review-rules.mjs";
import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE } from "@/lib/naming-options";
import { appendNameVersion, normalizeNameVersionState } from "@/lib/name-versions";

import { deleteOfflineContentDraft, writeOfflineContentDraft } from "@/lib/offline-store";

import { moveOutlineBetweenChapters, moveOutlineToChapterEnd } from "@/app/outline-order.mjs";
import { duplicateArticleForCopy, duplicateArticlesForImport, duplicateOutlineForImport } from "@/lib/data-transfer";
import { EMPTY_ARTICLE_STORY_SETTINGS, EMPTY_CHAPTER_SETTINGS, normalizeChapterSettings, resolveOutlineSettings } from "@/lib/story-settings";
import { draftPrefix } from "./studio-storage-keys";
import type { StudioContextValue } from "./studio-context";

type ActionDependencies = {
  dataRef: { current: StudioData };
  setData: (update: StudioData | ((current: StudioData) => StudioData)) => void;
  executionOrigin: TaskExecutionOrigin;
  enqueueSave: (data: StudioData) => Promise<boolean>;
};

export function createStudioActions({ dataRef, setData, executionOrigin, enqueueSave }: ActionDependencies): Pick<StudioContextValue, "setCurrentArticle" | "setCurrentOutline" | "createArticle" | "duplicateArticle" | "updateArticle" | "deleteArticle" | "createChapter" | "updateChapter" | "applyGeneratedNames" | "addGeneratedNameCandidates" | "addManualNameVersion" | "setDefaultNameVersion" | "deleteNameVersion" | "moveChapter" | "deleteChapter" | "createOutline" | "updateOutline" | "saveOutlinePlan" | "stageContentDraft" | "clearContentDraft" | "createBlankContent" | "saveCurrentContent" | "commitContentEdit" | "preserveContentDraft" | "moveOutline" | "moveOutlineToChapter" | "copyOutline" | "importOutline" | "importArticles" | "importSettings" | "deleteOutline" | "saveVersion" | "toggleExcellentFragment" | "setBodyExcellent" | "setCurrentVersion" | "setDefaultVersion" | "applyVersion" | "applyVersionWithBackup" | "renameVersion" | "deleteVersion" | "createChatSession" | "setActiveChatSession" | "renameChatSession" | "deleteChatSession" | "branchChatSession" | "setChatDraft" | "setChatSetting" | "addChatMessage" | "replaceChatMessages" | "markChatSessionRead" | "clearChat" | "addTask" | "updateTask" | "removeTask" | "clearCompletedTasks" | "updateSettings" | "addCharacter" | "updateCharacter" | "deleteCharacter" | "addRelationship" | "updateRelationship" | "deleteRelationship"> {
  return {
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
        aiGenerateSettings: createInheritedAiSettings("generate"),
        illustrationSettings: createInheritedAiSettings("illustration"),
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
          items.splice(Math.max(0, index), 0, { ...outline(id, "", "", ""), expansion: withOutlineLengthMode(undefined, normalizeOutlineLengthMode(current.settings.outlineLengthMode)) });
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
        return { ...item, ...patch, ...(Object.hasOwn(patch, "expansion") ? { expansion: normalizeOutlineExpansion(patch.plan ?? item.plan, patch.expansion) } : planChanged ? { expansion: rebaseOutlineExpansion(item.plan, patch.plan!, item.expansion) } : {}), titleGenerationPending, updatedAt: new Date().toISOString() };
      }) })) })) }));
    },
saveOutlinePlan(outlineId, plan, expansion) {
      const updatedAt = new Date().toISOString();
      const nextPlan = plan.slice(0, 10000);
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, updatedAt: article.id === dataRef.current.currentArticleId ? updatedAt : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, plan: nextPlan, expansion: expansion ? normalizeOutlineExpansion(nextPlan, expansion) : rebaseOutlineExpansion(item.plan, nextPlan, item.expansion), titleGenerationPending: nextPlan !== item.plan ? true : item.titleGenerationPending, updatedAt } : item) })) })) };
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
createBlankContent(outlineId) {
      const updatedAt = new Date().toISOString();
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, updatedAt: article.id === dataRef.current.currentArticleId ? updatedAt : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        if (item.id !== outlineId) return item;
        const preserveDirectContent = !currentOutlineVersion(item) && item.content.length > 0;
        const preservedVersion: Version | undefined = preserveDirectContent ? {
          id: makeId("version"),
          name: item.contentName?.trim() || timestampContentName(item.updatedAt),
          content: item.content,
          source: "手动",
          createdAt: updatedAt,
          outlineSnapshot: item.contentOutlineSnapshot ?? { title: item.title, plan: item.plan },
          settingSnapshot: resolveOutlineSettings(article, item.id),
          manualExcellent: item.manualExcellent === true,
          excellentFragments: cloneExcellentFragments(item.content, item.excellentFragments ?? []),
        } : undefined;
        return {
          ...item,
          content: "",
          contentName: timestampContentName(updatedAt),
          currentVersionId: null,
          contentOutlineSnapshot: { title: item.title, plan: item.plan },
          manualExcellent: false,
          excellentFragments: [],
          updatedAt,
          versions: preservedVersion ? [preservedVersion, ...item.versions] : item.versions,
        };
      }) })) })) };
      dataRef.current = snapshot;
      setData(snapshot);
      window.sessionStorage.removeItem(`${draftPrefix}${outlineId}`);
      void deleteOfflineContentDraft(outlineId);
      return enqueueSave(snapshot);
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
      const snapshot = { ...dataRef.current, articles: dataRef.current.articles.map((article) => ({ ...article, updatedAt: article.id === dataRef.current.currentArticleId ? updatedAt : article.updatedAt, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? selectOutlineVersion({ ...item, versions: [version, ...item.versions] }, versionId, updatedAt) : item) })) })) };
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
          items.splice(index + 1, 0, { ...outline(id, sourceTitle ? `${sourceTitle}（副本）` : "", source.plan, ""), expansion: source.expansion ? structuredClone(source.expansion) : undefined, titleGenerationPending: true, archived: source.archived });
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
        return { ...item, versions: [{ id, name: name || timestampContentName(createdAt), source, createdAt, content: nextContent, outlineSnapshot: metadata?.outlineSnapshot ?? inheritedOutlineSnapshot ?? { title: item.title, plan: item.plan }, settingSnapshot: metadata?.settingSnapshot ?? resolveOutlineSettings(article, item.id), ...metadata, manualExcellent, excellentFragments }, ...item.versions] };
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
        return selectOutlineVersion(item, versionId ?? null);
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
        return selected ? selectOutlineVersion(item, selected.id) : item;
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
        return selectOutlineVersion({ ...item, versions: [backup, ...item.versions] }, selected.id, createdAt);
      }) })) })) }));
      return backupId;
    },
renameVersion(outlineId, versionId, name) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => item.id === outlineId ? { ...item, versions: item.versions.map((version) => version.id === versionId ? { ...version, name } : version) } : item) })) })) }));
    },
deleteVersion(outlineId, versionId) {
      setData((current) => ({ ...current, articles: current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((item) => {
        return item.id === outlineId ? deleteOutlineVersion(item, versionId) : item;
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
      setData((current) => {
        const settings = { ...current.settings, ...patch };
        return { ...current, settings: { ...settings, ...normalizeAppearance(settings) } };
      });
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
    }
  };
}
