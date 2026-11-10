import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { characterPhotoSchema } from "../db/character-photo-schema.ts";
import { styleLabSchema } from "../db/style-lab-schema.ts";
import { illustrationSchema } from "../db/illustration-schema.ts";
import { AI_GENERATE_SETTINGS_COLUMNS, ensureTableColumns } from "../db/schema-columns.ts";
import { databaseSchemaMatches, missingDatabaseColumns } from "../db/schema-match.ts";
import { normalizeReviewRuleItems, createReviewRuleSnapshot } from "../lib/review-rules.mjs";
import { normalizeReviewRules } from "../lib/generate-review.mjs";
import { decryptAiSecret } from "../lib/ai-secret.ts";

// Run every actual initializer. Only the database binding and background runner
// are supplied by the test; no business migration is replaced with a no-op.
export function runtimeHarness(cloud = false) {
  const source = readFileSync(new URL("../db/schema-runtime.ts", import.meta.url), "utf8") + "\n" + readFileSync(new URL("../db/sql-helpers.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("runtime.ts", source, ts.ScriptTarget.Latest, true);
  const variables = ["schemaStatements", "RUNTIME_SCHEMA_VERSION", "RUNTIME_SCHEMA_VERSION_KEY", "initialized"];
  const selected = parsed.statements.filter(node => ts.isFunctionDeclaration(node)
    ? true
    : ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => variables.includes(declaration.name.getText(parsed))));
  const code = ts.transpileModule(selected.map(node => node.getText(parsed)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/^export /gm, "");
  const native = new DatabaseSync(":memory:");
  let writes = 0;
  function statement(sql, values = []) {
    return {
      bind: (...next) => statement(sql, next),
      async run() { writes++; native.prepare(sql).run(...values); return { success: true }; },
      async all() { return { success: true, results: native.prepare(sql).all(...values) }; },
      async first(column) { const row = native.prepare(sql).get(...values); return column ? row?.[column] ?? null : row ?? null; },
    };
  }
  const db = { prepare: sql => statement(sql), batch: async statements => Promise.all(statements.map(statement => statement.run())) };
  const noop = async () => {};
  const context = { characterPhotoSchema, styleLabSchema, AI_GENERATE_SETTINGS_COLUMNS, ensureTableColumns, databaseSchemaMatches, missingDatabaseColumns, normalizeReviewRuleItems, createReviewRuleSnapshot, normalizeReviewRules, decryptAiSecret, getDatabase: () => db, isCloudDatabase: () => cloud, illustrationSchema, taskHistoryTriggers: [], onDatabaseReady: noop };
  const runtime = Function(...Object.keys(context), `${code}\nreturn { ensureDatabase, hasCurrentRuntimeSchema, schemaStatements, version: RUNTIME_SCHEMA_VERSION, newIsolate() { initialized = null; } };`)(...Object.values(context));
  return { native, runtime, db, writes: () => writes };
}

