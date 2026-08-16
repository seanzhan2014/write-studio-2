export type VersionedOutlineContent = {
  content: string;
  contentName?: string;
  currentVersionId?: string | null;
  defaultVersionId?: string | null;
  contentOutlineSnapshot?: { title: string; plan: string };
  /** Legacy migration field. Runtime code must not use it as current state. */
  contentOverride?: boolean;
  /** Legacy migration field. Runtime code must not use it as current state. */
  sourceVersionId?: string;
  versions: Array<{ id: string; name?: string; content: string; outlineSnapshot?: { title: string; plan: string } }>;
};

export function defaultOutlineVersion<T extends VersionedOutlineContent>(outline: T) {
  const versionId = Object.prototype.hasOwnProperty.call(outline, "defaultVersionId")
    ? outline.defaultVersionId
    : outline.sourceVersionId;
  if (!versionId) return undefined;
  return outline.versions.find((version) => version.id === versionId);
}

export function currentOutlineVersion<T extends VersionedOutlineContent>(outline: T): T["versions"][number] | undefined {
  if (Object.prototype.hasOwnProperty.call(outline, "currentVersionId")) {
    if (!outline.currentVersionId) return undefined;
    return outline.versions.find((version) => version.id === outline.currentVersionId);
  }
  // One-time compatibility for data saved before current and default were split.
  if (!outline.contentOverride && outline.sourceVersionId) {
    return outline.versions.find((version) => version.id === outline.sourceVersionId);
  }
  return undefined;
}

export function resolvedOutlineContent(outline: VersionedOutlineContent) {
  return currentOutlineVersion(outline)?.content ?? outline.content;
}

export function resolvedOutlineSnapshot(outline: VersionedOutlineContent) {
  return currentOutlineVersion(outline)?.outlineSnapshot
    ?? outline.contentOutlineSnapshot
    ?? { title: "", plan: "" };
}
