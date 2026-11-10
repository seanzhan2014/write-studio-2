

import { normalizePreparationRounds, normalizePreparationStrategy } from "./writing-preparation.ts";
import { DEFAULT_EXPANSION_MULTIPLIER, normalizeExpansionMultiplier } from "./outline-expansion.ts";

import { normalizeIllustrationStyles } from "./illustration-styles.ts";

import { DEFAULT_APPEARANCE, normalizeAppearance } from "./appearance.mjs";

import { normalizeReviewRounds, normalizeReviewRules, normalizeReviewStrategy } from "./generate-review.mjs";

import type { StudioData } from "./studio-types.ts";

import { DEFAULT_GENERATE_TARGET_WORDS, normalizeGeneratePresets, normalizeGenerateTargetWords } from "./generate-options.ts";

import { normalizeReviewPresets } from "./review-options.ts";
import { normalizeAiGenerateOptions } from "./generate-options.ts";
import { normalizeIllustrationOptions } from "./illustration-options.ts";
import { normalizeReviewRuleItems } from "./review-rules.mjs";

import { DEFAULT_TASK_CONCURRENCY, normalizeTaskConcurrency } from "./task-concurrency.ts";
import { DEFAULT_STYLE_LEARNING_SETTINGS, normalizeStyleLearningSettings } from "./style-learning-settings.ts";

export const DEFAULT_STUDIO_SETTINGS: StudioData["settings"] = {
  ...DEFAULT_APPEARANCE,
  outlineExpanded: true, showArchived: false, openLastArticle: true, taskConcurrency: DEFAULT_TASK_CONCURRENCY, preparationEnabled: true, preparationMaxRounds: 3, preparationStrategy: "minimal", preparationRequireConfirmation: false,
  chatModel: "", generateModel: "", namingModelMode: "inherit", namingModel: "", reviewModel: "", reviewModelMode: "inherit", generateReviewMaxRounds: 0, generateReviewStrategy: "minimal", generateReviewInstruction: "", generateTargetWords: DEFAULT_GENERATE_TARGET_WORDS, generatePresets: [],
  reviewPresets: [],
  outlineExpansionMultiplier: DEFAULT_EXPANSION_MULTIPLIER,
  styleLearningSettings: DEFAULT_STYLE_LEARNING_SETTINGS,
};

export function normalizeStudioSettings(value: unknown): StudioData["settings"] {
  const settings = value && typeof value === "object" ? value as Partial<StudioData["settings"]> : {};
  return {
    ...DEFAULT_STUDIO_SETTINGS,
    ...settings,
    ...normalizeAppearance(settings),
    styleLearningSettings: normalizeStyleLearningSettings(settings.styleLearningSettings),
    ...(settings.aiGenerateSettings ? { aiGenerateSettings: normalizeAiGenerateOptions(settings.aiGenerateSettings) } : {}),
    illustrationSettings: normalizeIllustrationOptions(settings.illustrationSettings),
    reviewRuleItems: normalizeReviewRuleItems(settings.reviewRuleItems, "global"),
    taskConcurrency: normalizeTaskConcurrency(settings.taskConcurrency),
    illustrationStyles: normalizeIllustrationStyles(settings.illustrationStyles),
    namingModelMode: settings.namingModelMode === "fixed" ? "fixed" : "inherit",
    namingModel: String(settings.namingModel ?? ""),
    illustrationPromptModel: String(settings.illustrationPromptModel ?? ""),
    illustrationImageModel: String(settings.illustrationImageModel ?? ""),
    generateTargetWords: normalizeGenerateTargetWords(settings.generateTargetWords),
    outlineExpansionMultiplier: normalizeExpansionMultiplier(settings.outlineExpansionMultiplier),
    generatePresets: normalizeGeneratePresets(settings.generatePresets),
    reviewPresets: normalizeReviewPresets(settings.reviewPresets),
    generateReviewMaxRounds: normalizeReviewRounds(settings.generateReviewMaxRounds),
    generateReviewStrategy: normalizeReviewStrategy(settings.generateReviewStrategy),
    generateReviewInstruction: normalizeReviewRules(settings.generateReviewInstruction),
    reviewModelMode: settings.reviewModelMode === "fixed" ? "fixed" : "inherit",
    preparationEnabled: settings.preparationEnabled !== false,
    preparationMaxRounds: normalizePreparationRounds(settings.preparationMaxRounds),
    preparationStrategy: normalizePreparationStrategy(settings.preparationStrategy),
    preparationRequireConfirmation: settings.preparationRequireConfirmation === true,
  };
}
