import assert from "node:assert/strict";
import test from "node:test";
import { canAutomaticallyUpload, classifyRemoteWriteConflict, evaluateSyncPolicy, remoteAcknowledgesPendingOperation, shouldDisableAutomaticUpload } from "../lib/sync-policy.mjs";

const baseline = {
  localSchemaVersion: 1,
  remoteSchemaVersion: 1,
  localDatabaseVersion: 12,
  lastUploadedLocalVersion: 11,
  lastCloudVersion: 7,
  lastRemoteDatabaseId: "cloud-a",
  remoteDatabaseId: "cloud-a",
  remoteDatabaseVersion: 7,
};

test("background upload is allowed only when the cloud still matches the baseline", () => {
  const pending = evaluateSyncPolicy(baseline);
  assert.equal(pending, "pending");
  assert.equal(canAutomaticallyUpload(pending), true);

  const diverged = evaluateSyncPolicy({ ...baseline, remoteDatabaseVersion: 8 });
  assert.equal(diverged, "diverged");
  assert.equal(canAutomaticallyUpload(diverged), false);

  const replacedCloud = evaluateSyncPolicy({ ...baseline, remoteDatabaseId: "cloud-b" });
  assert.equal(replacedCloud, "diverged");
  assert.equal(canAutomaticallyUpload(replacedCloud), false);
});

test("unpaired and schema-mismatched databases require a manual decision", () => {
  assert.equal(evaluateSyncPolicy({ ...baseline, lastCloudVersion: null }), "unpaired");
  assert.equal(evaluateSyncPolicy({ ...baseline, remoteSchemaVersion: 2 }), "schema_mismatch");
  assert.equal(canAutomaticallyUpload("unpaired"), false);
  assert.equal(canAutomaticallyUpload("schema_mismatch"), false);
});

test("matching versions are synced only after the current local version was uploaded", () => {
  assert.equal(evaluateSyncPolicy({ ...baseline, lastUploadedLocalVersion: 12 }), "synced");
});

test("a version conflict disables automatic uploads until the user intervenes", () => {
  assert.equal(shouldDisableAutomaticUpload("diverged"), true);
  assert.equal(shouldDisableAutomaticUpload("offline"), false);
  assert.equal(shouldDisableAutomaticUpload("schema_mismatch"), false);
});

test("a transient state-revision race is not treated as database divergence", () => {
  assert.equal(classifyRemoteWriteConflict(7, 7), "revision_busy");
  assert.equal(classifyRemoteWriteConflict(7, 8), "version_mismatch");
  assert.equal(shouldDisableAutomaticUpload("pending"), false);
});

test("a lost upload response is recovered only from the exact durable receipt", () => {
  const receipt = {
    pendingOperationId: "operation-a",
    pendingLocalVersion: 12,
    localDatabaseVersion: 12,
    remoteOperationId: "operation-a",
    remoteOperationVersion: 8,
    remoteDatabaseVersion: 8,
  };
  assert.equal(remoteAcknowledgesPendingOperation(receipt), true);
  assert.equal(remoteAcknowledgesPendingOperation({ ...receipt, remoteOperationId: "operation-b" }), false);
  assert.equal(remoteAcknowledgesPendingOperation({ ...receipt, remoteDatabaseVersion: 9 }), false);
  assert.equal(remoteAcknowledgesPendingOperation({ ...receipt, pendingLocalVersion: 13 }), false);
});
