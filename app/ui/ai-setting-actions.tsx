"use client";
import { Button, Group } from "@mantine/core";

export function AiSettingActions({ label, onGlobal, onPrevious, disabled = false }: { label: string; onGlobal: () => void; onPrevious: () => void; disabled?: boolean }) {
  return <Group gap="xs" wrap="wrap" role="group" aria-label={`${label}继承`} className="ai-setting-actions">
    <Button type="button" variant="subtle" size="compact-xs" disabled={disabled} onClick={onGlobal}>恢复全局默认</Button>
    <Button type="button" variant="subtle" size="compact-xs" disabled={disabled} onClick={onPrevious}>继承上一项</Button>
  </Group>;
}
