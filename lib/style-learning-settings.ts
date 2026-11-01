export type StyleLearningSettings = { model: string; maxRounds: number; autoApply: boolean };

export const DEFAULT_STYLE_LEARNING_SETTINGS: StyleLearningSettings = { model: "", maxRounds: 3, autoApply: true };

export function normalizeStyleLearningSettings(value: unknown): StyleLearningSettings {
  const source = value && typeof value === "object" ? value as Partial<StyleLearningSettings> : {};
  return {
    model: typeof source.model === "string" ? source.model.trim().slice(0, 300) : "",
    maxRounds: typeof source.maxRounds === "number" && Number.isInteger(source.maxRounds) ? Math.max(1, Math.min(10, source.maxRounds)) : 3,
    autoApply: source.autoApply !== false,
  };
}

export function resolveStyleLearningSettings(settings: { styleLearningSettings?: unknown }, articleModel: string): StyleLearningSettings {
  const defaults = normalizeStyleLearningSettings(settings.styleLearningSettings);
  return { ...defaults, model: defaults.model || articleModel };
}
