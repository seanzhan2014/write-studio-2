import assert from "node:assert/strict";
import test from "node:test";
import { parseGenerateReview, runGenerateReview } from "../lib/generate-review.mjs";

const issue = (status = "open") => ({ id: "P1", rule: "人物年龄", description: "人物应为十八岁", evidence: "十七岁", suggestion: "改为十八岁", status, reason: status === "resolved" ? "正文已写为十八岁" : "与设定的十八岁不符" });
function harness(maxRounds = 3) {
  const calls = [];
  const snapshots = [];
  const options = {
    maxRounds, rules: "年龄为十八岁", instruction: "保持口语对白",
    generate: async () => { calls.push("generate"); return { text: "十七岁", inputTokens: 10, outputTokens: 3 }; },
    review: async (text, _issues, round) => { calls.push(`review-${round}`); return { issues: [issue(text === "十八岁" ? "resolved" : "open")], inputTokens: 5, outputTokens: 2 }; },
    revise: async (text, _issues, round) => { calls.push(`revise-${round}`); return { text: text.replace("十七", "十八"), inputTokens: 6, outputTokens: 3 }; },
    save: async (state) => { snapshots.push(state); },
  };
  return { options, calls, snapshots };
}

test("zero review rounds makes exactly one generation and no review/checkpoint", async () => {
  const { options, calls, snapshots } = harness(0);
  const result = await runGenerateReview(options);
  assert.deepEqual(calls, ["generate"]);
  assert.equal(result.report, undefined);
  assert.equal(result.draft.text, "十七岁");
  assert.equal(snapshots.length, 0);
});

test("review stops as soon as verified fixes pass, preserving rules and total usage", async () => {
  const { options, calls, snapshots } = harness();
  const result = await runGenerateReview(options);
  assert.deepEqual(calls, ["generate", "review-0", "revise-1", "review-1"]);
  assert.equal(result.draft.text, "十八岁");
  assert.equal(result.draft.inputTokens, 26);
  assert.equal(result.draft.outputTokens, 10);
  assert.equal(result.report.stopReason, "passed");
  assert.equal(result.report.completedRounds, 1);
  assert.equal(result.report.rules, options.rules);
  assert.equal(result.report.instruction, options.instruction);
  assert.deepEqual(snapshots.at(-1).drafts, ["十七岁", "十八岁"]);
});

test("a clean initial draft never invokes revision", async () => {
  const { options, calls } = harness();
  options.review = async () => ({ issues: [] });
  const result = await runGenerateReview(options);
  assert.deepEqual(calls, ["generate"]);
  assert.equal(result.report.completedRounds, 0);
  assert.equal(result.report.stopReason, "passed");
});

test("minimum review stops at required conditions while exploration fixes optional improvements", async () => {
  for (const strategy of ["minimal", "explore"]) {
    const { options, calls } = harness(5);
    options.review = async (_text, _issues, round) => {
      calls.push(`review-${round}`);
      return { issues: [{ ...issue(round ? "resolved" : "open"), kind: "improvement" }] };
    };
    const result = await runGenerateReview({ ...options, strategy });
    assert.deepEqual(calls, strategy === "minimal" ? ["generate", "review-0"] : ["generate", "review-0", "revise-1", "review-1"]);
    assert.equal(result.report.strategy, strategy);
    assert.equal(result.report.completedRounds, strategy === "minimal" ? 0 : 1);
    assert.equal(result.report.stopReason, "passed");
    assert.ok(result.report.issues.every((item) => item.status === "resolved"));
  }
});

test("the last allowed revision is still verified and unresolved issues are reported", async () => {
  const { options, calls } = harness(2);
  options.revise = async (text, _issues, round) => { calls.push(`revise-${round}`); return { text }; };
  const result = await runGenerateReview(options);
  assert.deepEqual(calls, ["generate", "review-0", "revise-1", "review-1", "revise-2", "review-2"]);
  assert.equal(result.report.stopReason, "limit");
  assert.equal(result.report.completedRounds, 2);
  assert.equal(result.report.issues[0].status, "open");
});

test("uncertain findings remain unresolved at the limit", async () => {
  const { options } = harness(1);
  options.review = async () => ({ issues: [issue("uncertain")] });
  const result = await runGenerateReview(options);
  assert.equal(result.report.stopReason, "limit");
  assert.equal(result.report.issues[0].status, "uncertain");
});

test("new findings in verification are fixed against the latest draft", async () => {
  const { options } = harness(3);
  const second = { ...issue(), id: "P2", description: "新增的时间线问题" };
  options.review = async (_text, _issues, round) => ({ issues: round === 0 ? [issue()] : [issue("resolved"), { ...second, status: round === 1 ? "open" : "resolved" }] });
  options.revise = async (text, issues, round) => {
    if (round === 1) return { text: "十八岁，明天到达" };
    assert.equal(text, "十八岁，明天到达");
    assert.deepEqual(issues.map((item) => item.id), ["P2"]);
    return { text: "十八岁，今天到达" };
  };
  const result = await runGenerateReview(options);
  assert.equal(result.draft.text, "十八岁，今天到达");
  assert.equal(result.report.completedRounds, 2);
  assert.equal(result.report.stopReason, "passed");
});

test("resuming after a persisted revision verifies it without regenerating or revising again", async () => {
  const { options, snapshots } = harness();
  const save = options.save;
  options.save = async (state) => { await save(state); if (state.round === 1) throw new Error("process stopped"); };
  await assert.rejects(runGenerateReview(options), /process stopped/);
  const resumed = harness();
  const result = await runGenerateReview({ ...resumed.options, checkpoint: snapshots.at(-1) });
  assert.deepEqual(resumed.calls, ["review-1"]);
  assert.equal(result.report.completedRounds, 1);
  assert.equal(result.draft.text, "十八岁");
});

test("cancelled in-flight revision never advances the persisted draft", async () => {
  const { options, snapshots } = harness();
  const controller = new AbortController();
  options.signal = controller.signal;
  options.revise = async () => { controller.abort(); return { text: "已修改" }; };
  await assert.rejects(runGenerateReview(options), /取消/);
  assert.equal(snapshots.at(-1).round, 0);
  assert.equal(snapshots.at(-1).draft.text, "十七岁");
});

test("verification must account for prior issues and match the reviewed draft", () => {
  const response = (issues) => ({ version: 1, sourceDigest: "current", issues });
  assert.throws(() => parseGenerateReview(response([]), "current", [issue()]), /遗漏/);
  assert.throws(() => parseGenerateReview(response([issue()]), "stale"), /摘要/);
  assert.throws(() => parseGenerateReview(response([issue("resolved")]), "current"), /无效/);
  assert.throws(() => parseGenerateReview(response([issue(), issue()]), "current"), /无效/);
  assert.equal(parseGenerateReview(response([issue("resolved")]), "current", [issue()])[0].status, "resolved");
});
