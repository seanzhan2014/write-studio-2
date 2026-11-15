"use client";

import { useState } from "react";

import { resolvedOutlineContent } from "@/lib/outline-content";
import { outlineDisplayTitle } from "@/lib/outline-title";

import { useStudio } from "@/app/studio-state";

import { PageHeader, Icon, SearchGroup, SearchResult } from "@/app/ui/studio/shared";

export function SearchPage({ onOutline, onCharacter }: { onOutline: (id: string) => void; onCharacter: () => void }) {
  const studio = useStudio();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const outlineResults = normalized ? studio.currentArticle.chapters.flatMap((chapter) => chapter.outlines.map((item) => ({ chapter, item, content: resolvedOutlineContent(item) }))).filter(({ chapter, item, content }) => `${chapter.title}\n${outlineDisplayTitle(item)}\n${item.plan}\n${content}`.toLocaleLowerCase().includes(normalized)) : [];
  const characterResults = normalized ? studio.currentArticle.characters.filter((character) => `${character.name}\n${character.aliases.join(" ")}\n${character.description}`.toLocaleLowerCase().includes(normalized)) : [];
  return (
    <div className="page-scroll"><div className="standard-page search-page">
      <PageHeader eyebrow="当前文章" title={`搜索「${studio.currentArticle.title}」`} />
      <label className="large-search"><Icon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" /></label>
      <div className="search-summary"><span>找到 {outlineResults.length + characterResults.length} 个结果</span></div>
      {studio.currentArticle.chapters.map((chapter) => { const results = outlineResults.filter((result) => result.chapter.id === chapter.id); return results.length ? <SearchGroup title={chapter.title} key={chapter.id}>{results.map(({ item, content }) => { const displayTitle = outlineDisplayTitle(item); return <SearchResult key={item.id} type={displayTitle.toLocaleLowerCase().includes(normalized) || item.plan.toLocaleLowerCase().includes(normalized) ? "大纲" : "正文"} title={displayTitle} snippet={(item.plan.toLocaleLowerCase().includes(normalized) ? item.plan : content).slice(0, 100)} onClick={() => onOutline(item.id)} />; })}</SearchGroup> : null; })}
      {characterResults.length > 0 && <SearchGroup title="人物资料">{characterResults.map((character) => <SearchResult key={character.id} type="人物" title={character.name} snippet={character.description || character.aliases.join("、")} onClick={onCharacter} />)}</SearchGroup>}
      {normalized && outlineResults.length + characterResults.length === 0 && <div className="empty-inline">没有找到相关内容。</div>}
    </div></div>
  );
}
