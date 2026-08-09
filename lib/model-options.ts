export const DEFAULT_MAX_INPUT_CHARACTERS = 60_000;
export const MIN_MAX_INPUT_CHARACTERS = 4_000;
export const MAX_MAX_INPUT_CHARACTERS = 2_000_000;

export function normalizeMaxInputCharacters(value: unknown, fallback = DEFAULT_MAX_INPUT_CHARACTERS) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(MIN_MAX_INPUT_CHARACTERS, Math.min(MAX_MAX_INPUT_CHARACTERS, parsed));
}
