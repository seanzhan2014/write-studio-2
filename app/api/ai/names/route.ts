import { AiInputError, AiPromptTooLongError, generateNames } from "@/db/ai";
import { ensureDatabase, getDatabase } from "@/db/runtime";
import { appendNameVersion, normalizeNameVersionState, type NameVersion } from "@/lib/name-versions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Parameters<typeof generateNames>[0] & { persist?: boolean; modelLabel?: string };
    if (body.target !== "outline" && body.target !== "chapter") return Response.json({ error: "命名目标无效" }, { status: 400 });
    body.articleId = String(body.articleId ?? "");
    body.chapterId = String(body.chapterId ?? "");
    body.outlineId = body.outlineId ? String(body.outlineId) : undefined;
    body.model = String(body.model ?? "");
    body.instruction = String(body.instruction ?? "").trim();
    body.includeChapter = body.includeChapter !== false;
    body.outlineIds = Array.isArray(body.outlineIds) ? [...new Set(body.outlineIds.map(String))].slice(0, 500) : undefined;
    if (!body.articleId || !body.chapterId || (body.target === "outline" && !body.outlineId)) return Response.json({ error: "命名目标不完整" }, { status: 400 });
    if (body.instruction.length > 20000) return Response.json({ error: "补充要求不能超过 20,000 字符" }, { status: 400 });
    const generated = await generateNames(body, request.signal);
    if (body.persist !== true) return Response.json(generated);
    await ensureDatabase();
    const db = getDatabase();
    const chapter = await db.prepare("SELECT c.title,c.name_versions_json,c.default_name_version_id,c.archived,a.updated_at FROM chapters c JOIN articles a ON a.id=c.article_id WHERE c.id=? AND c.article_id=?").bind(body.chapterId, body.articleId).first<Record<string, unknown>>();
    if (!chapter || Number(chapter.archived)) throw new AiInputError("命名目标不存在或已归档");
    const createdAt = new Date().toISOString();
    const modelLabel = String(body.modelLabel ?? body.model ?? "").slice(0, 300) || undefined;
    let added = 0;
    let chapterState: ReturnType<typeof normalizeNameVersionState> | undefined;
    const statements = [];
    if (generated.chapterTitle) {
      const current = normalizeNameVersionState(body.chapterId, chapter.title, JSON.parse(String(chapter.name_versions_json ?? "[]")) as NameVersion[], chapter.default_name_version_id, String(chapter.updated_at), 120);
      const next = appendNameVersion(current, { id: `name-ai-${crypto.randomUUID()}`, title: generated.chapterTitle, source: "ai", createdAt, model: modelLabel, instruction: body.instruction || undefined }, 120);
      chapterState = next.state;
      if (next.added) {
        added += 1;
        statements.push(db.prepare("UPDATE chapters SET name_versions_json=?,default_name_version_id=?,updated_at=?,revision=revision+1 WHERE id=?").bind(JSON.stringify(next.state.nameVersions), next.state.defaultNameVersionId, createdAt, body.chapterId));
      }
    }
    const outlineStates = [];
    for (const item of generated.outlineTitles) {
      const outline = await db.prepare("SELECT title,name_versions_json,default_name_version_id,updated_at,archived FROM outlines WHERE id=? AND chapter_id=?").bind(item.id, body.chapterId).first<Record<string, unknown>>();
      if (!outline || Number(outline.archived)) continue;
      const current = normalizeNameVersionState(item.id, outline.title, JSON.parse(String(outline.name_versions_json ?? "[]")) as NameVersion[], outline.default_name_version_id, String(outline.updated_at), 80);
      const next = appendNameVersion(current, { id: `name-ai-${crypto.randomUUID()}`, title: item.title, source: "ai", createdAt, model: modelLabel, instruction: body.instruction || undefined }, 80);
      if (next.added) {
        added += 1;
        statements.push(db.prepare("UPDATE outlines SET name_versions_json=?,default_name_version_id=?,updated_at=?,revision=revision+1 WHERE id=?").bind(JSON.stringify(next.state.nameVersions), next.state.defaultNameVersionId, createdAt, item.id));
      }
      outlineStates.push({ id: item.id, updatedAt: next.added ? createdAt : String(outline.updated_at), ...next.state });
    }
    if (added > 0) {
      statements.push(db.prepare("UPDATE articles SET updated_at=?,revision=revision+1 WHERE id=?").bind(createdAt, body.articleId));
      statements.push(db.prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key IN ('state_revision','database_version')").bind(createdAt));
      await db.batch(statements);
    }
    const revision = Number(await db.prepare("SELECT value_json FROM app_settings WHERE key='state_revision'").first<string>("value_json") ?? 0);
    return Response.json({ ...generated, added, articleUpdatedAt: added > 0 ? createdAt : undefined, chapterState, outlineStates, revision });
  } catch (error) {
    const status = error instanceof AiPromptTooLongError ? 413 : error instanceof AiInputError ? 422 : 502;
    return Response.json({
      error: error instanceof Error ? error.message : "名称生成失败",
      ...(error instanceof AiPromptTooLongError ? { inputCharacters: error.inputCharacters, maxInputCharacters: error.maxInputCharacters } : {}),
    }, { status });
  }
}
