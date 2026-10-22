"use client";
import { Button, Group } from "@mantine/core";

export function AiSettingActions({ label, onArticle, onPrevious, disabled = false }: { label: string; onArticle: () => void; onPrevious: () => void; disabled?: boolean }) {
  return <Group gap="xs" wrap="wrap" role="group" aria-label={`${label}继承`} className="ai-setting-actions">
    <Button type="button" variant="subtle" size="compact-xs" disabled={disabled} onClick={onArticle}>退回文章默认</Button>
    <Button type="button" variant="subtle" size="compact-xs" disabled={disabled} onClick={onPrevious}>继承上一项</Button>
  </Group>;
}
