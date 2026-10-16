import { executeIllustration, getIllustration } from "@/db/illustrations";

// Share the execution response without importing a route entrypoint: production
// bundles route exports into the router rather than exposing their named exports.
export async function illustrationExecutionResponse(id: string) {
  try { await getIllustration(id); }
  catch { return Response.json({ error: "任务不存在" }, { status: 404 }); }
  // Keep hosted execution alive while the author works elsewhere in the app.
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
