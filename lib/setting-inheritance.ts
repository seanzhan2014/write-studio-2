export type SettingInheritance = Record<string, "article" | "previous" | "global" | "parent">;

export function normalizeSettingInheritance(value: unknown, keys: string[]): SettingInheritance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = Object.fromEntries(Object.entries(value).filter(([key, mode]) => keys.includes(key) && ["article", "previous", "global", "parent"].includes(String(mode)))) as SettingInheritance;
  return Object.keys(result).length ? result : undefined;
}
