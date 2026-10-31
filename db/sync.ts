import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { StudioData } from "@/lib/studio-types";
import { exportModelsForSync, exportProvidersForSync, replaceModelsFromSync, type AiModelSyncRecord, type AiProviderSyncRecord } from "@/db/ai-models";
import { canAutomaticallyUpload, classifyRemoteWriteConflict, evaluateSyncPolicy, remoteAcknowledgesPendingOperation, shouldDisableAutomaticUpload } from "@/lib/sync-policy.mjs";
import { applyStudioChanges, ensureDatabase, readStudioRevision, readStudioState, writeStudioState } from "@/db/studio-state";
import { databasePath, getDatabase, isCloudDatabase } from "@/db/sqlite";
import { readStyleLabSnapshot, validateStyleLabSnapshot, type StyleLabSnapshot } from "./style-lab-history";
import { isStudioChanges, isStudioChangesEmpty, mergeStudioChanges, type StudioChanges } from "@/lib/studio-changes";

export const SYNC_SCHEMA_VERSION = 17;
const syncFormat = "writer-studio-sync-v1";
const syncChangesFormat = "writer-studio-changes-v2";
const remoteTimeoutMs = 30_000;
const remoteRevisionRetryLimit = 3;

export type SyncSnapshot = {
  format: typeof syncFormat;
  schemaVersion: number;
  databaseId: string;
  databaseVersion: number;
  createdAt: string;
  data: StudioData;
  styleLab?: StyleLabSnapshot;
  modelScope: "none" | "config" | "all";
  providers?: AiProviderSyncRecord[];
  models?: AiModelSyncRecord[];
};

export type SyncOverwriteOptions = { includeModels: boolean; includeSecrets: boolean };

export type SyncChangesEnvelope = {
  format: typeof syncChangesFormat;
  schemaVersion: number;
  sourceDatabaseId: string;
  throughLocalVersion: number;
  changes: StudioChanges;
};

export type RemoteDatabaseMeta = {
  schemaVersion: number;
  databaseId: string;
  databaseVersion: number;
  lastAppliedOperationId?: string;
  lastAppliedOperationVersion?: number | null;
};

export type LocalSyncState =
  | "cloud"
  | "not_configured"
  | "unpaired"
  | "synced"
  | "pending"
  | "uploading"
  | "diverged"
  | "schema_mismatch"
  | "offline"
  | "error";

export class SyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type SyncConfig = { cloudUrl: string; token: string; sitesBypassToken: string };
type StoredSyncMeta = {
  lastCloudVersion: number | null;
  lastUploadedLocalVersion: number | null;
  lastRemoteDatabaseId: string;
  lastSyncAt: string;
  lastError: string;
  pendingOperationId: string;
  pendingOperationKey: string;
  pendingOperationLocalVersion: number | null;
};

function parseVersion(value: string | undefined) {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function readSettings(keys: string[]) {
  await ensureDatabase();
  if (!keys.length) return new Map<string, string>();
  const placeholders = keys.map(() => "?").join(",");
  const result = await getDatabase().prepare(`SELECT key,value_json FROM app_settings WHERE key IN (${placeholders})`).bind(...keys).all<Record<string, unknown>>();
  return new Map((result.results ?? []).map((row) => [String(row.key), String(row.value_json ?? "")]));
}

async function writeSettings(values: Record<string, string>) {
  const entries = Object.entries(values);
  if (!entries.length) return;
  await ensureDatabase();
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.batch(entries.map(([key, value]) => db.prepare("INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)").bind(key, value, now)));
}

export async function isAutoUploadEnabled() {
  const values = await readSettings(["sync_auto_upload"]);
  return values.get("sync_auto_upload") !== "0";
}

export async function setAutoUploadEnabled(enabled: boolean) {
  if (isCloudDatabase()) throw new SyncError("local_only", "自动上传开关只属于本地 Writer Studio", 400);
  await writeSettings({ sync_auto_upload: enabled ? "1" : "0" });
  return getLocalSyncStatus();
}

function normalizeCloudUrl(value: string) {
  const url = new URL(value);
  if (!(["http:", "https:"].includes(url.protocol))) throw new Error("云端地址必须使用 HTTP 或 HTTPS");
  return url.toString().replace(/\/$/, "");
}

async function localSyncConfig(): Promise<SyncConfig | null> {
  const stored = await readSettings(["sync_cloud_url", "sync_cloud_token", "sync_sites_bypass_token"]);
  const cloudUrl = process.env.WRITER_STUDIO_CLOUD_URL?.trim() || stored.get("sync_cloud_url")?.trim() || "";
  const token = process.env.WRITER_STUDIO_SYNC_TOKEN?.trim() || stored.get("sync_cloud_token")?.trim() || "";
  const sitesBypassToken = process.env.WRITER_STUDIO_SITES_BYPASS_TOKEN?.trim() || stored.get("sync_sites_bypass_token")?.trim() || "";
  if (!cloudUrl || !token) return null;
  try {
    return { cloudUrl: normalizeCloudUrl(cloudUrl), token, sitesBypassToken };
  } catch {
    return null;
  }
}

async function storedSyncMeta(): Promise<StoredSyncMeta> {
  const values = await readSettings([
    "sync_last_cloud_version",
    "sync_last_uploaded_local_version",
    "sync_last_remote_database_id",
    "sync_last_at",
    "sync_last_error",
    "sync_pending_operation_id",
    "sync_pending_operation_key",
    "sync_pending_operation_local_version",
  ]);
  return {
    lastCloudVersion: parseVersion(values.get("sync_last_cloud_version")),
    lastUploadedLocalVersion: parseVersion(values.get("sync_last_uploaded_local_version")),
    lastRemoteDatabaseId: values.get("sync_last_remote_database_id") ?? "",
    lastSyncAt: values.get("sync_last_at") ?? "",
    lastError: values.get("sync_last_error") ?? "",
    pendingOperationId: values.get("sync_pending_operation_id") ?? "",
    pendingOperationKey: values.get("sync_pending_operation_key") ?? "",
    pendingOperationLocalVersion: parseVersion(values.get("sync_pending_operation_local_version")),
  };
}

function normalizeSyncOperationId(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new SyncError("invalid_operation_id", "同步操作编号无效", 400);
  }
  return value;
}

async function pendingSyncOperationId(operationKey: string, localDatabaseVersion: number) {
  const stored = await storedSyncMeta();
  if (stored.pendingOperationKey === operationKey && stored.pendingOperationLocalVersion === localDatabaseVersion && normalizeSyncOperationId(stored.pendingOperationId)) return stored.pendingOperationId;
  const operationId = crypto.randomUUID();
  await writeSettings({ sync_pending_operation_id: operationId, sync_pending_operation_key: operationKey, sync_pending_operation_local_version: String(localDatabaseVersion) });
  return operationId;
}

async function snapshotOperationKey(prefix: string, snapshot: SyncSnapshot) {
  const encoded = new TextEncoder().encode(JSON.stringify({ ...snapshot, createdAt: "" }));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return `${prefix}:${Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function currentDatabaseMeta(): Promise<RemoteDatabaseMeta> {
  const settings = await readSettings(["database_version", "sync_schema_version", "sync_database_id"]);
  const databaseVersion = parseVersion(settings.get("database_version")) ?? 0;
  const schemaVersion = parseVersion(settings.get("sync_schema_version")) ?? SYNC_SCHEMA_VERSION;
  const databaseId = settings.get("sync_database_id") ?? "";
  if (!databaseId) throw new SyncError("database_identity_missing", "数据库缺少同步标识", 500);
  return { schemaVersion, databaseId, databaseVersion };
}

export async function currentDatabaseSyncMeta(): Promise<RemoteDatabaseMeta> {
  const [meta, operation] = await Promise.all([
    currentDatabaseMeta(),
    readSettings(["sync_last_applied_operation_id", "sync_last_applied_operation_version"]),
  ]);
  return {
    ...meta,
    lastAppliedOperationId: operation.get("sync_last_applied_operation_id") || undefined,
    lastAppliedOperationVersion: parseVersion(operation.get("sync_last_applied_operation_version")),
  };
}

async function wasSyncOperationApplied(operationId: string, current: RemoteDatabaseMeta) {
  if (!operationId) return false;
  const values = await readSettings(["sync_last_applied_operation_id", "sync_last_applied_operation_version"]);
  if (values.get("sync_last_applied_operation_id") !== operationId) return false;
  const appliedVersion = parseVersion(values.get("sync_last_applied_operation_version"));
  if (appliedVersion === null) return false;
  if (current.databaseVersion !== appliedVersion) {
    throw new SyncError("version_mismatch", "该同步操作完成后云端数据库又发生了变化", 409, { expected: appliedVersion, actual: current.databaseVersion });
  }
  return true;
}

function remoteWriteConflict(expectedDatabaseVersion: number, actualDatabaseVersion: number) {
  const code = classifyRemoteWriteConflict(expectedDatabaseVersion, actualDatabaseVersion);
  return code === "revision_busy"
    ? new SyncError(code, "云端任务状态正在更新，稍后可继续自动同步", 409, { expected: expectedDatabaseVersion, actual: actualDatabaseVersion })
    : new SyncError(code, "云端数据库版本已变化，禁止自动同步", 409, { expected: expectedDatabaseVersion, actual: actualDatabaseVersion });
}

async function pauseBeforeRevisionRetry(attempt: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
}

function normalizedOverwriteOptions(value?: Partial<SyncOverwriteOptions>): SyncOverwriteOptions {
  const includeModels = value?.includeModels === true;
  return { includeModels, includeSecrets: includeModels && value?.includeSecrets === true };
}

export async function createCurrentSnapshot(options?: Partial<SyncOverwriteOptions>): Promise<SyncSnapshot> {
  const normalized = normalizedOverwriteOptions(options);
  const [state, meta] = await Promise.all([readStudioState(), currentDatabaseMeta()]);
  if (!state.data) throw new SyncError("database_unavailable", "数据库内容不可用", 503);
  const styleLab = await readStyleLabSnapshot(getDatabase());
  const after = await currentDatabaseMeta();
  if (after.databaseVersion !== state.databaseVersion) throw new SyncError("revision_busy", "学习或写作数据正在更新，请稍后重试备份", 409);
  const modelScope = normalized.includeModels ? normalized.includeSecrets ? "all" : "config" : "none";
  return {
    format: syncFormat,
    schemaVersion: meta.schemaVersion,
    databaseId: meta.databaseId,
    databaseVersion: state.databaseVersion,
    createdAt: new Date().toISOString(),
    data: state.data,
    styleLab,
    modelScope,
    ...(normalized.includeModels ? {
      providers: await exportProvidersForSync(normalized.includeSecrets),
      models: await exportModelsForSync(normalized.includeSecrets),
    } : {}),
  };
}

export function validateSyncSnapshot(value: unknown): asserts value is SyncSnapshot {
  const snapshot = value as Partial<SyncSnapshot> | null;
  if (
    !snapshot || snapshot.format !== syncFormat ||
    !Number.isSafeInteger(snapshot.schemaVersion) || !Number.isSafeInteger(snapshot.databaseVersion) ||
    typeof snapshot.databaseId !== "string" || !snapshot.databaseId ||
    !snapshot.data || snapshot.data.version !== 1 || !Array.isArray(snapshot.data.articles) ||
    !([undefined, "none", "config", "all"] as unknown[]).includes(snapshot.modelScope) ||
    (snapshot.modelScope !== undefined && snapshot.modelScope !== "none" && (!Array.isArray(snapshot.providers) || !Array.isArray(snapshot.models)))
  ) {
    throw new SyncError("invalid_snapshot", "同步快照格式无效", 400);
  }
  if (snapshot.styleLab !== undefined) {
    try { validateStyleLabSnapshot(snapshot.styleLab, new Set(snapshot.data.articles.map(a => a.id))); }
    catch (error) { throw new SyncError("invalid_snapshot", error instanceof Error ? error.message : "学习历史格式无效", 400); }
  }
}

export async function replaceCurrentDatabase(snapshotValue: unknown, expectedDatabaseVersion: number, operationIdValue?: unknown) {
  validateSyncSnapshot(snapshotValue);
  const snapshot = snapshotValue;
  const operationId = normalizeSyncOperationId(operationIdValue);
  let meta = await currentDatabaseMeta();
  if (snapshot.schemaVersion !== SYNC_SCHEMA_VERSION || meta.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new SyncError("schema_mismatch", "数据库结构版本不同，禁止复制；请先升级两端应用", 409, { local: meta.schemaVersion, incoming: snapshot.schemaVersion });
  }
  if (await wasSyncOperationApplied(operationId, meta)) {
    const modelScope = snapshot.modelScope ?? "none";
    if (modelScope !== "none") await replaceModelsFromSync(snapshot.models ?? [], modelScope === "all", snapshot.providers ?? []);
    return meta;
  }
  if (!Number.isSafeInteger(expectedDatabaseVersion) || meta.databaseVersion !== expectedDatabaseVersion) {
    throw remoteWriteConflict(expectedDatabaseVersion, meta.databaseVersion);
  }

  for (let attempt = 0; attempt < remoteRevisionRetryLimit; attempt += 1) {
    const current = await readStudioState();
    if (current.databaseVersion !== expectedDatabaseVersion) throw remoteWriteConflict(expectedDatabaseVersion, current.databaseVersion);
    if (!current.data) throw new SyncError("database_unavailable", "数据库内容不可用", 503);
    const result = await writeStudioState(snapshot.data, current.revision, { syncOperationId: operationId || undefined, styleLab: snapshot.styleLab });
    if (!result.conflict) {
      const modelScope = snapshot.modelScope ?? "none";
      if (modelScope !== "none") await replaceModelsFromSync(snapshot.models ?? [], modelScope === "all", snapshot.providers ?? []);
      meta = await currentDatabaseMeta();
      return { ...meta, databaseVersion: result.databaseVersion };
    }
    if (result.current.databaseVersion !== expectedDatabaseVersion) throw remoteWriteConflict(expectedDatabaseVersion, result.current.databaseVersion);
    if (attempt + 1 < remoteRevisionRetryLimit) await pauseBeforeRevisionRetry(attempt);
  }
  throw remoteWriteConflict(expectedDatabaseVersion, expectedDatabaseVersion);
}

function safeTokenEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

export function authorizeRemoteSyncRequest(request: Request) {
  if (!isCloudDatabase()) throw new SyncError("cloud_only", "该接口只在云端数据库上开放", 404);
  const expected = process.env.WRITER_STUDIO_SYNC_TOKEN?.trim() ?? "";
  if (!expected) throw new SyncError("sync_token_missing", "云端尚未配置同步密钥", 503);
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supplied || !safeTokenEqual(supplied, expected)) throw new SyncError("unauthorized", "同步密钥无效", 401);
}

export function authorizeLocalSyncMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new SyncError("cross_origin_denied", "拒绝跨站同步操作", 403);
}

async function remoteRequest<T>(config: SyncConfig, pathname: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remoteTimeoutMs);
  try {
    const response = await fetch(`${config.cloudUrl}${pathname}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Authorization": `Bearer ${config.token}`,
        ...(config.sitesBypassToken ? { "OAI-Sites-Authorization": `Bearer ${config.sitesBypassToken}` } : {}),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const payload = await response.json().catch(() => ({})) as T & { code?: string; message?: string; details?: unknown };
    if (!response.ok) throw new SyncError(payload.code || "remote_error", payload.message || `云端请求失败（${response.status}）`, response.status, payload.details);
    return payload;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    const message = controller.signal.aborted ? "连接云端超时" : error instanceof Error ? error.message : "连接云端失败";
    throw new SyncError("cloud_unreachable", message, 503);
  } finally {
    clearTimeout(timer);
  }
}

async function remoteMeta(config: SyncConfig) {
  return remoteRequest<RemoteDatabaseMeta>(config, "/api/sync/remote/meta");
}

async function remoteSnapshot(config: SyncConfig, options?: Partial<SyncOverwriteOptions>) {
  const normalized = normalizedOverwriteOptions(options);
  const query = new URLSearchParams({ models: normalized.includeModels ? "1" : "0", secrets: normalized.includeSecrets ? "1" : "0" });
  const snapshot = await remoteRequest<SyncSnapshot>(config, `/api/sync/remote/snapshot?${query}`);
  validateSyncSnapshot(snapshot);
  return snapshot;
}

async function remoteReplace(config: SyncConfig, snapshot: SyncSnapshot, expectedDatabaseVersion: number, operationId: string) {
  return remoteRequest<RemoteDatabaseMeta>(config, "/api/sync/remote/replace", {
    method: "PUT",
    body: JSON.stringify({ snapshot, expectedDatabaseVersion, operationId }),
  });
}

async function remoteApplyChanges(config: SyncConfig, envelope: SyncChangesEnvelope, expectedDatabaseVersion: number, operationId: string) {
  return remoteRequest<RemoteDatabaseMeta>(config, "/api/sync/remote/changes", {
    method: "PUT",
    body: JSON.stringify({ envelope, expectedDatabaseVersion, operationId }),
  });
}

function validateSyncChangesEnvelope(value: unknown): asserts value is SyncChangesEnvelope {
  const envelope = value as Partial<SyncChangesEnvelope> | null;
  if (!envelope || envelope.format !== syncChangesFormat || envelope.schemaVersion !== SYNC_SCHEMA_VERSION || typeof envelope.sourceDatabaseId !== "string" || !envelope.sourceDatabaseId || !Number.isSafeInteger(envelope.throughLocalVersion) || !isStudioChanges(envelope.changes)) {
    throw new SyncError("invalid_changes", "同步增量格式无效", 400);
  }
}

export async function applyRemoteChanges(value: unknown, expectedDatabaseVersion: number, operationIdValue?: unknown) {
  validateSyncChangesEnvelope(value);
  const envelope = value;
  const operationId = normalizeSyncOperationId(operationIdValue);
  const meta = await currentDatabaseMeta();
  if (meta.schemaVersion !== SYNC_SCHEMA_VERSION) throw new SyncError("schema_mismatch", "数据库结构版本不同，禁止增量同步", 409);
  if (await wasSyncOperationApplied(operationId, meta)) return meta;
  if (!Number.isSafeInteger(expectedDatabaseVersion) || meta.databaseVersion !== expectedDatabaseVersion) {
    throw remoteWriteConflict(expectedDatabaseVersion, meta.databaseVersion);
  }
  for (let attempt = 0; attempt < remoteRevisionRetryLimit; attempt += 1) {
    const result = await applyStudioChanges(envelope.changes, await readStudioRevision(), { recordSyncChange: false, expectedDatabaseVersion, syncOperationId: operationId || undefined });
    if (!result.conflict) return { schemaVersion: meta.schemaVersion, databaseId: meta.databaseId, databaseVersion: result.databaseVersion };
    if (result.databaseVersion !== expectedDatabaseVersion) throw remoteWriteConflict(expectedDatabaseVersion, result.databaseVersion);
    if (attempt + 1 < remoteRevisionRetryLimit) await pauseBeforeRevisionRetry(attempt);
  }
  throw remoteWriteConflict(expectedDatabaseVersion, expectedDatabaseVersion);
}

async function createPendingChanges(lastUploadedLocalVersion: number, local: RemoteDatabaseMeta): Promise<SyncChangesEnvelope | null> {
  await ensureDatabase();
  const result = await getDatabase().prepare("SELECT database_version,change_json FROM sync_change_log WHERE database_version>? AND database_version<=? ORDER BY database_version").bind(lastUploadedLocalVersion, local.databaseVersion).all<Record<string, unknown>>();
  const records = result.results ?? [];
  if (!records.length || Number(records[0].database_version) !== lastUploadedLocalVersion + 1 || Number(records.at(-1)?.database_version) !== local.databaseVersion) return null;
  for (let index = 0; index < records.length; index += 1) if (Number(records[index].database_version) !== lastUploadedLocalVersion + index + 1) return null;
  const changes = records.map((row) => {
    let parsed: unknown;
    try { parsed = JSON.parse(String(row.change_json)); } catch { return null; }
    return isStudioChanges(parsed) ? parsed : null;
  });
  if (changes.some((value) => !value)) return null;
  return { format: syncChangesFormat, schemaVersion: local.schemaVersion, sourceDatabaseId: local.databaseId, throughLocalVersion: local.databaseVersion, changes: mergeStudioChanges(changes as StudioChanges[]) };
}

async function pruneChangeLog(throughLocalVersion: number) {
  await ensureDatabase();
  await getDatabase().prepare("DELETE FROM sync_change_log WHERE database_version<=?").bind(throughLocalVersion).run();
}

function statusMessage(state: LocalSyncState) {
  if (state === "not_configured") return "尚未配置云端连接";
  if (state === "unpaired") return "尚未建立同步基线，请先手动选择一次覆盖方向";
  if (state === "pending") return "本地有修改，等待后台上传";
  if (state === "diverged") return "检测到云端版本冲突，已自动关闭后台上传；请手动选择覆盖方向";
  if (state === "schema_mismatch") return "两端数据库结构版本不同，必须先升级应用";
  if (state === "offline") return "暂时无法连接云端";
  if (state === "uploading") return "正在后台上传";
  if (state === "cloud") return "当前运行在云端数据库";
  if (state === "synced") return "本地与云端已同步";
  return "同步发生错误";
}

export async function getLocalSyncStatus() {
  const local = await currentDatabaseMeta();
  if (isCloudDatabase()) return { state: "cloud" as const, message: statusMessage("cloud"), autoUploadEnabled: false, localDatabaseVersion: local.databaseVersion, schemaVersion: local.schemaVersion };
  const [config, stored, autoUploadEnabled] = await Promise.all([localSyncConfig(), storedSyncMeta(), isAutoUploadEnabled()]);
  const base = {
    localDatabaseVersion: local.databaseVersion,
    schemaVersion: local.schemaVersion,
    lastCloudVersion: stored.lastCloudVersion,
    lastUploadedLocalVersion: stored.lastUploadedLocalVersion,
    lastSyncAt: stored.lastSyncAt || null,
    cloudHost: config ? new URL(config.cloudUrl).host : null,
    autoUploadEnabled,
  };
  if (!config) return { ...base, state: "not_configured" as const, message: statusMessage("not_configured") };
  try {
    const remote = await remoteMeta(config);
    const state = evaluateSyncPolicy({
      localSchemaVersion: local.schemaVersion,
      remoteSchemaVersion: remote.schemaVersion,
      localDatabaseVersion: local.databaseVersion,
      lastUploadedLocalVersion: stored.lastUploadedLocalVersion,
      lastCloudVersion: stored.lastCloudVersion,
      lastRemoteDatabaseId: stored.lastRemoteDatabaseId,
      remoteDatabaseId: remote.databaseId,
      remoteDatabaseVersion: remote.databaseVersion,
    }) as LocalSyncState;
    return { ...base, state, message: statusMessage(state), remoteDatabaseVersion: remote.databaseVersion, remoteSchemaVersion: remote.schemaVersion };
  } catch (error) {
    return { ...base, state: "offline" as const, message: error instanceof Error ? error.message : statusMessage("offline"), lastError: stored.lastError || null };
  }
}

async function recordSyncSuccess(remote: RemoteDatabaseMeta, localDatabaseVersion: number) {
  await writeSettings({
    sync_last_cloud_version: String(remote.databaseVersion),
    sync_last_uploaded_local_version: String(localDatabaseVersion),
    sync_last_remote_database_id: remote.databaseId,
    sync_last_at: new Date().toISOString(),
    sync_last_error: "",
    sync_status: "synced",
    sync_pending_operation_id: "",
    sync_pending_operation_key: "",
    sync_pending_operation_local_version: "",
  });
}

async function recordSyncFailure(state: LocalSyncState, error: string) {
  const values: Record<string, string> = { sync_status: state, sync_last_error: error };
  if (shouldDisableAutomaticUpload(state)) values.sync_auto_upload = "0";
  await writeSettings(values);
}

async function performBackgroundUpload() {
  if (isCloudDatabase()) return { state: "cloud" as const, uploaded: false, message: statusMessage("cloud") };
  const [config, stored, local, localState, autoUploadEnabled] = await Promise.all([localSyncConfig(), storedSyncMeta(), currentDatabaseMeta(), readStudioState(), isAutoUploadEnabled()]);
  if (!autoUploadEnabled) return { state: "disabled" as const, uploaded: false, message: "自动后台上传已关闭" };
  if (!config) return { state: "not_configured" as const, uploaded: false, message: statusMessage("not_configured") };
  if (stored.lastCloudVersion === null) return { state: "unpaired" as const, uploaded: false, message: statusMessage("unpaired") };
  const activeTasks = localState.data?.tasks.filter((task) => task.state === "waiting" || task.state === "running") ?? [];
  const activeStyleJobs = Number(await getDatabase().prepare("SELECT COUNT(*) AS count FROM style_lab_jobs WHERE status IN ('queued','running')").first<number>("count") ?? 0);
  if (activeTasks.length || activeStyleJobs) {
    return { state: "pending" as const, uploaded: false, deferred: true, reason: "active_tasks" as const, message: `有 ${activeTasks.length + activeStyleJobs} 个 AI 任务尚未结束，完成后再自动上传` };
  }
  try {
    const remote = await remoteMeta(config);
    const acknowledgesPendingOperation = remoteAcknowledgesPendingOperation({
      pendingOperationId: stored.pendingOperationId,
      pendingLocalVersion: stored.pendingOperationLocalVersion,
      localDatabaseVersion: local.databaseVersion,
      remoteOperationId: remote.lastAppliedOperationId,
      remoteOperationVersion: remote.lastAppliedOperationVersion,
      remoteDatabaseVersion: remote.databaseVersion,
    });
    if (acknowledgesPendingOperation) {
      const uploadedLocalVersion = stored.pendingOperationLocalVersion!;
      await recordSyncSuccess(remote, uploadedLocalVersion);
      await pruneChangeLog(uploadedLocalVersion);
      if (uploadedLocalVersion === local.databaseVersion) {
        return { state: "synced" as const, uploaded: false, recovered: true, message: "已确认上次上传实际成功", remoteDatabaseVersion: remote.databaseVersion };
      }
      return performBackgroundUpload();
    }
    const policy = evaluateSyncPolicy({
      localSchemaVersion: local.schemaVersion,
      remoteSchemaVersion: remote.schemaVersion,
      localDatabaseVersion: local.databaseVersion,
      lastUploadedLocalVersion: stored.lastUploadedLocalVersion,
      lastCloudVersion: stored.lastCloudVersion,
      lastRemoteDatabaseId: stored.lastRemoteDatabaseId,
      remoteDatabaseId: remote.databaseId,
      remoteDatabaseVersion: remote.databaseVersion,
    }) as LocalSyncState;
    if (policy === "synced") return { state: policy, uploaded: false, message: statusMessage(policy) };
    if (!canAutomaticallyUpload(policy)) {
      await recordSyncFailure(policy, statusMessage(policy));
      return { state: policy, uploaded: false, blocked: true, message: statusMessage(policy) };
    }
    await writeSettings({ sync_status: "uploading", sync_last_error: "" });
    const envelope = stored.lastUploadedLocalVersion === null ? null : await createPendingChanges(stored.lastUploadedLocalVersion, local);
    const localVersion = local.databaseVersion;
    if (envelope && isStudioChangesEmpty(envelope.changes)) {
      await recordSyncSuccess(remote, localVersion);
      await pruneChangeLog(localVersion);
      return { state: "synced" as const, uploaded: false, message: statusMessage("synced"), remoteDatabaseVersion: remote.databaseVersion };
    }
    let replaced: RemoteDatabaseMeta;
    if (envelope) {
      const operationId = await pendingSyncOperationId(`auto:changes:${envelope.sourceDatabaseId}:${envelope.throughLocalVersion}`, localVersion);
      replaced = await remoteApplyChanges(config, envelope, stored.lastCloudVersion, operationId);
    } else {
      const snapshot = await createCurrentSnapshot();
      const operationId = await pendingSyncOperationId(`auto:replace:${snapshot.databaseId}:${snapshot.databaseVersion}`, localVersion);
      replaced = await remoteReplace(config, snapshot, stored.lastCloudVersion, operationId);
    }
    await recordSyncSuccess(replaced, localVersion);
    await pruneChangeLog(localVersion);
    return { state: "synced" as const, uploaded: true, message: statusMessage("synced"), remoteDatabaseVersion: replaced.databaseVersion };
  } catch (error) {
    if (error instanceof SyncError && error.code === "revision_busy") {
      await recordSyncFailure("pending", error.message);
      return { state: "pending" as const, uploaded: false, retryable: true, message: error.message };
    }
    const state: LocalSyncState = error instanceof SyncError && ["version_mismatch", "schema_mismatch"].includes(error.code)
      ? error.code === "schema_mismatch" ? "schema_mismatch" : "diverged"
      : "offline";
    const message = error instanceof Error ? error.message : statusMessage(state);
    await recordSyncFailure(state, message);
    if (error instanceof SyncError && error.status === 409) return { state, uploaded: false, blocked: true, message };
    return { state, uploaded: false, message };
  }
}

const syncGlobal = globalThis as typeof globalThis & { __writerStudioBackgroundUpload?: Promise<Awaited<ReturnType<typeof performBackgroundUpload>>> };

export function uploadLocalChanges() {
  if (syncGlobal.__writerStudioBackgroundUpload) return syncGlobal.__writerStudioBackgroundUpload;
  const pending = performBackgroundUpload().finally(() => {
    if (syncGlobal.__writerStudioBackgroundUpload === pending) delete syncGlobal.__writerStudioBackgroundUpload;
  });
  syncGlobal.__writerStudioBackgroundUpload = pending;
  return pending;
}

function writeRecoverySnapshot(label: string, snapshot: SyncSnapshot) {
  const recoveryDirectory = path.join(path.dirname(databasePath()), "recovery");
  mkdirSync(recoveryDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(recoveryDirectory, `${label}-${timestamp}.json`);
  writeFileSync(backupPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return backupPath;
}

function requireLocalConfig(config: SyncConfig | null): asserts config is SyncConfig {
  if (isCloudDatabase()) throw new SyncError("local_only", "覆盖操作只能从本地 Writer Studio 发起", 400);
  if (!config) throw new SyncError("not_configured", "尚未配置云端地址或同步密钥", 503);
}

export async function pullCloudOverLocal(options?: Partial<SyncOverwriteOptions>) {
  const normalized = normalizedOverwriteOptions(options);
  const config = await localSyncConfig();
  requireLocalConfig(config);
  const cloud = await remoteSnapshot(config, normalized);
  const local = await createCurrentSnapshot({ includeModels: normalized.includeModels, includeSecrets: normalized.includeModels });
  if (cloud.schemaVersion !== local.schemaVersion || cloud.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new SyncError("schema_mismatch", "两端数据库结构版本不同，不能覆盖", 409, { local: local.schemaVersion, remote: cloud.schemaVersion });
  }
  const backupPath = writeRecoverySnapshot("sync-local-before-pull", local);
  const current = await readStudioState();
  const saved = await writeStudioState(cloud.data, current.revision, { styleLab: cloud.styleLab });
  if (saved.conflict) throw new SyncError("local_changed", "本地数据库在覆盖前发生变化，请重试", 409);
  if (normalized.includeModels) await replaceModelsFromSync(cloud.models ?? [], normalized.includeSecrets, cloud.providers ?? []);
  await pruneChangeLog(saved.databaseVersion);
  await recordSyncSuccess({ schemaVersion: cloud.schemaVersion, databaseId: cloud.databaseId, databaseVersion: cloud.databaseVersion }, saved.databaseVersion);
  return { state: "synced" as const, message: "已用云端数据库覆盖本地", backupPath, localDatabaseVersion: saved.databaseVersion, remoteDatabaseVersion: cloud.databaseVersion };
}

export async function pushLocalOverCloud(options?: Partial<SyncOverwriteOptions>) {
  const normalized = normalizedOverwriteOptions(options);
  const config = await localSyncConfig();
  requireLocalConfig(config);
  const cloudBefore = await remoteSnapshot(config, { includeModels: normalized.includeModels, includeSecrets: normalized.includeModels });
  const local = await createCurrentSnapshot(normalized);
  if (cloudBefore.schemaVersion !== local.schemaVersion || local.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new SyncError("schema_mismatch", "两端数据库结构版本不同，不能覆盖", 409, { local: local.schemaVersion, remote: cloudBefore.schemaVersion });
  }
  const backupPath = writeRecoverySnapshot("sync-cloud-before-push", cloudBefore);
  const operationId = await pendingSyncOperationId(await snapshotOperationKey("manual:push", local), local.databaseVersion);
  let replaced: RemoteDatabaseMeta;
  try {
    replaced = await remoteReplace(config, local, cloudBefore.databaseVersion, operationId);
  } catch (error) {
    if (error instanceof SyncError && error.code === "version_mismatch") await recordSyncFailure("diverged", error.message);
    throw error;
  }
  await recordSyncSuccess(replaced, local.databaseVersion);
  await pruneChangeLog(local.databaseVersion);
  return { state: "synced" as const, message: "已用本地数据库覆盖云端", backupPath, localDatabaseVersion: local.databaseVersion, remoteDatabaseVersion: replaced.databaseVersion };
}
