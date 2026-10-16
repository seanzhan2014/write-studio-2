import { illustrationRow } from "@/db/illustrations";
import { readIllustrationAsset } from "@/db/illustration-assets";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = await illustrationRow(id);
  if (!row?.asset_key || row.status !== "success") return new Response("图片不存在或已删除", { status: 404 });
  const body = await readIllustrationAsset(String(row.asset_key));
  if (!body) return new Response("图片文件不存在", { status: 404 });
  const mime = String(row.mime_type);
  const extension = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  return new Response(body as BodyInit, { headers: {
    "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${new URL(request.url).searchParams.has("download") ? "attachment" : "inline"}; filename="writer-studio-illustration.${extension}"`,
  } });
}
