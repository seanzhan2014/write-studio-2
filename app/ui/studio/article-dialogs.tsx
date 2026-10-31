"use client";

import { useState } from "react";

import { DEFAULT_ARTICLE_COPY_OPTIONS, suggestArticleCopyTitle, type ArticleCopyOptions } from "@/lib/data-transfer";

import { type Article } from "@/app/studio-state";

import { ResponsiveModal } from "@/app/ui/overlays";

export function ArticleCopyDialog({ article, existingTitles, onClose, onCreate }: {
  article: Article;
  existingTitles: string[];
  onClose: () => void;
  onCreate: (options: ArticleCopyOptions) => Promise<boolean>;
}) {
  const [options, setOptions] = useState<ArticleCopyOptions>(() => ({
    ...DEFAULT_ARTICLE_COPY_OPTIONS,
    title: suggestArticleCopyTitle(article.title, existingTitles),
  }));
  const [copying, setCopying] = useState(false);
  function setOption<K extends keyof ArticleCopyOptions>(key: K, value: ArticleCopyOptions[K]) {
    setOptions((current) => ({ ...current, [key]: value }));
  }
  const setStructure = (checked: boolean) => setOptions((current) => ({
    ...current,
    includeStructure: checked,
    ...(checked ? {} : { includeContent: false }),
  }));

  return <ResponsiveModal
    opened
    onClose={() => { if (!copying) onClose(); }}
    closeButtonProps={{ "aria-label": "关闭复制文章" }}
    title="复制文章"
    size="lg"
    classNames={{ body: "article-copy-dialog-body" }}
  >
    <form className="article-copy-form" onSubmit={(event) => {
      event.preventDefault();
      if (!options.title.trim() || copying) return;
      setCopying(true);
      void onCreate({ ...options, title: options.title.trim() }).finally(() => setCopying(false));
    }}>
      <label className="article-copy-title">副本标题 <em>必填</em><input autoFocus value={options.title} onChange={(event) => setOption("title", event.target.value)} required maxLength={120} /></label>
      <div className="article-copy-options">
        <section className="article-copy-option-card">
          <label className="article-copy-check"><input type="checkbox" checked={options.includeStructure} onChange={(event) => setStructure(event.target.checked)} /><span><strong>章节与大纲</strong><small>复制章节、大纲内容和归档状态</small></span></label>
          <fieldset disabled={!options.includeStructure}>
            <legend>章节与大纲名称</legend>
            <label><input type="radio" name="copy-name-versions" checked={options.nameVersions === "default"} onChange={() => setOption("nameVersions", "default")} />仅默认名称</label>
            <label><input type="radio" name="copy-name-versions" checked={options.nameVersions === "all"} onChange={() => setOption("nameVersions", "all")} />全部候选名称</label>
          </fieldset>
        </section>
        <section className={`article-copy-option-card ${options.includeStructure ? "" : "disabled"}`}>
          <label className="article-copy-check"><input type="checkbox" checked={options.includeContent} disabled={!options.includeStructure} onChange={(event) => setOption("includeContent", event.target.checked)} /><span><strong>正文</strong><small>正文依赖对应的章节与大纲</small></span></label>
          <fieldset disabled={!options.includeStructure || !options.includeContent}>
            <legend>正文版本</legend>
            <label><input type="radio" name="copy-content-versions" checked={options.contentVersions === "default"} onChange={() => setOption("contentVersions", "default")} />仅默认正文</label>
            <label><input type="radio" name="copy-content-versions" checked={options.contentVersions === "all"} onChange={() => setOption("contentVersions", "all")} />全部正文版本</label>
          </fieldset>
        </section>
        <label className="article-copy-option-card article-copy-check"><input type="checkbox" checked={options.includeCharacters} onChange={(event) => setOption("includeCharacters", event.target.checked)} /><span><strong>人物资料</strong><small>包含人物档案、章节人物变化和人物关系</small></span></label>
        <label className="article-copy-option-card article-copy-check"><input type="checkbox" checked={options.includeStyle} onChange={(event) => setOption("includeStyle", event.target.checked)} /><span><strong>写作风格</strong><small>保留文章的写作风格设置</small></span></label>
        <label className="article-copy-option-card article-copy-check"><input type="checkbox" checked={options.includeMetadata} onChange={(event) => setOption("includeMetadata", event.target.checked)} /><span><strong>文章资料</strong><small>包含简介、故事发生地点和负面约束</small></span></label>
        <label className="article-copy-option-card article-copy-check"><input type="checkbox" checked={options.includeChat} onChange={(event) => setOption("includeChat", event.target.checked)} /><span><strong>AI 对话记录</strong><small>复制历史消息，不复制未发送草稿</small></span></label>
      </div>
      <p className="article-copy-task-note">AI 任务、执行状态和任务历史不会复制。</p>
      <footer><button className="secondary-button" type="button" disabled={copying} onClick={onClose}>取消</button><button className="primary-compact" type="submit" disabled={!options.title.trim() || copying}>{copying ? "正在创建…" : "创建副本"}</button></footer>
    </form>
  </ResponsiveModal>;
}

export function NewArticleDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (fields: Pick<Article, "title" | "summary" | "type" | "style">) => void }) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [style, setStyle] = useState("");
  return <ResponsiveModal
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭新建文章" }}
    title="新建文章"
    size="md"
    classNames={{ body: "new-article-dialog-body" }}
  >
    <form className="new-article-form" onSubmit={(event) => { event.preventDefault(); onCreate({ title: title.trim(), summary, type: "", style }); }}>
      <label>标题 <em>必填</em><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} /></label>
      <label>简介 <small>故事类型、时代背景、世界规则等内容都可以写在这里。</small><textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={10000} /></label>
      <label>写作风格<input value={style} onChange={(event) => setStyle(event.target.value)} maxLength={5000} /></label>
      <footer><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-compact" type="submit" disabled={!title.trim()}>创建文章</button></footer>
    </form>
  </ResponsiveModal>;
}
