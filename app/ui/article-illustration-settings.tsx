"use client";

import { Select } from "@mantine/core";
import { useStudio } from "@/app/studio-state";
import { ILLUSTRATION_STYLES } from "@/lib/illustration-styles";
import { ILLUSTRATION_RESOLUTION_OPTIONS, PROMPT_LANGUAGE_OPTIONS, normalizeIllustrationOptions, type IllustrationOptions } from "@/lib/illustration-options";

export function ArticleIllustrationSettings() {
  const studio = useStudio();
  const article = studio.currentArticle;
  const settings = normalizeIllustrationOptions(article.illustrationSettings);
  const overridden = article.chapters.reduce((count, chapter) => count + chapter.outlines.filter(outline => outline.illustrationOptions != null).length, 0);
  const patch = (value: Partial<IllustrationOptions>) => studio.updateArticle({ illustrationSettings: normalizeIllustrationOptions({ ...settings, ...value }) });
  const resolutions = settings.resolution && !ILLUSTRATION_RESOLUTION_OPTIONS.some(option => option.value === settings.resolution)
    ? [...ILLUSTRATION_RESOLUTION_OPTIONS, { value: settings.resolution, label: settings.resolution }]
    : ILLUSTRATION_RESOLUTION_OPTIONS;
  return <section className="form-card article-ai-task-section" aria-labelledby="article-illustration-title">
    <header className="article-ai-task-section-heading"><h2 id="article-illustration-title">图片风格</h2><p>新大纲和尚未单独调整过的大纲会使用这些选项。</p></header>
    <div className="article-generate-basics">
      <Select label="生成 Prompt 的语言" aria-label="文章图片 Prompt 默认语言" data={[...PROMPT_LANGUAGE_OPTIONS]} value={settings.promptLanguage} allowDeselect={false} onChange={value => patch({ promptLanguage: value as IllustrationOptions["promptLanguage"] })} />
      <Select label="默认风格" aria-label="文章图片默认风格" data={ILLUSTRATION_STYLES.map(({ value, label }) => ({ value, label }))} value={settings.stylePreset} allowDeselect={false} onChange={value => patch({ stylePreset: value as IllustrationOptions["stylePreset"] })} searchable />
      <Select label="默认分辨率" aria-label="文章图片默认分辨率" description="使用所选模型支持的分辨率；不支持时使用模型默认值。" data={resolutions} value={settings.resolution} allowDeselect={false} onChange={value => patch({ resolution: value ?? "" })} />
    </div>
    <div className="form-foot"><span>{overridden ? `${overridden} 条大纲已保存自己的最近设置` : "全部大纲均跟随此预设"}</span><span className="save-state"><i /> 已自动保存</span></div>
  </section>;
}
