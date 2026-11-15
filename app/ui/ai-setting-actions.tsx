"use client";
import { Menu } from "@mantine/core";

export function AiSettingActions({ label, onGlobal, onPrevious, disabled = false }: { label: string; onGlobal: () => void; onPrevious: () => void; disabled?: boolean }) {
  return <div className="ai-setting-actions" role="group" aria-label={label+"继承"}><Menu position="bottom-end" withinPortal><Menu.Target><button type="button" className="ai-setting-source-trigger" disabled={disabled} aria-label={label+"继承选项"}>来源 <span aria-hidden="true">⌄</span></button></Menu.Target><Menu.Dropdown aria-label={label+"继承选项"}><Menu.Item onClick={onGlobal}>恢复全局默认</Menu.Item><Menu.Item onClick={onPrevious}>继承上一项</Menu.Item></Menu.Dropdown></Menu></div>;
}
