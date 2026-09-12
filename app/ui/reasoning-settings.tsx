"use client";

import { useState } from "react";
import { Checkbox, Select, Stack, Text } from "@mantine/core";
import { REASONING_EFFORTS, type ReasoningEffort } from "@/lib/reasoning-options";

const labels = ["无推理", "极低", "低", "中", "高", "很高", "最高"];
const strengths = REASONING_EFFORTS.map((value, index) => ({ value, label: `${labels[index]}（${value}）` }));

export function ReasoningSettings({ value, onChange, modelValue, modelSetting = false, disabled = false }: {
  value?: ReasoningEffort | null;
  onChange: (value: ReasoningEffort | null | undefined) => void;
  modelValue?: ReasoningEffort | null;
  modelSetting?: boolean;
  disabled?: boolean;
}) {
  const [lastEffort, setLastEffort] = useState<ReasoningEffort>(value ?? "medium");
  const mode = value === undefined && !modelSetting ? "inherit" : value == null ? "off" : "custom";
  return <Stack gap="xs" className="reasoning-settings">
    {modelSetting
      ? <Checkbox label="指定推理强度" checked={mode === "custom"} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked ? lastEffort : null)} />
      : <Select label="推理强度设置" aria-label="推理强度设置" disabled={disabled} value={mode} data={[
        { value: "inherit", label: `沿用模型（${modelValue ?? "默认"}）` },
        { value: "off", label: "不指定" },
        { value: "custom", label: "自定义" },
      ]} onChange={(next) => onChange(next === "inherit" ? undefined : next === "off" ? null : lastEffort)} />}
    {mode === "custom" && <Select label="推理强度" aria-label="推理强度" disabled={disabled} value={value ?? lastEffort} data={strengths} onChange={(next) => { if (next) { setLastEffort(next as ReasoningEffort); onChange(next as ReasoningEffort); } }} />}
    {mode === "custom" && <Text size="xs" c="dimmed">可用强度取决于当前模型。</Text>}
  </Stack>;
}
