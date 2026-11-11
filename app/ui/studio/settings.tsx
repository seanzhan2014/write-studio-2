"use client";

import { CharacterAvatar } from "@/app/ui/character-visual";
import { CharacterPhotoWorkspace } from "@/app/ui/character-photos";
import type { CharacterVisual } from "@/lib/character-visual";
import { ArticleIllustrationSettings } from "@/app/ui/article-illustration-settings";

import { TaskParameterSettings } from "@/app/ui/task-parameter-settings";

import { StyleLabPanel } from "@/app/ui/style-lab";
import { StyleLearningDefaultsSettings } from "@/app/ui/style-learning-settings";
import { AiPromptSettings } from "@/app/ui/ai-prompt-settings";

import { ArticleReviewRulesPage } from "@/app/ui/review-rules";

import { AppearancePanel } from "@/app/ui/appearance-settings";
import { AiServices } from "@/app/ui/ai-services";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Checkbox, createTheme, Group, MantineThemeProvider, Menu, Select, SimpleGrid, Stack, Text, Textarea } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import { CIPAI_OPTIONS, DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE, NAMING_EXPRESSION_OPTIONS, NAMING_FORMAT_OPTIONS, NAMING_STYLE_OPTIONS, normalizeNamingProfile, type NamingProfile } from "@/lib/naming-options";

import { type ArticleCopyOptions } from "@/lib/data-transfer";
import { browserIsOffline, fetchFromServer, fetchServerAction, OFFLINE_OPERATION_MESSAGE } from "@/lib/browser-network";
import { formatTime, useStudio, type Article, type Character } from "@/app/studio-state";
import { useDataTransfer } from "@/app/data-transfer";
import { ResponsiveModal } from "@/app/ui/overlays";
import { ArticleStoryFields, CHARACTER_LABELS } from "@/app/ui/story-settings-editor";
import { CHARACTER_PROFILE_KEYS, normalizeCharacterProfile, type ResolvedChapterSettings } from "@/lib/story-settings";

import { type View, type ManagedServiceStatusResponse, type ManagedServiceStatus } from "@/app/ui/studio/types";

import { useDismissOnOutside, PageHeader, IconButton, Icon, copyTextToClipboard } from "@/app/ui/studio/shared";

import { ArticleCopyDialog } from "@/app/ui/studio/article-dialogs";
import { ArticleGenerateSettings } from "@/app/ui/article-generate-settings";

export function ArticleInfoPage({ view, onGo, onNotice }: { view: View; onGo: (view: View) => void; onNotice: (message: string) => void }) {
  const studio = useStudio();
  const transfer = useDataTransfer();
  const [moreOpen, setMoreOpen] = useState(false);
  const [copySource, setCopySource] = useState<Article | null>(null);
  useDismissOnOutside(moreOpen, () => setMoreOpen(false), ".info-more-trigger, .info-more-menu");

  async function copyArticle(options: ArticleCopyOptions) {
    if (!copySource) return false;
    if (!await studio.saveNow()) {
      onNotice("请先完成当前文章的保存");
      return false;
    }
    const copied = studio.duplicateArticle(copySource.id, options);
    if (!copied) {
      onNotice("原文章不存在，无法创建副本");
      return false;
    }
    const saved = await studio.saveNow();
    setCopySource(null);
    window.history.pushState({}, "", `/articles/${copied.articleId}/info/basic`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    onNotice(saved ? "文章副本已创建" : "副本已创建，保存尚未完成");
    return true;
  }

  return (
    <div className="page-scroll"><div className="standard-page info-page">
      <PageHeader eyebrow={studio.currentArticle.title} title="文章资料" actions={<IconButton name="more" label="文章资料更多操作" className="info-more-trigger" onClick={() => setMoreOpen((open) => !open)} />} />
      {moreOpen && <div className="info-more-menu"><button type="button" onClick={() => { transfer.exportArticle(studio.currentArticle); setMoreOpen(false); }}>导出这篇文章</button><button type="button" onClick={() => { setCopySource(studio.currentArticle); setMoreOpen(false); }}>复制这篇文章</button><button type="button" onClick={() => { studio.updateSettings({ showArchived: !studio.data.settings.showArchived }); setMoreOpen(false); }}>{studio.data.settings.showArchived ? "隐藏" : "显示"}已归档内容</button><button className="danger" type="button" onClick={() => { const value = window.prompt(`输入文章标题「${studio.currentArticle.title}」以确认删除`); if (value === studio.currentArticle.title) studio.deleteArticle(studio.currentArticle.id); setMoreOpen(false); }}>删除文章</button></div>}
      <Tabs items={[
        ["info-basic", "基本信息"], ["info-characters", "人物"], ["info-relationships", "人物关系"], ["info-references", "参考文章"],
      ]} active={view} onGo={onGo} />
      {view === "info-basic" && <BasicInfo />}
      {view === "info-characters" && <Characters />}
      {view === "info-relationships" && <Relationships />}
      {view === "info-references" && <MantineThemeProvider theme={aiTaskFormTheme}><div className="article-reference-page ai-task-settings-page"><StyleLabPanel /></div></MantineThemeProvider>}
      {copySource && <ArticleCopyDialog article={copySource} existingTitles={studio.data.articles.map((article) => article.title)} onClose={() => setCopySource(null)} onCreate={copyArticle} />}
    </div></div>
  );
}

export function Tabs({ items, active, onGo }: { items: [View, string][]; active: View; onGo: (view: View) => void }) {
  return <div className="tabs" role="tablist">{items.map(([key, label]) => <button key={key} className={active === key ? "active" : ""} type="button" role="tab" aria-selected={active === key} onClick={() => onGo(key)}>{label}</button>)}</div>;
}

export function BasicInfo() {
  const studio = useStudio();
  const article = studio.currentArticle;
  return <div className="form-card article-story-settings"><div className="form-grid"><label className="full">文章标题<input value={article.title} maxLength={120} onChange={(event) => studio.updateArticle({ title: event.target.value })} /></label><label className="full">简介<textarea value={article.summary} maxLength={10000} onChange={(event) => studio.updateArticle({ summary: event.target.value })} /></label></div><ArticleStoryFields article={article} /><div className="form-foot"><span>创建于 {formatTime(article.createdAt)} · 修改于 {formatTime(article.updatedAt)}</span><span className="save-state"><i /> 已自动保存</span></div></div>;
}

export function ArticleChapterNames() {
  const studio = useStudio();
  const article = studio.currentArticle;
  const activeChapters = article.chapters.filter((chapter) => !chapter.archived);
  const eligibleOutlineCount = activeChapters.reduce((total, chapter) => total + chapter.outlines.filter((outline) => !outline.archived && outline.plan.trim()).length, 0);
  return <section className="form-card article-ai-task-section article-naming-page" aria-labelledby="article-naming-title">
      <header className="article-ai-task-section-heading"><h2 id="article-naming-title">命名规则</h2></header>
      <section className="article-naming-settings">
        {!eligibleOutlineCount && <Alert color="studio" variant="light">当前没有包含内容的未归档大纲。填写大纲内容后即可生成全部名称。</Alert>}
        <div className="article-naming-grid"><NamingProfileEditor title="章节命名" profile={article.chapterNaming} fallback={DEFAULT_CHAPTER_NAMING_PROFILE} onChange={(chapterNaming) => studio.updateArticle({ chapterNaming })} /><NamingProfileEditor title="大纲命名" profile={article.outlineNaming} fallback={DEFAULT_OUTLINE_NAMING_PROFILE} onChange={(outlineNaming) => studio.updateArticle({ outlineNaming })} /></div>
      </section>
      <div className="form-foot"><span>{activeChapters.length} 个未归档章节 · {eligibleOutlineCount} 条可命名大纲</span><span className="save-state"><i /> 已自动保存</span></div>
    </section>;
}

export function NamingProfileEditor({ title, profile, fallback, onChange }: { title: string; profile: NamingProfile; fallback: NamingProfile; onChange: (profile: NamingProfile) => void }) {
  const value = normalizeNamingProfile(profile, fallback);
  const patch = (next: Partial<NamingProfile>) => onChange(normalizeNamingProfile({ ...value, ...next }, fallback));
  const help = value.format === "five"
    ? `${value.lineCount} 句，每句严格 5 个汉字`
    : value.format === "seven"
      ? `${value.lineCount} 句，每句严格 7 个汉字`
      : value.format === "cipai"
        ? `${CIPAI_OPTIONS.find((item) => item.value === value.cipai)?.label ?? "如梦令"}风格 · ${value.lineCount} 句 · 结果不显示词牌名`
        : `忽略空格和标点后 ${value.minCharacters}–${value.maxCharacters} 字`;
  return <fieldset className="naming-profile-editor">
    <legend>{title}</legend>
    <label>语言风格<select value={value.style} onChange={(event) => patch({ style: event.target.value as NamingProfile["style"] })}>{NAMING_STYLE_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
    {value.style === "custom" && <label>自定义语言风格<textarea maxLength={500} value={value.customStyle} placeholder="例如：使用冷峻短句和海洋意象" onChange={(event) => patch({ customStyle: event.target.value })} /></label>}
    <label>表达内容<select value={value.expression} onChange={(event) => patch({ expression: event.target.value as NamingProfile["expression"] })}>{NAMING_EXPRESSION_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
    {value.expression === "custom" && <label>自定义表达要求<textarea maxLength={500} value={value.customExpression} placeholder="例如：只暗示人物关系变化，不直接写出事件结果" onChange={(event) => patch({ customExpression: event.target.value })} /></label>}
    <label>格式<select value={value.format} onChange={(event) => patch({ format: event.target.value as NamingProfile["format"] })}>{NAMING_FORMAT_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
    {value.format === "range" ? <div className="naming-length-range"><label>最少字数<input type="number" min="1" max="80" value={value.minCharacters} onChange={(event) => patch({ minCharacters: Number(event.target.value) })} /></label><label>最多字数<input type="number" min={value.minCharacters} max="80" value={value.maxCharacters} onChange={(event) => patch({ maxCharacters: Number(event.target.value) })} /></label></div> : <div className="naming-poetry-options">{value.format === "cipai" && <label>参考词牌<select value={value.cipai} onChange={(event) => patch({ cipai: event.target.value as NamingProfile["cipai"] })}>{CIPAI_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>}<label>生成句数<select value={String(value.lineCount)} onChange={(event) => patch({ lineCount: Number(event.target.value) })}>{[1, 2, 3, 4].map((count) => <option value={count} key={count}>{count} 句</option>)}</select></label></div>}
    <small>{help}；多句以中文逗号连接并保存为单行。</small>
  </fieldset>;
}

export function Characters() {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [photoTab, setPhotoTab] = useState(false);
  const [form, setForm] = useState({ name: "", aliases: "", description: "", profile: normalizeCharacterProfile(undefined), visual: undefined as CharacterVisual | undefined });
  const visible = studio.currentArticle.characters.filter((person) => (studio.data.settings.showArchived || !person.archived) && `${person.name}${person.aliases.join("")}${person.description}${Object.values(normalizeCharacterProfile(person.profile)).join("")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  function openCreate() { setPhotoTab(false); setEditingId(null); setForm({ name: "", aliases: "", description: "", profile: normalizeCharacterProfile(undefined), visual: undefined }); setFormOpen(true); }
  function openEdit(person: Character) { setPhotoTab(false); setEditingId(person.id); setForm({ name: person.name, aliases: person.aliases.join("，"), description: person.description, profile: normalizeCharacterProfile(person.profile), visual: person.visual }); setFormOpen(true); }
  function save() {
    const name = form.name.trim();
    if (!name) return;
    const aliases = [...new Set(form.aliases.split(/[，,;；\n]/).map((item) => item.trim()).filter(Boolean))];
    if (editingId) studio.updateCharacter(editingId, { name, aliases, description: form.description, profile: form.profile, visual: form.visual });
    else studio.addCharacter({ name, aliases, description: form.description, profile: form.profile, visual: form.visual, archived: false });
    setFormOpen(false);
  }
  function showPhotos() {
    const name = form.name.trim(); if (!name) return;
    const patch = { name, aliases: [...new Set(form.aliases.split(/[，,;；\n]/).map(s => s.trim()).filter(Boolean))], description: form.description, profile: form.profile, visual: form.visual };
    if (editingId) studio.updateCharacter(editingId, patch);
    else setEditingId(studio.addCharacter({ ...patch, archived: false }));
    setPhotoTab(true);
    window.setTimeout(() => void studio.saveNow(), 0);
  }
  return <>
    <div className="list-toolbar"><label><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索人物…" /></label><button className="primary-compact" type="button" onClick={openCreate}><Icon name="plus" />新建人物</button></div>
    <div className="character-grid">{visible.map((person, index) => { const profile = normalizeCharacterProfile(person.profile); return <article className={`character-card ${person.archived ? "archived" : ""}`} key={person.id}><div className={`character-avatar ${["coral", "blue", "green"][index % 3]}`}><CharacterAvatar visual={person.visual} photos={person.photos} name={person.name} /></div><div><h3>{person.name}</h3><span>{[profile.age, person.aliases.join("、")].filter(Boolean).join(" · ")}</span><p>{profile.immutableTraits || person.description || "暂无描述"}</p></div><div className="card-actions"><button type="button" onClick={() => openEdit(person)}>编辑</button><Menu position="bottom-end" shadow="md" width={160} withinPortal><Menu.Target><button type="button" aria-label={`${person.name}的更多操作`}>更多</button></Menu.Target><Menu.Dropdown><Menu.Item onClick={() => studio.updateCharacter(person.id, { archived: !person.archived })}>{person.archived ? "恢复" : "归档"}</Menu.Item><Menu.Item color="red" onClick={() => { if (window.confirm(`删除人物「${person.name}」及其关系？`)) studio.deleteCharacter(person.id); }}>删除</Menu.Item></Menu.Dropdown></Menu></div></article>; })}</div>
    {!visible.length && <div className="empty-inline">没有符合条件的人物。</div>}
    <ResponsiveModal
      opened={formOpen}
      onClose={() => setFormOpen(false)}
      closeButtonProps={{ "aria-label": "关闭人物编辑" }}
      title={editingId ? "编辑人物" : "新建人物"}
      size={photoTab ? 1120 : 720}
      fullScreen={compact}
      centered={!compact}
      scrollMode="content"
      classNames={{ content: "character-edit-dialog", body: "character-edit-dialog-body" }}
    >
      <div className="character-edit-tabs" role="tablist" aria-label="人物编辑页面"><button type="button" role="tab" aria-selected={!photoTab} onClick={() => setPhotoTab(false)}>资料</button><button type="button" role="tab" aria-selected={photoTab} disabled={!form.name.trim()} onClick={showPhotos}>照片</button></div>
      {photoTab && editingId ? <CharacterPhotoWorkspace key={editingId} characterId={editingId} /> : <div className="character-edit-scroll" data-ui-overlay-scroll><label>人名<input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>别名<textarea value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} placeholder="使用逗号、分号或换行分隔" /></label><div className="character-profile-form">{CHARACTER_PROFILE_KEYS.map((key) => <label key={key} className={CHARACTER_LABELS[key].rows ? "full" : ""}>{CHARACTER_LABELS[key].label}{CHARACTER_LABELS[key].rows ? <textarea value={form.profile[key]} onChange={(event) => setForm({ ...form, profile: { ...form.profile, [key]: event.target.value } })} placeholder={CHARACTER_LABELS[key].placeholder} /> : <input value={form.profile[key]} onChange={(event) => setForm({ ...form, profile: { ...form.profile, [key]: event.target.value } })} placeholder={CHARACTER_LABELS[key].placeholder} />}</label>)}</div><label>人物说明<textarea className="character-description-input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>}
      {!photoTab && <footer className="character-edit-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>取消</button><button className="primary-compact" type="button" disabled={!form.name.trim()} onClick={save}>保存</button></footer>}
    </ResponsiveModal>
  </>;
}

export function Relationships() {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const people = studio.currentArticle.characters.filter((person) => !person.archived);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ characterAId: "", characterBId: "", description: "" });
  const [error, setError] = useState("");
  const personOptions = people.map((person) => ({ value: person.id, label: person.name }));
  function openCreate() {
    if (people.length < 2) return;
    setEditingId(null);
    setForm({ characterAId: people[0].id, characterBId: people[1].id, description: "" });
    setError("");
    setFormOpen(true);
  }
  function openEdit(item: Article["relationships"][number]) {
    setEditingId(item.id);
    setForm({ characterAId: item.characterAId, characterBId: item.characterBId, description: item.description });
    setError("");
    setFormOpen(true);
  }
  function save() {
    if (!form.characterAId || !form.characterBId || form.characterAId === form.characterBId) { setError("请选择两个不同人物。"); return; }
    const description = form.description.trim();
    if (!description) { setError("请填写关系描述。"); return; }
    const duplicate = studio.currentArticle.relationships.some((item) => item.id !== editingId && [item.characterAId, item.characterBId].includes(form.characterAId) && [item.characterAId, item.characterBId].includes(form.characterBId));
    if (duplicate) { setError("这两个人物之间已经存在关系。"); return; }
    if (editingId) studio.updateRelationship(editingId, { ...form, description });
    else studio.addRelationship({ ...form, description });
    setFormOpen(false);
  }
  return <><div className="relationship-toolbar"><span className="ui-title">{studio.currentArticle.relationships.length} 条人物关系</span><button className="primary-compact" type="button" disabled={people.length < 2} onClick={openCreate}><Icon name="plus" />新建关系</button></div>{people.length < 2 && <div className="empty-inline">至少需要两个人物才能建立关系。</div>}<div className="relationship-list">{studio.currentArticle.relationships.map((item) => { const a = studio.currentArticle.characters.find((person) => person.id === item.characterAId); const b = studio.currentArticle.characters.find((person) => person.id === item.characterBId); if (!a || !b) return null; return <article className="relationship-card" key={item.id}><div className="mini-avatar blue">{a.name[0]}</div><span className="ui-title">{a.name}</span><span className="relationship-line"><Icon name="link" /><em>{item.description}</em></span><span className="ui-title">{b.name}</span><div className="mini-avatar blue">{b.name[0]}</div><div className="card-actions"><button type="button" onClick={() => openEdit(item)}>编辑</button><Menu position="bottom-end" shadow="md" width={140} withinPortal><Menu.Target><button type="button" aria-label={`${a.name}与${b.name}关系的更多操作`}>更多</button></Menu.Target><Menu.Dropdown><Menu.Item color="red" onClick={() => { if (window.confirm("删除这条人物关系？")) studio.deleteRelationship(item.id); }}>删除</Menu.Item></Menu.Dropdown></Menu></div></article>; })}</div>
    <ResponsiveModal opened={formOpen} onClose={() => setFormOpen(false)} closeButtonProps={{ "aria-label": "关闭人物关系编辑" }} title={editingId ? "编辑人物关系" : "新建人物关系"} size="md" fullScreen={compact} centered={!compact}>
      <Stack gap="md"><SimpleGrid cols={{ base: 1, sm: 2 }}><Select label="人物 A" data={personOptions} value={form.characterAId} allowDeselect={false} onChange={(value) => setForm({ ...form, characterAId: value ?? "" })} /><Select label="人物 B" data={personOptions} value={form.characterBId} allowDeselect={false} onChange={(value) => setForm({ ...form, characterBId: value ?? "" })} /></SimpleGrid><Textarea label="关系描述" value={form.description} maxLength={1000} minRows={3} maxRows={8} autosize onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} />{error && <Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" onClick={() => setFormOpen(false)}>取消</Button><Button disabled={!form.description.trim() || !form.characterAId || !form.characterBId} onClick={save}>保存关系</Button></Group></Stack>
    </ResponsiveModal>
  </>;
}

export function SettingsPage({ view, onGo }: { view: View; onGo: (view: View) => void }) {
  const items: [View, string][] = [
    ["settings-general", "常规"],
    ["settings-appearance", "外观与编辑器"],
    ["settings-models", "AI 服务"],
    ["settings-tasks", "AI 任务"],
    ["settings-database", "数据管理"],
    ["settings-system", "系统与诊断"],
  ];
  const activeItem = items.find(([key]) => key === view) ?? items[0];
  return <div className="settings-layout"><nav className="settings-nav" aria-label="设置分类"><button className="settings-back-writing" type="button" onClick={() => onGo("write")}>← 返回写作</button><div><span>Writer Studio</span><span className="ui-title">设置</span></div>{items.map(([key, label]) => <button className={view === key ? "active" : ""} key={key} type="button" onClick={() => onGo(key)}><span className="ui-title">{label}</span></button>)}</nav><div className={`settings-content ${view === "settings-models" ? "ai-settings-content" : ""}`}><PageHeader title={activeItem[1]} />{view === "settings-general" && <GeneralSettings />}{view === "settings-appearance" && <AppearanceSettings />}{view === "settings-models" && <ModelSettings />}{view === "settings-prompts" && <TaskSettings />}{view === "settings-tasks" && <TaskSettings />}{view === "settings-database" && <DatabaseSettings />}{view === "settings-system" && <SystemSettings />}</div></div>;
}

export function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="setting-section"><div className="setting-title"><h2>{title}</h2></div><div className="setting-body">{children}</div></section>;
}

export function SettingRow({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><span className="ui-label">{title}</span></div>{children}</div>;
}

export function Toggle({ checked = true, disabled = false, onChange }: { checked?: boolean; disabled?: boolean; onChange?: (checked: boolean) => void }) { return <button type="button" disabled={disabled} className={`toggle ${checked ? "on" : ""}`} aria-label={checked ? "已开启" : "已关闭"} aria-pressed={checked} onClick={() => onChange?.(!checked)}><span /></button>; }

export function GeneralSettings() {
  const studio = useStudio();
  return <SettingSection title="语言与启动"><SettingRow title="界面语言"><select><option>简体中文</option></select></SettingRow><SettingRow title="启动时打开上次文章"><Toggle checked={studio.data.settings.openLastArticle} onChange={(checked) => studio.updateSettings({ openLastArticle: checked })} /></SettingRow><SettingRow title="默认显示已归档内容"><Toggle checked={studio.data.settings.showArchived} onChange={(checked) => studio.updateSettings({ showArchived: checked })} /></SettingRow></SettingSection>;
}

export function AppearanceSettings() {
  const studio = useStudio();
  return <><AppearancePanel /><SettingSection title="侧栏"><SettingRow title="大纲内容默认展开"><Toggle checked={studio.data.settings.outlineExpanded} onChange={(checked) => studio.updateSettings({ outlineExpanded: checked })} /></SettingRow></SettingSection></>;
}

export function ModelSettings() { return <AiServices />; }

const aiTaskFormTheme = createTheme({ components: { InputWrapper: { defaultProps: { inputWrapperOrder: ["label", "input", "description", "error"] } } } });

export function TaskSettings() {
  const studio = useStudio();
  const categories = ["正文生成", "写作准备", "自动审校", "大纲", "聊天", "图片", "学习与微调", "全局"];
  const [category, setCategory] = useState(() => typeof window !== "undefined" && window.location.pathname.includes("/settings/prompts") ? "图片" : "正文生成");
  const [imageTab, setImageTab] = useState(() => typeof window !== "undefined" && window.location.pathname.includes("/settings/prompts") ? "风格库" : "生成设置");
  const autoSaving = !(category === "图片" && imageTab === "风格库");
  return <MantineThemeProvider theme={aiTaskFormTheme}><div className="ai-task-settings-page">
    {autoSaving && <div className="ai-task-intro"><Text size="xs" c={studio.saveStatus === "failed" ? "red" : "dimmed"} role="status">{studio.saveStatus === "saved" ? "设置已自动保存" : studio.saveStatus === "failed" ? `保存失败：${studio.saveError}` : studio.saveStatus === "local" ? "已保存到此设备，等待同步" : "正在保存设置…"}</Text></div>}
    <div className="ai-task-category-tabs" role="tablist" aria-label="AI 任务分类">{categories.map(item => <button type="button" role="tab" id={`ai-category-${categories.indexOf(item)}`} aria-selected={category === item} aria-controls="ai-category-panel" key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <div id="ai-category-panel" role="tabpanel" aria-labelledby={`ai-category-${categories.indexOf(category)}`} className="ai-task-category-panel">
      {category === "正文生成" && <ArticleGenerateSettings global />}
      {category === "写作准备" && <TaskParameterSettings level="global" targetId="global" groups={["写作准备"]} title="写作准备" />}
      {category === "自动审校" && <div className="ai-task-sections"><TaskParameterSettings level="global" targetId="global" groups={["自动审校"]} title="自动审校" /><ArticleReviewRulesPage global /></div>}
      {category === "大纲" && <TaskParameterSettings level="global" targetId="global" groups={["命名"]} title="章节与大纲名称" />}
      {category === "聊天" && <TaskParameterSettings level="global" targetId="global" groups={["聊天"]} title="聊天" />}
      {category === "图片" && <><div className="ai-task-subtabs" role="tablist" aria-label="图片设置分类">{["生成设置", "风格库"].map(tab => <button type="button" role="tab" key={tab} id={`ai-image-${tab === "生成设置" ? "generation" : "styles"}`} aria-selected={imageTab === tab} aria-controls="ai-image-panel" onClick={() => setImageTab(tab)}>{tab}</button>)}</div><div id="ai-image-panel" role="tabpanel" aria-labelledby={`ai-image-${imageTab === "生成设置" ? "generation" : "styles"}`}>{imageTab === "生成设置" ? <div className="ai-task-sections"><TaskParameterSettings level="global" targetId="global" groups={["插图模型"]} title="图片模型" /><ArticleIllustrationSettings global /></div> : <AiPromptSettings />}</div></>}
      {category === "学习与微调" && <StyleLearningDefaultsSettings />}
      {category === "全局" && <TaskParameterSettings level="global" targetId="global" groups={["任务队列"]} title="全局任务设置" />}
    </div>
  </div></MantineThemeProvider>;
}

export function DatabaseSettings() {
  const studio = useStudio();
  const transfer = useDataTransfer();
  type SyncStatus = { state?: "cloud" | "not_configured" | "unpaired" | "synced" | "pending" | "uploading" | "diverged" | "schema_mismatch" | "offline" | "error"; message?: string; autoUploadEnabled?: boolean; localDatabaseVersion?: number; remoteDatabaseVersion?: number; lastCloudVersion?: number | null; lastSyncAt?: string | null; cloudHost?: string | null };
  const [status, setStatus] = useState<{ connected?: boolean; engine?: string; revision?: number; databaseVersion?: number; articles?: number; searchMode?: string } | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncBusy, setSyncBusy] = useState<"pull" | "push" | "">("");
  const [syncToggleBusy, setSyncToggleBusy] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [overwriteModels, setOverwriteModels] = useState(false);
  const [overwriteSecrets, setOverwriteSecrets] = useState(false);
  const [checking, setChecking] = useState(false);
  useEffect(() => { void fetchFromServer("/api/database/status", { cache: "no-store" }).then((response) => response.json()).then(setStatus).catch(() => setStatus({ connected: false })); }, [studio.saveStatus]);
  const loadSyncStatus = useCallback(async () => {
    try {
      const response = await fetchFromServer("/api/sync/status", { cache: "no-store" });
      setSyncStatus(await response.json() as SyncStatus);
    } catch (reason) {
      setSyncStatus({ state: "offline", message: reason instanceof Error ? reason.message : "同步状态读取失败" });
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => { void loadSyncStatus(); }, 0);
    const refresh = () => { void loadSyncStatus(); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("writer-studio-sync-status", refresh);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("writer-studio-sync-status", refresh); };
  }, [loadSyncStatus]);
  async function check() { setChecking(true); try { const response = await fetchServerAction("/api/database/integrity-check", { method: "POST" }); const result = await response.json() as { ok?: boolean; issues?: unknown[]; message?: string }; window.alert(result.ok ? "完整性检查通过：未发现孤立记录或外键错误。" : `检查发现问题：${result.message || JSON.stringify(result.issues)}`); } catch (reason) { window.alert(reason instanceof Error ? reason.message : "完整性检查失败"); } finally { setChecking(false); } }
  async function setAutoUpload(enabled: boolean) {
    setSyncToggleBusy(true); setSyncNotice("");
    try {
      const response = await fetchServerAction("/api/sync/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoUploadEnabled: enabled }) });
      const payload = await response.json() as SyncStatus & { message?: string };
      if (!response.ok) throw new Error(payload.message || "自动上传设置保存失败");
      setSyncStatus(payload);
      if (enabled) void fetchFromServer("/api/sync/upload", { method: "POST" }).catch(() => undefined).finally(() => void loadSyncStatus());
    } catch (reason) {
      setSyncNotice(reason instanceof Error ? reason.message : "自动上传设置保存失败");
    } finally {
      setSyncToggleBusy(false);
    }
  }
  async function replaceDatabase(direction: "pull" | "push") {
    if (browserIsOffline()) { setSyncNotice(OFFLINE_OPERATION_MESSAGE); return; }
    const phrase = direction === "pull" ? "从云端取回" : "复制到云端";
    const target = direction === "pull" ? "本地" : "云端";
    const scope = ["创作数据库", overwriteModels ? "大模型配置" : "", overwriteSecrets ? "API Key/Secret" : ""].filter(Boolean).join("、");
    const sensitiveNotice = overwriteModels ? "覆盖前备份将包含目标端现有 API Key，请妥善保管 data/recovery。" : "";
    const typed = window.prompt(`此操作会用${direction === "pull" ? "云端" : "本地"}的${scope}覆盖${target}。${sensitiveNotice}输入“${phrase}”确认：`, "");
    if (typed !== phrase) return;
    setSyncBusy(direction); setSyncNotice("");
    try {
      if (!await studio.saveNow()) throw new Error("本地内容尚未保存，已取消覆盖");
      const response = await fetchServerAction(`/api/sync/${direction}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ includeModels: overwriteModels, includeSecrets: overwriteSecrets }) });
      const payload = await response.json() as { message?: string; backupPath?: string; code?: string };
      if (!response.ok) throw new Error(payload.message || `覆盖失败（${response.status}）`);
      if (direction === "pull") {
        window.location.reload();
        return;
      }
      setSyncNotice(`${payload.message ?? "云端覆盖完成"}；覆盖前快照已保存。`);
      await loadSyncStatus();
    } catch (reason) {
      setSyncNotice(reason instanceof Error ? reason.message : "数据库覆盖失败");
    } finally {
      setSyncBusy("");
    }
  }
  const syncBlocked = syncStatus?.state === "cloud" || syncStatus?.state === "not_configured" || syncStatus?.state === "schema_mismatch";
  const syncHealthy = syncStatus?.state === "synced";
  return <>
    <SettingSection title="完整备份">
      <div className="transfer-hero"><div><span className="ui-title">导出全部 Writer Studio 数据</span><p>不包含 API Key。</p></div><Button leftSection={<Icon name="saveAs" />} onClick={() => void transfer.exportComplete()}>导出全部</Button></div>
    </SettingSection>
    <SettingSection title="批量迁移">
      <div className="transfer-grid">
        <article className="transfer-card"><div><span className="ui-title">所有文章</span><p>{studio.data.articles.length} 篇文章</p></div><Group gap="xs"><Button variant="default" size="xs" onClick={transfer.exportAllArticles}>导出</Button><Button variant="light" size="xs" onClick={() => void transfer.importAllArticles()}>导入</Button></Group></article>
        <article className="transfer-card"><div><span className="ui-title">系统配置</span><p>API Key 需要在新环境重新输入。</p></div><Group gap="xs"><Button variant="default" size="xs" onClick={() => void transfer.exportSystemConfig()}>导出</Button><Button variant="light" size="xs" onClick={() => void transfer.importSystemConfig()}>导入</Button></Group></article>
      </div>
    </SettingSection>
    <SettingSection title="当前数据"><div className="database-card"><span className="db-icon">DB</span><div><span className="ui-title">{status?.engine ?? "SQLite"}</span><p>数据库版本 {status?.databaseVersion ?? "—"} · 保存修订 {status?.revision ?? "—"} · 搜索 {status?.searchMode ?? "检测中"}</p></div><span className={status?.connected === false ? "status-warning" : "status-online"}>{status?.connected === false ? "连接失败" : "已连接"}</span><button className="secondary-button" type="button" onClick={() => window.alert(status?.engine?.toLocaleLowerCase().includes("d1") ? "当前 Site 使用云端 D1 数据库。" : "当前使用本机 SQLite 数据库，默认文件位于 data/writer-studio.sqlite。")}>数据位置</button></div></SettingSection>
    <SettingSection title="云端同步">
      <div className="sync-card">
        <div className="sync-card-heading"><div><span className="ui-title">本地与云端数据库</span><p>{syncStatus?.autoUploadEnabled === false && syncStatus.state !== "cloud" ? "自动后台上传已关闭 · " : ""}{syncStatus?.message ?? "正在读取同步状态…"}{syncStatus?.cloudHost ? ` · ${syncStatus.cloudHost}` : ""}</p></div><span className={syncHealthy ? "status-online" : "status-warning"}>{syncStatus?.autoUploadEnabled === false && syncStatus.state !== "cloud" ? "自动上传关闭" : syncHealthy ? "已同步" : syncStatus?.state === "pending" || syncStatus?.state === "uploading" ? "同步中" : "需检查"}</span></div>
        <div className="sync-auto-row"><div><span className="ui-label">本地保存后自动异步复制到云端</span></div><Toggle checked={syncStatus?.autoUploadEnabled ?? true} disabled={syncToggleBusy || syncStatus?.state === "cloud"} onChange={(enabled) => void setAutoUpload(enabled)} /><span className="sync-toggle-busy">{syncToggleBusy ? "保存中…" : ""}</span></div>
        <div className="sync-version-grid"><span>本地版本 <strong>{syncStatus?.localDatabaseVersion ?? status?.databaseVersion ?? "—"}</strong></span><span>云端版本 <strong>{syncStatus?.remoteDatabaseVersion ?? "—"}</strong></span><span>同步基线 <strong>{syncStatus?.lastCloudVersion ?? "—"}</strong></span></div>
        <div className="sync-overwrite-options"><span className="ui-label">手动覆盖范围</span><Checkbox checked={overwriteModels} onChange={(event) => { const checked = event.currentTarget.checked; setOverwriteModels(checked); if (!checked) setOverwriteSecrets(false); }} label="同时覆盖大模型配置" /><Checkbox checked={overwriteSecrets} disabled={!overwriteModels} onChange={(event) => setOverwriteSecrets(event.currentTarget.checked)} label="同时覆盖 API Key / Secret（敏感信息）" /><p>未选择 API Key 时，会保留目标端相同模型 ID 的密钥；目标端多余模型会随模型配置覆盖而删除。</p></div>
        {syncNotice && <div className={syncNotice.includes("完成") || syncNotice.includes("已用") ? "sync-notice success" : "sync-notice error"} role="status">{syncNotice}</div>}
        <Group gap="sm" className="sync-actions">
          <Button color="red" variant="light" disabled={Boolean(syncBlocked) || Boolean(syncBusy)} loading={syncBusy === "pull"} onClick={() => void replaceDatabase("pull")}>从云端取回</Button>
          <Button color="red" variant="light" disabled={Boolean(syncBlocked) || Boolean(syncBusy)} loading={syncBusy === "push"} onClick={() => void replaceDatabase("push")}>复制到云端</Button>
          <Button variant="default" disabled={Boolean(syncBusy)} onClick={() => void loadSyncStatus()}>刷新状态</Button>
        </Group>
        <p className="sync-footnote">覆盖前快照保存在本机 data/recovery。选择模型覆盖时，备份会包含目标端现有 API Key；同步密钥始终不会被复制。</p>
      </div>
    </SettingSection>
    <SettingSection title="维护"><SettingRow title="数据完整性检查"><button className="secondary-button" type="button" disabled={checking} onClick={() => void check()}>{checking ? "正在检查…" : "开始检查"}</button></SettingRow></SettingSection>
    <SettingSection title="危险操作"><SettingRow title="清除全部业务数据"><button className="danger-button" type="button" onClick={() => { const confirmText = window.prompt("输入 CLEAR 确认清除全部文章、正文、版本、人物、聊天和 AI 任务"); if (confirmText === "CLEAR") void studio.clearBusinessData(); }}>清除全部业务数据</button></SettingRow></SettingSection>
  </>;
}

export async function fetchManagedServiceStatus() {
  const response = await fetchFromServer("/api/system/service", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as Partial<ManagedServiceStatusResponse> & { message?: string };
  if (!response.ok || payload.ok !== true || !payload.service) {
    throw new Error(payload.message || "无法读取服务管理状态");
  }
  return payload as ManagedServiceStatusResponse;
}

export function SystemSettings() {
  const studio = useStudio();
  const [serviceStatus, setServiceStatus] = useState<ManagedServiceStatus | null>(null);
  const [serviceError, setServiceError] = useState("");
  const [statusLoading, setStatusLoading] = useState(true);
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [restartPhase, setRestartPhase] = useState<"idle" | "requesting" | "waiting" | "success" | "error">("idle");
  const [restartNotice, setRestartNotice] = useState("");
  const restartActive = restartPhase === "requesting" || restartPhase === "waiting";

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await fetchManagedServiceStatus();
        if (cancelled) return;
        setServiceStatus(status);
        setServiceError("");
      } catch (error) {
        if (cancelled) return;
        setServiceStatus(null);
        setServiceError(error instanceof Error ? error.message : "无法读取服务管理状态");
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const canRestart = Boolean(
    serviceStatus?.service.managed
    && serviceStatus.service.state === "running"
    && serviceStatus.operation === "idle"
    && !restartActive,
  );
  const serviceLabel = statusLoading
    ? "正在检测…"
    : serviceStatus?.service.state === "running"
      ? serviceStatus.service.managed ? "运行正常" : "运行正常 · 非托管"
      : serviceStatus?.service.state === "starting"
        ? "正在启动"
        : serviceStatus?.service.state === "external"
          ? "运行正常 · 非托管"
          : serviceStatus ? "服务异常" : "运行正常 · 管理器未连接";
  const serviceHealthy = serviceStatus?.service.state === "running" && serviceStatus.service.managed;
  const restartUnavailableReason = serviceError
    || (!serviceStatus?.service.managed ? "请使用服务管理器启动 Writer Studio 后再重启" : "服务端当前不可重启");

  async function restartService() {
    setRestartDialogOpen(false);
    setRestartPhase("requesting");
    setRestartNotice("正在提交重启请求…");
    try {
      const response = await fetchServerAction("/api/system/service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; previousStartedAt?: string | null };
      if (!response.ok || payload.ok !== true) throw new Error(payload.message || "服务端未接受重启请求");

      const previousStartedAt = payload.previousStartedAt ?? serviceStatus?.service.startedAt ?? null;
      const deadline = Date.now() + 5 * 60_000;
      setRestartPhase("waiting");
      setRestartNotice("服务端正在重新构建并重启，恢复后会自动更新状态…");
      while (Date.now() < deadline) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 900));
        let latest: ManagedServiceStatus;
        try {
          latest = await fetchManagedServiceStatus();
        } catch {
          // A short connection failure is expected while the managed process restarts.
          continue;
        }
        setServiceStatus(latest);
        setServiceError("");
        if (latest.operation === "idle" && latest.service.lastError) throw new Error(latest.service.lastError);
        const startedAgain = latest.service.startedAt && latest.service.startedAt !== previousStartedAt;
        if (latest.service.state === "running" && latest.service.managed && startedAgain) {
          setRestartPhase("success");
          setRestartNotice("服务端已完成重启，可以继续使用。");
          return;
        }
      }
      throw new Error("等待服务端恢复超时，请检查 3003 服务管理器状态");
    } catch (error) {
      setRestartPhase("error");
      setRestartNotice(error instanceof Error ? error.message : "服务端重启失败");
    }
  }

  return <>
    <SettingSection title="运行状态">
      <SettingRow title="应用版本"><span className="readonly-value">Writer Studio 2.1.0</span></SettingRow>
      <SettingRow title="本地服务"><span className={serviceHealthy ? "status-online" : "status-warning"}>{serviceLabel}</span></SettingRow>
      <SettingRow title="最近错误"><span className="readonly-value">{serviceStatus?.service.lastError || serviceError || "暂无错误"}</span></SettingRow>
    </SettingSection>
    <SettingSection title="服务控制">
      <SettingRow title="重启服务端">
        <div className="service-control-action">
          <button className="secondary-button" type="button" disabled={!canRestart} title={canRestart ? undefined : restartUnavailableReason} onClick={() => setRestartDialogOpen(true)}>{restartActive ? "正在重启…" : "重启服务端"}</button>
          {!canRestart && !restartActive && <small>{restartUnavailableReason}</small>}
          {restartNotice && <span className={`service-restart-notice ${restartPhase}`} role="status">{restartNotice}</span>}
        </div>
      </SettingRow>
    </SettingSection>
    <SettingSection title="诊断">
      <SettingRow title="脱敏诊断信息"><button className="secondary-button" type="button" onClick={() => void copyTextToClipboard(JSON.stringify({ version: "2.1.0-poc", articles: studio.data.articles.length, tasks: studio.data.tasks.map((task) => task.state), service: serviceStatus ? { managed: serviceStatus.service.managed, state: serviceStatus.service.state, startedAt: serviceStatus.service.startedAt } : { managed: false, state: "manager-unavailable" }, browser: navigator.userAgent }, null, 2))}>复制诊断信息</button></SettingRow>
      <SettingRow title="非业务缓存"><button className="secondary-button" type="button" onClick={() => window.alert("非业务缓存已清除，创作数据未受影响。")}>清除缓存</button></SettingRow>
    </SettingSection>
    <ResponsiveModal opened={restartDialogOpen} onClose={() => setRestartDialogOpen(false)} closeButtonProps={{ "aria-label": "取消重启服务端" }} title="重启服务端？" size="sm">
      <Stack gap="md">
        <Text size="sm">Writer Studio 会短暂断开连接并自动等待恢复。已保存的数据不会受影响。</Text>
        <Alert color="yellow">正在执行的 AI 生成、检查或同步请求可能会被中断。</Alert>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => setRestartDialogOpen(false)}>取消</Button>
          <Button color="red" onClick={() => void restartService()}>确认重启</Button>
        </Group>
      </Stack>
    </ResponsiveModal>
  </>;
}

export function VersionSettingSnapshotView({ snapshot }: { snapshot: ResolvedChapterSettings }) {
  const storyLabels: Array<[keyof ResolvedChapterSettings["story"], string]> = [
    ["summary", "简介"], ["location", "地点"], ["style", "风格"], ["negativeConstraints", "负面约束"],
  ];
  const visibleCharacters = snapshot.characters.filter((person) => !person.archived && person.appears !== false);
  const names = new Map(snapshot.characters.map((person) => [person.id, person.name]));
  return <details className="version-setting-snapshot">
    <summary>生成时采用的设定</summary>
    <div className="version-setting-snapshot-body">
      <section><h4>故事</h4>{storyLabels.filter(([key]) => snapshot.story[key]?.trim()).map(([key, label]) => <p key={key}><strong>{label}</strong><span>{snapshot.story[key]}</span></p>)}</section>
      {visibleCharacters.length > 0 && <section><h4>人物</h4>{visibleCharacters.map((person) => <details key={person.id}><summary>{person.name}</summary>{CHARACTER_PROFILE_KEYS.filter((key) => person.profile[key]?.trim()).map((key) => <p key={key}><strong>{CHARACTER_LABELS[key].label}</strong><span>{person.profile[key]}</span></p>)}</details>)}</section>}
      {snapshot.relationships.filter((item) => item.active).length > 0 && <section><h4>关系</h4>{snapshot.relationships.filter((item) => item.active).map((item) => <p key={item.id}><strong>{names.get(item.characterAId) ?? "未知"} ↔ {names.get(item.characterBId) ?? "未知"}</strong><span>{item.description}</span></p>)}</section>}
    </div>
  </details>;
}
