import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { StudioData } from "@/app/studio-state";
import { exportModelsForSync, exportProvidersForSync, replaceModelsFromSync, type AiModelSyncRecord, type AiProviderSyncRecord } from "@/db/ai";
import { canAutomaticallyUpload, evaluateSyncPolicy } from "@/lib/sync-policy.mjs";
import { ensureDatabase, readStudioState, writeStudioState } from "@/db/runtime";
import { databasePath, getDatabase, isCloudDatabase } from "@/db/sqlite";

export const SYNC_SCHEMA_VERSION = 4;
const syncFormat = "writer-studio-sync-v1";
const remoteTimeoutMs = 30_000;

export type SyncSnapshot = {
  format: typeof syncFormat;
  schemaVersion: number;
  databaseId: string;
  databaseVersion: number;
  createdAt: string;
  data: StudioData;
  modelScope: "none" | "config" | "all";
  providers?: AiProviderSyncRecord[];
  models?: AiModelSyncRecord[];
};

export type SyncOverwriteOptions = { includeModels: boolean; includeSecrets: boolean };

export type RemoteDatabaseMeta = {
  schemaVersion: number;
  databaseId: string;
  databaseVersion: number;
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
  ]);
  return {
    lastCloudVersion: parseVersion(values.get("sync_last_cloud_version")),
    lastUploadedLocalVersion: parseVersion(values.get("sync_last_uploaded_local_version")),
    lastRemoteDatabaseId: values.get("sync_last_remote_database_id") ?? "",
    lastSyncAt: values.get("sync_last_at") ?? "",
    lastError: values.get("sync_last_error") ?? "",
  };
}

export async function currentDatabaseMeta(): Promise<RemoteDatabaseMeta> {
  const settings = await readSettings(["database_version", "sync_schema_version", "sync_database_id"]);
  const databaseVersion = parseVersion(settings.get("database_version")) ?? 0;
  const schemaVersion = parseVersion(settings.get("sync_schema_version")) ?? SYNC_SCHEMA_VERSION;
  const databaseId = settings.get("sync_database_id") ?? "";
  if (!databaseId) throw new SyncError("database_identity_missing", "数据库缺少同步标识", 500);
  return { schemaVersion, databaseId, databaseVersion };
}

function normalizedOverwriteOptions(value?: Partial<SyncOverwriteOptions>): SyncOverwriteOptions {
  const includeModels = value?.includeModels === true;
  return { includeModels, includeSecrets: includeModels && value?.includeSecrets === true };
}

export async function createCurrentSnapshot(options?: Partial<SyncOverwriteOptions>): Promise<SyncSnapshot> {
  const normalized = normalizedOverwriteOptions(options);
  const [state, meta] = await Promise.all([readStudioState(), currentDatabaseMeta()]);
  if (!state.data) throw new SyncError("database_unavailable", "数据库内容不可用", 503);
  const modelScope = normalized.includeModels ? normalized.includeSecrets ? "all" : "config" : "none";
  return {
    format: syncFormat,
    schemaVersion: meta.schemaVersion,
    databaseId: meta.databaseId,
    databaseVersion: state.databaseVersion,
    createdAt: new Date().toISOString(),
    data: state.data,
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
}

export async function replaceCurrentDatabase(snapshotValue: unknown, expectedDatabaseVersion: number) {
  validateSyncSnapshot(snapshotValue);
  const snapshot = snapshotValue;
  const current = await readStudioState();
  const meta = await currentDatabaseMeta();
  if (snapshot.schemaVersion !== SYNC_SCHEMA_VERSION || meta.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new SyncError("schema_mismatch", "数据库结构版本不同，禁止复制；请先升级两端应用", 409, { local: meta.schemaVersion, incoming: snapshot.schemaVersion });
  }
  if (!Number.isSafeInteger(expectedDatabaseVersion) || current.databaseVersion !== expectedDatabaseVersion) {
    throw new SyncError("version_mismatch", "云端数据库版本已变化，禁止自动复制", 409, { expected: expectedDatabaseVersion, actual: current.databaseVersion });
  }
  if (!current.data) throw new SyncError("database_unavailable", "数据库内容不可用", 503);
  const result = await writeStudioState(snapshot.data, current.revision);
  if (result.conflict) {
    throw new SyncError("version_mismatch", "写入期间数据库版本发生变化，请重试", 409, { actual: result.current.databaseVersion });
  }
  const modelScope = snapshot.modelScope ?? "none";
  if (modelScope !== "none") await replaceModelsFromSync(snapshot.models ?? [], modelScope === "all", snapshot.providers ?? []);
  return { ...await currentDatabaseMeta(), databaseVersion: result.databaseVersion };
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

async function remoteReplace(config: SyncConfig, snapshot: SyncSnapshot, expectedDatabaseVersion: number) {
  return remoteRequest<RemoteDatabaseMeta>(config, "/api/sync/remote/replace", {
    method: "PUT",
    body: JSON.stringify({ snapshot, expectedDatabaseVersion }),
  });
}

function statusMessage(state: LocalSyncState) {
  if (state === "not_configured") return "尚未配置云端连接";
  if (state === "unpaired") return "尚未建立同步基线，请先手动选择一次覆盖方向";
  if (state === "pending") return "本地有修改，等待后台上传";
  if (state === "diverged") return "云端版本与同步基线不一致，后台上传已停止";
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
  });
}

async function recordSyncFailure(state: LocalSyncState, error: string) {
  await writeSettings({ sync_status: state, sync_last_error: error });
}

async function performBackgroundUpload() {
  if (isCloudDatabase()) return { state: "cloud" as const, uploaded: false, message: statusMessage("cloud") };
  const [config, stored, local, autoUploadEnabled] = await Promise.all([localSyncConfig(), storedSyncMeta(), currentDatabaseMeta(), isAutoUploadEnabled()]);
  if (!autoUploadEnabled) return { state: "disabled" as const, uploaded: false, message: "自动后台上传已关闭" };
  if (!config) return { state: "not_configured" as const, uploaded: false, message: statusMessage("not_configured") };
  if (stored.lastCloudVersion === null) return { state: "unpaired" as const, uploaded: false, message: statusMessage("unpaired") };
  try {
    const remote = await remoteMeta(config);
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
    const snapshot = await createCurrentSnapshot();
    const replaced = await remoteReplace(config, snapshot, stored.lastCloudVersion);
    await recordSyncSuccess(replaced, snapshot.databaseVersion);
    return { state: "synced" as const, uploaded: true, message: statusMessage("synced"), remoteDatabaseVersion: replaced.databaseVersion };
  } catch (error) {
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
  const saved = await writeStudioState(cloud.data, current.revision);
  if (saved.conflict) throw new SyncError("local_changed", "本地数据库在覆盖前发生变化，请重试", 409);
  if (normalized.includeModels) await replaceModelsFromSync(cloud.models ?? [], normalized.includeSecrets, cloud.providers ?? []);
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
  const replaced = await remoteReplace(config, local, cloudBefore.databaseVersion);
  await recordSyncSuccess(replaced, local.databaseVersion);
  return { state: "synced" as const, message: "已用本地数据库覆盖云端", backupPath, localDatabaseVersion: local.databaseVersion, remoteDatabaseVersion: replaced.databaseVersion };
}
