"use client";

import { Button, Checkbox, Group, Select, Stack, Text, TextInput, Textarea } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMemo, useState } from "react";
import { useStudio, type Article, type Character, type Chapter } from "@/app/studio-state";
import {
  CHARACTER_PROFILE_KEYS,
  EMPTY_CHARACTER_PROFILE,
  STORY_FIELD_KEYS,
  countChapterSettingChanges,
  normalizeArticleStorySettings,
  normalizeCharacterProfile,
  normalizeChapterSettings,
  resolveChapterSettings,
  type CharacterProfileKey,
  type ChapterSettings,
  type OverrideScope,
  type SettingSource,
  type StoryFieldKey,
} from "@/lib/story-settings";
import { ScrollableDrawer } from "./overlays";

const STORY_LABELS: Record<StoryFieldKey, { label: string; placeholder: string; rows?: number }> = {
  location: { label: "故事发生地点", placeholder: "主要区域、城市、门派或具体场所", rows: 2 },
  style: { label: "写作风格", placeholder: "语言、叙事视角和表达习惯", rows: 2 },
  negativeConstraints: { label: "负面约束", placeholder: "每行一条明确不能出现的内容", rows: 5 },
};

export const CHARACTER_LABELS: Record<CharacterProfileKey, { label: string; placeholder: string; rows?: number }> = {
  age: { label: "年龄", placeholder: "可填写“不详”或年龄范围" },
  appearance: { label: "外貌", placeholder: "稳定、可识别的外貌特征", rows: 2 },
  immutableTraits: { label: "人物底线", placeholder: "生成和审校必须优先遵守、不能写崩的核心特点", rows: 3 },
};

function cloneSettings(value: unknown) { return structuredClone(normalizeChapterSettings(value)); }
function sourceLabel(source: SettingSource) { return source.kind === "article" ? "来自文章" : source.chapterTitle ? `来自${source.chapterTitle}` : "来自前章"; }

function SectionTabs({ value, onChange }: { value: "story" | "characters" | "relationships"; onChange: (value: "story" | "characters" | "relationships") => void }) {
  return <div className="setting-section-tabs" role="tablist">
    {([["story", "故事"], ["characters", "人物"], ["relationships", "关系"]] as const).map(([key, label]) => <button type="button" role="tab" aria-selected={value === key} className={value === key ? "active" : ""} key={key} onClick={() => onChange(key)}>{label}</button>)}
  </div>;
}

function ScopeSelect({ value, onChange }: { value: OverrideScope; onChange: (value: OverrideScope) => void }) {
  return <select className="setting-scope-select" aria-label="生效范围" value={value} onChange={(event) => onChange(event.target.value as OverrideScope)}><option value="ongoing">从本章起</option><option value="chapter">仅本章</option></select>;
}

function StoryInput({ label, placeholder, rows, value, onChange }: { label: string; placeholder: string; rows?: number; value: string; onChange: (value: string) => void }) {
  return rows
    ? <Textarea autosize minRows={rows} maxRows={12} label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    : <TextInput label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.currentTarget.value)} />;
}

export function ArticleStoryFields({ article }: { article: Article }) {
  const studio = useStudio();
  const story = normalizeArticleStorySettings(article.storySettings);
  function update(key: StoryFieldKey, value: string) {
    if (key === "style") studio.updateArticle({ style: value });
    else studio.updateArticle({ storySettings: { ...story, [key]: value } });
  }
  const values = { style: article.style, ...story };
  return <div className="story-setting-grid">
    {STORY_FIELD_KEYS.map((key) => <StoryInput key={key} {...STORY_LABELS[key]} value={values[key]} onChange={(value) => update(key, value)} />)}
  </div>;
}

function BaseCharacterFields({ character }: { character: Character }) {
  const studio = useStudio();
  const profile = normalizeCharacterProfile(character.profile);
  return <div className="character-setting-fields">
    {CHARACTER_PROFILE_KEYS.map((key) => <StoryInput key={key} {...CHARACTER_LABELS[key]} value={profile[key]} onChange={(value) => studio.updateCharacter(character.id, { profile: { ...profile, [key]: value } })} />)}
    <Textarea autosize minRows={3} maxRows={12} label="人物说明" description="身份、性格、说话方式、能力、当前心理状态和当前已知信息都可以写在这里。" value={character.description} onChange={(event) => studio.updateCharacter(character.id, { description: event.currentTarget.value })} />
  </div>;
}

function ArticleSettingsBody({ article }: { article: Article }) {
  const studio = useStudio();
  const [tab, setTab] = useState<"story" | "characters" | "relationships">("story");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newCharacter, setNewCharacter] = useState({ name: "", aliases: "" });
  const [relation, setRelation] = useState({ a: "", b: "", description: "" });
  const visible = article.characters.filter((person) => !person.archived && `${person.name}${person.aliases.join("")}${person.description}${Object.values(normalizeCharacterProfile(person.profile)).join("")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <>
    <SectionTabs value={tab} onChange={setTab} />
    {tab === "story" && <Stack gap="md"><Textarea autosize minRows={4} maxRows={14} label="简介" description="故事类型、时代背景、世界规则等内容都可以写在这里。" value={article.summary} onChange={(event) => studio.updateArticle({ summary: event.currentTarget.value })} /><ArticleStoryFields article={article} /></Stack>}
    {tab === "characters" && <Stack gap="md">
      <Group align="end" wrap="nowrap"><TextInput className="setting-search" label="查找人物" placeholder="姓名、别名或设定" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /><Button variant="default" onClick={() => setAdding((value) => !value)}>{adding ? "取消" : "新建人物"}</Button></Group>
      {adding && <div className="setting-inline-create"><TextInput label="人名" value={newCharacter.name} onChange={(event) => setNewCharacter({ ...newCharacter, name: event.currentTarget.value })} /><Textarea autosize minRows={2} label="别名" placeholder="逗号或换行分隔" value={newCharacter.aliases} onChange={(event) => setNewCharacter({ ...newCharacter, aliases: event.currentTarget.value })} /><Button disabled={!newCharacter.name.trim()} onClick={() => { studio.addCharacter({ name: newCharacter.name.trim(), aliases: newCharacter.aliases.split(/[，,;；\n]/).map((item) => item.trim()).filter(Boolean), description: "", profile: { ...EMPTY_CHARACTER_PROFILE }, archived: false }); setNewCharacter({ name: "", aliases: "" }); setAdding(false); }}>保存人物</Button></div>}
      {visible.map((character) => <details className="setting-entity" key={character.id}><summary><span><strong>{character.name}</strong><small>{[normalizeCharacterProfile(character.profile).age, character.aliases.join("、")].filter(Boolean).join(" · ") || "尚未填写人物资料"}</small></span></summary><BaseCharacterFields character={character} /></details>)}
      {!visible.length && <Text c="dimmed">没有符合条件的人物。</Text>}
    </Stack>}
    {tab === "relationships" && <Stack gap="md">
      {article.characters.filter((person) => !person.archived).length >= 2 && <div className="setting-inline-create relationship-create"><Select label="人物一" data={article.characters.filter((person) => !person.archived).map((person) => ({ value: person.id, label: person.name }))} value={relation.a} onChange={(value) => setRelation({ ...relation, a: value ?? "" })} /><Select label="人物二" data={article.characters.filter((person) => !person.archived && person.id !== relation.a).map((person) => ({ value: person.id, label: person.name }))} value={relation.b} onChange={(value) => setRelation({ ...relation, b: value ?? "" })} /><Textarea className="full" autosize minRows={2} label="关系" value={relation.description} onChange={(event) => setRelation({ ...relation, description: event.currentTarget.value })} /><Button className="full" disabled={!relation.a || !relation.b || !relation.description.trim()} onClick={() => { studio.addRelationship({ characterAId: relation.a, characterBId: relation.b, description: relation.description.trim() }); setRelation({ a: "", b: "", description: "" }); }}>添加关系</Button></div>}
      {article.relationships.map((item) => { const a = article.characters.find((person) => person.id === item.characterAId); const b = article.characters.find((person) => person.id === item.characterBId); return <div className="setting-relationship-row" key={item.id}><Text fw={600}>{a?.name ?? "未知"} ↔ {b?.name ?? "未知"}</Text><Textarea autosize minRows={2} value={item.description} aria-label={`${a?.name ?? "人物"}与${b?.name ?? "人物"}的关系`} onChange={(event) => studio.updateRelationship(item.id, { description: event.currentTarget.value })} /><Button color="red" variant="subtle" size="compact-sm" onClick={() => studio.deleteRelationship(item.id)}>删除</Button></div>; })}
      {!article.relationships.length && <Text c="dimmed">尚未建立人物关系。</Text>}
    </Stack>}
  </>;
}

export function ArticleSettingsDrawer({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  return <ScrollableDrawer opened={opened} onClose={onClose} position={compact ? "bottom" : "right"} size={compact ? "100%" : 600} title="文章设定" closeButtonProps={{ "aria-label": "关闭文章设定" }} classNames={{ content: "story-settings-drawer", body: "story-settings-drawer-body" }}>
    <ArticleSettingsBody article={studio.currentArticle} />
  </ScrollableDrawer>;
}

function inheritedCharacterValue(article: Article, chapter: Chapter, characterId: string, key: CharacterProfileKey) {
  const temporary = cloneSettings(chapter.settings);
  delete temporary.characters[characterId];
  const virtual = { ...article, chapters: article.chapters.map((item) => item.id === chapter.id ? { ...item, settings: temporary } : item) };
  return resolveChapterSettings(virtual, chapter.id).characters.find((item) => item.id === characterId)?.profile[key] ?? "";
}

export function ChapterSettingsDrawer({ chapterId, opened = true, onClose }: { chapterId: string; opened?: boolean; onClose: () => void }) {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const chapter = studio.currentArticle.chapters.find((item) => item.id === chapterId);
  const [tab, setTab] = useState<"story" | "characters" | "relationships">("story");
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [query, setQuery] = useState("");
  const [lastChange, setLastChange] = useState<{ settings: ChapterSettings; label: string } | null>(null);
  const resolved = useMemo(() => chapter ? resolveChapterSettings(studio.currentArticle, chapter.id) : null, [studio.currentArticle, chapter]);
  if (!chapter || !resolved) return null;
  const settings = normalizeChapterSettings(chapter.settings);
  const chapterIndex = studio.currentArticle.chapters.filter((item) => !item.archived).findIndex((item) => item.id === chapter.id);
  const futureCount = Math.max(0, studio.currentArticle.chapters.filter((item) => !item.archived).length - chapterIndex - 1);
  const changeCount = countChapterSettingChanges(settings);

  function commit(next: ChapterSettings, label: string) {
    setLastChange({ settings: cloneSettings(settings), label });
    studio.updateChapter(chapterId, { settings: normalizeChapterSettings(next) });
  }
  function patchStory(key: StoryFieldKey, value: string, nextScope?: OverrideScope) {
    const next = cloneSettings(settings);
    next.story[key] = { value, scope: nextScope ?? next.story[key]?.scope ?? "ongoing" };
    commit(next, STORY_LABELS[key].label);
  }
  function restoreStory(key: StoryFieldKey) { const next = cloneSettings(settings); delete next.story[key]; commit(next, STORY_LABELS[key].label); }
  function patchCharacter(characterId: string, key: CharacterProfileKey, value: string, nextScope?: OverrideScope) {
    const next = cloneSettings(settings); const item = next.characters[characterId] ?? { start: {}, end: {} };
    item.start[key] = { value, scope: nextScope ?? item.start[key]?.scope ?? "ongoing" }; next.characters[characterId] = item;
    commit(next, CHARACTER_LABELS[key].label);
  }
  function restoreCharacter(characterId: string, key: CharacterProfileKey) {
    const next = cloneSettings(settings); const item = next.characters[characterId]; if (!item) return; delete item.start[key]; if (!Object.keys(item.start).length && !Object.keys(item.end).length && !item.appears) delete next.characters[characterId]; commit(next, CHARACTER_LABELS[key].label);
  }
  function patchEnding(characterId: string, key: CharacterProfileKey, value: string | undefined) {
    const next = cloneSettings(settings); const item = next.characters[characterId] ?? { start: {}, end: {} };
    if (value === undefined || !value.trim()) delete item.end[key]; else item.end[key] = value; if (!Object.keys(item.start).length && !Object.keys(item.end).length && !item.appears) delete next.characters[characterId]; else next.characters[characterId] = item; commit(next, `${CHARACTER_LABELS[key].label}章末变化`);
  }
  function patchAppearance(characterId: string, value: string, nextScope?: OverrideScope) {
    const next = cloneSettings(settings); const item = next.characters[characterId] ?? { start: {}, end: {} };
    if (value === "inherit") delete item.appears; else item.appears = { value: value === "yes", scope: nextScope ?? item.appears?.scope ?? "chapter" };
    if (!Object.keys(item.start).length && !Object.keys(item.end).length && !item.appears) delete next.characters[characterId]; else next.characters[characterId] = item; commit(next, "出场状态");
  }

  const visibleCharacters = resolved.characters.filter((person) => !person.archived && `${person.name}${person.aliases.join("")}${Object.values(person.profile).join("")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (!onlyChanges || Boolean(settings.characters[person.id])));
  return <ScrollableDrawer opened={opened} onClose={onClose} position={compact ? "bottom" : "right"} size={compact ? "100%" : 620} title={<div className="chapter-settings-title"><span>{chapter.title}</span><small>{resolved.inheritedFromChapter ? `继承${resolved.inheritedFromChapter.title}` : "继承文章设定"} · 本章修改 {changeCount} 项</small></div>} closeButtonProps={{ "aria-label": "关闭章节设定" }} classNames={{ content: "story-settings-drawer", body: "story-settings-drawer-body" }}>
    <div className="chapter-setting-toolbar"><Checkbox checked={onlyChanges} onChange={(event) => setOnlyChanges(event.currentTarget.checked)} label="只看本章修改" /><Text size="sm" c="dimmed">持续修改会影响后续 {futureCount} 章</Text></div>
    {lastChange && <div className="setting-undo" role="status"><span>已修改“{lastChange.label}”</span><button type="button" onClick={() => { studio.updateChapter(chapter.id, { settings: lastChange.settings }); setLastChange(null); }}>撤销</button></div>}
    <SectionTabs value={tab} onChange={setTab} />
    {tab === "story" && <div className="chapter-setting-fields">{STORY_FIELD_KEYS.filter((key) => !onlyChanges || Boolean(settings.story[key])).map((key) => { const override = settings.story[key]; return <div className={`inherited-setting-field ${override ? "overridden" : ""}`} key={key}><div className="setting-field-meta"><span>{override ? "本章修改" : sourceLabel(resolved.storySources[key])}</span>{override && <><ScopeSelect value={override.scope} onChange={(scope) => patchStory(key, override.value, scope)} /><button type="button" onClick={() => restoreStory(key)}>恢复继承</button></>}</div><StoryInput {...STORY_LABELS[key]} value={override?.value ?? resolved.story[key]} onChange={(value) => patchStory(key, value)} /></div>; })}{onlyChanges && !Object.keys(settings.story).length && <Text c="dimmed">本章没有故事设定修改。</Text>}</div>}
    {tab === "characters" && <Stack gap="md"><TextInput label="查找人物" placeholder="姓名、别名或设定" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />{visibleCharacters.map((person) => { const own = settings.characters[person.id]; const appearanceValue = own?.appears ? own.appears.value ? "yes" : "no" : "inherit"; const timeline = studio.currentArticle.chapters.filter((item) => !item.archived && normalizeChapterSettings(item.settings).characters[person.id]).map((item) => ({ chapter: item, settings: normalizeChapterSettings(item.settings).characters[person.id]! })); return <details className="setting-entity" key={person.id}><summary><span><strong>{person.name}</strong><small>{[person.profile.age, person.aliases.join("、")].filter(Boolean).join(" · ") || (own ? `${Object.keys(own.start).length + Object.keys(own.end).length} 项变化` : "继承人物资料")}</small></span></summary><Stack gap="md"><div className="appearance-setting"><Select label="本章出场" data={[{ value: "inherit", label: "跟随大纲匹配" }, { value: "yes", label: "明确出场" }, { value: "no", label: "明确不出场" }]} value={appearanceValue} onChange={(value) => patchAppearance(person.id, value ?? "inherit")} />{own?.appears && <ScopeSelect value={own.appears.scope} onChange={(scope) => patchAppearance(person.id, appearanceValue, scope)} />}</div>{CHARACTER_PROFILE_KEYS.map((key) => { const override = own?.start[key]; return <div className={`inherited-setting-field ${override ? "overridden" : ""}`} key={key}><div className="setting-field-meta"><span>{override ? "本章章初修改" : sourceLabel(person.profileSources[key])}</span>{override && <><ScopeSelect value={override.scope} onChange={(scope) => patchCharacter(person.id, key, override.value, scope)} /><button type="button" onClick={() => restoreCharacter(person.id, key)}>恢复继承</button></>}</div><StoryInput {...CHARACTER_LABELS[key]} value={override?.value ?? person.profile[key]} onChange={(value) => patchCharacter(person.id, key, value)} /></div>; })}<details className="ending-change-group"><summary>章末变化 <small>供下一章继承</small></summary><Text size="sm" c="dimmed">只填写本章结束后真正发生变化的项目。</Text>{CHARACTER_PROFILE_KEYS.map((key) => <div className="ending-change-field" key={key}><StoryInput {...CHARACTER_LABELS[key]} label={`章末${CHARACTER_LABELS[key].label}`} value={own?.end[key] ?? ""} onChange={(value) => patchEnding(person.id, key, value)} />{Object.prototype.hasOwnProperty.call(own?.end ?? {}, key) && <button type="button" onClick={() => patchEnding(person.id, key, undefined)}>移除变化</button>}</div>)}</details>{timeline.length > 0 && <details className="setting-timeline"><summary>查看变化记录</summary>{timeline.map(({ chapter: item, settings: change }) => <p key={item.id}><strong>{item.title}</strong><span>{[...Object.keys(change.start).map((key) => `${CHARACTER_LABELS[key as CharacterProfileKey].label}（章初）`), ...Object.keys(change.end).map((key) => `${CHARACTER_LABELS[key as CharacterProfileKey].label}（章末）`)].join("、") || "出场状态"}</span></p>)}</details>}</Stack></details>; })}{!visibleCharacters.length && <Text c="dimmed">{onlyChanges ? "本章没有人物设定修改。" : "没有符合条件的人物。"}</Text>}</Stack>}
    {tab === "relationships" && <Stack gap="md">{resolved.relationships.filter((item) => !onlyChanges || Boolean(settings.relationships[item.id])).map((item) => { const a = resolved.characters.find((person) => person.id === item.characterAId); const b = resolved.characters.find((person) => person.id === item.characterBId); const own = settings.relationships[item.id]; const activeValue = own?.active ? own.active.value ? "yes" : "no" : "inherit"; const patchRelationship = (patch: Partial<NonNullable<ChapterSettings["relationships"][string]>>, label: string) => { const next = cloneSettings(settings); const current = next.relationships[item.id] ?? {}; next.relationships[item.id] = { ...current, ...patch }; commit(next, label); }; return <details className="setting-entity" key={item.id}><summary><span><strong>{a?.name ?? "未知"} ↔ {b?.name ?? "未知"}</strong><small>{item.description || "尚未填写关系"}</small></span></summary><Stack gap="md"><div className="appearance-setting"><Select label="关系在本章是否有效" data={[{ value: "inherit", label: "继承" }, { value: "yes", label: "有效" }, { value: "no", label: "暂时无效" }]} value={activeValue} onChange={(value) => { const next = cloneSettings(settings); const current = next.relationships[item.id] ?? {}; if (value === "inherit") delete current.active; else current.active = { value: value === "yes", scope: current.active?.scope ?? "chapter" }; if (!current.start && !current.active && !Object.prototype.hasOwnProperty.call(current, "end")) delete next.relationships[item.id]; else next.relationships[item.id] = current; commit(next, "关系状态"); }} />{own?.active && <ScopeSelect value={own.active.scope} onChange={(scope) => patchRelationship({ active: { ...own.active!, scope } }, "关系状态")} />}</div><div className={`inherited-setting-field ${own?.start ? "overridden" : ""}`}><div className="setting-field-meta"><span>{own?.start ? "本章修改" : sourceLabel(item.source)}</span>{own?.start && <><ScopeSelect value={own.start.scope} onChange={(scope) => patchRelationship({ start: { ...own.start!, scope } }, "人物关系")} /><button type="button" onClick={() => { const next = cloneSettings(settings); const current = next.relationships[item.id]; if (!current) return; delete current.start; if (!current.active && !Object.prototype.hasOwnProperty.call(current, "end")) delete next.relationships[item.id]; commit(next, "人物关系"); }}>恢复继承</button></>}</div><Textarea autosize minRows={3} label="章初关系" value={own?.start?.value ?? item.description} onChange={(event) => patchRelationship({ start: { value: event.currentTarget.value, scope: own?.start?.scope ?? "ongoing" } }, "人物关系")} /></div><div className="ending-change-field"><Textarea autosize minRows={3} label="章末关系变化" placeholder="留空表示本章结束时没有关系变化" value={own?.end ?? ""} onChange={(event) => patchRelationship({ end: event.currentTarget.value }, "章末关系变化")} />{Object.prototype.hasOwnProperty.call(own ?? {}, "end") && <button type="button" onClick={() => { const next = cloneSettings(settings); const current = next.relationships[item.id]; if (!current) return; delete current.end; if (!current.start && !current.active) delete next.relationships[item.id]; commit(next, "章末关系变化"); }}>移除变化</button>}</div></Stack></details>; })}{!resolved.relationships.length && <Text c="dimmed">文章还没有人物关系。</Text>}{onlyChanges && !Object.keys(settings.relationships).length && <Text c="dimmed">本章没有关系修改。</Text>}</Stack>}
  </ScrollableDrawer>;
}
