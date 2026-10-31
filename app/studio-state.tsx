"use client";

import { createStudioActions } from "@/app/studio-actions";
import { legacyStorageKey, deviceUiStorageKey, draftPrefix } from "@/app/studio-storage-keys";
import { reconcileTaskPoll, emptyStudioData, normalizeStudioData, durableSnapshot, serializeDurable } from "@/lib/studio-normalization";
import { findOutlineInArticle, firstOutline } from "@/lib/studio-entities";

import type { TaskExecutionOrigin, AiTask, StudioData } from "@/lib/studio-types";
import { nextSaveRetry, shouldRetrySave, type SaveRetryState } from "@/lib/save-retry";

import { clearChatCompletions, drainChatCompletions } from "@/lib/chat-client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { diffStudioData, isStudioChangesEmpty } from "@/lib/studio-changes";
import { browserIsOffline, fetchFromServer, fetchServerAction } from "@/lib/browser-network";
import { deleteOfflineContentDraft, readOfflineContentDrafts, readOfflineStudioSnapshot, writeOfflineStudioSnapshot } from "@/lib/offline-store";
import { studioStateEtag, type StudioStateIdentity } from "@/lib/state-version";
import { mergeStudioConflict, resolveStudioConflict, stableStudioStringify } from "@/app/studio-conflict.mjs";

import { type StudioContextValue, type StudioStatePayload } from "@/app/studio-context";

import { seedData } from "@/app/studio-demo-data";

import { deviceUiForCurrentPath, readDeviceUi, recoverStoredDrafts, applyDeviceUi, stateIdentityFromPayload, deviceUiFromData, emptyArticle, emptyChapter, emptyOutline } from "@/app/studio-device-state";

export const StudioContext = createContext<StudioContextValue | null>(null);

export const saveRequestTimeoutMs = 45_000;

export async function triggerBackgroundCloudUpload() {
  try {
    await fetchFromServer("/api/sync/upload", { method: "POST", keepalive: true });
  } catch { /* Local saves remain authoritative while the cloud is unavailable. */ }
  window.dispatchEvent(new Event("writer-studio-sync-status"));
}

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [data, setDataState] = useState<StudioData>(() => normalizeStudioData(seedData));
  const [executionOrigin, setExecutionOrigin] = useState<TaskExecutionOrigin>("local");
  const executionOriginRef = useRef<TaskExecutionOrigin>("local");
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<StudioContextValue["saveStatus"]>("loading");
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState<StudioContextValue["conflict"]>(null);
  const dataRef = useRef(data);
  const revisionRef = useRef(0);
  const lastSavedRef = useRef("");
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveEpochRef = useRef(0);
  const saveRetryRef = useRef<SaveRetryState | null>(null);
  const pendingRecoveredDraftKeysRef = useRef<string[]>([]);
  const pendingRecoveredOfflineDraftIdsRef = useRef<string[]>([]);
  const pendingLegacyMigrationRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const stateIdentityRef = useRef<StudioStateIdentity | null>(null);
  const offlineCacheReadyRef = useRef(false);
  const refreshCachedStateOnHydrateRef = useRef(false);

  const setData = useCallback((update: StudioData | ((current: StudioData) => StudioData)) => {
    const next = typeof update === "function" ? update(dataRef.current) : update;
    // dataRef is the source for sequential mutations. Sync it here, rather than
    // from a later React effect that could roll rapid streaming updates backward.
    dataRef.current = next;
    setDataState(next);
  }, []);

  const persistOfflineCache = useCallback(async (localSnapshot = dataRef.current) => {
    if (!offlineCacheReadyRef.current || !stateIdentityRef.current || !lastSavedRef.current) return false;
    try {
      const baseData = durableSnapshot(JSON.parse(lastSavedRef.current) as StudioData);
      const localData = durableSnapshot(localSnapshot);
      return writeOfflineStudioSnapshot({
        ...stateIdentityRef.current,
        etag: studioStateEtag(stateIdentityRef.current),
        baseData,
        localData,
        executionOrigin: executionOriginRef.current,
      });
    } catch {
      return false;
    }
  }, []);

  const advanceStateIdentity = useCallback((revision: number, databaseVersion?: number) => {
    const current = stateIdentityRef.current;
    if (!current) return;
    stateIdentityRef.current = {
      ...current,
      revision,
      databaseVersion: Number.isSafeInteger(databaseVersion) && Number(databaseVersion) >= 0 ? Number(databaseVersion) : current.databaseVersion,
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      const [cached, indexedDrafts] = await Promise.all([readOfflineStudioSnapshot(), readOfflineContentDrafts()]);
      if (cached && active) {
        try {
          const base = durableSnapshot(cached.baseData);
          const local = durableSnapshot(cached.localData);
          const deviceUi = deviceUiForCurrentPath(readDeviceUi(), local);
          const recovered = recoverStoredDrafts(applyDeviceUi(local, deviceUi), indexedDrafts);
          stateIdentityRef.current = {
            databaseId: cached.databaseId,
            schemaVersion: cached.schemaVersion,
            databaseVersion: cached.databaseVersion,
            revision: cached.revision,
          };
          revisionRef.current = cached.revision;
          lastSavedRef.current = stableStudioStringify(base);
          pendingRecoveredDraftKeysRef.current = recovered.recoveredDraftKeys;
          pendingRecoveredOfflineDraftIdsRef.current = recovered.recoveredOfflineDraftIds;
          offlineCacheReadyRef.current = true;
          refreshCachedStateOnHydrateRef.current = true;
          executionOriginRef.current = cached.executionOrigin;
          setExecutionOrigin(cached.executionOrigin);
          setData(recovered.loaded);
          setSaveStatus(serializeDurable(recovered.loaded) === lastSavedRef.current ? "saved" : "local");
          setHydrated(true);
          return;
        } catch { /* An invalid cache falls through to the authoritative server. */ }
      }
      try {
        const response = await fetchFromServer("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error(`数据库加载失败（${response.status}）`);
        const payload = await response.json() as StudioStatePayload;
        const identity = stateIdentityFromPayload(payload);
        if (!identity) throw new Error("数据库版本信息无效");
        const databaseData = normalizeStudioData(payload.data ?? emptyStudioData(seedData.settings));
        let loaded = databaseData;
        let migratedLegacy = false;
        revisionRef.current = payload.revision;
        stateIdentityRef.current = identity;
        executionOriginRef.current = payload.executionOrigin === "cloud" ? "cloud" : "local";
        setExecutionOrigin(executionOriginRef.current);
        if (loaded.articles.length === 0 && payload.revision === 0) {
          const legacy = window.localStorage.getItem(legacyStorageKey);
          if (legacy) {
            try {
              const parsed = JSON.parse(legacy) as StudioData;
              if (parsed.version === 1 && parsed.articles?.length) {
                loaded = normalizeStudioData(parsed);
                migratedLegacy = true;
              }
            } catch { /* Invalid legacy data is ignored during one-time migration. */ }
          }
        }
        const databaseSnapshot = serializeDurable(databaseData);
        const deviceUi = deviceUiForCurrentPath(migratedLegacy ? deviceUiFromData(loaded) : readDeviceUi(), loaded);
        loaded = applyDeviceUi(loaded, deviceUi);
        const recovered = recoverStoredDrafts(loaded, indexedDrafts);
        loaded = recovered.loaded;
        if (!active) return;
        setData(loaded);
        dataRef.current = loaded;
        lastSavedRef.current = databaseSnapshot;
        pendingRecoveredDraftKeysRef.current = recovered.recoveredDraftKeys;
        pendingRecoveredOfflineDraftIdsRef.current = recovered.recoveredOfflineDraftIds;
        pendingLegacyMigrationRef.current = migratedLegacy;
        offlineCacheReadyRef.current = true;
        setSaveStatus("saved");
        await persistOfflineCache(loaded);
      } catch (error) {
        if (!active) return;
        setSaveError(error instanceof Error ? error.message : "数据库加载失败");
        setSaveStatus("failed");
      } finally {
        if (active) setHydrated(true);
      }
    }
    void load();
    return () => { active = false; };
  }, [persistOfflineCache, setData]);

  const persist = useCallback(async function persistSnapshot(snapshot: StudioData, epoch = saveEpochRef.current, rebaseAttempt = 0): Promise<boolean> {
    if (epoch !== saveEpochRef.current) return false;
    const durable = durableSnapshot(snapshot);
    const serialized = stableStudioStringify(durable);
    if (serialized === lastSavedRef.current) { saveRetryRef.current = null; return true; }
    if (!shouldRetrySave(saveRetryRef.current, serialized, Date.now())) return false;
    let base: StudioData;
    try {
      // Normalization restores valid active chat/session defaults. Strip those
      // device-only values again before diffing against the durable snapshot.
      base = lastSavedRef.current ? durableSnapshot(JSON.parse(lastSavedRef.current) as StudioData) : durable;
    } catch {
      base = durable;
    }
    const changes = diffStudioData(base, durable);
    if (isStudioChangesEmpty(changes)) {
      lastSavedRef.current = serialized;
      saveRetryRef.current = null;
      return true;
    }
    if (browserIsOffline()) {
      const cached = await persistOfflineCache(snapshot);
      if (epoch !== saveEpochRef.current) return false;
      if (cached) {
        saveRetryRef.current = nextSaveRetry(saveRetryRef.current, serialized, Date.now());
        setSaveError("修改已保存在本设备，连接服务后会自动同步。");
        setSaveStatus("local");
        return true;
      }
      setSaveError("当前处于离线模式，且无法写入本设备缓存。");
      setSaveStatus("failed");
      return false;
    }
    // Keep the existing warning visible during automatic retries.
    if (saveRetryRef.current?.serialized !== serialized) {
      setSaveStatus("saving");
      setSaveError("");
    }
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort("save-timeout"), saveRequestTimeoutMs);
    try {
      const response = await fetchFromServer("/api/state/mutations", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "If-Match": String(revisionRef.current) },
        body: JSON.stringify({ changes }),
      });
      const payload = await response.json() as { revision?: number; databaseVersion?: number; data?: StudioData; message?: string };
      // An authoritative API response may have advanced the shared revision
      // while this request was in flight. Never let this older response roll
      // the accepted revision and save baseline backward.
      if (epoch !== saveEpochRef.current) return response.ok && payload.revision !== undefined;
      if (response.status === 409) {
        if (!payload.data) {
          const currentResponse = await fetchFromServer("/api/state", { cache: "no-store" });
          const currentPayload = await currentResponse.json() as Partial<StudioStatePayload>;
          if (currentResponse.ok && currentPayload.data && currentPayload.revision !== undefined) {
            payload.data = currentPayload.data;
            payload.revision = currentPayload.revision;
            payload.databaseVersion = currentPayload.databaseVersion;
          }
        }
        if (!payload.data) throw new Error(payload.message || "保存冲突，无法读取服务端状态");
        if (rebaseAttempt < 3 && lastSavedRef.current) {
          try {
            const server = durableSnapshot(payload.data);
            const latestUi = deviceUiFromData(dataRef.current);
            const latestLocal = durableSnapshot(dataRef.current);
            const result = mergeStudioConflict(base, latestLocal, server);
            if (!result.conflicts.length) {
              saveEpochRef.current += 1;
              const rebasedEpoch = saveEpochRef.current;
              revisionRef.current = Number(payload.revision ?? revisionRef.current);
              advanceStateIdentity(revisionRef.current, payload.databaseVersion);
              lastSavedRef.current = stableStudioStringify(server);
              const merged = applyDeviceUi(result.merged, latestUi);
              dataRef.current = merged;
              setData(merged);
              return persistSnapshot(merged, rebasedEpoch, rebaseAttempt + 1);
            }
            saveEpochRef.current += 1;
            setConflict({ base, local: latestLocal, server, serverRevision: Number(payload.revision ?? revisionRef.current), details: result.conflicts });
            setSaveStatus("conflict");
            return false;
          } catch { /* A malformed base snapshot falls through to explicit resolution. */ }
        }
        saveEpochRef.current += 1;
        const server = durableSnapshot(payload.data);
        const resolutionBase = lastSavedRef.current ? JSON.parse(lastSavedRef.current) as StudioData : server;
        const latestLocal = durableSnapshot(dataRef.current);
        const result = mergeStudioConflict(resolutionBase, latestLocal, server);
        setConflict({ base: resolutionBase, local: latestLocal, server, serverRevision: Number(payload.revision ?? revisionRef.current), details: result.conflicts });
        setSaveStatus("conflict");
        return false;
      }
      if (!response.ok || payload.revision === undefined) throw new Error(payload.message || `保存失败（${response.status}）`);
      revisionRef.current = payload.revision;
      saveRetryRef.current = null;
      advanceStateIdentity(payload.revision, payload.databaseVersion);
      lastSavedRef.current = serialized;
      setConflict(null);
      setSaveStatus(serializeDurable(dataRef.current) === serialized ? "saved" : "unsaved");
      pendingRecoveredDraftKeysRef.current.forEach((key) => window.sessionStorage.removeItem(key));
      pendingRecoveredDraftKeysRef.current = [];
      await Promise.all(pendingRecoveredOfflineDraftIdsRef.current.map((outlineId) => deleteOfflineContentDraft(outlineId)));
      pendingRecoveredOfflineDraftIdsRef.current = [];
      if (pendingLegacyMigrationRef.current) {
        window.localStorage.removeItem(legacyStorageKey);
        pendingLegacyMigrationRef.current = false;
      }
      await persistOfflineCache(dataRef.current);
      return true;
    } catch (error) {
      if (epoch !== saveEpochRef.current) return false;
      const cached = await persistOfflineCache(snapshot);
      if (cached) {
        saveRetryRef.current = nextSaveRetry(saveRetryRef.current, serialized, Date.now());
        const reason = controller.signal.reason === "save-timeout" ? "同步请求超时" : error instanceof Error ? error.message : "服务端保存失败";
        setSaveError(`修改已保存在本设备；同步失败：${reason}。稍后会自动重试。`);
        setSaveStatus("local");
        return true;
      }
      setSaveError(controller.signal.reason === "save-timeout" ? "保存超时，请检查网络后重试" : error instanceof Error ? error.message : "保存失败");
      setSaveStatus("failed");
      return false;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }, [advanceStateIdentity, persistOfflineCache, setData]);

  const enqueueSave = useCallback((snapshot: StudioData) => {
    const epoch = saveEpochRef.current;
    saveQueueRef.current = saveQueueRef.current.then(() => persist(snapshot, epoch), () => persist(snapshot, epoch));
    return saveQueueRef.current;
  }, [persist]);

  const refreshFromServer = useCallback(async () => {
    if (!hydrated || conflict || serializeDurable(dataRef.current) !== lastSavedRef.current) return false;
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const requestedSnapshot = lastSavedRef.current;
    const request = (async () => {
      try {
        const response = await fetchFromServer("/api/state", {
          cache: "no-store",
          headers: stateIdentityRef.current ? { "If-None-Match": studioStateEtag(stateIdentityRef.current) } : undefined,
        });
        if (response.status === 304) return true;
        const payload = await response.json() as Partial<StudioStatePayload>;
        const identity = stateIdentityFromPayload(payload);
        if (!response.ok || !payload.data || !identity) return false;
        executionOriginRef.current = payload.executionOrigin === "cloud" ? "cloud" : "local";
        setExecutionOrigin(executionOriginRef.current);
        if (serializeDurable(dataRef.current) !== requestedSnapshot || lastSavedRef.current !== requestedSnapshot) return false;
        const server = durableSnapshot(payload.data);
        const serialized = stableStudioStringify(server);
        revisionRef.current = identity.revision;
        stateIdentityRef.current = identity;
        if (serialized !== lastSavedRef.current) {
          const withDeviceUi = applyDeviceUi(server, deviceUiFromData(dataRef.current));
          dataRef.current = withDeviceUi;
          lastSavedRef.current = serialized;
          setData(withDeviceUi);
        }
        lastSavedRef.current = serialized;
        saveRetryRef.current = null;
        setSaveError("");
        setSaveStatus("saved");
        await persistOfflineCache(dataRef.current);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();
    refreshPromiseRef.current = request;
    return request;
  }, [hydrated, conflict, persistOfflineCache, setData]);

  useEffect(() => {
    if (!hydrated || !refreshCachedStateOnHydrateRef.current) return;
    refreshCachedStateOnHydrateRef.current = false;
    void refreshFromServer();
  }, [hydrated, refreshFromServer]);

  useEffect(() => {
    if (!hydrated || !offlineCacheReadyRef.current) return;
    const timer = window.setTimeout(() => { void persistOfflineCache(data); }, 120);
    return () => window.clearTimeout(timer);
  }, [data, hydrated, persistOfflineCache]);

  useEffect(() => {
    if (!hydrated || conflict) return;
    const serialized = serializeDurable(data);
    if (serialized === lastSavedRef.current) return;
    if (saveRetryRef.current?.serialized === serialized) return;
    setSaveStatus("unsaved");
    const timer = window.setTimeout(() => { void enqueueSave(data); }, 800);
    return () => window.clearTimeout(timer);
  }, [data, hydrated, conflict, enqueueSave]);

  useEffect(() => {
    const hasActiveTasks = data.tasks.some((task) => task.state === "waiting" || task.state === "running");
    if (!hydrated || saveStatus !== "saved" || hasActiveTasks) return;
    const timer = window.setTimeout(() => { void triggerBackgroundCloudUpload(); }, 5_000);
    return () => window.clearTimeout(timer);
  }, [data.tasks, hydrated, saveStatus]);

  useEffect(() => {
    if (!hydrated) return;
    let syncing = false;
    const synchronizeWhenOnline = async (refreshCleanState = false) => {
      if (!navigator.onLine || syncing || conflict) return;
      const dirty = serializeDurable(dataRef.current) !== lastSavedRef.current;
      if (!dirty && !refreshCleanState) return;
      if (!shouldRetrySave(saveRetryRef.current, serializeDurable(dataRef.current), Date.now())) return;
      syncing = true;
      try {
        const synchronized = dirty ? await enqueueSave(dataRef.current) : await refreshFromServer();
        if (synchronized && serializeDurable(dataRef.current) === lastSavedRef.current && !dataRef.current.tasks.some((task) => task.state === "waiting" || task.state === "running")) void triggerBackgroundCloudUpload();
      } finally {
        syncing = false;
      }
    };
    const synchronizeAfterReconnect = () => { saveRetryRef.current = null; void synchronizeWhenOnline(true); };
    const synchronizeWhenVisible = () => { if (document.visibilityState === "visible") synchronizeAfterReconnect(); };
    window.addEventListener("online", synchronizeAfterReconnect);
    window.addEventListener("focus", synchronizeAfterReconnect);
    window.addEventListener("pageshow", synchronizeAfterReconnect);
    document.addEventListener("visibilitychange", synchronizeWhenVisible);
    const timer = window.setInterval(() => { void synchronizeWhenOnline(); }, 2_000);
    void synchronizeWhenOnline();
    return () => {
      window.removeEventListener("online", synchronizeAfterReconnect);
      window.removeEventListener("focus", synchronizeAfterReconnect);
      window.removeEventListener("pageshow", synchronizeAfterReconnect);
      document.removeEventListener("visibilitychange", synchronizeWhenVisible);
      window.clearInterval(timer);
    };
  }, [hydrated, conflict, enqueueSave, refreshFromServer]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(deviceUiStorageKey, JSON.stringify(deviceUiFromData(data)));
    } catch { /* Device-local UI state is an optional convenience. */ }
  }, [data, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const onHidden = () => { if (document.visibilityState === "hidden") { void persistOfflineCache(dataRef.current); void enqueueSave(dataRef.current); } };
    const onPageHide = () => { void persistOfflineCache(dataRef.current); void enqueueSave(dataRef.current); };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => { document.removeEventListener("visibilitychange", onHidden); window.removeEventListener("pagehide", onPageHide); };
  }, [hydrated, enqueueSave, persistOfflineCache]);

  const currentArticle = data.articles.find((article) => article.id === data.currentArticleId) ?? data.articles[0] ?? emptyArticle;
  const currentPair = currentArticle.id ? findOutlineInArticle(currentArticle, data.currentOutlineId) ?? findOutlineInArticle(currentArticle, firstOutline(currentArticle)) : null;
  const currentChapter = currentPair?.chapter ?? currentArticle.chapters[0] ?? emptyChapter;
  const currentOutline = currentPair?.outline ?? currentChapter?.outlines[0] ?? emptyOutline;

  const acceptServerMutation = useCallback((revision: number, update: (current: StudioData) => StudioData, coverage: "complete" | "partial" = "complete") => {
    if (revision < revisionRef.current) return;
    const nextLocal = update(dataRef.current);
    let base: StudioData;
    try {
      base = lastSavedRef.current
        ? normalizeStudioData(JSON.parse(lastSavedRef.current) as StudioData)
        : durableSnapshot(dataRef.current);
    } catch {
      base = durableSnapshot(dataRef.current);
    }
    const nextBase = durableSnapshot(update(base));
    // A partial task poll does not describe every field covered by the global
    // revision. It may update the visible task progress and its matching slice
    // of the save baseline, but only a complete mutation response may advance
    // the revision used by subsequent writes.
    if (coverage === "complete") {
      saveEpochRef.current += 1;
      revisionRef.current = revision;
      advanceStateIdentity(revision);
    }
    lastSavedRef.current = stableStudioStringify(nextBase);
    dataRef.current = nextLocal;
    setData(nextLocal);
    setConflict(null);
    setSaveStatus(serializeDurable(nextLocal) === lastSavedRef.current ? "saved" : "unsaved");
    void persistOfflineCache(nextLocal);
  }, [advanceStateIdentity, persistOfflineCache, setData]);

  useEffect(() => {
    if (!hydrated) return;
    const recover = () => { if (navigator.onLine) void drainChatCompletions().then((changed) => { if (changed) void refreshFromServer(); }); };
    recover();
    const timer = window.setInterval(recover, 5_000);
    window.addEventListener("online", recover);
    return () => { window.clearInterval(timer); window.removeEventListener("online", recover); };
  }, [hydrated, refreshFromServer]);

  useEffect(() => {
    if (!hydrated) return;
    let polling = false;
    const refreshVisible = () => { if (document.visibilityState === "visible") void refreshFromServer(); };
    const timer = window.setInterval(() => {
      if (browserIsOffline() || polling || document.visibilityState !== "visible" || !dataRef.current.tasks.some((task) => task.executionOrigin === executionOrigin && (task.state === "waiting" || task.state === "running"))) return;
      polling = true;
      void fetchFromServer("/api/ai/tasks", { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as { tasks?: AiTask[]; runningOutlineIds?: string[]; revision?: number };
          if (!response.ok || !payload.tasks || payload.revision === undefined) return;
          const activeIds = new Set(dataRef.current.tasks.filter((task) => task.state === "waiting" || task.state === "running").map((task) => task.id));
          const terminalTransition = payload.tasks.some((task) => activeIds.has(task.id) && task.state !== "waiting" && task.state !== "running");
          // Task state is authoritative even while the editor has unrelated
          // unsaved changes. Apply the terminal transition first so the task
          // and its original outline cannot remain stuck as running; a clean
          // full refresh below then brings in the generated version and title.
          acceptServerMutation(payload.revision, (current) => ({ ...reconcileTaskPoll(current, payload.tasks!, payload.runningOutlineIds ?? []) }), "partial");
          if (terminalTransition) await refreshFromServer();
        })
        .catch(() => undefined)
        .finally(() => { polling = false; });
    }, 3000);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [executionOrigin, hydrated, refreshFromServer, acceptServerMutation]);

  const value = useMemo<StudioContextValue>(() => ({
    ...createStudioActions({ dataRef, setData, executionOrigin, enqueueSave }),
    data,
    executionOrigin,
    hydrated,
    saveStatus,
    saveError,
    conflict,
    currentArticle,
    currentChapter,
    currentOutline,
    async clearBusinessData() {
      try {
        const response = await fetchServerAction("/api/database/business-data", { method: "DELETE" });
        const payload = await response.json() as { revision?: number; databaseVersion?: number; error?: string; cleanupPending?: boolean; message?: string };
        if (!response.ok || payload.revision === undefined) throw new Error(payload.error || "清除失败");
        saveEpochRef.current += 1;
        revisionRef.current = payload.revision;
        advanceStateIdentity(payload.revision, payload.databaseVersion);
        const cleared = emptyStudioData(dataRef.current.settings);
        dataRef.current = cleared;
        lastSavedRef.current = serializeDurable(cleared);
        setData(cleared);
        setConflict(null);
        setSaveStatus("saved");
        await persistOfflineCache(cleared);
        for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
          const key = window.sessionStorage.key(index);
          if (key?.startsWith(draftPrefix)) window.sessionStorage.removeItem(key);
        }
        await Promise.all((await readOfflineContentDrafts()).map(draft => deleteOfflineContentDraft(draft.outlineId)));
        window.localStorage.removeItem(legacyStorageKey);
        clearChatCompletions();
        for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith("writer-studio:photo-draft:")) window.localStorage.removeItem(key);
        }
        if (payload.cleanupPending) {
          setSaveError(payload.message || "业务数据已清除，图片清理需要重试");
          setSaveStatus("failed");
          return false;
        }
        return true;
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "清除失败");
        setSaveStatus("failed");
        return false;
      }
    },
    acceptServerMutation,
    refreshFromServer,
    saveNow() {
      saveRetryRef.current = null;
      return enqueueSave(dataRef.current);
    },
    retrySave() {
      saveRetryRef.current = null;
      return enqueueSave(dataRef.current);
    },
    async resolveConflict(choice) {
      if (!conflict) return;
      let server = conflict.server;
      let serverRevision = conflict.serverRevision;
      let serverIdentity: StudioStateIdentity | null = null;
      try {
        const response = await fetchFromServer("/api/state", { cache: "no-store" });
        const payload = await response.json() as Partial<StudioStatePayload>;
        if (response.ok && payload.data && payload.revision !== undefined) {
          server = durableSnapshot(payload.data);
          serverRevision = payload.revision;
          serverIdentity = stateIdentityFromPayload(payload);
        }
      } catch { /* The conflict response is still a valid database snapshot. */ }
      const resolved = resolveStudioConflict(conflict.base, conflict.local, server, choice === "keep-local" ? "local" : "server");
      const withDeviceUi = applyDeviceUi(resolved, deviceUiFromData(dataRef.current));
      saveEpochRef.current += 1;
      revisionRef.current = serverRevision;
      if (serverIdentity) stateIdentityRef.current = serverIdentity;
      else advanceStateIdentity(serverRevision);
      lastSavedRef.current = stableStudioStringify(server);
      dataRef.current = withDeviceUi;
      setData(withDeviceUi);
      setConflict(null);
      setSaveStatus("unsaved");
      await enqueueSave(withDeviceUi);
    },
  }), [data, executionOrigin, hydrated, saveStatus, saveError, conflict, currentArticle, currentChapter, currentOutline, acceptServerMutation, advanceStateIdentity, enqueueSave, persistOfflineCache, refreshFromServer, setData]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used inside StudioProvider");
  return context;
}

export { chatSessionHasUnread, wordCount, formatTime } from "@/lib/studio-display";
export type { AiTask, Article, Chapter, Character, ChatSession, Message, Outline, Relationship, StudioData, StudioSettings, TaskExecutionOrigin, Version, ExcellentFragment } from "@/lib/studio-types";
