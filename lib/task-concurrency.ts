export const MIN_TASK_CONCURRENCY = 1;
export const MAX_TASK_CONCURRENCY = 5;
export const DEFAULT_TASK_CONCURRENCY = 2;

export function normalizeTaskConcurrency(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0
    ? Math.max(MIN_TASK_CONCURRENCY, Math.min(MAX_TASK_CONCURRENCY, Math.round(parsed)))
    : DEFAULT_TASK_CONCURRENCY;
}
