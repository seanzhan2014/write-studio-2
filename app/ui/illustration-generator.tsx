"use client";

import { Alert, Badge, Button, Card, Group, Select, Stack, Tabs, Text, Textarea, TextInput } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { supportsText, supportsImages, imageParameterValues, imageReferenceCapability, type ModelMetadata } from "@/lib/ai-model-capabilities";
import { characterPhotos } from "@/lib/character-photos";
import { CharacterReferenceSummary } from "./character-visual";
import { resolveOutlineSettings } from "@/lib/story-settings";
import { isSpicyApi } from "@/lib/spicy-api";
import { isCivitai } from "@/lib/civitai-api";
import { fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { modelSelectionLabel } from "@/lib/model-label";
import { MAX_ILLUSTRATION_CONTENT, MAX_ILLUSTRATION_EXCERPT, MAX_ILLUSTRATION_PROMPT, MAX_ILLUSTRATION_NEGATIVE_PROMPT, type IllustrationImage } from "@/lib/image-generation";
import { illustrationIsActive, illustrationStatusLabels, type IllustrationRecord } from "@/lib/illustration-history";
import { useStudio } from "@/app/studio-state";
import { normalizeIllustrationStyles, resolveIllustrationStyle, isIllustrationStylePreset } from "@/lib/illustration-styles";
import { MAX_ILLUSTRATION_ADDITIONAL_PROMPT, PROMPT_LANGUAGE_OPTIONS, normalizeIllustrationOptions, supportedIllustrationResolution, type IllustrationOptions } from "@/lib/illustration-options";
import { AiSettingsInheritance } from "./ai-settings-inheritance";
import { overrideAiSettings, resolveAiSettings } from "@/lib/ai-settings-inheritance";
import { TaskParameterSettings } from "./task-parameter-settings";

type Model = { adapterKind?: string; baseUrl?: string; metadata?: ModelMetadata; id: string; name: string; modelId: string; providerId?: string; providerName: string; hasSecret: boolean };
type Props = { outlineId: string; content: string; selectedExcerpt: string; defaultModel: string; defaultImageModel?: string; initialTab?: string; onClose: () => void };

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function IllustrationGenerator({ outlineId, content, selectedExcerpt, defaultModel, defaultImageModel, initialTab = "generate", onClose }: Props) {
  const studio = useStudio();
  const outline = studio.currentArticle.chapters.flatMap(chapter => chapter.outlines).find(outline => outline.id === outlineId);
  const inheritedOptions = normalizeIllustrationOptions(studio.currentArticle.illustrationSettings);
  const illustrationOptions = resolveAiSettings(studio.currentArticle, outlineId, "illustration").value;
  const styles = normalizeIllustrationStyles(studio.data.settings.illustrationStyles);
  const { promptLanguage, additionalPrompt } = illustrationOptions;
  const stylePreset = resolveIllustrationStyle(illustrationOptions.stylePreset, styles).value;
  function rememberOptions(patch: Partial<IllustrationOptions>) {
    studio.updateOutline(outlineId, { illustrationOptions: normalizeIllustrationOptions(overrideAiSettings(illustrationOptions, patch), inheritedOptions) });
  }
  function rememberModel(key: "illustrationPromptModel" | "illustrationImageModel", model: string) {
    const current = resolveAiSettings(studio.currentArticle, outlineId, "generate", "outline", studio.data.settings).value;
    studio.updateOutline(outlineId, { generateOptions: overrideAiSettings(current, { tasks: { ...current.tasks, [key]: model } }) });
  }
  const [models, setModels] = useState<Model[]>([]);
  const [modelError, setModelError] = useState("");
  const [refreshingCapabilities, setRefreshingCapabilities] = useState(false);
  const [textModel, setTextModel] = useState(defaultModel);
  const [imageModel, setImageModel] = useState(defaultImageModel ?? "");
  const [characterId, setCharacterId] = useState("");
  const quality = illustrationOptions.quality ?? "";
  const setQuality = (quality: string) => rememberOptions({ quality });
  const aspectRatio = illustrationOptions.aspectRatio ?? "";
  const [excerptDraft, setExcerptDraft] = useState({ source: selectedExcerpt, content, value: selectedExcerpt });
  const excerpt = excerptDraft.source === selectedExcerpt && excerptDraft.content === content ? excerptDraft.value : selectedExcerpt;
  const setExcerpt = useCallback((value: string) => setExcerptDraft({ source: selectedExcerpt, content, value }), [selectedExcerpt, content]);
  const style = illustrationOptions.scenePrompt ?? "";
  const setStyle = (scenePrompt: string) => rememberOptions({ scenePrompt });
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [image, setImage] = useState<IllustrationImage | null>(null);
  const [busy, setBusy] = useState<"prompt" | "image" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<string | null>(initialTab === "prompts" ? "prompts" : "images");
  const formRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLElement>(null);
  const [records, setRecords] = useState<IllustrationRecord[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState<"app" | "service" | null>(null);
  const [search, setSearch] = useState("");
  const [archiveFilter, setArchiveFilter] = useState("active");
  const [mutation, setMutation] = useState("");
  const [pendingDelete, setPendingDelete] = useState("");
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const latestJob = useRef<{ id: string; action: "prompt" | "image" } | null>(null);
  const lastSubmittedTaskId = useRef("");
  const loadedCount = useRef(100);
  const historyRequest = useRef(0);

  const loadHistory = useCallback(async (more = false) => {
    const requestId = ++historyRequest.current;
    try {
      const limit = more ? loadedCount.current + 100 : loadedCount.current;
      const all: IllustrationRecord[] = [];
      let moreAvailable = false;
      for (let offset = 0; offset < limit; offset += 100) {
        const response = await fetchFromServer(`/api/ai/illustrations?outlineId=${encodeURIComponent(outlineId)}&offset=${offset}`, { cache: "no-store" });
        const payload = await response.json() as { records: IllustrationRecord[]; hasMore: boolean; backgroundMode?: "app" | "service"; error?: string };
        if (!response.ok) throw new Error(payload.error || "无法读取插图历史");
        all.push(...payload.records); moreAvailable = payload.hasMore;
        if (payload.backgroundMode) setBackgroundMode(payload.backgroundMode);
        if (!moreAvailable) break;
      }
      if (requestId !== historyRequest.current) return;
      loadedCount.current = limit;
      setRecords(all); setHasMore(moreAvailable); setHistoryError("");
      const completed = all.find(record => record.id === latestJob.current?.id);
      if (completed && !illustrationIsActive(completed)) {
        latestJob.current = null; setBusy(null);
        if (completed.status === "success") {
          if (completed.kind === "prompt") { setPrompt(completed.prompt); setNegativePrompt(completed.negativePrompt ?? ""); setExcerpt(content.includes(completed.excerpt) ? completed.excerpt : ""); setSelectedPrompt(completed.id); }
          else if (completed.src) setImage({ src: completed.src, revisedPrompt: completed.revisedPrompt });
          setNotice(completed.kind === "prompt" ? "Prompt 已生成并自动保存到历史。" : "插图已自动保存，可在插图历史中查看或下载。");
        } else if (completed.status === "error") setError(completed.error || "插图生成失败，可在 AI 任务中重新执行");
        else setNotice("任务已取消");
      }
    } catch (cause) { if (requestId === historyRequest.current) setHistoryError(cause instanceof Error ? cause.message : "无法读取插图历史"); }
    finally { if (requestId === historyRequest.current) setHistoryLoading(false); }
  }, [outlineId, setExcerpt, content]);

  useEffect(() => {
    const requests = historyRequest;
    loadedCount.current = 100;
    const refresh = () => { void loadHistory(); };
    refresh();
    const timer = setInterval(refresh, 4000);
    window.addEventListener("illustrations-updated", refresh);
    return () => { clearInterval(timer); requests.current++; window.removeEventListener("illustrations-updated", refresh); };
  }, [loadHistory]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchFromServer("/api/models", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("无法读取模型配置");
      const payload = await response.json() as { models: Model[] };
      if (controller.signal.aborted) return;
      setModels(payload.models);
      const preferred = payload.models.find((model) => model.id === defaultModel || model.name === defaultModel || modelSelectionLabel(model) === defaultModel);
      setTextModel(preferred && supportsText(preferred) ? preferred.id : "");
      setImageModel(payload.models.find((model) => model.id === defaultImageModel && supportsImages(model))?.id ?? "");
    }).catch((cause) => { if (!controller.signal.aborted) setModelError(cause instanceof Error ? cause.message : "无法读取模型配置"); });
    return () => { controller.abort(); };
  }, [defaultModel, defaultImageModel]);

  const options = (items: Model[]) => items.map((model) => ({ value: model.id, label: `${modelSelectionLabel(model)}${model.hasSecret ? "" : "（需密钥）"}`, disabled: !model.hasSecret }));
  const imageRecord = models.find((model) => model.id === imageModel);
  const visualCharacters = studio.currentArticle.characters.filter(person => !person.archived && (person.photos ? characterPhotos(person.photos).referenceIds.length > 0 : person.visual));
  const selectedCharacter = visualCharacters.find(person => person.id === characterId);
  const selectedGallery = selectedCharacter?.photos ? characterPhotos(selectedCharacter.photos) : undefined;
  const selectedPhotos = selectedGallery?.photos.filter(p => selectedGallery.referenceIds.includes(p.id) && p.status !== "archived");
  const referenceCount = selectedPhotos?.length ?? selectedCharacter?.visual?.images.length ?? 0;
  const resolvedCharacter = selectedCharacter ? resolveOutlineSettings(studio.currentArticle, outlineId).characters.find(person => person.id === selectedCharacter.id) : undefined;
  const referenceCapability = imageReferenceCapability(imageRecord);
  const referenceIssue = characterId ? !selectedCharacter ? "人物形象已解除绑定，请重新选择人物。"
    : !imageRecord || (!selectedPhotos && (!isSpicyApi(imageRecord) || imageRecord.providerId !== selectedCharacter.visual?.providerId)) ? "请选择与人物形象使用同一图像服务连接的图片模型。"
    : !referenceCapability ? "此模型未配置参考图能力，请刷新服务商模型目录并选择支持参考图的模型。"
    : referenceCapability.maxImages && referenceCount > referenceCapability.maxImages ? `此模型最多支持 ${referenceCapability.maxImages} 张参考图，请在人物资料中减少参考图。` : ""
    : referenceCapability?.required ? "此模型需要参考图，请先选择已绑定形象的人物。" : "";
  const sizes = imageRecord ? imageParameterValues(imageRecord, "size").filter((value) => /^\d+x\d+$/.test(value)) : [];
  const qualities = imageRecord ? imageParameterValues(imageRecord, "quality") : [];
  const taskImageService = Boolean(imageRecord && (isSpicyApi(imageRecord) || isCivitai(imageRecord)));
  const nativeImageOptions = taskImageService || imageRecord?.adapterKind === "openrouter" || imageRecord?.baseUrl?.startsWith("https://openrouter.ai/");
  const ratios = imageRecord && nativeImageOptions ? imageParameterValues(imageRecord, "aspect_ratio") : [];
  const resolutions = imageRecord && nativeImageOptions ? imageParameterValues(imageRecord, "resolution") : [];
  const size = supportedIllustrationResolution(illustrationOptions.resolution, sizes);
  const resolution = size ? "" : supportedIllustrationResolution(illustrationOptions.resolution, resolutions);
  const unsupportedResolution = Boolean(imageRecord && illustrationOptions.resolution && !size && !resolution);
  const excerptValid = !excerpt.trim() || (content.includes(excerpt.trim()) && excerpt.trim().length <= MAX_ILLUSTRATION_EXCERPT);

  async function refreshCapabilities() {
    const providerId = selectedCharacter?.visual?.providerId ?? imageRecord?.providerId;
    if (!providerId) return;
    setRefreshingCapabilities(true); setError("");
    try {
      const response = await fetchServerAction(`/api/providers/${encodeURIComponent(providerId)}/discover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "无法刷新模型能力");
      setModels(items => items.map(model => {
        const entry = model.providerId === providerId ? data.catalog.find((entry: { id: string }) => entry.id === model.modelId) : undefined;
        return entry ? { ...model, metadata: entry.metadata } : model;
      }));
      setNotice("本窗口已读取最新模型能力。需要其他参考图模型时，请在“设置 → AI 服务”添加。请重新选择图片模型。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "刷新失败"); }
    finally { setRefreshingCapabilities(false); }
  }

  async function generate(action: "prompt" | "image") {
    if (busy) return;
    setBusy(action); setError(""); setNotice("");
    try {
      // Refreshing the task list requires a clean save baseline. Persist a
      // just-changed preset before creating work for the shared task runner.
      if (!await studio.saveNow()) throw new Error("请先完成设置保存，再生成插图");
      const requestId = createRequestId();
      const response = await fetchServerAction("/api/ai/illustrations", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
        body: JSON.stringify(action === "prompt"
          ? { action, background: true, outlineId, content: excerpt.trim() || content, excerpt: excerpt.trim(), style, stylePreset, promptLanguage, additionalPrompt, model: textModel, ...(characterId ? { characterId } : {}) }
          : { action, background: true, outlineId, prompt, negativePrompt, excerpt: excerptValid ? excerpt : "", style, stylePreset, additionalPrompt, model: imageModel, ...(characterId ? { characterId } : {}), ...(size ? { size } : {}), ...(quality ? { quality } : {}), ...(aspectRatio ? { aspectRatio } : {}), ...(resolution ? { resolution } : {}) }),
      });
      const payload = await response.json() as { record: IllustrationRecord; error?: string };
      if (!response.ok) throw new Error(payload.error || "插图生成失败");
      latestJob.current = { id: payload.record.id, action };
      lastSubmittedTaskId.current = payload.record.id;
      setNotice("已加入 AI 任务，可在统一任务列表查看进度、取消或重新执行。结果会自动保存到历史。");
      await studio.refreshFromServer();
      void loadHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "插图生成失败"); setBusy(null);
    }
  }

  function loadPrompt(record: IllustrationRecord) {
    setPrompt(record.prompt);
    setNegativePrompt(record.negativePrompt ?? "");
    rememberOptions({ scenePrompt: record.style, stylePreset: record.stylePreset ?? "auto", ...(record.promptLanguage ? { promptLanguage: record.promptLanguage } : {}), ...(record.additionalPrompt !== undefined ? { additionalPrompt: record.additionalPrompt } : {}) });
    setExcerpt(record.excerpt && content.includes(record.excerpt) ? record.excerpt : "");
    setSelectedPrompt(record.kind === "prompt" ? record.id : null);
    formRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
    setNotice("已载入历史 prompt，可编辑后生成插图。");
    setCharacterId(record.characterReference?.characterId ?? "");
  }

  async function manage(id: string, action: "archive" | "restore" | "delete") {
    if (mutation) return;
    setMutation(id); setError("");
    try {
      const response = await fetchServerAction(`/api/ai/illustrations/${id}`, {
        method: action === "delete" ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" },
        ...(action === "delete" ? {} : { body: JSON.stringify({ action }) }),
      });
      const payload = response.status === 204 ? null : await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload?.error || "历史操作失败");
      if (action === "delete") { setPendingDelete(""); if (image?.src === records.find(record => record.id === id)?.src) setImage(null); if (selectedPrompt === id) setSelectedPrompt(null); }
      await loadHistory();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "历史操作失败"); }
    finally { setMutation(""); }
  }

  async function savePrompt() {
    setMutation("save"); setError("");
    try {
      const response = await fetchServerAction("/api/ai/illustrations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-prompt", outlineId, prompt, negativePrompt, excerpt: excerptValid ? excerpt : "", style, stylePreset, promptLanguage, additionalPrompt, ...(characterId ? { characterId } : {}) }),
      });
      const payload = await response.json() as { record: IllustrationRecord; error?: string };
      if (!response.ok) throw new Error(payload.error || "保存失败");
      setSelectedPrompt(payload.record.id); setNotice("Prompt 已添加到历史。"); await loadHistory();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setMutation(""); }
  }

  const savedPrompts = records.filter(record => record.kind === "prompt" && record.status === "success" && !record.archived);
  const activeTasks = records.filter(illustrationIsActive);
  const visibleRecords = records.filter(record => {
    if (tab === "prompts" && (record.kind !== "prompt" || record.status !== "success" || (archiveFilter !== "all" && record.archived !== (archiveFilter === "archived")))) return false;
    if (tab === "images" && (record.kind !== "image" || record.status !== "success")) return false;
    return !search.trim() || `${record.prompt} ${record.negativePrompt ?? ""} ${record.excerpt} ${record.outlineTitle} ${record.modelName}`.toLowerCase().includes(search.trim().toLowerCase());
  });

  async function copyPrompt(negative = false) {
    try { await navigator.clipboard.writeText(negative ? negativePrompt : prompt); setNotice(negative ? "已复制 Negative Prompt" : "已复制图片 prompt"); }
    catch { setError("复制失败，请在提示词输入框中手动复制"); }
  }

  function openAiTasks() {
    const taskId = latestJob.current?.id || lastSubmittedTaskId.current || activeTasks[0]?.id || "";
    onClose();
    window.dispatchEvent(new CustomEvent("writer-studio-open-task", { detail: taskId }));
  }

  return <div className="generate-view illustration-view" role="region" aria-label="插图工作区">
    <div className="generate-page illustration-generator">
      <header className="generate-page-header illustration-page-header"><div><h2>AI 插图</h2><p>从正文选景、编辑 Prompt，生成和管理当前文章的插图。</p></div><Button variant="default" size="sm" onClick={() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>查看历史</Button></header>
      <Stack gap="md">
      {backgroundMode === "app" && <Text size="xs" c="dimmed">云端生成时请保留应用页面；可以切换到其他工作页签。</Text>}
      {error && <Alert color="red" role="alert">{error}</Alert>}
      {notice && <Text size="sm" role="status">{notice}</Text>}
      {historyError && <Alert color="red">{historyError}<Button variant="subtle" onClick={() => void loadHistory()}>重新读取历史</Button></Alert>}
      <Group justify="space-between"><Text size="sm" role="status">{activeTasks.length ? `${activeTasks.length} 个插图任务正在处理` : "生成任务统一在 AI 任务中管理"}</Text><Button variant="subtle" onClick={openAiTasks}>查看 AI 任务</Button></Group>
      <section ref={formRef} className="generate-command-card illustration-command-card" aria-label="插图生成设置"><Stack gap="md">
      <div className="illustration-source-summary"><Text size="sm" fw={600}>{outline?.title || "当前大纲"}</Text><Text size="xs" c="dimmed">当前正文 · {content.length.toLocaleString("zh-CN")} 字符</Text></div>
      {!content.trim() && <Alert color="yellow">当前大纲暂无正文。你仍可直接输入图片 Prompt 生成插图，或复用历史 Prompt。</Alert>}
      {modelError && <Alert color="red">{modelError}</Alert>}
      {!modelError && models.length === 0 && <Alert color="yellow">请先在“设置 → AI 服务”添加文本模型和文生图模型，并设置 Provider 密钥。</Alert>}
      <Select label="选择历史 prompt" description="归档的 prompt 可在历史中恢复后使用。也可直接在下方输入并保存新 prompt。" placeholder={historyLoading ? "正在读取历史…" : "选择已保存的 prompt"} searchable clearable disabled={Boolean(busy)} value={selectedPrompt} data={savedPrompts.map(record => ({ value: record.id, label: `${record.outlineTitle} · ${record.prompt.slice(0, 65)}` }))} onChange={value => { setSelectedPrompt(value); const record = savedPrompts.find(record => record.id === value); if (record) loadPrompt(record); }} />
      <Select label="提示词模型" placeholder="选择文本模型" data={options(models.filter(supportsText))} value={textModel || null} onChange={(value) => { setTextModel(value ?? ""); rememberModel("illustrationPromptModel", value ?? ""); }} disabled={Boolean(busy)} searchable allowDeselect={false} />
      <Select label="画面人物（可选）" description="使用人物照片中的默认参考，保持人物一致；可在人物资料中调整。" placeholder="使用纯文字描述生成" clearable searchable data={visualCharacters.map(person => ({ value: person.id, label: `${person.name} · ${person.photos ? characterPhotos(person.photos).referenceIds.length : person.visual!.images.length} 张参考图` }))} value={characterId || null} disabled={Boolean(busy)} onChange={value => { setCharacterId(value || ""); const person = visualCharacters.find(person => person.id === value); if (person && (!referenceCapability || !person.photos && imageRecord?.providerId !== person.visual?.providerId)) setImageModel(models.find(model => supportsImages(model) && model.hasSecret && (person.photos || model.providerId === person.visual?.providerId) && imageReferenceCapability(model))?.id || ""); }} />
      {selectedCharacter && <CharacterReferenceSummary reference={{ characterId: selectedCharacter.id, name: selectedCharacter.name, age: resolvedCharacter?.profile.age || "", appearance: resolvedCharacter?.profile.appearance || "", ...(selectedPhotos ? { photos: selectedPhotos } : { visual: selectedCharacter.visual }) }} />}
      {referenceIssue && <Alert color="yellow">{referenceIssue}</Alert>}
      {(selectedCharacter?.visual || imageRecord && isSpicyApi(imageRecord)) && <Button size="xs" variant="subtle" loading={refreshingCapabilities} disabled={Boolean(busy)} onClick={() => void refreshCapabilities()}>刷新参考图模型能力</Button>}
      <Text size="xs" c="dimmed">{outline?.illustrationOptions == null ? "当前使用继承的图片设置" : "图片设置已保存；继承项会随来源更新"}</Text>
      <AiSettingsInheritance kind="illustration" targetId={outlineId} value={illustrationOptions} disabled={Boolean(busy)} onChange={next => studio.updateOutline(outlineId, { illustrationOptions: next })} />
      <TaskParameterSettings level="outline" targetId={outlineId} groups={["插图模型"]} />
      <Select label="生成 Prompt 的语言" description="Prompt 和 Negative Prompt 均使用英文生成；正文片段保留原文。" data={[...PROMPT_LANGUAGE_OPTIONS]} value="en" allowDeselect={false} disabled />
      <Textarea label="正文片段" description="留空由 AI 从当前正文选景；也可粘贴正文中的连续片段（最多 3,000 字符）。" value={excerpt} onChange={(event) => setExcerpt(event.currentTarget.value)} minRows={3} maxRows={7} autosize disabled={Boolean(busy)} error={!excerptValid ? "请输入正文中的连续片段，且不超过 3,000 字符" : undefined} />
      {!excerpt.trim() && content.length > MAX_ILLUSTRATION_CONTENT && <Alert color="yellow">正文较长，请先选取一个片段。</Alert>}
      <Select label="插图风格" description="用于提示词和图片生成；修改风格后可直接重新生成图片。" data={styles.map(({ value, label }) => ({ value, label }))} value={stylePreset} onChange={value => { if (isIllustrationStylePreset(value)) rememberOptions({ stylePreset: value }); }} allowDeselect={false} disabled={Boolean(busy)} searchable />
      <Text size="xs" c="dimmed">{styles.find(item => item.value === stylePreset)?.description}</Text>
      <Textarea label="附加 Prompt" description="默认继承文章图片设定；修改后记住此大纲的设置，可恢复文章图片预设。用于提示词生成和图片生成，留空表示不添加。" placeholder="补充此大纲的图片生成要求" value={additionalPrompt} onChange={event => rememberOptions({ additionalPrompt: event.currentTarget.value })} maxLength={MAX_ILLUSTRATION_ADDITIONAL_PROMPT} minRows={3} maxRows={10} autosize disabled={Boolean(busy)} />
      <Textarea label="画面要求（可选）" description="可补充自定义风格、色调、光线与构图要求。" placeholder="例如：冷色调，逆光，重点表现人物与环境的关系" value={style} onChange={(event) => setStyle(event.currentTarget.value)} maxLength={2000} minRows={2} disabled={Boolean(busy)} />
      <Button loading={busy === "prompt"} disabled={Boolean(busy) || !textModel || !content.trim() || !excerptValid || (!excerpt.trim() && content.length > MAX_ILLUSTRATION_CONTENT)} onClick={() => void generate("prompt")}>{prompt ? "重新生成图片 prompt" : "选景并生成图片 prompt"}</Button>
      <Textarea label="图片 prompt" description="检查人物、场景与构图后，可直接修改，再交给文生图模型。修改后可保存为新的历史记录。" value={prompt} onChange={(event) => { setPrompt(event.currentTarget.value); setSelectedPrompt(null); }} maxLength={MAX_ILLUSTRATION_PROMPT} minRows={5} maxRows={12} autosize disabled={Boolean(busy)} />
      <Textarea label="Negative Prompt（负向提示词）" description="与图片 prompt 一起生成英文内容，可编辑需要排除的元素；生成图片时作为排除要求提交，并随 Prompt 一起保存到历史。" placeholder="text, watermark, blurry, extra limbs, duplicate characters" value={negativePrompt} onChange={event => { setNegativePrompt(event.currentTarget.value); setSelectedPrompt(null); }} maxLength={MAX_ILLUSTRATION_NEGATIVE_PROMPT} minRows={3} maxRows={8} autosize disabled={Boolean(busy)} />
      <Button variant="subtle" disabled={!negativePrompt.trim() || Boolean(busy)} onClick={() => void copyPrompt(true)}>复制 Negative Prompt</Button>
      <Button variant="light" disabled={!prompt.trim() || Boolean(busy) || Boolean(mutation)} loading={mutation === "save"} onClick={() => void savePrompt()}>保存 prompt 到历史</Button>
      <Select label="文生图模型" description="选择支持图片生成的模型，可与提示词模型使用不同的 Provider。" placeholder="选择文生图模型" data={options(models.filter(supportsImages))} value={imageModel || null} onChange={(value) => { setImageModel(value ?? ""); rememberModel("illustrationImageModel", value ?? ""); if (quality || aspectRatio) rememberOptions({ quality: "", aspectRatio: "" }); }} disabled={Boolean(busy)} searchable allowDeselect={false} />
      {taskImageService && <Text size="xs" c="dimmed">图像生成结果会自动保存到插图历史。提交后的远程任务无法取消，停止等待后仍可能产生费用。</Text>}
      {!modelError && models.length > 0 && !models.some(supportsImages) && <Alert color="yellow">尚未配置图像生成模型，请到“设置 → AI 服务”添加或编辑模型能力。</Alert>}
      {unsupportedResolution && <Text size="xs" c="dimmed">当前模型不支持预设分辨率 {illustrationOptions.resolution}，本次使用模型默认值。</Text>}
      {sizes.length > 0 && <Select label="图片尺寸" data={[{ value: "", label: "模型默认" }, ...sizes]} value={size} onChange={(value) => { rememberOptions({ resolution: value ?? "", aspectRatio: "" }); }} disabled={Boolean(busy)} allowDeselect={false} />}
      {ratios.length > 0 && <Select label="画面比例" data={[{ value: "", label: "模型默认" }, ...ratios]} value={aspectRatio} onChange={(value) => { rememberOptions({ aspectRatio: value ?? "", ...(size ? { resolution: "" } : {}) }); }} disabled={Boolean(busy)} allowDeselect={false} />}
      {resolutions.length > 0 && <Select label="图像分辨率" data={[{ value: "", label: "模型默认" }, ...resolutions]} value={resolution} onChange={(value) => rememberOptions({ resolution: value ?? "" })} disabled={Boolean(busy)} allowDeselect={false} />}
      {qualities.length > 0 && <Select label="图片画质" data={[{ value: "", label: "模型默认" }, ...qualities]} value={quality} onChange={(value) => setQuality(value ?? "")} disabled={Boolean(busy)} allowDeselect={false} />}
      <Group grow><Button variant="default" disabled={!prompt || Boolean(busy)} onClick={() => void copyPrompt()}>复制 prompt</Button><Button loading={busy === "image"} disabled={Boolean(busy) || !imageModel || !prompt.trim() || Boolean(referenceIssue)} onClick={() => void generate("image")}>{image ? "重新生成图片" : "生成图片"}</Button></Group>
      {busy && <Group justify="space-between"><Text role="status" size="sm">{busy === "prompt" ? "正在选景并编写提示词…" : "正在生成并保存图片…"}</Text><Button onClick={onClose}>放到后台，继续写作</Button></Group>}
      {image && <figure className="illustration-result">

        <img src={image.src} alt="根据正文片段生成的插图" onError={() => setError("无法读取已保存的插图，请刷新历史后重试")} />
        {image.revisedPrompt && <figcaption>模型采用的提示词：{image.revisedPrompt}</figcaption>}
        <Button component="a" href={`${image.src}?download=1`} download variant="default">下载图片</Button>
      </figure>}
      </Stack></section>
      <section ref={historyRef} className="illustration-history-section" aria-label="生成内容管理">
      <div className="generate-results-title"><div><span>生成内容</span><h3>插图历史</h3></div><Group gap="xs"><Button variant="subtle" size="compact-sm" onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>新建插图</Button><Button variant="subtle" size="compact-sm" onClick={() => void loadHistory()}>刷新历史</Button></Group></div>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
      <Tabs.List><Tabs.Tab value="images">插图历史</Tabs.Tab><Tabs.Tab value="prompts">Prompt 历史</Tabs.Tab></Tabs.List>
      {(["prompts", "images"] as const).map(panel => <Tabs.Panel key={panel} value={panel} pt="md"><Stack gap="md">
        <Text size="sm" c="dimmed">{panel === "prompts" ? "保存和管理当前文章的 prompt，选择一条即可继续生成。" : "当前文章生成的插图会自动保存在这里，可复用 Prompt 或下载图片。"}</Text>
        <TextInput label="搜索历史" placeholder="搜索 prompt、正文片段、来源大纲或模型" value={search} onChange={event => setSearch(event.currentTarget.value)} />
        {panel === "prompts" && <Select label="Prompt 状态" value={archiveFilter} onChange={value => setArchiveFilter(value ?? "active")} allowDeselect={false} data={[{ value: "active", label: "未归档" }, { value: "archived", label: "已归档" }, { value: "all", label: "全部" }]} />}
        <Text size="sm">{historyLoading ? "正在读取历史…" : `${visibleRecords.length} 条记录${hasMore ? "（还有更多）" : ""}`}</Text>
        {!historyLoading && !visibleRecords.length && <Text c="dimmed" size="sm">{search.trim() ? "没有匹配的历史记录。" : "暂无记录。生成结果会自动出现在这里。"}</Text>}
        {visibleRecords.map(record => <Card key={record.id} withBorder padding="md" className="illustration-history-card"><Stack gap="sm">
          <Group justify="space-between"><Text size="sm" fw={600}>{record.kind === "prompt" ? "Prompt" : "插图"} · {record.outlineTitle}</Text><Group gap="xs"><Badge color={record.status === "error" ? "red" : illustrationIsActive(record) ? "blue" : "gray"}>{illustrationStatusLabels[record.status]}</Badge>{record.archived && <Badge color="gray">已归档</Badge>}</Group></Group>
          <Text size="xs" c="dimmed">{new Date(record.createdAt).toLocaleString()} · {record.modelName || "手动添加"}</Text>
          {record.stylePreset && record.stylePreset !== "auto" && <Badge variant="light">{(styles.find(item => item.value === record.stylePreset)?.label ?? "已删除的风格")}</Badge>}
          <CharacterReferenceSummary reference={record.characterReference} />
          {record.src && <a href={record.src} target="_blank" rel="noopener noreferrer"><img className="illustration-history-image" src={record.src} alt="历史插图" loading="lazy" /></a>}
          {record.prompt && <Text size="sm" className="illustration-history-prompt">{record.prompt}</Text>}
          {record.negativePrompt && <div><Text size="xs" fw={600}>Negative Prompt</Text><Text size="sm" className="illustration-history-prompt">{record.negativePrompt}</Text></div>}
          {record.excerpt && <Text size="xs" c="dimmed" lineClamp={3}>正文片段：{record.excerpt}</Text>}
          {record.revisedPrompt && <Text size="xs" c="dimmed">模型采用的提示词：{record.revisedPrompt}</Text>}
          {record.error && <Alert color="red">{record.error}</Alert>}
          <Group gap="xs">
            {record.status === "success" && record.prompt && !record.archived && <Button size="xs" variant="light" disabled={Boolean(busy)} onClick={() => loadPrompt(record)}>使用此 prompt</Button>}
            {record.src && <Button size="xs" component="a" variant="default" href={`${record.src}?download=1`} download>下载图片</Button>}
            {record.kind === "prompt" && record.status === "success" && <Button size="xs" variant="default" disabled={Boolean(mutation)} onClick={() => void manage(record.id, record.archived ? "restore" : "archive")}>{record.archived ? "恢复" : "归档"}</Button>}
            {!illustrationIsActive(record) && <>
              <Button size="xs" variant="subtle" color="red" disabled={Boolean(mutation)} onClick={() => setPendingDelete(record.id)}>删除</Button>
            </>}
          </Group>
          {pendingDelete === record.id && <Group><Text size="sm">{record.kind === "image" ? "删除后将移除图片文件，无法恢复。" : "删除这条历史记录？"}</Text><Button color="red" size="xs" loading={mutation === record.id} onClick={() => void manage(record.id, "delete")}>确认删除</Button><Button size="xs" variant="default" onClick={() => setPendingDelete("")}>保留</Button></Group>}
        </Stack></Card>)}
        {hasMore && <Button variant="default" onClick={() => void loadHistory(true)}>加载更早的历史</Button>}
      </Stack></Tabs.Panel>)}
      </Tabs>
      </section>
      <Button variant="subtle" onClick={onClose}>返回正文</Button>
      </Stack>
    </div>
  </div>;
}
