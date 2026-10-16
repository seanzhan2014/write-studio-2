import { illustrationExecutionResponse } from "../../execute";

export const dynamic = "force-dynamic";
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return illustrationExecutionResponse(id);
}
