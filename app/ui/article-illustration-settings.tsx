"use client";

import { Select, Textarea, TextInput } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { normalizeIllustrationStyles, resolveIllustrationStyle } from "@/lib/illustration-styles";
import { ILLUSTRATION_RESOLUTION_OPTIONS, MAX_ILLUSTRATION_ADDITIONAL_PROMPT, PROMPT_LANGUAGE_OPTIONS, normalizeIllustrationOptions, type IllustrationOptions } from "@/lib/illustration-options";
import { articleAiSettings, globalAiSettings, overrideAiSettings } from "@/lib/ai-settings-inheritance";

export function ArticleIllustrationSettings({ global = false }: { global?: boolean } = {}) {
  const studio = useStudio();
  const article = studio.currentArticle;
  const styles = normalizeIllustrationStyles(studio.data.settings.illustrationStyles);
  const settings = global ? globalAiSettings("illustration", studio.data.settings) : articleAiSettings(article, "illustration", studio.data.settings);
  const overridden = article.chapters.reduce((count, chapter) => count + chapter.outlines.filter(outline => outline.illustrationOptions != null).length, 0);
  const patch = (value: Partial<IllustrationOptions>) => global ? studio.updateSettings({ illustrationSettings: normalizeIllustrationOptions(overrideAiSettings(settings, value)) }) : studio.updateArticle({ illustrationSettings: normalizeIllustrationOptions(overrideAiSettings(settings, value)) });
  const resolutions = settings.resolution && !ILLUSTRATION_RESOLUTION_OPTIONS.some(option => option.value === settings.resolution)
    ? [...ILLUSTRATION_RESOLUTION_OPTIONS, { value: settings.resolution, label: settings.resolution }]
    : ILLUSTRATION_RESOLUTION_OPTIONS;
  return <section className={`${global ? "ai-task-section ai-task-image-options" : "form-card"} article-ai-task-section`} aria-labelledby="article-illustration-title">
    <header className="article-ai-task-section-heading"><h2 id="article-illustration-title">{global ? "生成选项" : "图片生成设置"}</h2>{!global && <p>新大纲和尚未单独调整过的大纲会使用这些选项。</p>}</header>
    <div className="article-generate-basics">
      {global ? <div className="ai-task-readonly"><span>生成 Prompt 的语言</span><strong>英文</strong><small>Prompt 和 Negative Prompt 均使用英文生成。</small></div> : <Select label="生成 Prompt 的语言" aria-label="文章图片 Prompt 默认语言" description="Prompt 和 Negative Prompt 均使用英文生成。" data={[...PROMPT_LANGUAGE_OPTIONS]} value="en" allowDeselect={false} disabled />}
      <Select label="默认风格" aria-label="文章图片默认风格" data={styles.map(({ value, label }) => ({ value, label }))} value={resolveIllustrationStyle(settings.stylePreset, styles).value} allowDeselect={false} onChange={value => patch({ stylePreset: value as IllustrationOptions["stylePreset"] })} searchable />
      <Select label="默认分辨率" aria-label="文章图片默认分辨率" description="使用所选模型支持的分辨率；不支持时使用模型默认值。" data={resolutions} value={settings.resolution} allowDeselect={false} onChange={value => patch({ resolution: value ?? "" })} />
    </div>
    <Textarea label="附加 Prompt" aria-label="文章图片附加 Prompt" description="用于图片提示词生成和图片生成。" placeholder="例如：保持人物外貌一致，画面不出现文字或水印。" minRows={3} maxRows={10} autosize maxLength={MAX_ILLUSTRATION_ADDITIONAL_PROMPT} value={settings.additionalPrompt} onChange={event => patch({ additionalPrompt: event.currentTarget.value })} />
    <Textarea label="默认画面要求" value={settings.scenePrompt ?? ""} maxLength={2000} autosize minRows={2} onChange={event => patch({ scenePrompt: event.currentTarget.value })} />
    <div className="article-generate-basics"><TextInput label="默认画面比例" placeholder="模型默认，例如 16:9" value={settings.aspectRatio ?? ""} maxLength={100} onChange={event => patch({ aspectRatio: event.currentTarget.value })} /><TextInput label="默认图片画质" placeholder="模型默认" value={settings.quality ?? ""} maxLength={100} onChange={event => patch({ quality: event.currentTarget.value })} /></div>
    {!global && <div className="form-foot"><span>{overridden ? `${overridden} 条大纲已保存自己的最近设置` : "全部大纲均跟随此预设"}</span><span className="save-state"><i /> 已自动保存</span></div>}
  </section>;
}
