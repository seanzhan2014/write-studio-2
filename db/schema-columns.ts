import type { SqliteDatabase } from "./sqlite";

/** Additive upgrades share one implementation while data migrations stay explicit. */
export async function ensureTableColumns(db: SqliteDatabase, table: string, definitions: Record<string, string>) {
  const existing = new Set((await db.prepare(`PRAGMA table_info('${table}')`).all<{ name: string }>()).results?.map(row => row.name));
  for (const [name, definition] of Object.entries(definitions)) {
    if (!existing.has(name)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
  }
}
