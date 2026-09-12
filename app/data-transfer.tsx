"use client";

import { Alert, Button, Group, Modal, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { createContext, useContext, useEffect, useState } from "react";
import {
  createTransferEnvelope,
  parseTransferEnvelope,
  portableModels,
  portableProviders,
  transferFilename,
  type ArticleTransferData,
  type ArticlesTransferData,
  type PortableAiModel,
  type PortableAiProvider,
  type SystemConfigTransferData,
  type TransferEnvelope,
} from "@/lib/data-transfer";
import { useStudio, wordCount, type AiTask, type Article, type Outline, type StudioSettings } from "./studio-state";

type StoredProvider = Omit<PortableAiProvider, "hadApiKey"> & { hasSecret: boolean; modelCount: number; createdAt?: string; updatedAt?: string };
type StoredModel = PortableAiModel & { hasSecret: boolean; providerName: string; baseUrl: string; timeoutMs: number; createdAt?: string; updatedAt?: string };

type PendingImport = {
  title: string;
  summary: string[];
  warning: string;
  confirmLabel: string;
  apply: () => Promise<string>;
};

type DataTransferValue = {
  exportOutline: (outline: Outline) => void;
  importOutline: (chapterId: string, afterId?: string) => Promise<void>;
  exportArticle: (article: Article) => void;
  importArticle: () => Promise<void>;
  importAnyArticles: () => Promise<void>;
  exportAllArticles: () => void;
  importAllArticles: () => Promise<void>;
  exportSystemConfig: () => Promise<void>;
  importSystemConfig: () => Promise<void>;
  exportComplete: () => Promise<void>;
};

const DataTransferContext = createContext<DataTransferValue | null>(null);

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function pickJsonFile() {
  return new Promise<TransferEnvelope | null>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) { input.remove(); resolve(null); return; }
      if (file.size > 100 * 1024 * 1024) { input.remove(); reject(new Error("导入文件不能超过 100 MB")); return; }
      try { resolve(parseTransferEnvelope(JSON.parse(await file.text()))); }
      catch (error) { reject(error); }
      finally { input.remove(); }
    }, { once: true });
    input.addEventListener("cancel", () => { input.remove(); resolve(null); }, { once: true });
    input.click();
  });
}

async function loadModels() {
  const response = await fetch("/api/models", { cache: "no-store" });
  const payload = await response.json() as { models?: StoredModel[]; error?: string };
  if (!response.ok || !payload.models) throw new Error(payload.error || "读取 AI 模型配置失败");
  return payload.models;
}

async function loadProviders() {
  const response = await fetch("/api/providers", { cache: "no-store" });
  const payload = await response.json() as { providers?: StoredProvider[]; error?: string };
  if (!response.ok || !payload.providers) throw new Error(payload.error || "读取 AI Provider 配置失败");
  return payload.providers;
}

function articleMetrics(articles: Article[], tasks: AiTask[]) {
  const chapters = articles.reduce((total, article) => total + article.chapters.length, 0);
  const outlines = articles.reduce((total, article) => total + article.chapters.reduce((sum, chapter) => sum + chapter.outlines.length, 0), 0);
  const words = articles.reduce((total, article) => total + article.chapters.reduce((chapterTotal, chapter) => chapterTotal + chapter.outlines.reduce((outlineTotal, outline) => outlineTotal + wordCount(outline.content), 0), 0), 0);
  return [`${articles.length} 篇文章`, `${chapters} 个章节 · ${outlines} 条大纲`, `约 ${words.toLocaleString("zh-CN")} 字正文`, `${tasks.length} 条 AI 任务记录`];
}

async function importProviders(providers: PortableAiProvider[]) {
  const existing = await loadProviders();
  const idMap = new Map<string, string>();
  for (const provider of providers) {
    if (!provider.id || !provider.name?.trim() || !provider.baseUrl?.trim()) throw new Error("AI Provider 配置缺少必要信息");
    const matched = existing.find((candidate) => candidate.id === provider.id);
    const response = await fetch(matched ? `/api/providers/${encodeURIComponent(matched.id)}` : "/api/providers", {
      method: matched ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(!matched ? { id: provider.id } : {}), name: provider.name, adapterKind: provider.adapterKind, baseUrl: provider.baseUrl, timeoutMs: provider.timeoutMs }),
    });
    const imported = await response.json() as StoredProvider & { error?: string };
    if (!response.ok || !imported.id) throw new Error(imported.error || `导入 Provider「${provider.name}」失败`);
    idMap.set(provider.id, imported.id);
    if (!matched) existing.push(imported);
  }
  return idMap;
}

async function importModels(models: PortableAiModel[], providerMap: Map<string, string>) {
  const existing = await loadModels();
  const idMap = new Map<string, string>();
  const nameMap = new Map<string, string>();
  for (const model of models) {
    const providerId = providerMap.get(model.providerId) ?? "";
    if (!model.id || !providerId || !model.name?.trim() || !model.modelId?.trim()) throw new Error("AI 模型配置缺少必要信息");
    const matched = existing.find((candidate) => candidate.providerId === providerId && candidate.modelId === model.modelId);
    const payload = {
      providerId,
      name: model.name,
      modelId: model.modelId,
      systemPrompt: model.systemPrompt,
      reasoningEffort: model.reasoningEffort ?? null,
      temperature: model.temperature,
      maxOutput: model.maxOutput,
      maxInputCharacters: model.maxInputCharacters,
      timeoutOverrideMs: model.timeoutOverrideMs,
    };
    const response = await fetch(matched ? `/api/models/${encodeURIComponent(matched.id)}` : "/api/models", {
      method: matched ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const imported = await response.json() as StoredModel & { error?: string };
    if (!response.ok || !imported.id) throw new Error(imported.error || `导入模型「${model.name}」失败`);
    idMap.set(model.id, imported.id);
    nameMap.set(model.name, imported.id);
    if (!matched) existing.push(imported);
  }
  return { idMap, nameMap };
}

async function importAiConfiguration(providers: PortableAiProvider[], models: PortableAiModel[]) {
  const providerMap = await importProviders(providers);
  return importModels(models, providerMap);
}

function remapSettings(settings: StudioSettings, maps: { idMap: Map<string, string>; nameMap: Map<string, string> }) {
  const reference = (value: string) => maps.idMap.get(value) ?? maps.nameMap.get(value) ?? value;
  return {
    ...settings,
    chatModel: reference(settings.chatModel),
    generateModel: reference(settings.generateModel),
    namingModel: reference(settings.namingModel),
    reviewModel: reference(settings.reviewModel),
  };
}

export function DataTransferProvider({ children }: { children: React.ReactNode }) {
  const studio = useStudio();
  const compact = useMediaQuery("(max-width: 767px)") ?? false;
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "导入文件失败");
  }

  function exportOutline(outline: Outline) {
    downloadJson(createTransferEnvelope("outline", { outline }), transferFilename("outline", outline.title || "未命名大纲"));
    setNotice("大纲已导出，文件中包含正文、版本和 AI Chat");
  }

  async function importOutline(chapterId: string, afterId?: string) {
    try {
      const envelope = await pickJsonFile();
      if (!envelope) return;
      if (envelope.scope !== "outline") throw new Error("请选择“导出大纲”生成的文件");
      const { outline } = envelope.data as { outline: Outline };
      const messages = outline.chat.sessions.reduce((total, session) => total + session.messages.length, 0);
      setError("");
      setPending({
        title: "导入大纲",
        summary: [`${outline.title || "未命名大纲"}`, `${wordCount(outline.content).toLocaleString("zh-CN")} 字正文`, `${outline.versions.length} 个版本 · ${messages} 条聊天消息`],
        warning: "将生成新的大纲和内部 ID，不会覆盖现有内容。",
        confirmLabel: "导入到章节",
        apply: async () => {
          if (!studio.importOutline(chapterId, outline, afterId)) throw new Error("目标章节不存在，导入未完成");
          if (!await studio.saveNow()) throw new Error("大纲已加入当前页面，但保存未完成，请稍后重试");
          return `已导入大纲「${outline.title || "未命名大纲"}」`;
        },
      });
    } catch (reason) { showError(reason); }
  }

  function exportArticle(article: Article) {
    const tasks = studio.data.tasks.filter((task) => task.articleId === article.id);
    downloadJson(createTransferEnvelope("article", { article, tasks }), transferFilename("article", article.title));
    setNotice(`已导出文章「${article.title}」`);
  }

  function queueArticlesImport(data: ArticleTransferData | ArticlesTransferData, title: string) {
    const articles = "article" in data ? [data.article] : data.articles;
    const tasks = data.tasks ?? [];
    setError("");
    setPending({
      title,
      summary: articleMetrics(articles, tasks),
      warning: "所有文章都会作为新文章导入；同名文章会自动添加“导入”后缀，不覆盖现有数据。运行中的旧任务只保留记录，不会继续执行。",
      confirmLabel: articles.length === 1 ? "导入文章" : `导入 ${articles.length} 篇文章`,
      apply: async () => {
        const ids = studio.importArticles(articles, tasks);
        if (!ids.length) throw new Error("文件中没有可导入的文章");
        if (!await studio.saveNow()) throw new Error("文章已加入当前页面，但保存未完成，请稍后重试");
        return `已导入 ${ids.length} 篇文章`;
      },
    });
  }

  async function readArticlesFile(allowBoth: boolean, expected: "article" | "articles") {
    try {
      const envelope = await pickJsonFile();
      if (!envelope) return;
      if (envelope.scope !== expected && !(allowBoth && (envelope.scope === "article" || envelope.scope === "articles"))) {
        throw new Error(expected === "article" ? "请选择单篇文章导出文件" : "请选择“所有文章”导出文件");
      }
      if (envelope.scope === "article") queueArticlesImport(envelope.data as ArticleTransferData, "导入文章");
      else if (envelope.scope === "articles") queueArticlesImport(envelope.data as ArticlesTransferData, "导入所有文章");
    } catch (reason) { showError(reason); }
  }

  function exportAllArticles() {
    downloadJson(createTransferEnvelope("articles", { articles: studio.data.articles, tasks: studio.data.tasks }), transferFilename("articles"));
    setNotice(`已导出全部 ${studio.data.articles.length} 篇文章`);
  }

  async function exportSystemConfig() {
    try {
      const [providers, models] = await Promise.all([loadProviders().then(portableProviders), loadModels().then(portableModels)]);
      downloadJson(createTransferEnvelope("system-config", { settings: studio.data.settings, providers, models }), transferFilename("system-config"));
      setNotice(`已导出系统配置、${providers.length} 个 Provider 和 ${models.length} 个模型，不包含 API Key`);
    } catch (reason) { showError(reason); }
  }

  async function importSystemConfig() {
    try {
      const envelope = await pickJsonFile();
      if (!envelope) return;
      if (envelope.scope !== "system-config") throw new Error("请选择“系统配置”导出文件");
      const data = envelope.data as SystemConfigTransferData;
      const keys = data.providers.filter((provider) => provider.hadApiKey).length;
      setError("");
      setPending({
        title: "导入系统配置",
        summary: [`${data.providers.length} 个 Provider · ${data.models.length} 个模型`, `主题、编辑器、任务和生成设置`, keys ? `${keys} 个 Provider 原来配置过 API Key` : "文件中没有 API Key"],
        warning: "匹配的现有 Provider 会保留 API Key；新 Provider 导入后需要重新输入 API Key。",
        confirmLabel: "导入系统配置",
        apply: async () => {
          const maps = await importAiConfiguration(data.providers, data.models);
          studio.importSettings(remapSettings(data.settings, maps));
          if (!await studio.saveNow()) throw new Error("配置已应用到当前页面，但保存未完成，请稍后重试");
          return `已导入系统配置、${data.providers.length} 个 Provider 和 ${data.models.length} 个模型`;
        },
      });
    } catch (reason) { showError(reason); }
  }

  async function exportComplete() {
    try {
      const [providers, models] = await Promise.all([loadProviders().then(portableProviders), loadModels().then(portableModels)]);
      downloadJson(createTransferEnvelope("complete", { studio: studio.data, providers, models }), transferFilename("complete"));
      setNotice("完整备份已导出，不包含 API Key");
    } catch (reason) { showError(reason); }
  }

  async function confirmImport() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      const message = await pending.apply();
      setPending(null);
      setNotice(message);
    } catch (reason) { showError(reason); }
    finally { setBusy(false); }
  }

  const value: DataTransferValue = {
    exportOutline,
    importOutline,
    exportArticle,
    importArticle: () => readArticlesFile(false, "article"),
    importAnyArticles: () => readArticlesFile(true, "article"),
    exportAllArticles,
    importAllArticles: () => readArticlesFile(false, "articles"),
    exportSystemConfig,
    importSystemConfig,
    exportComplete,
  };

  return <DataTransferContext.Provider value={value}>
    {children}
    <Modal
      opened={Boolean(pending)}
      onClose={() => { if (!busy) setPending(null); }}
      title={pending?.title ?? "确认导入"}
      fullScreen={compact}
      centered={!compact}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      classNames={{ content: "ws-modal-content", header: "ws-modal-header", body: "transfer-import-modal" }}
      overlayProps={{ backgroundOpacity: 0.42, blur: 2 }}
    >
      {pending && <Stack gap="md">
        <div className="transfer-preview-list">{pending.summary.map((item) => <p key={item}>{item}</p>)}</div>
        <Alert color="blue">{pending.warning}</Alert>
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setPending(null)}>取消</Button><Button loading={busy} onClick={() => void confirmImport()}>{pending.confirmLabel}</Button></Group>
      </Stack>}
    </Modal>
    {error && !pending && <div className="toast transfer-toast error" role="alert"><span>!</span>{error}<button type="button" aria-label="关闭错误" onClick={() => setError("")}>×</button></div>}
    {notice && <div className="toast transfer-toast" role="status"><span>✓</span>{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
  </DataTransferContext.Provider>;
}

export function useDataTransfer() {
  const context = useContext(DataTransferContext);
  if (!context) throw new Error("useDataTransfer must be used inside DataTransferProvider");
  return context;
}
