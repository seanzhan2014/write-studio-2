

import { type ReasoningOptions } from "@/lib/reasoning-options";

import { type SelectedAiContext } from "@/lib/ai-context";

import { suppliedPromptContext, selectPromptContext, composeSystemPrompt, CHAT_SYSTEM_PROMPT, chatPrompt } from "@/db/ai-prompts";

import { findModel } from "@/db/ai-models";

import { AiInputError } from "@/db/ai-errors";

import { upstream, sseToTextStream } from "@/db/ai-transport";
import { chatModeInstruction, normalizeChatMode, type ChatMode } from "@/lib/chat-modes";
import { readStudioState } from "@/db/studio-state";

export async function streamChat(input: { outlineId: string; message: string; model?: string; mode?: ChatMode; modePrompt?: string; includePrevious?: boolean; includeCharacters?: boolean; sessionId?: string; context?: SelectedAiContext } & ReasoningOptions, signal?: AbortSignal) {
  const source = suppliedPromptContext(input.context, input.outlineId, "chat")
    ?? await selectPromptContext(input.outlineId, "chat", input);
  const model = await findModel(input.model);
  if (input.model && !model) throw new AiInputError("所选聊天模型不存在，请重新选择");
  if (!model) {
    const answer = `我参考了当前大纲、${source.previousOutlines.length} 条相关前文结构${source.characters.length ? `，并匹配到人物 ${source.characters.map((item) => item.name).join("、")}` : ""}。当前段落已经承接已有线索，建议把角色此刻必须行动的原因再明确一拍：先确认一个无法回避的事实，再作出选择，让冲突自然升级。`;
    return plainTextStream(answer, signal);
  }
  const mode = normalizeChatMode(input.mode);
  const prompts = input.modePrompt === undefined ? (await readStudioState()).data?.settings.chatModePrompts : { [mode]: input.modePrompt };
  const system = composeSystemPrompt(`${CHAT_SYSTEM_PROMPT}\n${chatModeInstruction(mode, prompts)}`, model.systemPrompt);
  const prompt = chatPrompt(source, input.message, system, model.maxInputCharacters);
  const handle = await upstream(model, prompt.messages, signal, true, { max_tokens: undefined }, input.reasoningEffort);
  if (!handle.response.body) { handle.cleanup(); throw new Error("模型没有返回流"); }
  return sseToTextStream(handle.response.body, signal, handle.controller, handle.cleanup);
}

export function plainTextStream(text: string, signal?: AbortSignal) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let index = 0; index < text.length; index += 3) {
        if (signal?.aborted) break;
        controller.enqueue(encoder.encode(text.slice(index, index + 3)));
        await new Promise((resolve) => setTimeout(resolve, 18));
      }
      if (!signal?.aborted) controller.enqueue(encoder.encode("\u001e"));
      controller.close();
    },
  });
}
