import { REVIEW_STRATEGY_LABELS, type GenerateReviewReport } from "@/lib/generate-review.mjs";
import { ReviewRuleSnapshotView } from "./review-rules";

export function GenerateReviewReportView({ report }: { report: GenerateReviewReport }) {
  const remaining = report.issues.filter((issue) => issue.status !== "resolved");
  const resolved = report.issues.filter((issue) => issue.status === "resolved");
  return <details className="generate-review-report">
    <summary>审校报告 · {remaining.length ? `剩余 ${remaining.length} 项问题` : "未发现剩余问题"}</summary>
    {(report.strategy || report.modelName) && <p>{report.strategy && REVIEW_STRATEGY_LABELS[report.strategy]}{report.modelName && ` · ${report.modelName}`}</p>}
    <p>已修正 {report.completedRounds} / {report.maxRounds} 次 · {report.stopReason === "passed" ? "按本次规则复检通过" : "达到循环上限"}</p>
    <p>已解决 {resolved.length} 项；未解决或无法确认 {remaining.length} 项。</p>
    {remaining.length > 0 && <ul>{remaining.map((issue) => <li key={issue.id}>
      <strong>{issue.id} · {issue.kind === "improvement" ? "改进项 · " : ""}{issue.status === "uncertain" ? "无法确认" : "未解决"}：{issue.description}</strong>
      <p>规则：{issue.rule}</p>{issue.evidence && <blockquote>{issue.evidence}</blockquote>}
      <p>{issue.reason}</p>{issue.suggestion && <p>建议：{issue.suggestion}</p>}
    </li>)}</ul>}
    {resolved.length > 0 && <details><summary>已解决的问题（{resolved.length}）</summary><ul>{resolved.map((issue) => <li key={issue.id}><strong>{issue.id}：{issue.description}</strong><p>{issue.reason}</p></li>)}</ul></details>}
    <details><summary>各轮检查记录</summary>{report.history.map((round) => <p key={round.round}>{round.round === 0 ? "初稿审校" : `第 ${round.round} 次修正后复检`}：已解决 {round.issues.filter((issue) => issue.status === "resolved").length} 项，剩余 {round.issues.filter((issue) => issue.status !== "resolved").length} 项</p>)}</details>
    <details><summary>使用的规则</summary>{report.ruleSnapshot ? <ReviewRuleSnapshotView snapshot={report.ruleSnapshot} /> : <><p>文章通用规则：{report.rules || "无额外规则"}</p><p>本次指令：{report.instruction || "无额外指令"}</p></>}</details>
  </details>;
}
