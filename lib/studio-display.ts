import type { ChatSession } from "@/lib/studio-types";

export function chatSessionHasUnread(session: ChatSession) {
  const latestAssistantId = session.messages.filter((message) => message.role === "assistant").at(-1)?.id;
  return Boolean(latestAssistantId && latestAssistantId !== session.lastReadMessageId);
}

export function wordCount(text: string) {
  const chinese = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
  return chinese + latin;
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
