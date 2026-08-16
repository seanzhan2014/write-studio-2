export type StudioConflictDetail = {
  path: string;
  entityType: string;
  entityId: string;
  title: string;
  label: string;
  localText: string;
  serverText: string;
};

export function stableStudioStringify(value: unknown): string;
export function durableStudioData<T>(source: T): T;
export function mergeStudioConflict<T>(base: T, local: T, server: T): { merged: T; conflicts: StudioConflictDetail[] };
export function resolveStudioConflict<T>(base: T, local: T, server: T, preference: "local" | "server"): T;
export function mergeAiManagedConflict<T>(base: T, local: T, server: T): T | null;
