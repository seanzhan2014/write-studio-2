export type VersionedOutlineContent = {
  content: string;
  contentOverride?: boolean;
  sourceVersionId?: string;
  versions: Array<{ id: string; content: string }>;
};

export function defaultOutlineVersion<T extends VersionedOutlineContent>(outline: T) {
  if (!outline.sourceVersionId) return undefined;
  return outline.versions.find((version) => version.id === outline.sourceVersionId);
}

export function resolvedOutlineContent(outline: VersionedOutlineContent) {
  if (outline.contentOverride) return outline.content;
  return defaultOutlineVersion(outline)?.content ?? "";
}
