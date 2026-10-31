import { readGenerateRequest } from "@/lib/generate-request";
import { RequestInputError } from "@/lib/request-input";
import { AiInputError } from "@/db/ai-errors";
import { generateText } from "@/db/ai";

export async function POST(request: Request) {
  try {
    const body = await readGenerateRequest(request);
    return Response.json(await generateText(body, request.signal));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "生成失败" }, { status: error instanceof RequestInputError ? 400 : error instanceof AiInputError ? 422 : 502 }); }
}
