/**
 * Decide whether an automatic upload is safe. Automatic sync is deliberately
 * conservative: it is allowed only while the cloud is still at the exact
 * version that this local database last observed.
 */
export function evaluateSyncPolicy(input) {
  if (input.localSchemaVersion !== input.remoteSchemaVersion) return "schema_mismatch";
  if (input.lastCloudVersion === null || !input.remoteDatabaseId) return "unpaired";
  if (input.lastRemoteDatabaseId && input.lastRemoteDatabaseId !== input.remoteDatabaseId) return "diverged";
  if (input.remoteDatabaseVersion !== input.lastCloudVersion) return "diverged";
  if (input.localDatabaseVersion !== input.lastUploadedLocalVersion) return "pending";
  return "synced";
}

export function canAutomaticallyUpload(state) {
  return state === "pending";
}

/**
 * A diverged baseline cannot heal through retries. Persistently disable
 * automatic uploads until the user explicitly chooses how to reconcile it.
 */
export function shouldDisableAutomaticUpload(state) {
  return state === "diverged";
}
