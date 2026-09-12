import assert from "node:assert/strict";
import test from "node:test";
import { fullStudioFixture } from "./fixtures.mjs";
import { reviewModelServer } from "./review-model.mjs";

const baseUrl = process.env.WRITER_STUDIO_TEST_BASE_URL;
async function api(path, method = "GET", data, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  const body = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}
async function reset() {
  const current = await api("/api/state");
  const data = fullStudioFixture();
  data.tasks = [];
  data.articles[0].reviewRules = "人物必须十八岁；保留环境描写。";
  await api("/api/state", "PUT", { data }, { "If-Match": String(current.revision) });
}
async function waitTask(id, predicate = (task) => ["success", "failed", "cancelled"].includes(task.state)) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const task = (await api("/api/ai/tasks")).tasks.find((item) => item.id === id);
    if (task && predicate(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Task ${id} did not reach expected state`);
}

test("Generate review API executes durable loops and reports the final draft", async (t) => {
  assert.ok(baseUrl);
  const fake = await reviewModelServer();
  try {
    const provider = await api("/api/providers", "POST", { name: "Review integration", baseUrl: fake.baseUrl, secret: "fake-review-key", timeoutMs: 20000 });
    const model = await api("/api/models", "POST", { providerId: provider.id, name: "Review integration", modelId: "review-integration", maxInputCharacters: 120000 });
    const create = async (rounds = 3, reasoningEffort) => (await api("/api/ai/tasks", "POST", { articleId: "article-main", chapterId: "chapter-main", outlineId: "outline-current", target: "content", model: model.id, reasoningEffort, reviewMaxRounds: rounds, reviewInstruction: "保持本次雨后场景", instruction: "写一个短场景", contentMode: "fresh" }, { "Idempotency-Key": `review-${crypto.randomUUID()}` })).data;

    await t.test("generation, review, revision and verification share the task reasoning override", async () => {
      await api(`/api/models/${model.id}`, "PATCH", { reasoningEffort: "high" });
      for (const effort of [null, "low"]) {
        await reset(); fake.control.calls = []; fake.control.mode = "pass";
        const task = await create(1, effort);
        const completed = await waitTask(task.id);
        assert.equal(completed.state, "success", completed.error);
        assert.deepEqual(fake.control.calls.map((item) => item.kind), ["generate", "review", "revise", "review"]);
        for (const call of fake.control.calls) assert.equal(call.body.reasoning_effort ?? null, effort);
      }
      await api(`/api/models/${model.id}`, "PATCH", { reasoningEffort: null });
    });

    await t.test("zero rounds preserves one-shot generation", async () => {
      await reset(); fake.control.calls = [];
      const task = await create(0);
      await api(`/api/ai/tasks/${task.id}/execute`, "POST", {});
      const completed = await waitTask(task.id);
      assert.equal(completed.state, "success");
      assert.deepEqual(fake.control.calls.map((item) => item.kind), ["generate"]);
      assert.equal(completed.contextOptions.reviewReport, undefined);
      assert.deepEqual(completed.history.map((entry) => entry.phase), ["queued", "preparing", "connecting", "generating", "saving", "completed"]);
    });

    await t.test("server runs without browser dispatch, persists rules and a verified report on the version", async () => {
      await reset(); fake.control.calls = []; fake.control.mode = "pass";
      const task = await create();
      const completed = await waitTask(task.id);
      assert.equal(completed.state, "success", completed.error);
      assert.deepEqual(fake.control.calls.map((item) => item.kind), ["generate", "review", "revise", "review"]);
      assert.equal(completed.contextOptions.reviewReport.stopReason, "passed");
      assert.equal(completed.contextOptions.reviewReport.completedRounds, 1);
      assert.equal(completed.resultText, "她十八岁。\n\n窗外的雨停了。");
      assert.equal(completed.inputTokens, 40);
      assert.deepEqual(completed.history.map((entry) => entry.phase), ["queued", "preparing", "generating", "reviewing", "revising", "verifying", "saving", "completed"]);
      assert.equal(completed.history.find((entry) => entry.phase === "revising").reviewRound, 1);
      assert.ok(completed.history.every((entry) => Number.isFinite(Date.parse(entry.at))));
      const reviewPrompt = fake.control.calls[1].body.messages.at(-1).content;
      assert.match(reviewPrompt, /人物必须十八岁/);
      assert.match(reviewPrompt, /保持本次雨后场景/);
      const state = await api("/api/state");
      assert.deepEqual(state.data.tasks.find((item) => item.id === task.id).history, completed.history);
      const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
      assert.equal(outline.currentVersionId, completed.resultVersionId);
      assert.equal(outline.versions.find((item) => item.id === completed.resultVersionId).reviewReport.completedRounds, 1);
      assert.equal(state.data.articles[0].reviewRules, "人物必须十八岁；保留环境描写。");
    });

    await t.test("maximum revisions still receives a last verification and unresolved report", async () => {
      await reset(); fake.control.calls = []; fake.control.mode = "limit";
      const task = await create(2);
      const completed = await waitTask(task.id);
      assert.equal(completed.state, "success", completed.error);
      assert.deepEqual(fake.control.calls.map((item) => item.kind), ["generate", "review", "revise", "review", "revise", "review"]);
      assert.equal(completed.contextOptions.reviewReport.stopReason, "limit");
      assert.equal(completed.contextOptions.reviewReport.issues[0].status, "open");
      assert.deepEqual(completed.history.filter((entry) => ["revising", "verifying"].includes(entry.phase)).map((entry) => [entry.phase, entry.reviewRound]), [["revising", 1], ["verifying", 1], ["revising", 2], ["verifying", 2]]);
    });

    await t.test("human edits preserve the current body while the final draft becomes a candidate", async () => {
      await reset(); fake.control.calls = []; fake.control.mode = "pass";
      let release;
      fake.control.gate = new Promise((resolve) => { release = resolve; });
      const task = await create(1);
      try {
        await waitTask(task.id, (item) => item.phase === "reviewing");
        const state = await api("/api/state");
        await api("/api/outlines/outline-current/content", "PUT", { text: "用户正在修改的正文" }, { "If-Match": String(state.revision) });
      } finally { release(); fake.control.gate = null; }
      const completed = await waitTask(task.id);
      assert.equal(completed.state, "success", completed.error);
      assert.equal(completed.contextOptions.reviewCandidateOnly, true);
      const state = await api("/api/state");
      const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
      assert.equal(outline.content, "用户正在修改的正文");
      assert.equal(outline.currentVersionId, null);
      assert.ok(outline.versions.some((item) => item.id === completed.resultVersionId));
    });

    await t.test("failed review retries the saved draft without regenerating it", async () => {
      await reset(); fake.control.calls = []; fake.control.mode = "pass"; fake.control.failReviews = 3;
      const task = await create(1);
      const failed = await waitTask(task.id);
      assert.equal(failed.state, "failed");
      assert.equal(failed.resultText, "她十七岁。\n\n窗外的雨停了。");
      assert.equal(failed.resultVersionId, undefined);
      assert.equal(failed.history.at(-1).phase, "failed");
      assert.ok(failed.history.at(-1).error);
      assert.equal(failed.history.filter((entry) => entry.phase === "retrying" && entry.error).length, 2);
      const retried = await api(`/api/ai/tasks/${task.id}/state`, "POST", { action: "retry" });
      assert.deepEqual(retried.task.history.slice(0, failed.history.length), failed.history);
      assert.equal(retried.task.history.at(-1).phase, "queued");
      const completed = await waitTask(task.id);
      assert.equal(completed.state, "success", completed.error);
      assert.equal(fake.control.calls.filter((item) => item.kind === "generate").length, 1);
      assert.equal(completed.contextOptions.reviewReport.completedRounds, 1);
      assert.deepEqual(completed.history.slice(0, failed.history.length), failed.history);
      assert.equal(completed.history.at(-1).phase, "completed");
    });

    await t.test("cancellation during review prevents further revisions or a final version", async () => {
      await reset(); fake.control.calls = []; fake.control.mode = "pass";
      let release;
      fake.control.gate = new Promise((resolve) => { release = resolve; });
      const task = await create(1);
      // Dispatch explicitly so the response also confirms that the original
      // execution has stopped after its late review response is released.
      const execution = api(`/api/ai/tasks/${task.id}/execute`, "POST", {}).catch((error) => error);
      try {
        await waitTask(task.id, (item) => item.phase === "reviewing");
        await api(`/api/ai/tasks/${task.id}/state`, "POST", { action: "cancel" });
      } finally { release(); fake.control.gate = null; }
      await execution;
      const cancelled = await waitTask(task.id);
      assert.equal(cancelled.state, "cancelled");
      assert.equal(cancelled.history.at(-1).phase, "cancelled");
      assert.ok(cancelled.history.some((entry) => entry.phase === "reviewing"));
      assert.equal(cancelled.resultVersionId, undefined);
      assert.equal(fake.control.calls.filter((item) => item.kind === "revise").length, 0);
      const state = await api("/api/state");
      const outline = state.data.articles[0].chapters[0].outlines.find((item) => item.id === "outline-current");
      assert.equal(outline.versions.some((item) => item.taskId === task.id), false);
    });
  } finally { fake.close(); }
});
