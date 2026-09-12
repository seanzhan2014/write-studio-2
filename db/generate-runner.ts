import { ensureDatabase, getDatabase } from "@/db/runtime";
import { currentTaskExecutionOrigin } from "@/db/task-execution";
import { isCloudDatabase } from "@/db/sqlite";

const runnerKey = Symbol.for("writer-studio.generate-review-runner");
type RunnerState = { busy: boolean; timer?: ReturnType<typeof setInterval> };

// SQLite leases arbitrate ownership between the browser and this local runner.
// In production the service starts every queued Generate task even after the
// originating tab has navigated away or closed. Tests retain explicit dispatch
// for one-shot tasks while review recovery remains exercised automatically.
export function startGenerateReviewRunner() {
  if (isCloudDatabase() || typeof process === "undefined" || !process.versions?.node) return;
  const global = globalThis as typeof globalThis & { [runnerKey]?: RunnerState };
  if (global[runnerKey]) return;
  const state: RunnerState = { busy: false };
  global[runnerKey] = state;
  async function tick() {
    if (state.busy || isCloudDatabase()) return;
    state.busy = true;
    try {
      await ensureDatabase();
      const db = getDatabase();
      const origin = currentTaskExecutionOrigin();
      const rows = (await db.prepare("SELECT id,outline_id,target,status,lease_until,context_options_json FROM ai_tasks WHERE execution_origin=? AND target<>'chat' AND status IN ('queued','running') ORDER BY created_at,id").bind(origin).all<Record<string, unknown>>()).results ?? [];
      const now = new Date().toISOString();
      const running = rows.filter((row) => row.status === "running" && row.lease_until && String(row.lease_until) > now);
      const settingsJson = await db.prepare("SELECT value_json FROM app_settings WHERE key='studio_ui'").first<string>("value_json");
      const settings = settingsJson ? JSON.parse(settingsJson).settings ?? {} : {};
      const capacity = Math.max(0, Math.min(5, Number(settings.taskConcurrency) || 2) - running.length);
      const occupied = new Set(running.filter((row) => row.target === "content").map((row) => row.outline_id));
      const chosen = [];
      const reviewsOnly = process.env.WRITER_STUDIO_TEST_MODE === "1";
      for (const row of rows) {
        if (chosen.length >= capacity) break;
        if (running.includes(row) || (row.target === "content" && occupied.has(row.outline_id))) continue;
        const options = JSON.parse(String(row.context_options_json ?? "{}"));
        if (reviewsOnly && (row.target !== "content" || !options.reviewMaxRounds)) continue;
        chosen.push(String(row.id));
        if (row.target === "content") occupied.add(row.outline_id);
      }
      if (chosen.length) {
        const { POST } = await import("@/app/api/ai/tasks/[taskId]/execute/route");
        // Do not keep the dispatcher busy while models work. Leases prevent
        // another tick from claiming a running task.
        for (const id of chosen) void POST(new Request("http://writer-studio.local/api/ai/tasks/execute", { method: "POST" }), { params: Promise.resolve({ taskId: id }) }).catch((error) => console.error("Automatic review task failed", error));
      }
    } catch (error) {
      console.error("Automatic review dispatcher failed", error);
    } finally { state.busy = false; }
  }
  state.timer = setInterval(() => { void tick(); }, 3000);
  state.timer.unref?.();
  void tick();
}
