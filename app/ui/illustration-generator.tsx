"use client";

import { Alert, Button, Group, Select, Stack, Text, Textarea } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { supportsText, supportsImages, imageParameterValues, type ModelMetadata } from "@/lib/ai-model-capabilities";
import { ResponsiveModal } from "./overlays";
import { fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { modelSelectionLabel } from "@/lib/model-label";
import { MAX_ILLUSTRATION_CONTENT, MAX_ILLUSTRATION_EXCERPT, MAX_ILLUSTRATION_PROMPT, type IllustrationImage, type IllustrationPrompt } from "@/lib/image-generation";

type Model = { metadata?: ModelMetadata; id: string; name: string; modelId: string; providerName: string; hasSecret: boolean };
type Props = { outlineId: string; content: string; selectedExcerpt: string; defaultModel: string; defaultImageModel?: string; onClose: () => void };

export function IllustrationGenerator({ outlineId, content, selectedExcerpt, defaultModel, defaultImageModel, onClose }: Props) {
  const [models, setModels] = useState<Model[]>([]);
  const [modelError, setModelError] = useState("");
  const [textModel, setTextModel] = useState(defaultModel);
  const [imageModel, setImageModel] = useState(defaultImageModel ?? "");
  const [size, setSize] = useState("");
  const [quality, setQuality] = useState("");
  const [excerpt, setExcerpt] = useState(selectedExcerpt);
  const [style, setStyle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<IllustrationImage | null>(null);
  const [busy, setBusy] = useState<"prompt" | "image" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

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
    return () => { controller.abort(); controllerRef.current?.abort(); requestIdRef.current += 1; };
  }, [defaultModel, defaultImageModel]);

  const options = (items: Model[]) => items.map((model) => ({ value: model.id, label: `${modelSelectionLabel(model)}${model.hasSecret ? "" : "（需密钥）"}`, disabled: !model.hasSecret }));
  const imageRecord = models.find((model) => model.id === imageModel);
  const sizes = imageRecord ? imageParameterValues(imageRecord, "size").filter((value) => /^\d+x\d+$/.test(value)) : [];
  const qualities = imageRecord ? imageParameterValues(imageRecord, "quality") : [];
  const excerptValid = !excerpt.trim() || (content.includes(excerpt.trim()) && excerpt.trim().length <= MAX_ILLUSTRATION_EXCERPT);

  function cancel() {
    controllerRef.current?.abort();
    requestIdRef.current += 1;
    setBusy(null);
    setNotice("已取消请求");
  }

  async function generate(action: "prompt" | "image") {
    if (controllerRef.current && busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    setBusy(action); setError(""); setNotice("");
    try {
      const response = await fetchServerAction("/api/ai/illustrations", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(action === "prompt"
          ? { action, outlineId, content: excerpt.trim() || content, excerpt: excerpt.trim(), style, model: textModel }
          : { action, outlineId, prompt, model: imageModel, ...(size ? { size } : {}), ...(quality ? { quality } : {}) }),
      });
      const payload = await response.json() as IllustrationPrompt & IllustrationImage & { error?: string };
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) throw new Error(payload.error || "插图生成失败");
      if (action === "prompt") { setExcerpt(payload.excerpt); setPrompt(payload.prompt); }
      else { setImage({ src: payload.src, revisedPrompt: payload.revisedPrompt }); setNotice("图片已生成，请下载保存；关闭窗口后不会保留图片。"); }
    } catch (cause) {
      if (requestId === requestIdRef.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "插图生成失败");
    } finally {
      if (requestId === requestIdRef.current) { setBusy(null); controllerRef.current = null; }
    }
  }

  async function copyPrompt() {
    try { await navigator.clipboard.writeText(prompt); setNotice("已复制图片 prompt"); }
    catch { setError("复制失败，请在提示词输入框中手动复制"); }
  }

  return <ResponsiveModal opened onClose={onClose} title="从正文生成插图" size="lg" closeButtonProps={{ "aria-label": "关闭插图生成" }}>
    <Stack gap="md" className="illustration-generator">
      <Text size="sm" c="dimmed">选取正文片段 → AI 编写图片 prompt → 文生图生成一张插图</Text>
      {modelError && <Alert color="red">{modelError}</Alert>}
      {!modelError && models.length === 0 && <Alert color="yellow">请先在“设置 → AI 服务”添加文本模型和文生图模型，并设置 Provider 密钥。</Alert>}
      <Select label="提示词模型" placeholder="选择文本模型" data={options(models.filter(supportsText))} value={textModel || null} onChange={(value) => setTextModel(value ?? "")} disabled={Boolean(busy)} searchable />
      <Textarea label="正文片段" description="留空由 AI 从当前正文选景；也可粘贴正文中的连续片段（最多 3,000 字符）。" value={excerpt} onChange={(event) => setExcerpt(event.currentTarget.value)} minRows={3} maxRows={7} autosize disabled={Boolean(busy)} error={!excerptValid ? "请输入正文中的连续片段，且不超过 3,000 字符" : undefined} />
      {!excerpt.trim() && content.length > MAX_ILLUSTRATION_CONTENT && <Alert color="yellow">正文较长，请先选取一个片段。</Alert>}
      <Textarea label="画面要求（可选）" placeholder="例如：水彩插图，冷色调，重点表现人物与环境的关系" value={style} onChange={(event) => setStyle(event.currentTarget.value)} maxLength={2000} minRows={2} disabled={Boolean(busy)} />
      <Button loading={busy === "prompt"} disabled={Boolean(busy) || !textModel || !excerptValid || (!excerpt.trim() && content.length > MAX_ILLUSTRATION_CONTENT)} onClick={() => void generate("prompt")}>{prompt ? "重新生成图片 prompt" : "选景并生成图片 prompt"}</Button>
      <Textarea label="图片 prompt" description="检查人物、场景与构图后，可直接修改，再交给文生图模型。" value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} maxLength={MAX_ILLUSTRATION_PROMPT} minRows={5} maxRows={12} autosize disabled={Boolean(busy)} />
      <Select label="文生图模型" description="选择支持图片生成的模型，可与提示词模型使用不同的 Provider。" placeholder="选择文生图模型" data={options(models.filter(supportsImages))} value={imageModel || null} onChange={(value) => { setImageModel(value ?? ""); setSize(""); setQuality(""); }} disabled={Boolean(busy)} searchable />
      {!modelError && models.length > 0 && !models.some(supportsImages) && <Alert color="yellow">尚未配置图像生成模型，请到“设置 → AI 服务”添加或编辑模型能力。</Alert>}
      {sizes.length > 0 && <Select label="图片尺寸" data={[{ value: "", label: "模型默认" }, ...sizes]} value={size} onChange={(value) => setSize(value ?? "")} disabled={Boolean(busy)} allowDeselect={false} />}
      {qualities.length > 0 && <Select label="图片画质" data={[{ value: "", label: "模型默认" }, ...qualities]} value={quality} onChange={(value) => setQuality(value ?? "")} disabled={Boolean(busy)} allowDeselect={false} />}
      <Group grow><Button variant="default" disabled={!prompt || Boolean(busy)} onClick={() => void copyPrompt()}>复制 prompt</Button><Button loading={busy === "image"} disabled={Boolean(busy) || !imageModel || !prompt.trim()} onClick={() => void generate("image")}>{image ? "重新生成图片" : "生成图片"}</Button></Group>
      {busy && <Group justify="space-between"><Text role="status" size="sm">{busy === "prompt" ? "正在选景并编写提示词…" : "正在生成图片，请稍候…"}</Text><Button variant="subtle" onClick={cancel}>取消请求</Button></Group>}
      {error && <Alert color="red" role="alert">{error}</Alert>}
      {notice && <Text size="sm" role="status">{notice}</Text>}
      {image && <figure className="illustration-result">
        {/* Model output can be a data URL or a temporary provider URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.src} alt="根据正文片段生成的插图" onError={() => setError("图片无法加载，模型返回的链接可能已过期，请重新生成")} />
        {image.revisedPrompt && <figcaption>模型采用的提示词：{image.revisedPrompt}</figcaption>}
        <Button component="a" href={image.src} download={image.src.startsWith("data:") ? `writer-studio-illustration.${image.src.startsWith("data:image/jpeg") ? "jpg" : image.src.startsWith("data:image/webp") ? "webp" : "png"}` : undefined} target={image.src.startsWith("data:") ? undefined : "_blank"} rel="noopener noreferrer" variant="default">{image.src.startsWith("data:") ? "下载图片" : "打开图片并保存"}</Button>
      </figure>}
      <Button variant="subtle" onClick={onClose}>返回正文</Button>
    </Stack>
  </ResponsiveModal>;
}
