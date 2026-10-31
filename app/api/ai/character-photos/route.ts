import { photoOverview, uploadCharacterPhoto, updatePhotoGallery, createPhotoJobs, executePhotoJob, dispatchPhotoJobs, changePhotoJob, refreshCharacterLibrary, saveFormalPhotosToLibrary } from "@/db/character-photos";
import { normalizePhotoDraft } from "@/lib/character-photos";
import { isIllustrationStylePreset } from "@/lib/illustration-styles";
import { listProviders } from "@/db/ai-models";
import { isSpicyApi } from "@/lib/spicy-api";
import { isCloudDatabase } from "@/db/sqlite";
import { readStudioState } from "@/db/runtime";
import { resolvePhotoModel } from "@/db/photo-model-resolution";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    if (q.has("modelId")) return reply((await resolvePhotoModel(q.get("modelId") || "", q.get("references") === "1")).resolution);
    if (q.has("dispatch")) {
      const state = await readStudioState();
      return reply({ ids: isCloudDatabase() ? await dispatchPhotoJobs() : [], revision: state.revision });
    }
    return reply({ ...await photoOverview(q.get("characterId") || undefined), providers: (await listProviders()).map(p => ({ id: p.id, name: p.name, hasSecret: p.hasSecret, characterLibrary: isSpicyApi(p) })) });
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "无法读取人物照片" }, 400); }
}
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 14_100_000) return reply({ error: "上传照片超过 10 MB" }, 413);
    const raw = await request.text();
    if (raw.length > 14_100_000) return reply({ error: "上传照片超过 10 MB" }, 413);
    const body = JSON.parse(raw);
    const id = String(body.characterId || "");
    if (body.action === "execute") { await executePhotoJob(String(body.jobId || "")); return reply({ ok: true }); }
    if (!id || id.length > 200) throw new Error("请先保存人物资料");
    if (body.action === "upload") return reply(await uploadCharacterPhoto(id, body.dataUrl, body.name));
    if (body.action === "generate") return reply({ jobs: await createPhotoJobs(id, body.requestId, body.draft, body.retryId) });
    if (body.action === "job") { await changePhotoJob(String(body.jobId || ""), id, body.operation); return reply({ ok: true }); }
    if (body.action === "refresh") return reply(await refreshCharacterLibrary(id, body.providerId && body.remoteCharacterId ? { providerId: String(body.providerId), characterId: String(body.remoteCharacterId) } : undefined));
    if (body.action === "sync") return reply(await saveFormalPhotosToLibrary(id));
    return reply(await updatePhotoGallery(id, g => {
      const photo = g.photos.find(p => p.id === body.photoId);
      if (body.action === "draft") { g.draft = normalizePhotoDraft(body.draft); return; }
      if (body.action === "style") { if (body.style !== "follow" && !isIllustrationStylePreset(body.style)) throw new Error("图像风格无效"); g.stylePreset = body.style; return; }
      if (body.action === "unbind") { delete g.binding; return; }
      if (body.action === "cleanup") { g.photos.forEach(p => { if (p.status === "candidate" && !p.favorite && !g.referenceIds.includes(p.id) && g.draft.basePhotoId !== p.id && !g.draft.referenceIds.includes(p.id)) p.status = "archived"; }); return; }
      if (body.action === "references") {
        if (!Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some((id: string) => !g.photos.some(p => p.id === id && p.status !== "archived"))) throw new Error("参考照片无效");
        g.referenceIds = [...new Set(body.ids)] as string[]; return;
      }
      if (body.action === "reorder") {
        const formal = g.photos.filter(p => p.status === "approved");
        if (!Array.isArray(body.ids) || body.ids.length !== formal.length || new Set(body.ids).size !== formal.length || body.ids.some((id: string) => !formal.some(p => p.id === id))) throw new Error("相册顺序已改变，请刷新后重试");
        const order = body.ids as string[];
        g.photos.sort((a, b) => (a.status === "approved" ? order.indexOf(a.id) : 1000) - (b.status === "approved" ? order.indexOf(b.id) : 1000)); return;
      }
      if (!photo) throw new Error("照片不存在");
      if (body.action === "adopt" || body.action === "cover") {
        if (photo.status !== "approved" && g.photos.filter(p => p.status === "approved").length >= 100) throw new Error("正式相册最多保存 100 张照片");
        photo.status = "approved";
        if (!g.referenceIds.length) g.referenceIds = [photo.id];
        if (body.action === "cover" || !g.coverId) g.coverId = photo.id;
      } else if (body.action === "favorite") photo.favorite = !photo.favorite;
      else if (body.action === "rename") photo.name = String(body.name || "人物照片").trim().slice(0, 200);
      else if (body.action === "archive") {
        photo.status = "archived"; g.referenceIds = g.referenceIds.filter(id => id !== photo.id);
        g.draft.referenceIds = g.draft.referenceIds.filter(id => id !== photo.id);
        if (g.draft.basePhotoId === photo.id) g.draft.basePhotoId = "";
        if (g.coverId === photo.id) g.coverId = g.photos.find(p => p.status === "approved")?.id || "";
      } else if (body.action === "restore") photo.status = "reference";
      else throw new Error("未知照片操作");
    }));
  } catch (e) { return reply({ error: e instanceof Error ? e.message : "人物照片操作失败" }, 400); }
}
