"use client";

import { Autocomplete, Button, Divider, NumberInput, SimpleGrid, Stack, Text, Textarea } from "@mantine/core";
import { basicImageParameterKeys, defaultImageParameters, imageParameterProfile, imageParameterSuggestions, type ImageParameterContext, type ImageParameterDraft } from "@/lib/image-model-parameters";
export { imageParameterDraft, readImageParameterDraft, type ImageParameterDraft } from "@/lib/image-model-parameters";

const labels: Record<string, string> = { steps: "采样步数", cfgScale: "CFG", seed: "Seed", sampler: "采样器", sampleMethod: "采样器", scheduler: "调度器", schedule: "调度器" };

export function ImageModelParameterEditor({ context, value, onChange }: { context: ImageParameterContext; value: ImageParameterDraft; onChange: (draft: ImageParameterDraft) => void }) {
  const rules = imageParameterSuggestions(context), defaults = defaultImageParameters(context), profile = imageParameterProfile(context);
  const update = (key: string, next: string) => onChange({ ...value, values: { ...value.values, [key]: next } });
  const example = profile === "moss" ? "width=1216,height=832" : profile === "sd" ? "clipSkip=2,uCache=off" : profile === "spicy" ? "width=1024,enable_prompt_expansion=true" : "output_format=webp,output_compression=85";
  return <Stack mt="md">
    <Text size="xs" c="dimmed">留空使用模型默认值。高级参数覆盖适配器默认值；本次插图明确填写的提示词、尺寸、比例及画质优先。参数是否有效由服务商校验。</Text>
    {(profile === "moss" || profile === "sd") && <>
      <Textarea label="工作流参数（顶层）" description={'作用于整个生成任务，例如 allowMatureContent=true,currencies=["yellow"]。多个参数以逗号分隔；无需添加 workflow. 前缀。'} placeholder={'allowMatureContent=true,currencies=["yellow"]'} value={value.workflow} maxLength={4000} autosize minRows={2} maxRows={6} onChange={event => onChange({ ...value, workflow: event.currentTarget.value })} />
      <Text size="xs" c="dimmed">URL 查询参数也可在此使用 query. 前缀填写，例如 query.hideMatureContent=true。</Text>
      <Divider label="图片参数" labelPosition="left" />
    </>}
    <SimpleGrid cols={{ base: 1, sm: 2 }}>{basicImageParameterKeys(context).map(key => {
      const rule = rules[key], fallback = defaults[key];
      const description = key === "seed" ? "留空使用随机种子；固定后便于比较参数效果。" : fallback !== undefined ? `模型默认：${fallback}` : "留空使用服务商默认值。";
      return rule.type === "number" ? <NumberInput key={key} label={labels[key]} description={description} placeholder={fallback === undefined ? "模型默认" : String(fallback)} value={value.values[key] ?? ""} onChange={next => update(key, String(next))} />
        : <Autocomplete key={key} label={labels[key]} description={description} placeholder={fallback === undefined ? "模型默认" : `默认：${fallback}`} data={rule.values ?? []} value={value.values[key] ?? ""} onChange={next => update(key, next)} />;
    })}</SimpleGrid>
    <Textarea label="额外图片参数" description={`使用 参数名=值，多个参数以逗号分隔。例如：${example}。支持数字、布尔值、字符串及 JSON 数组、对象和 null。`} placeholder={example} value={value.extra} maxLength={4000} autosize minRows={2} maxRows={6} onChange={event => onChange({ ...value, extra: event.currentTarget.value })} />
    <Text size="xs" c="dimmed">常见参数（可自由填写其他参数）：{Object.keys(rules).join(", ")}</Text>
    <Button variant="subtle" size="compact-xs" onClick={() => onChange({ values: {}, extra: "", workflow: "" })}>恢复图像模型默认参数</Button>
  </Stack>;
}
