"use client";
import { sentenceLengthLabel } from "@/lib/outline-expansion";

import { CharacterPhotoTasks } from "@/app/ui/character-photos";

import { StyleJobHistory } from "@/app/ui/style-job-history";
import { useStyleTaskSummary } from "@/app/ui/style-lab";

import { ReviewRuleSnapshotView } from "@/app/ui/review-rules";

import { GenerateReviewReportView } from "@/app/ui/generate-review-report";
import { TaskHistory } from "@/app/ui/task-history";
import { TaskInteraction } from "@/app/ui/task-interaction";
import { isTaskAwaitingAuthor } from "@/lib/writing-preparation";

import { IllustrationTaskResult } from "@/app/ui/illustration-task-result";
import { taskPhaseLabels } from "@/lib/task-history";
import { newestTaskFirst } from "@/lib/task-order";
import { TaskTimeline, type TaskTimelineEntry } from "@/app/ui/task-timeline";
import { isIllustrationTarget, taskChangesOutline } from "@/lib/task-target";

import { useEffect, useState } from "react";
import { Alert } from "@mantine/core";

import { closingSummaryLengthLabel, descriptionDetailLabel, dialogueDensityLabel, introspectionDensityLabel, narrativePaceLabel, paragraphLengthLabel } from "@/lib/generate-options";

import { normalizeOutlineTitle, outlineDisplayTitle } from "@/lib/outline-title";

import { fetchServerAction, readServerJson } from "@/lib/browser-network";
import { formatTime, useStudio, type AiTask } from "@/app/studio-state";

import { useConfiguredModels, cancelActiveChatStream, generateLengthLabel, proseControlsSummary, contentGenerationModeLabel, rewriteRetentionLabel, modelDisplayLabel, resolvedProseControls, IconButton } from "@/app/ui/studio/shared";

export function TaskPanel({ onClose, onOpen, onOpenIllustration, initialTaskId = "" }: { initialTaskId?: string; onClose: () => void; onOpenIllustration: (task: AiTask) => void; onOpen: (id: string, next?: "write" | "chat", previewVersionId?: string) => Promise<boolean> }) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const { active: styleTaskCount, total: styleTaskTotal, failed: styleFailureCount } = useStyleTaskSummary();
  const [taskKind, setTaskKind] = useState(initialTaskId.startsWith("style:") ? "style" : initialTaskId ? "generate" : "all");
  const [selectedTaskId, setSelectedTaskId] = useState(() => initialTaskId.startsWith("style:") ? "" : initialTaskId);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 3000); return () => window.clearInterval(timer); }, []);
  const tasks = [...studio.data.tasks].sort(newestTaskFirst);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const activeCount = tasks.filter((task) => task.state === "running" || task.state === "waiting").length + styleTaskCount;
  const failedCount = tasks.filter((task) => task.state === "failed").length + styleFailureCount;
  const completedCount = tasks.filter((task) => task.state === "success").length;
  const generateRunningCount = tasks.filter((task) => task.target !== "AI Chat" && task.state === "running").length;
  const chatRunningCount = tasks.filter((task) => task.target === "AI Chat" && task.state === "running").length;
  const selectedArticle = selectedTask ? studio.data.articles.find((item) => item.id === selectedTask.articleId) : undefined;
  const selectedChapter = selectedTask ? selectedArticle?.chapters.find((item) => item.id === selectedTask.chapterId) : undefined;
  const selectedOutline = selectedTask ? selectedChapter?.outlines.find((item) => item.id === selectedTask.outlineId) : undefined;
  const selectedVersion = selectedTask?.resultVersionId ? selectedOutline?.versions.find((item) => item.id === selectedTask.resultVersionId) : undefined;
  const selectedResult = selectedTask?.resultText ?? selectedVersion?.content ?? "";
  const selectedFirstAppearanceNames = selectedArticle?.characters
    .filter((character) => selectedTask?.contextOptions?.firstAppearanceCharacterIds?.includes(character.id))
    .map((character) => character.name) ?? [];
  async function locate(task: AiTask) {
    if (isIllustrationTarget(task.target)) { onOpenIllustration(task); return; }
    if (task.target === "全部名称") {
      studio.setCurrentArticle(task.articleId);
      window.history.pushState({}, "", `/articles/${task.articleId}/outlines/edit-all`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      onClose();
      return;
    }
    if (await onOpen(task.outlineId, task.target === "AI Chat" ? "chat" : "write", task.target === "正文" ? task.resultVersionId : undefined)) onClose();
  }
  async function updateTaskState(task: AiTask, action: "cancel" | "retry" | "transfer") {
    const response = await fetchServerAction(`/api/ai/tasks/${encodeURIComponent(task.id)}/state`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const payload = await readServerJson<{ task?: Partial<AiTask>; revision?: number; error?: string }>(response, "任务状态更新失败");
    if (!response.ok || !payload.task || payload.revision === undefined) throw new Error(payload.error || "任务状态更新失败");
    studio.acceptServerMutation(payload.revision, (current) => ({
      ...current,
      articles: action !== "cancel" || !taskChangesOutline(task.target) ? current.articles : current.articles.map((article) => ({ ...article, chapters: article.chapters.map((chapter) => ({ ...chapter, outlines: chapter.outlines.map((outline) => outline.id === task.outlineId ? { ...outline, state: "saved" } : outline) })) })),
      tasks: current.tasks.map((item) => item.id === task.id ? { ...item, ...payload.task } as AiTask : item),
    }));
  }
  function cancelTask(task: AiTask) {
    if (task.target === "AI Chat" && cancelActiveChatStream(task.id)) return;
    void updateTaskState(task, "cancel").catch((reason) => window.alert(reason instanceof Error ? reason.message : "取消任务失败"));
  }
  function retryTask(task: AiTask) {
    void updateTaskState(task, "retry").catch((reason) => window.alert(reason instanceof Error ? reason.message : "重试任务失败"));
  }
  function transferTask(task: AiTask) {
    void updateTaskState(task, "transfer").catch((reason) => window.alert(reason instanceof Error ? reason.message : "转移任务失败"));
  }
  function applyResult(task: AiTask) {
    if (task.target === "大纲" && task.resultText) {
      const outline = studio.data.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((item) => item.id === task.outlineId);
      const generatedTitle = normalizeOutlineTitle(task.contextOptions?.generatedOutlineTitle);
      const canApplyGeneratedTitle = Boolean(generatedTitle && outline && outline.plan === task.contextOptions?.outlinePlanSnapshot && outline.title === task.contextOptions?.outlineTitleSnapshot);
      studio.updateOutline(task.outlineId, { plan: task.resultText, ...(canApplyGeneratedTitle ? { title: generatedTitle, titleGenerationPending: false } : {}) });
    }
    else if (task.target === "章节标题" && task.resultText) studio.updateChapter(task.chapterId, { title: task.resultText });
  }
  const labels: Record<AiTask["state"], string> = { waiting: "等待中", running: "运行中", success: "已完成", failed: "失败", cancelled: "已取消" };
  const phaseLabels = taskPhaseLabels;
  const taskTime = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const duration = (milliseconds: number) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
  };
  const taskElapsed = (task: AiTask) => {
    if (!task.startedAt) return "—";
    const start = new Date(task.startedAt).getTime();
    const end = task.completedAt ? new Date(task.completedAt).getTime() : task.state === "waiting" || task.state === "running" ? clock : task.lastProgressAt ? new Date(task.lastProgressAt).getTime() : start;
    return duration(end - start);
  };
  const isStale = (task: AiTask) => task.state === "running" && (!task.leaseUntil || new Date(task.leaseUntil).getTime() <= clock);
  const isForeign = (task: AiTask) => task.executionOrigin !== studio.executionOrigin;
  const transferLabel = studio.executionOrigin === "cloud" ? "转移到云端执行" : "转移到本地执行";

  const taskDetails = selectedTask ? <>          <dl className="task-detail-metadata">
            <div><dt>生成目标</dt><dd>{selectedTask.target === "AI Chat" ? "聊天" : selectedTask.target}{selectedTask.target === "正文" ? ` · ${generateLengthLabel(selectedTask.contextOptions)}` : ""}</dd></div>
            {selectedTask.target === "正文" && <div className="wide"><dt>正文表达</dt><dd>{proseControlsSummary(selectedTask.contextOptions)}</dd></div>}
            {selectedTask.target === "正文" && <div><dt>生成方式</dt><dd>{contentGenerationModeLabel(selectedTask.contextOptions?.contentMode)}{selectedTask.contextOptions?.contentMode === "rewrite" ? ` · 原文保留 ${rewriteRetentionLabel(selectedTask.contextOptions.rewriteRetention)}` : ""}</dd></div>}
            {selectedTask.contextOptions?.contentMode === "rewrite" && <div><dt>改写原文</dt><dd>{selectedTask.contextOptions.rewriteSourceName || "原正文"}</dd></div>}
            <div><dt>模型</dt><dd>{modelDisplayLabel(models, selectedTask.model || "", selectedTask.contextOptions?.modelName)}</dd></div>
            {selectedTask.contextOptions?.resolvedReasoningEffort !== undefined && <div><dt>推理强度</dt><dd>{selectedTask.contextOptions.resolvedReasoningEffort ?? "不指定"}{selectedTask.contextOptions.reasoningEffort === undefined ? "（沿用模型）" : "（任务设置）"}</dd></div>}
            <div><dt>阶段</dt><dd>{phaseLabels[selectedTask.phase ?? "queued"]}</dd></div>
            <div><dt>尝试</dt><dd>{selectedTask.attempt ? `${selectedTask.attempt} / 3` : "—"}</dd></div>
            <div><dt>超时</dt><dd>{duration(selectedTask.timeoutMs ?? 600_000)}</dd></div>
            <div><dt>已接收</dt><dd>{(selectedTask.receivedCharacters ?? 0).toLocaleString("zh-CN")} 字符</dd></div>
            <div><dt>提交时间</dt><dd>{taskTime(selectedTask.createdAt)}</dd></div>
            <div><dt>最近更新</dt><dd>{selectedTask.lastProgressAt ? taskTime(selectedTask.lastProgressAt) : "—"}</dd></div>
            <div className="wide"><dt>位置</dt><dd>{selectedArticle?.title ?? "已删除的文章"}{selectedTask.target === "全部名称" ? " / 章节与大纲" : ` / ${selectedChapter?.title ?? "已删除的章节"} / ${selectedOutline ? outlineDisplayTitle(selectedOutline) : "已删除的大纲"}`}</dd></div>
          </dl>
          {selectedTask.contextOptions?.promptContext?.currentOutline.expansion && <section className="task-detail-section"><h3>提交时的逐句篇幅</h3><div className="task-detail-copy">{selectedTask.contextOptions.promptContext.currentOutline.expansion.sentences.map((sentence, index) => <p key={sentence.start}>{index + 1}. {sentence.text}<br /><small>{sentenceLengthLabel(sentence)} · 目标 {sentence.targetCharacters.toLocaleString("zh-CN")} 字</small></p>)}</div></section>}
          <section className="task-detail-section"><h3>任务指令</h3><div className="task-detail-copy">{selectedTask.prompt || (selectedTask.target === "全部名称" ? "使用文章命名设置，无补充要求" : "按大纲生成（无补充指令）")}</div></section>
          {selectedTask.contextOptions && <section className="task-detail-section"><h3>生成上下文</h3><div className="task-context-tags">{selectedTask.target === "全部名称" ? <><span>一次模型请求</span><span>{selectedTask.contextOptions.nameChapterCount ?? 0} 个章节名</span><span>{selectedTask.contextOptions.nameOutlineCount ?? 0} 个大纲名</span></> : <><span>{selectedTask.contextOptions.includePrevious ? "包含前面大纲" : "不包含前面大纲"}</span><span>{selectedTask.contextOptions.includeCharacters ? "包含相关人物" : "不包含相关人物"}</span></>}{selectedTask.target === "正文" && <span>{contentGenerationModeLabel(selectedTask.contextOptions.contentMode)}</span>}{selectedTask.target === "正文" && <><span>对话 {dialogueDensityLabel(resolvedProseControls(selectedTask.contextOptions).dialogueDensity)}</span><span>心理 {introspectionDensityLabel(resolvedProseControls(selectedTask.contextOptions).introspectionDensity)}</span><span>描写 {descriptionDetailLabel(resolvedProseControls(selectedTask.contextOptions).descriptionDetail)}</span><span>节奏 {narrativePaceLabel(resolvedProseControls(selectedTask.contextOptions).narrativePace)}</span><span>段落 {paragraphLengthLabel(resolvedProseControls(selectedTask.contextOptions).paragraphLength)}</span></>}{selectedTask.target === "正文" && selectedTask.contextOptions.contentMode === "rewrite" && <span>原文保留 {rewriteRetentionLabel(selectedTask.contextOptions.rewriteRetention)}</span>}{selectedTask.target === "正文" && <span>{selectedTask.contextOptions.includeExcellentFragments ? `参考优秀片段 ${selectedTask.contextOptions.excellentFragmentIds?.length ?? 0} 个` : "不参考优秀片段"}</span>}{selectedTask.target === "正文" && <span>{selectedTask.contextOptions.contentMode === "fresh" ? "不发送当前正文" : "包含当前正文"}</span>}{selectedTask.target === "正文" && <span>收尾 {closingSummaryLengthLabel(selectedTask.contextOptions.closingSummaryLength, selectedTask.contextOptions.includeClosingSummary)}</span>}{selectedTask.target === "正文" && <span>{selectedTask.contextOptions.includeOutlineTitle ? "同时生成大纲名" : "不生成大纲名"}</span>}{selectedTask.target === "正文" && selectedTask.contextOptions.firstAppearanceCharacterIds && <span>首次出场：{selectedFirstAppearanceNames.length ? selectedFirstAppearanceNames.join("、") : "无"}</span>}{typeof selectedTask.contextOptions.estimatedCharacters === "number" && <span>约 {selectedTask.contextOptions.estimatedCharacters.toLocaleString("zh-CN")} 字符</span>}{selectedTask.contextOptions.sessionId && <span>会话 {selectedTask.contextOptions.sessionId}</span>}</div></section>}
          {selectedTask.contextOptions?.generatedOutlineTitleError && <section className="task-detail-section task-detail-error"><h3>大纲名未应用</h3><div>{selectedTask.contextOptions.generatedOutlineTitleError}。正文已正常保存。</div></section>}
          {!!selectedTask.contextOptions?.reviewMaxRounds && <section className="task-detail-section"><h3>生成后审校</h3><p>已修正 {selectedTask.contextOptions.reviewRound ?? 0} / {selectedTask.contextOptions.reviewMaxRounds} 次</p><details><summary>本次审校规则</summary><div className="task-detail-copy">{selectedTask.contextOptions.reviewRuleSnapshot ? <ReviewRuleSnapshotView snapshot={selectedTask.contextOptions.reviewRuleSnapshot} /> : <>文章通用规则：{selectedTask.contextOptions.reviewRules || "无额外规则"}{"\n\n"}本次指令：{selectedTask.contextOptions.reviewInstruction || "无额外指令"}</>}</div></details></section>}
</> : null;

  function taskCard(task: AiTask) {
    const article = studio.data.articles.find((item) => item.id === task.articleId);
    const chapter = article?.chapters.find((item) => item.id === task.chapterId);
    const outline = chapter?.outlines.find((item) => item.id === task.outlineId);
    return <article className="task-card" key={task.id}>
      <div className="task-state"><span className={`state-dot ${isTaskAwaitingAuthor(task) ? "awaiting-author" : task.state}`} />{isTaskAwaitingAuthor(task) ? "等待作者" : labels[task.state]} · {phaseLabels[task.phase ?? "queued"]} · {formatTime(task.createdAt)}</div>
      <button className="task-title" type="button" aria-label={`查看任务详情：${task.target === "全部名称" ? "整篇章节与大纲命名" : outline ? outlineDisplayTitle(outline) : "已删除的大纲"}`} onClick={() => setSelectedTaskId(task.id)}>{task.target === "全部名称" ? "整篇章节与大纲命名" : outline ? outlineDisplayTitle(outline) : "已删除的大纲"}</button>
      <p>{article?.title ?? "未知文章"}{task.target === "全部名称" ? ` · ${task.contextOptions?.nameChapterCount ?? 0} 章 · ${task.contextOptions?.nameOutlineCount ?? 0} 个大纲` : ` · ${chapter?.title ?? "未知章节"}`} · 目标：{task.target === "AI Chat" ? "聊天" : task.target}{task.target === "正文" ? ` · ${contentGenerationModeLabel(task.contextOptions?.contentMode)}${task.contextOptions?.contentMode === "rewrite" ? ` · 原文保留 ${rewriteRetentionLabel(task.contextOptions.rewriteRetention)}` : ""} · ${proseControlsSummary(task.contextOptions)} · ${generateLengthLabel(task.contextOptions)}` : ""}</p>
      <blockquote>{task.prompt || (task.target === "全部名称" ? "使用文章命名设置" : "按大纲生成")}</blockquote>
      {task.error && <p className="task-error">{task.error}</p>}
      <TaskHistory task={task} collapsible />
      <div><span>{modelDisplayLabel(models, task.model || "", task.contextOptions?.modelName)}</span><span className="task-buttons">
        <button type="button" onClick={() => setSelectedTaskId(task.id)}>打开</button>
        {(task.state === "waiting" || task.state === "running") && <button type="button" onClick={() => cancelTask(task)}>取消</button>}
        {isForeign(task) && !isIllustrationTarget(task.target) && task.target !== "AI Chat" && (task.state === "waiting" || isStale(task)) && <button type="button" onClick={() => transferTask(task)}>{transferLabel}</button>}
        {task.state === "success" && (task.target === "大纲" || task.target === "章节标题") && <button type="button" onClick={() => { applyResult(task); locate(task); }}>应用结果</button>}
        {(task.state === "failed" || task.state === "cancelled" || isStale(task)) && (task.target === "AI Chat" ? <button type="button" onClick={() => { studio.setChatDraft(task.outlineId, task.prompt); locate(task); }}>再次发送</button> : <button type="button" onClick={() => retryTask(task)}>重新执行</button>)}
        {["success", "failed", "cancelled"].includes(task.state) && <button type="button" onClick={() => studio.removeTask(task.id)}>移除</button>}
      </span></div>
    </article>;
  }
  const taskEntries: TaskTimelineEntry[] = tasks.map(task => ({ id: `task:${task.id}`, createdAt: task.createdAt, content: taskCard(task) }));

  return <section className="workspace task-workspace" aria-label="AI 任务工作区">
    <header className="workspace-header"><div className="task-drawer-title">{selectedTask && <IconButton name="back" label="返回任务列表" onClick={() => setSelectedTaskId("")} />}<div><strong>{selectedTask ? (selectedOutline ? outlineDisplayTitle(selectedOutline) : "任务详情") : "AI 任务"}</strong><span>{selectedTask ? taskPhaseLabels[selectedTask.phase ?? "queued"] : activeCount ? String(activeCount) + " 个待处理任务" : failedCount ? `${failedCount} 个任务需要处理` : "没有进行中的任务"}</span></div></div><IconButton name="close" label="关闭 AI 任务" onClick={onClose} /></header>
    {!selectedTask && <nav className="style-task-tabs" aria-label="任务类型"><button type="button" aria-pressed={taskKind === "all"} onClick={() => { setTaskKind("all"); setSelectedTaskId(""); }}>全部任务</button><button type="button" aria-pressed={taskKind === "generate"} onClick={() => { setTaskKind("generate"); setSelectedTaskId(""); }}>生成与对话</button><button type="button" aria-label="学习与微调" aria-pressed={taskKind === "style"} onClick={() => { setTaskKind("style"); setSelectedTaskId(""); }}>学习与微调{styleTaskTotal ? ` · ${styleTaskTotal}` : ""}</button></nav>}
    <div className="task-workspace-content">
      {taskKind === "style" ? <div className="task-panel style-task-panel" data-ui-overlay-scroll><StyleJobHistory onOpenArticle={onClose} initialJobId={initialTaskId.startsWith("style:") ? initialTaskId.slice(6) : ""} /></div> : <>
      {selectedTask && <nav className="task-workspace-rail" aria-label="任务列表">{tasks.map((task) => <button type="button" key={task.id} aria-current={selectedTaskId === task.id ? "true" : undefined} onClick={() => setSelectedTaskId(task.id)}><span className={"state-dot " + (isTaskAwaitingAuthor(task) ? "awaiting-author" : task.state)} /><span><strong>{studio.data.articles.flatMap((article) => article.chapters).flatMap((chapter) => chapter.outlines).find((outline) => outline.id === task.outlineId)?.title || task.target}</strong><small>{taskPhaseLabels[task.phase ?? "queued"]}</small></span></button>)}</nav>}
      <div className="task-panel" aria-label="AI 任务">
      {selectedTask?.contextOptions?.writingPreparation ? <section className="task-detail workflow-task-detail" aria-label="任务详情">
        <TaskInteraction key={selectedTask.id + ":" + selectedTask.contextOptions.writingPreparation.revision} task={selectedTask} full details={taskDetails} />
        <footer className="task-detail-actions"><button type="button" onClick={() => locate(selectedTask)}>{selectedTask.state === "success" ? "打开生成版本" : "打开对应内容"}</button>{(selectedTask.state === "waiting" || selectedTask.state === "running") && <button type="button" onClick={() => cancelTask(selectedTask)}>取消任务</button>}{isForeign(selectedTask) && (selectedTask.state === "waiting" || isStale(selectedTask)) && <button onClick={() => transferTask(selectedTask)}>{transferLabel}</button>}{(selectedTask.state === "failed" || selectedTask.state === "cancelled" || isStale(selectedTask)) && <button onClick={() => retryTask(selectedTask)}>重新执行</button>}{["success", "failed", "cancelled"].includes(selectedTask.state) && <button className="danger-text" type="button" onClick={() => { setSelectedTaskId(""); studio.removeTask(selectedTask.id); }}>移除</button>}</footer>
      </section> : selectedTask ? <section className="task-detail" aria-label="任务详情">
        <div className="task-detail-body" data-ui-overlay-scroll>
          <div className={`task-detail-status ${isStale(selectedTask) ? "stale" : ""}`}><span className={`state-dot ${selectedTask.state}`} /><span className="ui-label">{isStale(selectedTask) ? "执行心跳已中断" : labels[selectedTask.state]}</span><span>{phaseLabels[selectedTask.phase ?? "queued"]} · {selectedTask.executionOrigin === "cloud" ? "云端执行" : "本地执行"} · 已用时 {taskElapsed(selectedTask)}</span></div>
          <TaskHistory task={selectedTask} />
          {taskDetails}
          {selectedTask.contextOptions?.reviewReport && <GenerateReviewReportView report={selectedTask.contextOptions.reviewReport} />}
          {selectedTask.contextOptions?.reviewCandidateOnly && <Alert color="yellow">执行期间正文已变化，终稿已保存为候选版本，可通过“打开生成版本”查看。</Alert>}
          {!!selectedTask.contextOptions?.reviewMaxRounds && selectedTask.state === "failed" && !selectedTask.contextOptions.reviewReport && <Alert color="yellow">审校未完成。下方结果是最近保存的中间稿，重新执行会从保存的进度继续。</Alert>}
          {selectedTask.error && <section className="task-detail-section task-detail-error"><h3>错误</h3><div>{selectedTask.error}</div></section>}
          <section className="task-detail-section"><h3>任务结果</h3>{isIllustrationTarget(selectedTask.target) && selectedTask.state === "success" ? <IllustrationTaskResult id={selectedTask.contextOptions?.illustrationId || selectedTask.id} prompt={selectedResult} image={selectedTask.target === "插图"} /> : selectedResult ? <div className="task-detail-result" aria-label="任务结果">{selectedResult}</div> : <div className="task-detail-empty">{selectedTask.state === "waiting" || selectedTask.state === "running" ? "任务尚未产生结果" : "没有可用结果"}</div>}</section>
        </div>
        <footer className="task-detail-actions">
          <button type="button" onClick={() => locate(selectedTask)}>{isIllustrationTarget(selectedTask.target) ? "查看生成历史" : selectedTask.target === "全部名称" ? "查看名称候选" : selectedTask.state === "success" && selectedTask.target === "正文" ? "打开生成版本" : "打开对应内容"}</button>
          {(selectedTask.state === "waiting" || selectedTask.state === "running") && <button type="button" onClick={() => cancelTask(selectedTask)}>取消</button>}
          {isForeign(selectedTask) && !isIllustrationTarget(selectedTask.target) && selectedTask.target !== "AI Chat" && (selectedTask.state === "waiting" || isStale(selectedTask)) && <button type="button" onClick={() => transferTask(selectedTask)}>{transferLabel}</button>}
          {selectedTask.state === "success" && (selectedTask.target === "大纲" || selectedTask.target === "章节标题") && <button type="button" onClick={() => applyResult(selectedTask)}>应用结果</button>}
          {(selectedTask.state === "failed" || selectedTask.state === "cancelled" || isStale(selectedTask)) && (selectedTask.target === "AI Chat" ? <button type="button" onClick={() => { studio.setChatDraft(selectedTask.outlineId, selectedTask.prompt); locate(selectedTask); }}>再次发送</button> : <button type="button" onClick={() => retryTask(selectedTask)}>重新执行</button>)}
          {["success", "failed", "cancelled"].includes(selectedTask.state) && <button className="danger-text" type="button" onClick={() => { setSelectedTaskId(""); studio.removeTask(selectedTask.id); }}>移除</button>}
        </footer>
      </section> : <><div className="task-list" data-ui-overlay-scroll>{taskKind === "all"
        ? <StyleJobHistory onOpenArticle={onClose} renderList={styleEntries => <CharacterPhotoTasks renderList={photoEntries => <TaskTimeline entries={[...taskEntries, ...styleEntries, ...photoEntries]} />} />} />
        : <CharacterPhotoTasks renderList={photoEntries => <TaskTimeline entries={[...taskEntries, ...photoEntries]} />} />
      }</div>
      <footer><span>生成并发 {generateRunningCount} / {studio.data.settings.taskConcurrency}{chatRunningCount ? ` · Chat ${chatRunningCount}` : ""}</span><span className="task-footer-actions"><button type="button" disabled={!completedCount} onClick={() => studio.clearCompletedTasks()}>清空已完成{completedCount ? ` (${completedCount})` : ""}</button><button type="button" onClick={() => { onClose(); window.history.pushState({}, "", "/settings/tasks"); window.dispatchEvent(new PopStateEvent("popstate")); }}>任务设置 →</button></span></footer></>}
    </div></>}
    </div>
  </section>;
}
