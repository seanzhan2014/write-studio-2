import type { SqliteDatabase } from "./sqlite";

/** Centralized generation upgrades are checked against the full schema contract. */
export const AI_GENERATE_SETTINGS_COLUMNS = {
  articles: { illustration_settings_json: "TEXT NOT NULL DEFAULT '{}'", ai_generate_settings_json: "TEXT NOT NULL DEFAULT '{}'" },
  outlines: { illustration_options_json: "TEXT", generate_options_json: "TEXT", expansion_json: "TEXT" },
} as const;

/** Additive upgrades share one implementation while data migrations stay explicit. */
export async function ensureTableColumns(db: SqliteDatabase, table: string, definitions: Record<string, string>) {
  const existing = new Set((await db.prepare(`PRAGMA table_info('${table}')`).all<{ name: string }>()).results?.map(row => row.name));
  for (const [name, definition] of Object.entries(definitions)) {
    if (existing.has(name)) continue;
    try {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
    } catch (error) {
      // Separate Worker isolates may discover the same missing column together.
      const columns = await db.prepare(`PRAGMA table_info('${table}')`).all<{ name: string }>();
      if (!columns.results?.some(column => column.name === name)) throw error;
    }
  }
}
