"use client";

import { Alert, Button, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { fetchFromServer } from "@/lib/browser-network";
import type { IllustrationRecord } from "@/lib/illustration-history";
import { CharacterReferenceSummary } from "./character-visual";

export function IllustrationTaskResult({ id, prompt, image }: { id: string; prompt: string; image: boolean }) {
  const [record, setRecord] = useState<IllustrationRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setRecord(null); setError("");
    void fetchFromServer(`/api/ai/illustrations/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("图片已从历史中删除，或需要在任务所属运行端查看。");
      const payload = await response.json() as { record: IllustrationRecord };
      if (!controller.signal.aborted) setRecord(payload.record);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取插图失败"); });
    return () => controller.abort();
  }, [id, image]);
  return <Stack gap="sm" className="illustration-result">
    {image && !record && !error && <Text size="sm" c="dimmed">正在读取保存的插图…</Text>}
    {error && <Alert color="yellow">{error}</Alert>}
    <CharacterReferenceSummary reference={record?.characterReference} />
    {record?.src && !error && <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={record.src} alt="AI 任务生成的插图" onError={() => setError("图片已删除或暂时无法读取，请刷新后重试。")} />
      <Button component="a" href={`${record.src}?download=1`} download variant="default">下载图片</Button>
    </>}
    {prompt && <div className="task-detail-result" aria-label="任务结果">{prompt}</div>}
  </Stack>;
}
