"use client";

import { useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Menu, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useStudio, type Article } from "@/app/studio-state";
import { articleReviewRules, MAX_REVIEW_RULES, MAX_REVIEW_RULE_CONTENT, normalizeReviewRuleItems, type ReviewRule, type ReviewRuleSnapshot } from "@/lib/review-rules.mjs";
import { ResponsiveModal } from "./overlays";

const originLabels = { default: "默认", custom: "自定义", legacy: "原通用规则", preset: "原全局预设" };

export function ReviewRuleSnapshotView({ snapshot, showInstruction = true }: { snapshot: ReviewRuleSnapshot; showInstruction?: boolean }) {
  return <div className="review-rule-snapshot">
    {snapshot.rules.length ? snapshot.rules.map((rule) => <div key={rule.id}><strong>{rule.title} · v{rule.revision}</strong><p>{rule.content}</p></div>) : <p>无文章规则</p>}
    {showInstruction && <div><strong>本次指令</strong><p>{snapshot.instruction || "无附加指令"}</p></div>}
  </div>;
}

export function ArticleReviewRulesPage() {
  const studio = useStudio();
  return <ArticleReviewRulesEditor key={studio.currentArticle.id} article={studio.currentArticle} onUpdate={(reviewRuleItems) => studio.updateArticle({ reviewRuleItems })} presets={studio.data.settings.reviewPresets} />;
}

function ArticleReviewRulesEditor({ article, onUpdate, presets }: { article: Article; onUpdate: (rules: ReviewRule[]) => void; presets: string[] }) {
  const rules = articleReviewRules(article);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<ReviewRule | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<ReviewRule | null>(null);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const visible = rules.filter((rule) => rule.archived === archived);
  const activeCount = rules.filter((rule) => !rule.archived).length;

  function commit(next: ReviewRule[]) {
    try { onUpdate(normalizeReviewRuleItems(next, article.id)); setError(""); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "规则保存失败"); return false; }
  }

  function openEditor(rule: ReviewRule | "new") {
    setError(""); setTitle(rule === "new" ? "" : rule.title); setContent(rule === "new" ? "" : rule.content); setEditing(rule);
  }

  function saveRule() {
    if (!editing) return;
    const timestamp = new Date().toISOString();
    if (editing === "new") {
      if (commit([...rules, { id: `review-rule-${crypto.randomUUID()}`, title: title.trim(), content: content.trim(), archived: false, origin: "custom", revision: 1, createdAt: timestamp, updatedAt: timestamp }])) { setEditing(null); setArchived(false); }
    } else {
      const current = rules.find((rule) => rule.id === editing.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(editing)) { setError("这条规则已在其他位置修改或删除，请关闭后重新编辑。"); return; }
      if (commit(rules.map((rule) => rule.id !== editing.id ? rule : { ...rule, title: title.trim(), content: content.trim(), revision: rule.revision + 1, updatedAt: timestamp }))) setEditing(null);
    }
  }

  function importPresets() {
    const timestamp = new Date().toISOString();
    const imported: ReviewRule[] = selected.filter((item) => !rules.some((rule) => rule.content === item)).map((item) => ({ id: `review-rule-${crypto.randomUUID()}`, title: item.slice(0, 40), content: item, archived: false, origin: "preset", revision: 1, createdAt: timestamp, updatedAt: timestamp }));
    if (commit([...rules, ...imported])) { setImporting(false); setArchived(false); }
  }

  return <section className="article-review-rules" aria-label="审校规则管理">
    <Group justify="space-between" align="flex-start">
      <div><h2>审校规则</h2><Text size="sm" c="dimmed">用于 AI Generate 的生成后审校。</Text></div>
      <Group gap="xs">{presets.length > 0 && <Button variant="default" onClick={() => { setSelected([]); setError(""); setImporting(true); }}>导入原全局预设</Button>}<Button disabled={rules.length >= MAX_REVIEW_RULES} onClick={() => openEditor("new")}>新增规则</Button></Group>
    </Group>
    <Group gap="xs" className="review-rule-filters"><Button variant={archived ? "subtle" : "light"} aria-pressed={!archived} onClick={() => setArchived(false)}>生效中（{activeCount}）</Button><Button variant={archived ? "light" : "subtle"} aria-pressed={archived} onClick={() => setArchived(true)}>已归档（{rules.length - activeCount}）</Button></Group>
    {!activeCount && <Alert color="studio">当前没有生效规则。有本次附加指令时仅按该指令审校；没有附加指令时无需审校。</Alert>}
    {error && !editing && !importing && <Alert color="red">{error}</Alert>}
    <Stack gap="sm">{visible.map((rule) => <article key={rule.id} className="review-rule-card" aria-label={`规则：${rule.title}`}>
      <Group justify="space-between" align="flex-start"><div className="review-rule-heading"><h3>{rule.title}</h3><Badge variant="light" color={rule.origin === "default" ? "studio" : "gray"}>{originLabels[rule.origin]}</Badge><Text size="xs" c="dimmed">v{rule.revision}</Text></div><Group gap={4}><Button size="compact-sm" variant="subtle" onClick={() => openEditor(rule)}>编辑</Button><Menu position="bottom-end" shadow="md" width={160} withinPortal><Menu.Target><Button size="compact-sm" variant="subtle" aria-label={`${rule.title}的更多操作`}>更多</Button></Menu.Target><Menu.Dropdown><Menu.Item onClick={() => commit(rules.map((item) => item.id !== rule.id ? item : { ...item, archived: !item.archived, revision: item.revision + 1, updatedAt: new Date().toISOString() }))}>{rule.archived ? "恢复" : "归档"}</Menu.Item><Menu.Item color="red" onClick={() => setDeleting(rule)}>删除</Menu.Item></Menu.Dropdown></Menu></Group></Group>
      <p>{rule.content}</p>
    </article>)}</Stack>
    {!visible.length && <Text c="dimmed" className="review-rule-empty">{archived ? "暂无已归档规则。" : "暂无生效规则，可新增规则。"}</Text>}
    <ResponsiveModal opened={Boolean(editing)} onClose={() => setEditing(null)} title={editing === "new" ? "新增 Review 规则" : "编辑 Review 规则"} size="lg" centered>
      <Stack><TextInput label="规则名称" value={title} maxLength={120} onChange={(event) => setTitle(event.currentTarget.value)} autoFocus /><Textarea label="规则内容" description="完整说明检查标准，以及需要保留的例外。" value={content} maxLength={MAX_REVIEW_RULE_CONTENT} minRows={5} maxRows={12} autosize onChange={(event) => setContent(event.currentTarget.value)} />{error && <Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" onClick={() => setEditing(null)}>取消</Button><Button disabled={!title.trim() || !content.trim()} onClick={saveRule}>保存规则</Button></Group></Stack>
    </ResponsiveModal>
    <ResponsiveModal opened={Boolean(deleting)} onClose={() => setDeleting(null)} title="删除 Review 规则" centered>
      <Stack><Text>删除“{deleting?.title}”？删除后不会自动补回，历史任务和报告仍保留原规则。</Text><Group justify="flex-end"><Button variant="default" onClick={() => setDeleting(null)}>取消</Button><Button color="red" onClick={() => { if (commit(rules.filter((rule) => rule.id !== deleting?.id))) setDeleting(null); }}>确认删除</Button></Group></Stack>
    </ResponsiveModal>
    <ResponsiveModal opened={importing} onClose={() => setImporting(false)} title="导入原全局预设" size="lg" centered>
      <Stack><Text size="sm">选中的预设会复制为本文章的生效规则，可独立编辑。原预设继续保留。</Text>{presets.map((item) => <Checkbox key={item} label={item} disabled={rules.some((rule) => rule.content === item)} checked={selected.includes(item)} onChange={(event) => { const checked = event.currentTarget.checked; setSelected((current) => checked ? [...current, item] : current.filter((value) => value !== item)); }} />)}{error && <Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" onClick={() => setImporting(false)}>取消</Button><Button disabled={!selected.length} onClick={importPresets}>导入选中规则</Button></Group></Stack>
    </ResponsiveModal>
  </section>;
}
