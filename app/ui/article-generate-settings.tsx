"use client";
import { Checkbox, NumberInput, Select, Slider } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { GenerateAdvancedFields } from "./advanced-writing";
import { ReasoningSettings } from "./reasoning-settings";
import { articleAiSettings, globalAiSettings, overrideAiSettings } from "@/lib/ai-settings-inheritance";
import { CLOSING_SUMMARY_OPTIONS, DESCRIPTION_DETAIL_OPTIONS, DIALOGUE_DENSITY_OPTIONS, INTROSPECTION_DENSITY_OPTIONS, NARRATIVE_PACE_OPTIONS, PARAGRAPH_LENGTH_OPTIONS, normalizeAiGenerateOptions, type AiGenerateOptions, DEFAULT_REWRITE_RETENTION_LEVEL, MAX_GENERATE_TARGET_WORDS } from "@/lib/generate-options";
import { useConfiguredModels, configuredModelForReference, rewriteRetentionOptions, modelDisplayLabel, contentGenerationModeLabel, contentGenerationModes, ProseControlRow } from "./studio/shared";

export function ArticleGenerateSettings({ global = false }: { global?: boolean } = {}) {
  const studio = useStudio();
  const models = useConfiguredModels();
  const article = studio.currentArticle;
  const settings = global ? globalAiSettings("generate", studio.data.settings) : articleAiSettings(article, "generate", studio.data.settings);
  const selectedRecord = configuredModelForReference(models, settings.model);
  const selectedModelReference = selectedRecord?.id ?? settings.model;
  const rewriteRetentionIndex = rewriteRetentionOptions.findIndex((item) => item.value === settings.rewriteRetention);
  const rewriteRetentionOption = rewriteRetentionOptions[rewriteRetentionIndex] ?? rewriteRetentionOptions[1];
  const overriddenOutlines = article.chapters.reduce((count, chapter) => count + chapter.outlines.filter((outline) => outline.generateOptions !== null).length, 0);
  const modelOptions = [
    { value: "", label: "本地演示引擎" },
    ...(selectedModelReference && !selectedRecord ? [{ value: selectedModelReference, label: `${selectedModelReference}（不可用）` }] : []),
    ...models.map((model) => ({ value: model.id, label: `${modelDisplayLabel(models, model.id)}${model.hasSecret ? "" : "（需密钥）"}` })),
  ];
  const patchSettings = (patch: Partial<AiGenerateOptions>) => {
    const next = normalizeAiGenerateOptions(overrideAiSettings(settings, patch));
    if (!global) { studio.updateArticle({ aiGenerateSettings: next }); return; }
    delete next.tasks;
    studio.updateSettings({ aiGenerateSettings: next, ...(patch.model !== undefined ? { generateModel: patch.model } : {}), ...(patch.targetWords !== undefined ? { generateTargetWords: patch.targetWords } : {}), ...(Object.hasOwn(patch, "reasoningEffort") ? { generateReasoningEffort: patch.reasoningEffort } : {}) });
  };

  return <section className="form-card article-ai-task-section article-generate-settings" aria-labelledby="article-generate-title">
    <header className="article-ai-task-section-heading"><h2 id="article-generate-title">正文生成</h2><p>{global ? "文章默认跟随以下设置，文章、章节和大纲可以逐项修改。" : "新大纲和尚未单独调整过的大纲会使用这些选项。"}</p></header>
    <div className="article-generate-basics">
      <Select label="默认模型" aria-label="文章生成默认模型" data={modelOptions} value={selectedModelReference} allowDeselect={false} onChange={(value) => patchSettings({ model: value ?? "" })} />
      <NumberInput label="默认目标字数" aria-label="文章生成默认目标字数" min={0} max={MAX_GENERATE_TARGET_WORDS} step={100} thousandSeparator="," suffix=" 字" placeholder="不限" value={settings.targetWords || ""} onChange={(value) => patchSettings({ targetWords: value === "" ? 0 : Number(value) })} />
    </div>
    <section className="article-generate-block" aria-labelledby="article-generate-mode-title">
      <div className="generate-section-heading"><span id="article-generate-mode-title">生成方式</span><strong>{contentGenerationModeLabel(settings.contentMode)}</strong></div>
      <div className="generate-mode-options" role="radiogroup" aria-label="文章默认正文生成方式">{contentGenerationModes.map((item) => <button className={settings.contentMode === item.value ? "selected" : ""} type="button" role="radio" aria-checked={settings.contentMode === item.value} key={item.value} onClick={() => patchSettings({ contentMode: item.value })}><span className="ui-title">{item.label}</span></button>)}</div>
      <p className="generate-mode-description">{contentGenerationModes.find((item) => item.value === settings.contentMode)?.mobileDescription}</p>
      {settings.contentMode === "rewrite" && <div className="rewrite-retention-control article-rewrite-retention"><div className="rewrite-retention-heading"><div><span>默认原文保留度</span></div><strong>{rewriteRetentionOption.label} · {rewriteRetentionOption.shortLabel}</strong></div><Slider thumbLabel="默认原文保留度" min={0} max={rewriteRetentionOptions.length - 1} step={1} marks={rewriteRetentionOptions.map((item, index) => ({ value: index, label: item.label }))} value={rewriteRetentionIndex} label={(value) => rewriteRetentionOptions[value]?.shortLabel ?? "平衡改写"} onChange={(value) => patchSettings({ rewriteRetention: rewriteRetentionOptions[value]?.value ?? DEFAULT_REWRITE_RETENTION_LEVEL })} /><p>{rewriteRetentionOption.description}</p></div>}
    </section>
    <section className="article-generate-block prose-controls-section" aria-labelledby="article-prose-controls-title">
            <div className="generate-section-heading"><span id="article-prose-controls-title">表达偏好</span><strong>{global ? "全局默认" : "文章默认"}</strong></div>
      <div className="prose-controls-grid">
        <ProseControlRow id="article-dialogue-density" label="对话密度" value={settings.proseControls.dialogueDensity} options={DIALOGUE_DENSITY_OPTIONS} onChange={(dialogueDensity) => patchSettings({ proseControls: { ...settings.proseControls, dialogueDensity } })} className="dialogue-density-control" />
        <ProseControlRow id="article-introspection-density" label="内心活动" value={settings.proseControls.introspectionDensity} options={INTROSPECTION_DENSITY_OPTIONS} onChange={(introspectionDensity) => patchSettings({ proseControls: { ...settings.proseControls, introspectionDensity } })} />
        <ProseControlRow id="article-description-detail" label="描写细度" value={settings.proseControls.descriptionDetail} options={DESCRIPTION_DETAIL_OPTIONS} onChange={(descriptionDetail) => patchSettings({ proseControls: { ...settings.proseControls, descriptionDetail } })} />
        <ProseControlRow id="article-narrative-pace" label="叙事节奏" value={settings.proseControls.narrativePace} options={NARRATIVE_PACE_OPTIONS} onChange={(narrativePace) => patchSettings({ proseControls: { ...settings.proseControls, narrativePace } })} />
        <ProseControlRow id="article-paragraph-length" label="段落长度" value={settings.proseControls.paragraphLength} options={PARAGRAPH_LENGTH_OPTIONS} onChange={(paragraphLength) => patchSettings({ proseControls: { ...settings.proseControls, paragraphLength } })} />
        <ProseControlRow id="article-closing-summary" label="收尾总结" value={settings.closingSummaryLength} options={CLOSING_SUMMARY_OPTIONS} onChange={(closingSummaryLength) => patchSettings({ closingSummaryLength })} className="closing-summary-control" />
      </div>
    </section>
    <GenerateAdvancedFields value={settings.advanced} onChange={advanced => patchSettings({ advanced })} />
    <section className="article-generate-block article-generate-references" aria-labelledby="article-generate-reference-title">
      <div className="generate-section-heading"><span id="article-generate-reference-title">参考内容</span></div>
      <div className="article-generate-toggle-grid">
        <Checkbox label="包含前面大纲" checked={settings.includePrevious} onChange={(event) => patchSettings({ includePrevious: event.currentTarget.checked })} />
        <Checkbox label="包含相关人物" checked={settings.includeCharacters} onChange={(event) => patchSettings({ includeCharacters: event.currentTarget.checked })} />
        <Checkbox label="参考优秀片段" checked={settings.includeExcellentFragments} onChange={(event) => patchSettings({ includeExcellentFragments: event.currentTarget.checked })} />
      </div>
    </section>
    <section className="article-generate-block" aria-label="生成附加项"><div className="generate-section-heading"><span>生成附加项</span></div><Checkbox label="同时生成大纲名" checked={settings.includeOutlineTitle} onChange={event => patchSettings({ includeOutlineTitle: event.currentTarget.checked })} /></section>
    <section className="article-generate-block article-generate-reasoning" aria-label="文章生成推理设置"><ReasoningSettings value={settings.reasoningEffort} modelValue={selectedRecord?.reasoningEffort} onChange={(reasoningEffort) => patchSettings({ reasoningEffort })} /></section>
    <div className="form-foot"><span>{global ? "全局默认 · 仅影响跟随此设置的新任务" : overriddenOutlines ? `${overriddenOutlines} 条大纲已保存自己的最近设置` : "全部大纲均跟随此预设"}</span><span className="save-state"><i /> 已自动保存</span></div>
  </section>;
}

