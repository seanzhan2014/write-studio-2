export type FontChoice = "sans" | "serif" | "kai" | "mono";
export type AppearanceSettings = {
  theme: "light" | "dark" | "system";
  accentColor: string;
  uiFont: FontChoice;
  editorFont: FontChoice;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
};
export const DEFAULT_APPEARANCE: AppearanceSettings;
export const FONT_OPTIONS: Array<{ value: FontChoice; label: string; family: string }>;
export const COLOR_PRESETS: Array<{ label: string; color: string }>;
export function normalizeAppearance(value?: unknown): AppearanceSettings;
export function fontFamily(value: string): string;
export function mixColor(base: string, target: string, amount: number): string;
export function appearanceColors(color: string, dark: boolean): Record<string, string>;
