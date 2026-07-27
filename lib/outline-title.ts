export const MAX_OUTLINE_TITLE_LENGTH = 80;

const legacyUntitledOutline = "未命名大纲";
const emptyOutlineLabel = "新建大纲";

export function normalizeOutlineTitle(value: unknown) {
  const title = String(value ?? "").trim().slice(0, MAX_OUTLINE_TITLE_LENGTH);
  return title === legacyUntitledOutline ? "" : title;
}

export function outlineDisplayTitle(outline: { title?: unknown; plan?: unknown }) {
  const title = normalizeOutlineTitle(outline.title);
  if (title) return title;
  const planStart = String(outline.plan ?? "").replace(/\s+/g, " ").trim();
  return planStart.slice(0, MAX_OUTLINE_TITLE_LENGTH) || emptyOutlineLabel;
}
