import type { StudioData, TaskExecutionOrigin } from "@/lib/studio-types";
import type { StudioStateIdentity } from "@/lib/state-version";

const databaseName = "writer-studio-offline-v1";
const storeName = "snapshots";
const primaryKey = "primary";

export type OfflineContentDraft = {
  version: 1;
  key: `draft:${string}`;
  outlineId: string;
  text: string;
  savedAt: string;
};

type PaneContentDraft = { version: 1; key: string; text: string; baseline: string; savedAt: string };

export type OfflineStudioSnapshot = StudioStateIdentity & {
  version: 1;
  key: typeof primaryKey;
  etag: string;
  baseData: StudioData;
  localData: StudioData;
  executionOrigin: TaskExecutionOrigin;
  updatedAt: string;
};

let openPromise: Promise<IDBDatabase> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function isStudioData(value: unknown): value is StudioData {
  const data = value as Partial<StudioData> | null;
  return Boolean(data && data.version === 1 && Array.isArray(data.articles) && Array.isArray(data.tasks) && data.settings && typeof data.settings === "object");
}

function isNonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isOfflineStudioSnapshot(value: unknown): value is OfflineStudioSnapshot {
  const snapshot = value as Partial<OfflineStudioSnapshot> | null;
  return Boolean(
    snapshot &&
    snapshot.version === 1 &&
    snapshot.key === primaryKey &&
    typeof snapshot.databaseId === "string" && snapshot.databaseId &&
    isNonNegativeInteger(snapshot.schemaVersion) &&
    isNonNegativeInteger(snapshot.databaseVersion) &&
    isNonNegativeInteger(snapshot.revision) &&
    typeof snapshot.etag === "string" && snapshot.etag.startsWith('"writer-studio-state-') &&
    isStudioData(snapshot.baseData) &&
    isStudioData(snapshot.localData) &&
    (snapshot.executionOrigin === "local" || snapshot.executionOrigin === "cloud")
  );
}

function openDatabase() {
  if (openPromise) return openPromise;
  openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "key" });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        openPromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      openPromise = null;
      reject(request.error ?? new Error("Unable to open offline database"));
    };
    request.onblocked = () => {
      openPromise = null;
      reject(new Error("Offline database upgrade is blocked"));
    };
  });
  return openPromise;
}

async function readPrimarySnapshot() {
  const database = await openDatabase();
  return new Promise<unknown>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(primaryKey);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to read offline snapshot"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline snapshot read was aborted"));
  });
}

async function putPrimarySnapshot(snapshot: OfflineStudioSnapshot) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(snapshot);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save offline snapshot"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline snapshot save was aborted"));
  });
}

async function readAllRecords() {
  const database = await openDatabase();
  return new Promise<unknown[]>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to read offline records"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline record read was aborted"));
  });
}

async function putRecord(record: OfflineContentDraft | PaneContentDraft) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save offline record"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline record save was aborted"));
  });
}

async function deleteRecord(key: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Unable to delete offline record"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline record deletion was aborted"));
  });
}

export async function readOfflineStudioSnapshot() {
  try {
    const value = await readPrimarySnapshot();
    return isOfflineStudioSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeOfflineStudioSnapshot(snapshot: Omit<OfflineStudioSnapshot, "version" | "key" | "updatedAt">) {
  const value: OfflineStudioSnapshot = {
    ...snapshot,
    version: 1,
    key: primaryKey,
    updatedAt: new Date().toISOString(),
  };
  const pending = writeQueue.then(() => putPrimarySnapshot(value));
  writeQueue = pending.catch(() => undefined);
  return pending.then(() => true, () => false);
}

export async function readOfflineContentDrafts() {
  try {
    const records = await readAllRecords();
    return records.filter((value): value is OfflineContentDraft => {
      const draft = value as Partial<OfflineContentDraft> | null;
      return Boolean(draft && draft.version === 1 && typeof draft.key === "string" && draft.key.startsWith("draft:") && typeof draft.outlineId === "string" && draft.key === `draft:${draft.outlineId}` && typeof draft.text === "string" && typeof draft.savedAt === "string");
    });
  } catch {
    return [];
  }
}

export function writeOfflineContentDraft(outlineId: string, text: string, savedAt = new Date().toISOString()) {
  const record: OfflineContentDraft = { version: 1, key: `draft:${outlineId}`, outlineId, text, savedAt };
  const pending = writeQueue.then(() => putRecord(record));
  writeQueue = pending.catch(() => undefined);
  return pending.then(() => true, () => false);
}

export function deleteOfflineContentDraft(outlineId: string) {
  const pending = writeQueue.then(() => deleteRecord(`draft:${outlineId}`));
  writeQueue = pending.catch(() => undefined);
  return pending.then(() => true, () => false);
}

export async function readPaneContentDraft(scope: string) {
  try {
    const records = await readAllRecords();
    return records.find((value): value is PaneContentDraft => {
      const draft = value as Partial<PaneContentDraft> | null;
      return draft?.version === 1 && draft.key === `pane-draft:${scope}` && typeof draft.text === "string" && typeof draft.baseline === "string";
    }) ?? null;
  } catch { return null; }
}

export function writePaneContentDraft(scope: string, text: string, baseline: string) {
  const record: PaneContentDraft = { version: 1, key: `pane-draft:${scope}`, text, baseline, savedAt: new Date().toISOString() };
  const pending = writeQueue.then(() => putRecord(record));
  writeQueue = pending.catch(() => undefined);
  return pending.then(() => true, () => false);
}

export function deletePaneContentDraft(scope: string) {
  const pending = writeQueue.then(() => deleteRecord(`pane-draft:${scope}`));
  writeQueue = pending.catch(() => undefined);
  return pending.then(() => true, () => false);
}
