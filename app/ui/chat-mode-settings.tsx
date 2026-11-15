"use client";

import { useState } from "react";
import { Button, Group, SegmentedControl, Stack, Textarea } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { CHAT_MODES, DEFAULT_CHAT_MODE_PROMPTS, MAX_CHAT_MODE_PROMPT_LENGTH, normalizeChatMode, normalizeChatModePrompts } from "@/lib/chat-modes";

export function ChatModeSettings() {
  const studio = useStudio();
  const [mode, setMode] = useState("normal");
  const selected = normalizeChatMode(mode);
  const prompts = normalizeChatModePrompts(studio.data.settings.chatModePrompts);
  const label = CHAT_MODES.find(item => item.value === selected)!.label;
  return <section className="ai-task-section" aria-label="聊天预定义">
    <Stack gap="md">
      <Group justify="space-between"><h2>聊天预定义</h2><Button size="xs" variant="default" disabled={prompts[selected] === DEFAULT_CHAT_MODE_PROMPTS[selected]} onClick={() => studio.updateSettings({ chatModePrompts: { ...prompts, [selected]: DEFAULT_CHAT_MODE_PROMPTS[selected] } })}>恢复当前模式默认</Button></Group>
      <SegmentedControl aria-label="预定义模式" fullWidth value={selected} data={[...CHAT_MODES]} onChange={setMode} />
      <Textarea label={`${label}预定义指令`} value={prompts[selected]} minRows={12} maxRows={24} autosize maxLength={MAX_CHAT_MODE_PROMPT_LENGTH} onChange={event => studio.updateSettings({ chatModePrompts: { ...prompts, [selected]: event.currentTarget.value } })} />
    </Stack>
  </section>;
}
