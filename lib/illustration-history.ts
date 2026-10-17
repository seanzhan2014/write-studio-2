import type { IllustrationStylePreset } from "./illustration-styles";
import type { IllustrationPromptLanguage } from "./illustration-options";

export type IllustrationStatus = "queued" | "running" | "success" | "error" | "cancelled";
export type IllustrationRecord = {
  id: string; outlineId: string; outlineTitle: string; kind: "prompt" | "image";
  status: IllustrationStatus; prompt: string; excerpt: string; style: string; stylePreset?: IllustrationStylePreset;
  promptLanguage?: IllustrationPromptLanguage;
  model: string; modelName: string; archived: boolean; error?: string;
  src?: string; revisedPrompt?: string; createdAt: string; completedAt?: string;
  characterReference?: import("./character-visual").CharacterReference;
};
export const illustrationStatusLabels: Record<IllustrationStatus, string> = {
  queued: "等待中", running: "生成中", success: "已保存", error: "失败", cancelled: "已取消",
};
export function illustrationIsActive(record: IllustrationRecord) {
  return record.status === "queued" || record.status === "running";
}
