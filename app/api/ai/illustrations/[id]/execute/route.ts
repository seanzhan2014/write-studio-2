import { executeIllustration, getIllustration } from "@/db/illustrations";

export const dynamic = "force-dynamic";
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try { await getIllustration(id); }
  catch { return Response.json({ error: "任务不存在" }, { status: 404 }); }
  // A streamed request keeps hosted execution alive while the author works in
  // another part of the app. Closing the illustration modal never aborts it.
  const encoder = new TextEncoder();
  let connected = true;
  const stream = new ReadableStream({
    start(controller) {
      const send = (value: string) => { if (connected) controller.enqueue(encoder.encode(value)); };
      send("\n");
      const heartbeat = setInterval(() => send("\n"), 10_000);
      void executeIllustration(id).then(() => send('{"done":true}\n')).catch(() => send('{"done":false}\n')).finally(() => {
        clearInterval(heartbeat);
        if (connected) controller.close();
      });
    },
    cancel() { connected = false; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
