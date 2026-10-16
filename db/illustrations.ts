import { AiInputError, findModel, generateIllustrationImage, generateIllustrationPrompt } from "./ai";
import { ensureDatabase, getDatabase } from "./runtime";
import { deleteIllustrationAsset, saveIllustrationAsset } from "./illustration-assets";
import { MAX_ILLUSTRATION_CONTENT, MAX_ILLUSTRATION_EXCERPT, MAX_ILLUSTRATION_PROMPT } from "@/lib/image-generation";
import { supportsImages, supportsText } from "@/lib/ai-model-capabilities";
import type { IllustrationRecord } from "@/lib/illustration-history";
import { isCloudDatabase } from "./sqlite";
import type { IllustrationImage, IllustrationPrompt } from "@/lib/image-generation";

type Row = Record<string, unknown>;
export type IllustrationInput = {
  action: "prompt" | "image"; outlineId: string; model: string;
  content?: string; excerpt?: string; style?: string; prompt?: string;
  size?: string; quality?: string; aspectRatio?: string; resolution?: string;
};
const columns = "h.*,o.title AS outline_title";
const join = "illustration_history h JOIN outlines o ON o.id=h.outline_id";
const controllers = new Map<string, AbortController>();
function record(row: Row): IllustrationRecord {
  return {
    id: String(row.id), outlineId: String(row.outline_id), outlineTitle: String(row.outline_title || "未命名大纲"),
    kind: row.kind as IllustrationRecord["kind"], status: row.status as IllustrationRecord["status"],
    prompt: String(row.prompt), excerpt: String(row.excerpt), style: String(row.style),
    model: String(row.model_id), modelName: String(row.model_name), archived: Number(row.archived) === 1,
    createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : undefined,
    error: row.error_message ? String(row.error_message) : undefined,
    src: row.asset_key ? `/api/ai/illustrations/${row.id}/image` : undefined,
    revisedPrompt: row.revised_prompt ? String(row.revised_prompt) : undefined,
  };
}
export async function illustrationRow(id: string) {
  await ensureDatabase();
  return getDatabase().prepare(`SELECT ${columns} FROM ${join} WHERE h.id=?`).bind(id).first<Row>();
}
export async function getIllustration(id: string) {
  const row = await illustrationRow(id);
  if (!row) throw new AiInputError("插图历史不存在或已删除");
  return record(row);
}
async function recoverInterrupted() {
  await getDatabase().prepare("UPDATE illustration_history SET status='error',error_message='任务执行已中断，请重试',runner_id=NULL,lease_until=NULL,completed_at=? WHERE status='running' AND lease_until<?")
    .bind(new Date().toISOString(), new Date().toISOString()).run();
}
export async function listIllustrations(outlineId: string | null, offset = 0) {
  await ensureDatabase();
  await recoverInterrupted();
  if (outlineId && !await getDatabase().prepare("SELECT id FROM outlines WHERE id=?").bind(outlineId).first()) throw new AiInputError("正文不存在");
  const result = await getDatabase().prepare(`SELECT ${columns} FROM ${join} WHERE ${outlineId ? "o.article_id=(SELECT article_id FROM outlines WHERE id=?)" : "h.status IN ('queued','running')"} ORDER BY h.created_at DESC,h.id DESC LIMIT 101 OFFSET ?`)
    .bind(...(outlineId ? [outlineId, offset] : [offset])).all<Row>();
  return { records: (result.results ?? []).slice(0, 100).map(record), hasMore: (result.results?.length ?? 0) > 100, backgroundMode: isCloudDatabase() ? "app" : "service" };
}

// Preserve the synchronous endpoint for existing clients, with the same durable
// library behavior as background generation.
export async function saveCompletedIllustration(input: IllustrationInput, output: IllustrationImage | IllustrationPrompt) {
  await ensureDatabase();
  const model = await findModel(input.model);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const asset = "src" in output ? await saveIllustrationAsset(output.src) : undefined;
  try {
    await getDatabase().prepare("INSERT INTO illustration_history(id,outline_id,kind,status,prompt,excerpt,style,model_id,model_name,input_json,asset_key,mime_type,revised_prompt,created_at,completed_at) VALUES(?,?,?,'success',?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, input.outlineId, input.action, "prompt" in output ? output.prompt : input.prompt || "", "excerpt" in output ? output.excerpt : input.excerpt || "", input.style || "", model?.id || input.model, model?.name || input.model, JSON.stringify(input), asset?.key ?? null, asset?.mime ?? null, "revisedPrompt" in output ? output.revisedPrompt ?? null : null, now, now).run();
    return getIllustration(id);
  } catch (error) { if (asset) await deleteIllustrationAsset(asset.key).catch(() => {}); throw error; }
}
function checkedText(value: unknown, maximum: number, message: string, required = false) {
  if ((value !== undefined && typeof value !== "string") || (typeof value === "string" && value.length > maximum) || (required && (typeof value !== "string" || !value.trim()))) throw new AiInputError(message);
  return typeof value === "string" ? value.trim() : "";
}
async function checkTarget(outlineId: unknown) {
  if (typeof outlineId !== "string" || !outlineId || !await getDatabase().prepare("SELECT o.id FROM outlines o JOIN chapters c ON c.id=o.chapter_id WHERE o.id=? AND o.archived=0 AND c.archived=0").bind(outlineId).first()) throw new AiInputError("正文不存在或已归档");
  return outlineId;
}
export async function saveManualPrompt(input: Row) {
  await ensureDatabase();
  const outlineId = await checkTarget(input.outlineId);
  const prompt = checkedText(input.prompt, MAX_ILLUSTRATION_PROMPT, "图片 prompt 不能为空，且不能超过 12,000 字符", true);
  const excerpt = checkedText(input.excerpt, MAX_ILLUSTRATION_EXCERPT, "正文片段过长");
  const style = checkedText(input.style, 2000, "画面要求过长");
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await getDatabase().prepare("INSERT INTO illustration_history(id,outline_id,kind,status,prompt,excerpt,style,created_at,completed_at) VALUES(?,?,'prompt','success',?,?,?,?,?)")
    .bind(id, outlineId, prompt, excerpt, style, now, now).run();
  return getIllustration(id);
}
export async function createIllustration(input: Row, id: string) {
  await ensureDatabase();
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new AiInputError("任务标识无效");
  const outlineId = await checkTarget(input.outlineId);
  if (input.action !== "prompt" && input.action !== "image") throw new AiInputError("插图操作无效");
  const model = typeof input.model === "string" ? await findModel(input.model) : null;
  if (!model || !model.hasSecret || !(input.action === "image" ? supportsImages(model) : supportsText(model))) throw new AiInputError("请选择已设置密钥且支持此操作的模型");
  const excerpt = checkedText(input.excerpt, MAX_ILLUSTRATION_EXCERPT, "正文片段无效");
  const style = checkedText(input.style, 2000, "画面要求不能超过 2,000 字符");
  const prompt = checkedText(input.prompt, MAX_ILLUSTRATION_PROMPT, "图片 prompt 不能为空，且不能超过 12,000 字符", input.action === "image");
  const body: IllustrationInput = { action: input.action, outlineId, model: model.id, excerpt, style, prompt };
  if (input.action === "prompt") {
    const content = checkedText(input.content, MAX_ILLUSTRATION_CONTENT, "正文为空或超过 80,000 字符，请先选取片段", true);
    if (excerpt && !content.includes(excerpt)) throw new AiInputError("片段必须来自正文");
    body.content = content;
  }
  for (const key of ["size", "quality", "aspectRatio", "resolution"] as const) {
    if (input[key] !== undefined) body[key] = checkedText(input[key], 100, "图像参数无效");
  }
  const existing = await illustrationRow(id);
  if (existing) {
    if (existing.input_json !== JSON.stringify(body)) throw new AiInputError("任务标识已被其他请求使用");
    return record(existing);
  }
  const active = await getDatabase().prepare("SELECT COUNT(*) AS count FROM illustration_history WHERE status IN ('queued','running')").first<number>("count");
  if (Number(active) >= 20) throw new AiInputError("已有 20 个插图任务，请等待完成后重试");
  await getDatabase().prepare("INSERT OR IGNORE INTO illustration_history(id,outline_id,kind,status,prompt,excerpt,style,model_id,model_name,input_json,created_at) VALUES(?,?,?,'queued',?,?,?,?,?,?,?)")
    .bind(id, outlineId, body.action, prompt, excerpt, style, model.id, model.name, JSON.stringify(body), new Date().toISOString()).run();
  const saved = await illustrationRow(id);
  if (!saved || saved.input_json !== JSON.stringify(body)) throw new AiInputError("任务标识已被其他请求使用");
  return record(saved);
}
export async function executeIllustration(id: string) {
  await ensureDatabase();
  await recoverInterrupted();
  const row = await illustrationRow(id);
  if (!row || row.status !== "queued") return;
  const runner = crypto.randomUUID();
  const lease = () => new Date(Date.now() + 90_000).toISOString();
  const result = await getDatabase().prepare("UPDATE illustration_history SET status='running',runner_id=?,lease_until=? WHERE id=? AND status='queued'").bind(runner, lease(), id).run();
  if (!Number(result.meta?.changes)) return;
  const controller = new AbortController(); controllers.set(id, controller);
  const heartbeat = setInterval(() => {
    void getDatabase().prepare("UPDATE illustration_history SET lease_until=? WHERE id=? AND status='running' AND runner_id=?").bind(lease(), id, runner).run().then(async (update) => {
      if (!Number(update.meta?.changes)) controller.abort();
    }).catch(() => controller.abort());
  }, 15_000);
  let asset: { key: string; mime: string } | undefined;
  try {
    const input = JSON.parse(String(row.input_json)) as IllustrationInput;
    let prompt = String(row.prompt), excerpt = String(row.excerpt), revisedPrompt: string | undefined;
    if (input.action === "prompt") {
      const generated = await generateIllustrationPrompt({ ...input, content: input.content! }, controller.signal);
      prompt = generated.prompt; excerpt = generated.excerpt;
    } else {
      const image = await generateIllustrationImage({ ...input, prompt: input.prompt! }, controller.signal);
      asset = await saveIllustrationAsset(image.src); revisedPrompt = image.revisedPrompt;
    }
    const saved = await getDatabase().prepare("UPDATE illustration_history SET status='success',prompt=?,excerpt=?,asset_key=?,mime_type=?,revised_prompt=?,completed_at=?,runner_id=NULL,lease_until=NULL WHERE id=? AND status='running' AND runner_id=?")
      .bind(prompt, excerpt, asset?.key ?? null, asset?.mime ?? null, revisedPrompt ?? null, new Date().toISOString(), id, runner).run();
    if (!Number(saved.meta?.changes) && asset) await deleteIllustrationAsset(asset.key);
  } catch (error) {
    if (asset) await deleteIllustrationAsset(asset.key).catch(() => {});
    await getDatabase().prepare("UPDATE illustration_history SET status='error',error_message=?,completed_at=?,runner_id=NULL,lease_until=NULL WHERE id=? AND status='running' AND runner_id=?")
      .bind(error instanceof Error ? error.message : "插图生成失败", new Date().toISOString(), id, runner).run();
  } finally { clearInterval(heartbeat); controllers.delete(id); }
}
export async function dispatchIllustrations() {
  await ensureDatabase(); await recoverInterrupted();
  const running = Number(await getDatabase().prepare("SELECT COUNT(*) AS count FROM illustration_history WHERE status='running'").first<number>("count"));
  const available = Math.max(0, 2 - running);
  if (!available) return;
  const rows = await getDatabase().prepare("SELECT id FROM illustration_history WHERE status='queued' ORDER BY created_at LIMIT ?").bind(available).all<{ id: string }>();
  for (const row of rows.results ?? []) void executeIllustration(row.id).catch(error => console.error("Illustration task failed", error));
}
export async function updateIllustration(id: string, action: unknown) {
  const row = await illustrationRow(id);
  if (!row) throw new AiInputError("历史记录不存在");
  if (action === "retry") {
    if (!["error", "cancelled"].includes(String(row.status))) throw new AiInputError("只能重试失败或已取消的任务");
    return createIllustration(JSON.parse(String(row.input_json)), crypto.randomUUID());
  }
  if (action === "cancel") {
    await getDatabase().prepare("UPDATE illustration_history SET status='cancelled',completed_at=?,runner_id=NULL,lease_until=NULL WHERE id=? AND status IN ('queued','running')").bind(new Date().toISOString(), id).run();
    controllers.get(id)?.abort();
  } else if (action === "archive" || action === "restore") {
    if (row.kind !== "prompt" || row.status !== "success") throw new AiInputError("只能归档已保存的 prompt");
    await getDatabase().prepare("UPDATE illustration_history SET archived=? WHERE id=?").bind(action === "archive" ? 1 : 0, id).run();
  } else throw new AiInputError("历史操作无效");
  return getIllustration(id);
}
export async function removeIllustration(id: string) {
  const row = await illustrationRow(id);
  if (!row) return;
  if (["queued", "running"].includes(String(row.status))) throw new AiInputError("请先取消任务再删除");
  if (row.asset_key) await deleteIllustrationAsset(String(row.asset_key));
  await getDatabase().prepare("DELETE FROM illustration_history WHERE id=?").bind(id).run();
}
