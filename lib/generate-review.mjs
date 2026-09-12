export const MAX_REVIEW_ROUNDS = 10;
export const MAX_REVIEW_RULE_CHARACTERS = 20000;

export function normalizeReviewRounds(value) {
  const number = Number(value ?? 0);
  return Number.isInteger(number) ? Math.max(0, Math.min(MAX_REVIEW_ROUNDS, number)) : 0;
}

export function normalizeReviewRules(value) {
  return String(value ?? "").trim().slice(0, MAX_REVIEW_RULE_CHARACTERS);
}

export function parseGenerateReview(value, sourceDigest, previousIssues = []) {
  const raw = typeof value === "string" ? JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) : value;
  if (!raw || raw.version !== 1 || raw.sourceDigest !== sourceDigest || !Array.isArray(raw.issues) || raw.issues.length > 100) throw new Error("自动审校返回的结构或正文摘要不匹配");
  const known = new Set(previousIssues.map((issue) => issue.id));
  const ids = new Set();
  const issues = raw.issues.map((issue) => {
    if (!issue || !["open", "resolved", "uncertain"].includes(issue.status)) throw new Error("自动审校返回了无效的问题状态");
    for (const key of ["id", "rule", "description", "evidence", "suggestion", "reason"]) {
      if (typeof issue[key] !== "string" || issue[key].length > 2000) throw new Error("自动审校的问题记录不完整或过长");
    }
    if (!issue.id.trim() || !issue.rule.trim() || !issue.description.trim() || !issue.reason.trim() || ids.has(issue.id) || (issue.status === "resolved" && !known.has(issue.id))) throw new Error("自动审校的问题编号或判断依据无效");
    ids.add(issue.id);
    return { id: issue.id, rule: issue.rule, description: issue.description, evidence: issue.evidence, suggestion: issue.suggestion, status: issue.status, reason: issue.reason };
  });
  if (previousIssues.some((issue) => !ids.has(issue.id))) throw new Error("自动复检遗漏了已有问题，无法确认是否修正");
  return issues;
}

// Each checkpoint describes the next operation. A resumed run never regenerates
// a persisted draft or spends an additional revision round on a network retry.
export async function runGenerateReview({ maxRounds, rules = "", instruction = "", ruleSnapshot, checkpoint, generate, review, revise, save, signal }) {
  const maximum = normalizeReviewRounds(maxRounds);
  const check = () => { if (signal?.aborted) throw new Error("任务已取消"); };
  if (!maximum) { check(); return { draft: await generate() }; }
  let state = checkpoint ? structuredClone(checkpoint) : null;
  const persist = async () => { check(); await save(structuredClone(state)); };
  if (!state) {
    check();
    const draft = await generate();
    state = { version: 1, phase: "review", round: 0, draft, issues: [], history: [], drafts: [draft.text], inputTokens: draft.inputTokens ?? 0, outputTokens: draft.outputTokens ?? 0 };
    await persist();
  }
  if (state.version !== 1 || !["review", "revise", "done"].includes(state.phase) || !Number.isInteger(state.round) || state.round < 0 || state.round > maximum || !state.draft?.text || !Array.isArray(state.issues) || !Array.isArray(state.history)) throw new Error("自动审校进度无效，无法继续");
  while (state.phase !== "done") {
    check();
    if (state.phase === "review") {
      const result = await review(state.draft.text, state.issues, state.round);
      check();
      state.inputTokens += result.inputTokens ?? 0;
      state.outputTokens += result.outputTokens ?? 0;
      state.issues = result.issues;
      state.history.push({ round: state.round, issues: structuredClone(result.issues) });
      const remaining = state.issues.filter((issue) => issue.status !== "resolved");
      state.phase = !remaining.length || state.round >= maximum ? "done" : "revise";
      if (state.phase === "done") state.report = {
        maxRounds: maximum, completedRounds: state.round, stopReason: remaining.length ? "limit" : "passed",
        rules, instruction, ...(ruleSnapshot ? { ruleSnapshot: structuredClone(ruleSnapshot) } : {}), issues: state.issues, history: state.history,
      };
      await persist();
    } else {
      const result = await revise(state.draft.text, state.issues.filter((issue) => issue.status !== "resolved"), state.round + 1);
      check();
      if (!result.text?.trim()) throw new Error("自动修正没有返回可用正文");
      state.inputTokens += result.inputTokens ?? 0;
      state.outputTokens += result.outputTokens ?? 0;
      state.draft = { ...state.draft, text: result.text };
      state.drafts.push(result.text);
      state.round += 1;
      state.phase = "review";
      await persist();
    }
  }
  check();
  return { draft: { ...state.draft, inputTokens: state.inputTokens, outputTokens: state.outputTokens }, report: state.report };
}
