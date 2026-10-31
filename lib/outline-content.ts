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
  versions: Array<{ id: string; name?: string; content: string; createdAt?: string; lastSelectedAt?: string; outlineSnapshot?: { title: string; plan: string } }>;
};

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

const timestamp = (value?: string) => value ? Date.parse(value) || 0 : 0;

/** Record selection order independently of version creation time. */
export function selectOutlineVersion<T extends VersionedOutlineContent>(outline: T, versionId: string | null, updatedAt = new Date().toISOString()): T {
  if (versionId && !outline.versions.some((version) => version.id === versionId)) return outline;
  const previous = currentOutlineVersion(outline);
  if (outline.currentVersionId === versionId) return outline;
  const selectedAt = Math.max(timestamp(updatedAt), ...outline.versions.map((version) => timestamp(version.lastSelectedAt) + 2));
  return {
    ...outline,
    currentVersionId: versionId,
    updatedAt,
    versions: outline.versions.map((version) => version.id === versionId
      ? { ...version, lastSelectedAt: new Date(selectedAt).toISOString() }
      : version.id === previous?.id && !version.lastSelectedAt
        ? { ...version, lastSelectedAt: new Date(selectedAt - 1).toISOString() }
        : version),
  };
}

export function deleteOutlineVersion<T extends VersionedOutlineContent>(outline: T, versionId: string | null, updatedAt = new Date().toISOString()): T {
  if (versionId === null) {
    const next = { ...outline, content: "", contentName: undefined, contentOutlineSnapshot: undefined, manualExcellent: false, excellentFragments: [], updatedAt };
    return currentOutlineVersion(outline) ? next : selectOutlineVersion(next, outline.versions[0]?.id ?? null, updatedAt);
  }
  const index = outline.versions.findIndex((version) => version.id === versionId);
  if (index < 0) return outline;
  const versions = outline.versions.filter((version) => version.id !== versionId);
  const next = {
    ...outline, versions, updatedAt,
    defaultVersionId: outline.defaultVersionId === versionId ? null : outline.defaultVersionId,
    ...(outline.sourceVersionId === versionId ? { sourceVersionId: undefined } : {}),
  };
  if (currentOutlineVersion(outline)?.id !== versionId) return next;
  const successor = versions[index] ?? versions[0];
  return selectOutlineVersion(next, successor?.id ?? null, updatedAt);
}
