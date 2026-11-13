"use client";

import { Button, Group } from "@mantine/core";
import { ResponsiveModal } from "@/app/ui/overlays";

export type BodyDeleteTarget = {
  outlineId: string;
  versionId: string | null;
  name: string;
  isCurrent: boolean;
};

export function BodyDeleteDialog({ target, hasUnsavedChanges = false, deleting, onClose, onConfirm }: {
  target: BodyDeleteTarget | null;
  hasUnsavedChanges?: boolean;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return <ResponsiveModal opened={target !== null} onClose={onClose} title="删除正文？" size="sm" mobileFullScreen={false} closeButtonProps={{ "aria-label": "取消删除正文", disabled: deleting }} closeOnClickOutside={!deleting} closeOnEscape={!deleting}>
    <p>将删除「{target?.name}」。{target?.isCurrent && "删除后将按版本列表顺序切换到下一版。"}{hasUnsavedChanges && "尚未保存的修改也会删除。"}</p>
    <Group justify="flex-end" gap="sm">
      <Button variant="default" type="button" disabled={deleting} data-autofocus onClick={onClose}>取消</Button>
      <Button color="red" type="button" loading={deleting} onClick={onConfirm}>确认删除</Button>
    </Group>
  </ResponsiveModal>;
}
