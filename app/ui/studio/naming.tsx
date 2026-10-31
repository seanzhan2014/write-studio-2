"use client";

import { AiSettingsInheritance } from "@/app/ui/ai-settings-inheritance";

import { taskReasoningEffort, taskNamingProfile } from "@/lib/task-parameters";
import { resolveAiSettings, overrideAiSettings } from "@/lib/ai-settings-inheritance";

import { ReasoningSettings } from "@/app/ui/reasoning-settings";

import { useState } from "react";

import { selectAiContext } from "@/lib/ai-context";

import { type AiGenerateOptions } from "@/lib/generate-options";

import { normalizeOutlineTitle } from "@/lib/outline-title";

import { fetchServerAction } from "@/lib/browser-network";
import { useStudio, type Chapter } from "@/app/studio-state";

import { ScrollableDrawer } from "@/app/ui/overlays";

import { useConfiguredModels, canonicalModelReference, generateContextSummary, Icon, configuredModelForReference, modelDisplayLabel, namingArticleContext } from "@/app/ui/studio/shared";

import { type NameGeneratePreview, type ConfiguredModel } from "@/app/ui/studio/types";

export function StructureGenerateSheet({ target, onClose, onApplied }: { target: { kind: "outline" | "chapter"; id: string; title: string }; onClose: () => void; onApplied: (message: string, result: string, generatedTitle?: string) => void }) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const [prompt, setPrompt] = useState("");
  const [generated, setGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isChapter = target.kind === "chapter";
  const [result, setResult] = useState("");
  const [generatedSourceText, setGeneratedSourceText] = useState("");
  const [generatedOutlineTitle, setGeneratedOutlineTitle] = useState("");
  const scopedOptions = resolveAiSettings(studio.currentArticle, target.id, "generate", isChapter ? "chapter" : "outline", studio.data.settings).value;
  const selectedModel = scopedOptions.model;
  const reasoningEffort = scopedOptions.reasoningEffort;
  const selectedModelReference = canonicalModelReference(models, selectedModel);
  const targetChapter = studio.currentArticle.chapters.find((chapter) => isChapter ? chapter.id === target.id : chapter.outlines.some((outline) => outline.id === target.id));
  const targetOutline = isChapter ? targetChapter?.outlines.find((outline) => !outline.archived) : targetChapter?.outlines.find((outline) => outline.id === target.id);
  const currentValue = isChapter ? targetChapter?.title ?? target.title : targetOutline?.plan ?? "";
  const contextSummary = targetChapter && targetOutline ? generateContextSummary(studio.currentArticle, targetOutline, prompt, scopedOptions.includePrevious, scopedOptions.includeCharacters, isChapter ? "chapter-title" : "outline") : null;
  function saveScopedOptions(next: AiGenerateOptions) {
    if (isChapter && targetChapter) studio.updateChapter(target.id, { settings: { ...targetChapter.settings!, aiTasks: { ...targetChapter.settings?.aiTasks, generate: next } } });
    else studio.updateOutline(target.id, { generateOptions: next });
  }
  function selectGenerateModel(model: string) {
    saveScopedOptions(overrideAiSettings(scopedOptions, { model }));
    void studio.saveNow();
  }
  async function generate() {
    const outlineId = targetOutline?.id;
    if (!outlineId) { setError("该章节还没有可用大纲"); return; }
    setLoading(true); setError("");
    try {
      const context = selectAiContext({ articles: [studio.currentArticle] }, outlineId, isChapter ? "chapter-title" : "outline", { includePrevious: scopedOptions.includePrevious, includeCharacters: scopedOptions.includeCharacters, instruction: prompt });
      const response = await fetchServerAction("/api/ai/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outlineId, instruction: prompt.trim(), model: selectedModelReference, reasoningEffort, target: isChapter ? "chapter-title" : "outline", includePrevious: scopedOptions.includePrevious, includeCharacters: scopedOptions.includeCharacters, context }) });
      const payload = await response.json() as { text?: string; outlineTitle?: string; error?: string };
      if (!response.ok || !payload.text) throw new Error(payload.error || "生成失败");
      setResult(payload.text);
      setGeneratedSourceText(payload.text.trim());
      setGeneratedOutlineTitle(normalizeOutlineTitle(payload.outlineTitle));
      setGenerated(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "生成失败"); }
    finally { setLoading(false); }
  }
  return <ScrollableDrawer
    opened
    onClose={onClose}
    closeButtonProps={{ "aria-label": "关闭结构生成" }}
    title={<div className="structure-generate-drawer-title"><div className="structure-generate-icon"><Icon name="spark" /></div><div><span className="ui-title">{isChapter ? "生成章节名" : "生成大纲"}</span><small>{target.title}</small></div></div>}
    position="bottom"
    size="auto"
    classNames={{ content: "structure-generate-drawer", body: "structure-generate-sheet structure-generate-drawer-body" }}
  >
    <div className="structure-context"><Icon name="book" /><span className="ui-label">上下文 · {contextSummary?.total.toLocaleString("zh-CN") ?? "—"} 字符</span></div>
    <section className="structure-current"><span className="ui-label">{isChapter ? "当前章节标题" : "当前大纲内容"}</span><p>{currentValue || "（当前内容为空）"}</p></section>
    <div className="structure-request-grid">
      <label className="structure-requirement">生成要求<textarea maxLength={20000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入生成要求" /></label>
      <label className="structure-model">本次模型<select value={selectedModelReference} onChange={(event) => selectGenerateModel(event.target.value)}><option value="">本地演示引擎</option>{selectedModelReference && !configuredModelForReference(models, selectedModelReference) && <option value={selectedModelReference}>{selectedModelReference}</option>}{models.map((model) => <option value={model.id} key={model.id}>{modelDisplayLabel(models, model.id)}{model.hasSecret ? "" : "（需密钥）"}</option>)}</select></label>
      <AiSettingsInheritance kind="generate" targetId={target.id} level={isChapter ? "chapter" : "outline"} value={scopedOptions} onChange={saveScopedOptions} disabled={loading} />
      <div className="structure-reasoning"><ReasoningSettings value={reasoningEffort} modelValue={configuredModelForReference(models, selectedModelReference)?.reasoningEffort} onChange={reasoningEffort => saveScopedOptions(overrideAiSettings(scopedOptions, { reasoningEffort }))} disabled={loading} /></div>
    </div>
    {error && <p className="task-error" role="alert">{error}</p>}
    {generated && <div className="structure-compare"><section><span>当前内容</span><p>{currentValue || "（空）"}</p></section><section><span>生成预览</span>{isChapter ? <input value={result} onChange={(event) => setResult(event.target.value)} /> : <textarea value={result} onChange={(event) => setResult(event.target.value)} />}</section></div>}
    <footer><button className="secondary-button" type="button" onClick={onClose}>取消</button>{generated ? <><button className="secondary-button" type="button" onClick={() => void generate()}>重新生成</button><button className="primary-compact" type="button" disabled={!result.trim()} onClick={() => onApplied(isChapter ? "已应用新的章节标题" : `已应用「${target.title}」的大纲内容`, result.trim(), !isChapter && result.trim() === generatedSourceText ? generatedOutlineTitle : undefined)}>应用结果</button></> : <button className="primary-compact" type="button" disabled={!prompt.trim() || loading} onClick={() => void generate()}><Icon name="spark" />{loading ? "正在生成…" : "生成预览"}</button>}</footer>
  </ScrollableDrawer>;
}

export async function storeNameCandidates(studio: ReturnType<typeof useStudio>, articleId: string, chapterId: string, payload: NameGeneratePreview) {
  if (payload.revision === undefined || payload.added === undefined) throw new Error("名称已经生成，但服务端没有返回保存结果");
  const outlineStates = new Map((payload.outlineStates ?? []).map((item) => [item.id, item]));
  studio.acceptServerMutation(payload.revision, (current) => ({
    ...current,
    articles: current.articles.map((item) => item.id !== articleId ? item : ({
      ...item,
      updatedAt: payload.articleUpdatedAt ?? item.updatedAt,
      chapters: item.chapters.map((candidate) => candidate.id !== chapterId ? candidate : ({
        ...candidate,
        ...(payload.chapterState ?? {}),
        outlines: candidate.outlines.map((currentOutline) => {
          const state = outlineStates.get(currentOutline.id);
          return state ? { ...currentOutline, ...state } : currentOutline;
        }),
      })),
    })),
  }));
  return payload.added;
}

export async function generateWholeChapterNameCandidates(studio: ReturnType<typeof useStudio>, models: ConfiguredModel[], chapter: Chapter) {
  const article = studio.currentArticle;
  const outlines = chapter.outlines.filter((item) => !item.archived && item.plan.trim());
  if (chapter.archived || !outlines.length) throw new Error(`「${chapter.title}」没有可供命名的大纲内容`);
  if (studio.data.tasks.some((task) => task.articleId === article.id && task.target === "全部名称" && (task.state === "waiting" || task.state === "running"))) throw new Error("整篇名称任务正在运行，请完成后再生成本章名称");
  const options = resolveAiSettings(article, chapter.id, "generate", "chapter", studio.data.settings).value;
  const settings = options.tasks!;
  const model = canonicalModelReference(models, String(settings.namingModelMode === "inherit" ? options.model : settings.namingModel));
  const selectedRecord = configuredModelForReference(models, model);
  if (selectedRecord && !selectedRecord.hasSecret) throw new Error("所选模型还没有载入 API 密钥");
  const response = await fetchServerAction("/api/ai/names", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      articleId: article.id,
      chapterId: chapter.id,
      target: "chapter",
      includeChapter: true,
      outlineIds: outlines.map((item) => item.id),
      chapterNaming: taskNamingProfile(settings, "chapterNaming"),
      outlineNaming: taskNamingProfile(settings, "outlineNaming"),
      model,
      reasoningEffort: taskReasoningEffort(settings.namingReasoningEffort),
      modelLabel: modelDisplayLabel(models, model),
      instruction: "",
      context: namingArticleContext(article, studio.data.settings),
      persist: true,
    }),
  });
  const payload = await response.json() as NameGeneratePreview & { error?: string };
  if (!response.ok) throw new Error(payload.error || "整章名称生成失败");
  return storeNameCandidates(studio, article.id, chapter.id, payload);
}
