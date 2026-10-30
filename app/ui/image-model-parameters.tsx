"use client";

import { Button, NumberInput, Select, SimpleGrid, Stack, Text, Textarea } from "@mantine/core";
import { defaultImageParameters, formatImageParameterText, imageParameterProfile, imageParameterRules, parseImageParameterText, validateImageParameters, type ImageParameterContext, type ImageParameters } from "@/lib/image-model-parameters";

export type ImageParameterDraft = { values: Record<string, string>; extra: string };
const labels: Record<string, string> = { steps: "采样步数", cfgScale: "CFG", seed: "Seed", sampler: "采样器", sampleMethod: "采样器", scheduler: "调度器", schedule: "调度器" };
function basicKeys(context: ImageParameterContext) { const rules = imageParameterRules(context); return Object.keys(labels).filter(key => rules[key]); }

export function imageParameterDraft(parameters: ImageParameters = {}, context: ImageParameterContext): ImageParameterDraft {
  const basic = basicKeys(context);
  return { values: Object.fromEntries(basic.filter(key => parameters[key] !== undefined).map(key => [key, String(parameters[key])])), extra: formatImageParameterText(Object.fromEntries(Object.entries(parameters).filter(([key]) => !basic.includes(key)))) };
}

export function readImageParameterDraft(draft: ImageParameterDraft, context: ImageParameterContext) {
  const parameters = parseImageParameterText(draft.extra, context);
  const rules = imageParameterRules(context);
  for (const [key, value] of Object.entries(draft.values)) {
    if (!value.trim()) continue;
    if (Object.hasOwn(parameters, key)) throw new Error(`图片参数「${key}」已在上方设置，请从额外参数中移除重复项`);
    parameters[key] = rules[key]?.type === "number" ? Number(value) : value;
  }
  return validateImageParameters(parameters, context);
}

export function ImageModelParameterEditor({ context, value, onChange }: { context: ImageParameterContext; value: ImageParameterDraft; onChange: (draft: ImageParameterDraft) => void }) {
  const rules = imageParameterRules(context), defaults = defaultImageParameters(context), profile = imageParameterProfile(context);
  const update = (key: string, next: string) => onChange({ ...value, values: { ...value.values, [key]: next } });
  const example = profile === "moss" ? "width=1216,height=832" : profile === "sd" ? "clipSkip=2,uCache=off" : profile === "spicy" ? "width=1024,enable_prompt_expansion=true" : "output_format=webp,output_compression=85";
  return <Stack mt="md">
    <Text size="xs" c="dimmed">留空使用模型默认值。保存后用于正常生图和模型测试；插图窗口中选择的尺寸、比例及画质优先。</Text>
    <SimpleGrid cols={{ base: 1, sm: 2 }}>{basicKeys(context).map(key => {
      const rule = rules[key], fallback = defaults[key];
      const description = key === "seed" ? "留空使用随机种子；固定后便于比较参数效果。" : fallback !== undefined ? `模型默认：${fallback}` : "留空使用服务商默认值。";
      return rule.type === "number" ? <NumberInput key={key} label={labels[key]} description={description} placeholder={fallback === undefined ? "模型默认" : String(fallback)} value={value.values[key] ?? ""} min={rule.min} max={rule.max} allowDecimal={!rule.integer} allowNegative={Boolean(rule.min && rule.min < 0)} onChange={next => update(key, String(next))} />
        : <Select key={key} label={labels[key]} description={description} placeholder={fallback === undefined ? "模型默认" : `默认：${fallback}`} data={rule.values ?? []} value={value.values[key] || null} clearable searchable onChange={next => update(key, next || "")} />;
    })}</SimpleGrid>
    <Textarea label="额外图片参数" description={`使用 参数名=值，多个参数以逗号分隔。例如：${example}。支持数字、布尔值和字符串。`} placeholder={example} value={value.extra} maxLength={4000} autosize minRows={2} maxRows={6} onChange={event => onChange({ ...value, extra: event.currentTarget.value })} />
    <Text size="xs" c="dimmed">可用参数：{Object.keys(rules).join(", ")}</Text>
    <Button variant="subtle" size="compact-xs" onClick={() => onChange({ values: {}, extra: "" })}>恢复图像模型默认参数</Button>
  </Stack>;
}
