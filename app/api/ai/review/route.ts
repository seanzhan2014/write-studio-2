import type { StudioData, Version } from "@/app/studio-state";
import { AiInputError, reviewChapter, type AiReviewInput } from "@/db/ai";
import { readStudioState, writeStudioState } from "@/db/runtime";
import { aiReviewContentName, resolvedOutlineContentName } from "@/lib/content-name.mjs";
import { reviewSourceDigest, type ReviewOutlineSource } from "@/lib/ai-review.mjs";
import { resolvedOutlineContent } from "@/lib/outline-content";
import { BUILTIN_REVIEW_REQUIREMENTS, normalizeReviewPresets } from "@/lib/review-options";

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
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
    type: article.type,
    style: article.style,
    characters: article.characters.filter((person) => !person.archived).map((person) => ({ name: person.name, aliases: person.aliases, description: person.description })),
  };
  return { article, chapter, outlines, inputArticle };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      articleId?: unknown;
      chapterId?: unknown;
      model?: unknown;
      requirements?: unknown;
      additionalRequirement?: unknown;
    };
    const articleId = String(body.articleId ?? "").trim();
    const chapterId = String(body.chapterId ?? "").trim();
    const model = String(body.model ?? "").trim();
    const requirements = normalizeReviewPresets(body.requirements);
    const additionalRequirement = String(body.additionalRequirement ?? "").trim().slice(0, 20_000);
    if (!articleId || !chapterId || !model) return json({ error: "请选择文章、章节和 Review 模型" }, 400);

    const initialState = await readStudioState();
    if (!initialState.data) return json({ error: "没有可用文章" }, 400);
    const initial = findChapterSource(initialState.data, articleId, chapterId);
    if (!initial) return json({ error: "Review 章节不存在" }, 404);
    if (!initial.outlines.length) return json({ error: "当前章节没有可供 Review 的默认正文" }, 400);
    const contextSnapshot = JSON.stringify({ article: initial.inputArticle, chapterTitle: initial.chapter.title });
    const result = await reviewChapter({
      article: initial.inputArticle,
      chapter: { id: initial.chapter.id, title: initial.chapter.title },
      outlines: initial.outlines,
      requirements,
      additionalRequirement,
      model,
    });
    const changed = result.revised.filter((item) => item.revisedText !== item.text);
    if (!changed.length) {
      return json({ updated: [], editCount: result.editCount, inputTokens: result.usage.promptTokens, outputTokens: result.usage.completionTokens });
    }

    const reviewId = `review-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const promptSnapshot = [...BUILTIN_REVIEW_REQUIREMENTS, ...requirements, ...(additionalRequirement ? [additionalRequirement] : [])].join("\n");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await readStudioState();
      if (!current.data) return json({ error: "正文数据已不存在" }, 409);
      const source = findChapterSource(current.data, articleId, chapterId);
      if (!source) return json({ error: "Review 章节已不存在" }, 409);
      const currentDigest = await reviewSourceDigest(chapterId, source.outlines);
      const currentContext = JSON.stringify({ article: source.inputArticle, chapterTitle: source.chapter.title });
      if (currentDigest !== result.sourceDigest || currentContext !== contextSnapshot) {
        return json({ error: "Review 期间章节正文或资料发生了变化，未覆盖任何正文", code: "review_source_changed" }, 409);
      }

      const revisedById = new Map(result.revised.map((item) => [item.id, item.revisedText]));
      const next = structuredClone(current.data);
      const targetArticle = next.articles.find((item) => item.id === articleId);
      const targetChapter = targetArticle?.chapters.find((item) => item.id === chapterId);
      if (!targetArticle || !targetChapter) return json({ error: "Review 章节已不存在" }, 409);
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
          model: result.model.name,
          modelId: result.model.modelId,
          prompt: promptSnapshot,
          taskId: reviewId,
          outlineSnapshot: { title: outline.title, plan: outline.plan },
        };
        outline.versions.unshift(version);
        outline.contentName = name;
        outline.contentOverride = false;
        outline.sourceVersionId = versionId;
        outline.updatedAt = createdAt;
        outline.state = "saved";
        updated.push({ outlineId: outline.id, versionId, name, text });
      }
      targetArticle.updatedAt = createdAt;
      const saved = await writeStudioState(next, current.revision);
      if (!saved.conflict) {
        return json({ updated, editCount: result.editCount, inputTokens: result.usage.promptTokens, outputTokens: result.usage.completionTokens });
      }
    }
    return json({ error: "保存 AI Review 结果时发生持续冲突，未覆盖任何正文" }, 409);
  } catch (error) {
    if (error instanceof AiInputError) return json({ error: error.message }, 400);
    return json({ error: error instanceof Error ? error.message : "AI Review 失败" }, 502);
  }
}
