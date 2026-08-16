function validDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function timestampContentName(value = new Date()) {
  return validDate(value).toISOString().slice(0, 19).replace("T", " ");
}

export function localTimestampContentName(value = new Date()) {
  const date = validDate(value);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function modelIdSuffix(value) {
  const identifier = String(value ?? "").trim();
  if (!identifier) return "";
  const suffix = identifier.slice(identifier.lastIndexOf("/") + 1).trim();
  return suffix || identifier;
}

export function aiGenerateContentName(modelId, value = new Date()) {
  const suffix = modelIdSuffix(modelId);
  return `${localTimestampContentName(value)}${suffix ? ` · ${suffix}` : ""}`;
}

export function resolvedOutlineContentName(outline) {
  const hasCurrentVersionId = Object.prototype.hasOwnProperty.call(outline, "currentVersionId");
  const versionId = hasCurrentVersionId
    ? outline.currentVersionId
    : outline.contentOverride === false
      ? outline.sourceVersionId
      : undefined;
  const version = versionId ? outline.versions.find((item) => item.id === versionId) : undefined;
  return String(version?.name ?? outline.contentName ?? "").trim() || timestampContentName(outline.updatedAt);
}

export function aiReviewContentName(outline) {
  return `${resolvedOutlineContentName(outline)} · AI Review`;
}
