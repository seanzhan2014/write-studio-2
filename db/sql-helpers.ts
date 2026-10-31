

import { type SqliteDatabase, type SqliteResult } from "@/db/sqlite";

export function rows<T>(result: SqliteResult<T>) {
  return result.results ?? [];
}

export function safeJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

export function bool(value: unknown) { return Number(value) === 1; }

export function insert(db: SqliteDatabase, sql: string, values: unknown[]) { return db.prepare(sql).bind(...values); }

export function updateByKey(db: SqliteDatabase, table: string, key: string, id: string, assignments: Array<[string, unknown]>) {
  const sql = `UPDATE ${table} SET ${assignments.map(([column]) => `${column}=?`).join(",")} WHERE ${key}=?`;
  return db.prepare(sql).bind(...assignments.map(([, value]) => value), id);
}
