"use client";
import { EXPANSION_DECIMALS, isExpansionMultiplier, isSentenceTargetWords, MIN_EXPANSION_MULTIPLIER, MAX_EXPANSION_MULTIPLIER, MAX_SENTENCE_TARGET_WORDS, normalizeExpansionMultiplier, normalizeSentenceTargetWords, normalizeOutlineLengthMode } from "@/lib/outline-expansion";
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

  return <section className={`${global ? "ai-task-generation" : "form-card"} article-ai-task-section article-generate-settings`} aria-labelledby="article-generate-title">
    <header className="article-ai-task-section-heading"><h2 id="article-generate-title">{global ? "模型与篇幅" : "正文生成"}</h2>{!global && <p>新大纲和尚未单独调整过的大纲会使用这些选项。</p>}</header>
    <div className="article-generate-basics">
      <Select label="默认模型" aria-label="文章生成默认模型" data={modelOptions} value={selectedModelReference} allowDeselect={false} onChange={(value) => patchSettings({ model: value ?? "" })} />
      {global && <ReasoningSettings value={settings.reasoningEffort} modelValue={selectedRecord?.reasoningEffort} onChange={(reasoningEffort) => patchSettings({ reasoningEffort })} />}
      <NumberInput label="默认目标字数" aria-label="文章生成默认目标字数" min={0} max={MAX_GENERATE_TARGET_WORDS} step={100} thousandSeparator="," suffix=" 字" placeholder="不限" value={settings.targetWords || ""} onChange={(value) => patchSettings({ targetWords: value === "" ? 0 : Number(value) })} />
    </div>
    {global && <div className="article-generate-block">
      <Select label="默认篇幅控制" aria-label="全局默认篇幅控制" description="新建或未设置的大纲沿用此方式；生成页面切换方式后会记住选择。" value={normalizeOutlineLengthMode(studio.data.settings.outlineLengthMode)} allowDeselect={false} data={[{ value: "target", label: "总体字数控制" }, { value: "multiplier", label: "大纲句子倍率" }, { value: "words", label: "大纲句子字数" }]} onChange={value => studio.updateSettings({ outlineLengthMode: normalizeOutlineLengthMode(value) })} />
      <NumberInput label="大纲展开默认倍率" aria-label="全局大纲默认倍率" description="句子优先跟随前句，再使用大纲默认；大纲未设置时跟随此值。" value={normalizeExpansionMultiplier(studio.data.settings.outlineExpansionMultiplier)} min={MIN_EXPANSION_MULTIPLIER} max={MAX_EXPANSION_MULTIPLIER} decimalScale={EXPANSION_DECIMALS} suffix="×" onChange={value => { if (isExpansionMultiplier(value)) studio.updateSettings({ outlineExpansionMultiplier: value }); }} />
      <NumberInput label="大纲每句默认字数" aria-label="全局大纲每句默认字数" description="逐句字数控制时，首句未设置大纲默认就使用此值。" value={normalizeSentenceTargetWords(studio.data.settings.outlineExpansionWords)} min={1} max={MAX_SENTENCE_TARGET_WORDS} decimalScale={0} suffix=" 字" onChange={value => { if (isSentenceTargetWords(value)) studio.updateSettings({ outlineExpansionWords: value }); }} />
    </div>}
    <section className="article-generate-block" aria-labelledby="article-generate-mode-title">
      <div className="generate-section-heading"><span id="article-generate-mode-title">生成方式</span><strong>{contentGenerationModeLabel(settings.contentMode)}</strong></div>
      <div className="generate-mode-options" role="radiogroup" aria-label="文章默认正文生成方式">{contentGenerationModes.map((item) => <button className={settings.contentMode === item.value ? "selected" : ""} type="button" role="radio" aria-checked={settings.contentMode === item.value} key={item.value} onClick={() => patchSettings({ contentMode: item.value })}><span className="ui-title">{item.label}</span></button>)}</div>
      <p className="generate-mode-description">{contentGenerationModes.find((item) => item.value === settings.contentMode)?.mobileDescription}</p>
      {settings.contentMode === "rewrite" && <div className="rewrite-retention-control article-rewrite-retention"><div className="rewrite-retention-heading"><div><span>默认原文保留度</span></div><strong>{rewriteRetentionOption.label} · {rewriteRetentionOption.shortLabel}</strong></div><Slider thumbLabel="默认原文保留度" min={0} max={rewriteRetentionOptions.length - 1} step={1} marks={rewriteRetentionOptions.map((item, index) => ({ value: index, label: item.label }))} value={rewriteRetentionIndex} label={(value) => rewriteRetentionOptions[value]?.shortLabel ?? "平衡改写"} onChange={(value) => patchSettings({ rewriteRetention: rewriteRetentionOptions[value]?.value ?? DEFAULT_REWRITE_RETENTION_LEVEL })} /><p>{rewriteRetentionOption.description}</p></div>}
    </section>
    <section className="article-generate-block prose-controls-section" aria-labelledby="article-prose-controls-title">
            <div className="generate-section-heading"><span id="article-prose-controls-title">表达偏好</span><strong>{global ? "全局默认" : "文章默认"}</strong></div>
      <div className="prose-controls-grid">
        <ProseControlRow compactHelp={global} id="article-dialogue-density" label="对话密度" value={settings.proseControls.dialogueDensity} options={DIALOGUE_DENSITY_OPTIONS} onChange={(dialogueDensity) => patchSettings({ proseControls: { ...settings.proseControls, dialogueDensity } })} className="dialogue-density-control" />
        <ProseControlRow compactHelp={global} id="article-introspection-density" label="内心活动" value={settings.proseControls.introspectionDensity} options={INTROSPECTION_DENSITY_OPTIONS} onChange={(introspectionDensity) => patchSettings({ proseControls: { ...settings.proseControls, introspectionDensity } })} />
        <ProseControlRow compactHelp={global} id="article-description-detail" label="描写细度" value={settings.proseControls.descriptionDetail} options={DESCRIPTION_DETAIL_OPTIONS} onChange={(descriptionDetail) => patchSettings({ proseControls: { ...settings.proseControls, descriptionDetail } })} />
        <ProseControlRow compactHelp={global} id="article-narrative-pace" label="叙事节奏" value={settings.proseControls.narrativePace} options={NARRATIVE_PACE_OPTIONS} onChange={(narrativePace) => patchSettings({ proseControls: { ...settings.proseControls, narrativePace } })} />
        <ProseControlRow compactHelp={global} id="article-paragraph-length" label="段落长度" value={settings.proseControls.paragraphLength} options={PARAGRAPH_LENGTH_OPTIONS} onChange={(paragraphLength) => patchSettings({ proseControls: { ...settings.proseControls, paragraphLength } })} />
        <ProseControlRow compactHelp={global} id="article-closing-summary" label="收尾总结" value={settings.closingSummaryLength} options={CLOSING_SUMMARY_OPTIONS} onChange={(closingSummaryLength) => patchSettings({ closingSummaryLength })} className="closing-summary-control" />
      </div>
    </section>
    {!global && <GenerateAdvancedFields value={settings.advanced} onChange={advanced => patchSettings({ advanced })} />}
    <section className="article-generate-block article-generate-references" aria-labelledby="article-generate-reference-title">
      <div className="generate-section-heading"><span id="article-generate-reference-title">参考内容</span></div>
      <div className="article-generate-toggle-grid">
        <Checkbox label="包含前面大纲" checked={settings.includePrevious} onChange={(event) => patchSettings({ includePrevious: event.currentTarget.checked })} />
        <Checkbox label="包含相关人物" checked={settings.includeCharacters} onChange={(event) => patchSettings({ includeCharacters: event.currentTarget.checked })} />
        <Checkbox label="参考优秀片段" checked={settings.includeExcellentFragments} onChange={(event) => patchSettings({ includeExcellentFragments: event.currentTarget.checked })} />
        {global && <Checkbox label="同时生成大纲名" checked={settings.includeOutlineTitle} onChange={event => patchSettings({ includeOutlineTitle: event.currentTarget.checked })} />}
      </div>
    </section>
    {!global && <section className="article-generate-block" aria-label="生成附加项"><div className="generate-section-heading"><span>生成附加项</span></div><Checkbox label="同时生成大纲名" checked={settings.includeOutlineTitle} onChange={event => patchSettings({ includeOutlineTitle: event.currentTarget.checked })} /></section>}
    {global ? <GenerateAdvancedFields value={settings.advanced} onChange={advanced => patchSettings({ advanced })} /> : <section className="article-generate-block article-generate-reasoning" aria-label="文章生成推理设置"><ReasoningSettings value={settings.reasoningEffort} modelValue={selectedRecord?.reasoningEffort} onChange={(reasoningEffort) => patchSettings({ reasoningEffort })} /></section>}
    {!global && <div className="form-foot"><span>{overriddenOutlines ? `${overriddenOutlines} 条大纲已保存自己的最近设置` : "全部大纲均跟随此预设"}</span><span className="save-state"><i /> 已自动保存</span></div>}
  </section>;
}

