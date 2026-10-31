export class RequestInputError extends Error {}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await request.json(); }
  catch { throw new RequestInputError("请求体必须是 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestInputError("请求体必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}
