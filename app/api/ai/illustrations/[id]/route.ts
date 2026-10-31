import { AiInputError } from "@/db/ai-errors";
import { getIllustration, removeIllustration, updateIllustration } from "@/db/illustrations";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "历史操作失败" }, { status: error instanceof AiInputError || error instanceof SyntaxError ? 400 : 500 });
}
export async function GET(_request: Request, context: Context) {
  try { return Response.json({ record: await getIllustration((await context.params).id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function PATCH(request: Request, context: Context) {
  try { return Response.json({ record: await updateIllustration((await context.params).id, (await request.json()).action) }); }
  catch (error) { return failure(error); }
}
export async function DELETE(_request: Request, context: Context) {
  try { await removeIllustration((await context.params).id); return new Response(null, { status: 204 }); }
  catch (error) { return failure(error); }
}
