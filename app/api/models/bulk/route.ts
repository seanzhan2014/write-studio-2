import { createModels } from "@/db/ai";

export async function POST(request: Request) {
  try {
    const result = await createModels(await request.json());
    return Response.json(result, { status: result.models.length ? 201 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "模型批量创建失败" }, { status: 400 });
  }
}
