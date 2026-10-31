"use client";

import { Group, Stack, Text, Textarea, NumberInput, Select, Checkbox } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { GENERATE_FIELDS } from "@/lib/advanced-writing";
import { AI_SETTING_LABELS, aiSettingKeys, inheritAiSettings, overrideAiSettings, readAiSetting, resolveAiSettings, type AiSettingsKind } from "@/lib/ai-settings-inheritance";
import { normalizeChapterSettings } from "@/lib/story-settings";
import { type AiGenerateOptions } from "@/lib/generate-options";
import { type IllustrationOptions } from "@/lib/illustration-options";
import { normalizeIllustrationStyles } from "@/lib/illustration-styles";
import { TaskParameterSettings } from "./task-parameter-settings";
import { TASK_PARAMETER_FIELDS } from "@/lib/task-parameters";
import { AiSettingActions } from "./ai-setting-actions";
import { useEffect, useState } from "react";
import { fetchFromServer } from "@/lib/browser-network";
import { modelSelectionLabel } from "@/lib/model-label";

type Options = AiGenerateOptions | IllustrationOptions;
export function AiSettingsInheritance<T extends Options>({ kind, targetId, level = "outline", value, onChange, disabled = false, includeAdvanced = false, taskGroups }: { kind: AiSettingsKind; targetId: string; level?: "outline" | "chapter"; value: T; onChange: (value: T) => void; disabled?: boolean; includeAdvanced?: boolean; taskGroups?: string[] }) {
  const { currentArticle, data } = useStudio();
  const resolved = resolveAiSettings(currentArticle, targetId, kind, level, data.settings);
  const keys = aiSettingKeys(kind).filter(key => key !== "reviewMaxRounds" && key !== "reviewInstruction" && (!taskGroups || !key.startsWith("tasks.") || TASK_PARAMETER_FIELDS.some(field => `tasks.${field.key}` === key && taskGroups.includes(field.group))));
  function apply(mode: "article" | "previous", selected: string[]) {
    onChange(inheritAiSettings(value, mode, (mode === "article" ? resolved.articleDefaults : resolved.previous) as T, selected));
  }
  return <div className="ai-settings-inheritance">
    <Group justify="space-between" gap="xs"><Text size="sm" c="dimmed">参数来源 · {resolved.baselineLabel}</Text><AiSettingActions label={kind === "generate" ? "全部生成设置" : "全部插图设置"} disabled={disabled} onArticle={() => apply("article", keys)} onPrevious={() => apply("previous", keys)} /></Group>
    <Text size="xs" c="dimmed">“继承上一项”跟随{resolved.previousLabel}；明确选择后随来源更新。</Text>
    <details className="ai-setting-inheritance-details"><summary>逐项设置继承</summary><Stack gap="xs" mt="sm">
      {keys.filter(key => !key.startsWith("tasks.") && (includeAdvanced || !key.startsWith("advanced."))).map(key => {
        const label = key.startsWith("advanced.") ? GENERATE_FIELDS[key.slice(9) as keyof typeof GENERATE_FIELDS][0] : AI_SETTING_LABELS[key];
        return <div className="ai-setting-inheritance-row" key={key}><Text size="sm">{label}<small>{value.inheritance?.[key] === "previous" ? `跟随${resolved.previousLabel}` : value.inheritance?.[key] === "article" ? "跟随文章默认" : "当前设置"}</small></Text><AiSettingActions label={label} disabled={disabled} onArticle={() => apply("article", [key])} onPrevious={() => apply("previous", [key])} /></div>;
      })}
    </Stack></details>
  </div>;
}

const choices: Record<string, { value: string; label: string }[]> = {
  contentMode: [{ value: "fresh", label: "重新生成" }, { value: "rewrite", label: "改写" }, { value: "continue", label: "续写" }],
  rewriteRetention: [{ value: "low", label: "低" }, { value: "balanced", label: "适中" }, { value: "high", label: "高" }],
  reasoningEffort: [{ value: "__inherit__", label: "跟随模型" }, { value: "__omit__", label: "不发送推理参数" }, ...["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].map(value => ({ value, label: value }))],
  promptLanguage: [{ value: "zh", label: "中文" }, { value: "en", label: "English" }],
};

export function ChapterAiSettings({ chapterId }: { chapterId: string }) {
  const studio = useStudio();
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchFromServer("/api/models").then(response => response.json()).then(data => { if (alive) setModels((data.models ?? []).map((model: Parameters<typeof modelSelectionLabel>[0] & { id: string }) => ({ value: model.id, label: modelSelectionLabel(model) }))); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const chapter = studio.currentArticle.chapters.find(chapter => chapter.id === chapterId);
  if (!chapter) return null;
  function save(kind: AiSettingsKind, value: Options) {
    const settings = normalizeChapterSettings(chapter!.settings);
    studio.updateChapter(chapterId, { settings: { ...settings, aiTasks: { ...settings.aiTasks, [kind]: value } } });
  }
  return <details className="chapter-ai-settings"><summary>AI 任务设置</summary><Text size="sm" c="dimmed" mt="sm">下一章的首个大纲点选择“继承上一项”时，使用本章的设置。没有上一章时使用文章默认。</Text>
    <TaskParameterSettings level="chapter" targetId={chapterId} />
    {(["generate", "illustration"] as const).map(kind => {
      const { value } = resolveAiSettings(studio.currentArticle, chapterId, kind, "chapter", studio.data.settings);
      function edit(key: string, setting: unknown) {
        const [parent, child] = key.split(".");
        const patch = child ? { [parent]: { ...(value as unknown as Record<string, object>)[parent], [child]: setting } } : { [key]: setting };
        save(kind, overrideAiSettings(value, patch));
      }
      return <details key={kind} className="chapter-ai-kind"><summary>{kind === "generate" ? "正文生成" : "插图"}</summary><Stack gap="md" mt="sm">
        <AiSettingsInheritance kind={kind} targetId={chapterId} level="chapter" value={value} onChange={next => save(kind, next)} includeAdvanced />
        {aiSettingKeys(kind).filter(key => !key.startsWith("tasks.") && !["reviewMaxRounds", "reviewInstruction", "firstAppearanceOverrides"].includes(key)).map(key => {
          const label = key.startsWith("advanced.") ? GENERATE_FIELDS[key.slice(9) as keyof typeof GENERATE_FIELDS][0] : AI_SETTING_LABELS[key];
          const current = readAiSetting(value, key);
          const options = key === "model" ? [{ value: "", label: "本地演示引擎" }, ...(current && !models.some(model => model.value === current) ? [{ value: String(current), label: `${current}（不可用）` }] : []), ...models] : choices[key] ?? (key.startsWith("proseControls.") ? (key.endsWith("narrativePace") ? ["auto", "slow", "balanced", "fast"] : key.endsWith("paragraphLength") ? ["auto", "short", "balanced", "long"] : ["auto", "low", "balanced", "high"]).map((value, index) => ({ value, label: ["自动", "低 / 短 / 舒缓", "适中", "高 / 长 / 紧凑"][index] })) : key === "stylePreset" ? normalizeIllustrationStyles(studio.data.settings.illustrationStyles).map(style => ({ value: style.value, label: style.label })) : undefined);
          if (typeof current === "boolean") return <Checkbox key={key} label={label} checked={current} onChange={event => edit(key, event.currentTarget.checked)} />;
          if (key === "targetWords") return <NumberInput key={key} label={label} min={0} max={100000} value={Number(current) || ""} placeholder="不限" onChange={next => edit(key, Number(next))} />;
          if (options) return <Select key={key} label={label} data={options} value={key === "reasoningEffort" ? current === undefined ? "__inherit__" : current === null ? "__omit__" : String(current) : String(current ?? "")} allowDeselect={false} onChange={next => edit(key, next === "__inherit__" ? undefined : next === "__omit__" ? null : next)} />;
          return <Textarea key={key} label={label} value={String(current ?? "")} autosize minRows={key.startsWith("advanced.") ? 2 : 1} maxLength={key === "additionalPrompt" ? 8000 : key === "scenePrompt" ? 2000 : 3000} onChange={event => edit(key, event.currentTarget.value)} />;
        })}
      </Stack></details>;
    })}
  </details>;
}
