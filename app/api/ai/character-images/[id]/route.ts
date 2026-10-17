import { readCharacterImage } from "@/db/character-visuals";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-f0-9-]+$/.test(id)) return new Response(null, { status: 404 });
  try {
    const asset = await readCharacterImage(`illustrations/${id}`);
    return asset ? new Response(asset.bytes as BodyInit, { headers: { "Content-Type": asset.mime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } }) : new Response(null, { status: 404 });
  } catch { return new Response(null, { status: 502 }); }
}
