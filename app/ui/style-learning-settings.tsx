"use client";

import { Checkbox, NumberInput, Select, Text } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { normalizeStyleLearningSettings, type StyleLearningSettings } from "@/lib/style-learning-settings";
import { useConfiguredModels } from "./studio/shared";

export function StyleLearningDefaultsSettings() {
  const studio = useStudio();
  const models = useConfiguredModels();
  const defaults = normalizeStyleLearningSettings(studio.data.settings.styleLearningSettings);
  const patch = (value: Partial<StyleLearningSettings>) => studio.updateSettings({ styleLearningSettings: normalizeStyleLearningSettings({ ...defaults, ...value }) });
  const options = [
    { value: "", label: "跟随文章生成模型" },
    ...(defaults.model && !models.some(model => model.id === defaults.model) ? [{ value: defaults.model, label: `${defaults.model}（不可用）` }] : []),
    ...models.map(model => ({ value: model.id, label: `${model.providerName} · ${model.name}${model.hasSecret ? "" : "（需密钥）"}`, disabled: !model.hasSecret })),
  ];
  return <div className="ai-task-sections">
    <section className="ai-task-section" aria-label="学习与微调默认设置">
      <h2>任务默认设置</h2>
      <div className="ai-task-field-grid">
        <Select label="默认学习 / 生成模型" data={options} value={defaults.model} onChange={model => { if (model !== null) patch({ model }); }} allowDeselect={false} searchable />
        <div className="ai-task-number"><NumberInput label="默认微调轮次" description="基线试写后最多调整的次数。" min={1} max={10} allowDecimal={false} allowNegative={false} value={defaults.maxRounds} onChange={maxRounds => patch({ maxRounds: Number(maxRounds) })} /></div>
        <Checkbox className="ai-task-field-wide" label="完成后默认自动应用" description="文章配置或参考资料已变化时，成果仍会保留为待应用。" checked={defaults.autoApply} onChange={event => patch({ autoApply: event.currentTarget.checked })} />
      </div>
    </section>
    <Text size="sm" c="dimmed">在“文章资料 → 参考文章”中添加资料、发起学习与微调、查看成果和历史。每次任务可以单独调整上述选项。</Text>
  </div>;
}
