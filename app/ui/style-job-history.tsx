"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Pagination, Select, Stack, Text } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { STYLE_FIELDS, GENERATE_FIELDS } from "@/lib/advanced-writing";
import { configurationOf, configurationFingerprint, MIN_STYLE_CONTENT_SCORE, type StyleConfiguration } from "@/lib/style-learning";
import type { StyleJob } from "@/db/style-lab";

export const stylePhases: Record<string, string> = { learn: "逐篇学习", merge: "提取共性与场景差异", validate: "检查配置与情节污染", outline: "提取并固定参考大纲", prepare: "整理试写准备稿", generate: "生成试写稿", review: "按现有规则审校", evaluate: "对照参考评价", adjust: "调整配置", completed: "已完成" };
export const styleStatuses: Record<string, string> = { queued: "等待执行", running: "进行中", retrying: "自动重试", paused: "已暂停", failed: "需要处理", completed: "已完成", cancelled: "已停止" };
const canApply = (job: StyleJob) => job.status === "completed" && (job.kind !== "tune" || job.payload.bestScore >= 0);
export async function styleLabApi(path: string, body?: unknown) {
  const response = body === undefined ? await fetchFromServer(path, { cache: "no-store" }) : await fetchServerAction(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "学习任务请求失败");
  return result;
}
export function downloadStyleRecord(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function configurationRows(c: StyleConfiguration) {
  return { "写作风格": c.style, ...Object.fromEntries(Object.entries(c.advancedStyle).map(([k,v]) => [`风格 · ${STYLE_FIELDS[k as keyof typeof STYLE_FIELDS][0]}`, v])), ...Object.fromEntries(Object.entries(c.generate.proseControls).map(([k,v]) => [`正文表达 · ${k}`, v])), ...Object.fromEntries(Object.entries(c.generate.advanced).map(([k,v]) => [`生成 · ${GENERATE_FIELDS[k as keyof typeof GENERATE_FIELDS][0]}`, v])), "场景偏好": c.scenes.map(s => `${s.name}（${s.when}）：${s.instruction}`).join("\n") };
}
export function ConfigComparison({ before, after }: { before: StyleConfiguration; after: StyleConfiguration }) {
  const a: Record<string, string | undefined> = configurationRows(before), b: Record<string, string | undefined> = configurationRows(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]);
  return <div className="style-comparison"><table><thead><tr><th>设置项</th><th>原设置</th><th>建议设置</th></tr></thead><tbody>{keys.map(key => <tr key={key}><th>{key}</th><td>{a[key] || "自动"}</td><td>{b[key] || "自动"}</td></tr>)}</tbody></table>{!keys.length && <Text size="sm" c="dimmed">没有配置变化。</Text>}</div>;
}
const time = (value: string) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString("zh-CN", { hour12: false });

function StyleJobDetail({ job }: { job: StyleJob }) {
  const studio = useStudio();
  const p = job.payload;
  const article = studio.data.articles.find(a => a.id === job.articleId);
  const current = article ? configurationOf(article) : undefined;
  return <Stack gap="md" className="style-job-detail">
    <Text size="sm">{p.providerName ? `${p.providerName} · ` : ""}{p.modelName || job.model} · 输入 {p.inputTokens.toLocaleString()} / 输出 {p.outputTokens.toLocaleString()} tokens</Text>
    <Text size="sm" c="dimmed">提交于 {time(job.createdAt)}{p.completedAt ? ` · 完成于 ${time(p.completedAt)}` : ""}</Text>
    {job.kind === "tune" && <Text size="sm">{p.bestScore < 0 ? `尚无达标结果 · 内容覆盖需达到 ${MIN_STYLE_CONTENT_SCORE} 分` : `最佳结果：${p.bestRound === 0 ? "基线" : `第 ${p.bestRound} 轮`} · ${p.bestScore.toFixed(1)} / 100`}</Text>}
    <Text size="sm" fw={600}>提交时配置与成果</Text><ConfigComparison before={p.base} after={p.best} />
    {current && configurationFingerprint(current) !== configurationFingerprint(p.base) && <details><summary>与文章当前配置对比</summary><ConfigComparison before={current} after={p.best} /></details>}
    {p.best.notes && <Text className="style-prewrap" size="sm">{p.best.notes}</Text>}
    <details><summary>参考文章快照 · {p.references.length} 篇</summary>{p.references.map(ref => <details key={ref.id}><summary>{ref.title}</summary><pre className="style-prewrap">{ref.text}</pre></details>)}</details>
    {!!p.analyses.length && <details><summary>逐篇学习结果</summary>{p.analyses.map((analysis, i) => <details key={i}><summary>{p.references[i]?.title || `参考文章 ${i + 1}`}</summary><ConfigComparison before={p.base} after={analysis} /><p className="style-prewrap">{analysis.notes}</p></details>)}</details>}
    {!!p.outlines.length && <details><summary>固定参考大纲</summary><pre className="style-prewrap">{p.outlines.map(o => o.scenes.map(s => `${s.title}\n${s.plan}`).join("\n\n")).join("\n\n")}</pre></details>}
    {job.rounds?.map(round => <details key={round.index}><summary>{round.index === 0 ? "基线" : `第 ${round.index} 轮`} · {round.score === undefined ? "进行中" : `风格 ${round.score.toFixed(1)} 分 · 内容 ${round.contentScore?.toFixed(1)} 分`}</summary><ConfigComparison before={p.base} after={round.configuration} />{round.evaluations.map((evaluation, i) => <div key={i}><Text fw={600}>{p.references[i]?.title || `参考文章 ${i + 1}`} · {evaluation.scores.join(" / ")}</Text><p className="style-prewrap">{evaluation.evidence}</p><p className="style-prewrap">{evaluation.suggestions}</p></div>)}{round.drafts.map((draft, i) => <details key={i}><summary>场景 {i + 1} 试写稿</summary>{draft.brief && <details><summary>写作准备稿</summary><pre className="style-prewrap">{draft.brief}</pre></details>}<pre className="style-prewrap">{draft.text}</pre>{draft.raw !== draft.text && <details><summary>审校前版本</summary><pre className="style-prewrap">{draft.raw}</pre></details>}</details>)}</details>)}
    {!!p.applications?.length && <details><summary>应用历史 · {p.applications.length} 次</summary>{p.applications.map(application => <details key={application.id}><summary>{time(application.at)}{application.restoredAt ? ` · 已于 ${time(application.restoredAt)} 恢复` : " · 已应用"}</summary><ConfigComparison before={application.before} after={p.best} /></details>)}</details>}
    {!!p.history?.length && <details><summary>运行历史</summary><ol className="style-run-history">{p.history.map((event, i) => <li key={i}><time>{time(event.at)}</time> · {styleStatuses[event.status]} · {stylePhases[event.phase] ?? event.phase}{event.retry && ` · 第 ${event.retry} 次重试`}{event.error && <p className="danger-text">{event.error}</p>}{event.diagnostics != null && <details><summary>响应诊断</summary><pre className="style-prewrap">{JSON.stringify(event.diagnostics, null, 2)}</pre></details>}</li>)}</ol></details>}
    {p.modelSnapshot && <details><summary>模型条件快照</summary><pre className="style-prewrap">{JSON.stringify(p.modelSnapshot, null, 2)}</pre></details>}
    <Group><Button variant="default" onClick={() => downloadStyleRecord(`style-run-${job.id}.json`, job)}>导出本次完整记录</Button>{canApply(job) && <Button variant="default" onClick={() => downloadStyleRecord("writer-studio-style.json", { kind: "writer-studio-style-configuration", version: 1, configuration: p.best })}>导出成果配置</Button>}</Group>
  </Stack>;
}

export function StyleJobHistory({ articleId, initialJobId = "", onOpenArticle }: { articleId?: string; initialJobId?: string; onOpenArticle?: () => void }) {
  const studio = useStudio(); const studioRef = useRef(studio); studioRef.current = studio;
  const [jobs, setJobs] = useState<StyleJob[]>([]), [selectedId, setSelectedId] = useState(initialJobId), [selected, setSelected] = useState<StyleJob | null>(null);
  const [filter, setFilter] = useState<string | null>("all"), [page, setPage] = useState(1), [pages, setPages] = useState(1), [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => { setSelectedId(initialJobId); setSelected(null); }, [initialJobId, articleId]);
  useEffect(() => {
    let active = true, refreshing = false;
    async function refresh() {
      if (refreshing) return; refreshing = true;
      try {
        const query = new URLSearchParams({ scope: "history", filter: filter || "all", page: String(page), ...(articleId ? { articleId } : {}) });
        const result = await styleLabApi(`/api/style-lab?${query}`);
        if (!active) return;
        setJobs(result.jobs); setTotal(result.total ?? result.jobs.length); setPages(result.pages ?? 1);
        if (result.page && result.page !== page) setPage(result.page);
        if (selectedId) { const detail = await styleLabApi(`/api/style-lab/${selectedId}`); if (active) setSelected(detail.job); }
      } catch (error) { if (active) setNotice(error instanceof Error ? error.message : "读取学习历史失败"); }
      finally { refreshing = false; }
    }
    void refresh(); const timer = window.setInterval(() => void refresh(), 4000);
    const wake = () => void refresh(); window.addEventListener("style-lab-progress", wake);
    return () => { active = false; clearInterval(timer); window.removeEventListener("style-lab-progress", wake); };
  }, [articleId, filter, page, selectedId]);
  async function action(job: StyleJob, name: string) {
    if (busy) return; setBusy(true); setNotice("");
    try {
      if (["apply", "restore"].includes(name) && !await studioRef.current.saveNow()) throw new Error("请先保存当前修改，再应用学习成果");
      const result = await styleLabApi(`/api/style-lab/${job.id}`, { action: name });
      if (selectedId === job.id) setSelected(result.job);
      if (["apply", "restore"].includes(name)) await studioRef.current.refreshFromServer();
      window.dispatchEvent(new CustomEvent("style-lab-progress"));
    } catch (error) { setNotice(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }
  function actions(job: StyleJob) {
    const terminal = ["completed", "failed", "cancelled"].includes(job.status);
    return <Group gap="xs">
      {!articleId && <Button size="compact-sm" variant="subtle" onClick={() => { studio.setCurrentArticle(job.articleId); window.history.pushState({}, "", `/articles/${job.articleId}/info/ai-tasks`); window.dispatchEvent(new PopStateEvent("popstate")); onOpenArticle?.(); }}>打开文章</Button>}
      {selectedId !== job.id && <Button size="compact-sm" variant="subtle" onClick={() => { setSelected(null); setSelectedId(job.id); }}>查看过程</Button>}
      {["queued", "running"].includes(job.status) && <Button disabled={busy} size="compact-sm" variant="subtle" onClick={() => void action(job, "pause")}>暂停</Button>}
      {["paused", "failed"].includes(job.status) && <Button disabled={busy} size="compact-sm" variant="subtle" onClick={() => void action(job, job.status === "failed" ? "retry" : "resume")}>{job.status === "failed" ? "重试本步骤" : "继续"}</Button>}
      {["queued", "running", "paused", "failed"].includes(job.status) && <Button disabled={busy} size="compact-sm" color="red" variant="subtle" onClick={() => void action(job, "stop")}>停止</Button>}
      {canApply(job) && <Button disabled={busy} size="compact-sm" variant="light" onClick={() => { setSelectedId(job.id); void action(job, "apply"); }}>{job.payload.applied ? "再次应用" : "应用结果"}</Button>}
      {job.payload.applications?.length && !job.payload.applications.at(-1)?.restoredAt ? <Button disabled={busy} size="compact-sm" variant="default" onClick={() => void action(job, "restore")}>恢复应用前配置</Button> : null}
      {terminal && <Button disabled={busy} size="compact-sm" variant="subtle" onClick={() => void action(job, job.payload.archived ? "unarchive" : "archive")}>{job.payload.archived ? "取消归档" : "归档"}</Button>}
    </Group>;
  }
  return <section className="style-job-history" aria-label="学习历史">
    <Group justify="space-between" align="end"><div><Text fw={600}>学习历史</Text><Text size="xs" c="dimmed">{total} 条记录 · 原始材料、试写与成果持续保存，归档后仍可查看</Text></div><Select aria-label="筛选学习历史" value={filter} onChange={value => { setFilter(value); setPage(1); }} data={[{ value: "all", label: "全部记录" }, { value: "active", label: "进行中与待处理" }, { value: "completed", label: "已完成" }, { value: "pending", label: "待应用" }, { value: "archived", label: "已归档" }]} /></Group>
    {notice && <Alert role="status" color="yellow">{notice}</Alert>}
    {selected && <article className="style-selected-job"><Group justify="space-between"><Text fw={600}>{selected.kind === "learn" ? "文章学习" : "风格微调"} · {styleStatuses[selected.status]}</Text><Button variant="subtle" size="compact-sm" onClick={() => { setSelectedId(""); setSelected(null); }}>关闭详情</Button></Group>{selected.error && <Alert color="red">{selected.error}</Alert>}{selected.payload.notice && <Alert>{selected.payload.notice}</Alert>}{actions(selected)}<StyleJobDetail job={selected} /></article>}
    <div className="style-job-list">{jobs.map(job => <article key={job.id} className="style-job"><div><Group gap="xs"><strong>{job.kind === "learn" ? "文章学习" : "风格微调"}</strong>{job.status === "completed" && <Badge color={job.payload.applied ? "green" : canApply(job) ? "yellow" : "gray"} variant="light">{job.payload.applied ? "已应用过" : canApply(job) ? "待应用" : "未达标"}</Badge>}</Group><Text size="sm">{styleStatuses[job.status]} · {stylePhases[job.phase] ?? job.phase}{job.kind === "tune" ? ` · ${job.payload.round === 0 ? "基线" : `第 ${job.payload.round} 轮`}` : ""}</Text><Text size="xs" c="dimmed">{!articleId ? `${studio.data.articles.find(a => a.id === job.articleId)?.title || "文章"} · ` : ""}{job.payload.modelName || job.model} · {time(job.createdAt)}</Text>{job.error && <Text c="red" size="sm">{job.error}</Text>}{job.payload.notice && <Text size="sm">{job.payload.notice}</Text>}</div>{actions(job)}</article>)}</div>
    {!jobs.length && <Text size="sm" c="dimmed">此分类暂无学习记录。</Text>}
    {pages > 1 && <Pagination aria-label="学习历史分页" total={pages} value={page} onChange={setPage} size="sm" />}
  </section>;
}
