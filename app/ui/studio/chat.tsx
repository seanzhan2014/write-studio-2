"use client";
import { configuredModelFilter } from "@/app/ui/model-options";
import { requestConfirmDialog, requestTextDialog } from "@/app/ui/operation-dialogs";

import { TaskParameterSettings } from "@/app/ui/task-parameter-settings";
import { createPortal } from "react-dom";
import { Popover, Select } from "@mantine/core";
import { CHAT_MODES, normalizeChatMode } from "@/lib/chat-modes";
import { taskReasoningEffort, type TaskParameters } from "@/lib/task-parameters";
import { resolveAiSettings } from "@/lib/ai-settings-inheritance";

import { sendChatCompletion } from "@/lib/chat-client";
import { useEffect, useRef, useState } from "react";

import { useMediaQuery } from "@mantine/hooks";

import { selectAiContext, summarizeAiContext } from "@/lib/ai-context";

import { timestampContentName } from "@/lib/content-name.mjs";

import { resolvedOutlineContent } from "@/lib/outline-content";
import { outlineDisplayTitle } from "@/lib/outline-title";
import { modelSelectionLabel } from "@/lib/model-label";

import { browserIsOffline, fetchFromServer, fetchServerAction, readServerJson, OFFLINE_OPERATION_MESSAGE } from "@/lib/browser-network";
import { chatSessionHasUnread, formatTime, useStudio, type AiTask, type Message } from "@/app/studio-state";

import { ResponsiveModal } from "@/app/ui/overlays";

import { type ConfiguredModel, type ChatStreamState, type ChatResponseStage } from "@/app/ui/studio/types";

import { configuredModelForReference, chatbotDisplayName, activeChatSession, updateScopedTaskParameters, useDismissOnOutside, activeChatStreams, releaseActiveChatStream, cancelActiveChatStream, clientId, registerActiveChatStream, copyTextToClipboard, Icon, IconButton, modelDisplayLabel, useConfiguredModels } from "@/app/ui/studio/shared";

export function chatInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}

export function ChatMessageContent({ text }: { text: string }) {
  return <div className="message-content">{text.split("\n").map((line, index) => {
    if (!line.trim()) return <span className="message-break" key={index} />;
    if (/^#{1,3}\s/.test(line)) return <h4 key={index}>{chatInline(line.replace(/^#{1,3}\s/, ""))}</h4>;
    if (/^>\s?/.test(line)) return <blockquote key={index}>{chatInline(line.replace(/^>\s?/, ""))}</blockquote>;
    if (/^(?:[-*]|\d+\.)\s/.test(line)) return <div className="message-list-row" key={index}><span>•</span><p>{chatInline(line.replace(/^(?:[-*]|\d+\.)\s/, ""))}</p></div>;
    return <p key={index}>{chatInline(line)}</p>;
  })}</div>;
}

export function ChatView({ models, outlineId, outlineTitle, onUseAsGenerate, onNotice, sessionId, onSessionChange, contextContent, contextLabel, headerHost, visible = true, copyOnly = false }: { headerHost?: HTMLElement | null; models: ConfiguredModel[]; outlineId?: string; outlineTitle: string; onUseAsGenerate: (text: string) => void; onNotice: (message: string) => void; sessionId?: string; onSessionChange?: (id: string) => void; contextContent?: string; contextLabel?: string; visible?: boolean; copyOnly?: boolean }) {
  const [selectedMessageId,setSelectedMessageId]=useState("");
  const [settingsOpen,setSettingsOpen]=useState(false);
  const studio = useStudio();
  const outline = studio.currentArticle.chapters.flatMap((chapter) => chapter.outlines).find((item) => item.id === outlineId) ?? studio.currentOutline;
  const inheritedChatOptions = resolveAiSettings(studio.currentArticle, outline.id, "generate", "outline", studio.data.settings).value;
  const [localChatOptions, setLocalChatOptions] = useState(inheritedChatOptions);
  const chatOptions = onSessionChange ? localChatOptions : inheritedChatOptions;
  const chatParameters = chatOptions.tasks!;
  const chatModelRecord = configuredModelForReference(models, String(chatParameters.chatModel));
  const chatModelReference = chatModelRecord?.id ?? String(chatParameters.chatModel).trim();
  const chatbotName = chatbotDisplayName(models, chatModelReference);
  const session = outline.chat.sessions.find(item => item.id === sessionId) ?? activeChatSession(outline);
  const chatMode = normalizeChatMode(session?.mode);
  const selectSession = (id: string) => onSessionChange ? onSessionChange(id) : studio.setActiveChatSession(outline.id, id);
  const setDraft = (text: string) => studio.setChatDraft(outline.id, text, session?.id);
  const contextArticle = contextContent === undefined ? studio.currentArticle : {
    ...studio.currentArticle,
    chapters: studio.currentArticle.chapters.map(chapter => ({ ...chapter, outlines: chapter.outlines.map(item => item.id === outline.id ? { ...item, content: contextContent, currentVersionId: null } : item) })),
  };
  const message = session?.draft ?? "";
  const chatContextSetting = (key: "chatIncludePrevious" | "chatIncludeCharacters", fallback: boolean) => {
    if (onSessionChange) return fallback;
    const field = `tasks.${key}`;
    const hasChoice = (value: typeof outline.generateOptions | undefined) => value?.tasks?.[key] !== undefined && value.inheritance?.[field] !== "parent";
    const chapterIndex = studio.currentArticle.chapters.findIndex(chapter => chapter.outlines.some(item => item.id === outline.id));
    const scopedChoice = studio.currentArticle.chapters.slice(0, chapterIndex + 1).some(chapter => !chapter.archived && hasChoice(chapter.settings?.aiTasks?.generate));
    const mode = chatOptions.inheritance?.[field];
    return hasChoice(outline.generateOptions) || hasChoice(studio.currentArticle.aiGenerateSettings) || scopedChoice || (mode && mode !== "parent") ? chatParameters[key] === true : fallback;
  };
  const chatIncludePrevious = chatContextSetting("chatIncludePrevious", session?.includePrevious ?? true);
  const chatIncludeCharacters = chatContextSetting("chatIncludeCharacters", session?.includeCharacters ?? true);
  const editChatParameter = (patch: TaskParameters) => { if (onSessionChange) setLocalChatOptions(current => ({ ...current, tasks: { ...current.tasks!, ...patch } })); else updateScopedTaskParameters(studio, "outline", outline.id, patch); };
  const activeChatTask = studio.data.tasks.find((task) => task.target === "AI Chat" && task.outlineId === outline.id && (task.state === "waiting" || task.state === "running"));
  const sessionChatTask = activeChatTask?.contextOptions?.sessionId === session?.id ? activeChatTask : undefined;
  const isStreaming = Boolean(activeChatTask);
  const [localStreaming, setLocalStreaming] = useState<{ taskId: string; text: string } | null>(null);
  const streaming = localStreaming && localStreaming.taskId === sessionChatTask?.id ? localStreaming.text : sessionChatTask?.resultText ?? "";
  const [contextOpen, setContextOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  useDismissOnOutside(sessionsOpen || sessionMenuOpen, () => { setSessionsOpen(false); setSessionMenuOpen(false); }, ".chat-session-switcher, .chat-session-actions, .chat-session-popover, .chat-session-menu");
  useDismissOnOutside(toolsOpen || contextOpen, () => { setToolsOpen(false); setContextOpen(false); }, ".composer-context-chip, .composer-icon-button, .chat-tools-popover, .chat-context-panel");
  const [messageMenuId, setMessageMenuId] = useState("");
  useDismissOnOutside(Boolean(messageMenuId), () => setMessageMenuId(""), ".message-action-trigger, .message-action-menu");
  const [editingMessage, setEditingMessage] = useState<{ sessionId: string; messageId: string; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatThreadRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const currentStream = useRef<ChatStreamState | null>(null);
  const submissionLock = useRef("");
  const [submittingTaskId, setSubmittingTaskId] = useState("");
  const [chatResponseStage, setChatResponseStage] = useState<ChatResponseStage | null>(null);
  const isSubmitting = Boolean(submittingTaskId);
  const chatBusy = isStreaming || isSubmitting;
  const currentResponseStage = chatResponseStage && chatResponseStage.taskId === sessionChatTask?.id ? chatResponseStage.stage : null;
  const restoringChat = Boolean(activeChatTask && !currentResponseStage && !activeChatStreams.has(activeChatTask.id));
  const waitingForFirstToken = currentResponseStage === "waiting-first-token" || sessionChatTask?.phase === "generating";
  const chatProgressLabel = isSubmitting
    ? "正在提交"
    : sessionChatTask?.phase === "saving"
      ? "正在保存回复"
      : currentResponseStage === "recovering" || restoringChat && !sessionChatTask?.contextOptions?.serverManaged
        ? "正在核对任务状态"
        : streaming
      ? "正在回复"
      : waitingForFirstToken
        ? "等待首字"
        : activeChatTask ? "正在请求模型" : "正在回复";
  const chatProgressText = streaming || (currentResponseStage === "recovering" || restoringChat && !sessionChatTask?.contextOptions?.serverManaged ? "正在恢复聊天状态，请稍候…" : isSubmitting
    ? "正在保存消息并创建任务…"
    : waitingForFirstToken
      ? "模型已响应，正在等待首字…"
      : activeChatTask ? "正在向模型发送请求…" : "正在思考…");
  let chatContext: ReturnType<typeof selectAiContext> | undefined;
  try {
    chatContext = selectAiContext({ articles: [contextArticle] }, outline.id, "chat", { includePrevious: chatIncludePrevious, includeCharacters: chatIncludeCharacters, sessionId: session?.id });
  } catch { /* The active UI never intentionally opens an archived target. */ }
  const previous = chatContext?.previousOutlines ?? [];
  const matchedCharacters = chatContext?.characters ?? [];
  const contextCharacters = chatContext ? summarizeAiContext(chatContext, message).total : 0;
  const quickPrompts = chatMode === "outline" ? ["整理当前情节概要", "检查事件因果", "完善人物动机", "规划后续大纲"] : chatMode === "writing" ? ["按当前大纲创作正文", "续写当前正文", "润色当前正文", "检查叙事节奏"] : ["分析当前冲突", "检查人物动机", "寻找逻辑漏洞", "建议下一步"];

  function resizeComposer(target = composerRef.current) {
    if (!target) return;
    target.style.height = "auto";
    target.style.height = `${Math.min(156, Math.max(30, target.scrollHeight))}px`;
  }

  useEffect(() => { resizeComposer(); }, [message]);
  useEffect(() => {
    const thread = chatThreadRef.current;
    if (!thread) return;
    let followingLatest = true;
    let width = thread.clientWidth;
    let height = thread.clientHeight;
    const trackPosition = () => {
      // A layout change must not be mistaken for scrolling back in history.
      if (width !== thread.clientWidth || height !== thread.clientHeight) return;
      followingLatest = thread.scrollHeight - thread.clientHeight - thread.scrollTop < 48;
    };
    const observer = new ResizeObserver(() => {
      width = thread.clientWidth;
      height = thread.clientHeight;
      if (followingLatest) thread.scrollTop = thread.scrollHeight;
    });
    observer.observe(thread);
    thread.addEventListener("scroll", trackPosition, { passive: true });
    return () => { observer.disconnect(); thread.removeEventListener("scroll", trackPosition); };
  }, [session?.id]);
  useEffect(() => {
    const thread = chatThreadRef.current;
    if (!thread) return;
    const frame = window.requestAnimationFrame(() => {
      thread.scrollTop = thread.scrollHeight;
      threadEndRef.current?.scrollIntoView({ block: "end", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [session?.id, session?.messages.length, streaming]);
  useEffect(() => {
    if (visible && session && chatSessionHasUnread(session)) studio.markChatSessionRead(outline.id, session.id);
  }, [outline.id, session, studio, visible]);

  function applyChatTransaction(payload: { revision: number; task: AiTask | Partial<AiTask>; messages?: Message[]; message?: Message; sessionTitle?: string; sessionUpdatedAt?: string }, taskId: string, sessionId: string) {
    studio.acceptServerMutation(payload.revision, (current) => ({
      ...current,
      articles: current.articles.map((article) => ({
        ...article,
        chapters: article.chapters.map((chapter) => ({
          ...chapter,
          outlines: chapter.outlines.map((item) => item.id !== outline.id ? item : ({
            ...item,
            chat: {
              ...item.chat,
              sessions: item.chat.sessions.map((candidate) => candidate.id !== sessionId ? candidate : ({
                ...candidate,
                title: payload.sessionTitle ?? candidate.title,
                draft: "",
                updatedAt: payload.sessionUpdatedAt ?? candidate.updatedAt,
                messages: payload.messages ?? (payload.message && !candidate.messages.some((entry) => entry.id === payload.message!.id) ? [...candidate.messages, payload.message] : candidate.messages),
              })),
            },
          })),
        })),
      })),
      tasks: current.tasks.some((item) => item.id === taskId)
        ? current.tasks.map((item) => item.id === taskId ? { ...item, ...payload.task } as AiTask : item)
        : [payload.task as AiTask, ...current.tasks].slice(0, 20),
    }));
  }

  async function finalizeChat(stream: ChatStreamState, status: "success" | "failed" | "cancelled", error = "", stopped = false) {
    const response = await sendChatCompletion(`/api/outlines/${encodeURIComponent(outline.id)}/chat/transactions`, {
      action: "finalize", taskId: stream.taskId, sessionId: stream.sessionId, status, result: stream.result, error, stopped, chatbotName,
    });
    const payload = await readServerJson<{ revision?: number; task?: Partial<AiTask>; message?: Message; sessionUpdatedAt?: string; error?: string }>(response, "聊天结果保存失败");
    if (!response.ok || payload.revision === undefined || !payload.task) throw new Error(payload.error || "聊天结果保存失败");
    applyChatTransaction({ revision: payload.revision, task: payload.task, message: payload.message, sessionUpdatedAt: payload.sessionUpdatedAt }, stream.taskId, stream.sessionId);
    setLocalStreaming((current) => current?.taskId === stream.taskId ? null : current);
    setChatResponseStage((current) => payload.task?.state === "running" ? { taskId: stream.taskId, stage: "recovering" } : current?.taskId === stream.taskId ? null : current);
  }

  function stopStream(stream: ChatStreamState, stopped = true) {
    if (stream.finalized) return;
    stream.finalized = true;
    stream.controller.abort();
    releaseActiveChatStream(stream.taskId, stream.controller);
    if (currentStream.current === stream) currentStream.current = null;
    setChatResponseStage((current) => current?.taskId === stream.taskId ? null : current);
    if (submissionLock.current === stream.submissionToken) {
      submissionLock.current = "";
      setSubmittingTaskId("");
    }
    void finalizeChat(stream, "cancelled", stopped ? "用户停止了聊天回复" : "", stopped).catch((reason) => onNotice(`停止请求尚未确认，联网后会自动重试：${reason instanceof Error ? reason.message : "连接失败"}`));
  }
  function cancelCurrentChatTask() {
    if (!activeChatTask || cancelActiveChatStream(activeChatTask.id)) return;
    const stream: ChatStreamState = { taskId: activeChatTask.id, sessionId: activeChatTask.contextOptions?.sessionId ?? session?.id ?? "", submissionToken: "", controller: new AbortController(), result: activeChatTask.resultText ?? "", finalized: true };
    void finalizeChat(stream, "cancelled", "用户停止了聊天回复", true).catch((reason) => onNotice(`停止请求尚未确认，联网后会自动重试：${reason instanceof Error ? reason.message : "连接失败"}`));
  }

  async function requestAnswer(question: string, addUser: boolean, targetSessionId = session?.id, targetSession = session) {
    if (!targetSessionId || !targetSession || isStreaming || submissionLock.current || currentStream.current) return;
    if (browserIsOffline()) { onNotice(OFFLINE_OPERATION_MESSAGE); return; }
    const submissionToken = clientId("chat-submit");
    submissionLock.current = submissionToken;
    setSubmittingTaskId("pending");
    const releaseSubmission = () => {
      if (submissionLock.current !== submissionToken) return;
      submissionLock.current = "";
      setSubmittingTaskId("");
    };
    try {
      const taskId = clientId("task");
      setSubmittingTaskId(taskId);
      const userMessage: Message = { id: clientId("message-user"), role: "user", text: question, createdAt: new Date().toISOString() };
      const submittedMessages = addUser ? [...targetSession.messages, userMessage] : targetSession.messages;
      const submittedTitle = addUser && targetSession.title === "新对话" ? question.slice(0, 24) : targetSession.title;
      let promptContext = selectAiContext({ articles: [contextArticle] }, outline.id, "chat", { includePrevious: chatContextSetting("chatIncludePrevious", targetSession.includePrevious), includeCharacters: chatContextSetting("chatIncludeCharacters", targetSession.includeCharacters), sessionId: targetSessionId });
      promptContext = { ...promptContext, recentMessages: submittedMessages.slice(-20).map((item) => ({ role: item.role, text: item.text })) };
      const submitResponse = await fetchServerAction(`/api/outlines/${encodeURIComponent(outline.id)}/chat/transactions`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": taskId },
        body: JSON.stringify({ action: "submit", taskId, sessionId: targetSessionId, mode: normalizeChatMode(targetSession.mode), sessionTitle: submittedTitle, message: question, messages: submittedMessages, model: chatModelReference, reasoningEffort: taskReasoningEffort(chatParameters.chatReasoningEffort), includePrevious: chatContextSetting("chatIncludePrevious", targetSession.includePrevious), includeCharacters: chatContextSetting("chatIncludeCharacters", targetSession.includeCharacters), estimatedCharacters: summarizeAiContext(promptContext, question).total, timeoutMs: chatModelRecord?.timeoutMs ?? 600_000, promptContext }),
      });
      const submitted = await submitResponse.json() as { revision?: number; task?: AiTask; messages?: Message[]; sessionTitle?: string; sessionUpdatedAt?: string; error?: string };
      if (!submitResponse.ok || submitted.revision === undefined || !submitted.task || !submitted.messages) throw new Error(submitted.error || "消息提交失败");
      applyChatTransaction({ revision: submitted.revision, task: submitted.task, messages: submitted.messages, sessionTitle: submitted.sessionTitle, sessionUpdatedAt: submitted.sessionUpdatedAt }, taskId, targetSessionId);
      releaseSubmission();
      const controller = new AbortController();
      const responseDeadline = window.setTimeout(() => controller.abort("response-timeout"), Math.max(1_000, (submitted.task.timeoutMs ?? 600_000) + 15_000));
      const stream: ChatStreamState = { taskId, sessionId: targetSessionId, submissionToken, controller, result: "", finalized: false };
      currentStream.current = stream;
      registerActiveChatStream(taskId, { controller, cancel: () => stopStream(stream, true) });
      setChatResponseStage({ taskId, stage: "requesting-model" });
      try {
        if (controller.signal.aborted) return;
        const response = await fetchFromServer(`/api/outlines/${encodeURIComponent(outline.id)}/chat/stream`, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json", "Idempotency-Key": taskId }, body: JSON.stringify({ requestId: taskId, message: question, sessionId: targetSessionId, mode: normalizeChatMode(targetSession.mode), model: chatModelReference, reasoningEffort: taskReasoningEffort(chatParameters.chatReasoningEffort), includePrevious: chatContextSetting("chatIncludePrevious", targetSession.includePrevious), includeCharacters: chatContextSetting("chatIncludeCharacters", targetSession.includeCharacters), context: promptContext }) });
        if (!response.ok || !response.body) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error || `${chatbotName} 失败（${response.status}）`); }
        setChatResponseStage({ taskId, stage: "waiting-first-token" });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            stream.result += decoder.decode();
            break;
          }
          const decoded = decoder.decode(value, { stream: true });
          // The local stream uses a record separator so the UI can finish even when
          // a development proxy delays the response close or strips custom headers.
          const terminatorIndex = decoded.indexOf("\u001e");
          stream.result += terminatorIndex >= 0 ? decoded.slice(0, terminatorIndex) : decoded;
          if (stream.result) setChatResponseStage((current) => current?.taskId === taskId ? null : current);
          setLocalStreaming({ taskId, text: stream.result });
          if (terminatorIndex >= 0) {
            void reader.cancel();
            break;
          }
        }
        if (controller.signal.aborted) return;
        if (!stream.result) throw new Error(`${chatbotName} 返回了空结果`);
        stream.finalized = true;
        await finalizeChat(stream, "success");
      } catch (error) {
        if (!controller.signal.aborted || controller.signal.reason === "response-timeout") {
          stream.finalized = true;
          const errorMessage = controller.signal.reason === "response-timeout" ? "等待聊天响应超时，正在核对服务端结果" : error instanceof Error ? error.message : "请求失败";
          await finalizeChat(stream, "failed", errorMessage);
        }
      } finally {
        window.clearTimeout(responseDeadline);
        releaseActiveChatStream(taskId, controller);
        if (currentStream.current === stream) currentStream.current = null;
        setChatResponseStage((current) => current?.taskId === taskId && current.stage !== "recovering" ? null : current);
        stream.finalized = true;
      }
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : "聊天结果尚未确认，联网后会自动核对");
      void studio.refreshFromServer();
    } finally {
      releaseSubmission();
    }
  }

  async function send() {
    const question = message.trim();
    if (!question || chatBusy || editingMessage) return;
    await requestAnswer(question, true);
  }

  async function submitEditedMessage() {
    if (!editingMessage || chatBusy) return;
    const sourceSession = outline.chat.sessions.find((item) => item.id === editingMessage.sessionId);
    const messageIndex = sourceSession?.messages.findIndex((item) => item.id === editingMessage.messageId) ?? -1;
    const originalMessage = messageIndex >= 0 ? sourceSession?.messages[messageIndex] : undefined;
    const editedText = editingMessage.text.trim();
    if (!sourceSession || !originalMessage || originalMessage.role !== "user" || !editedText) return;
    const messages = [...sourceSession.messages.slice(0, messageIndex), { ...originalMessage, text: editedText }];
    studio.replaceChatMessages(outline.id, messages, sourceSession.id);
    setEditingMessage(null);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    await requestAnswer(editedText, false, sourceSession.id, { ...sourceSession, messages });
  }

  function cancelEditingMessage() {
    setEditingMessage(null);
  }

  async function copyMessage(id: string, text: string) {
    const copied = await copyTextToClipboard(text);
    if (copied) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(""), 1000);
    }
  }

  function branchFrom(messageId: string) {
    cancelEditingMessage();
    const id = studio.branchChatSession(outline.id, messageId, session?.id);
    if (id) {
      selectSession(id);
      setMessageMenuId("");
      onNotice("已从此消息创建新会话");
    }
  }

  function saveCandidate(text: string) {
    studio.saveVersion(outline.id, timestampContentName(), "AI Chat", text, { model: chatModelRecord ? modelSelectionLabel(chatModelRecord) : chatModelReference, modelId: chatModelRecord?.modelId, prompt: session?.title, manualExcellent: false });
    setMessageMenuId("");
    onNotice("已保存为候选版本");
  }

  async function appendToBody(text: string) {
    if (!(await requestConfirmDialog("把这条 AI 回复追加到当前正文？"))) return;
    const currentContent = resolvedOutlineContent(outline);
    const nextContent = `${currentContent.trim()}${currentContent.trim() ? "\n\n" : ""}${text.trim()}`;
    if (!await studio.commitContentEdit(outline.id, nextContent)) return;
    setMessageMenuId("");
    onNotice("已追加并设为当前正文");
  }

  async function attachTextFile(file: File | undefined) {
    if (!file) return;
    const content = (await file.text()).slice(0, 12000);
    setDraft(`${message}${message.trim() ? "\n\n" : ""}[参考文件：${file.name}]\n${content}`.slice(0, 20000));
    setToolsOpen(false);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  if (!session) return null;

  const chatHeader = (<header className="chat-header">
        <button className="chat-session-switcher" type="button" aria-label={"聊天会话 · "+session.title+" · "+outlineTitle} title={outlineTitle} aria-haspopup="dialog" aria-expanded={sessionsOpen} onClick={() => { setSessionsOpen((value) => !value); setSessionMenuOpen(false); }}>
          <span className="chat-header-icon"><Icon name="chat" /></span><span><span className="ui-title">{session.title}</span><small>{session.messages.length} 条消息</small></span><Icon name="chevron" />
        </button>
<label className="chat-mode-switch"><select aria-label="聊天模式" value={chatMode} disabled={chatBusy || Boolean(editingMessage)} onChange={event=>studio.setChatSetting(outline.id,"mode",normalizeChatMode(event.target.value),session.id)}>{CHAT_MODES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <div className="chat-header-actions">
          <IconButton name="plus" label="新建聊天会话" className="chat-new-session" disabled={chatBusy} onClick={() => { if (!chatBusy) { cancelEditingMessage(); selectSession(studio.createChatSession(outline.id)); setSessionsOpen(false); composerRef.current?.focus(); } }} />
          <IconButton name="more" label="会话操作" aria-haspopup="menu" aria-expanded={sessionMenuOpen} onClick={() => { setSessionMenuOpen((value) => !value); setSessionsOpen(false); }} />
        </div>
        {sessionsOpen && <div className="chat-session-popover" role="dialog" aria-label="聊天会话"><div className="chat-session-popover-head"><span className="ui-title">聊天会话</span><button type="button" disabled={chatBusy} onClick={()=>{cancelEditingMessage();selectSession(studio.createChatSession(outline.id));setSessionsOpen(false);}}>新建会话</button><button type="button" onClick={()=>{setSessionsOpen(false);setSessionMenuOpen(true);}}>会话操作</button></div><label className="chat-popover-mode">模式<select aria-label="会话中的聊天模式" value={chatMode} disabled={chatBusy || Boolean(editingMessage)} onChange={event=>studio.setChatSetting(outline.id,"mode",normalizeChatMode(event.target.value),session.id)}>{CHAT_MODES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{outline.chat.sessions.map((item) => <button className={item.id === session.id ? "active" : ""} type="button" key={item.id} disabled={chatBusy} onClick={() => { cancelEditingMessage(); selectSession(item.id); setSessionsOpen(false); }}><span><span className="ui-title">{item.title}</span><small>{item.messages.length} 条 · {formatTime(item.updatedAt)}</small></span>{item.id === session.id && <Icon name="check" />}</button>)}</div>}
        {sessionMenuOpen && <div className="chat-session-menu" role="menu"><button role="menuitem" type="button" onClick={async () => { const title = (await requestTextDialog("会话名称", session.title)); if (title?.trim()) studio.renameChatSession(outline.id, session.id, title); setSessionMenuOpen(false); }}><Icon name="edit" />重命名</button><button role="menuitem" type="button" onClick={async () => { if ((await requestConfirmDialog("清空当前会话的全部消息？"))) studio.clearChat(outline.id, session.id); setSessionMenuOpen(false); }}><Icon name="refresh" />清空消息</button><button role="menuitem" className="danger" type="button" onClick={async () => { if ((await requestConfirmDialog("删除当前会话？"))) studio.deleteChatSession(outline.id, session.id); setSessionMenuOpen(false); }}><Icon name="trash" />删除会话</button></div>}
      </header>);
  return (
    <div className="chat-view">
      {headerHost ? createPortal(chatHeader,headerHost) : chatHeader}

      <div className="chat-thread" ref={chatThreadRef}>
        {!session.messages.length && !chatBusy && <div className="chat-empty"><span><Icon name="spark" /></span><h2>开始聊天</h2><div>{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => { setDraft(prompt); composerRef.current?.focus(); }}>{prompt}</button>)}</div></div>}
        {session.messages.map((item, index) => {
          const isError = item.role === "assistant" && item.text.includes("错误：");
          const previousUser = item.role === "assistant" ? [...session.messages.slice(0, index)].reverse().find((candidate) => candidate.role === "user") : null;
          return <article className={`message ${item.role} ${isError ? "error" : ""} ${editingMessage?.sessionId === session.id && editingMessage.messageId === item.id ? "editing" : ""}`} key={item.id} tabIndex={0} data-selected={selectedMessageId===item.id||undefined} onClick={()=>setSelectedMessageId(item.id)} onFocus={()=>setSelectedMessageId(item.id)} onKeyDown={event=>{if(event.key==="Escape")setSelectedMessageId("");}}>
            {item.role === "assistant" && <div className="avatar"><Icon name="spark" /></div>}
            <div className="message-body"><div className="message-meta"><span className="ui-label">{item.role === "user" ? "你" : chatbotName}</span>{item.stopped && <span>已停止</span>}</div>
              {editingMessage?.sessionId === session.id && editingMessage.messageId === item.id ? <form className="inline-message-editor" onSubmit={(event) => { event.preventDefault(); void submitEditedMessage(); }}>
                <textarea autoFocus maxLength={20000} value={editingMessage.text} aria-label="编辑聊天消息" onChange={(event) => setEditingMessage({ ...editingMessage, text: event.currentTarget.value })} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelEditingMessage(); } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submitEditedMessage(); } }} />
                <div><span>Ctrl/⌘ + Enter 发送</span><button type="button" onClick={cancelEditingMessage}>取消</button><button className="primary" type="submit" disabled={!editingMessage.text.trim()}>发送</button></div>
              </form> : <><ChatMessageContent text={item.text} /><div className="message-actions">
                <IconButton name={copiedId === item.id ? "check" : "copy"} label="复制消息" title="复制" size="small" onClick={() => void copyMessage(item.id, item.text)} />
                {item.role === "user" && <IconButton name="edit" label="编辑并重发" size="small" disabled={chatBusy || Boolean(editingMessage)} onClick={() => setEditingMessage({ sessionId: session.id, messageId: item.id, text: item.text })} />}
                {item.role === "assistant" && previousUser && <IconButton name="refresh" label="重新生成" size="small" disabled={chatBusy || Boolean(editingMessage)} onClick={() => { studio.replaceChatMessages(outline.id, session.messages.slice(0, index), session.id); void requestAnswer(previousUser.text, false); }} />}
                <IconButton name="branch" label="从这里分支" size="small" onClick={() => branchFrom(item.id)} />
                {item.role === "assistant" && !copyOnly && <IconButton name="more" label="更多写作操作" title="更多" size="small" className="message-action-trigger" aria-haspopup="menu" aria-expanded={messageMenuId === item.id} onClick={() => setMessageMenuId((value) => value === item.id ? "" : item.id)} />}
              </div>
              {messageMenuId === item.id && <div className="message-action-menu"><button type="button" onClick={() => saveCandidate(item.text)}><Icon name="versions" />保存为候选版本</button><button type="button" onClick={() => void appendToBody(item.text)}><Icon name="insert" />追加到正文</button><button type="button" onClick={() => { setMessageMenuId(""); onUseAsGenerate(item.text); }}><Icon name="spark" />交给 生成</button></div>}</>}
            </div>
          </article>;
        })}
        {chatBusy && <article className="message assistant streaming" aria-live="polite"><div className="avatar"><Icon name="spark" /></div><div className="message-body"><div className="message-meta"><span className="ui-label">{chatbotName}</span><span>{chatProgressLabel}</span></div><ChatMessageContent text={chatProgressText} /><button className="inline-stop" type="button" onClick={cancelCurrentChatTask}><Icon name="stop" />停止</button></div></article>}
        <div ref={threadEndRef} />
      </div>

      <div className="chat-composer-wrap">
        {contextLabel && <div className="pane-context-source" role="status">引用正文 · {contextLabel}</div>}
        {contextOpen && <div className="chat-context-panel" role="dialog" aria-label="聊天上下文"><header><div><span className="ui-title">本次上下文</span><span>{contextCharacters.toLocaleString("zh-CN")} 字符</span></div><IconButton name="close" label="关闭上下文" onClick={() => setContextOpen(false)} /></header><div className="chat-context-fixed"><p><Icon name="check" /><span>文章信息</span><small>{studio.currentArticle.title}</small></p><p><Icon name="check" /><span>当前章节</span><small>{studio.currentChapter.title}</small></p><p><Icon name="check" /><span>当前大纲与正文</span><small>{contextLabel ?? outlineTitle}</small></p><p><Icon name="check" /><span>最近消息</span><small>{Math.min(20, session.messages.length)} 条</small></p></div><label><input type="checkbox" checked={chatIncludePrevious} onChange={(event) => { studio.setChatSetting(outline.id, "includePrevious", event.target.checked, session.id); editChatParameter({ chatIncludePrevious: event.target.checked }); }} /><span>前面全部大纲</span><small>{previous.length} 条</small></label>{chatIncludePrevious && previous.length > 0 && <div className="chat-context-sources">{previous.map((item) => <span key={item.id}>{outlineDisplayTitle(item)}</span>)}</div>}<label><input type="checkbox" checked={chatIncludeCharacters} onChange={(event) => { studio.setChatSetting(outline.id, "includeCharacters", event.target.checked, session.id); editChatParameter({ chatIncludeCharacters: event.target.checked }); }} /><span>相关人物</span><small>{matchedCharacters.length} 位</small></label>{chatIncludeCharacters && matchedCharacters.length > 0 && <div className="chat-context-sources">{matchedCharacters.map((item) => <span key={item.id}>{item.name}</span>)}</div>}</div>}
        <div className="chat-composer">
          <textarea ref={composerRef} rows={1} maxLength={20000} value={message} disabled={Boolean(editingMessage)} onChange={(event) => { setDraft(event.target.value); resizeComposer(event.currentTarget); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }} placeholder={editingMessage ? "正在编辑上方消息" : "输入消息"} aria-label="聊天消息" />
          <div className="composer-actions"><div className="composer-left-actions"><IconButton name="plus" label="添加参考或快捷指令" title="添加" className="composer-icon-button" aria-haspopup="menu" aria-expanded={toolsOpen} disabled={Boolean(editingMessage)} onClick={() => { setToolsOpen((value) => !value); setContextOpen(false); }} /><button className={`composer-context-chip ${contextOpen ? "active" : ""}`} type="button" disabled={Boolean(editingMessage)} aria-expanded={contextOpen} onClick={() => { setContextOpen((value) => !value); setToolsOpen(false); }}><Icon name="context" /><span>上下文 {contextCharacters.toLocaleString("zh-CN")}</span></button><div className="composer-model-chip"><Select filter={configuredModelFilter(models)} aria-label="聊天模型" searchable allowDeselect={false} nothingFoundMessage="没有匹配的模型" disabled={Boolean(editingMessage)} value={chatModelReference} data={[{value:"",label:"本地演示引擎"},...(chatModelReference&&!chatModelRecord?[{value:chatModelReference,label:chatModelReference+"（不可用）"}]:[]),...models.map(model=>({value:model.id,label:modelDisplayLabel(models,model.id)}))]} onChange={value=>{if(value!==null){editChatParameter({chatModel:value});void studio.saveNow();}}} /></div><Popover opened={settingsOpen} onChange={setSettingsOpen} position="top-end" withinPortal trapFocus returnFocus><Popover.Target><IconButton name="settings" label="聊天参数" disabled={chatBusy} onClick={()=>setSettingsOpen(open=>!open)} /></Popover.Target><Popover.Dropdown className="chat-parameter-popover"><TaskParameterSettings level="outline" targetId={outline.id} groups={["聊天"]} models={models} value={onSessionChange ? chatOptions : undefined} onChange={onSessionChange ? setLocalChatOptions : undefined} /></Popover.Dropdown></Popover></div>{chatBusy ? <button className="composer-send stop" type="button" onClick={cancelCurrentChatTask} aria-label="停止回复"><Icon name="stop" /></button> : <button className="composer-send" type="button" onClick={() => void send()} disabled={!message.trim() || Boolean(editingMessage) || chatBusy} aria-label="发送消息"><Icon name="send" /></button>}</div>
          {toolsOpen && <div className="chat-tools-popover"><div>{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => { setDraft(message ? `${message}\n${prompt}` : prompt); setToolsOpen(false); composerRef.current?.focus(); }}>{prompt}</button>)}</div><button type="button" onClick={() => fileRef.current?.click()}><Icon name="attachment" />添加文本参考</button></div>}
          <input className="chat-file-input" ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" onChange={(event) => { void attachTextFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        </div>
      </div>
    </div>
  );
}

export function FullOutlineChatDialog({ outlineId, onClose, onNotice }: { outlineId: string; onClose: () => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const outline = studio.currentArticle.chapters.flatMap((chapter) => chapter.outlines).find((item) => item.id === outlineId);
  if (!outline) return null;
  const displayTitle = outlineDisplayTitle(outline);
  return <ResponsiveModal
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭全文大纲 聊天" }}
    fullScreen={compact}
    size="xl"
    title={`聊天 · ${displayTitle}`}
    classNames={{ content: "ws-modal-content full-outline-chat-modal", header: "ws-modal-header", body: "full-outline-chat-body" }}
    overlayProps={{ backgroundOpacity: 0.46, blur: 3 }}
  >
    <ChatView
      key={outline.id}
      models={models}
      outlineId={outline.id}
      outlineTitle={displayTitle}
      onUseAsGenerate={() => onNotice("请在正文视图中继续使用 生成")}
      onNotice={onNotice}
    />
  </ResponsiveModal>;
}
