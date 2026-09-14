export const DEFAULT_APPEARANCE = {
  theme: "light", accentColor: "#755835", uiFont: "sans", editorFont: "sans",
  fontSize: 17, lineHeight: 1.8, contentWidth: 920,
};

export const FONT_OPTIONS = [
  { value: "sans", label: "系统无衬线", family: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif' },
  { value: "serif", label: "宋体 / 衬线", family: 'Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif' },
  { value: "kai", label: "楷体", family: '"Kaiti SC", "STKaiti", "KaiTi", "BiauKai", serif' },
  { value: "mono", label: "等宽字体", family: 'ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, "Microsoft YaHei", monospace' },
];

export const COLOR_PRESETS = [
  { label: "暖棕", color: "#755835" },
  { label: "海蓝", color: "#2563a6" },
  { label: "松绿", color: "#28735b" },
  { label: "鸢紫", color: "#7951a8" },
  { label: "玫瑰", color: "#ae4567" },
  { label: "石墨", color: "#5b6472" },
];

export function normalizeAppearance(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const font = (key) => FONT_OPTIONS.some((item) => item.value === source[key]) ? source[key] : DEFAULT_APPEARANCE[key];
  const bounded = (key, min, max) => typeof source[key] === "number" && Number.isFinite(source[key])
    ? Math.min(max, Math.max(min, source[key])) : DEFAULT_APPEARANCE[key];
  return {
    theme: ["light", "dark", "system"].includes(source.theme) ? source.theme : DEFAULT_APPEARANCE.theme,
    accentColor: typeof source.accentColor === "string" && /^#[\da-f]{6}$/i.test(source.accentColor) ? source.accentColor.toLowerCase() : DEFAULT_APPEARANCE.accentColor,
    uiFont: font("uiFont"), editorFont: font("editorFont"),
    fontSize: bounded("fontSize", 14, 24), lineHeight: bounded("lineHeight", 1.4, 2.2), contentWidth: bounded("contentWidth", 640, 1200),
  };
}

export function fontFamily(value) {
  return (FONT_OPTIONS.find((item) => item.value === value) ?? FONT_OPTIONS[0]).family;
}

const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
export function mixColor(base, target, amount) {
  const other = rgb(target);
  return `#${rgb(base).map((channel, i) => Math.round(channel + (other[i] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(color) {
  const channels = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function appearanceColors(color, dark) {
  const surface = dark ? mixColor("#232421", color, 0.04) : "#ffffff";
  let accent = color;
  for (let step = 1; step <= 20 && contrast(accent, surface) < 4.8; step++) {
    accent = mixColor(color, dark ? "#ffffff" : "#000000", step / 20);
  }
  return {
    "--app-bg": mixColor(dark ? "#171816" : "#f7f7f5", color, dark ? 0.035 : 0.025),
    "--sidebar-bg": mixColor(dark ? "#1d1e1b" : "#f1f1ee", color, 0.04),
    "--surface": surface,
    "--surface-hover": mixColor(dark ? "#30312d" : "#e9e9e5", color, 0.055),
    "--surface-selected": mixColor(dark ? "#383a35" : "#e2e2dd", color, 0.08),
    "--border": dark ? "#3a3b36" : "#deded8",
    "--border-soft": dark ? "#2d2e2a" : "#e9e9e4",
    "--text-primary": dark ? "#eeeee9" : "#20201e",
    "--text-secondary": dark ? "#aaaba3" : "#6e6e68",
    "--text-disabled": dark ? "#73756d" : "#a5a59f",
    "--accent": accent,
    "--accent-hover": mixColor(accent, dark ? "#ffffff" : "#000000", 0.15),
    "--accent-soft": mixColor(surface, accent, dark ? 0.16 : 0.09),
    "--accent-contrast": contrast(accent, "#ffffff") >= 4.5 ? "#ffffff" : "#171816",
    "--success": dark ? "#58bd6c" : "#238636",
    "--warning": dark ? "#d2a451" : "#b7791f",
    "--danger": dark ? "#ef746b" : "#d13c32",
  };
}
