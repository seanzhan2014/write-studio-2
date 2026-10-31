"use client";
import { Textarea, Text, Button, Stack } from "@mantine/core";
import { normalizeAdvanced, type GenerateAdvanced, GENERATE_FIELDS, GENERATE_FIELD_GROUPS } from "@/lib/advanced-writing";
import { AiSettingActions } from "./ai-setting-actions";

export function AdvancedWritingFields({ fields, value, onChange, title = "高级设定", inherited, onRestore, onPrevious, groups }: { fields: Record<string, readonly string[]>; value: Record<string, string | undefined>; onChange: (value: Record<string, string | undefined>) => void; title?: string; inherited?: Record<string, string | undefined>; onRestore?: (key: string) => void; onPrevious?: (key: string) => void; groups?: Array<{ title: string; keys: string[] }> }) {
  const count = Object.values(value).filter(v => v?.trim()).length;
  const field = (key: string) => {
    const [label, hint] = fields[key];
    return <div className="writing-advanced-field" key={key}>
      <Textarea label={label} description={hint} placeholder={inherited?.[key] || "自动"} value={value[key] ?? ""} onChange={event => onChange({ ...normalizeAdvanced(value, fields), [key]: event.currentTarget.value })} autosize minRows={2} maxRows={6} maxLength={3000} />
      {onRestore && onPrevious ? <AiSettingActions label={label} onArticle={() => onRestore(key)} onPrevious={() => onPrevious(key)} /> : onRestore && Object.hasOwn(value, key) && <Button size="compact-xs" variant="subtle" onClick={() => onRestore(key)}>退回文章默认</Button>}
    </div>;
  };
  return <details className="writing-advanced"><summary>{title}<span>{count ? `已设定 ${count} 项` : "自动"}</span></summary><Stack gap="md" className="writing-advanced-body">
    <Text size="sm" c="dimmed">按需补充；留空使用自动安排。附加内容同样会用于写作准备、生成和审校。</Text>
    {groups ? <>{groups.map(group => <fieldset className="writing-expression-group" key={group.title}><legend>{group.title}<span>{group.keys.filter(key => value[key]?.trim()).length ? `已调整 ${group.keys.filter(key => value[key]?.trim()).length} 项` : "自动"}</span></legend><div className="writing-expression-fields">{group.keys.map(field)}</div></fieldset>)}{field("additional")}</> : Object.keys(fields).map(field)}
  </Stack></details>;
}
export function GenerateAdvancedFields({ value, onChange, inherited, onRestore, onPrevious }: { value: GenerateAdvanced; onChange: (value: GenerateAdvanced) => void; inherited?: GenerateAdvanced; onRestore?: (key: string) => void; onPrevious?: (key: string) => void }) {
  return <AdvancedWritingFields title="详细表达方式" fields={GENERATE_FIELDS} groups={GENERATE_FIELD_GROUPS} value={value} onChange={onChange} inherited={inherited} onRestore={onRestore} onPrevious={onPrevious} />;
}
