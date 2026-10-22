export type SettingInheritance = Record<string, "article" | "previous">;

export function normalizeSettingInheritance(value: unknown, keys: string[]): SettingInheritance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = Object.fromEntries(Object.entries(value).filter(([key, mode]) => keys.includes(key) && (mode === "article" || mode === "previous"))) as SettingInheritance;
  return Object.keys(result).length ? result : undefined;
}
