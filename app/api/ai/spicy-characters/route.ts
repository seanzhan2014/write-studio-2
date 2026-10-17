import { spicyConnection, bindSpicyCharacter } from "@/db/character-visuals";
import { listSpicyCharacters, getSpicyCharacter } from "@/lib/spicy-api";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const { provider, secret } = await spicyConnection(query.get("providerId") || "");
    const id = query.get("characterId");
    return Response.json(id ? { character: await getSpicyCharacter(provider.baseUrl, secret, id) } : await listSpicyCharacters(provider.baseUrl, secret, query.get("cursor") || ""), { headers });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "无法读取角色库" }, { status: 400, headers }); }
}
export async function POST(request: Request) {
  try { return Response.json({ visual: await bindSpicyCharacter(await request.json()) }, { headers }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "无法绑定角色" }, { status: 400, headers }); }
}
