"use client";

import { useEffect, useState } from "react";
import { Button, Checkbox, NumberInput, Select, Stack, Text, Textarea } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { resolveAiSettings, inheritAiSettings, overrideAiSettings } from "@/lib/ai-settings-inheritance";
import { normalizeAiGenerateOptions, type AiGenerateOptions } from "@/lib/generate-options";
import { normalizeChapterSettings } from "@/lib/story-settings";
import { TASK_PARAMETER_FIELDS, taskParameterDefaults } from "@/lib/task-parameters";
import { fetchFromServer } from "@/lib/browser-network";
import { modelSelectionLabel } from "@/lib/model-label";
import { supportsImages, supportsText, type ModelMetadata } from "@/lib/ai-model-capabilities";
import { AiSettingActions } from "./ai-setting-actions";

type CatalogModel = { id: string; name: string; modelId: string; providerName: string; metadata?: ModelMetadata };
export function TaskParameterSettings({ level, targetId, groups, models: suppliedModels }: { level: "article" | "chapter" | "outline"; targetId: string; groups?: string[]; models?: CatalogModel[] }) {
  const studio = useStudio();
  const article = studio.currentArticle;
  const resolved = resolveAiSettings(article, targetId, "generate", level === "article" ? "outline" : level, studio.data.settings);
  const defaults = { ...taskParameterDefaults(studio.data.settings, article), ...article.aiGenerateSettings.tasks };
  const value = level === "article" ? normalizeAiGenerateOptions({ ...article.aiGenerateSettings, tasks: defaults }) : resolved.value;
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
  const loadCatalog = () => fetchFromServer("/api/models").then(response => response.json()).then(data => data.models ?? [] as CatalogModel[]);
  useEffect(() => {
    if (suppliedModels) return;
    let alive = true;
    void loadCatalog().then(models => { if (alive) setCatalog(models); }).catch(() => {});
    return () => { alive = false; };
  }, [suppliedModels]);
  function save(next: AiGenerateOptions) {
    if (level === "article") studio.updateArticle({ aiGenerateSettings: next });
    else if (level === "outline") studio.updateOutline(targetId, { generateOptions: next });
    else {
      const chapter = article.chapters.find(chapter => chapter.id === targetId)!;
      const settings = normalizeChapterSettings(chapter.settings);
      studio.updateChapter(targetId, { settings: { ...settings, aiTasks: { ...settings.aiTasks, generate: next } } });
    }
  }
  const fields = TASK_PARAMETER_FIELDS.filter(field => (!groups || groups.includes(field.group)) && (level !== "article" || (!field.key.includes("Naming_") && field.key !== "reviewRules")));
  const reasoningOptions = [{ value: "__inherit__", label: "跟随模型" }, { value: "__omit__", label: "不发送推理参数" }, ...["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].map(value => ({ value, label: value }))];
  return <details className="task-parameter-settings"><summary>{groups?.length === 1 ? `${groups[0]}设置` : level === "article" ? "讨论、审校、命名与聊天默认设置" : "讨论、审校、命名与聊天设置"}</summary>
    <Text size="sm" c="dimmed" mt="sm">{level === "article" ? "未单独设置的项目跟随全局设置；章节和大纲可以逐项调整。" : `继承来源：${resolved.previousLabel}。找不到上一大纲点时使用上一章节，再回退到文章默认。`}</Text>
    {[...new Set(fields.map(field => field.group))].map(group => <details key={group} className="task-parameter-group" onToggle={event => { if (event.currentTarget.open && group === "插图模型" && suppliedModels && !catalog) void loadCatalog().then(setCatalog).catch(() => {}); }}><summary>{group}</summary><Stack gap="md" mt="sm">{fields.filter(field => field.group === group).map(field => {
      const current = value.tasks?.[field.key] ?? defaults[field.key];
      const edit = (next: string | number | boolean) => {
        if (level === "article") save(normalizeAiGenerateOptions({ ...article.aiGenerateSettings, tasks: { ...article.aiGenerateSettings.tasks, [field.key]: next } }));
        else save(overrideAiSettings(value, { tasks: { ...value.tasks, [field.key]: next } }));
      };
      const models = (catalog ?? suppliedModels ?? []).filter(field.key === "illustrationImageModel" ? supportsImages : supportsText).map(model => ({ value: model.id, label: modelSelectionLabel(model) }));
      const options = field.reasoning ? reasoningOptions : field.model ? [{ value: "", label: field.key === "reviewModel" || field.key.startsWith("illustration") ? "请选择模型" : "本地演示引擎" }, ...(current && !models.some(model => model.value === current) ? [{ value: String(current), label: `${current}（不可用）` }] : []), ...models] : field.options ? [...field.options] : undefined;
      return <div key={field.key} className="task-parameter-field">
        {typeof field.default === "boolean" ? <Checkbox label={field.label} checked={current === true} onChange={event => edit(event.currentTarget.checked)} /> : typeof field.default === "number" ? <NumberInput label={field.label} min={field.key.includes("Naming_") ? 1 : 0} max={field.max} allowDecimal={false} allowNegative={false} value={Number(current)} onChange={next => edit(Number(next))} /> : options ? <Select label={field.label} value={String(current)} data={options} allowDeselect={false} searchable={field.model} onChange={next => { if (next !== null) edit(next); }} /> : <Textarea label={field.label} description={field.key === "reviewRules" ? current === "__article_rules__" ? "当前使用文章审校规则。输入后替换；留空表示不使用规则。" : "当前规则替换文章审校规则；可退回文章默认。" : undefined} placeholder={current === "__article_rules__" ? "使用文章审校规则" : undefined} value={current === "__article_rules__" ? "" : String(current)} maxLength={field.max ?? 20000} autosize minRows={2} maxRows={6} onChange={event => edit(event.currentTarget.value)} />}
        {level === "article" ? <Button size="compact-xs" variant="subtle" onClick={() => { const tasks = { ...article.aiGenerateSettings.tasks }; delete tasks[field.key]; save(normalizeAiGenerateOptions({ ...article.aiGenerateSettings, tasks })); }}>跟随全局默认</Button> : <AiSettingActions label={field.label} onArticle={() => save(inheritAiSettings(value, "article", resolved.articleDefaults, [`tasks.${field.key}`]))} onPrevious={() => save(inheritAiSettings(value, "previous", resolved.previous, [`tasks.${field.key}`]))} />}
        {level !== "article" && <Text size="xs" c="dimmed">{value.inheritance?.[`tasks.${field.key}`] === "previous" ? `跟随${resolved.previousLabel}` : value.inheritance?.[`tasks.${field.key}`] === "article" ? "跟随文章默认" : "当前设置"}</Text>}
      </div>;
    })}</Stack></details>)}
  </details>;
}
