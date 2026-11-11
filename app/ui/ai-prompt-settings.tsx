"use client";

import { useState } from "react";
import { Alert, Badge, Button, Group, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { normalizeIllustrationStyles, type IllustrationStyle } from "@/lib/illustration-styles";
import { ResponsiveModal } from "./overlays";

export function AiPromptSettings() {
  const studio = useStudio();
  const styles = normalizeIllustrationStyles(studio.data.settings.illustrationStyles);
  const editable = styles.filter(style => style.value !== "auto");
  const [selected, setSelected] = useState<string>(() => editable[0]?.value ?? "");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const style = editable.find(item => item.value === selected) ?? editable[0];
  function save(value: IllustrationStyle, isNew: boolean) {
    studio.updateSettings({ illustrationStyles: isNew ? [...styles, value] : styles.map(item => item.value === value.value ? value : item) });
    setSelected(value.value); setCreating(false); setNotice(isNew ? `已添加「${value.label}」。` : `已更新「${value.label}」。`);
  }
  return <section className="ai-prompts-settings ai-task-section" aria-label="图片风格管理">
    <Group justify="space-between" align="flex-start" wrap="wrap">
      <div><h2>图片风格</h2></div>
      <Button onClick={() => setCreating(true)} disabled={editable.length >= 199}>添加风格</Button>
    </Group>
    {notice && <Text size="sm" role="status">{studio.saveStatus === "saved" ? notice : studio.saveStatus === "failed" ? `保存失败：${studio.saveError}` : studio.saveStatus === "local" ? "已保存到此设备，等待同步" : "正在保存风格…"}</Text>}
    <div className="ai-prompts-layout">
      <nav className="ai-prompt-list" aria-label="图片风格列表">
        {editable.map(item => <button type="button" key={item.value} aria-pressed={style?.value === item.value} onClick={() => setSelected(item.value)}><span>{item.label}</span><small>{item.description || "自定义图片风格"}</small></button>)}
        {!editable.length && <Text c="dimmed" size="sm">暂无图片风格。</Text>}
      </nav>
      {style ? <StyleEditor key={style.value} style={style} onSave={value => save(value, false)} onCopy={value => { save({ ...value, value: `custom-${crypto.randomUUID()}`, label: `${value.label.slice(0, 75)} 副本` }, true); }} onDelete={() => { studio.updateSettings({ illustrationStyles: styles.filter(item => item.value !== style.value) }); setSelected(""); setNotice(`已删除「${style.label}」，原有选择将使用“跟随 Prompt”。`); }} canCopy={editable.length < 199} /> : <div className="ai-prompt-empty">未选择图片风格。</div>}
    </div>
    <ResponsiveModal opened={creating} onClose={() => setCreating(false)} title="添加图片风格" aria-label="添加图片风格" size="lg">
      <StyleEditor key="new" style={{ value: `custom-${crypto.randomUUID()}`, label: "", description: "", instruction: "" }} onSave={value => save(value, true)} onCancel={() => setCreating(false)} />
    </ResponsiveModal>
  </section>;
}

function StyleEditor({ style, onSave, onCopy, onDelete, onCancel, canCopy = true }: { style: IllustrationStyle; onSave: (value: IllustrationStyle) => void; onCopy?: (value: IllustrationStyle) => void; onDelete?: () => void; onCancel?: () => void; canCopy?: boolean }) {
  const [draft, setDraft] = useState(style);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const dirty = draft.label !== style.label || draft.description !== style.description || draft.instruction !== style.instruction;
  function validated() {
    if (!draft.label.trim() || !draft.instruction.trim()) { setError("请填写风格名称和 Prompt。"); return; }
    setError(""); return { ...draft, label: draft.label.trim(), description: draft.description.trim(), instruction: draft.instruction.trim() };
  }
  return <>
    <form className="ai-prompt-editor" aria-label="风格编辑" onSubmit={event => { event.preventDefault(); const value = validated(); if (value) { setDraft(value); onSave(value); } }}>
      <Stack gap="md">
        <Group justify="space-between"><Text fw={600}>{onDelete ? "编辑风格" : "新建风格"}</Text>{dirty && <Badge variant="light">未保存修改</Badge>}</Group>
        <TextInput label="风格名称" aria-label="风格名称" maxLength={80} required value={draft.label} onChange={event => setDraft({ ...draft, label: event.currentTarget.value })} />
        <TextInput label="风格说明" aria-label="风格说明" maxLength={300} value={draft.description} onChange={event => setDraft({ ...draft, description: event.currentTarget.value })} />
        <Textarea label="风格 Prompt" aria-label="风格 Prompt" required minRows={8} autosize maxRows={18} maxLength={8000} value={draft.instruction} onChange={event => setDraft({ ...draft, instruction: event.currentTarget.value })} />
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Group gap="sm" wrap="wrap">
          <Button type="submit" disabled={Boolean(onDelete) && !dirty}>{onDelete ? "保存修改" : "添加风格"}</Button>
          {onCopy && <Button variant="default" disabled={!canCopy} onClick={() => { const value = validated(); if (value) onCopy(value); }}>复制为新风格</Button>}
          {dirty && onDelete && <Button variant="subtle" onClick={() => { setDraft(style); setError(""); }}>取消修改</Button>}
          {onCancel && <Button variant="default" onClick={onCancel}>取消</Button>}
          {onDelete && <Button color="red" variant="subtle" onClick={() => setDeleting(true)}>删除风格</Button>}
        </Group>
      </Stack>
    </form>
    <ResponsiveModal opened={deleting} onClose={() => setDeleting(false)} title="删除图片风格" aria-label="删除图片风格" size="sm">
      <Stack><Text>确定删除「{style.label}」？使用此风格的位置将回退到“跟随 Prompt”。</Text><Group justify="flex-end"><Button variant="default" onClick={() => setDeleting(false)}>取消</Button><Button color="red" onClick={() => { setDeleting(false); onDelete?.(); }}>确认删除</Button></Group></Stack>
    </ResponsiveModal>
  </>;
}
