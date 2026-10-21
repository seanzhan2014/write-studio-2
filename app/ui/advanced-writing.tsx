"use client";
import { Textarea, Text, Button, Stack } from "@mantine/core";
import { normalizeAdvanced, type GenerateAdvanced, GENERATE_FIELDS } from "@/lib/advanced-writing";

export function AdvancedWritingFields({ fields, value, onChange, title = "高级设定", inherited, onRestore }: { fields: Record<string, readonly string[]>; value: Record<string, string | undefined>; onChange: (value: Record<string, string | undefined>) => void; title?: string; inherited?: Record<string, string | undefined>; onRestore?: (key: string) => void }) {
  const count = Object.values(value).filter(v => v?.trim()).length;
  return <details className="writing-advanced"><summary>{title}<span>{count ? `已设定 ${count} 项` : "自动"}</span></summary><Stack gap="md" className="writing-advanced-body">
    <Text size="sm" c="dimmed">按需补充；留空使用自动安排。附加内容同样会用于写作准备、生成和审校。</Text>
    {Object.entries(fields).map(([key, [label, hint]]) => <div key={key}>
      <Textarea label={label} description={hint} placeholder={inherited?.[key] || "自动"} value={value[key] ?? ""} onChange={event => onChange({ ...normalizeAdvanced(value, fields), [key]: event.currentTarget.value })} autosize minRows={2} maxRows={6} maxLength={3000} />
      {onRestore && Object.hasOwn(value, key) && <Button size="compact-xs" variant="subtle" onClick={() => onRestore(key)}>恢复文章默认</Button>}
    </div>)}
  </Stack></details>;
}
export function GenerateAdvancedFields({ value, onChange, inherited, onRestore }: { value: GenerateAdvanced; onChange: (value: GenerateAdvanced) => void; inherited?: GenerateAdvanced; onRestore?: (key: string) => void }) {
  return <AdvancedWritingFields fields={GENERATE_FIELDS} value={value} onChange={onChange} inherited={inherited} onRestore={onRestore} />;
}
