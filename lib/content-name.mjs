function validDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function timestampContentName(value = new Date()) {
  return validDate(value).toISOString().slice(0, 19).replace("T", " ");
}

export function resolvedOutlineContentName(outline) {
  if (outline.contentOverride) return String(outline.contentName ?? "").trim() || timestampContentName(outline.updatedAt);
  const version = outline.sourceVersionId ? outline.versions.find((item) => item.id === outline.sourceVersionId) : undefined;
  return String(version?.name ?? outline.contentName ?? "").trim() || timestampContentName(outline.updatedAt);
}

export function aiReviewContentName(outline) {
  return `${resolvedOutlineContentName(outline)} · AI Review`;
}
