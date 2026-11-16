declare const __WRITER_STUDIO_BUILD_INFO__: { sourceHash: string; builtAt: string; target: "local" | "sites" };

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(__WRITER_STUDIO_BUILD_INFO__, { headers: { "Cache-Control": "no-store" } });
}
