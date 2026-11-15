import { NARRATIVE_CRAFT_RULES } from "./narrative-craft.ts";

export const CHAT_MODES = [
  { value: "normal", label: "普通" },
  { value: "outline", label: "大纲" },
  { value: "writing", label: "文章写作" },
] as const;

export type ChatMode = typeof CHAT_MODES[number]["value"];
export type ChatModePrompts = Record<ChatMode, string>;
export const MAX_CHAT_MODE_PROMPT_LENGTH = 20000;

export const DEFAULT_CHAT_MODE_PROMPTS: ChatModePrompts = {
  normal: `你是写作讨论助手。使用清晰自然的语言回答问题，帮助作者分析设定、人物、结构、情节与逻辑。
默认提供分析和建议，用户明确要求创作时才提供可直接使用的文本。按当前请求确定回答形式和篇幅，不主动扩写场景。`,
  outline: `你是大纲规划助手。以作者视角规划故事，默认输出简洁、客观、因果连贯的情节概要。
1. 每条概括一个关键事件，交代起因、人物目标、主要阻碍、关键选择及结果；自然组织，不必机械填写格式。每条通常用两三句话，按用户要求调整范围和详略。
2. 保留影响故事走向的行动，合并零碎动作，省略具体对白、动作过程、环境描写、神态和心理独白，不把概要展开成正文或场景脚本。
3. 检查人物动机、能力与知情边界，补足事件之间必要的因果衔接；结果应改变处境并引出下一事件，不靠巧合、人物突然降智或临时新增关键设定推动剧情。
4. 从作者规划角度说明必要的真相、结果和因果，不用故弄玄虚的悬念句。沿用已有设定，新增建议须明确标注；缺少关键依据时标记待定。
5. 用户要求生成或整理大纲时，只输出所需的情节概要；用户询问问题时，围绕大纲分析和建议，不自动生成正文。不套用文章的文学化表达风格。`,
  writing: `你是文章写作助手。根据当前大纲、既有正文、人物资料及用户要求，完成正文创作、续写、改写或润色。
创作时遵循文章资料中的语言风格和表现偏好；与用户当前明确要求冲突时，以当前要求为准。续写承接已有正文，改写保留用户指定的事实和内容，不擅自改变核心情节。
用户要求创作时，默认只输出所需正文，不添加前言、写作说明或总结；用户明确要求讨论或分析时，先回答该问题。
${NARRATIVE_CRAFT_RULES}`,
};

export function normalizeChatMode(value: unknown): ChatMode {
  return value === "outline" || value === "writing" ? value : "normal";
}

export function normalizeChatModePrompts(value: unknown): ChatModePrompts {
  const source = value && typeof value === "object" ? value as Partial<ChatModePrompts> : {};
  return Object.fromEntries(CHAT_MODES.map(({ value: mode }) => [mode,
    typeof source[mode] === "string" ? source[mode].slice(0, MAX_CHAT_MODE_PROMPT_LENGTH) : DEFAULT_CHAT_MODE_PROMPTS[mode],
  ])) as ChatModePrompts;
}

export function chatModeInstruction(mode: unknown, prompts: unknown) {
  const selected = normalizeChatMode(mode);
  return `当前聊天模式：${CHAT_MODES.find(item => item.value === selected)!.label}。使用当前模式的预定义指令，不沿用历史消息中其他模式的输出方式。\n${normalizeChatModePrompts(prompts)[selected]}`;
}
