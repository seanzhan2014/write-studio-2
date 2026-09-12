export const MAX_REVIEW_PRESETS = 20;
export const MAX_REVIEW_PRESET_CHARACTERS = 2000;

export function normalizeReviewPresets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => String(item).trim().slice(0, MAX_REVIEW_PRESET_CHARACTERS))
    .filter(Boolean))]
    .slice(0, MAX_REVIEW_PRESETS);
}
