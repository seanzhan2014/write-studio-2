export type SaveRetryState = { serialized: string; attempts: number; nextAttemptAt: number };

export function nextSaveRetry(previous: SaveRetryState | null, serialized: string, now: number): SaveRetryState {
  const attempts = previous?.serialized === serialized ? previous.attempts + 1 : 1;
  return { serialized, attempts, nextAttemptAt: now + Math.min(30_000, 2_000 * 2 ** Math.min(attempts - 1, 4)) };
}

export function shouldRetrySave(state: SaveRetryState | null, serialized: string, now: number) {
  return !state || state.serialized !== serialized || now >= state.nextAttemptAt;
}
