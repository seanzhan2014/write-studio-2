import { createModels, deleteModels } from "@/db/ai-models";

export async function POST(request: Request) {
  try {
    const result = await createModels(await request.json());
    return Response.json(result, { status: result.models.length ? 201 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模型批量创建失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try { return Response.json(await deleteModels(await request.json())); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "模型批量删除失败" }, { status: 400 }); }
}
