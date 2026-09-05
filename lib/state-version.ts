export type StudioStateIdentity = {
  databaseId: string;
  schemaVersion: number;
  databaseVersion: number;
  revision: number;
};

export function studioStateEtag(identity: StudioStateIdentity) {
  return `"writer-studio-state-v2-${identity.databaseId}-${identity.schemaVersion}-${identity.revision}"`;
}
