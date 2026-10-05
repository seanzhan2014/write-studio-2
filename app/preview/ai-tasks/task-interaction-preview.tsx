"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  allDemoAnswers, demoProse, demoQuestions, demoStorageError, finishDemoReply,
  preparationSections, preparationText, resetDemo, submitDemoReply, updateDemo,
  useDemoState, type DemoPhase, type DemoState,
} from "./demo-store";
import styles from "./task-interaction-preview.module.css";

type View = "tasks" | "generate" | "write" | "settings";
type TaskId = "current" | "complete" | "error";
type IconName = "book" | "tasks" | "spark" | "send" | "check" | "back" | "settings" | "reset" | "document" | "chevron" | "menu" | "close";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    book: <><path d="M12 5c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" /><path d="M12 5v14" /></>,
    tasks: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m8 8 1 1 2-2M13 8h3m-8 6 1 1 2-2m2 1h3" /></>,
    spark: <><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" /><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z" /></>,
    send: <><path d="M12 19V5m-6 6 6-6 6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    back: <path d="m14 5-7 7 7 7" />,
    settings: <><path d="M4 7h16M4 17h16" /><rect x="7" y="4" width="4" height="6" rx="1" /><rect x="14" y="14" width="4" height="6" rx="1" /></>,
    reset: <><path d="M4 10a8 8 0 1 1 2 8M4 4v6h6" /></>,
    document: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8m-8 4h5" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const phaseLabels: Record<DemoPhase, string> = { awaiting: "等待作者回答", thinking: "正在完善准备稿", ready: "等待确认准备稿", writing: "正在写正文", completed: "正文已完成" };

function StatusDot({ phase, error = false }: { phase: DemoPhase; error?: boolean }) {
  const label = error ? "任务出错" : phaseLabels[phase];
  const color = error ? "red" : phase === "completed" ? "blue" : phase === "awaiting" || phase === "ready" ? "yellow" : "working";
  return <span className={`${styles.dot} ${styles[color]}`} role="img" aria-label={label} title={label} />;
}

function PhaseBadge({ state }: { state: DemoState }) {
  return <span className={`${styles.phaseBadge} ${["awaiting", "ready"].includes(state.phase) ? styles.needsAnswer : ""}`}><StatusDot phase={state.phase} />{phaseLabels[state.phase]}</span>;
}

function Preparation({ state, compact = false }: { state: DemoState; compact?: boolean }) {
  const sections = preparationSections(state);
  return <div className={`${styles.preparation} ${compact ? styles.compactPreparation : ""}`}>
    <div className={styles.preparationTitle}><span className={styles.eyebrow}>WRITING BRIEF</span><h2>旧档案室</h2><p>第三章 · 雾港来信</p></div>
    <div className={styles.briefMeta}><span>{state.round === 0 ? "初版" : `第 ${state.round} 次完善`}</span><span>{state.replies.length ? `${Object.keys(allDemoAnswers(state)).length} 项已讨论` : "待作者决定"}</span></div>
    {state.editedPreparation ? <div className={styles.preparedPlainText}>{state.editedPreparation}</div> : sections.map((section, index) => <section className={styles.briefSection} key={section.title}><h3><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</h3><p>{section.text}</p></section>)}
    {!state.editedPreparation && state.replies.some((reply) => reply.note) && <section className={styles.briefSection}><h3>作者补充</h3>{state.replies.filter((reply) => reply.note).map((reply) => <p key={reply.round}>{reply.note}</p>)}</section>}
    <p className={styles.briefFootnote}>正文会参考确认后的准备稿，原始大纲仍作为事实依据。</p>
  </div>;
}

function Questions({ state }: { state: DemoState }) {
  return <div className={styles.questionStack}>{demoQuestions(state.round).map((question, index) => <fieldset className={styles.question} key={question.id}>
    <legend><span>{index + 1}</span>{question.title}</legend>
    <p>{question.reason}</p>
    <div className={styles.options}>{question.options.map((option, optionIndex) => <label className={`${styles.option} ${state.choices[question.id] === option.value ? styles.selectedOption : ""}`} key={option.value}>
      <input type="radio" name={`demo-${question.id}`} value={option.value} checked={state.choices[question.id] === option.value} onChange={() => updateDemo((current) => ({ ...current, choices: { ...current.choices, [question.id]: option.value } }))} />
      <span><span className={styles.optionTitle}>{option.title}{optionIndex === 0 && <small>建议</small>}</span><span className={styles.optionDetail}>{option.detail}</span></span>
    </label>)}</div>
  </fieldset>)}</div>;
}

function Composer({ state, inline = false, onEdit, onWrite }: { state: DemoState; inline?: boolean; onEdit: () => void; onWrite: () => void }) {
  const ready = state.phase === "ready";
  const busy = state.phase === "thinking" || state.phase === "writing";
  const completeChoices = demoQuestions(state.round).every((question) => state.choices[question.id]);
  return <div className={`${styles.composerArea} ${inline ? styles.inlineComposer : ""}`}>
    {ready ? <div className={styles.readyActions}><div><Icon name="check" /><span>准备稿已整理完成，请确认写作方向。</span></div><div><button className={styles.secondaryButton} onClick={onEdit}>编辑准备稿</button><button className={styles.primaryButton} onClick={onWrite}><Icon name="spark" />确认并写正文</button></div></div> : state.phase === "completed" ? <div className={styles.finishedLine}><Icon name="check" />正文已保存为演示版本，可在「正文」中查看。</div> : <>
      <div className={styles.composerBox}>
        <label className={styles.srOnly} htmlFor={inline ? "inline-author-reply" : "task-author-reply"}>作者回复</label>
        <textarea id={inline ? "inline-author-reply" : "task-author-reply"} rows={2} maxLength={6000} placeholder={busy ? "任务正在继续，稍后可回答下一轮问题…" : "选择上方选项，或直接写下你的想法…"} value={state.replyDraft} disabled={busy} onChange={(event) => updateDemo((current) => ({ ...current, replyDraft: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); submitDemoReply(); } }} />
        <div className={styles.composerBottom}><span>{busy ? phaseLabels[state.phase] : `${Object.keys(state.choices).length} 项已选择 · 补充说明可选`}</span><button className={styles.sendButton} aria-label="提交回答并完善准备稿" disabled={busy || !completeChoices && !state.replyDraft.trim()} onClick={submitDemoReply}><Icon name="send" /></button></div>
      </div>
      <div className={styles.composerHint}><span>回答后继续完善 · 第 {Math.min(state.round + 1, state.maxRounds)} / {state.maxRounds} 轮</span><span>Ctrl / ⌘ + Enter 提交</span></div>
    </>}
  </div>;
}

function Conversation({ state, inline = false }: { state: DemoState; inline?: boolean }) {
  return <div className={`${styles.conversation} ${inline ? styles.inlineConversation : ""}`}>
    {!inline && <div className={styles.conversationStart}><Icon name="spark" /><span>根据大纲整理准备稿，并与作者共同决定未知项。</span></div>}
    {!inline && <div className={styles.authorMessage}><span className={styles.authorAvatar}>作</span><div><span className={styles.messageName}>作者</span><p>按大纲写林舟进入旧档案室，发现父亲失踪记录中的异常，再与沈砚交锋。先和我讨论需要确定的地方。</p></div></div>}
    {!inline && state.replies.map((reply) => <div key={reply.round} className={styles.replyPair}><div className={styles.authorMessage}><span className={styles.authorAvatar}>作</span><div><span className={styles.messageName}>作者 <small>第 {reply.round} 轮回答</small></span>{Object.entries(reply.answers).map(([id, value]) => { const question = demoQuestions(reply.round - 1).find((q) => q.id === id); return <p key={id}>{question?.options.find((option) => option.value === value)?.title ?? "在补充说明中讨论此项"}</p>; })}{reply.note && <p>{reply.note}</p>}</div></div><div className={styles.assistantMessage}><span className={styles.aiAvatar}><Icon name="spark" /></span><div><span className={styles.messageName}>写作助手</span><p>已将第 {reply.round} 轮选择和补充说明纳入准备稿。角色的行动会遵循更新后的信息边界。</p></div></div></div>)}
    <div className={styles.assistantMessage}><span className={styles.aiAvatar}><Icon name="spark" /></span><div className={styles.assistantBody}><span className={styles.messageName}>写作助手 <small>{state.round === 0 ? "准备稿初版" : `准备稿 v${state.round + 1}`}</small></span>
      {state.phase === "awaiting" && <><p>{state.round === 0 ? "准备稿已整理好。林舟会从档案里的异常开始调查，但几个选择会影响悬念和人物行动，需要先听听你的想法。" : "准备稿已经更新。接下来，我们再确定一个影响场景推进的选择。"}</p><div className={styles.inlineBrief}><Icon name="document" /><div><strong>写作准备稿</strong><span>9 项内容 · {state.round === 0 ? "已生成初版" : `已完善 ${state.round} 次`}</span></div><span className={styles.briefVersion}>v{state.round + 1}</span></div><Questions state={state} /></>}
      {(state.phase === "thinking" || state.phase === "writing") && <p className={styles.workingMessage}><span className={styles.spinner} />{state.phase === "thinking" ? "正在更新人物认知、场景顺序和准备稿…" : "正在根据已确认的准备稿生成示例正文…"}</p>}
      {state.phase === "ready" && <><p>{state.maxRounds === 0 ? "互动已关闭，初版准备稿已就绪。" : `已完成 ${state.round} 轮讨论，准备稿已就绪。`}你可以再检查或手动修改，确认后进入正文写作。</p><div className={styles.readySummary}><Icon name="check" /><div><strong>等待你确认写作方向</strong><p>已讨论的选择保留在准备稿中。未决项会明确留白，示例正文展示已选择的情节方向。</p></div></div></>}
      {state.phase === "completed" && <><p>示例正文已完成。准备稿和作者的选择保留在这个任务中，两个入口都能查看。</p><div className={styles.readySummary}><Icon name="document" /><div><strong>旧档案室 · 演示正文</strong><p>{demoProse(state).length.toLocaleString("zh-CN")} 字 · 根据本次选择组合的示例</p></div></div></>}
    </div></div>
  </div>;
}

export default function TaskInteractionPreview() {
  const state = useDemoState();
  const [view, setView] = useState<View>("tasks");
  const [selectedTask, setSelectedTask] = useState<TaskId>("current");
  const [detailTab, setDetailTab] = useState<"conversation" | "preparation">("conversation");
  const [showTaskList, setShowTaskList] = useState(false);
  const [showNavigation, setShowNavigation] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const shellRef = useRef<HTMLDivElement>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const taskPhase = selectedTask === "complete" ? "completed" : state.phase;
  const title = selectedTask === "current" ? "旧档案室" : selectedTask === "complete" ? "雨后的码头" : "一封没有寄出的信";

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => shellRef.current?.style.setProperty("--demo-view-height", `${viewport.height}px`);
    resize();
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (state.phase !== "thinking" && state.phase !== "writing") return;
    const timer = window.setTimeout(() => {
      if (state.phase === "thinking") finishDemoReply();
      else updateDemo((current) => current.phase === "writing" ? { ...current, phase: "completed" } : current);
    }, state.phase === "thinking" ? 850 : 1600);
    return () => window.clearTimeout(timer);
  }, [state.phase]);

  useEffect(() => { if (state.replies.length) conversationEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [state.phase, state.replies.length, view]);

  function openCurrent(nextView: View = "tasks") { setSelectedTask("current"); setView(nextView); setShowTaskList(false); setShowNavigation(false); }
  function openTask(id: TaskId) { setSelectedTask(id); setView("tasks"); setShowTaskList(false); setShowNavigation(false); setDetailTab("conversation"); }
  function editPreparation() { setDetailTab("preparation"); setEditing(true); }
  function startWriting() { updateDemo((current) => current.phase === "ready" ? { ...current, phase: "writing" } : current); setDetailTab("conversation"); }
  function restart() { resetDemo(); openCurrent(); setDetailTab("conversation"); setEditing(false); setNotice("演示已重置，可以重新体验一轮写作讨论。"); }

  const taskList = <aside className={`${styles.taskList} ${showTaskList ? styles.mobileTaskListVisible : ""}`} aria-label="任务列表">
    <div className={styles.taskListHeading}><h2>AI 任务</h2><span>3</span></div>
    <p className={styles.listCaption}>需要你处理</p>
    <button className={`${styles.taskItem} ${selectedTask === "current" ? styles.activeTask : ""}`} onClick={() => openTask("current")}><div><StatusDot phase={state.phase} /><strong>旧档案室</strong></div><p>{phaseLabels[state.phase]}</p><span>正文 · 第三章</span><small>{state.round} / {state.maxRounds} 轮互动</small></button>
    <p className={styles.listCaption}>最近任务</p>
    <button className={`${styles.taskItem} ${selectedTask === "complete" ? styles.activeTask : ""}`} onClick={() => openTask("complete")}><div><StatusDot phase="completed" /><strong>雨后的码头</strong></div><p>正文已完成</p><span>正文 · 第三章</span><small>今天 09:12 · 示例</small></button>
    <button className={`${styles.taskItem} ${selectedTask === "error" ? styles.activeTask : ""}`} onClick={() => openTask("error")}><div><StatusDot phase="completed" error /><strong>一封没有寄出的信</strong></div><p>模型连接失败</p><span>正文 · 第二章</span><small>昨天 21:36 · 示例</small></button>
    <div className={styles.taskListBottom}><span>等待作者时不占生成名额</span><button onClick={() => { setView("settings"); setShowTaskList(false); }}><Icon name="settings" />全局任务设置</button></div>
  </aside>;

  return <div className={styles.shell} ref={shellRef}>
    <aside className={`${styles.sidebar} ${showNavigation ? styles.mobileNavigationVisible : ""}`} aria-label="写作目录">
      <div className={styles.brand}><span className={styles.brandIcon}><Icon name="book" /></span><strong>Writer Studio</strong><button className={styles.mobileOnly} aria-label="关闭目录" onClick={() => setShowNavigation(false)}><Icon name="close" /></button></div>
      <div className={styles.bookLabel}><span className={styles.eyebrow}>当前作品</span><h1>雾港来信</h1><p>悬疑 · 人物驱动</p></div>
      <nav className={styles.outlineNav}><span className={styles.chapterLabel}>第二章 · 留下的人</span><button onClick={() => openTask("error")}><span>一封没有寄出的信</span><StatusDot phase="completed" error /></button><span className={styles.chapterLabel}>第三章 · 潮水之间</span><button onClick={() => openTask("complete")}><span>雨后的码头</span><StatusDot phase="completed" /></button><button className={styles.selectedOutline} onClick={() => openCurrent()}><span>旧档案室</span><StatusDot phase={state.phase} /></button><button onClick={() => { openCurrent("write"); setNotice("当前展示的是旧档案室的写作工作区。"); }}><span>门外的脚步声</span></button></nav>
      <div className={styles.sidebarBottom}><button className={view === "tasks" ? styles.selectedNav : ""} onClick={() => openCurrent()}><Icon name="tasks" /><span>AI 任务</span>{["awaiting", "ready"].includes(state.phase) && <span className={styles.navCount}>1</span>}</button><button onClick={() => { setView("settings"); setShowNavigation(false); }}><Icon name="settings" /><span>任务设置</span></button><div className={styles.previewLabel}>交互演示 <span>示例数据</span></div></div>
    </aside>

    <div className={`${styles.workspace} ${showNavigation ? styles.hideOnMobile : ""}`}>
      <header className={styles.workspaceHeader}><div className={styles.breadcrumb}><button className={styles.mobileOnly} aria-label="打开目录" onClick={() => setShowNavigation(true)}><Icon name="menu" /></button><span>雾港来信</span><Icon name="chevron" /><span>第三章</span><Icon name="chevron" /><strong>旧档案室</strong></div><div className={styles.headerActions}><span className={styles.demoBadge}>交互演示</span><button aria-label="重置演示" title="重置演示" onClick={restart}><Icon name="reset" /><span>重置</span></button></div></header>
      <div className={styles.workspaceTabs} role="tablist" aria-label="写作工作区"><button role="tab" aria-selected={view === "write"} onClick={() => openCurrent("write")}><Icon name="document" />正文</button><button role="tab" aria-selected={view === "generate"} onClick={() => openCurrent("generate")}><Icon name="spark" />AI Generate</button><button role="tab" aria-selected={view === "tasks"} onClick={() => openCurrent()}><Icon name="tasks" />AI 任务{["awaiting", "ready"].includes(state.phase) && <StatusDot phase={state.phase} />}</button></div>

      {view === "tasks" && <div className={styles.taskWorkspace}>
        {taskList}
        <main className={`${styles.taskDetail} ${showTaskList ? styles.hideOnMobile : ""}`} aria-label="完整任务工作区">
          <header className={styles.detailHeader}><div className={styles.taskTitle}><button className={styles.mobileOnly} aria-label="返回任务列表" onClick={() => setShowTaskList(true)}><Icon name="back" /></button><div><div className={styles.taskTitleLine}><h1>{title}</h1><StatusDot phase={taskPhase} error={selectedTask === "error"} /></div><p>正文生成 <span>·</span> {selectedTask === "error" ? "第二章" : "第三章"}{selectedTask === "current" && <> <span>·</span> {state.round} / {state.maxRounds} 轮互动</>}</p></div></div>{selectedTask === "current" ? <PhaseBadge state={state} /> : <span className={styles.phaseBadge}>{selectedTask === "error" ? "执行失败" : "已完成"}</span>}</header>
          {selectedTask === "current" ? <>
            <div className={styles.detailTabs} role="tablist" aria-label="任务内容"><button role="tab" aria-selected={detailTab === "conversation"} onClick={() => { setDetailTab("conversation"); setEditing(false); }}>讨论{state.replies.length > 0 && <span>{state.replies.length}</span>}</button><button role="tab" aria-selected={detailTab === "preparation"} onClick={() => setDetailTab("preparation")}>准备稿 <span>v{state.round + 1}</span></button><div><Icon name="check" />自动保存</div></div>
            {detailTab === "conversation" ? <><div className={styles.discussionScroll}><Conversation state={state} /><div ref={conversationEnd} /></div><Composer state={state} onEdit={editPreparation} onWrite={startWriting} /></> : <><div className={styles.preparationScroll}>{editing ? <div className={styles.preparationEditor}><label htmlFor="preparation-editor">修改写作准备稿</label><p>修改会自动保存，并在两个入口中同步显示。</p><textarea id="preparation-editor" value={state.editedPreparation || preparationText(state)} onChange={(event) => updateDemo((current) => ({ ...current, editedPreparation: event.target.value }))} /><button className={styles.secondaryButton} onClick={() => setEditing(false)}>完成编辑</button></div> : <><Preparation state={state} /><button className={styles.editBriefButton} onClick={() => setEditing(true)}>编辑这份准备稿</button></>}</div><div className={styles.preparationFooter}><button className={styles.secondaryButton} onClick={() => setDetailTab("conversation")}>返回讨论</button>{state.phase === "awaiting" || state.phase === "ready" ? <button className={styles.primaryButton} onClick={() => { updateDemo((current) => ({ ...current, phase: "ready" })); setDetailTab("conversation"); }}>结束讨论，确认准备稿</button> : <span>{phaseLabels[state.phase]}</span>}</div></>}
          </> : <div className={styles.staticTask}>{selectedTask === "error" ? <><div className={styles.errorSymbol}>!</div><h2>这次生成没有完成</h2><p>示例错误：模型连接超时。已有资料保留，可以重新创建一个演示任务体验恢复流程。</p><button className={styles.primaryButton} onClick={restart}>重新体验生成流程</button><details><summary>查看错误详情</summary><p>连接等待超过设定时间。此记录用于展示红点与失败状态。</p></details></> : <><span className={styles.successSymbol}><Icon name="check" /></span><h2>正文已完成</h2><p>演示版本 · 雨后的码头</p><div className={styles.proseText}>码头上的雨水还没有干。林舟沿着生锈的栏杆往前走，船只的灯火在水里晃动。沈砚等在旧仓库旁，手里握着一把钥匙。<br /><br />“你父亲留下的东西，也许还在里面。”他说。<br /><br />林舟接过钥匙。那一刻，他还以为这是一个可以放心相信的人。</div><button className={styles.secondaryButton} onClick={() => openCurrent()}>继续旧档案室的任务</button></>}</div>}
        </main>
        {selectedTask === "current" && detailTab === "conversation" && <aside className={styles.briefInspector} aria-label="准备稿预览"><header><span><Icon name="document" />准备稿</span><button onClick={() => setDetailTab("preparation")}>展开</button></header><Preparation state={state} compact /></aside>}
      </div>}

      {view === "generate" && <main className={styles.pageScroll} aria-label="AI Generate 工作区"><div className={styles.generatePage}>
        <div className={styles.pageHeading}><span className={styles.eyebrow}>AI GENERATE</span><div className={styles.taskTitleLine}><h1>旧档案室</h1><StatusDot phase={state.phase} /></div><p>先讨论写作方向，再完成正文。</p></div>
        <section className={styles.generateForm}><div className={styles.sectionHeading}><h2>本次生成</h2><span>全新生成</span></div><label htmlFor="demo-outline">当前大纲</label><textarea id="demo-outline" rows={3} readOnly value="林舟进入旧档案室，发现父亲失踪记录中的异常。他开始怀疑沈砚隐瞒了一些事情，并与他展开一次克制的交锋。保留失踪真相，为下一段调查留下空间。" /><div className={styles.generateControls}><div><span>目标篇幅</span><strong>约 1,800 字</strong></div><div><span>正文表达</span><strong>对白克制 · 节奏适中</strong></div><div><span>互动上限</span><strong>{state.maxRounds} 轮</strong></div></div><div className={styles.generateSubmit}><span><Icon name="spark" />演示写作助手</span><button className={styles.primaryButton} onClick={() => { resetDemo(); setNotice("已开始新的演示准备阶段，问题显示在下方。"); }} disabled={["thinking", "writing"].includes(state.phase)}>重新开始演示</button></div></section>
        <section className={styles.inlineTask} aria-label="Generate 下方的同步互动"><header><div><span className={styles.eyebrow}>当前任务</span><h2>写作准备与讨论</h2></div><button className={styles.textButton} onClick={() => openCurrent()}>打开完整任务 <Icon name="chevron" /></button></header><div className={styles.inlineTaskMeta}><PhaseBadge state={state} /><span>{state.round} / {state.maxRounds} 轮 · 与 AI 任务同步</span></div><Conversation state={state} inline /><Composer state={state} inline onEdit={() => { openCurrent(); editPreparation(); }} onWrite={startWriting} /><details className={styles.inlinePreparation}><summary>查看最新准备稿 · v{state.round + 1}</summary><Preparation state={state} /></details></section>
      </div></main>}

      {view === "write" && <main className={styles.pageScroll} aria-label="正文工作区"><article className={styles.documentPage}><div className={styles.documentMeta}><span>第三章 · 潮水之间</span><span>{state.phase === "completed" ? "演示正文" : "写作中"}</span></div><div className={styles.documentTitle}><h1>旧档案室</h1><button aria-label="打开此正文的 AI 任务" onClick={() => openCurrent()}><StatusDot phase={state.phase} /></button></div>{state.phase === "completed" ? <><p className={styles.demoProseNote}>示例正文 · 根据选项模拟生成</p><div className={styles.proseText}>{demoProse(state)}</div></> : <><p className={styles.proseText}>雨在傍晚停了。林舟推开档案室的门，潮气仍贴在墙上。</p><div className={styles.documentCallout}><StatusDot phase={state.phase} /><div><strong>{phaseLabels[state.phase]}</strong><p>准备稿和待决定项已保存在任务中。</p></div><button className={styles.secondaryButton} onClick={() => openCurrent()}>继续讨论</button></div></>}<div className={styles.documentEnd}>◇</div></article></main>}

      {view === "settings" && <main className={styles.pageScroll} aria-label="全局 AI 任务设置"><div className={styles.settingsPage}><button className={styles.backLink} onClick={() => openCurrent()}><Icon name="back" />返回 AI 任务</button><div className={styles.pageHeading}><span className={styles.eyebrow}>GLOBAL SETTINGS</span><h1>AI 任务设置</h1><p>控制写作准备阶段与作者讨论的次数。</p></div><section className={styles.settingsCard}><div><Icon name="tasks" /><h2>写作前互动</h2></div><label htmlFor="demo-round-limit">最多互动轮次</label><div className={styles.roundControl}><input id="demo-round-limit" type="number" min={0} max={5} value={state.configuredRounds} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value <= 5) updateDemo((current) => ({ ...current, configuredRounds: value })); }} /><span>轮</span></div><p>作者回答后，AI 完善一次准备稿，计为一轮。首次准备稿不计入次数；0 轮表示直接准备并等待确认。</p><div className={styles.settingsNote}><Icon name="check" /><span>设置已保存，下一次新建任务生效。当前任务仍按 {state.maxRounds} 轮上限执行。</span></div><button className={styles.primaryButton} onClick={restart}>按新设置重新体验</button></section><section className={styles.settingsExplainer}><h2>任务如何继续</h2><ol><li>整理初版准备稿，提出待决定项。</li><li>等待作者回答，期间释放生成名额。</li><li>完善准备稿，直到达到轮次上限或作者提前结束。</li><li>作者确认准备稿后，生成正文。</li></ol></section></div></main>}
      <footer className={styles.statusbar} role="status"><span>{demoStorageError() || notice || "独立演示数据 · 回答与准备稿自动保存"}</span><span>模拟 AI 流程</span></footer>
    </div>
  </div>;
}
