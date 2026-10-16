import { isCloudDatabase } from "./sqlite";

const key = Symbol.for("writer-studio.illustration-runner");
export function startIllustrationRunner() {
  if (isCloudDatabase()) return;
  const global = globalThis as typeof globalThis & { [key]?: boolean };
  if (global[key]) return;
  global[key] = true;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { dispatchIllustrations } = await import("./illustrations");
      await dispatchIllustrations();
    } catch (error) { console.error("Illustration dispatcher failed", error); }
    finally { busy = false; }
  }, 2000);
  timer.unref?.();
}
