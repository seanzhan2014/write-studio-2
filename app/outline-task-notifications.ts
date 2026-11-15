"use client";

import { useSyncExternalStore } from "react";
import type { AiTask, Outline, TaskExecutionOrigin } from "@/lib/studio-types";

const storagePrefix = "writer-studio:outline-task-read:";
const snapshots = new Map<string, string>();
const listeners = new Set<() => void>();

function notify() { for (const listener of listeners) listener(); }
function onStorage(event: StorageEvent) {
  if (event.key === null) snapshots.clear();
  else if (event.key.startsWith(storagePrefix)) snapshots.delete(event.key);
  else return;
  notify();
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}
function storageKey(origin: TaskExecutionOrigin, outlineId: string) {
  return `${storagePrefix}${origin}:${outlineId}`;
}
function readSnapshot(key: string) {
  const snapshot = snapshots.get(key);
  if (snapshot !== undefined) return snapshot;
  try { return window.localStorage.getItem(key); }
  catch { return null; }
}
function readEntries(snapshot: string | null): Record<string, string> {
  try {
    const value = JSON.parse(snapshot ?? "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function taskSignature(task: AiTask) {
  const preparation = task.contextOptions?.writingPreparation;
  // Streaming progress keeps the same notice; a retry, result, or new author
  // interaction gets its own notice even when it belongs to the same task.
  return JSON.stringify([task.createdAt, task.state, task.attempt ?? 1, preparation?.stage, preparation?.revision]);
}
function fallbackSignature(outline?: Pick<Outline, "state" | "updatedAt">) {
  return JSON.stringify([outline?.state, outline?.updatedAt]);
}

export function markOutlineTaskNotificationsRead(origin: TaskExecutionOrigin, outline: Outline, tasks: AiTask[]) {
  const key = storageKey(origin, outline.id);
  const entries: Record<string, string> = {};
  if (outline.state !== "running") entries.fallback = fallbackSignature(outline);
  for (const task of tasks) {
    if (task.outlineId === outline.id && task.target === "正文" && task.state !== "running" && task.state !== "waiting") entries[`task:${task.id}`] = taskSignature(task);
  }
  const snapshot = JSON.stringify(entries);
  snapshots.set(key, snapshot);
  try { window.localStorage.setItem(key, snapshot); } catch { /* Keep read state for this session when storage is unavailable. */ }
  notify();
}

export function useOutlineTaskNotificationRead(origin: TaskExecutionOrigin, outlineId: string, task: AiTask | undefined, outline: Pick<Outline, "state" | "updatedAt"> | undefined) {
  const key = storageKey(origin, outlineId);
  const snapshot = useSyncExternalStore(subscribe, () => readSnapshot(key), () => null);
  // Active status stays visible, including notices marked read by older releases.
  if (task ? task.state === "running" || task.state === "waiting" : outline?.state === "running") return false;
  const entries = readEntries(snapshot);
  return task ? entries[`task:${task.id}`] === taskSignature(task) : entries.fallback === fallbackSignature(outline);
}
