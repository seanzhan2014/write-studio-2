"use client";
import { Alert, Badge, Button, Checkbox, Group, Select, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { characterCover, characterImageSrc, type CharacterVisual } from "@/lib/character-visual";
import { isSpicyApi, type SpicyCharacter } from "@/lib/spicy-api";
import { ResponsiveModal } from "./overlays";

export function CharacterAvatar({ visual, name }: { visual?: CharacterVisual; name: string }) {
  const [failed, setFailed] = useState(false);
  const cover = characterCover(visual);
  const src = cover ? characterImageSrc(cover) : "";
  useEffect(() => setFailed(false), [src]);
  // eslint-disable-next-line @next/next/no-img-element
  return src && !failed ? <img src={src} alt={`${name}的角色主图`} className="character-cover-image" loading="lazy" onError={() => setFailed(true)} /> : <>{name[0]}</>;
}

export function CharacterVisualField({ value, onChange }: { value?: CharacterVisual; onChange: (value: CharacterVisual | undefined) => void }) {
  const [opened, setOpened] = useState(false);
  return <section className="character-visual-field" aria-label="人物视觉档案">
    <Group align="center" wrap="nowrap">
      {value && <div className="character-visual-cover"><CharacterAvatar visual={value} name={value.characterName} /></div>}
      <Stack gap={5}><Text fw={600} size="sm">角色图片</Text><Text size="sm" c="dimmed">{value ? `${value.characterName} · ${value.images.length} 张参考图` : "绑定 SpicyAPI 角色，用于人物主图与单人物插图。"}</Text>
        <Group gap="xs"><Button size="xs" variant="light" onClick={() => setOpened(true)}>{value ? "更换或刷新形象" : "绑定 SpicyAPI 角色"}</Button>{value && <Button size="xs" variant="subtle" color="red" onClick={() => onChange(undefined)}>解除绑定</Button>}</Group>
      </Stack>
    </Group>
    {opened && <ResponsiveModal opened onClose={() => setOpened(false)} title="绑定 SpicyAPI 角色" size="lg"><SpicyCharacterPicker current={value} onSelect={visual => { onChange(visual); setOpened(false); }} /></ResponsiveModal>}
  </section>;
}

function SpicyCharacterPicker({ current, onSelect }: { current?: CharacterVisual; onSelect: (visual: CharacterVisual) => void }) {
  const [providers, setProviders] = useState<Array<{ id: string; name: string; hasSecret: boolean }>>([]);
  const [providerId, setProviderId] = useState(current?.providerId ?? "");
  const [characters, setCharacters] = useState<SpicyCharacter[]>([]);
  const [selectedId, setSelectedId] = useState(current?.characterId ?? "");
  const [character, setCharacter] = useState<SpicyCharacter | null>(null);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [coverId, setCoverId] = useState("");
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetchFromServer("/api/providers", { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "无法读取服务连接");
      const items = data.providers.filter(isSpicyApi);
      setProviders(items); setProviderId(value => items.some((item: { id: string }) => item.id === value) ? value : items[0]?.id ?? "");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController(); version.current++;
    setCharacters([]); setCursor(""); setCharacter(null); setImageIds([]); setError("");
    if (!providerId) { setLoading(false); return; }
    setLoading(true);
    void fetchFromServer(`/api/ai/spicy-characters?providerId=${encodeURIComponent(providerId)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "无法读取角色库");
      if (!controller.signal.aborted) { setCharacters(data.items); setCursor(data.nextCursor || ""); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [providerId]);
  useEffect(() => {
    const controller = new AbortController(); setCharacter(null); setImageIds([]);
    if (!selectedId || !providerId) return;
    setError("");
    void fetchFromServer(`/api/ai/spicy-characters?providerId=${encodeURIComponent(providerId)}&characterId=${encodeURIComponent(selectedId)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "无法读取角色图片");
      if (controller.signal.aborted) return;
      const remote: SpicyCharacter = data.character;
      setCharacter(remote);
      const savedIds = current?.providerId === providerId && current.characterId === selectedId ? current.images.map(image => image.id) : [];
      const chosen = (remote.assets ?? []).filter(asset => savedIds.includes(asset.id)).map(asset => asset.id);
      const first = remote.cover?.id || remote.assets?.[0]?.id;
      const ids = chosen.length ? chosen : first ? [first] : [];
      setImageIds(ids); setCoverId(ids.includes(current?.coverAssetId || "") ? current!.coverAssetId : ids[0] || "");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [providerId, selectedId, current]);
  async function loadMore() {
    const expected = version.current; setLoading(true); setError("");
    try {
      const response = await fetchFromServer(`/api/ai/spicy-characters?providerId=${encodeURIComponent(providerId)}&cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "读取更多角色失败");
      if (expected === version.current) { setCharacters(items => [...items, ...data.items.filter((item: SpicyCharacter) => !items.some(saved => saved.id === item.id))]); setCursor(data.nextCursor || ""); }
    } catch (cause) { if (expected === version.current) setError(cause instanceof Error ? cause.message : "读取失败"); }
    finally { if (expected === version.current) setLoading(false); }
  }
  async function bind() {
    setSaving(true); setError("");
    try {
      const response = await fetchServerAction("/api/ai/spicy-characters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId, characterId: selectedId, imageIds, coverAssetId: coverId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "绑定失败");
      onSelect(data.visual);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "绑定失败"); }
    finally { setSaving(false); }
  }
  return <Stack gap="md">
    <Text size="sm" c="dimmed">选择 1–8 张同一人物的参考图。图片按角色库中的顺序使用，主图仅决定头像。单图模型请只选择一张。</Text>
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {!providers.length && <Alert color="yellow">请先在“设置 → AI 服务”添加 SpicyAPI 服务连接并设置密钥。</Alert>}
    <Select label="SpicyAPI 服务连接" value={providerId || null} data={providers.map(provider => ({ value: provider.id, label: provider.name, disabled: !provider.hasSecret }))} onChange={value => { setProviderId(value || ""); setSelectedId(""); }} disabled={saving} />
    <Select label="角色库中的角色" placeholder={loading ? "正在读取…" : "搜索并选择角色"} searchable value={selectedId || null} data={[...characters, ...(character && !characters.some(item => item.id === character.id) ? [character] : [])].map(character => ({ value: character.id, label: character.name }))} onChange={value => setSelectedId(value || "")} disabled={saving || loading} />
    {cursor && <Button variant="subtle" loading={loading} disabled={saving} onClick={() => void loadMore()}>读取更多角色</Button>}
    {providerId && !loading && !characters.length && !error && <Text size="sm" c="dimmed">角色库为空。请先在 SpicyAPI 网页端创建角色，再重新打开此窗口。</Text>}
    {character?.note && <Text size="sm">{character.note}</Text>}
    {character && <div className="character-reference-grid">{character.assets?.map((asset, index) => <div className={`character-reference-option ${imageIds.includes(asset.id) ? "selected" : ""}`} key={asset.id}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {asset.previewUrl && <img src={asset.previewUrl} alt={`${character.name}参考图 ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" />}
      <Checkbox label={`参考图 ${index + 1}`} checked={imageIds.includes(asset.id)} disabled={saving || (!imageIds.includes(asset.id) && imageIds.length >= 8)} onChange={event => { const ids = event.currentTarget.checked ? [...imageIds, asset.id] : imageIds.filter(id => id !== asset.id); setImageIds(ids); if (!ids.includes(coverId)) setCoverId(ids[0] || ""); }} />
      {imageIds.includes(asset.id) && <Button size="compact-xs" variant="subtle" disabled={saving} onClick={() => setCoverId(asset.id)}>{coverId === asset.id ? "✓ 当前主图" : "设为主图"}</Button>}
    </div>)}</div>}
    {character && !character.assets?.length && <Alert color="yellow">此角色还没有参考图片，请先在 SpicyAPI 中添加。</Alert>}
    <Group justify="space-between"><Badge variant="light">已选 {imageIds.length} 张</Badge><Button loading={saving} disabled={!character || character.id !== selectedId || !imageIds.length || loading} onClick={() => void bind()}>使用此形象</Button></Group>
    <Text size="xs" c="dimmed">创建、编辑角色分组仍在 SpicyAPI 网页端完成；绑定会保存图片副本，人物修改随原有保存流程保存。</Text>
  </Stack>;
}

export function CharacterReferenceSummary({ reference }: { reference?: import("@/lib/character-visual").CharacterReference }) {
  if (!reference) return null;
  return <div className="character-reference-summary"><Text size="sm" fw={500}>人物快照：{reference.name} · {reference.visual.characterName} · {reference.visual.images.length} 张参考图</Text><div className="character-reference-thumbnails">{reference.visual.images.map((image, index) => <a key={image.id} href={characterImageSrc(image)} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={characterImageSrc(image)} alt={`${reference.name}的生成参考图 ${index + 1}`} loading="lazy" /></a>)}</div>{reference.appearance && <Text size="xs" c="dimmed">当时外貌：{reference.appearance}</Text>}</div>;
}
