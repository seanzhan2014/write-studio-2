"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useStudio, type AiTask } from "@/app/studio-state";
import { fetchServerAction } from "@/lib/browser-network";
import { isTaskAwaitingAuthor, normalizePreparationStrategy, PREPARATION_STRATEGY_LABELS, preparationNeedsConfirmation, type PreparationReply } from "@/lib/writing-preparation";
import { TaskHistory } from "./task-history";
import { GenerateReviewReportView } from "./generate-review-report";
import { REVIEW_STRATEGY_LABELS, normalizeReviewStrategy } from "@/lib/generate-review.mjs";

const drafts = new Map<string, PreparationReply>();
const draftBases = new Map<string, string>();
const draftListeners = new Set<() => void>();
function subscribeDraft(listener: () => void) { draftListeners.add(listener); return () => { draftListeners.delete(listener); }; }
function readDraft(key: string, fallback: PreparationReply) {
  if (!drafts.has(key)) {
    draftBases.set(key, JSON.stringify(fallback));
    try {
      const stored = JSON.parse(localStorage.getItem(`writer-studio:preparation:${key}`) ?? "null");
      const value = stored?.draft;
      const usable = value && typeof value.note === "string" && value.answers && typeof value.answers === "object" && (stored.base === JSON.stringify(fallback) || Date.now() - stored.at < 5000);
      drafts.set(key, usable ? value : fallback);
    } catch { drafts.set(key, fallback); }
  }
  return drafts.get(key)!;
}
function writeDraft(key: string, value: PreparationReply) {
  drafts.set(key, value);
  try { localStorage.setItem(`writer-studio:preparation:${key}`, JSON.stringify({ draft: value, base: draftBases.get(key), at: Date.now() })); } catch { /* The server also persists the draft. */ }
  for (const listener of draftListeners) listener();
}
export function openWritingTask(taskId: string) { window.dispatchEvent(new CustomEvent("writer-studio-open-task", { detail: taskId })); }

export function WritingTaskProgress({ task }: { task: AiTask }) {
  const preparation = task.contextOptions?.writingPreparation;
  const reviewEnabled = Number(task.contextOptions?.reviewMaxRounds) > 0;
  const reviewing = ["reviewing", "revising", "verifying"].includes(task.phase ?? "");
  const current = task.state === "success" ? 4 : reviewing ? 3 : preparation?.stage === "awaiting_author" || preparation?.stage === "awaiting_confirmation" ? 1 : preparation?.stage === "preparing" || task.state === "waiting" ? 0 : 2;
  const stopped = task.state === "failed" || task.state === "cancelled";
  const steps = ["准备", preparation?.stage === "awaiting_author" ? "待回答" : "待确认", "写作", "审校", "完成"];
  return <ol className="writing-task-progress" aria-label="生成进度">{steps.map((label, index) => {
    const skipped = index === 1 && !preparation?.requireConfirmation && !preparation?.confirmedAt && !preparation?.history.length && current > 1 || index === 3 && !reviewEnabled;
    const state = skipped ? "skipped" : index < current ? "complete" : index === current ? stopped ? "stopped" : "current" : "pending";
    return <li key={index} data-state={state} aria-current={state === "current" ? "step" : undefined}><span aria-hidden="true">{state === "complete" ? "✓" : index + 1}</span>{label}{skipped && <small>略过</small>}{state === "stopped" && <small>{task.state === "failed" ? "失败" : "取消"}</small>}</li>;
  })}</ol>;
}

export function OutlineTaskIndicator({ outlineId, fallback }: { outlineId: string; fallback?: string }) {
  const studio = useStudio();
  const tasks = studio.data.tasks.filter((task) => task.outlineId === outlineId && task.target === "正文").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const task = tasks.find(isTaskAwaitingAuthor) ?? tasks.find((item) => item.state === "running") ?? tasks[0];
  if (!task && fallback !== "running" && fallback !== "failed") return null;
  const state = task ? isTaskAwaitingAuthor(task) ? "awaiting-author" : task.state : fallback;
  if (state === "cancelled") return null;
  const label = state === "awaiting-author" ? "AI 任务需要作者处理" : state === "success" ? "AI 任务已完成" : state === "failed" ? "AI 任务出错" : "AI 任务正在处理";
  return <button type="button" className="outline-task-indicator" aria-label={label} title={label} onClick={() => task && openWritingTask(task.id)}><span className={`state-dot ${state}`} /></button>;
}

export function TaskInteraction({ task, full = false, details }: { task: AiTask; full?: boolean; details?: ReactNode }) {
  const studio = useStudio();
  const workflow = task.contextOptions!.writingPreparation!;
  const key = `${studio.executionOrigin}:${task.id}:${workflow.revision}`;
  const draft = useSyncExternalStore(subscribeDraft, () => readDraft(key, workflow.draft), () => workflow.draft);
  const [tab, setTab] = useState<"discussion" | "brief" | "history" | "result">(task.state === "success" ? "result" : "discussion");
  const [editing, setEditing] = useState(false);
  const [briefEdit, setBriefEdit] = useState(workflow.brief);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const awaiting = isTaskAwaitingAuthor(task);
  const editable = awaiting && task.executionOrigin === studio.executionOrigin;
  const authorTurn = editable && workflow.stage === "awaiting_author";
  const resultText = task.resultText || studio.data.articles
    .flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines)
    .find((outline) => outline.id === task.outlineId)?.versions
    .find((version) => version.id === task.resultVersionId)?.content || "";
  const stateRef = useRef({ task, studio });
  useEffect(() => { stateRef.current = { task, studio }; }, [task, studio]);
  useEffect(() => { if (task.state === "success") setTab("result"); }, [task.state]);
  useEffect(() => {
    const incoming = JSON.stringify(workflow.draft);
    const previous = draftBases.get(key);
    if (incoming === previous) return;
    const current = drafts.get(key);
    draftBases.set(key, incoming);
    // Adopt another page's saved reply only when this page has no unsaved typing.
    if (JSON.stringify(current) === previous || JSON.stringify(current) === incoming) writeDraft(key, workflow.draft);
  }, [key, workflow.draft]);

  async function action(name: string, extra: Record<string, unknown> = {}) {
    const response = await fetchServerAction(`/api/ai/tasks/${encodeURIComponent(task.id)}/interaction`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, revision: workflow.revision, ...extra }) });
    const payload = await response.json() as { task?: AiTask; revision?: number; error?: string };
    if (!response.ok || !payload.task || payload.revision === undefined) throw new Error(payload.error ?? "任务互动保存失败");
    stateRef.current.studio.acceptServerMutation(payload.revision, (current) => ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? payload.task! : item) }));
  }
  async function perform(name: string, extra: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(name, extra); if (name === "edit_brief") setEditing(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "互动保存失败"); await stateRef.current.studio.refreshFromServer(); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!authorTurn || JSON.stringify(draft) === JSON.stringify(workflow.draft)) return;
    let alive = true;
    const timer = setTimeout(() => { void action("draft", { draft }).catch((reason) => { if (alive && stateRef.current.task.contextOptions?.writingPreparation?.revision === workflow.revision) setError(reason instanceof Error ? reason.message : "回复草稿尚未保存到服务端"); }); }, 500);
    return () => { alive = false; clearTimeout(timer); };
    // Each semantic revision keeps one shared draft; background draft saves do not advance it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, authorTurn, workflow.revision]);
  useEffect(() => { if (full && tab === "discussion") end.current?.scrollIntoView({ block: "nearest" }); }, [workflow.revision, full, tab]);
  useEffect(() => {
    if (!full || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const workspace = shell.current?.closest<HTMLElement>(".task-workspace");
    const main = workspace?.closest<HTMLElement>(".main-area");
    const resize = () => {
      workspace?.style.setProperty("--task-viewport-height", `${viewport.height}px`);
      main?.style.setProperty("--task-viewport-height", `${viewport.height}px`);
      if (workspace) workspace.dataset.keyboardOpen = String(viewport.height < window.innerHeight - 100);
    };
    resize(); viewport.addEventListener("resize", resize);
    return () => { viewport.removeEventListener("resize", resize); main?.style.removeProperty("--task-viewport-height"); };
  }, [full]);

  const complete = workflow.questions.every((question) => Object.hasOwn(draft.answers, question.id));
  const brief = <div className="writing-brief"><h3>写作准备稿 <small>v{workflow.round + 1} · {workflow.round} / {workflow.maxRounds} 轮</small></h3>{workflow.brief ? <div className="writing-brief-text">{workflow.brief}</div> : <p>AI 正在根据大纲、人物资料和上下文整理初版准备稿。</p>}{editable && !editing && <button className="secondary-button" type="button" onClick={() => { setBriefEdit(workflow.brief); setEditing(true); setTab("brief"); }}>编辑准备稿</button>}{editing && <div className="writing-brief-editor"><label htmlFor={`brief-${task.id}`}>修改写作准备稿</label><textarea id={`brief-${task.id}`} value={briefEdit} maxLength={60000} onChange={(event) => setBriefEdit(event.target.value)} /><div><button className="primary-compact" disabled={busy || !briefEdit.trim()} onClick={() => void perform("edit_brief", { brief: briefEdit, ...(authorTurn ? { draft } : {}) })}>保存准备稿</button><button className="secondary-button" onClick={() => setEditing(false)}>取消编辑</button></div></div>}</div>;
  return <section ref={shell} className={`task-interaction ${full ? "full" : "inline"}`} aria-label="写作准备与作者互动">
    <header className="task-interaction-header"><div><h3>写作准备与讨论</h3><span>{PREPARATION_STRATEGY_LABELS[normalizePreparationStrategy(workflow.strategy)]} · {workflow.round} / {workflow.maxRounds} 轮 · {preparationNeedsConfirmation(workflow) ? "完成后等待确认" : "无待答问题后自动写正文"}</span></div>{!full && <button className="text-button" onClick={() => openWritingTask(task.id)}>打开完整任务 →</button>}</header>
    <WritingTaskProgress task={task} />
    <div className="task-interaction-tabs" role="tablist" aria-label="写作任务内容">{task.state === "success" && <button role="tab" aria-selected={tab === "result"} onClick={() => setTab("result")}>生成结果</button>}<button role="tab" aria-selected={tab === "discussion"} onClick={() => setTab("discussion")}>讨论</button><button role="tab" aria-selected={tab === "brief"} onClick={() => setTab("brief")}>准备稿</button><button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>运行历史</button></div>
    <div className="task-interaction-layout"><div className="task-interaction-main"><div className="task-interaction-scroll">
      {tab === "result" ? <section className="task-detail-section"><h3>正文已完成</h3>{task.contextOptions?.reviewCandidateOnly && <p className="task-interaction-warning">原正文已有修改，终稿已保存为候选版本，没有替换当前正文。</p>}{resultText ? <div className="writing-brief-text" aria-label="任务结果">{resultText}</div> : <p className="task-detail-empty">生成正文暂不可用，请打开生成版本查看。</p>}{task.contextOptions?.reviewReport && <GenerateReviewReportView report={task.contextOptions.reviewReport} />}</section> : tab === "brief" ? brief : tab === "history" ? <><TaskHistory task={task} />{details}</> : <div className="writing-discussion">
        <article className="writing-message author"><strong>作者 · 本次要求</strong><p>{task.prompt || "按当前大纲准备并写作。"}</p></article>
        {workflow.history.map((exchange) => <article className="writing-message author" key={exchange.round}><strong>作者 · 第 {exchange.round} 轮回答</strong>{exchange.questions.map((question) => { const option = question.options.find((item) => item.id === exchange.reply.answers[question.id]); return option ? <p key={question.id}>{question.title}<br />{option.label}</p> : null; })}{exchange.reply.note && <p>{exchange.reply.note}</p>}<details><summary>回答前的准备稿</summary><div className="writing-brief-text">{exchange.brief}</div></details></article>)}
        <article className="writing-message assistant"><strong>写作助手</strong><p>{task.state === "success" ? "正文已完成，准备稿及讨论记录保留在本任务中。" : task.state === "failed" ? "任务执行失败，已保存的准备稿和回答可以在重试后继续使用。" : task.state === "cancelled" ? "任务已取消，已有准备稿和讨论记录保留。" : workflow.stage === "preparing" ? "正在根据资料及作者的选择整理写作准备稿…" : workflow.stage === "writing" ? workflow.confirmedAt ? "正在按照已确认的准备稿生成正文…" : "准备稿已完成，正在生成正文…" : workflow.stage === "awaiting_confirmation" ? "准备稿已整理完成。请检查已知事实、人物认知和未决项，确认后开始正文写作。" : "准备稿已更新。以下选择会影响人物行动和情节推进，需要听听你的想法。"}</p></article>
        {workflow.stage === "awaiting_author" && workflow.questions.map((question, index) => <fieldset className="writing-question" key={question.id} disabled={!authorTurn || busy}><legend>{index + 1}. {question.title}</legend><p>{question.reason}</p>{question.options.map((option) => <label className={`writing-option ${draft.answers[question.id] === option.id ? "selected" : ""}`} key={option.id}><input type="radio" name={`${task.id}-${question.id}`} checked={draft.answers[question.id] === option.id} onChange={() => writeDraft(key, { ...draft, answers: { ...draft.answers, [question.id]: option.id } })} /><span><strong>{option.label}</strong><span>{option.description}</span></span></label>)}{!question.options.length && <p>请在下方回复中回答。</p>}</fieldset>)}
        {workflow.brief && <details className="discussion-brief"><summary>查看最新准备稿 · v{workflow.round + 1}</summary><div className="writing-brief-text">{workflow.brief}</div></details>}
        {task.contextOptions?.reviewCandidateOnly && <p className="task-interaction-warning">原正文已有修改，终稿已保存为候选版本，没有替换当前正文。</p>}
        {task.contextOptions?.reviewReport && <GenerateReviewReportView report={task.contextOptions.reviewReport} />}
        {!!task.contextOptions?.reviewMaxRounds && !task.contextOptions.reviewReport && workflow.stage === "writing" && <p>生成后审校：{REVIEW_STRATEGY_LABELS[normalizeReviewStrategy(task.contextOptions.reviewStrategy)]}{task.contextOptions.reviewModelName && ` · ${task.contextOptions.reviewModelName}`}。已修正 {task.contextOptions.reviewRound ?? 0} / {task.contextOptions.reviewMaxRounds} 次。{task.state === "failed" ? "重试将从保存的审校进度继续。" : ""}</p>}
        {task.state === "success" && <button className="secondary-button" type="button" onClick={() => setTab("result")}>查看生成正文</button>}
        <div ref={end} />
      </div>}
    </div>
    {(error || task.error) && <p className="task-interaction-error" role="alert">{error || task.error}</p>}
    {editable && <div className="writing-reply-composer">
      {workflow.stage === "awaiting_author" ? <><label htmlFor={`author-reply-${task.id}`}>作者回复</label><textarea id={`author-reply-${task.id}`} rows={2} maxLength={12000} placeholder="选择选项，或直接写下你的想法…" value={draft.note} disabled={busy} onChange={(event) => { setError(""); writeDraft(key, { ...draft, note: event.target.value }); }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (complete || draft.note.trim()) void perform("reply", { draft }); } }} /><div><button className="text-button" disabled={busy || editing} onClick={() => void perform("finish", { draft })}>结束讨论，检查准备稿</button><button className="primary-compact" disabled={busy || editing || (!complete && !draft.note.trim())} onClick={() => void perform("reply", { draft })}>{busy ? "正在保存…" : "提交回答，完善准备稿"}</button></div><small>回复草稿自动保存 · 两个入口同步 · Ctrl / ⌘ + Enter 提交</small></> : <div><button className="secondary-button" disabled={busy} onClick={() => { setTab("brief"); setBriefEdit(workflow.brief); setEditing(true); }}>检查 / 编辑准备稿</button><button className="primary-compact" disabled={busy || editing} onClick={() => void perform("confirm")}>确认准备稿并写正文</button></div>}
    </div>}
    </div>{full && tab === "discussion" && !editing && <aside className="task-interaction-brief-aside">{brief}</aside>}</div>
  </section>;
}
