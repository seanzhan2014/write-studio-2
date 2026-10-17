"use client";

import { Alert, Badge, Button, Card, Group, Select, Stack, Tabs, Text, Textarea, TextInput } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { supportsText, supportsImages, imageParameterValues, type ModelMetadata } from "@/lib/ai-model-capabilities";
import { isSpicyApi } from "@/lib/spicy-api";
import { ResponsiveModal } from "./overlays";
import { fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { modelSelectionLabel } from "@/lib/model-label";
import { MAX_ILLUSTRATION_CONTENT, MAX_ILLUSTRATION_EXCERPT, MAX_ILLUSTRATION_PROMPT, type IllustrationImage } from "@/lib/image-generation";
import { illustrationIsActive, illustrationStatusLabels, type IllustrationRecord } from "@/lib/illustration-history";
import { useStudio } from "@/app/studio-state";
import { ILLUSTRATION_STYLES, isIllustrationStylePreset } from "@/lib/illustration-styles";
import { PROMPT_LANGUAGE_OPTIONS, normalizeIllustrationOptions, supportedIllustrationResolution, type IllustrationOptions } from "@/lib/illustration-options";

type Model = { adapterKind?: string; baseUrl?: string; metadata?: ModelMetadata; id: string; name: string; modelId: string; providerName: string; hasSecret: boolean };
type Props = { outlineId: string; content: string; selectedExcerpt: string; defaultModel: string; defaultImageModel?: string; initialTab?: string; onClose: () => void };

export function IllustrationGenerator({ outlineId, content, selectedExcerpt, defaultModel, defaultImageModel, initialTab = "generate", onClose }: Props) {
  const studio = useStudio();
  const outline = studio.currentArticle.chapters.flatMap(chapter => chapter.outlines).find(outline => outline.id === outlineId);
  const inheritedOptions = normalizeIllustrationOptions(studio.currentArticle.illustrationSettings);
  const illustrationOptions = normalizeIllustrationOptions(outline?.illustrationOptions ?? inheritedOptions, inheritedOptions);
  const { promptLanguage, stylePreset } = illustrationOptions;
  function rememberOptions(patch: Partial<IllustrationOptions>) {
    studio.updateOutline(outlineId, { illustrationOptions: normalizeIllustrationOptions({ ...illustrationOptions, ...patch }, inheritedOptions) });
  }
  const [models, setModels] = useState<Model[]>([]);
  const [modelError, setModelError] = useState("");
  const [textModel, setTextModel] = useState(defaultModel);
  const [imageModel, setImageModel] = useState(defaultImageModel ?? "");
  const [quality, setQuality] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [excerpt, setExcerpt] = useState(selectedExcerpt);
  const [style, setStyle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<IllustrationImage | null>(null);
  const [busy, setBusy] = useState<"prompt" | "image" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<string | null>(initialTab);
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
          if (completed.kind === "prompt") { setPrompt(completed.prompt); setExcerpt(completed.excerpt); setSelectedPrompt(completed.id); }
          else if (completed.src) setImage({ src: completed.src, revisedPrompt: completed.revisedPrompt });
          setNotice(completed.kind === "prompt" ? "Prompt 已生成并自动保存到历史。" : "插图已自动保存，可在插图历史中查看或下载。");
        } else if (completed.status === "error") setError(completed.error || "插图生成失败，可在 AI 任务中重新执行");
        else setNotice("任务已取消");
      }
    } catch (cause) { if (requestId === historyRequest.current) setHistoryError(cause instanceof Error ? cause.message : "无法读取插图历史"); }
    finally { if (requestId === historyRequest.current) setHistoryLoading(false); }
  }, [outlineId]);

  useEffect(() => {
    loadedCount.current = 100;
    const refresh = () => { void loadHistory(); };
    refresh();
    const timer = setInterval(refresh, 4000);
    window.addEventListener("illustrations-updated", refresh);
    return () => { clearInterval(timer); historyRequest.current++; window.removeEventListener("illustrations-updated", refresh); };
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
  const sizes = imageRecord ? imageParameterValues(imageRecord, "size").filter((value) => /^\d+x\d+$/.test(value)) : [];
  const qualities = imageRecord ? imageParameterValues(imageRecord, "quality") : [];
  const spicyImage = Boolean(imageRecord && isSpicyApi(imageRecord));
  const nativeImageOptions = spicyImage || imageRecord?.adapterKind === "openrouter" || imageRecord?.baseUrl?.startsWith("https://openrouter.ai/");
  const ratios = imageRecord && nativeImageOptions ? imageParameterValues(imageRecord, "aspect_ratio") : [];
  const resolutions = imageRecord && nativeImageOptions ? imageParameterValues(imageRecord, "resolution") : [];
  const size = supportedIllustrationResolution(illustrationOptions.resolution, sizes);
  const resolution = size ? "" : supportedIllustrationResolution(illustrationOptions.resolution, resolutions);
  const unsupportedResolution = Boolean(imageRecord && illustrationOptions.resolution && !size && !resolution);
  const excerptValid = !excerpt.trim() || (content.includes(excerpt.trim()) && excerpt.trim().length <= MAX_ILLUSTRATION_EXCERPT);

  async function generate(action: "prompt" | "image") {
    if (busy) return;
    setBusy(action); setError(""); setNotice("");
    try {
      // Refreshing the task list requires a clean save baseline. Persist a
      // just-changed preset before creating work for the shared task runner.
      if (!await studio.saveNow()) throw new Error("请先完成设置保存，再生成插图");
      const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      const response = await fetchServerAction("/api/ai/illustrations", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
        body: JSON.stringify(action === "prompt"
          ? { action, background: true, outlineId, content: excerpt.trim() || content, excerpt: excerpt.trim(), style, stylePreset, promptLanguage, model: textModel }
          : { action, background: true, outlineId, prompt, excerpt: excerptValid ? excerpt : "", style, stylePreset, model: imageModel, ...(size ? { size } : {}), ...(quality ? { quality } : {}), ...(aspectRatio ? { aspectRatio } : {}), ...(resolution ? { resolution } : {}) }),
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

  function usePrompt(record: IllustrationRecord) {
    setPrompt(record.prompt); setStyle(record.style);
    rememberOptions({ stylePreset: record.stylePreset ?? "auto", ...(record.promptLanguage ? { promptLanguage: record.promptLanguage } : {}) });
    setExcerpt(record.excerpt && content.includes(record.excerpt) ? record.excerpt : "");
    setSelectedPrompt(record.kind === "prompt" ? record.id : null); setTab("generate");
    setNotice("已载入历史 prompt，可编辑后生成插图。");
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
        body: JSON.stringify({ action: "save-prompt", outlineId, prompt, excerpt: excerptValid ? excerpt : "", style, stylePreset, promptLanguage }),
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
    return !search.trim() || `${record.prompt} ${record.excerpt} ${record.outlineTitle} ${record.modelName}`.toLowerCase().includes(search.trim().toLowerCase());
  });

  async function copyPrompt() {
    try { await navigator.clipboard.writeText(prompt); setNotice("已复制图片 prompt"); }
    catch { setError("复制失败，请在提示词输入框中手动复制"); }
  }

  function openAiTasks() {
    const taskId = latestJob.current?.id || lastSubmittedTaskId.current || activeTasks[0]?.id || "";
    onClose();
    window.dispatchEvent(new CustomEvent("writer-studio-open-task", { detail: taskId }));
  }

  return <ResponsiveModal opened onClose={onClose} title="从正文生成插图" size="lg" closeButtonProps={{ "aria-label": "关闭插图生成" }}>
    <Stack gap="md" className="illustration-generator">
      <Text size="sm" c="dimmed">生成结果自动保存。同一文章内可复用历史 prompt；任务可放到后台，继续写作。</Text>
      {backgroundMode === "app" && <Text size="xs" c="dimmed">云端生成时请保留应用页面；可以关闭此窗口或切换功能。</Text>}
      {error && <Alert color="red" role="alert">{error}</Alert>}
      {notice && <Text size="sm" role="status">{notice}</Text>}
      {historyError && <Alert color="red">{historyError}<Button variant="subtle" onClick={() => void loadHistory()}>重新读取历史</Button></Alert>}
      <Group justify="space-between"><Text size="sm" role="status">{activeTasks.length ? `${activeTasks.length} 个插图任务正在处理` : "生成任务统一在 AI 任务中管理"}</Text><Button variant="subtle" onClick={openAiTasks}>查看 AI 任务</Button></Group>
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
      <Tabs.List grow><Tabs.Tab value="generate">生成</Tabs.Tab><Tabs.Tab value="prompts">Prompt 历史</Tabs.Tab><Tabs.Tab value="images">插图历史</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="generate" pt="md"><Stack gap="md">
      {modelError && <Alert color="red">{modelError}</Alert>}
      {!modelError && models.length === 0 && <Alert color="yellow">请先在“设置 → AI 服务”添加文本模型和文生图模型，并设置 Provider 密钥。</Alert>}
      <Select label="选择历史 prompt" description="归档的 prompt 可在历史中恢复后使用。也可直接在下方输入并保存新 prompt。" placeholder={historyLoading ? "正在读取历史…" : "选择已保存的 prompt"} searchable clearable disabled={Boolean(busy)} value={selectedPrompt} data={savedPrompts.map(record => ({ value: record.id, label: `${record.outlineTitle} · ${record.prompt.slice(0, 65)}` }))} onChange={value => { setSelectedPrompt(value); const record = savedPrompts.find(record => record.id === value); if (record) usePrompt(record); }} />
      <Select label="提示词模型" placeholder="选择文本模型" data={options(models.filter(supportsText))} value={textModel || null} onChange={(value) => setTextModel(value ?? "")} disabled={Boolean(busy)} searchable />
      <Group justify="space-between"><Text size="xs" c="dimmed">{outline?.illustrationOptions == null ? "当前跟随文章图片风格预设" : "当前使用此大纲的最近图片设置"}</Text><Button variant="subtle" size="xs" disabled={Boolean(busy) || outline?.illustrationOptions == null} onClick={() => { studio.updateOutline(outlineId, { illustrationOptions: null }); setNotice("已恢复使用文章图片风格预设。"); }}>恢复文章图片预设</Button></Group>
      <Select label="生成 Prompt 的语言" data={[...PROMPT_LANGUAGE_OPTIONS]} value={promptLanguage} onChange={value => rememberOptions({ promptLanguage: value as IllustrationOptions["promptLanguage"] })} allowDeselect={false} disabled={Boolean(busy)} />
      <Textarea label="正文片段" description="留空由 AI 从当前正文选景；也可粘贴正文中的连续片段（最多 3,000 字符）。" value={excerpt} onChange={(event) => setExcerpt(event.currentTarget.value)} minRows={3} maxRows={7} autosize disabled={Boolean(busy)} error={!excerptValid ? "请输入正文中的连续片段，且不超过 3,000 字符" : undefined} />
      {!excerpt.trim() && content.length > MAX_ILLUSTRATION_CONTENT && <Alert color="yellow">正文较长，请先选取一个片段。</Alert>}
      <Select label="插图风格" description="用于提示词和图片生成；修改风格后可直接重新生成图片。" data={ILLUSTRATION_STYLES.map(({ value, label }) => ({ value, label }))} value={stylePreset} onChange={value => { if (isIllustrationStylePreset(value)) rememberOptions({ stylePreset: value }); }} allowDeselect={false} disabled={Boolean(busy)} searchable />
      <Text size="xs" c="dimmed">{ILLUSTRATION_STYLES.find(item => item.value === stylePreset)?.description}</Text>
      <Textarea label="画面要求（可选）" description="可补充自定义风格、色调、光线与构图要求。" placeholder="例如：冷色调，逆光，重点表现人物与环境的关系" value={style} onChange={(event) => setStyle(event.currentTarget.value)} maxLength={2000} minRows={2} disabled={Boolean(busy)} />
      <Button loading={busy === "prompt"} disabled={Boolean(busy) || !textModel || !excerptValid || (!excerpt.trim() && content.length > MAX_ILLUSTRATION_CONTENT)} onClick={() => void generate("prompt")}>{prompt ? "重新生成图片 prompt" : "选景并生成图片 prompt"}</Button>
      <Textarea label="图片 prompt" description="检查人物、场景与构图后，可直接修改，再交给文生图模型。修改后可保存为新的历史记录。" value={prompt} onChange={(event) => { setPrompt(event.currentTarget.value); setSelectedPrompt(null); }} maxLength={MAX_ILLUSTRATION_PROMPT} minRows={5} maxRows={12} autosize disabled={Boolean(busy)} />
      <Button variant="light" disabled={!prompt.trim() || Boolean(busy) || Boolean(mutation)} loading={mutation === "save"} onClick={() => void savePrompt()}>保存 prompt 到历史</Button>
      <Select label="文生图模型" description="选择支持图片生成的模型，可与提示词模型使用不同的 Provider。" placeholder="选择文生图模型" data={options(models.filter(supportsImages))} value={imageModel || null} onChange={(value) => { setImageModel(value ?? ""); setQuality(""); setAspectRatio(""); }} disabled={Boolean(busy)} searchable />
      {spicyImage && <Text size="xs" c="dimmed">SpicyAPI 图片生成后会自动保存到插图历史。提交后的远程任务无法取消，停止等待后仍可能产生费用。</Text>}
      {!modelError && models.length > 0 && !models.some(supportsImages) && <Alert color="yellow">尚未配置图像生成模型，请到“设置 → AI 服务”添加或编辑模型能力。</Alert>}
      {unsupportedResolution && <Text size="xs" c="dimmed">当前模型不支持预设分辨率 {illustrationOptions.resolution}，本次使用模型默认值。</Text>}
      {sizes.length > 0 && <Select label="图片尺寸" data={[{ value: "", label: "模型默认" }, ...sizes]} value={size} onChange={(value) => { rememberOptions({ resolution: value ?? "" }); setAspectRatio(""); }} disabled={Boolean(busy)} allowDeselect={false} />}
      {ratios.length > 0 && <Select label="画面比例" data={[{ value: "", label: "模型默认" }, ...ratios]} value={aspectRatio} onChange={(value) => { setAspectRatio(value ?? ""); if (size) rememberOptions({ resolution: "" }); }} disabled={Boolean(busy)} allowDeselect={false} />}
      {resolutions.length > 0 && <Select label="图像分辨率" data={[{ value: "", label: "模型默认" }, ...resolutions]} value={resolution} onChange={(value) => rememberOptions({ resolution: value ?? "" })} disabled={Boolean(busy)} allowDeselect={false} />}
      {qualities.length > 0 && <Select label="图片画质" data={[{ value: "", label: "模型默认" }, ...qualities]} value={quality} onChange={(value) => setQuality(value ?? "")} disabled={Boolean(busy)} allowDeselect={false} />}
      <Group grow><Button variant="default" disabled={!prompt || Boolean(busy)} onClick={() => void copyPrompt()}>复制 prompt</Button><Button loading={busy === "image"} disabled={Boolean(busy) || !imageModel || !prompt.trim()} onClick={() => void generate("image")}>{image ? "重新生成图片" : "生成图片"}</Button></Group>
      {busy && <Group justify="space-between"><Text role="status" size="sm">{busy === "prompt" ? "正在选景并编写提示词…" : "正在生成并保存图片…"}</Text><Button onClick={onClose}>放到后台，继续写作</Button></Group>}
      {image && <figure className="illustration-result">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.src} alt="根据正文片段生成的插图" onError={() => setError("无法读取已保存的插图，请刷新历史后重试")} />
        {image.revisedPrompt && <figcaption>模型采用的提示词：{image.revisedPrompt}</figcaption>}
        <Button component="a" href={`${image.src}?download=1`} download variant="default">下载图片</Button>
      </figure>}
      </Stack></Tabs.Panel>
      {(["prompts", "images"] as const).map(panel => <Tabs.Panel key={panel} value={panel} pt="md"><Stack gap="md">
        <Text size="sm" c="dimmed">{panel === "prompts" ? "保存和管理当前文章的 prompt，选择一条即可继续生成。" : "当前文章生成的插图会自动保存在这里，关闭窗口后仍可查看。"}</Text>
        <TextInput label="搜索历史" placeholder="搜索 prompt、正文片段、来源大纲或模型" value={search} onChange={event => setSearch(event.currentTarget.value)} />
        {panel === "prompts" && <Select label="Prompt 状态" value={archiveFilter} onChange={value => setArchiveFilter(value ?? "active")} allowDeselect={false} data={[{ value: "active", label: "未归档" }, { value: "archived", label: "已归档" }, { value: "all", label: "全部" }]} />}
        <Group justify="space-between"><Text size="sm">{historyLoading ? "正在读取历史…" : `${visibleRecords.length} 条记录${hasMore ? "（还有更多）" : ""}`}</Text><Button variant="subtle" onClick={() => void loadHistory()}>刷新历史</Button></Group>
        {!historyLoading && !visibleRecords.length && <Text c="dimmed" size="sm">{search.trim() ? "没有匹配的历史记录。" : "暂无记录。生成结果会自动出现在这里。"}</Text>}
        {visibleRecords.map(record => <Card key={record.id} withBorder padding="md" className="illustration-history-card"><Stack gap="sm">
          <Group justify="space-between"><Text size="sm" fw={600}>{record.kind === "prompt" ? "Prompt" : "插图"} · {record.outlineTitle}</Text><Group gap="xs"><Badge color={record.status === "error" ? "red" : illustrationIsActive(record) ? "blue" : "gray"}>{illustrationStatusLabels[record.status]}</Badge>{record.archived && <Badge color="gray">已归档</Badge>}</Group></Group>
          <Text size="xs" c="dimmed">{new Date(record.createdAt).toLocaleString()} · {record.modelName || "手动添加"}</Text>
          {record.stylePreset && record.stylePreset !== "auto" && <Badge variant="light">{ILLUSTRATION_STYLES.find(item => item.value === record.stylePreset)?.label}</Badge>}
          {record.src && <a href={record.src} target="_blank" rel="noopener noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img className="illustration-history-image" src={record.src} alt="历史插图" loading="lazy" /></a>}
          {record.prompt && <Text size="sm" className="illustration-history-prompt">{record.prompt}</Text>}
          {record.excerpt && <Text size="xs" c="dimmed" lineClamp={3}>正文片段：{record.excerpt}</Text>}
          {record.revisedPrompt && <Text size="xs" c="dimmed">模型采用的提示词：{record.revisedPrompt}</Text>}
          {record.error && <Alert color="red">{record.error}</Alert>}
          <Group gap="xs">
            {record.status === "success" && record.prompt && !record.archived && <Button size="xs" variant="light" disabled={Boolean(busy)} onClick={() => usePrompt(record)}>使用此 prompt</Button>}
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
      <Button variant="subtle" onClick={onClose}>返回正文</Button>
    </Stack>
  </ResponsiveModal>;
}
