export type VersionedOutlineContent = {
  content: string;
  contentName?: string;
  contentOverride?: boolean;
  sourceVersionId?: string;
  versions: Array<{ id: string; name?: string; content: string }>;
};

export function defaultOutlineVersion<T extends VersionedOutlineContent>(outline: T) {
  if (!outline.sourceVersionId) return undefined;
  return outline.versions.find((version) => version.id === outline.sourceVersionId);
}

export function currentOutlineVersion<T extends VersionedOutlineContent>(outline: T): T["versions"][number] | undefined {
  if (!outline.contentOverride) return defaultOutlineVersion(outline);
  if (!outline.contentName) return undefined;
  return outline.versions.find((version) => version.name === outline.contentName && version.content === outline.content);
}

export function resolvedOutlineContent(outline: VersionedOutlineContent) {
  if (outline.contentOverride) return outline.content;
  return defaultOutlineVersion(outline)?.content ?? "";
}
