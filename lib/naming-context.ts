import { resolveAiSettings, readAiSetting } from "./ai-settings-inheritance.ts";
import { taskReasoningEffort, taskNamingProfile } from "./task-parameters.ts";
import type { AiGenerateOptions } from "./generate-options.ts";
import type { Article } from "./studio-types.ts";
import type { NamingArticleContext } from "@/db/ai-naming";

export function namingArticleContext(article: Article, globalSettings: object = {}): NamingArticleContext {
  const defaults = resolveAiSettings(article, article.id, "generate", "outline", globalSettings).globalDefaults;
  const namingFor = (id: string, level: "chapter" | "outline") => {
    const options = resolveAiSettings(article, id, "generate", level, globalSettings).value;
    const build = (value: AiGenerateOptions) => ({ model: String(value.tasks!.namingModelMode === "fixed" ? value.tasks!.namingModel : value.model), reasoningEffort: taskReasoningEffort(value.tasks!.namingReasoningEffort), chapterNaming: taskNamingProfile(value.tasks!, "chapterNaming"), outlineNaming: taskNamingProfile(value.tasks!, "outlineNaming") });
    const settings = build(options);
    const raw = level === "outline" ? article.chapters.flatMap(chapter => chapter.outlines).find(outline => outline.id === id)?.generateOptions : undefined;
    const keys = ["model", "tasks.namingModel", "tasks.namingModelMode", "tasks.namingReasoningEffort", ...Object.keys(settings.chapterNaming).map(key => "tasks.chapterNaming_" + key), ...Object.keys(settings.outlineNaming).map(key => "tasks.outlineNaming_" + key)];
    const explicit = raw && keys.some(key => readAiSetting(raw, key) !== undefined && !raw.inheritance?.[key]);
    return !explicit && JSON.stringify(settings) === JSON.stringify(build(defaults)) ? undefined : settings;
  };
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    style: article.style,
    chapterNaming: taskNamingProfile(defaults.tasks!, "chapterNaming"),
    outlineNaming: taskNamingProfile(defaults.tasks!, "outlineNaming"),
    chapters: article.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      archived: chapter.archived,
      naming: namingFor(chapter.id, "chapter"),
      outlines: chapter.outlines.map((outline) => ({ id: outline.id, title: outline.title, plan: outline.plan, archived: outline.archived, naming: namingFor(outline.id, "outline") })),
    })),
  };
}

