import { reasoningEffortError, type ReasoningOptions } from "@/lib/reasoning-options";
import type { StudioData, Version } from "@/app/studio-state";
import { AiInputError, reviewChapter, type AiReviewInput } from "@/db/ai";
import { applyStudioChanges, readStudioState } from "@/db/runtime";
import { aiReviewContentName, resolvedOutlineContentName } from "@/lib/content-name.mjs";
import { reviewSourceDigest, type ReviewOutlineSource } from "@/lib/ai-review.mjs";
import { currentOutlineVersion, resolvedOutlineContent } from "@/lib/outline-content";
import { createReviewRuleSnapshot, normalizeReviewRuleSnapshot, hasReviewRules, reviewRulesText, type ReviewRuleSnapshot } from "@/lib/review-rules.mjs";
import { normalizeReviewPresets } from "@/lib/review-options";
import { cloneExcellentFragments, normalizeExcellentFragments, reanchorExcellentFragments } from "@/lib/excellent-fragments.mjs";
import { modelSelectionLabel } from "@/lib/model-label";
import { diffStudioData } from "@/lib/studio-changes";
import { resolveChapterSettings } from "@/lib/story-settings";

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function reviewContextSnapshot(article: AiReviewInput["article"], chapterTitle: string) {
  // Rules are frozen at request creation; later rule edits must not invalidate
  // the result. Reference facts and body changes still protect current text.
  const { id, title, summary, type, style, era, location, tone, worldRules, negativeConstraints, characters } = article;
  return JSON.stringify({ article: { id, title, summary, type, style, era, location, tone, worldRules, negativeConstraints, characters }, chapterTitle });
}

function activeExcellentFragments(outline: StudioData["articles"][number]["chapters"][number]["outlines"][number]) {
  const version = currentOutlineVersion(outline);
  return version
    ? normalizeExcellentFragments(version.content, version.excellentFragments)
    : normalizeExcellentFragments(outline.content, outline.excellentFragments);
}

function findChapterSource(data: StudioData, articleId: string, chapterId: string) {
  const article = data.articles.find((item) => item.id === articleId);
  const chapter = article?.chapters.find((item) => item.id === chapterId);
  if (!article || !chapter) return null;
  const outlines: ReviewOutlineSource[] = chapter.outlines
    .filter((outline) => !outline.archived)
    .map((outline) => ({
      id: outline.id,
      title: outline.title,
      plan: outline.plan,
      name: resolvedOutlineContentName(outline),
      text: resolvedOutlineContent(outline),
    }))
    .filter((outline) => outline.text.trim());
  const inputArticle: AiReviewInput["article"] = {
    id: article.id,
    title: article.title,
    summary: article.summary,
    ...resolveChapterSettings(article, chapter.id).story,
    reviewRules: article.reviewRules ?? "",
    reviewRuleItems: article.reviewRuleItems,
    characters: resolveChapterSettings(article, chapter.id).characters.filter((person) => !person.archived && person.appears !== false).map((person) => ({ name: person.name, aliases: person.aliases, description: person.description, profile: person.profile, endingChanges: person.endingChanges })),
  };
  return { article, chapter, outlines, inputArticle };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as ReasoningOptions & {
      articleId?: unknown;
      chapterId?: unknown;
      model?: unknown;
      requirements?: unknown;
      ruleSnapshot?: ReviewRuleSnapshot;
      additionalRequirement?: unknown;
      source?: Omit<AiReviewInput, "outlines"> & { outlines: Array<ReviewOutlineSource & { baseText: string; sourceVersionId?: string }> };
    };
    const effortError = reasoningEffortError(body.reasoningEffort);
    if (effortError) return json({ error: effortError }, 400);
    const articleId = String(body.articleId ?? "").trim();
    const chapterId = String(body.chapterId ?? "").trim();
    const model = String(body.model ?? "").trim();
    const requirements = normalizeReviewPresets(body.requirements);
    const additionalRequirement = String(body.additionalRequirement ?? "").trim().slice(0, 20_000);
    if (!articleId || !chapterId || !model) return json({ error: "请选择文章、章节和 Review 模型" }, 400);

    const supplied = body.source && JSON.stringify(body.source).length <= 1_000_000 && body.source.article.id === articleId && body.source.chapter.id === chapterId ? structuredClone(body.source) : null;
    const initialState = await readStudioState();
    const storedArticle = initialState.data?.articles.find((article) => article.id === articleId);
    if (!storedArticle) return json({ error: "Review 文章不存在" }, 404);
    const ruleSnapshot = createReviewRuleSnapshot(storedArticle, additionalRequirement, requirements);
    if (body.ruleSnapshot !== undefined && JSON.stringify(normalizeReviewRuleSnapshot(body.ruleSnapshot)) !== JSON.stringify(ruleSnapshot)) return json({ error: "文章 Review 规则已变更，请重新打开 Review" }, 409);
    if (!hasReviewRules(ruleSnapshot)) return json({ error: "没有有效规则或本次附加要求，无需审校" }, 422);
    if (!supplied && !initialState?.data) return json({ error: "没有可用文章" }, 400);
    const stored = supplied ? null : findChapterSource(initialState!.data!, articleId, chapterId);
    if (!supplied && !stored) return json({ error: "Review 章节不存在" }, 404);
    const reviewInput: AiReviewInput = supplied ?? { article: stored!.inputArticle, chapter: { id: stored!.chapter.id, title: stored!.chapter.title }, outlines: stored!.outlines, requirements, additionalRequirement, model };
    if (!reviewInput.outlines.length) return json({ error: "当前章节没有可供 Review 的当前正文" }, 400);
    const contextSnapshot = reviewContextSnapshot(reviewInput.article, reviewInput.chapter.title);
    const result = await reviewChapter({
      reasoningEffort: body.reasoningEffort,
      article: reviewInput.article,
      chapter: reviewInput.chapter,
      outlines: reviewInput.outlines,
      requirements,
      ruleSnapshot,
      additionalRequirement,
      model,
    });
    const changed = result.revised.filter((item) => item.revisedText !== item.text);
    if (!changed.length && (!supplied || supplied.outlines.every((item) => item.text === item.baseText))) {
      return json({ updated: [], editCount: result.editCount, inputTokens: result.usage.promptTokens, outputTokens: result.usage.completionTokens });
    }

    const reviewId = `review-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const promptSnapshot = `${reviewRulesText(ruleSnapshot)}\n\n本次指令：${ruleSnapshot.instruction || "无"}`;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await readStudioState();
      if (!current.data) return json({ error: "正文数据已不存在" }, 409);
      const source = findChapterSource(current.data, articleId, chapterId);
      if (!source) return json({ error: "Review 章节已不存在" }, 409);
      const currentDigest = supplied ? result.sourceDigest : await reviewSourceDigest(chapterId, source.outlines);
      const currentContext = reviewContextSnapshot(source.inputArticle, source.chapter.title);
      const suppliedSourceChanged = supplied ? supplied.outlines.some((item) => {
        const outline = source.chapter.outlines.find((candidate) => candidate.id === item.id);
        return !outline || resolvedOutlineContent(outline) !== item.baseText;
      }) : false;
      if (currentDigest !== result.sourceDigest || currentContext !== contextSnapshot || suppliedSourceChanged) {
        return json({ error: "Review 期间章节正文或资料发生了变化，未覆盖任何正文", code: "review_source_changed" }, 409);
      }

      const revisedById = new Map(result.revised.map((item) => [item.id, item.revisedText]));
      const next = structuredClone(current.data);
      const targetArticle = next.articles.find((item) => item.id === articleId);
      const targetChapter = targetArticle?.chapters.find((item) => item.id === chapterId);
      if (!targetArticle || !targetChapter) return json({ error: "Review 章节已不存在" }, 409);
      if (supplied) for (const submitted of supplied.outlines) {
        const outline = targetChapter.outlines.find((item) => item.id === submitted.id);
        if (!outline || submitted.text === resolvedOutlineContent(outline)) continue;
        const sourceVersion = submitted.sourceVersionId ? outline.versions.find((version) => version.id === submitted.sourceVersionId) : undefined;
        const sourceText = sourceVersion?.content ?? resolvedOutlineContent(outline);
        const sourceFragments = sourceVersion ? normalizeExcellentFragments(sourceVersion.content, sourceVersion.excellentFragments) : activeExcellentFragments(outline);
        outline.content = submitted.text;
        outline.contentName = submitted.name;
        outline.currentVersionId = null;
        outline.contentOutlineSnapshot = sourceVersion?.outlineSnapshot ?? { title: outline.title, plan: outline.plan };
        outline.manualExcellent = sourceVersion?.manualExcellent ?? false;
        outline.excellentFragments = cloneExcellentFragments(submitted.text, reanchorExcellentFragments(sourceText, submitted.text, sourceFragments));
        outline.updatedAt = createdAt;
      }
      const updated: Array<{ outlineId: string; versionId: string; name: string; text: string }> = [];
      for (const outline of targetChapter.outlines) {
        const text = revisedById.get(outline.id);
        if (text === undefined || text === resolvedOutlineContent(outline)) continue;
        const versionId = `version-${crypto.randomUUID()}`;
        const name = aiReviewContentName(outline);
        const version: Version = {
          id: versionId,
          name,
          content: text,
          source: "AI Review",
          createdAt,
          model: modelSelectionLabel(result.model),
          modelId: result.model.modelId,
          prompt: promptSnapshot,
          reviewRuleSnapshot: ruleSnapshot,
          taskId: reviewId,
          outlineSnapshot: { title: outline.title, plan: outline.plan },
          settingSnapshot: resolveChapterSettings(targetArticle, targetChapter.id),
          excellentFragments: cloneExcellentFragments(text, reanchorExcellentFragments(resolvedOutlineContent(outline), text, activeExcellentFragments(outline))),
        };
        outline.versions.unshift(version);
        outline.currentVersionId = versionId;
        outline.updatedAt = createdAt;
        outline.state = "saved";
        updated.push({ outlineId: outline.id, versionId, name, text });
      }
      targetArticle.updatedAt = createdAt;
      const saved = await applyStudioChanges(diffStudioData(current.data, next), current.revision);
      if (!saved.conflict) {
        const affectedIds = new Set([...(supplied?.outlines.filter((item) => item.text !== item.baseText).map((item) => item.id) ?? []), ...updated.map((item) => item.outlineId)]);
        const patches = targetChapter.outlines.filter((outline) => affectedIds.has(outline.id)).map((outline) => ({
          outlineId: outline.id,
          content: outline.content,
          contentName: outline.contentName,
          currentVersionId: outline.currentVersionId,
          contentOutlineSnapshot: outline.contentOutlineSnapshot,
          manualExcellent: outline.manualExcellent,
          excellentFragments: outline.excellentFragments,
          versions: outline.versions,
          state: outline.state,
          updatedAt: outline.updatedAt,
        }));
        return json({ updated, patches, revision: saved.revision, articleUpdatedAt: targetArticle.updatedAt, editCount: result.editCount, inputTokens: result.usage.promptTokens, outputTokens: result.usage.completionTokens });
      }
    }
    return json({ error: "保存 AI Review 结果时发生持续冲突，未覆盖任何正文" }, 409);
  } catch (error) {
    if (error instanceof AiInputError) return json({ error: error.message }, 400);
    return json({ error: error instanceof Error ? error.message : "AI Review 失败" }, 502);
  }
}
