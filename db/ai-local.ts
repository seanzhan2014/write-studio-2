

import { type ContentGenerationMode } from "@/lib/generate-options";

import { DEFAULT_OUTLINE_NAMING_PROFILE, normalizeNamingProfile, type NamingProfile } from "@/lib/naming-options";

import { type GenerateTarget, type GenerateResult } from "@/db/ai-prompts";

export function localOutlineTitle(title: string, plan: string, instruction: string) {
  const source = `${plan || instruction || title}`.split(/[。！？!?；;\n]/).map((item) => item.trim()).find(Boolean) ?? "";
  const expanded = `${source}${source.length < 10 ? "引发的关键转折" : ""}`.replace(/[“”‘’'"《》【】]/g, "");
  return Array.from(expanded || "故事线索引发的关键转折").slice(0, 20).join("");
}

export function localNameForProfile(title: string, plan: string, instruction: string, profile: NamingProfile, variant = 0) {
  const normalized = normalizeNamingProfile(profile, DEFAULT_OUTLINE_NAMING_PROFILE);
  const markers = Array.from("潮雾灯夜风雨星月山海云雪舟城门塔");
  const markerAt = (offset: number) => {
    const index = variant * 4 + offset;
    return `${markers[index % markers.length]}${markers[Math.floor(index / markers.length) % markers.length]}`;
  };
  if (normalized.format === "five") return Array.from({ length: normalized.lineCount }, (_, index) => `${markerAt(index)}入旧梦`).join("，");
  if (normalized.format === "seven") return Array.from({ length: normalized.lineCount }, (_, index) => `${markerAt(index)}孤城夜未央`).join("，");
  if (normalized.format === "cipai") return Array.from({ length: normalized.lineCount }, (_, index) => `${markerAt(index)}入旧梦`).join("，");
  const source = localOutlineTitle(title, plan, instruction).replace(/[\s\p{P}\p{S}]/gu, "");
  const padded = `${variant ? markerAt(0) : ""}${source}故事转折潮汐回声`;
  return Array.from(padded).slice(0, Math.max(normalized.minCharacters, Math.min(normalized.maxCharacters, Array.from(source).length))).join("");
}

export function appendContinuation(existing: string, continuation: string) {
  const before = existing.trimEnd();
  const after = continuation.trimStart();
  if (!before) return after;
  if (after.startsWith(before)) return after;
  return `${before}\n\n${after}`;
}

export function localGenerate(target: GenerateTarget, title: string, plan: string, content: string, instruction: string, targetWords: number, includeOutlineTitle: boolean, contentMode: ContentGenerationMode = "fresh", outlineNaming: NamingProfile = DEFAULT_OUTLINE_NAMING_PROFILE): GenerateResult {
  if (target === "chapter-title") return { text: `潮汐留下的${title.includes("七") ? "回声" : "一封信"}` };
  if (target === "outline") return { text: `${plan}${plan.trim() ? "\n\n" : ""}补充：围绕“${instruction.slice(0, 40)}”升级冲突，让角色作出明确选择，并在结尾留下推动下一条大纲的行动。` };
  const paragraph = `潮声在废弃码头的水泥柱之间来回折返。林澈按照“${plan || title}”留下的线索向前，终于在退潮后的石阶上看见一道新鲜划痕。那不是答案，而是一个只留给她的时间：今晚十一点四十七分。她收起潮汐表，决定在下一次雾笛响起前找到入口。`;
  let result = "";
  while (result.length < targetWords) result += `${result ? "\n\n" : ""}${paragraph}`;
  const generated = result.slice(0, targetWords);
  return { text: contentMode === "continue" ? appendContinuation(content, generated) : generated, outlineTitle: includeOutlineTitle ? localNameForProfile(title, plan, instruction, outlineNaming) : undefined };
}
