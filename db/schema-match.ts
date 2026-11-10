import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as declaredSchema from "./schema.ts";
import { characterPhotoSchema } from "./character-photo-schema.ts";
import { styleLabSchema } from "./style-lab-schema.ts";
import type { SqliteDatabase } from "./sqlite";

const required: Record<string, string[]> = Object.fromEntries(Object.values(declaredSchema).map(table => {
  const config = getTableConfig(table);
  return [config.name, config.columns.map(column => column.name)];
}));
// These business tables have SQL declarations rather than Drizzle models.
for (const statement of [...characterPhotoSchema, ...styleLabSchema]) {
  const match = statement.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*)\)\s*$/i);
  if (match) required[match[1]] = [...match[2].matchAll(/(?:^|,)\s*(\w+)\s+(?:TEXT|INTEGER|REAL|BLOB)\b/gi)].map(column => column[1]);
}
required.search_documents = ["article_id", "chapter_id", "outline_id", "entity_type", "entity_id", "title", "body"];

export const REQUIRED_DATABASE_COLUMNS: Readonly<Record<string, readonly string[]>> = required;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const tables = Object.entries(required);
// Resolve every qualified column without reading business rows. One statement
// per table respects D1's result-column limits; batch uses one binding call.
export const DATABASE_SCHEMA_PROBE_STATEMENTS = tables.map(([table, columns]) => `SELECT ${columns.map(column => `t.${quote(column)}`).join(",")} FROM ${quote(table)} AS t WHERE 0`);

export async function verifyDatabaseSchema(db: SqliteDatabase) {
  await db.batch(DATABASE_SCHEMA_PROBE_STATEMENTS.map(sql => db.prepare(sql)));
}

export async function databaseSchemaMatches(db: SqliteDatabase) {
  try { await verifyDatabaseSchema(db); return true; }
  catch { return false; }
}

export async function missingDatabaseColumns(db: SqliteDatabase) {
  const missing: string[] = [];
  for (const [table, columns] of tables) {
    const actual = await db.prepare(`PRAGMA table_info(${quote(table)})`).all<{ name: string }>();
    const names = new Set(actual.results?.map(column => column.name));
    if (!names.size) missing.push(`${table}.*`);
    else for (const column of columns) if (!names.has(column)) missing.push(`${table}.${column}`);
  }
  return missing;
}
