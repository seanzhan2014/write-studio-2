export type NameVersion = {
  id: string;
  title: string;
  source: "manual" | "ai";
  createdAt: string;
  model?: string;
  instruction?: string;
};

export type NameVersionState = {
  nameVersions: NameVersion[];
  defaultNameVersionId: string | null;
};

function normalizedTitle(value: unknown, maximum: number) {
  return String(value ?? "").trim().slice(0, maximum);
}

export function normalizeNameVersionState(
  entityId: string,
  currentTitle: unknown,
  sourceVersions: unknown,
  sourceDefaultId: unknown,
  createdAt: string,
  maximum: number,
): NameVersionState {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const versions = (Array.isArray(sourceVersions) ? sourceVersions : []).flatMap((source) => {
    if (!source || typeof source !== "object") return [];
    const item = source as Partial<NameVersion>;
    const id = String(item.id ?? "").trim();
    const title = normalizedTitle(item.title, maximum);
    if (!id || !title || seenIds.has(id) || seenTitles.has(title)) return [];
    seenIds.add(id);
    seenTitles.add(title);
    return [{
      id,
      title,
      source: item.source === "ai" ? "ai" as const : "manual" as const,
      createdAt: String(item.createdAt ?? createdAt),
      ...(item.model?.trim() ? { model: item.model.trim().slice(0, 300) } : {}),
      ...(item.instruction?.trim() ? { instruction: item.instruction.trim().slice(0, 20_000) } : {}),
    }];
  }).slice(0, 100);

  const title = normalizedTitle(currentTitle, maximum);
  let current = title ? versions.find((item) => item.title === title) : undefined;
  if (title && !current) {
    current = { id: `name-current:${entityId}`, title, source: "manual", createdAt };
    versions.push(current);
  }

  const requestedDefaultId = String(sourceDefaultId ?? "");
  const requestedDefault = versions.find((item) => item.id === requestedDefaultId);
  const defaultNameVersionId = requestedDefault?.title === title
    ? requestedDefault.id
    : current?.id ?? null;

  return { nameVersions: versions, defaultNameVersionId };
}

export function appendNameVersion(
  state: NameVersionState,
  version: NameVersion,
  maximum: number,
) {
  const title = normalizedTitle(version.title, maximum);
  if (!title) return { state, versionId: null as string | null, added: false };
  const existing = state.nameVersions.find((item) => item.title === title);
  if (existing) return { state, versionId: existing.id, added: false };
  const next = { ...version, title };
  return {
    state: { ...state, nameVersions: [next, ...state.nameVersions].slice(0, 100) },
    versionId: next.id,
    added: true,
  };
}
