"use client";

import { Group, Stack, Text } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { GENERATE_FIELDS } from "@/lib/advanced-writing";
import { AI_SETTING_LABELS, visibleAiSettingKeys, inheritAiSettings, resolveAiSettings, type AiSettingsKind } from "@/lib/ai-settings-inheritance";
import { type AiGenerateOptions } from "@/lib/generate-options";
import { type IllustrationOptions } from "@/lib/illustration-options";
import { TASK_PARAMETER_FIELDS } from "@/lib/task-parameters";
import { AiSettingActions } from "./ai-setting-actions";

type Options = AiGenerateOptions | IllustrationOptions;
const expressionKey = (key: string) => key.replace(/^rewriteExpression\./, "");
function settingLabel(key: string) {
  const field = expressionKey(key);
  return field.startsWith("advanced.") ? GENERATE_FIELDS[field.slice(9) as keyof typeof GENERATE_FIELDS][0] : AI_SETTING_LABELS[field];
}
export function AiSettingsInheritance<T extends Options>({ kind, targetId, level = "outline", value, onChange, disabled = false, includeAdvanced = false, taskGroups }: { kind: AiSettingsKind; targetId: string; level?: "outline" | "chapter"; value: T; onChange: (value: T) => void; disabled?: boolean; includeAdvanced?: boolean; taskGroups?: string[] }) {
  const { currentArticle, data } = useStudio();
  const resolved = resolveAiSettings(currentArticle, targetId, kind, level, data.settings);
  const keys = visibleAiSettingKeys(kind, value).filter(key => key !== "reviewMaxRounds" && key !== "reviewInstruction" && (!taskGroups || !key.startsWith("tasks.") || TASK_PARAMETER_FIELDS.some(field => `tasks.${field.key}` === key && taskGroups.includes(field.group))));
  function apply(mode: "global" | "previous", selected: string[]) {
    onChange(inheritAiSettings(value, mode, (mode === "global" ? resolved.globalDefaults : resolved.previous) as T, selected));
  }
  return <div className="ai-settings-inheritance">
    <Group justify="space-between" gap="xs"><Text size="sm" c="dimmed">参数来源 · {resolved.baselineLabel}</Text><AiSettingActions label={kind === "generate" ? "全部生成设置" : "全部插图设置"} disabled={disabled} onGlobal={() => apply("global", keys)} onPrevious={() => apply("previous", keys)} /></Group>
    <details className="ai-setting-inheritance-details"><summary>逐项设置继承</summary><Stack gap="xs" mt="sm">
      {keys.filter(key => !key.startsWith("tasks.") && (includeAdvanced || !expressionKey(key).startsWith("advanced."))).map(key => {
        const label = settingLabel(key);
          return <div className="ai-setting-inheritance-row" key={key}><Text size="sm">{label}<small>{value.inheritance?.[key] === "previous" ? `跟随${resolved.previousLabel}` : value.inheritance?.[key] === "parent" ? `跟随${resolved.parentLabel}` : value.inheritance?.[key] === "global" ? "跟随全局默认" : value.inheritance?.[key] === "article" ? "跟随全局默认" : "当前设置"}</small></Text><AiSettingActions label={label} disabled={disabled} onGlobal={() => apply("global", [key])} onPrevious={() => apply("previous", [key])} /></div>;
      })}
    </Stack></details>
  </div>;
}

